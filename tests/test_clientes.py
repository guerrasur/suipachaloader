"""Clientes: alta, edición y búsqueda (ilike) por nombre / dirección / teléfono."""


def _crear(client, **campos):
    body = {"nombre": "Sin nombre", **campos}
    r = client.post("/api/clientes", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_alta_y_edicion(client):
    c = _crear(client, nombre="Ana Pérez", direccion="Calle Falsa 123", telefono="1122334455")
    assert c["id"] > 0

    r = client.put(f"/api/clientes/{c['id']}", json={"nombre": "Ana P.", "direccion": "Calle Falsa 123"})
    assert r.status_code == 200
    assert r.json()["nombre"] == "Ana P."


def test_editar_inexistente_404(client):
    r = client.put("/api/clientes/999999", json={"nombre": "X"})
    assert r.status_code == 404


def test_busqueda_por_nombre_direccion_telefono(client):
    _crear(client, nombre="Carlos López", direccion="Av. Siempreviva 742", telefono="1199887766")
    _crear(client, nombre="Otro Cliente", direccion="Belgrano 100", telefono="1100000000")

    # Por nombre.
    r = client.get("/api/clientes?q=carlos").json()
    assert any(c["nombre"] == "Carlos López" for c in r)
    # Por dirección.
    r = client.get("/api/clientes?q=siempreviva").json()
    assert any(c["direccion"] == "Av. Siempreviva 742" for c in r)
    # Por teléfono.
    r = client.get("/api/clientes?q=9988").json()
    assert any(c["telefono"] == "1199887766" for c in r)


def test_busqueda_limita_a_20(client):
    for i in range(25):
        _crear(client, nombre=f"Masivo {i:02d}", direccion="Zona Test")
    r = client.get("/api/clientes?q=Zona Test").json()
    assert len(r) == 20


def test_agenda_lista_todos_y_borrado_no_altera_pedidos(client):
    for i in range(25):
        _crear(client, nombre=f"Cliente {i:02d}")
    original = _crear(client, nombre="Histórico", direccion="Calle 123")
    pedido = client.post("/api/pedidos", json={
        "cliente_nombre": "Histórico", "cliente_direccion": "Calle 123", "tipo": "Reserva",
    })
    assert pedido.status_code == 200, pedido.text

    agenda = client.get("/api/clientes/agenda")
    assert agenda.status_code == 200
    assert len(agenda.json()) == 26
    assert agenda.json()[0]["nombre"] == "Cliente 00"

    eliminado = client.delete(f"/api/clientes/{original['id']}")
    assert eliminado.status_code == 204
    assert len(client.get("/api/clientes/agenda").json()) == 25
    assert client.delete(f"/api/clientes/{original['id']}").status_code == 404
    assert any(p["id"] == pedido.json()["id"] and p["cliente_nombre"] == "Histórico"
               for p in client.get("/api/pedidos").json())
