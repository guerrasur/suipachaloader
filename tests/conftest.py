"""Fixtures compartidas: BD SQLite temporal y TestClient de la app.

La URL de la base se resuelve al IMPORTAR app.database, así que el
environment variable tiene que estar fijado antes de tocar cualquier
módulo de la app.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="suipacha-tests-"))
os.environ["CARABELAS_DB_URL"] = f"sqlite:///{_TMP / 'test.db'}"

from fastapi.testclient import TestClient  # noqa: E402

import app.main as main_mod  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import Cliente, Pedido, PedidoItem, PlatoDia, RepartidorDia  # noqa: E402

# El startup real respalda la BD de producción y lanza el hilo de backups
# periódicos: en tests se anulan.
main_mod.hacer_backup = lambda *a, **k: None
if hasattr(main_mod, "iniciar_backups_periodicos"):
    main_mod.iniciar_backups_periodicos = lambda *a, **k: None


@pytest.fixture(scope="session")
def client():
    # El context manager dispara el evento de startup (create_all + seed).
    with TestClient(main_mod.app) as c:
        yield c


@pytest.fixture(autouse=True)
def db_limpia():
    """Deja las tablas transaccionales vacías después de cada test."""
    yield
    db = SessionLocal()
    try:
        db.query(PedidoItem).delete()
        db.query(Pedido).delete()
        db.query(Cliente).delete()
        db.query(RepartidorDia).delete()
        db.query(PlatoDia).delete()
        db.commit()
    finally:
        db.close()
