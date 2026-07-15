@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM ---------------------------------------------------------------------------
REM  Suipacha Loader - Gestor de Pedidos (motor de arranque)
REM  No usar este archivo directamente: abrí el acceso directo "Suipacha
REM  Loader" que este mismo script crea en esta carpeta y en tu Escritorio
REM  (con el icono). Asi el icono siempre queda visible al abrir la app.
REM
REM  Antes de arrancar busca actualizaciones en GitHub y se actualiza solo.
REM  Los datos (pedidos, clientes, backups, Excel) se guardan en
REM  %LOCALAPPDATA%\SuipachaLoader, asi que ninguna actualizacion los borra.
REM ---------------------------------------------------------------------------

REM Si una actualizacion anterior dejo un launcher nuevo, aplicarlo y relanzar.
if exist "%~dp0iniciar_app.bat.new" (
  move /y "%~dp0iniciar_app.bat.new" "%~f0" >nul & call "%~f0" & exit /b
)

set "VER="
if exist VERSION set /p VER=<VERSION
title Suipacha Loader v%VER%

REM Crear (o actualizar) el acceso directo "Suipacha Loader" con icono, en
REM esta misma carpeta y en el Escritorio. Un .bat no puede tener icono
REM propio (corre dentro de cmd.exe), por eso el acceso directo. Se usa
REM PowerShell (mas confiable que cscript/VBS, que algunos antivirus
REM bloquean) y no se escribe ningun archivo temporal.
if not exist "%~dp0static\icon.ico" goto :sin_icono
set "TARGET=%~f0"
set "APPDIR=%~dp0"
set "ICON=%~dp0static\icon.ico"
set "LOCALLNK=%~dp0Suipacha Loader.lnk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $targets=@('%LOCALLNK%'); try { $targets += (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Suipacha Loader.lnk') } catch {}; foreach($p in $targets){ try { $s=$ws.CreateShortcut($p); $s.TargetPath='%TARGET%'; $s.WorkingDirectory='%APPDIR%'; $s.IconLocation='%ICON%'; $s.Description='Suipacha Loader - Gestor de Pedidos'; $s.Save() } catch {} }" >nul 2>nul
:sin_icono

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

echo Buscando actualizaciones...
%PY% updater.py

REM Releer la version por si la actualizacion la cambio.
set "VER="
if exist VERSION set /p VER=<VERSION
title Suipacha Loader v%VER%

echo.
echo Iniciando Suipacha Loader v%VER%... el navegador se abrira solo.
echo Para cerrar la app, cerra esta ventana.
echo.
%PY% run.py

pause
