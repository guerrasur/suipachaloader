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


def test_two_couriers_minimize_longest_complete_tour():
    rng = Random(4)
    matrix = [[0 if i == j else rng.randint(1, 100) for j in range(7)] for i in range(7)]
    groups = rc.distribute(matrix, [(0, i) for i in range(6)], 2)
    assert sorted(i for g in groups for i in g) == list(range(6))
    def score(gs):
        values = [rc.cost(matrix, g) for g in gs]
        return max(values), sum(values)
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
