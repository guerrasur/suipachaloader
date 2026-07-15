"""Geocoding de direcciones vía Nominatim (OpenStreetMap), con caché en DB.

No requiere API key. Nominatim pide un User-Agent identificable y respetar
un rate limit de ~1 request/segundo, así que sólo se consulta lo que no está
cacheado y se espera entre pedidos nuevos.
"""
from __future__ import annotations

import time
from datetime import datetime

import requests
from sqlalchemy.orm import Session

from .models import GeocodeCache

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "SuipachaLoader/1.0 (gestor de pedidos, uso interno)"
TIMEOUT = 8


def _normalizar(direccion: str) -> str:
    return " ".join((direccion or "").strip().lower().split())


def geocode(db: Session, direccion: str, ciudad_default: str = "") -> tuple[float, float] | None:
    """Devuelve (lat, lon) para la dirección, usando la caché si existe.

    Si nunca se pudo geocodificar, devuelve None (y eso también queda
    cacheado, para no reintentar sin parar una dirección inválida).
    """
    clave = _normalizar(direccion)
    if not clave:
        return None

    cacheada = db.get(GeocodeCache, clave)
    if cacheada is not None:
        return (cacheada.lat, cacheada.lon) if cacheada.lat is not None else None

    consulta = direccion.strip()
    if ciudad_default and ciudad_default.strip().lower() not in clave:
        consulta = f"{consulta}, {ciudad_default.strip()}"

    lat: float | None = None
    lon: float | None = None
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={"q": consulta, "format": "json", "limit": 1},
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        resultados = resp.json()
        if resultados:
            lat = float(resultados[0]["lat"])
            lon = float(resultados[0]["lon"])
    except (requests.RequestException, ValueError, KeyError):
        lat = lon = None

    db.add(GeocodeCache(direccion=clave, lat=lat, lon=lon, actualizado=datetime.now()))
    db.commit()
    # Respeta el rate limit de Nominatim sólo cuando hubo un request real.
    time.sleep(1)

    return (lat, lon) if lat is not None else None
