"""Agrupado de puntos por cercanía y armado de links de Google Maps.

Pensado para volúmenes chicos (pocos pedidos, 1-2 repartidores por día). La
optimización se mantiene liviana y determinística, pero evita dos problemas del
algoritmo original: grupos vacíos con coordenadas repetidas y recorridos
claramente mejorables por usar sólo vecino más cercano.
"""
from __future__ import annotations

import math
import re
from urllib.parse import quote

Punto = tuple[float, float]  # (lat, lon)

_RADIO_TIERRA_KM = 6371.0088


def _dist(a: Punto, b: Punto) -> float:
    """Distancia haversine en km.

    Usar grados con math.hypot deformaba las distancias este-oeste (la longitud
    no equivale a la latitud salvo en el ecuador). Para CABA la diferencia es
    suficiente para alterar empates y agrupados cercanos.
    """
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * _RADIO_TIERRA_KM * math.asin(min(1.0, math.sqrt(h)))


def agrupar_por_cercania(puntos: list[Punto], k: int) -> list[list[int]]:
    """K-means determinístico sobre lat/lon.

    Devuelve, por grupo, los índices de `puntos`. Los centroides iniciales se
    eligen por máxima separación y cada uno queda anclado a su grupo. Ese
    anclaje es importante cuando dos o más pedidos tienen exactamente la misma
    coordenada: sin él, dos centroides idénticos podían hacer que un grupo
    quedara vacío y se generaran menos rutas que repartidores.
    """
    n = len(puntos)
    if n == 0:
        return []

    k = max(1, min(k, n))
    if k == 1:
        return [list(range(n))]
    if k == n:
        return [[i] for i in range(n)]

    # Centroides iniciales: arrancar del primer punto y sumar siempre el punto
    # no elegido más lejano a los ya elegidos. El desempate por índice mantiene
    # el resultado estable entre ejecuciones.
    elegidos = [0]
    while len(elegidos) < k:
        candidatos = [i for i in range(n) if i not in elegidos]
        candidato = max(
            candidatos,
            key=lambda i: (
                min(_dist(puntos[i], puntos[c]) for c in elegidos),
                -i,
            ),
        )
        elegidos.append(candidato)

    centroides = [puntos[i] for i in elegidos]
    anclas = {indice: grupo for grupo, indice in enumerate(elegidos)}
    asignacion = [-1] * n

    for _ in range(30):
        nueva: list[int] = []
        for i, p in enumerate(puntos):
            if i in anclas:
                mejor = anclas[i]
            else:
                mejor = min(
                    range(k),
                    key=lambda c: (_dist(p, centroides[c]), c),
                )
            nueva.append(mejor)

        if nueva == asignacion:
            break
        asignacion = nueva

        for c in range(k):
            miembros = [puntos[i] for i in range(n) if asignacion[i] == c]
            # Siempre hay al menos el punto ancla del grupo.
            centroides[c] = (
                sum(p[0] for p in miembros) / len(miembros),
                sum(p[1] for p in miembros) / len(miembros),
            )

    grupos: list[list[int]] = [[] for _ in range(k)]
    for i, c in enumerate(asignacion):
        grupos[c].append(i)
    return grupos


def _longitud_ruta(origen: Punto | None, puntos: list[Punto], orden: list[int]) -> float:
    total = 0.0
    actual = origen
    for i in orden:
        if actual is not None:
            total += _dist(actual, puntos[i])
        actual = puntos[i]
    return total


def _vecino_mas_cercano(origen: Punto | None, puntos: list[Punto], inicio: int | None = None) -> list[int]:
    restantes = set(range(len(puntos)))
    orden: list[int] = []

    if inicio is not None:
        orden.append(inicio)
        restantes.remove(inicio)
        actual: Punto | None = puntos[inicio]
    else:
        actual = origen

    while restantes:
        if actual is None:
            siguiente = min(restantes)
        else:
            siguiente = min(
                restantes,
                key=lambda i: (_dist(actual, puntos[i]), i),
            )
        orden.append(siguiente)
        restantes.remove(siguiente)
        actual = puntos[siguiente]

    return orden


def _mejorar_2opt(origen: Punto | None, puntos: list[Punto], orden: list[int]) -> list[int]:
    """Mejora una ruta abierta con 2-opt hasta un mínimo local.

    Con pocos pedidos el costo es despreciable y elimina muchos zigzags que el
    vecino más cercano deja atrás. No obliga a volver al local al final.
    """
    if len(orden) < 3:
        return orden

    mejor = list(orden)
    mejor_dist = _longitud_ruta(origen, puntos, mejor)
    mejoro = True

    while mejoro:
        mejoro = False
        for i in range(len(mejor) - 1):
            for j in range(i + 1, len(mejor)):
                candidato = mejor[:i] + list(reversed(mejor[i : j + 1])) + mejor[j + 1 :]
                distancia = _longitud_ruta(origen, puntos, candidato)
                if distancia + 1e-9 < mejor_dist:
                    mejor = candidato
                    mejor_dist = distancia
                    mejoro = True
                    break
            if mejoro:
                break

    return mejor


def ordenar_ruta(origen: Punto | None, puntos: list[Punto]) -> list[int]:
    """Orden de recorrido (índices de `puntos`) optimizado para una ruta abierta.

    Parte de vecino más cercano y aplica 2-opt. Si no hay origen configurado,
    prueba cada parada como inicio para no depender del orden en que llegaron
    los pedidos.
    """
    n = len(puntos)
    if n <= 1:
        return list(range(n))

    if origen is not None:
        inicial = _vecino_mas_cercano(origen, puntos)
        return _mejorar_2opt(origen, puntos, inicial)

    candidatos: list[list[int]] = []
    for inicio in range(n):
        inicial = _vecino_mas_cercano(None, puntos, inicio=inicio)
        candidatos.append(_mejorar_2opt(None, puntos, inicial))

    return min(
        candidatos,
        key=lambda orden: (_longitud_ruta(None, puntos, orden), tuple(orden)),
    )


# Unidad (piso/depto) pegada al final de una calle+altura: "Lavalle 1268 7mo",
# "Juana Manso 555 4D". Google la lee como parte de la altura y termina
# ubicando otra cuadra, así que no va en el link. Mismo criterio que
# `_separarUnidad` en static/app.js (ver comentario espejo allá).
_UNIDAD_FINAL = re.compile(
    r"^(.*?\d{1,5})\s+(?:[0-9]{1,3}[a-zA-Z]{1,2}|[a-zA-Z]{1,2}[0-9]{1,3})$"
)


def direccion_para_maps(direccion: str, ciudad: str = "") -> str:
    """Dirección tal como se le manda a Google Maps.

    Normaliza espacios, saca la unidad pegada al final y agrega la ciudad si no
    viene incluida. La ciudad es lo que evita que "Lavalle 1268" a secas caiga
    en cualquier Lavalle del mundo; es el mismo agregado que hace el geocoding.
    """
    limpia = " ".join((direccion or "").split())
    if not limpia:
        return ""
    m = _UNIDAD_FINAL.match(limpia)
    if m:
        limpia = m.group(1).strip()
    ciudad = " ".join((ciudad or "").split())
    if ciudad and ciudad.lower() not in limpia.lower():
        limpia = f"{limpia}, {ciudad}"
    return limpia


def google_maps_route_link(origen: str, direcciones_en_orden: list[str], ciudad: str = "") -> str:
    """Link de Google Maps con ruta multi-parada, sin necesitar API key."""
    if not direcciones_en_orden:
        return ""
    paradas = [direccion_para_maps(d, ciudad) for d in direcciones_en_orden]
    destino = quote(paradas[-1], safe="")
    partes = [f"https://www.google.com/maps/dir/?api=1&destination={destino}&travelmode=driving"]
    if origen:
        partes.append(f"&origin={quote(direccion_para_maps(origen, ciudad), safe='')}")
    intermedias = paradas[:-1]
    if intermedias:
        waypoints = "|".join(quote(d, safe="") for d in intermedias)
        partes.append(f"&waypoints={waypoints}")
    return "".join(partes)


def google_maps_search_link(direccion: str, ciudad: str = "") -> str:
    """Link de búsqueda de una sola dirección, sin geocoding ni API key."""
    return (
        "https://www.google.com/maps/search/?api=1&query="
        + quote(direccion_para_maps(direccion, ciudad), safe="")
    )
