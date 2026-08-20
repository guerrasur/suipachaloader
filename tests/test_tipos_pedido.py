"""Tipos de pedido: solo quedan "Envío" y "Reserva".

"Take away" y "Ventanilla" se sacaron del catálogo; los pedidos históricos
con esos tipos se migran a "Reserva" al arrancar.
"""
from datetime import date

import app.main as main_mod
from app.database import SessionLocal
from app.models import Pedido

FECHA = "2030-03-11"


def test_tipos_viejos_rechazados(client):
    for tipo in ("Take away", "Ventanilla"):
        r = client.post(
            "/api/pedidos",
            json={"fecha": FECHA, "cliente_nombre": "Test", "tipo": tipo, "items": []},
        )
        assert r.status_code == 422, tipo


def test_tipos_vigentes_aceptados(client):
    for tipo in ("Envío", "Reserva"):
        r = client.post(
            "/api/pedidos",
            json={"fecha": FECHA, "cliente_nombre": "Test", "tipo": tipo, "items": []},
        )
        assert r.status_code == 200, r.text
        assert r.json()["tipo"] == tipo


def test_migracion_pasa_tipos_viejos_a_reserva(client):
    db = SessionLocal()
    try:
        for tipo in ("Take away", "Ventanilla", "Envío"):
            db.add(Pedido(fecha=date(2030, 3, 11), tipo=tipo, cliente_nombre="Viejo"))
        db.commit()
    finally:
        db.close()

    main_mod._migrar_tipos_pedido()

    db = SessionLocal()
    try:
        tipos = sorted(p.tipo for p in db.query(Pedido).all())
    finally:
        db.close()
    assert tipos == ["Envío", "Reserva", "Reserva"]
