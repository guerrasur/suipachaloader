"""Geocoding de direcciones vía Nominatim (OpenStreetMap), con caché en DB.

No requiere API key. Nominatim pide un User-Agent identificable y respetar
aprox. 1 request/segundo. Sólo se consulta lo que no está cacheado.

Los errores de red/HTTP NO se guardan como "dirección inválida": antes un
timeout podía dejar una dirección válida cacheada como None para siempre y
romper toda optimización futura de esa parada.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta

import requests
from sqlalchemy.orm import Session

from .models import GeocodeCache
from .routing import direccion_para_maps

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "SuipachaLoader/1.0 (gestor de pedidos, uso interno)"
TIMEOUT = 8
NEGATIVE_CACHE_TTL = timedelta(hours=6)


def _normalizar(direccion: str) -> str:
    return " ".join((direccion or "").strip().lower().split())


def _consulta(direccion: str, ciudad_default: str) -> str:
    # Reutiliza exactamente la misma limpieza que los links de Maps: evita
    # mandar piso/depto pegado a la altura y agrega la ciudad de forma idempotente.
    return direccion_para_maps(direccion, ciudad_default)


def geocode(db: Session, direccion: str, ciudad_default: str = "") -> tuple[float, float] | None:
    """Devuelve (lat, lon) para la dirección, usando caché si existe.

    La clave de caché incluye la ciudad ya normalizada. Esto evita reutilizar
    una coordenada obtenida para otra ciudad cuando cambia `ciudad_default`.

    Los "sin resultados" reales se cachean sólo por unas horas; los fallos de
    red, timeout, rate-limit o respuesta inválida no se cachean.
    """
    consulta = _consulta(direccion, ciudad_default)
    clave = _normalizar(consulta)
    if not clave:
        return None

    cacheada = db.get(GeocodeCache, clave)
    if cacheada is not None:
        if cacheada.lat is not None and cacheada.lon is not None:
            return (cacheada.lat, cacheada.lon)

        actualizado = cacheada.actualizado or datetime.min
        if datetime.now() - actualizado < NEGATIVE_CACHE_TTL:
            return None

    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={
                "q": consulta,
                "format": "json",
                "limit": 1,
                "addressdetails": 0,
            },
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        resultados = resp.json()
    except (requests.RequestException, ValueError):
        # Fue un fallo transitorio o una respuesta inválida. No contaminar la
        # caché: al próximo intento se consulta de nuevo.
        time.sleep(1)
        return None

    lat: float | None = None
    lon: float | None = None
    try:
        if resultados:
            lat = float(resultados[0]["lat"])
            lon = float(resultados[0]["lon"])
    except (TypeError, ValueError, KeyError, IndexError):
        # JSON válido pero formato inesperado: tampoco lo tratamos como una
        # dirección definitivamente inexistente.
        time.sleep(1)
        return None

    ahora = datetime.now()
    if cacheada is None:
        cacheada = GeocodeCache(
            direccion=clave,
            lat=lat,
            lon=lon,
            actualizado=ahora,
        )
        db.add(cacheada)
    else:
        cacheada.lat = lat
        cacheada.lon = lon
        cacheada.actualizado = ahora

    db.commit()
    # Respeta el rate limit de Nominatim sólo cuando hubo un request real.
    time.sleep(1)

    return (lat, lon) if lat is not None and lon is not None else None
