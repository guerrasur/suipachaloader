"""Agrupado de puntos por cercanía y armado de links de Google Maps.

Pensado para volúmenes chicos (pocos pedidos, 1-2 repartidores por día), así
que alcanza con un k-means simple y un recorrido por vecino más cercano —no
hace falta un solver de ruteo.
"""
from __future__ import annotations

import math
from urllib.parse import quote

Punto = tuple[float, float]  # (lat, lon)


def _dist(a: Punto, b: Punto) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def agrupar_por_cercania(puntos: list[Punto], k: int) -> list[list[int]]:
    """K-means sobre lat/lon. Devuelve, por grupo, los índices de `puntos`.

    Determinístico: los centroides iniciales son los k puntos más separados
    entre sí (en vez de al azar), así el resultado no cambia entre llamadas
    con los mismos pedidos.
    """
    n = len(puntos)
    k = max(1, min(k, n))
    if n == 0:
        return []
    if k == 1:
        return [list(range(n))]

    # Centroides iniciales: arrancar del primer punto y sumar siempre el más
    # lejano a los ya elegidos (maximiza la separación inicial).
    elegidos = [0]
    while len(elegidos) < k:
        candidato = max(
            range(n),
            key=lambda i: min(_dist(puntos[i], puntos[c]) for c in elegidos),
        )
        elegidos.append(candidato)
    centroides = [puntos[i] for i in elegidos]

    asignacion = [0] * n
    for _ in range(20):
        cambio = False
        for i, p in enumerate(puntos):
            mejor = min(range(k), key=lambda c: _dist(p, centroides[c]))
            if asignacion[i] != mejor:
                asignacion[i] = mejor
                cambio = True
        for c in range(k):
            miembros = [puntos[i] for i in range(n) if asignacion[i] == c]
            if miembros:
                centroides[c] = (
                    sum(p[0] for p in miembros) / len(miembros),
                    sum(p[1] for p in miembros) / len(miembros),
                )
        if not cambio:
            break

    grupos: list[list[int]] = [[] for _ in range(k)]
    for i, c in enumerate(asignacion):
        grupos[c].append(i)
    return [g for g in grupos if g]


def ordenar_ruta(origen: Punto | None, puntos: list[Punto]) -> list[int]:
    """Orden de recorrido (índices de `puntos`) por vecino más cercano."""
    n = len(puntos)
    if n <= 1:
        return list(range(n))

    restantes = set(range(n))
    actual = origen
    orden: list[int] = []
    while restantes:
        if actual is None:
            siguiente = next(iter(restantes))
        else:
            siguiente = min(restantes, key=lambda i: _dist(actual, puntos[i]))
        orden.append(siguiente)
        restantes.discard(siguiente)
        actual = puntos[siguiente]
    return orden


def google_maps_route_link(origen: str, direcciones_en_orden: list[str]) -> str:
    """Link de Google Maps con ruta multi-parada, sin necesitar API key."""
    if not direcciones_en_orden:
        return ""
    destino = quote(direcciones_en_orden[-1])
    partes = [f"https://www.google.com/maps/dir/?api=1&destination={destino}&travelmode=driving"]
    if origen:
        partes.append(f"&origin={quote(origen)}")
    intermedias = direcciones_en_orden[:-1]
    if intermedias:
        waypoints = "|".join(quote(d) for d in intermedias)
        partes.append(f"&waypoints={waypoints}")
    return "".join(partes)


def google_maps_search_link(direccion: str) -> str:
    """Link de búsqueda de una sola dirección, sin geocoding ni API key."""
    return f"https://www.google.com/maps/search/?api=1&query={quote(direccion or '')}"
