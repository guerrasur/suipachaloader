"""El orden confirmado viaja con el pedido y no se hereda a otra ruta."""
from datetime import date, timedelta

from sqlalchemy import create_engine, text

import app.main as main_mod


def _crear(client):
    r = client.post("/api/pedidos", json={"cliente_nombre": "Cliente ruta", "items": []})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_orden_confirmado_se_recupera_en_el_listado(client):
    ids = [_crear(client) for _ in range(3)]
    orden = [ids[2], ids[0], ids[1]]
    for posicion, pedido_id in enumerate(orden):
        r = client.patch(f"/api/pedidos/{pedido_id}", json={
            "repartidor": "Ana", "orden_ruta": posicion,
        })
        assert r.status_code == 200, r.text
        assert r.json()["orden_ruta"] == posicion
    # Una nueva consulta, como la que hace el frontend al recargar.
    pedidos = client.get("/api/pedidos").json()
    assert [p["id"] for p in sorted(pedidos, key=lambda p: p["orden_ruta"])] == orden
    # Editar datos ajenos al recorrido conserva la posición.
    r = client.patch(f"/api/pedidos/{ids[2]}", json={"notas": "Timbre"})
    assert r.json()["orden_ruta"] == 0


def test_otro_repartidor_o_fecha_no_hereda_orden(client):
    pedido_id = _crear(client)
    url = f"/api/pedidos/{pedido_id}"
    client.patch(url, json={"repartidor": "Ana", "orden_ruta": 2})
    assert client.patch(url, json={"repartidor": "Luis"}).json()["orden_ruta"] is None
    assert client.patch(url, json={"repartidor": "Ana", "orden_ruta": 0}).json()["orden_ruta"] == 0
    manana = (date.today() + timedelta(days=1)).isoformat()
    assert client.patch(url, json={"fecha": manana}).json()["orden_ruta"] is None
    assert client.patch(url, json={"orden_ruta": -1}).status_code == 422


def test_migracion_base_existente_es_idempotente(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE pedidos (id INTEGER PRIMARY KEY, cliente_nombre VARCHAR)"))
        conn.execute(text("INSERT INTO pedidos VALUES (1, 'Cliente existente')"))
    monkeypatch.setattr(main_mod, "engine", engine)
    main_mod._migrar_columnas()
    main_mod._migrar_columnas()
    with engine.connect() as conn:
        assert conn.execute(text("SELECT cliente_nombre, orden_ruta FROM pedidos")).one() == ("Cliente existente", None)
    engine.dispose()
