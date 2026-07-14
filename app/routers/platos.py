"""Carta: catálogo de platos con doble precio y aumento masivo."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Plato
from ..schemas import AumentoIn, PlatoIn, PlatoOut, SetPreciosIn

router = APIRouter(prefix="/api/platos", tags=["platos"])


@router.get("", response_model=list[PlatoOut])
def listar(incluir_inactivos: bool = False, db: Session = Depends(get_db)):
    q = db.query(Plato)
    if not incluir_inactivos:
        q = q.filter(Plato.activo.is_(True))
    return q.order_by(Plato.categoria, Plato.nombre).all()


@router.post("", response_model=PlatoOut)
def crear(data: PlatoIn, db: Session = Depends(get_db)):
    plato = Plato(**data.model_dump())
    db.add(plato)
    db.commit()
    db.refresh(plato)
    return plato


@router.put("/{plato_id}", response_model=PlatoOut)
def editar(plato_id: int, data: PlatoIn, db: Session = Depends(get_db)):
    plato = db.get(Plato, plato_id)
    if not plato:
        raise HTTPException(404, "Plato no encontrado")
    for k, v in data.model_dump().items():
        setattr(plato, k, v)
    db.commit()
    db.refresh(plato)
    return plato


@router.delete("/{plato_id}")
def dar_de_baja(plato_id: int, db: Session = Depends(get_db)):
    """Baja lógica: marca inactivo para no perder historial de pedidos."""
    plato = db.get(Plato, plato_id)
    if not plato:
        raise HTTPException(404, "Plato no encontrado")
    plato.activo = False
    db.commit()
    return {"ok": True}


@router.post("/aumentar")
def aumentar_todos(data: AumentoIn, db: Session = Depends(get_db)):
    """Suma el mismo monto a ambos precios de todos los platos activos.

    Los pedidos ya cargados conservan su precio (se guarda por ítem).
    """
    platos = db.query(Plato).filter(Plato.activo.is_(True)).all()
    for p in platos:
        p.precio_efectivo = max(0.0, p.precio_efectivo + data.monto)
        p.precio_lista = max(0.0, p.precio_lista + data.monto)
    db.commit()
    return {"ok": True, "actualizados": len(platos)}


@router.post("/set-precios")
def fijar_precios(data: SetPreciosIn, db: Session = Depends(get_db)):
    """Fija masivamente un precio (o los dos) en todos los platos activos.

    Permite cambiar por separado el precio efectivo y el de lista: se aplica
    sólo el campo enviado. Se excluye el "Plato del día" (precio manual). Los
    pedidos ya cargados conservan su precio.
    """
    if data.precio_efectivo is None and data.precio_lista is None:
        raise HTTPException(400, "Indicá al menos un precio a fijar")

    platos = (
        db.query(Plato)
        .filter(Plato.activo.is_(True), Plato.es_plato_del_dia.is_(False))
        .all()
    )
    for p in platos:
        if data.precio_efectivo is not None:
            p.precio_efectivo = max(0.0, data.precio_efectivo)
        if data.precio_lista is not None:
            p.precio_lista = max(0.0, data.precio_lista)
    db.commit()
    return {"ok": True, "actualizados": len(platos)}
