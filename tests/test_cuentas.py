"""Saldo por unidades prepagadas y cierre semanal independiente de la caja."""


def _cuenta(client, tipo="platos"):
    cliente = client.post("/api/clientes", json={"nombre": "Cliente cuenta"}).json()
    r = client.post("/api/cuentas", json={"cliente_id": cliente["id"], "tipo": tipo})
    assert r.status_code == 200, r.text
    return cliente, r.json()["id"]


def test_platos_prepagos_retiros_y_correcciones(client):
    cliente, cid = _cuenta(client)
    assert client.delete(f"/api/clientes/{cliente['id']}").status_code == 409
    carga = client.post(f"/api/cuentas/{cid}/movimientos", json={
        "tipo": "carga", "cantidad": 6, "fecha": "2026-09-20", "nota": "Pagó en Bistro",
    })
    assert carga.status_code == 200
    assert carga.json()["saldo"] == 6
    retiro = client.post(f"/api/cuentas/{cid}/movimientos", json={
        "tipo": "retiro", "cantidad": 2, "fecha": "2026-09-22", "plato": "Tarta",
    })
    assert retiro.json()["saldo"] == 4
    detalle = client.get(f"/api/cuentas/{cid}").json()
    assert detalle["saldo"] == 4
    assert detalle["movimientos"][0]["plato"] == "Tarta"
    assert client.get("/api/cuentas").json()[0]["valor"] == 4
    assert client.post(f"/api/cuentas/{cid}/movimientos", json={
        "tipo": "retiro", "cantidad": 5, "plato": "Sopa",
    }).status_code == 409
    assert client.post(f"/api/cuentas/{cid}/movimientos", json={
        "tipo": "retiro", "cantidad": 1, "plato": "  ",
    }).status_code == 422
    assert client.delete(f"/api/cuentas/{cid}/movimientos/{carga.json()['id']}").status_code == 409
    assert client.delete(f"/api/cuentas/{cid}/movimientos/{retiro.json()['id']}").status_code == 204
    assert client.get(f"/api/cuentas/{cid}").json()["saldo"] == 6


def test_cuenta_semanal_extras_cierre_y_cobro(client):
    cliente, cid = _cuenta(client, "semanal")
    assert client.post("/api/cuentas", json={"cliente_id": cliente["id"], "tipo": "platos"}).status_code == 409
    primero = client.post(f"/api/cuentas/{cid}/pedidos", json={
        "fecha": "2026-09-21", "nota": "Tres almuerzos",
        "items": [{"plato": "Milanesa", "cantidad": 2, "precio_unitario": 10000,
                   "extra": "Huevo", "precio_extra": 1500},
                  {"plato": "Ensalada", "cantidad": 1, "precio_unitario": 8000}],
    })
    assert primero.status_code == 200, primero.text
    assert primero.json()["total"] == 31000
    segundo = client.post(f"/api/cuentas/{cid}/pedidos", json={
        "fecha": "2026-09-29", "items": [{"plato": "Tarta", "cantidad": 1, "precio_unitario": 9000}],
    })
    assert segundo.status_code == 200
    assert client.get(f"/api/cuentas/{cid}").json()["pendiente"] == 40000
    assert client.get("/api/cuentas").json()[0]["valor"] == 40000
    cierre = client.post(f"/api/cuentas/{cid}/cierres", json={"hasta": "2026-09-25"})
    assert cierre.status_code == 200, cierre.text
    assert cierre.json()["total"] == 31000
    detalle = client.get(f"/api/cuentas/{cid}").json()
    assert detalle["pendiente"] == 9000
    assert detalle["por_cobrar"] == 31000
    assert detalle["saldo"] == 40000  # facturar todavía no es cobrar
    assert client.get("/api/cuentas").json()[0]["valor"] == 40000
    assert detalle["pedidos"][1]["items"][0]["extra"] == "Huevo"
    assert client.delete(f"/api/cuentas/{cid}/pedidos/{primero.json()['id']}").status_code == 409
    assert client.post(f"/api/cuentas/{cid}/cierres", json={"hasta": "2026-09-25"}).status_code == 409
    assert client.post(f"/api/cuentas/{cid}/cierres/{cierre.json()['id']}/pagado").json()["pagado"]
    assert client.get(f"/api/cuentas/{cid}").json()["cierres"][0]["pagado"]
    assert client.get(f"/api/cuentas/{cid}").json()["saldo"] == 9000
    assert client.get("/api/pedidos?fecha=2026-09-21").json() == []
    assert client.delete(f"/api/cuentas/{cid}/pedidos/{segundo.json()['id']}").status_code == 204
    assert client.get(f"/api/cuentas/{cid}").json()["pendiente"] == 0
    assert client.get(f"/api/cuentas/{cid}").json()["saldo"] == 0


def test_cobrar_todos_cierres_pendientes(client):
    _, cid = _cuenta(client, "semanal")
    for fecha, monto in [("2026-09-21", 5000), ("2026-09-28", 7000)]:
        assert client.post(f"/api/cuentas/{cid}/pedidos", json={
            "fecha": fecha, "items": [{"plato": "Menú", "cantidad": 1, "precio_unitario": monto}],
        }).status_code == 200
        assert client.post(f"/api/cuentas/{cid}/cierres", json={"hasta": fecha}).status_code == 200
    assert client.get(f"/api/cuentas/{cid}").json()["saldo"] == 12000
    pago = client.post(f"/api/cuentas/{cid}/cierres/cobrar-todos")
    assert pago.status_code == 200
    assert pago.json() == {"cierres": 2, "total": 12000}
    assert client.get(f"/api/cuentas/{cid}").json()["saldo"] == 0
    assert client.get("/api/cuentas").json()[0]["valor"] == 0
    assert client.post(f"/api/cuentas/{cid}/cierres/cobrar-todos").status_code == 409
