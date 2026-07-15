@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM ---------------------------------------------------------------------------
REM  SuipachaLoader - Gestor de Pedidos
REM  Doble clic en este archivo para arrancar la app.
REM  Antes de arrancar busca actualizaciones en GitHub y se actualiza solo.
REM  Los datos (pedidos, clientes, backups, Excel) se guardan en
REM  %LOCALAPPDATA%\SuipachaLoader, asi que ninguna actualizacion los borra.
REM ---------------------------------------------------------------------------

REM Si una actualizacion anterior dejo un launcher nuevo, aplicarlo y relanzar.
if exist "%~dp0SuipachaLoader.bat.new" (
  move /y "%~dp0SuipachaLoader.bat.new" "%~f0" >nul & call "%~f0" & exit /b
)

set "VER="
if exist VERSION set /p VER=<VERSION
title SuipachaLoader v%VER%

REM Crear (o actualizar) un acceso directo con el icono de SuipachaLoader en
REM el Escritorio. Un .bat no puede tener icono propio (corre dentro de
REM cmd.exe); este acceso directo es la forma de tener el icono en Windows.
REM Doble clic en el acceso directo del Escritorio a partir de ahora.
if not exist "%~dp0static\icon.ico" goto :sin_icono
set "VBS=%TEMP%\suipacha_shortcut.vbs"
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS%"
echo sLinkFile = oWS.SpecialFolders("Desktop") ^& "\SuipachaLoader.lnk" >> "%VBS%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%VBS%"
echo oLink.TargetPath = "%~f0" >> "%VBS%"
echo oLink.WorkingDirectory = "%~dp0" >> "%VBS%"
echo oLink.IconLocation = "%~dp0static\icon.ico" >> "%VBS%"
echo oLink.Description = "SuipachaLoader - Gestor de Pedidos" >> "%VBS%"
echo oLink.Save >> "%VBS%"
cscript //nologo "%VBS%" >nul 2>nul
del "%VBS%" >nul 2>nul
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
title SuipachaLoader v%VER%

echo.
echo Iniciando SuipachaLoader v%VER%... el navegador se abrira solo.
echo Para cerrar la app, cerra esta ventana.
echo.
%PY% run.py

pause
