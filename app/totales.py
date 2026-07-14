"""Cálculo de totales de un pedido. El total NUNCA se tipea a mano."""
from __future__ import annotations

from .models import Pedido


def subtotal_items(pedido: Pedido) -> float:
    return sum(i.cantidad * i.precio_unitario for i in pedido.items)


def monto_envio(pedido: Pedido) -> float:
    if pedido.tipo != "Envío" or pedido.no_cobrar_envio:
        return 0.0
    return pedido.costo_envio or 0.0


def monto_descuento(pedido: Pedido, base: float | None = None) -> float:
    """Descuento aplicado sobre el subtotal de ítems (no sobre el envío)."""
    if not pedido.descuento_tipo or not pedido.descuento_valor:
        return 0.0
    if base is None:
        base = subtotal_items(pedido)
    if pedido.descuento_tipo == "porcentaje":
        return round(base * pedido.descuento_valor / 100.0, 2)
    return float(pedido.descuento_valor)


def calcular_total(pedido: Pedido) -> float:
    sub = subtotal_items(pedido)
    total = sub + monto_envio(pedido) - monto_descuento(pedido, sub)
    return round(max(total, 0.0), 2)
