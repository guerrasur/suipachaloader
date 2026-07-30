"""Plato del día (por fecha): ahora admite más de un plato por día."""


def test_sin_definir_devuelve_vacio(client):
    r = client.get("/api/plato-del-dia?fecha=2026-01-05")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["definido"] is False
    assert body["hay"] is False
    assert body["items"] == []


def test_definir_varios_platos_del_dia(client):
    body = {
        "hay": True,
        "items": [
            {"nombre": "Milanesa con puré", "precio_efectivo": 5000, "precio_lista": 5500},
            {"nombre": "Tarta de verdura", "precio_efectivo": 4500, "precio_lista": 5000},
        ],
    }
    r = client.put("/api/plato-del-dia?fecha=2026-01-06", json=body)
    assert r.status_code == 200, r.text
    guardado = r.json()
    assert guardado["definido"] is True
    assert guardado["hay"] is True
    assert [i["nombre"] for i in guardado["items"]] == ["Milanesa con puré", "Tarta de verdura"]

    r = client.get("/api/plato-del-dia?fecha=2026-01-06")
    assert r.status_code == 200
    leido = r.json()
    assert len(leido["items"]) == 2
    assert leido["items"][0]["precio_efectivo"] == 5000


def test_items_con_nombre_vacio_se_descartan(client):
    body = {"hay": True, "items": [{"nombre": "  ", "precio_efectivo": 100, "precio_lista": 100}]}
    r = client.put("/api/plato-del-dia?fecha=2026-01-07", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


def test_marcar_sin_plato_del_dia_borra_los_items(client):
    fecha = "2026-01-08"
    client.put(
        "/api/plato-del-dia?fecha=" + fecha,
        json={"hay": True, "items": [{"nombre": "Milanesa", "precio_efectivo": 100, "precio_lista": 100}]},
    )
    r = client.put("/api/plato-del-dia?fecha=" + fecha, json={"hay": False, "items": []})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["hay"] is False
    assert body["items"] == []

    leido = client.get("/api/plato-del-dia?fecha=" + fecha).json()
    assert leido["items"] == []


def test_reemplazar_items_pisa_los_anteriores(client):
    fecha = "2026-01-09"
    client.put(
        "/api/plato-del-dia?fecha=" + fecha,
        json={"hay": True, "items": [{"nombre": "Milanesa", "precio_efectivo": 100, "precio_lista": 100}]},
    )
    r = client.put(
        "/api/plato-del-dia?fecha=" + fecha,
        json={"hay": True, "items": [{"nombre": "Tarta", "precio_efectivo": 200, "precio_lista": 200}]},
    )
    assert r.status_code == 200, r.text
    nombres = [i["nombre"] for i in r.json()["items"]]
    assert nombres == ["Tarta"]
