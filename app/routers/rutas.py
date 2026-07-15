"""Optimización de rutas de envío: agrupa los pedidos del día por cercanía
entre los repartidores disponibles y arma links de Google Maps para cada
grupo."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import config as cfg
from ..database import get_db
from ..geocoding import geocode
from ..models import Pedido, RepartidorDia
from ..routing import agrupar_por_cercania, google_maps_route_link, ordenar_ruta

router = APIRouter(prefix="/api/rutas", tags=["rutas"])


@router.get("")
def optimizar(fecha: date | None = None, db: Session = Depends(get_db)):
    fecha = fecha or date.today()

    repartidores = (
        db.query(RepartidorDia)
        .filter(RepartidorDia.fecha == fecha)
        .order_by(RepartidorDia.id)
        .all()
    )
    nombres = [r.nombre for r in repartidores]
    if not nombres:
        raise HTTPException(400, "Cargá primero los repartidores del día.")

    pedidos = (
        db.query(Pedido)
        .filter(
            Pedido.fecha == fecha,
            Pedido.tipo == "Envío",
            Pedido.anulado.is_(False),
            Pedido.hora_salida.is_(None),
        )
        .order_by(Pedido.hora_pedido)
        .all()
    )
    if not pedidos:
        return {"fecha": fecha.isoformat(), "repartidores_dia": nombres, "grupos": [], "sin_geocodificar": []}

    ciudad_default = cfg.get_value(db, "ciudad_default")
    direccion_local = cfg.get_value(db, "direccion_local")

    ubicados: list[Pedido] = []
    coords: list[tuple[float, float]] = []
    sin_geocodificar: list[Pedido] = []
    for p in pedidos:
        punto = geocode(db, p.cliente_direccion, ciudad_default)
        if punto is None:
            sin_geocodificar.append(p)
        else:
            ubicados.append(p)
            coords.append(punto)

    origen = geocode(db, direccion_local, ciudad_default) if direccion_local else None

    grupos_idx = agrupar_por_cercania(coords, len(nombres))

    grupos = []
    for i, idxs in enumerate(grupos_idx):
        etiqueta = chr(ord("A") + i)
        puntos_grupo = [coords[j] for j in idxs]
        orden_local = ordenar_ruta(origen, puntos_grupo)
        pedidos_en_orden = [ubicados[idxs[k]] for k in orden_local]
        direcciones = [p.cliente_direccion for p in pedidos_en_orden]
        grupos.append({
            "etiqueta": etiqueta,
            "pedidos": [
                {"id": p.id, "numero": p.numero, "cliente_nombre": p.cliente_nombre,
                 "cliente_direccion": p.cliente_direccion, "cliente_telefono": p.cliente_telefono}
                for p in pedidos_en_orden
            ],
            "maps_link": google_maps_route_link(direccion_local, direcciones),
        })

    return {
        "fecha": fecha.isoformat(),
        "repartidores_dia": nombres,
        "grupos": grupos,
        "sin_geocodificar": [
            {"id": p.id, "numero": p.numero, "cliente_nombre": p.cliente_nombre,
             "cliente_direccion": p.cliente_direccion}
            for p in sin_geocodificar
        ],
    }
