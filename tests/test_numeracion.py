"""Números de pedido: secuencia visible, sin repeticiones tras borrar."""
FECHA = "2030-01-15"


def _crear(client, **extra):
    body = {"fecha": FECHA, "cliente_nombre": "Test", "items": [], **extra}
    r = client.post("/api/pedidos", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_secuencia_visible(client):
    nums = [_crear(client)["numero"] for _ in range(4)]
    assert nums == [10, 47, 84, 31]


def test_borrar_no_repite_numeros_vivos(client):
    p1 = _crear(client)   # 10
    p2 = _crear(client)   # 47
    p3 = _crear(client)   # 84
    # Anular y borrar definitivamente el del medio.
    assert client.post(f"/api/pedidos/{p2['id']}/anular").status_code == 200
    assert client.delete(f"/api/pedidos/{p2['id']}").status_code == 204
    nuevo = _crear(client)
    # Los números de pedidos vivos jamás se repiten.
    assert nuevo["numero"] not in {p1["numero"], p3["numero"]}


def test_dias_independientes(client):
    a = _crear(client)
    b = _crear(client, fecha="2030-01-16")
    assert a["numero"] == b["numero"] == 10


def test_overflow_pasa_de_90_pedidos(client):
    numeros = [_crear(client)["numero"] for _ in range(92)]
    assert len(set(numeros)) == 92          # nunca se repite en el día
    assert set(numeros[:90]) == set(range(10, 100))
    assert numeros[90:] == [100, 101]
