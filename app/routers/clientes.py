"""Clientes: alta y autocompletado (nombre — dirección)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Cliente
from ..schemas import ClienteIn, ClienteOut

router = APIRouter(prefix="/api/clientes", tags=["clientes"])


@router.get("", response_model=list[ClienteOut])
def listar(q: str = "", db: Session = Depends(get_db)):
    query = db.query(Cliente)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Cliente.nombre.ilike(like), Cliente.direccion.ilike(like)))
    # Nunca asumir que un nombre es único: se ordena por nombre + dirección.
    return query.order_by(Cliente.nombre, Cliente.direccion).limit(20).all()


@router.post("", response_model=ClienteOut)
def crear(data: ClienteIn, db: Session = Depends(get_db)):
    cliente = Cliente(**data.model_dump())
    db.add(cliente)
    db.commit()
    db.refresh(cliente)
    return cliente


@router.put("/{cliente_id}", response_model=ClienteOut)
def editar(cliente_id: int, data: ClienteIn, db: Session = Depends(get_db)):
    cliente = db.get(Cliente, cliente_id)
    if not cliente:
        raise HTTPException(404, "Cliente no encontrado")
    for k, v in data.model_dump().items():
        setattr(cliente, k, v)
    db.commit()
    db.refresh(cliente)
    return cliente
