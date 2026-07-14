# Suipacha — Gestor de Pedidos

Aplicación web **local** (single-user) para reemplazar el anotado manual de
pedidos del local. Corre en la computadora del mostrador (`localhost`), guarda
todo en una base **SQLite** propia y exporta a un **Excel mensual** con una
hoja por día.

## Requisitos

- Python 3.10+

## Instalación y arranque

### Windows (recomendado en el mostrador)

Hacé **doble clic en `Iniciar_App.bat`** (en la raíz del proyecto). Ese archivo:

- Detecta Python (`python` o el lanzador `py`).
- La **primera vez** instala solo las dependencias (`requirements.txt`).
- Levanta el servidor y **abre el navegador automáticamente** en
  `http://127.0.0.1:8000/`.

Para cerrar la app, cerrá la ventana negra que queda abierta.

### Cualquier sistema (un solo comando)

```bash
pip install -r requirements.txt
python run.py
```

`run.py` levanta el servidor en `http://127.0.0.1:8000/` y abre el navegador
automáticamente. Al arrancar:

- Crea la base `data/carabelas.db` si no existe y siembra la Carta inicial.
- Hace un **backup automático** de la base en `backups/carabelas_<fecha>.db`
  (conserva los últimos 30, sin intervención manual).

## Qué hace

- **Carta:** catálogo de platos con **doble precio** (efectivo / lista),
  alta/baja/edición y **aumento masivo** (sumar $X a todos de una vez).
- **Carga rápida de pedido:** cliente con autocompletado (nombre — dirección),
  ítems con precio autocompletado según método de pago (editable), envío por
  defecto $3000 con toggle "no cobrar", descuento por cliente, **total siempre
  autocalculado** (ítems + envío − descuento).
- **Tabla del día** editable inline (repartidor, hora de salida, facturado,
  notas), filtros rápidos y navegación entre días.
- **Alertas de demora:** pedidos sin salir pasados X minutos y sin facturar
  después de la hora configurada; aviso de pendientes de días anteriores.
- **Pedidos para el día siguiente** (fecha futura) y **ventas de ventanilla**.
- **Anulación** de pedidos (nunca se borran; no suman ni alertan).
- **Resumen de caja** del día por método de pago.
- **Facturación de fin del día:** menú con la cantidad vendida de cada ítem
  (platos, ensaladas, bebidas) **más los envíos**, en una columna por método
  de pago (efectivo, transferencia, y QR / Posnet si se usaron). Así se
  facturan juntos todos los pedidos en efectivo y, por separado, los de
  transferencia.
- **Exportación a Excel** mensual (`Suipacha_Pedidos_-_<Mes>_<Año>.xlsx`),
  una hoja por día (`Suipacha- DDMM`), regenerable sin duplicar hojas.
- **Exportación de la hoja del día** (`Suipacha_DD-MM-AAAA.xlsx`): un archivo
  con solo la hoja de ese día, con el mismo nombre de hoja que en el mensual,
  para pegarla al final del día en el Excel que junta todos los días del mes.
- **Configuración** de todos los parámetros sin tocar código.

## Estructura

```
Iniciar_App.bat        # arranque en Windows (doble clic)
run.py                 # arranque en un comando (server + navegador)
app/
  main.py              # FastAPI + montaje del frontend
  database.py          # SQLite / SQLAlchemy
  models.py            # Cliente, Plato, Pedido, PedidoItem, Config
  schemas.py           # validación de entrada/salida
  totales.py           # cálculo del total (nunca manual)
  backup.py            # respaldo diario automático
  excel_export.py      # exportación mensual con openpyxl
  seed.py              # Carta inicial (derivada del ranking real)
  config.py            # parámetros configurables
  routers/             # endpoints REST
static/                # frontend (HTML + JS liviano)
data/                  # base SQLite (no versionada)
backups/               # respaldos automáticos (no versionados)
exports/               # Excel generados (no versionados)
```

## Notas

- Los precios sembrados en la Carta son **orientativos**: ajustalos desde la
  pantalla *Carta* con los valores reales del local.
- El Excel de referencia que se usó para el layout venía con celdas
  combinadas rotas (`H1:A1`); la exportación de esta app genera archivos
  limpios, sin fórmulas ni ese desorden.
