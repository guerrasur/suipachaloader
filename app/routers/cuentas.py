"""Cuentas operativas separadas de la caja diaria y de los pedidos corrientes."""
from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Cliente, CuentaCliente, MovimientoPlatos, PedidoCuenta, ItemCuenta, CierreCuenta

router = APIRouter(prefix="/api/cuentas", tags=["cuentas"])


class CuentaNueva(BaseModel):
    cliente_id: int
    tipo: Literal["platos", "semanal"]


class MovimientoIn(BaseModel):
    fecha: date = Field(default_factory=date.today)
    tipo: Literal["carga", "retiro"]
    cantidad: int = Field(gt=0)
    plato: str = ""
    nota: str = ""

    @field_validator("plato", "nota")
    @classmethod
    def limpiar(cls, value: str) -> str:
        return value.strip()


class ItemIn(BaseModel):
    plato: str = Field(min_length=1)
    cantidad: int = Field(gt=0)
    precio_unitario: float = Field(ge=0, allow_inf_nan=False)
    extra: str = ""
    precio_extra: float = Field(default=0, ge=0, allow_inf_nan=False)

    @field_validator("plato", "extra")
    @classmethod
    def limpiar(cls, value: str) -> str:
        return value.strip()


class PedidoIn(BaseModel):
    fecha: date = Field(default_factory=date.today)
    nota: str = ""
    items: list[ItemIn] = Field(min_length=1)


class CierreIn(BaseModel):
    hasta: date = Field(default_factory=date.today)


def _cuenta(db: Session, cuenta_id: int, tipo: str | None = None) -> CuentaCliente:
    cuenta = db.get(CuentaCliente, cuenta_id)
    if not cuenta:
        raise HTTPException(404, "Cuenta no encontrada")
    if tipo and cuenta.tipo != tipo:
        raise HTTPException(409, "Esta operación no corresponde a la modalidad de la cuenta")
    return cuenta


def _saldo(movimientos: list[MovimientoPlatos]) -> int:
    return sum(m.cantidad if m.tipo == "carga" else -m.cantidad for m in movimientos)


def _pedido_out(p: PedidoCuenta) -> dict:
    return {
        "id": p.id, "fecha": p.fecha, "nota": p.nota, "total": p.total,
        "cierre_id": p.cierre_id,
        "items": [{"plato": i.plato, "cantidad": i.cantidad,
                   "precio_unitario": i.precio_unitario, "extra": i.extra,
                   "precio_extra": i.precio_extra} for i in p.items],
    }


@router.get("")
def listar(db: Session = Depends(get_db)):
    cuentas = db.query(CuentaCliente).join(Cliente).order_by(Cliente.nombre).all()
    resultado = []
    for c in cuentas:
        if c.tipo == "platos":
            movimientos = db.query(MovimientoPlatos).filter_by(cuenta_id=c.id).all()
            valor = _saldo(movimientos)
        else:
            pedidos = db.query(PedidoCuenta).filter_by(cuenta_id=c.id, cierre_id=None).all()
            valor = round(sum(p.total for p in pedidos), 2)
        resultado.append({"id": c.id, "cliente_id": c.cliente_id, "nombre": c.cliente.nombre,
                          "tipo": c.tipo, "valor": valor})
    return resultado


@router.post("")
def crear(data: CuentaNueva, db: Session = Depends(get_db)):
    if not db.get(Cliente, data.cliente_id):
        raise HTTPException(404, "Cliente no encontrado")
    if db.query(CuentaCliente).filter_by(cliente_id=data.cliente_id).first():
        raise HTTPException(409, "Este cliente ya tiene una cuenta")
    cuenta = CuentaCliente(**data.model_dump())
    db.add(cuenta)
    db.commit()
    return {"id": cuenta.id}


@router.get("/{cuenta_id}")
def detalle(cuenta_id: int, db: Session = Depends(get_db)):
    c = _cuenta(db, cuenta_id)
    base = {"id": c.id, "cliente_id": c.cliente_id, "nombre": c.cliente.nombre, "tipo": c.tipo}
    if c.tipo == "platos":
        movimientos = (db.query(MovimientoPlatos).filter_by(cuenta_id=c.id)
                       .order_by(MovimientoPlatos.fecha.desc(), MovimientoPlatos.id.desc()).all())
        base.update(saldo=_saldo(movimientos), movimientos=[
            {"id": m.id, "fecha": m.fecha, "tipo": m.tipo, "cantidad": m.cantidad,
             "plato": m.plato, "nota": m.nota} for m in movimientos])
    else:
        pedidos = (db.query(PedidoCuenta).options(selectinload(PedidoCuenta.items))
                   .filter_by(cuenta_id=c.id).order_by(PedidoCuenta.fecha.desc(), PedidoCuenta.id.desc()).all())
        cierres = db.query(CierreCuenta).filter_by(cuenta_id=c.id).order_by(CierreCuenta.id.desc()).all()
        base.update(pendiente=round(sum(p.total for p in pedidos if p.cierre_id is None), 2),
                    pedidos=[_pedido_out(p) for p in pedidos],
                    cierres=[{"id": cierre.id, "fecha": cierre.fecha, "total": cierre.total,
                              "pagado": cierre.pagado} for cierre in cierres])
    return base


@router.post("/{cuenta_id}/movimientos")
def movimiento(cuenta_id: int, data: MovimientoIn, db: Session = Depends(get_db)):
    _cuenta(db, cuenta_id, "platos")
    if data.tipo == "retiro" and not data.plato:
        raise HTTPException(422, "Indicá qué plato retiró")
    saldo = _saldo(db.query(MovimientoPlatos).filter_by(cuenta_id=cuenta_id).all())
    if data.tipo == "retiro" and data.cantidad > saldo:
        raise HTTPException(409, f"Quedan {saldo} platos; no se puede descontar {data.cantidad}")
    m = MovimientoPlatos(cuenta_id=cuenta_id, **data.model_dump())
    db.add(m)
    db.commit()
    return {"id": m.id, "saldo": saldo + (data.cantidad if data.tipo == "carga" else -data.cantidad)}


@router.delete("/{cuenta_id}/movimientos/{movimiento_id}", status_code=204)
def borrar_movimiento(cuenta_id: int, movimiento_id: int, db: Session = Depends(get_db)):
    _cuenta(db, cuenta_id, "platos")
    m = db.get(MovimientoPlatos, movimiento_id)
    if not m or m.cuenta_id != cuenta_id:
        raise HTTPException(404, "Movimiento no encontrado")
    movimientos = (db.query(MovimientoPlatos).filter_by(cuenta_id=cuenta_id)
                   .order_by(MovimientoPlatos.id).all())
    # Una corrección no puede dejar saldo negativo en ningún punto posterior.
    saldo = 0
    for item in movimientos:
        if item.id == m.id:
            continue
        saldo += item.cantidad if item.tipo == "carga" else -item.cantidad
        if saldo < 0:
            raise HTTPException(409, "Primero corregí los retiros posteriores a esta carga")
    db.delete(m)
    db.commit()


@router.post("/{cuenta_id}/pedidos")
def pedido(cuenta_id: int, data: PedidoIn, db: Session = Depends(get_db)):
    _cuenta(db, cuenta_id, "semanal")
    if any(not i.plato for i in data.items):
        raise HTTPException(422, "Cada renglón necesita un plato")
    p = PedidoCuenta(cuenta_id=cuenta_id, fecha=data.fecha, nota=data.nota.strip())
    p.items = [ItemCuenta(**i.model_dump()) for i in data.items]
    p.total = round(sum(i.cantidad * (i.precio_unitario + i.precio_extra) for i in data.items), 2)
    db.add(p)
    db.commit()
    return {"id": p.id, "total": p.total}


@router.delete("/{cuenta_id}/pedidos/{pedido_id}", status_code=204)
def borrar_pedido(cuenta_id: int, pedido_id: int, db: Session = Depends(get_db)):
    _cuenta(db, cuenta_id, "semanal")
    p = db.get(PedidoCuenta, pedido_id)
    if not p or p.cuenta_id != cuenta_id:
        raise HTTPException(404, "Pedido no encontrado")
    if p.cierre_id is not None:
        raise HTTPException(409, "El pedido ya fue incluido en un cierre")
    db.delete(p)
    db.commit()


@router.post("/{cuenta_id}/cierres")
def cerrar(cuenta_id: int, data: CierreIn, db: Session = Depends(get_db)):
    _cuenta(db, cuenta_id, "semanal")
    pedidos = (db.query(PedidoCuenta).filter(PedidoCuenta.cuenta_id == cuenta_id,
                                            PedidoCuenta.cierre_id.is_(None),
                                            PedidoCuenta.fecha <= data.hasta).all())
    if not pedidos:
        raise HTTPException(409, "No hay pedidos pendientes hasta esa fecha")
    cierre = CierreCuenta(cuenta_id=cuenta_id, fecha=data.hasta,
                          total=round(sum(p.total for p in pedidos), 2))
    db.add(cierre)
    db.flush()
    for p in pedidos:
        p.cierre_id = cierre.id
    db.commit()
    return {"id": cierre.id, "total": cierre.total, "pedidos": len(pedidos)}


@router.post("/{cuenta_id}/cierres/{cierre_id}/pagado")
def marcar_pagado(cuenta_id: int, cierre_id: int, db: Session = Depends(get_db)):
    _cuenta(db, cuenta_id, "semanal")
    cierre = db.get(CierreCuenta, cierre_id)
    if not cierre or cierre.cuenta_id != cuenta_id:
        raise HTTPException(404, "Cierre no encontrado")
    cierre.pagado = True
    db.commit()
    return {"id": cierre.id, "pagado": True}
