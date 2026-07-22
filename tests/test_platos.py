"""Carta: alta/edición/baja lógica, aumento masivo y fijado de precios.

Regresión clave: el aumento masivo NO debe tocar el "Plato del día" (precio
manual), igual que set-precios.
"""


def _platos(client, incluir_inactivos=False):
    url = "/api/platos"
    if incluir_inactivos:
        url += "?incluir_inactivos=true"
    r = client.get(url)
    assert r.status_code == 200, r.text
    return r.json()


def _por_nombre(client, nombre, incluir_inactivos=True):
    for p in _platos(client, incluir_inactivos):
        if p["nombre"] == nombre:
            return p
    return None


def test_crear_editar_dar_de_baja(client):
    r = client.post("/api/platos", json={"nombre": "Tarta", "categoria": "Varios",
                                         "precio_efectivo": 5000, "precio_lista": 6000})
    assert r.status_code == 200, r.text
    plato = r.json()
    assert plato["activo"] is True

    r = client.put(f"/api/platos/{plato['id']}", json={"nombre": "Tarta de verdura",
                    "categoria": "Varios", "precio_efectivo": 5500, "precio_lista": 6000})
    assert r.status_code == 200
    assert r.json()["nombre"] == "Tarta de verdura"

    # Baja lógica: no se borra, queda inactivo y desaparece del listado normal.
    r = client.delete(f"/api/platos/{plato['id']}")
    assert r.status_code == 200
    assert _por_nombre(client, "Tarta de verdura", incluir_inactivos=False) is None
    assert _por_nombre(client, "Tarta de verdura", incluir_inactivos=True)["activo"] is False


def test_editar_plato_inexistente_404(client):
    r = client.put("/api/platos/999999", json={"nombre": "X"})
    assert r.status_code == 404


def test_aumentar_no_toca_plato_del_dia(client):
    # El seed incluye "Plato del día" (precio 0) y platos normales.
    pdd_antes = _por_nombre(client, "Plato del día")
    assert pdd_antes is not None and pdd_antes["es_plato_del_dia"] is True
    normal_antes = _por_nombre(client, "Caesar")
    assert normal_antes is not None

    r = client.post("/api/platos/aumentar", json={"monto": 1000})
    assert r.status_code == 200, r.text

    pdd_despues = _por_nombre(client, "Plato del día")
    normal_despues = _por_nombre(client, "Caesar")
    # El plato del día conserva su precio manual...
    assert pdd_despues["precio_efectivo"] == pdd_antes["precio_efectivo"]
    assert pdd_despues["precio_lista"] == pdd_antes["precio_lista"]
    # ...y los normales sí suben.
    assert normal_despues["precio_efectivo"] == normal_antes["precio_efectivo"] + 1000
    assert normal_despues["precio_lista"] == normal_antes["precio_lista"] + 1000


def test_set_precios_excluye_plato_del_dia(client):
    pdd_antes = _por_nombre(client, "Plato del día")

    r = client.post("/api/platos/set-precios", json={"precio_efectivo": 12345})
    assert r.status_code == 200, r.text

    assert _por_nombre(client, "Caesar")["precio_efectivo"] == 12345
    # El plato del día no se toca.
    assert _por_nombre(client, "Plato del día")["precio_efectivo"] == pdd_antes["precio_efectivo"]


def test_set_precios_sin_ningun_precio_400(client):
    r = client.post("/api/platos/set-precios", json={})
    assert r.status_code == 400
