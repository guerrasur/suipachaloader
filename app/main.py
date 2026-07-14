"""Aplicación FastAPI: API + frontend estático."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config as cfg
from .backup import hacer_backup
from .database import Base, SessionLocal, engine
from .routers import clientes, meta, pedidos, platos
from .seed import seed_platos

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="Suipacha — Gestor de Pedidos")


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
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


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")
