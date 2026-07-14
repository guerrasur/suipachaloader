"""Carga inicial del catálogo (Carta).

Los platos/categorías salen del ranking real del local (el Excel de
referencia). Los precios son un punto de partida orientativo: se ajustan
desde la sección Carta. Sólo se siembra si la tabla de platos está vacía.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Plato

# (nombre, categoria, precio_efectivo, precio_lista) — precios editables.
CATALOGO = [
    ("Caesar", "Ensaladas", 8000, 8600),
    ("Brie", "Ensaladas", 8000, 8600),
    ("Cobb", "Ensaladas", 8000, 8600),
    ("Clásica", "Ensaladas", 8000, 8600),
    ("Cala", "Ensaladas", 8000, 8600),
    ("Atún", "Ensaladas", 8000, 8600),
    ("Falafel", "Ensaladas", 8000, 8600),
    ("Porto", "Ensaladas", 8000, 8600),
    ("Ravioles EyP", "Ravioles", 8000, 8600),
    ("Ravioles con crema de hongos", "Ravioles", 8000, 8600),
    ("Wrap Caesar con batatas", "Wraps", 8000, 8600),
    ("Wrap de pollo a la Toscana", "Wraps", 8000, 8600),
    ("Wrap Hummus", "Wraps", 8000, 8600),
    ("Wrap Hummus con batatas", "Wraps", 8000, 8600),
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
