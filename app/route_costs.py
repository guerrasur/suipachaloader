"""Closed delivery tours using directed street travel times (OSRM)."""
from __future__ import annotations

import math
import time
from functools import lru_cache

import requests

from .routing import _dist, agrupar_por_cercania


@lru_cache(maxsize=32)
def _street_table(points: tuple, hour: int) -> tuple:
    coordinates = ';'.join(f'{lon:.6f},{lat:.6f}' for lat, lon in points)
    response = requests.get(
        f'https://router.project-osrm.org/table/v1/driving/{coordinates}',
        params={'annotations': 'duration'}, timeout=(4, 12),
        headers={'User-Agent': 'SuipachaLoader/1.18.6'},
    )
    response.raise_for_status()
    data = response.json()
    table = data.get('durations')
    n = len(points)
    if data.get('code') != 'Ok' or not isinstance(table, list) or len(table) != n:
        raise ValueError('Invalid street matrix')
    for row in table:
        if not isinstance(row, list) or len(row) != n:
            raise ValueError('Invalid street matrix row')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in row):
            raise ValueError('Unreachable or invalid street segment')
    # Reject coordinates snapped far away from their requested street.
    for name in ('sources', 'destinations'):
        for waypoint in data.get(name, []):
            if waypoint.get('distance', 0) > 300:
                raise ValueError('Street too far from address')
    return tuple(tuple(float(v) for v in row) for row in table)


def travel_costs(origin, points):
    """Matrix node 0 = depot; nodes 1..n = deliveries. Never mix units."""
    all_points = ([origin] if origin is not None else [None]) + list(points)
    if origin is not None and points:
        try:
            return _street_table(tuple(all_points), int(time.time() // 3600)), 'calles', ''
        except (requests.RequestException, ValueError, TypeError, KeyError):
            warning = 'No se pudieron consultar las calles. Recorrido aproximado por distancia geográfica.'
    else:
        warning = 'No se pudo ubicar el local. Configurá o revisá su dirección para calcular salida y regreso.'
    matrix = [[0.0 if a is None or b is None else _dist(a, b) for b in all_points] for a in all_points]
    return matrix, 'geografica', warning


def cost(matrix, route):
    nodes = [0] + [i + 1 for i in route] + [0]
    return sum(matrix[a][b] for a, b in zip(nodes, nodes[1:]))


def exact_tours(matrix):
    """Held-Karp for every subset, including the last edge back to depot."""
    n = len(matrix) - 1
    states = {}
    tours = {0: (0.0, ())}
    for mask in range(1, 1 << n):
        for last in range(n):
            bit = 1 << last
            if not mask & bit:
                continue
            previous = mask ^ bit
            if not previous:
                states[mask, last] = (matrix[0][last + 1], (last,))
            else:
                states[mask, last] = min(
                    (states[previous, j][0] + matrix[j + 1][last + 1], states[previous, j][1] + (last,))
                    for j in range(n) if previous & (1 << j)
                )
        tours[mask] = min(
            (states[mask, j][0] + matrix[j + 1][0], states[mask, j][1])
            for j in range(n) if mask & (1 << j)
        )
    return tours


def order(matrix, indices=None):
    indices = list(range(len(matrix) - 1)) if indices is None else list(indices)
    if len(indices) <= 1:
        return indices
    if len(indices) <= 12:
        nodes = [0] + [i + 1 for i in indices]
        small = [[matrix[a][b] for b in nodes] for a in nodes]
        result = exact_tours(small)[(1 << len(indices)) - 1][1]
        return [indices[i] for i in result]
    # Several starting points plus reversal and relocation. Full cost evaluation
    # handles one-way streets; symmetric 2-opt edge formulas would be incorrect.
    candidates = [indices]
    for first in sorted(indices, key=lambda i: (matrix[0][i + 1], i))[:8]:
        remaining = set(indices) - {first}
        route = [first]
        while remaining:
            nxt = min(remaining, key=lambda i: (matrix[route[-1] + 1][i + 1], i))
            remaining.remove(nxt)
            route.append(nxt)
        candidates.append(route)
    best = min(candidates, key=lambda r: (cost(matrix, r), tuple(r)))
    for _ in range(30):
        improved = best
        best_cost = cost(matrix, best)
        for i in range(len(best)):
            for j in range(i + 1, len(best)):
                candidate = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                value = cost(matrix, candidate)
                if value < best_cost - 1e-9:
                    improved, best_cost = candidate, value
        if improved == best:
            break
        best = improved
    return best


def distribute(matrix, points, k):
    """Minimize longest tour, then total travel; keep every courier nonempty."""
    n = len(points)
    k = min(max(1, k), n)
    if not n:
        return []
    if k == 1:
        return [order(matrix)]
    if k == n:
        return [[i] for i in range(n)]
    if k == 2 and n <= 12:
        tours = exact_tours(matrix)
        full = (1 << n) - 1
        def score(mask):
            a, b = tours[mask][0], tours[full ^ mask][0]
            return max(a, b), a + b, mask
        mask = min((m for m in range(1, full) if m & 1), key=score)
        return [list(tours[mask][1]), list(tours[full ^ mask][1])]
    groups = [order(matrix, g) for g in agrupar_por_cercania(points, k)]
    cache = {}
    def route(items):
        key = tuple(sorted(items))
        if key not in cache:
            cache[key] = order(matrix, key)
        return cache[key]
    def score(gs):
        values = [cost(matrix, g) for g in gs]
        return max(values), sum(values)
    for _ in range(12):
        best, best_score = groups, score(groups)
        for a in range(k):
            for b in range(a + 1, k):
                variants = []
                if len(groups[a]) > 1:
                    variants.extend(([i for i in groups[a] if i != x], groups[b] + [x]) for x in groups[a])
                if len(groups[b]) > 1:
                    variants.extend((groups[a] + [x], [i for i in groups[b] if i != x]) for x in groups[b])
                variants.extend(([i for i in groups[a] if i != x] + [y], [i for i in groups[b] if i != y] + [x]) for x in groups[a] for y in groups[b])
                for ga, gb in variants:
                    candidate = list(groups)
                    candidate[a], candidate[b] = route(ga), route(gb)
                    value = score(candidate)
                    if value < best_score:
                        best, best_score = candidate, value
        if best is groups:
            break
        groups = best
    return groups
