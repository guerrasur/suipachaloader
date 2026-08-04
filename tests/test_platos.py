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


def test_borrar_definitivo_requiere_baja_previa(client):
    r = client.post("/api/platos", json={"nombre": "Sopa", "categoria": "Varios",
                                         "precio_efectivo": 1000, "precio_lista": 1200})
    plato = r.json()

    # Todavía activo: no se puede borrar definitivamente.
    r = client.delete(f"/api/platos/{plato['id']}/definitivo")
    assert r.status_code == 400

    client.delete(f"/api/platos/{plato['id']}")  # baja lógica
    r = client.delete(f"/api/platos/{plato['id']}/definitivo")
    assert r.status_code == 204
    assert _por_nombre(client, "Sopa", incluir_inactivos=True) is None


def test_borrar_definitivo_inexistente_404(client):
    r = client.delete("/api/platos/999999/definitivo")
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


def test_aumentar_solo_los_ids_elegidos(client):
    elegido_antes = _por_nombre(client, "Caesar")
    otro_antes = _por_nombre(client, "Brie")
    assert elegido_antes is not None and otro_antes is not None

    r = client.post(
        "/api/platos/aumentar", json={"monto": 1000, "ids": [elegido_antes["id"]]}
    )
    assert r.status_code == 200, r.text
    assert r.json()["actualizados"] == 1

    assert _por_nombre(client, "Caesar")["precio_efectivo"] == elegido_antes["precio_efectivo"] + 1000
    assert _por_nombre(client, "Caesar")["precio_lista"] == elegido_antes["precio_lista"] + 1000
    # El que no fue elegido queda igual.
    assert _por_nombre(client, "Brie")["precio_efectivo"] == otro_antes["precio_efectivo"]


def test_set_precios_solo_los_ids_elegidos(client):
    elegido = _por_nombre(client, "Caesar")
    otro_antes = _por_nombre(client, "Brie")

    r = client.post(
        "/api/platos/set-precios",
        json={"precio_efectivo": 9999, "ids": [elegido["id"]]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["actualizados"] == 1

    assert _por_nombre(client, "Caesar")["precio_efectivo"] == 9999
    assert _por_nombre(client, "Brie")["precio_efectivo"] == otro_antes["precio_efectivo"]


def test_ids_explicitos_alcanzan_al_plato_del_dia(client):
    """Elegir a mano el "Plato del día" sí lo cambia: la exclusión automática
    es para el modo "todos", no para lo que el usuario tildó expresamente."""
    pdd = _por_nombre(client, "Plato del día")

    r = client.post("/api/platos/set-precios", json={"precio_efectivo": 7777, "ids": [pdd["id"]]})
    assert r.status_code == 200, r.text
    assert r.json()["actualizados"] == 1
    assert _por_nombre(client, "Plato del día")["precio_efectivo"] == 7777


def test_ids_vacio_no_actualiza_nada(client):
    """Una lista vacía nunca puede interpretarse como "todos"."""
    antes = _por_nombre(client, "Caesar")

    r = client.post("/api/platos/aumentar", json={"monto": 1000, "ids": []})
    assert r.status_code == 200, r.text
    assert r.json()["actualizados"] == 0
    assert _por_nombre(client, "Caesar")["precio_efectivo"] == antes["precio_efectivo"]
