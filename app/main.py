"""Aplicación FastAPI: API + frontend estático."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from . import config as cfg
from .backup import hacer_backup
from .database import Base, SessionLocal, engine
from .routers import clientes, meta, pedidos, platos, rutas
from .seed import seed_platos

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="Suipacha Loader — Gestor de Pedidos")

# Columnas agregadas después de la creación original de la BD. create_all no
# altera tablas existentes, así que se agregan acá si faltan (idempotente).
_COLUMNAS_NUEVAS = [
    ("clientes", "telefono", "VARCHAR NOT NULL DEFAULT ''"),
    ("pedidos", "numero", "INTEGER"),
    ("pedidos", "cliente_telefono", "VARCHAR NOT NULL DEFAULT ''"),
    ("pedidos", "pagado", "BOOLEAN NOT NULL DEFAULT 0"),
]


def _migrar_columnas() -> None:
    with engine.begin() as conn:
        for tabla, columna, tipo in _COLUMNAS_NUEVAS:
            filas = conn.execute(text(f"PRAGMA table_info({tabla})")).fetchall()
            if filas and columna not in {f[1] for f in filas}:
                conn.execute(
                    text(f"ALTER TABLE {tabla} ADD COLUMN {columna} {tipo}")
                )


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    _migrar_columnas()
    db = SessionLocal()
    try:
        cfg.ensure_defaults(db)
        seed_platos(db)
    finally:
        db.close()
    # Backup diario automático al arrancar (idempotente por fecha).
    hacer_backup()


app.include_router(platos.router)
app.include_router(clientes.router)
app.include_router(pedidos.router)
app.include_router(meta.router)
app.include_router(rutas.router)


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")
