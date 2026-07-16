"""Cálculo de totales de un pedido. El total NUNCA se tipea a mano."""
from __future__ import annotations

from .models import Pedido


def subtotal_items(pedido: Pedido) -> float:
    return sum(i.cantidad * i.precio_unitario for i in pedido.items)


def monto_envio(pedido: Pedido) -> float:
    if pedido.tipo != "Envío" or pedido.no_cobrar_envio:
        return 0.0
    return max(0.0, pedido.costo_envio or 0.0)


def monto_descuento(pedido: Pedido, base: float | None = None) -> float:
    """Descuento aplicado sobre el subtotal de ítems (no sobre el envío).

    Clampea acá también (además de los schemas) porque la BD puede traer
    valores viejos sin validar: negativo → 0, porcentaje tope 100, y un
    descuento por monto nunca supera el subtotal (el envío se cobra siempre).
    """
    valor = max(0.0, pedido.descuento_valor or 0.0)
    if not pedido.descuento_tipo or not valor:
        return 0.0
    if base is None:
        base = subtotal_items(pedido)
    if pedido.descuento_tipo == "porcentaje":
        return round(base * min(valor, 100.0) / 100.0, 2)
    return min(float(valor), base)


def calcular_total(pedido: Pedido) -> float:
    sub = subtotal_items(pedido)
    total = sub + monto_envio(pedido) - monto_descuento(pedido, sub)
    return round(max(total, 0.0), 2)
