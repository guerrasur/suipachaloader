"""Regresiones del geocoding usado por la optimización de rutas."""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import Mock, patch

import requests

from app.database import SessionLocal
from app.geocoding import NEGATIVE_CACHE_TTL, _consulta, _normalizar, geocode
from app.models import GeocodeCache

CIUDAD = "Ciudad Autónoma de Buenos Aires, Argentina"


def _respuesta(resultados):
    r = Mock()
    r.raise_for_status.return_value = None
    r.json.return_value = resultados
    return r


def test_timeout_no_se_cachea_como_direccion_invalida(client):
    direccion = "Lavalle 1268"
    clave = _normalizar(_consulta(direccion, CIUDAD))

    db = SessionLocal()
    try:
        with patch("app.geocoding.requests.get", side_effect=requests.Timeout), patch(
            "app.geocoding.time.sleep"
        ):
            assert geocode(db, direccion, CIUDAD) is None

        assert db.get(GeocodeCache, clave) is None
    finally:
        db.close()


def test_despues_de_timeout_puede_recuperarse(client):
    direccion = "Lavalle 1268"

    db = SessionLocal()
    try:
        with patch("app.geocoding.requests.get", side_effect=requests.Timeout), patch(
            "app.geocoding.time.sleep"
        ):
            assert geocode(db, direccion, CIUDAD) is None

        with patch(
            "app.geocoding.requests.get",
            return_value=_respuesta([{"lat": "-34.6037", "lon": "-58.3816"}]),
        ), patch("app.geocoding.time.sleep"):
            assert geocode(db, direccion, CIUDAD) == (-34.6037, -58.3816)
    finally:
        db.close()


def test_cache_negativa_vencida_se_reintenta(client):
    direccion = "Esmeralda 1080"
    clave = _normalizar(_consulta(direccion, CIUDAD))

    db = SessionLocal()
    try:
        db.add(
            GeocodeCache(
                direccion=clave,
                lat=None,
                lon=None,
                actualizado=datetime.now() - NEGATIVE_CACHE_TTL - timedelta(minutes=1),
            )
        )
        db.commit()

        with patch(
            "app.geocoding.requests.get",
            return_value=_respuesta([{"lat": "-34.595", "lon": "-58.378"}]),
        ) as get, patch("app.geocoding.time.sleep"):
            assert geocode(db, direccion, CIUDAD) == (-34.595, -58.378)

        assert get.call_count == 1
    finally:
        db.close()


def test_cache_incluye_la_ciudad(client):
    direccion = "San Martín 100"

    db = SessionLocal()
    try:
        with patch(
            "app.geocoding.requests.get",
            side_effect=[
                _respuesta([{"lat": "-34.60", "lon": "-58.38"}]),
                _respuesta([{"lat": "-31.42", "lon": "-64.18"}]),
            ],
        ) as get, patch("app.geocoding.time.sleep"):
            assert geocode(db, direccion, "Buenos Aires, Argentina") == (-34.60, -58.38)
            assert geocode(db, direccion, "Córdoba, Argentina") == (-31.42, -64.18)

        assert get.call_count == 2
    finally:
        db.close()
