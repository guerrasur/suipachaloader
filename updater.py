#!/usr/bin/env python3
"""Actualizador automático de SuipachaLoader.

Lo ejecuta SuipachaLoader.bat antes de arrancar la app:

1. Compara la versión local (archivo VERSION) con la del repositorio en GitHub.
2. Si hay una versión nueva, descarga el ZIP de la rama ``main`` y reemplaza
   los archivos del programa. Los datos NO se tocan: viven fuera de la app
   (%LOCALAPPDATA%\\SuipachaLoader), así que ninguna actualización los pierde.
3. Instala dependencias nuevas si las hubiera.

Si no hay internet o algo falla, avisa y deja arrancar la app normalmente.

Repos privados: GitHub no permite descargas anónimas. Para que la
actualización automática funcione hay dos opciones: hacer público el
repositorio, o guardar un token de GitHub (con permiso de lectura del repo)
en el archivo ``github_token.txt`` dentro de la carpeta de datos.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

REPO = "guerrasur/suipachaloader"
RAMA = "main"
BASE = Path(__file__).resolve().parent

# Nunca se pisan al actualizar: datos locales viejos y archivos de trabajo.
NO_TOCAR = {"data", "backups", "exports", ".git", "__pycache__", ".claude"}


def _dir_datos() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    return Path(local) / "SuipachaLoader" if local else Path.home() / ".suipachaloader"


def _version_local() -> str:
    try:
        return (BASE / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return "0"


def _token() -> str:
    try:
        return (_dir_datos() / "github_token.txt").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _get(url: str, accept: str | None = None) -> bytes:
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "SuipachaLoader-updater")
    if accept:
        req.add_header("Accept", accept)
    tok = _token()
    if tok:
        req.add_header("Authorization", "Bearer " + tok)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def _version_remota() -> str:
    datos = _get(
        f"https://api.github.com/repos/{REPO}/contents/VERSION?ref={RAMA}",
        accept="application/vnd.github.raw",
    )
    return datos.decode("utf-8").strip()


def _aplicar_zip(zip_path: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp)
        # El ZIP de GitHub trae una única carpeta raíz con nombre variable.
        raiz = next(Path(tmp).iterdir())
        for origen in raiz.rglob("*"):
            if not origen.is_file():
                continue
            rel = origen.relative_to(raiz)
            if rel.parts[0] in NO_TOCAR:
                continue
            if rel.name == "SuipachaLoader.bat":
                # El .bat puede estar en ejecución: se deja como .new y el
                # propio launcher lo aplica en el próximo arranque.
                destino = BASE / "SuipachaLoader.bat.new"
            else:
                destino = BASE / rel
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(origen, destino)


def _instalar_dependencias() -> None:
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "-r", str(BASE / "requirements.txt")],
        check=False,
    )


def main() -> None:
    local = _version_local()
    try:
        remota = _version_remota()
    except Exception as e:  # sin internet, repo privado sin token, etc.
        print(f"No se pudo consultar actualizaciones ({e}). Se inicia igual.")
        return

    if remota == local:
        print(f"SuipachaLoader v{local}: ya estás en la última versión.")
        return

    print(f"Actualizando de v{local} a v{remota}...")
    try:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
            f.write(_get(f"https://api.github.com/repos/{REPO}/zipball/{RAMA}"))
            zip_path = Path(f.name)
        _aplicar_zip(zip_path)
        zip_path.unlink(missing_ok=True)
        _instalar_dependencias()
        print(f"¡Listo! Actualizado a v{remota}.")
    except Exception as e:
        print(f"La actualización falló ({e}). Se inicia con la versión actual.")


if __name__ == "__main__":
    main()
