"""Tests unitarios de app/totales.py (sin BD: objetos en memoria)."""
from app.models import Pedido, PedidoItem
from app.totales import calcular_total, monto_descuento, monto_envio, subtotal_items


def _pedido(**kw) -> Pedido:
    items = kw.pop("items", [])
    p = Pedido(
        tipo=kw.pop("tipo", "Envío"),
        costo_envio=kw.pop("costo_envio", 0.0),
        no_cobrar_envio=kw.pop("no_cobrar_envio", False),
        descuento_tipo=kw.pop("descuento_tipo", None),
        descuento_valor=kw.pop("descuento_valor", 0.0),
        **kw,
    )
    p.items = [PedidoItem(nombre=n, cantidad=c, precio_unitario=pu) for n, c, pu in items]
    return p


def test_subtotal_suma_items():
    p = _pedido(items=[("Milanesa", 2, 10500), ("Coca", 1, 3000)])
    assert subtotal_items(p) == 24000


def test_envio_solo_para_tipo_envio():
    assert monto_envio(_pedido(tipo="Take away", costo_envio=3000)) == 0
    assert monto_envio(_pedido(tipo="Envío", costo_envio=3000, no_cobrar_envio=True)) == 0
    assert monto_envio(_pedido(tipo="Envío", costo_envio=3000)) == 3000


def test_envio_negativo_se_clampa():
    assert monto_envio(_pedido(tipo="Envío", costo_envio=-500)) == 0


def test_descuento_monto_y_porcentaje():
    p = _pedido(items=[("X", 1, 10000)], descuento_tipo="monto", descuento_valor=2000)
    assert monto_descuento(p) == 2000
    p = _pedido(items=[("X", 1, 10000)], descuento_tipo="porcentaje", descuento_valor=10)
    assert monto_descuento(p) == 1000


def test_descuento_negativo_no_aumenta_total():
    p = _pedido(items=[("X", 1, 10000)], descuento_tipo="monto", descuento_valor=-5000)
    assert monto_descuento(p) == 0
    assert calcular_total(p) == 10000


def test_porcentaje_mayor_a_cien_se_clampa():
    p = _pedido(items=[("X", 1, 10000)], descuento_tipo="porcentaje", descuento_valor=150)
    assert monto_descuento(p) == 10000


def test_descuento_monto_no_supera_subtotal():
    # El descuento come el subtotal pero nunca el envío.
    p = _pedido(
        tipo="Envío", costo_envio=3000,
        items=[("X", 1, 10000)], descuento_tipo="monto", descuento_valor=99999,
    )
    assert monto_descuento(p) == 10000
    assert calcular_total(p) == 3000


def test_total_nunca_negativo():
    p = _pedido(items=[], descuento_tipo="monto", descuento_valor=5000)
    assert calcular_total(p) == 0
