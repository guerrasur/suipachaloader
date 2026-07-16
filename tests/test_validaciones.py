"""Validaciones de entrada: el PATCH ya no acepta valores fuera de catálogo."""
FECHA = "2030-02-10"


def _crear(client, **extra):
    body = {"fecha": FECHA, "cliente_nombre": "Test", "items": [], **extra}
    r = client.post("/api/pedidos", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_patch_tipo_invalido(client):
    p = _crear(client)
    r = client.patch(f"/api/pedidos/{p['id']}", json={"tipo": "Cualquiera"})
    assert r.status_code == 422


def test_patch_metodo_pago_invalido(client):
    p = _crear(client)
    r = client.patch(f"/api/pedidos/{p['id']}", json={"metodo_pago": "Bitcoin"})
    assert r.status_code == 422


def test_patch_valido_sigue_funcionando(client):
    p = _crear(client)
    r = client.patch(f"/api/pedidos/{p['id']}", json={"metodo_pago": "QR", "pagado": True})
    assert r.status_code == 200
    assert r.json()["metodo_pago"] == "QR"


def test_descuento_negativo_no_infla_total(client):
    p = _crear(
        client,
        tipo="Take away",
        items=[{"nombre": "Milanesa", "cantidad": 1, "precio_unitario": 10000}],
        descuento_tipo="monto",
        descuento_valor=-500,
    )
    assert p["total"] == 10000


def test_porcentaje_mayor_a_cien(client):
    p = _crear(
        client,
        tipo="Take away",
        items=[{"nombre": "Milanesa", "cantidad": 1, "precio_unitario": 10000}],
        descuento_tipo="porcentaje",
        descuento_valor=150,
    )
    assert p["total"] == 0


def test_costo_envio_negativo(client):
    p = _crear(
        client,
        tipo="Envío",
        costo_envio=-3000,
        items=[{"nombre": "Milanesa", "cantidad": 1, "precio_unitario": 10000}],
    )
    assert p["total"] == 10000
