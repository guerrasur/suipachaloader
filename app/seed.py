"""Carga inicial del catálogo (Carta).

Los platos/categorías salen del ranking real del local (el Excel de
referencia). Los precios son un punto de partida orientativo: se ajustan
desde la sección Carta. Sólo se siembra si la tabla de platos está vacía.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Plato

# Precios actuales del local: efectivo $10500 / lista $11500 (editables).
EFECTIVO = 10500
LISTA = 11500

# (nombre, categoria, precio_efectivo, precio_lista) — precios editables.
CATALOGO = [
    ("Caesar", "Ensaladas", EFECTIVO, LISTA),
    ("Brie", "Ensaladas", EFECTIVO, LISTA),
    ("Cobb", "Ensaladas", EFECTIVO, LISTA),
    ("Clásica", "Ensaladas", EFECTIVO, LISTA),
    ("Cala", "Ensaladas", EFECTIVO, LISTA),
    ("Atún", "Ensaladas", EFECTIVO, LISTA),
    ("Falafel", "Ensaladas", EFECTIVO, LISTA),
    ("Porto", "Ensaladas", EFECTIVO, LISTA),
    ("Ravioles EyP", "Ravioles", EFECTIVO, LISTA),
    ("Ravioles con crema de hongos", "Ravioles", EFECTIVO, LISTA),
    ("Wrap Caesar con batatas", "Wraps", EFECTIVO, LISTA),
    ("Wrap de pollo a la Toscana", "Wraps", EFECTIVO, LISTA),
    ("Wrap Hummus", "Wraps", EFECTIVO, LISTA),
    ("Wrap Hummus con batatas", "Wraps", EFECTIVO, LISTA),
    ("Coca / Coca Zero", "Bebidas", 3000, 3000),
]


def seed_platos(db: Session) -> None:
    if db.query(Plato).count() > 0:
        return
    for nombre, categoria, ef, li in CATALOGO:
        db.add(
            Plato(
                nombre=nombre,
                categoria=categoria,
                precio_efectivo=ef,
                precio_lista=li,
                activo=True,
            )
        )
    # Ítem especial de nombre y precio libres.
    db.add(
        Plato(
            nombre="Plato del día",
            categoria="Especial",
            precio_efectivo=0,
            precio_lista=0,
            activo=True,
            es_plato_del_dia=True,
        )
    )
    db.commit()
