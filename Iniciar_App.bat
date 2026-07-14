@echo off
chcp 65001 >nul
title Carabelas TKA - Gestor de Pedidos
cd /d "%~dp0"

REM ---------------------------------------------------------------------------
REM  Carabelas TKA - Gestor de Pedidos
REM  Doble clic en este archivo para arrancar la app.
REM  Levanta el servidor con Python y abre el navegador automaticamente
REM  en http://127.0.0.1:8000/ (lo hace run.py).
REM ---------------------------------------------------------------------------

REM Detectar el comando de Python disponible (python o el lanzador py).
set "PY=python"
where python >nul 2>nul || set "PY=py"

REM Verificar que Python este instalado.
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] No se encontro Python. Instalalo desde https://www.python.org/
  echo         y acordate de tildar "Add Python to PATH" durante la instalacion.
  echo.
  pause
  exit /b 1
)

REM Instalar las dependencias la primera vez (si falta uvicorn).
%PY% -c "import uvicorn" >nul 2>nul
if errorlevel 1 (
  echo Instalando dependencias por unica vez, esto puede tardar un momento...
  %PY% -m pip install -r requirements.txt
  if errorlevel 1 (
    echo.
    echo [ERROR] No se pudieron instalar las dependencias.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando Carabelas TKA... el navegador se abrira solo.
echo Para cerrar la app, cerra esta ventana.
echo.
%PY% run.py

pause
