"""Pedidos: carga rápida, tabla del día, edición inline, facturado, anulación."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import config as cfg
from ..database import get_db
from ..models import Pedido, PedidoItem
from ..schemas import ItemIn, PedidoIn, PedidoOut, PedidoPatch
from ..totales import calcular_total

router = APIRouter(prefix="/api/pedidos", tags=["pedidos"])


def _aplicar_items(pedido: Pedido, items: list[ItemIn]) -> None:
    pedido.items.clear()
    for it in items:
        pedido.items.append(
            PedidoItem(
                plato_id=it.plato_id,
                nombre=it.nombre,
                cantidad=it.cantidad,
                precio_unitario=it.precio_unitario,
            )
        )


def _parse_hora(valor: str) -> time:
    h, m = valor.split(":")
    return time(int(h), int(m))


def _commit_o_409(db: Session) -> None:
    """Commit que traduce la colisión del índice único de número a un 409.

    El índice ``ix_pedidos_fecha_numero`` impide dos pedidos con el mismo
    número el mismo día; ante un choque (race de _proximo_numero o mover un
    pedido a una fecha ocupada) se devuelve un 409 claro en vez de un 500.
    """
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Número de pedido en conflicto, reintentá.")


def _serializar(db: Session, p: Pedido) -> dict:
    """PedidoOut + banderas de alerta calculadas para el día de hoy."""
    out = PedidoOut.model_validate(p).model_dump()
    out["demorado"] = False
    out["alerta_sin_facturar"] = False
    if p.anulado or p.fecha != date.today():
        return out

    ahora = datetime.now()
    # Demora de salida: sólo aplica a pedidos con envío pendientes de salir.
    if p.tipo == "Envío" and not p.hora_salida:
        limite = int(cfg.get_value(db, "minutos_demora_salida") or 30)
        if p.hora_pedido and ahora - p.hora_pedido > timedelta(minutes=limite):
            out["demorado"] = True
    # Sin facturar después de la hora configurada.
    if not p.facturado:
        try:
            hlim = _parse_hora(cfg.get_value(db, "hora_alerta_sin_facturar") or "14:00")
            if ahora.time() >= hlim:
                out["alerta_sin_facturar"] = True
        except ValueError:
            pass
    return out


@router.get("")
def listar(fecha: date | None = None, db: Session = Depends(get_db)):
    fecha = fecha or date.today()
    pedidos = (
        db.query(Pedido)
        .filter(Pedido.fecha == fecha)
        .order_by(Pedido.hora_pedido)
        .all()
    )
    return [_serializar(db, p) for p in pedidos]


def _proximo_numero(db: Session, fecha: date) -> int:
    """Número visible de dos dígitos (10-99), reinicia por día.

    Paso 37 (coprimo con 90): los números consecutivos quedan bien separados
    (10, 47, 84, 31, ...) para no confundirlos. Se recorre esa secuencia y se
    devuelve el primer número que no esté ya emitido ese día (anulados
    incluidos), así los borrados definitivos nunca provocan que se repita el
    número de un pedido vivo. Si un día supera los 90 pedidos, sigue en 100+.
    """
    usados = {
        n
        for (n,) in db.query(Pedido.numero).filter(
            Pedido.fecha == fecha, Pedido.numero.isnot(None)
        )
    }
    for i in range(90):
        candidato = 10 + (i * 37) % 90
        if candidato not in usados:
            return candidato
    return max(usados) + 1


@router.post("", response_model=PedidoOut)
def crear(data: PedidoIn, db: Session = Depends(get_db)):
    fecha = data.fecha or date.today()
    pedido = Pedido(
        fecha=fecha,
        numero=_proximo_numero(db, fecha),
        tipo=data.tipo,
        cliente_nombre=data.cliente_nombre,
        cliente_direccion=data.cliente_direccion,
        cliente_telefono=data.cliente_telefono,
        indicaciones=data.indicaciones,
        costo_envio=data.costo_envio,
        no_cobrar_envio=data.no_cobrar_envio,
        descuento_tipo=data.descuento_tipo,
        descuento_valor=data.descuento_valor,
        metodo_pago=data.metodo_pago,
        pago_efectivo_detalle=data.pago_efectivo_detalle,
        repartidor=data.repartidor,
        notas=data.notas,
        hora_pedido=datetime.now(),
    )
    _aplicar_items(pedido, data.items)
    pedido.total = calcular_total(pedido)
    db.add(pedido)
    _commit_o_409(db)
    db.refresh(pedido)
    return pedido


@router.patch("/{pedido_id}")
def editar(pedido_id: int, data: PedidoPatch, db: Session = Depends(get_db)):
    pedido = db.get(Pedido, pedido_id)
    if not pedido:
        raise HTTPException(404, "Pedido no encontrado")

    campos = data.model_dump(exclude_unset=True)
    items = campos.pop("items", None)

    # Marcar hora de facturado automáticamente al pasar a facturado=True.
    if "facturado" in campos:
        if campos["facturado"] and not pedido.facturado:
            pedido.hora_facturado = datetime.now()
        elif not campos["facturado"]:
            pedido.hora_facturado = None

    # Mover un pedido de fecha reasigna el número: el que tenía puede estar ya
    # ocupado en la fecha destino (el índice único no lo permitiría) y los
    # números reinician por día.
    nueva_fecha = campos.get("fecha")
    reasignar_numero = nueva_fecha is not None and nueva_fecha != pedido.fecha

    for k, v in campos.items():
        setattr(pedido, k, v)

    if reasignar_numero:
        pedido.numero = _proximo_numero(db, pedido.fecha)

    if items is not None:
        _aplicar_items(pedido, [ItemIn(**i) for i in items])

    pedido.total = calcular_total(pedido)
    _commit_o_409(db)
    db.refresh(pedido)
    # Con las banderas de alerta: el frontend actualiza la fila sin recargar.
    return _serializar(db, pedido)


@router.post("/facturar-dia")
def facturar_dia(
    fecha: date | None = None,
    metodo_pago: str | None = None,
    db: Session = Depends(get_db),
):
    """Marca como facturados todos los pedidos válidos (no anulados) de la
    fecha que todavía no lo estén. Sirve para el cierre del día al pasar la
    lista completa a facturación de una sola vez, o para cerrar un solo
    método de pago por separado (efectivo y transferencia no se mezclan)."""
    fecha = fecha or date.today()
    filtros = [
        Pedido.fecha == fecha,
        Pedido.anulado.is_(False),
        Pedido.facturado.is_(False),
    ]
    if metodo_pago:
        filtros.append(Pedido.metodo_pago == metodo_pago)
    pendientes = db.query(Pedido).filter(*filtros).all()
    ahora = datetime.now()
    for p in pendientes:
        p.facturado = True
        p.hora_facturado = ahora
    db.commit()
    return {"fecha": fecha.isoformat(), "facturados": len(pendientes)}


@router.post("/{pedido_id}/anular")
def anular(pedido_id: int, db: Session = Depends(get_db)):
    """Anula (no borra): queda visible pero no suma ni alerta."""
    pedido = db.get(Pedido, pedido_id)
    if not pedido:
        raise HTTPException(404, "Pedido no encontrado")
    pedido.anulado = True
    db.commit()
    db.refresh(pedido)
    return _serializar(db, pedido)


@router.post("/{pedido_id}/restaurar")
def restaurar(pedido_id: int, db: Session = Depends(get_db)):
    pedido = db.get(Pedido, pedido_id)
    if not pedido:
        raise HTTPException(404, "Pedido no encontrado")
    pedido.anulado = False
    db.commit()
    db.refresh(pedido)
    return _serializar(db, pedido)


@router.delete("/{pedido_id}", status_code=204)
def borrar(pedido_id: int, db: Session = Depends(get_db)):
    """Borra definitivamente un pedido. Sólo permitido si ya está anulado,
    para no perder por error un pedido activo (anular es reversible, esto no)."""
    pedido = db.get(Pedido, pedido_id)
    if not pedido:
        raise HTTPException(404, "Pedido no encontrado")
    if not pedido.anulado:
        raise HTTPException(400, "Sólo se pueden borrar definitivamente pedidos anulados.")
    db.delete(pedido)
    db.commit()


@router.get("/repartidores")
def repartidores(db: Session = Depends(get_db)):
    """Nombres de repartidores usados antes (autocompletado, lista abierta)."""
    filas = (
        db.query(Pedido.repartidor)
        .filter(Pedido.repartidor != "")
        .distinct()
        .all()
    )
    return sorted({f[0] for f in filas})
