"""Modelo de datos (SQLAlchemy)."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# --- Valores admitidos (se validan en los schemas, no en la BD) -------------
TIPOS_PEDIDO = ("Take away", "Envío", "Reserva", "Ventanilla")
METODOS_PAGO = ("Transferencia", "Efectivo", "QR", "Posnet")
TIPOS_DESCUENTO = ("monto", "porcentaje")


class Cliente(Base):
    __tablename__ = "clientes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String, index=True)
    direccion: Mapped[str] = mapped_column(String, default="")
    indicaciones: Mapped[str] = mapped_column(Text, default="")
    # Descuento del cliente (opcional). Si descuento_tipo es None no tiene.
    descuento_tipo: Mapped[str | None] = mapped_column(String, nullable=True)
    descuento_valor: Mapped[float] = mapped_column(Float, default=0.0)


class Plato(Base):
    __tablename__ = "platos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String, index=True)
    precio_efectivo: Mapped[float] = mapped_column(Float, default=0.0)
    precio_lista: Mapped[float] = mapped_column(Float, default=0.0)
    categoria: Mapped[str] = mapped_column(String, default="")
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    # Ítem especial: al elegirlo se habilita nombre/precio libres en el pedido.
    es_plato_del_dia: Mapped[bool] = mapped_column(Boolean, default=False)


class Pedido(Base):
    __tablename__ = "pedidos"

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[date] = mapped_column(Date, index=True, default=date.today)
    tipo: Mapped[str] = mapped_column(String, default="Envío")

    cliente_nombre: Mapped[str] = mapped_column(String, default="")
    cliente_direccion: Mapped[str] = mapped_column(String, default="")
    indicaciones: Mapped[str] = mapped_column(Text, default="")

    costo_envio: Mapped[float] = mapped_column(Float, default=0.0)
    no_cobrar_envio: Mapped[bool] = mapped_column(Boolean, default=False)

    descuento_tipo: Mapped[str | None] = mapped_column(String, nullable=True)
    descuento_valor: Mapped[float] = mapped_column(Float, default=0.0)

    total: Mapped[float] = mapped_column(Float, default=0.0)

    metodo_pago: Mapped[str] = mapped_column(String, default="Efectivo")
    pago_efectivo_detalle: Mapped[str] = mapped_column(String, default="")

    hora_pedido: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    repartidor: Mapped[str] = mapped_column(String, default="")
    hora_salida: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    facturado: Mapped[bool] = mapped_column(Boolean, default=False)
    hora_facturado: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    anulado: Mapped[bool] = mapped_column(Boolean, default=False)
    notas: Mapped[str] = mapped_column(Text, default="")

    items: Mapped[list["PedidoItem"]] = relationship(
        back_populates="pedido",
        cascade="all, delete-orphan",
        order_by="PedidoItem.id",
    )


class PedidoItem(Base):
    __tablename__ = "pedido_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    pedido_id: Mapped[int] = mapped_column(ForeignKey("pedidos.id"), index=True)
    # plato_id es opcional: null cuando es "Plato del día" con nombre libre.
    plato_id: Mapped[int | None] = mapped_column(
        ForeignKey("platos.id"), nullable=True
    )
    nombre: Mapped[str] = mapped_column(String)  # snapshot del nombre al cargar
    cantidad: Mapped[int] = mapped_column(Integer, default=1)
    precio_unitario: Mapped[float] = mapped_column(Float, default=0.0)

    pedido: Mapped["Pedido"] = relationship(back_populates="items")


class Config(Base):
    __tablename__ = "config"

    clave: Mapped[str] = mapped_column(String, primary_key=True)
    valor: Mapped[str] = mapped_column(String)
