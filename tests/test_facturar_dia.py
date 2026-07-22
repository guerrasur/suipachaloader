"""facturar-dia: cierre masivo, con y sin filtro por método de pago."""
FECHA = "2030-06-10"


def _crear(client, metodo="Efectivo", **extra):
    body = {
        "fecha": FECHA,
        "cliente_nombre": "Test",
        "metodo_pago": metodo,
        "items": [{"nombre": "Milanesa", "cantidad": 1, "precio_unitario": 10000}],
        **extra,
    }
    r = client.post("/api/pedidos", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _facturados(client):
    return {p["id"]: p["facturado"] for p in client.get(f"/api/pedidos?fecha={FECHA}").json()}


def test_facturar_dia_filtra_por_metodo(client):
    ef = _crear(client, "Efectivo")
    tr = _crear(client, "Transferencia")

    r = client.post(f"/api/pedidos/facturar-dia?fecha={FECHA}&metodo_pago=Efectivo").json()
    assert r["facturados"] == 1

    estado = _facturados(client)
    assert estado[ef["id"]] is True
    assert estado[tr["id"]] is False  # el de transferencia no se tocó


def test_facturar_dia_sin_filtro_factura_todos_los_validos(client):
    a = _crear(client, "Efectivo")
    b = _crear(client, "Transferencia")
    anulado = _crear(client, "QR")
    client.post(f"/api/pedidos/{anulado['id']}/anular")

    r = client.post(f"/api/pedidos/facturar-dia?fecha={FECHA}").json()
    assert r["facturados"] == 2  # el anulado no cuenta

    estado = _facturados(client)
    assert estado[a["id"]] is True
    assert estado[b["id"]] is True
    assert estado[anulado["id"]] is False
