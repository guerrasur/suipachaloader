# Suipacha Loader

Gestor de pedidos local (single-user) para el mostrador del local. FastAPI +
SQLite en el backend, HTML/JS liviano sin build step en el frontend. Ver
`README.md` para la descripción funcional completa; esto es lo que hace falta
para trabajar en el código.

## Arrancar y probar

```bash
pip install -r requirements.txt -r requirements-dev.txt
python run.py                 # server + navegador en http://127.0.0.1:8000/
python -m pytest -q           # suite de tests (app/ y tests/)
```

No hay build de frontend: `static/*.js|html|css` se sirven tal cual, se
recarga con F5.

## Estructura

- `app/main.py` — FastAPI, migraciones idempotentes de columnas/índices al
  arrancar, monta `static/`.
- `app/routers/` — endpoints REST por dominio (`pedidos`, `clientes`,
  `platos`, `rutas`, `meta`).
- `app/totales.py` — cálculo del total del pedido (única fuente de verdad;
  nunca se recalcula a mano en otro lado).
- `app/database.py`, `app/models.py`, `app/schemas.py` — SQLAlchemy + Pydantic.
- `app/backup.py` — backup diario automático de la base.
- `app/excel_export.py` — exportación a Excel (mensual y del día).
- `static/app.js` — todo el frontend en un solo archivo (sin framework).
- Los datos (SQLite, `backups/`, `exports/`) viven **fuera** del repo, en
  `%LOCALAPPDATA%\SuipachaLoader` o `~/.suipachaloader`. Nunca se tocan al
  actualizar ni se commitean.

## VERSION y el actualizador — importante, fuente común de bugs

`updater.py` corre antes de cada arranque (`iniciar_app.bat`) y compara el
archivo `VERSION` local contra `VERSION` en `main` de GitHub
(`_version_local()` vs `_version_remota()` en `updater.py`). Si son iguales,
**no actualiza nada**, aunque `main` tenga commits nuevos.

Consecuencia práctica: **todo merge a `main` que deba llegarle al usuario
tiene que venir acompañado de un bump de `VERSION`.** Si se olvida, el código
queda en GitHub pero la app instalada nunca lo baja — el síntoma es "hice el
cambio pero no se actualiza", y no es un bug del updater, es un PR incompleto.
Esto ya pasó una vez en este repo (PR #23 sin bump, corregido en el #24).

Convención de versión: `MAJOR.MINOR.PATCH` a mano (no semver estricto),
bump en el mismo commit/PR que el cambio, con el número reflejado en el
título del commit (`vX.Y.Z: descripción corta`) como en el historial
existente. No hay changelog aparte; el resumen va en el mensaje de commit.

## Otras cosas a tener en cuenta

- Es una app de un solo usuario corriendo en `localhost`; no hay auth ni
  multi-tenant — no agregar esas capas salvo que se pida explícitamente.
- Las migraciones de esquema son manuales e idempotentes en
  `app/main.py` (`_COLUMNAS_NUEVAS`, `_indice_unico_numero`), no hay Alembic.
  Si se agrega una columna a un modelo existente, hay que sumarla ahí también
  o las bases ya instaladas no la van a tener.
- Los pedidos anulados nunca se borran (solo se marcan) salvo borrado
  definitivo explícito; no restar de totales/alertas contando anulados.
- Antes de dar por terminado un cambio de frontend, probarlo en el navegador
  (la skill `run` levanta la app) — los tests de `pytest` cubren el backend,
  no la UI.
