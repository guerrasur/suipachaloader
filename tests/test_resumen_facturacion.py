"""Resumen de caja y facturación: bucketing por método de pago."""
FECHA = "2030-03-05"


def _crear(client, metodo, total_item, tipo="Take away", **extra):
    body = {
        "fecha": FECHA,
        "cliente_nombre": "Test",
        "tipo": tipo,
        "metodo_pago": metodo,
        "items": [{"nombre": "Milanesa", "cantidad": 1, "precio_unitario": total_item}],
        **extra,
    }
    r = client.post("/api/pedidos", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_resumen_por_metodo(client):
    _crear(client, "Efectivo", 10000)
    _crear(client, "Efectivo", 5000)
    _crear(client, "QR", 8000)
    anulado = _crear(client, "Transferencia", 99999)
    client.post(f"/api/pedidos/{anulado['id']}/anular")

    r = client.get(f"/api/resumen?fecha={FECHA}").json()
    assert r["cantidad"] == 3
    assert r["total"] == 23000
    assert r["por_metodo"]["Efectivo"] == 15000
    assert r["por_metodo"]["QR"] == 8000
    assert r["por_metodo"]["Transferencia"] == 0  # el anulado no suma


def test_facturacion_items_y_envios(client):
    _crear(client, "Efectivo", 10000, tipo="Envío", costo_envio=3000)
    _crear(client, "Efectivo", 10000)
    _crear(client, "Transferencia", 12000)

    r = client.get(f"/api/facturacion?fecha={FECHA}").json()
    assert r["metodos"] == ["Efectivo", "Transferencia"]
    ef = r["por_metodo"]["Efectivo"]
    assert ef["pedidos"] == 2
    assert ef["envios"] == 1
    assert ef["items"] == [{"nombre": "Milanesa", "cantidad": 2}]
    assert ef["total"] == 23000
    assert r["por_metodo"]["Transferencia"]["total"] == 12000
