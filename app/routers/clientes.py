"""Clientes: agenda y autocompletado (nombre — dirección)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Cliente, CuentaCliente, Pedido
from ..schemas import ClienteIn, ClienteOut

router = APIRouter(prefix="/api/clientes", tags=["clientes"])


@router.get("/agenda", response_model=list[ClienteOut])
def agenda(db: Session = Depends(get_db)):
    """Listado completo; la búsqueda de autocompletado sigue limitada a 20."""
    return db.query(Cliente).order_by(Cliente.nombre, Cliente.direccion, Cliente.id).all()


@router.get("", response_model=list[ClienteOut])
def listar(q: str = "", db: Session = Depends(get_db)):
    # Nombre y dirección identifican al cliente en los pedidos históricos.
    ultimo_pago = (
        select(Pedido.metodo_pago)
        .where(
            Pedido.cliente_nombre == Cliente.nombre,
            Pedido.cliente_direccion == Cliente.direccion,
            Pedido.anulado.is_(False),
        )
        .order_by(Pedido.hora_pedido.desc(), Pedido.id.desc())
        .limit(1)
        .correlate(Cliente)
        .scalar_subquery()
    )
    query = db.query(Cliente, ultimo_pago)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Cliente.nombre.ilike(like),
                Cliente.direccion.ilike(like),
                Cliente.telefono.ilike(like),
            )
        )
    # Nunca asumir que un nombre es único: se ordena por nombre + dirección.
    return [
        ClienteOut.model_validate(cliente).model_copy(update={"ultimo_metodo_pago": pago})
        for cliente, pago in query.order_by(Cliente.nombre, Cliente.direccion).limit(20).all()
    ]


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


@router.delete("/{cliente_id}", status_code=204)
def borrar(cliente_id: int, db: Session = Depends(get_db)):
    cliente = db.get(Cliente, cliente_id)
    if not cliente:
        raise HTTPException(404, "Cliente no encontrado")
    if db.query(CuentaCliente).filter_by(cliente_id=cliente_id).first():
        raise HTTPException(409, "El cliente tiene una cuenta. Conservá su historial.")
    db.delete(cliente)
    db.commit()
