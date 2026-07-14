"""Schemas de entrada/salida (Pydantic)."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, field_validator

from .models import METODOS_PAGO, TIPOS_DESCUENTO, TIPOS_PEDIDO


# --- Clientes ---------------------------------------------------------------
class ClienteIn(BaseModel):
    nombre: str
    direccion: str = ""
    indicaciones: str = ""
    descuento_tipo: str | None = None
    descuento_valor: float = 0.0

    @field_validator("descuento_tipo")
    @classmethod
    def _val_desc(cls, v):
        if v in (None, "", "ninguno"):
            return None
        if v not in TIPOS_DESCUENTO:
            raise ValueError(f"descuento_tipo debe ser uno de {TIPOS_DESCUENTO}")
        return v


class ClienteOut(ClienteIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


# --- Platos -----------------------------------------------------------------
class PlatoIn(BaseModel):
    nombre: str
    precio_efectivo: float = 0.0
    precio_lista: float = 0.0
    categoria: str = ""
    activo: bool = True
    es_plato_del_dia: bool = False


class PlatoOut(PlatoIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class AumentoIn(BaseModel):
    monto: float  # se suma a precio_efectivo y precio_lista de todos los platos


class SetPreciosIn(BaseModel):
    """Fija masivamente un precio (o los dos) en todos los platos activos.

    Se envía sólo el/los campo(s) que se quieren fijar; el que viene en None
    no se toca (permite cambiar sólo efectivo o sólo lista por separado).
    """

    precio_efectivo: float | None = None
    precio_lista: float | None = None


# --- Items y pedidos --------------------------------------------------------
class ItemIn(BaseModel):
    plato_id: int | None = None
    nombre: str
    cantidad: int = 1
    precio_unitario: float = 0.0

    @field_validator("cantidad")
    @classmethod
    def _val_cant(cls, v):
        return max(1, int(v))


class ItemOut(ItemIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class PedidoIn(BaseModel):
    fecha: date | None = None
    tipo: str = "Envío"
    cliente_nombre: str = ""
    cliente_direccion: str = ""
    indicaciones: str = ""
    items: list[ItemIn] = []
    costo_envio: float = 0.0
    no_cobrar_envio: bool = False
    descuento_tipo: str | None = None
    descuento_valor: float = 0.0
    metodo_pago: str = "Efectivo"
    pago_efectivo_detalle: str = ""
    repartidor: str = ""
    notas: str = ""

    @field_validator("tipo")
    @classmethod
    def _val_tipo(cls, v):
        if v not in TIPOS_PEDIDO:
            raise ValueError(f"tipo debe ser uno de {TIPOS_PEDIDO}")
        return v

    @field_validator("metodo_pago")
    @classmethod
    def _val_pago(cls, v):
        if v not in METODOS_PAGO:
            raise ValueError(f"metodo_pago debe ser uno de {METODOS_PAGO}")
        return v

    @field_validator("descuento_tipo")
    @classmethod
    def _val_desc(cls, v):
        if v in (None, "", "ninguno"):
            return None
        if v not in TIPOS_DESCUENTO:
            raise ValueError(f"descuento_tipo debe ser uno de {TIPOS_DESCUENTO}")
        return v


class PedidoPatch(BaseModel):
    """Actualización parcial (edición inline en la tabla del día)."""

    tipo: str | None = None
    cliente_nombre: str | None = None
    cliente_direccion: str | None = None
    indicaciones: str | None = None
    items: list[ItemIn] | None = None
    costo_envio: float | None = None
    no_cobrar_envio: bool | None = None
    descuento_tipo: str | None = None
    descuento_valor: float | None = None
    metodo_pago: str | None = None
    pago_efectivo_detalle: str | None = None
    repartidor: str | None = None
    hora_salida: datetime | None = None
    facturado: bool | None = None
    notas: str | None = None
    fecha: date | None = None


class PedidoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fecha: date
    tipo: str
    cliente_nombre: str
    cliente_direccion: str
    indicaciones: str
    items: list[ItemOut]
    costo_envio: float
    no_cobrar_envio: bool
    descuento_tipo: str | None
    descuento_valor: float
    total: float
    metodo_pago: str
    pago_efectivo_detalle: str
    hora_pedido: datetime
    repartidor: str
    hora_salida: datetime | None
    facturado: bool
    hora_facturado: datetime | None
    anulado: bool
    notas: str


class RepartidoresDiaIn(BaseModel):
    nombres: list[str] = []  # 1 o 2 nombres; vacíos se ignoran


class ConfigIn(BaseModel):
    minutos_demora_salida: int | None = None
    hora_alerta_sin_facturar: str | None = None
    hora_limite_pedidos: str | None = None
    costo_envio_default: float | None = None
