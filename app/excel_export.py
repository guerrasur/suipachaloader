"""Exportación a Excel mensual con openpyxl.

- Un archivo por mes: ``Suipacha_Pedidos_-_<Mes>_<Año>.xlsx``.
- Una hoja por día, nombrada ``Suipacha- DDMM``.
- Si la hoja del día ya existe se **regenera completa** desde la BD (se borra
  y se reescribe), nunca se duplica ni se parchea.
- Los pedidos anulados aparecen marcados como ``ANULADO`` y no suman.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session

from .database import BASE_DIR
from .models import Pedido
from .totales import monto_envio

EXPORT_DIR = BASE_DIR / "exports"

MESES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
    "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

COLUMNAS = [
    ("Hora", 8), ("Tipo", 11), ("Cliente", 20), ("Dirección", 24),
    ("Ítems", 40), ("Envío", 10), ("Descuento", 11), ("Total", 12),
    ("Pago", 14), ("Detalle pago", 14), ("Repartidor", 14),
    ("Hora salida", 12), ("Facturado", 11), ("Notas", 20),
]

_HEADER_FILL = PatternFill("solid", fgColor="2F5496")
_HEADER_FONT = Font(bold=True, color="FFFFFF")
_TITLE_FONT = Font(bold=True, size=14)
_SUM_FONT = Font(bold=True)
_ANULADO_FONT = Font(color="9C9C9C", italic=True, strike=True)
_THIN = Side(style="thin", color="D0D0D0")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
_MONEY = '#,##0'


def nombre_archivo(anio: int, mes: int) -> str:
    return f"Suipacha_Pedidos_-_{MESES[mes]}_{anio}.xlsx"


def nombre_hoja(d: date) -> str:
    return f"Suipacha- {d.strftime('%d%m')}"


def nombre_archivo_dia(d: date) -> str:
    return f"Suipacha_{d.strftime('%d-%m-%Y')}.xlsx"


def _items_texto(p: Pedido) -> str:
    return "\n".join(f"{i.cantidad}x {i.nombre}" for i in p.items)


def exportar_mes(db: Session, anio: int, mes: int) -> Path:
    """Genera/actualiza el archivo del mes. Devuelve la ruta al .xlsx."""
    EXPORT_DIR.mkdir(exist_ok=True)
    ruta = EXPORT_DIR / nombre_archivo(anio, mes)

    if ruta.exists():
        wb = load_workbook(ruta)
    else:
        wb = Workbook()
        wb.remove(wb.active)  # sacamos la hoja vacía por defecto

    # Días del mes con pedidos, ordenados.
    pedidos = (
        db.query(Pedido)
        .filter(Pedido.fecha >= date(anio, mes, 1))
        .filter(Pedido.fecha < (date(anio + (mes == 12), (mes % 12) + 1, 1)))
        .order_by(Pedido.fecha, Pedido.hora_pedido)
        .all()
    )
    por_dia: dict[date, list[Pedido]] = {}
    for p in pedidos:
        por_dia.setdefault(p.fecha, []).append(p)

    for d in sorted(por_dia):
        _regenerar_hoja(wb, d, por_dia[d])

    # Ordenar las hojas por fecha para que queden prolijas.
    wb._sheets.sort(key=lambda ws: ws.title)
    wb.save(ruta)
    return ruta


def exportar_dia(db: Session, d: date) -> Path:
    """Genera un archivo con SOLO la hoja de ese día (misma hoja que en el
    mensual, ``Suipacha- DDMM``). Sirve para cargar/pegar esa hoja al final
    del día dentro del Excel del mes que junta todos los días."""
    EXPORT_DIR.mkdir(exist_ok=True)
    ruta = EXPORT_DIR / nombre_archivo_dia(d)

    pedidos = (
        db.query(Pedido)
        .filter(Pedido.fecha == d)
        .order_by(Pedido.hora_pedido)
        .all()
    )

    wb = Workbook()
    wb.remove(wb.active)  # sacamos la hoja vacía por defecto
    _regenerar_hoja(wb, d, pedidos)
    wb.save(ruta)
    return ruta


def _regenerar_hoja(wb: Workbook, d: date, pedidos: list[Pedido]) -> None:
    titulo = nombre_hoja(d)
    if titulo in wb.sheetnames:
        del wb[titulo]  # borrar y reescribir: nunca parchear
    ws = wb.create_sheet(titulo)

    # Anchos de columna.
    for idx, (_, ancho) in enumerate(COLUMNAS, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = ancho

    # Título.
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(COLUMNAS))
    tcell = ws.cell(row=1, column=1, value=f"Suipacha — Pedidos {d.strftime('%d/%m/%Y')}")
    tcell.font = _TITLE_FONT

    # Encabezados.
    hrow = 2
    for idx, (nombre, _) in enumerate(COLUMNAS, start=1):
        c = ws.cell(row=hrow, column=idx, value=nombre)
        c.fill = _HEADER_FILL
        c.font = _HEADER_FONT
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = _BORDER

    # Filas de pedidos.
    r = hrow + 1
    tot_dia = 0.0
    por_metodo: dict[str, float] = {}
    n_validos = 0
    for p in pedidos:
        hora = p.hora_pedido.strftime("%H:%M") if p.hora_pedido else ""
        salida = p.hora_salida.strftime("%H:%M") if p.hora_salida else ""
        envio = monto_envio(p)
        desc = _monto_descuento_export(p)
        fila = [
            hora, p.tipo, p.cliente_nombre, p.cliente_direccion,
            _items_texto(p), envio or "", desc or "", p.total,
            p.metodo_pago, p.pago_efectivo_detalle, p.repartidor,
            salida, "Sí" if p.facturado else "No",
            ("ANULADO — " + p.notas) if p.anulado else p.notas,
        ]
        for idx, val in enumerate(fila, start=1):
            c = ws.cell(row=r, column=idx, value=val)
            c.border = _BORDER
            c.alignment = Alignment(vertical="top", wrap_text=(idx in (5, 14)))
            if idx in (6, 7, 8):  # envío / descuento / total
                c.number_format = _MONEY
            if p.anulado:
                c.font = _ANULADO_FONT
        if not p.anulado:
            tot_dia += p.total
            por_metodo[p.metodo_pago] = por_metodo.get(p.metodo_pago, 0.0) + p.total
            n_validos += 1
        r += 1

    # Sumarios al pie.
    r += 1
    _sumario(ws, r, "Cantidad de pedidos", n_validos, money=False)
    r += 1
    _sumario(ws, r, "TOTAL DEL DÍA", tot_dia)
    for metodo in ("Efectivo", "Transferencia", "QR", "Posnet"):
        r += 1
        _sumario(ws, r, f"  {metodo}", por_metodo.get(metodo, 0.0))

    ws.freeze_panes = "A3"


def _sumario(ws, row, etiqueta, valor, money=True):
    ec = ws.cell(row=row, column=1, value=etiqueta)
    ec.font = _SUM_FONT
    vc = ws.cell(row=row, column=8, value=valor)
    vc.font = _SUM_FONT
    if money:
        vc.number_format = _MONEY


def _monto_descuento_export(p: Pedido) -> float:
    if not p.descuento_tipo or not p.descuento_valor:
        return 0.0
    sub = sum(i.cantidad * i.precio_unitario for i in p.items)
    if p.descuento_tipo == "porcentaje":
        return round(sub * p.descuento_valor / 100.0, 2)
    return float(p.descuento_valor)
