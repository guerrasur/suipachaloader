"""Aplicación FastAPI: API + frontend estático."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from . import config as cfg
from .backup import hacer_backup, iniciar_backups_periodicos
from .database import Base, SessionLocal, engine
from .routers import clientes, meta, pedidos, platos, rutas
from .seed import seed_platos

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

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


def _indice_unico_numero() -> None:
    """Garantiza que no haya dos pedidos con el mismo número el mismo día.

    SQLite no permite agregar constraints con ALTER TABLE, pero sí crear
    índices sobre tablas existentes. Antes de crearlo se limpian duplicados
    históricos (el bug de numeración por conteo podía repetir números): se
    conserva el número en el pedido más viejo y se anula en el resto.
    """
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE pedidos SET numero = NULL WHERE id NOT IN ("
                    "  SELECT MIN(id) FROM pedidos WHERE numero IS NOT NULL"
                    "  GROUP BY fecha, numero"
                    ") AND numero IS NOT NULL"
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_pedidos_fecha_numero"
                    " ON pedidos(fecha, numero) WHERE numero IS NOT NULL"
                )
            )
    except Exception as e:  # nunca impedir el arranque por el índice
        print(f"[aviso] No se pudo crear el índice único de números: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrar_columnas()
    _indice_unico_numero()
    db = SessionLocal()
    try:
        cfg.ensure_defaults(db)
        seed_platos(db)
    finally:
        db.close()
    # Backup diario automático al arrancar (idempotente por fecha) y
    # refresco periódico para no depender solo del momento de arranque.
    hacer_backup()
    iniciar_backups_periodicos()
    yield


app = FastAPI(title="Suipacha Loader — Gestor de Pedidos", lifespan=lifespan)

app.include_router(platos.router)
app.include_router(clientes.router)
app.include_router(pedidos.router)
app.include_router(meta.router)
app.include_router(rutas.router)


@app.middleware("http")
async def sin_cacheo_heuristico(request, call_next):
    # Sin Cache-Control el navegador aplica cacheo heurístico (RFC 7234) y
    # puede servir estáticos viejos ante un F5 normal después de actualizar
    # (el updater preserva el mtime del zip vía shutil.copy2, así que
    # Last-Modified no ayuda a invalidar). Forzamos revalidación siempre;
    # sigue siendo barato porque FastAPI responde 304 con el ETag si no
    # cambió nada.
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")
