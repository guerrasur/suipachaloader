"""Backup automático de la base SQLite a backups/ (conserva los últimos 30)."""
from __future__ import annotations

import shutil
from datetime import date
from pathlib import Path

from .database import DATA_DIR, DB_PATH

BACKUP_DIR = DATA_DIR / "backups"
MAX_BACKUPS = 30


def hacer_backup(hoy: date | None = None) -> Path | None:
    """Copia la base a backups/carabelas_YYYY-MM-DD.db si aún no existe hoy.

    Devuelve la ruta del backup creado (o el existente del día). Poda a los
    últimos MAX_BACKUPS archivos.
    """
    if not DB_PATH.exists():
        return None

    BACKUP_DIR.mkdir(exist_ok=True)
    hoy = hoy or date.today()
    destino = BACKUP_DIR / f"carabelas_{hoy.isoformat()}.db"

    if not destino.exists():
        shutil.copy2(DB_PATH, destino)

    _podar()
    return destino


def _podar() -> None:
    backups = sorted(BACKUP_DIR.glob("carabelas_*.db"))
    sobrantes = backups[:-MAX_BACKUPS] if len(backups) > MAX_BACKUPS else []
    for viejo in sobrantes:
        try:
            viejo.unlink()
        except OSError:
            pass
