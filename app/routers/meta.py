"""Config, resumen de caja, pendientes de días anteriores y exportación."""
from __future__ import annotations

from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import config as cfg
from ..database import get_db
from ..excel_export import (
    exportar_dia,
    exportar_mes,
    nombre_archivo,
    nombre_archivo_dia,
)
from ..models import Pedido, PlatoDia, RepartidorDia
from ..schemas import ConfigIn, PlatoDiaIn, RepartidoresDiaIn

router = APIRouter(prefix="/api", tags=["meta"])

_VERSION_PATH = Path(__file__).resolve().parent.parent.parent / "VERSION"


@router.get("/version")
def version():
    try:
        v = _VERSION_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        v = ""
    return {"version": v}


# --- Configuración ----------------------------------------------------------
@router.get("/config")
def get_config(db: Session = Depends(get_db)):
    return cfg.get_all(db)


@router.put("/config")
def set_config(data: ConfigIn, db: Session = Depends(get_db)):
    valores = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    cfg.set_values(db, valores)
    return cfg.get_all(db)


# --- Resumen de caja del día ------------------------------------------------
@router.get("/resumen")
def resumen(fecha: date | None = None, db: Session = Depends(get_db)):
    fecha = fecha or date.today()
    pedidos = (
        db.query(Pedido)
        .filter(Pedido.fecha == fecha, Pedido.anulado.is_(False))
        .all()
    )
    por_metodo: dict[str, float] = {"Efectivo": 0.0, "Transferencia": 0.0, "QR": 0.0, "Posnet": 0.0}
    total = 0.0
    for p in pedidos:
        total += p.total
        por_metodo[p.metodo_pago] = por_metodo.get(p.metodo_pago, 0.0) + p.total
    return {
        "fecha": fecha.isoformat(),
        "cantidad": len(pedidos),
        "total": round(total, 2),
        "por_metodo": {k: round(v, 2) for k, v in por_metodo.items()},
    }


# --- Facturación de fin del día ---------------------------------------------
@router.get("/facturacion")
def facturacion(fecha: date | None = None, db: Session = Depends(get_db)):
    """Cierre para facturar: por cada método de pago, cuántas unidades de cada
    ítem se vendieron y cuántos envíos hubo. Así se facturan juntos todos los
    pedidos en efectivo y, por separado, todos los de transferencia (y QR /
    Posnet si se usaron ese día)."""
    fecha = fecha or date.today()
    pedidos = (
        db.query(Pedido)
        .filter(Pedido.fecha == fecha, Pedido.anulado.is_(False))
        .all()
    )

    # Acumulador por método: items (nombre -> cantidad), envíos, pedidos, total.
    acum: dict[str, dict] = {}

    def bucket(metodo: str) -> dict:
        return acum.setdefault(
            metodo, {"items": {}, "envios": 0, "pedidos": 0, "total": 0.0}
        )

    for p in pedidos:
        b = bucket(p.metodo_pago)
        b["pedidos"] += 1
        b["total"] += p.total
        # Un envío = un pedido de tipo "Envío" (más allá de si se cobró o no).
        if p.tipo == "Envío":
            b["envios"] += 1
        for it in p.items:
            nombre = (it.nombre or "").strip() or "(sin nombre)"
            b["items"][nombre] = b["items"].get(nombre, 0) + it.cantidad

    # Orden de columnas: primero los métodos habituales, luego el resto usado.
    orden = ["Efectivo", "Transferencia", "QR", "Posnet"]
    metodos = [m for m in orden if m in acum] + [m for m in acum if m not in orden]

    def serializar(b: dict) -> dict:
        items = sorted(
            ({"nombre": n, "cantidad": c} for n, c in b["items"].items()),
            key=lambda x: (-x["cantidad"], x["nombre"].lower()),
        )
        return {
            "items": items,
            "envios": b["envios"],
            "pedidos": b["pedidos"],
            "total": round(b["total"], 2),
        }

    return {
        "fecha": fecha.isoformat(),
        "metodos": metodos,
        "por_metodo": {m: serializar(acum[m]) for m in metodos},
    }


# --- Pendientes / avisos ----------------------------------------------------
@router.get("/pendientes")
def pendientes(db: Session = Depends(get_db)):
    """Avisos de apertura: pedidos de días anteriores sin facturar y badge de
    pedidos ya cargados para mañana."""
    hoy = date.today()
    anteriores = (
        db.query(Pedido)
        .filter(Pedido.fecha < hoy, Pedido.facturado.is_(False), Pedido.anulado.is_(False))
        .order_by(Pedido.fecha)
        .all()
    )
    manana = (
        db.query(Pedido)
        .filter(Pedido.fecha > hoy, Pedido.anulado.is_(False))
        .count()
    )
    return {
        "sin_facturar_anteriores": len(anteriores),
        "fechas_anteriores": sorted({p.fecha.isoformat() for p in anteriores}),
        "pedidos_futuros": manana,
    }


# --- Repartidores del día ---------------------------------------------------
@router.get("/repartidores-dia")
def get_repartidores_dia(fecha: date | None = None, db: Session = Depends(get_db)):
    fecha = fecha or date.today()
    filas = (
        db.query(RepartidorDia)
        .filter(RepartidorDia.fecha == fecha)
        .order_by(RepartidorDia.id)
        .all()
    )
    return {"fecha": fecha.isoformat(), "nombres": [f.nombre for f in filas]}


@router.put("/repartidores-dia")
def set_repartidores_dia(
    data: RepartidoresDiaIn, fecha: date | None = None, db: Session = Depends(get_db)
):
    """Fija (reemplaza) los repartidores de la fecha. 1 o 2 nombres."""
    fecha = fecha or date.today()
    db.query(RepartidorDia).filter(RepartidorDia.fecha == fecha).delete()
    nombres = [n.strip() for n in data.nombres if n and n.strip()][:2]
    for nombre in nombres:
        db.add(RepartidorDia(fecha=fecha, nombre=nombre))
    db.commit()
    return {"fecha": fecha.isoformat(), "nombres": nombres}


# --- Plato del día ----------------------------------------------------------
@router.get("/plato-del-dia")
def get_plato_dia(fecha: date | None = None, db: Session = Depends(get_db)):
    fecha = fecha or date.today()
    row = db.get(PlatoDia, fecha)
    return {
        "fecha": fecha.isoformat(),
        "definido": row is not None,  # si ya se respondió para ese día
        "hay": bool(row.hay) if row else False,
        "nombre": row.nombre if row else "",
        "precio_efectivo": row.precio_efectivo if row else 0.0,
        "precio_lista": row.precio_lista if row else 0.0,
    }


@router.put("/plato-del-dia")
def set_plato_dia(
    data: PlatoDiaIn, fecha: date | None = None, db: Session = Depends(get_db)
):
    """Define el plato del día de la fecha (o marca que ese día no hay)."""
    fecha = fecha or date.today()
    row = db.get(PlatoDia, fecha)
    if row is None:
        row = PlatoDia(fecha=fecha)
        db.add(row)
    row.hay = data.hay
    row.nombre = data.nombre.strip()
    row.precio_efectivo = max(0.0, data.precio_efectivo)
    row.precio_lista = max(0.0, data.precio_lista)
    db.commit()
    return {
        "fecha": fecha.isoformat(),
        "definido": True,
        "hay": row.hay,
        "nombre": row.nombre,
        "precio_efectivo": row.precio_efectivo,
        "precio_lista": row.precio_lista,
    }


# --- Exportación ------------------------------------------------------------
@router.post("/export")
def exportar(anio: int | None = None, mes: int | None = None, db: Session = Depends(get_db)):
    hoy = date.today()
    anio = anio or hoy.year
    mes = mes or hoy.month
    ruta = exportar_mes(db, anio, mes)
    return {"ok": True, "archivo": ruta.name, "url": f"/api/export/descargar?anio={anio}&mes={mes}"}


@router.get("/export/descargar")
def descargar(anio: int, mes: int, db: Session = Depends(get_db)):
    ruta = exportar_mes(db, anio, mes)
    return FileResponse(
        ruta,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=nombre_archivo(anio, mes),
    )


# Exportación de un solo día (una hoja) para pegar al Excel del mes.
@router.get("/export/dia")
def descargar_dia(fecha: date | None = None, db: Session = Depends(get_db)):
    fecha = fecha or date.today()
    ruta = exportar_dia(db, fecha)
    return FileResponse(
        ruta,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=nombre_archivo_dia(fecha),
    )
