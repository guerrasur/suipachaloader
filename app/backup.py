"""Backup automático de la base SQLite a backups/ (conserva los últimos 30)."""
from __future__ import annotations

import sqlite3
import threading
import time
from datetime import date
from pathlib import Path

from .database import DATA_DIR, DB_PATH

BACKUP_DIR = DATA_DIR / "backups"
MAX_BACKUPS = 30
REFRESCO_HORAS = 3  # cada cuánto se refresca el backup del día


def _copiar_db(destino: Path) -> None:
    """Copia consistente con la API de backup online de SQLite.

    A diferencia de copiar el archivo, esta API tolera escrituras en curso.
    Se escribe a un .tmp y se renombra al final: nunca queda un backup a
    medio escribir.
    """
    tmp = destino.with_suffix(".tmp")
    src = sqlite3.connect(DB_PATH)
    try:
        dst = sqlite3.connect(tmp)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    tmp.replace(destino)


def hacer_backup(hoy: date | None = None, refrescar_horas: float | None = None) -> Path | None:
    """Respalda la base a backups/carabelas_YYYY-MM-DD.db.

    Sin `refrescar_horas` sólo crea el backup del día si no existe. Con
    `refrescar_horas`, además lo rehace si quedó más viejo que ese umbral
    (así el backup no queda congelado a la hora de arranque en un local que
    prende la PC una sola vez al día). Poda a los últimos MAX_BACKUPS.
    """
    if not DB_PATH.exists():
        return None

    BACKUP_DIR.mkdir(exist_ok=True)
    hoy = hoy or date.today()
    destino = BACKUP_DIR / f"carabelas_{hoy.isoformat()}.db"

    vencido = (
        refrescar_horas is not None
        and destino.exists()
        and time.time() - destino.stat().st_mtime > refrescar_horas * 3600
    )
    if not destino.exists() or vencido:
        _copiar_db(destino)

    _podar()
    return destino


def iniciar_backups_periodicos() -> None:
    """Hilo daemon que refresca el backup del día cada REFRESCO_HORAS."""

    def _loop() -> None:
        while True:
            time.sleep(REFRESCO_HORAS * 3600)
            try:
                hacer_backup(refrescar_horas=REFRESCO_HORAS)
            except Exception as e:  # el backup nunca voltea la app
                print(f"[aviso] Falló el backup periódico: {e}")

    threading.Thread(target=_loop, daemon=True, name="backups-periodicos").start()


def _podar() -> None:
    # Limpia también .tmp huérfanos de un backup interrumpido.
    for tmp in BACKUP_DIR.glob("carabelas_*.tmp"):
        try:
            tmp.unlink()
        except OSError:
            pass
    backups = sorted(BACKUP_DIR.glob("carabelas_*.db"))
    sobrantes = backups[:-MAX_BACKUPS] if len(backups) > MAX_BACKUPS else []
    for viejo in sobrantes:
        try:
            viejo.unlink()
        except OSError:
            pass
