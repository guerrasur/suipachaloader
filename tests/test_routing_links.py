"""Links de Google Maps: que la altura llegue entera y con ciudad.

El bug que motivó estos tests: una repartidora fue a "Lavalle 126" siguiendo un
link armado para "Lavalle 1268". Acá se verifica el round-trip completo de la
dirección (se decodifica la query y se compara), así que si algún día se pierde
un dígito en el camino, salta en la suite y no en la calle.
"""
from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from app.routing import (
    direccion_para_maps,
    google_maps_route_link,
    google_maps_search_link,
)

CIUDAD = "Ciudad Autónoma de Buenos Aires, Argentina"


def _query(link: str) -> str:
    """La dirección tal como la recibe Google, ya decodificada."""
    return parse_qs(urlparse(link).query)["query"][0]


def _destino(link: str) -> str:
    return parse_qs(urlparse(link).query)["destination"][0]


def _waypoints(link: str) -> list[str]:
    return parse_qs(urlparse(link).query)["waypoints"][0].split("|")


# --- la altura llega entera --------------------------------------------------
def test_altura_no_se_trunca():
    assert _query(google_maps_search_link("Lavalle 1268")) == "Lavalle 1268"


def test_altura_no_se_trunca_con_ciudad():
    assert _query(google_maps_search_link("Lavalle 1268", CIUDAD)) == f"Lavalle 1268, {CIUDAD}"


def test_altura_entera_en_el_link_crudo():
    # Chequeo literal sobre la URL: el %20 no puede cortar el último dígito.
    assert "Lavalle%201268" in google_maps_search_link("Lavalle 1268")


def test_alturas_de_todos_los_largos():
    for altura in ("1", "12", "126", "1268", "12680"):
        assert _query(google_maps_search_link(f"Lavalle {altura}")) == f"Lavalle {altura}"


# --- unidad pegada al final --------------------------------------------------
def test_saca_el_piso_pegado_a_la_altura():
    # "Lavalle 1268 7mo" hace que Google reinterprete la altura.
    assert _query(google_maps_search_link("Lavalle 1268 7mo")) == "Lavalle 1268"


def test_saca_el_depto_pegado_a_la_altura():
    assert _query(google_maps_search_link("Juana Manso 555 4D")) == "Juana Manso 555"


def test_no_toca_una_direccion_sin_unidad():
    assert direccion_para_maps("Alicia Moreau de Justo 1720") == "Alicia Moreau de Justo 1720"


def test_no_confunde_una_calle_con_numero_con_una_unidad():
    assert direccion_para_maps("25 de Mayo 359") == "25 de Mayo 359"


# --- ciudad ------------------------------------------------------------------
def test_agrega_la_ciudad():
    assert direccion_para_maps("Esmeralda 1080", CIUDAD) == f"Esmeralda 1080, {CIUDAD}"


def test_no_duplica_la_ciudad_si_ya_viene():
    dir_con_ciudad = f"Esmeralda 1080, {CIUDAD}"
    assert direccion_para_maps(dir_con_ciudad, CIUDAD) == dir_con_ciudad


def test_sin_ciudad_configurada_no_cambia_la_direccion():
    assert direccion_para_maps("Esmeralda 1080", "") == "Esmeralda 1080"


def test_normaliza_espacios():
    assert direccion_para_maps("  Lavalle   1268  ") == "Lavalle 1268"


def test_direccion_vacia():
    assert direccion_para_maps("", CIUDAD) == ""
    assert google_maps_search_link("").endswith("query=")


# --- ruta multi-parada -------------------------------------------------------
def test_ruta_conserva_cada_altura_y_agrega_ciudad():
    link = google_maps_route_link(
        "Suipacha 100",
        ["Lavalle 1268", "Esmeralda 1080", "Paraguay 1536"],
        CIUDAD,
    )
    assert _waypoints(link) == [f"Lavalle 1268, {CIUDAD}", f"Esmeralda 1080, {CIUDAD}"]
    assert _destino(link) == f"Paraguay 1536, {CIUDAD}"
    assert parse_qs(urlparse(link).query)["origin"][0] == f"Suipacha 100, {CIUDAD}"


def test_ruta_de_una_sola_parada_no_lleva_waypoints():
    link = google_maps_route_link("", ["Lavalle 1268"], CIUDAD)
    assert "waypoints" not in link
    assert _destino(link) == f"Lavalle 1268, {CIUDAD}"


def test_ruta_sin_paradas():
    assert google_maps_route_link("Suipacha 100", [], CIUDAD) == ""
