"""Borrado definitivo: sólo se permite sobre pedidos ya anulados."""
FECHA = "2030-05-20"


def _crear(client, **extra):
    body = {"fecha": FECHA, "cliente_nombre": "Test", "items": [], **extra}
    r = client.post("/api/pedidos", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_borrar_pedido_no_anulado_400(client):
    p = _crear(client)
    r = client.delete(f"/api/pedidos/{p['id']}")
    assert r.status_code == 400
    # Sigue existiendo (no se borró).
    assert any(x["id"] == p["id"] for x in client.get(f"/api/pedidos?fecha={FECHA}").json())


def test_borrar_pedido_anulado_204(client):
    p = _crear(client)
    assert client.post(f"/api/pedidos/{p['id']}/anular").status_code == 200
    r = client.delete(f"/api/pedidos/{p['id']}")
    assert r.status_code == 204
    assert all(x["id"] != p["id"] for x in client.get(f"/api/pedidos?fecha={FECHA}").json())


def test_borrar_inexistente_404(client):
    r = client.delete("/api/pedidos/999999")
    assert r.status_code == 404
