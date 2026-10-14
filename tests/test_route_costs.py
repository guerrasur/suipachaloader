from itertools import permutations
from random import Random
from unittest.mock import Mock

import pytest
import requests

from app import route_costs as rc


def test_directed_closed_tours_match_bruteforce():
    rng = Random(42)
    for n in range(2, 7):
        matrix = [[0 if i == j else rng.randint(1, 300) for j in range(n + 1)] for i in range(n + 1)]
        result = rc.order(matrix)
        optimum = min(rc.cost(matrix, p) for p in permutations(range(n)))
        assert rc.cost(matrix, result) == optimum


def test_return_changes_order():
    # Open A->B is 2; its return costs 100. B->A->depot is only 6.
    matrix = [[0, 1, 3], [1, 0, 1], [100, 2, 0]]
    assert rc.order(matrix) == [1, 0]


def test_two_couriers_minimize_total_complete_travel():
    rng = Random(4)
    matrix = [[0 if i == j else rng.randint(1, 100) for j in range(7)] for i in range(7)]
    groups = rc.distribute(matrix, [(0, i) for i in range(6)], 2)
    assert sorted(i for g in groups for i in g) == list(range(6))
    def score(gs):
        values = [rc.cost(matrix, g) for g in gs]
        return sum(values), max(values)
    best = min(score([list(a), list(b)]) for mask in range(1, 63)
               for a in permutations([i for i in range(6) if mask & (1 << i)])
               for b in permutations([i for i in range(6) if not mask & (1 << i)]))
    assert score(groups) == best


def test_large_routes_keep_deliveries_and_improve_input():
    rng = Random(12)
    matrix = [[0 if i == j else rng.randint(1, 500) for j in range(15)] for i in range(15)]
    result = rc.order(matrix)
    assert sorted(result) == list(range(14))
    assert rc.cost(matrix, result) <= rc.cost(matrix, list(range(14)))


def test_street_coordinates_and_directed_matrix(monkeypatch):
    rc._street_table.cache_clear()
    get = Mock(return_value=Mock(json=lambda: {'code': 'Ok', 'durations': [[0, 5], [20, 0]]}))
    monkeypatch.setattr(rc.requests, 'get', get)
    matrix, criterion, warning = rc.travel_costs((-34.6, -58.4), [(-34.61, -58.41)])
    assert criterion == 'calles' and not warning
    assert matrix[0][1] == 5 and matrix[1][0] == 20
    assert '-58.400000,-34.600000;-58.410000,-34.610000' in get.call_args.args[0]
    rc.travel_costs((-34.6, -58.4), [(-34.61, -58.41)])
    assert get.call_count == 1
    rc._street_table.cache_clear()


@pytest.mark.parametrize('durations', [[[0, None], [5, 0]], [[0, -1], [2, 0]], [[0, float('nan')], [2, 0]], []])
def test_bad_matrix_falls_back_with_warning(monkeypatch, durations):
    rc._street_table.cache_clear()
    monkeypatch.setattr(rc.requests, 'get', lambda *a, **k: Mock(json=lambda: {'code': 'Ok', 'durations': durations}))
    matrix, criterion, warning = rc.travel_costs((0, 0), [(0, 1)])
    assert criterion == 'geografica' and warning
    assert matrix[0][1] > 0


def test_timeout_is_not_cached(monkeypatch):
    rc._street_table.cache_clear()
    get = Mock(side_effect=requests.Timeout)
    monkeypatch.setattr(rc.requests, 'get', get)
    for _ in range(2):
        assert rc.travel_costs((0, 0), [(1, 1)])[1] == 'geografica'
    assert get.call_count == 2


def test_missing_depot_warns():
    assert rc.travel_costs(None, [(0, 1)])[2]


def test_routes_endpoints_use_closed_street_tour(client, monkeypatch):
    from datetime import date
    import app.routers.rutas as endpoints
    from app.database import SessionLocal
    from app.models import RepartidorDia
    today = date.today()
    with SessionLocal() as db:
        db.add(RepartidorDia(fecha=today, nombre='Ana'))
        db.commit()
    ids = []
    for address in ['A 100', 'B 100']:
        response = client.post('/api/pedidos', json={'fecha': today.isoformat(), 'tipo': 'Envío',
            'cliente_nombre': address, 'cliente_direccion': address, 'repartidor': 'Ana', 'items': []})
        assert response.status_code == 200
        ids.append(response.json()['id'])
    monkeypatch.setattr(endpoints, 'geocode', lambda *a: (0, 0))
    monkeypatch.setattr(endpoints, 'travel_costs', lambda *a: ([[0, 1, 3], [1, 0, 1], [100, 2, 0]], 'calles', ''))
    result = client.get('/api/rutas').json()
    assert result['criterio'] == 'calles'
    assert [p['id'] for p in result['grupos'][0]['pedidos']] == ids[::-1]
    result = client.get('/api/rutas/repartidor?repartidor=Ana').json()
    assert [p['id'] for p in result['pedidos']] == ids[::-1]


@pytest.mark.parametrize('input_order', list(permutations(range(3))))
def test_suipacha_groups_rodriguez_pena_with_cerrito(monkeypatch, input_order):
    # Coordinates from the reported Maps route. Exercise the geographic fallback
    # without depending on OSRM availability or the order in which orders arrive.
    origin = (-34.6041469, -58.3794833)  # Suipacha 356
    addresses = [
        (-34.59368, -58.392243),      # Rodríguez Peña 1336
        (-34.6043188, -58.3712629),   # Sarmiento 310
        (-34.5959155, -58.3830489),   # Cerrito 1070
    ]
    monkeypatch.setattr(rc, '_street_table', Mock(side_effect=requests.Timeout))
    points = [addresses[i] for i in input_order]
    matrix, criterion, _ = rc.travel_costs(origin, points)
    assert criterion == 'geografica'
    groups = rc.distribute(matrix, points, 2)
    assert {frozenset(input_order[i] for i in g) for g in groups} == {
        frozenset({0, 2}), frozenset({1}),
    }


def test_directed_distribution_avoids_extra_travel_to_balance_couriers():
    # Depot, north-west, east, north. Balance alone selects NW | east+north
    # (20+19). Grouping NW+north | east is less total travel (21+10).
    matrix = [[0, 10, 5, 8], [10, 0, 15, 3], [5, 15, 0, 6], [8, 4, 7, 0]]
    groups = rc.distribute(matrix, [(0, i) for i in range(3)], 2)
    assert {frozenset(g) for g in groups} == {frozenset({0, 2}), frozenset({1})}
    assert sum(rc.cost(matrix, g) for g in groups) == 31


def test_more_couriers_improve_total_travel_without_losing_orders():
    rng = Random(8)
    matrix = [[0 if i == j else rng.randint(1, 100) for j in range(10)] for i in range(10)]
    points = [(0, i) for i in range(9)]
    initial = [rc.order(matrix, g) for g in rc.agrupar_por_cercania(points, 3)]
    groups = rc.distribute(matrix, points, 3)
    assert len(groups) == 3 and all(groups)
    assert sorted(i for g in groups for i in g) == list(range(9))
    assert sum(rc.cost(matrix, g) for g in groups) <= sum(rc.cost(matrix, g) for g in initial)
