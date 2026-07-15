"""Configuración de la base de datos SQLite local."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent


def _dir_datos() -> Path:
    """Carpeta de datos FUERA de la app, así las actualizaciones (que
    reemplazan los archivos del programa) nunca tocan la base ni los backups.

    Windows: %LOCALAPPDATA%\\SuipachaLoader. Otros sistemas: ~/.suipachaloader.
    """
    local = os.environ.get("LOCALAPPDATA")
    d = Path(local) / "SuipachaLoader" if local else Path.home() / ".suipachaloader"
    d.mkdir(parents=True, exist_ok=True)
    return d


DATA_DIR = _dir_datos()
DB_PATH = DATA_DIR / "carabelas.db"

# Migración única: si la base vieja vive junto a la app (<app>/data/) y todavía
# no existe en la carpeta de datos, se copia. La original queda como respaldo.
_LEGACY_DB = BASE_DIR / "data" / "carabelas.db"
if not DB_PATH.exists() and _LEGACY_DB.exists():
    shutil.copy2(_LEGACY_DB, DB_PATH)

DATABASE_URL = os.environ.get("CARABELAS_DB_URL", f"sqlite:///{DB_PATH}")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    """Dependency de FastAPI: entrega una sesión y la cierra al terminar."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
