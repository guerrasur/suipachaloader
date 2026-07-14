#!/usr/bin/env python3
"""Arranca la app con un solo comando: levanta el servidor y abre el navegador.

    python run.py
"""
from __future__ import annotations

import threading
import webbrowser

import uvicorn

HOST = "127.0.0.1"
PORT = 8000


def abrir_navegador() -> None:
    webbrowser.open(f"http://{HOST}:{PORT}/")


if __name__ == "__main__":
    # Abrir el navegador un instante después de que el server esté levantando.
    threading.Timer(1.5, abrir_navegador).start()
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)
