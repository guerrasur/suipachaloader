"""Pedidos con salida programada: espera, demora y rutas."""
from __future__ import annotations

from datetime import date, datetime, timedelta

import app.routers.rutas as rutas_mod
from app.database import SessionLocal
from app.models import Config, Pedido, RepartidorDia


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


def test_salida_programada_no_entra_en_demora_ni_rutas_hasta_la_hora(client, monkeypatch):
    hoy = date.today()
    ahora = datetime.now()
    futuro = ahora + timedelta(hours=2)

    db = SessionLocal()
    try:
        cfg = db.get(Config, "minutos_demora_salida")
        if cfg is None:
            cfg = Config(clave="minutos_demora_salida", valor="30")
            db.add(cfg)
        else:
            cfg.valor = "30"
        db.add(RepartidorDia(fecha=hoy, nombre="Repartidor Test"))
        db.commit()
    finally:
        db.close()

    creado = client.post(
        "/api/pedidos",
        json={
            "fecha": hoy.isoformat(),
            "tipo": "Envío",
            "cliente_nombre": "Programado",
            "cliente_direccion": "Suipacha 100",
            "items": [],
            "hora_salida_programada": _iso(futuro),
        },
    )
    assert creado.status_code == 200, creado.text
    pedido_id = creado.json()["id"]

    db = SessionLocal()
    try:
        p = db.get(Pedido, pedido_id)
        p.hora_pedido = ahora - timedelta(hours=3)
        db.commit()
    finally:
        db.close()

    listado = client.get(f"/api/pedidos?fecha={hoy.isoformat()}").json()
    p = next(x for x in listado if x["id"] == pedido_id)
    assert p["esperando_hora_salida"] is True
    assert p["demorado"] is False
    assert p["alerta_sin_facturar"] is False

    r = client.get(f"/api/rutas?fecha={hoy.isoformat()}")
    assert r.status_code == 200, r.text
    assert r.json()["grupos"] == []

    reciente = datetime.now() - timedelta(minutes=5)
    r = client.patch(
        f"/api/pedidos/{pedido_id}",
        json={"hora_salida_programada": _iso(reciente)},
    )
    assert r.status_code == 200, r.text
    assert r.json()["esperando_hora_salida"] is False
    assert r.json()["demorado"] is False

    monkeypatch.setattr(rutas_mod, "geocode", lambda *args, **kwargs: (-34.6037, -58.3816))
    r = client.get(f"/api/rutas?fecha={hoy.isoformat()}")
    assert r.status_code == 200, r.text
    ids = [p["id"] for g in r.json()["grupos"] for p in g["pedidos"]]
    assert pedido_id in ids

    vieja = datetime.now() - timedelta(minutes=40)
    r = client.patch(
        f"/api/pedidos/{pedido_id}",
        json={"hora_salida_programada": _iso(vieja)},
    )
    assert r.status_code == 200, r.text
    assert r.json()["demorado"] is True
