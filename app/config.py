"""Parámetros configurables de la app (persistidos en tabla config)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Config

DEFAULTS: dict[str, str] = {
    # Minutos que un pedido puede estar cargado sin hora de salida antes de
    # marcarse como demorado.
    "minutos_demora_salida": "30",
    # Hora a partir de la cual un pedido sin facturar se resalta (HH:MM).
    "hora_alerta_sin_facturar": "14:00",
    # Hora límite de toma de pedidos; cargar después avisa (HH:MM).
    "hora_limite_pedidos": "13:40",
    # Costo de envío por defecto para pedidos tipo Envío.
    "costo_envio_default": "3000",
    # Dirección del local (punto de partida de las rutas de envío).
    "direccion_local": "",
    # Ciudad/zona que se agrega a las direcciones al geocodificar si no la
    # incluyen ya (ej. "Suipacha, Buenos Aires, Argentina").
    "ciudad_default": "",
}


def ensure_defaults(db: Session) -> None:
    existentes = {c.clave for c in db.query(Config).all()}
    for clave, valor in DEFAULTS.items():
        if clave not in existentes:
            db.add(Config(clave=clave, valor=valor))
    db.commit()


def get_all(db: Session) -> dict[str, str]:
    data = dict(DEFAULTS)
    for c in db.query(Config).all():
        data[c.clave] = c.valor
    return data


def get_value(db: Session, clave: str) -> str:
    row = db.get(Config, clave)
    return row.valor if row else DEFAULTS.get(clave, "")


def set_values(db: Session, valores: dict[str, str]) -> None:
    for clave, valor in valores.items():
        if clave not in DEFAULTS:
            continue
        row = db.get(Config, clave)
        if row:
            row.valor = str(valor)
        else:
            db.add(Config(clave=clave, valor=str(valor)))
    db.commit()
