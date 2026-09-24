"""Optimización automática de rutas: regresiones del agrupado y el orden."""
from __future__ import annotations

from app.routing import agrupar_por_cercania, ordenar_ruta


def test_coordenadas_repetidas_no_hacen_desaparecer_grupos():
    puntos = [
        (-34.6037, -58.3816),
        (-34.6037, -58.3816),
        (-34.6037, -58.3816),
        (-34.6037, -58.3816),
    ]

    grupos = agrupar_por_cercania(puntos, 2)

    assert len(grupos) == 2
    assert all(grupos)
    assert sorted(i for grupo in grupos for i in grupo) == [0, 1, 2, 3]


def test_no_crea_mas_grupos_que_paradas():
    puntos = [(-34.60, -58.38), (-34.61, -58.39)]

    grupos = agrupar_por_cercania(puntos, 5)

    assert len(grupos) == 2
    assert sorted(i for grupo in grupos for i in grupo) == [0, 1]


def test_orden_exacto_evitar_zigzag_del_vecino_mas_cercano():
    # Con vecino más cercano puro, el empate inicial elige 0 y termina haciendo
    # un regreso largo desde el extremo norte hacia el este. El camino mínimo
    # abierto arranca por el punto 3 y después sube en línea.
    origen = (0.0, 0.0)
    puntos = [
        (0.0, 1.0),
        (0.0, 2.0),
        (0.0, 3.0),
        (1.0, 0.0),
    ]

    assert ordenar_ruta(origen, puntos) == [3, 0, 1, 2]


def test_sin_origen_no_depende_del_orden_de_entrada():
    puntos = [
        (-34.60, -58.40),
        (-34.61, -58.39),
        (-34.62, -58.38),
    ]

    orden = ordenar_ruta(None, puntos)

    assert sorted(orden) == [0, 1, 2]
    assert len(orden) == 3
