@echo off
rem ===========================================================================
rem  Sale Order App - build the Windows installer
rem
rem  Double-click to make desktop\dist\Order Ledger Setup <version>.exe, the
rem  installer for the desktop app. Run it again after any change to the app.
rem  The first run downloads Electron, PyInstaller and MongoDB, so it needs
rem  internet and takes a while; later runs reuse them.
rem ===========================================================================

setlocal
title Sale Order App - Build Installer
cd /d "%~dp0"

if not exist "backend\venv\Scripts\python.exe" (
  echo   [X] Run start-app.bat once first - it installs what the build needs.
  goto :fail
)

echo.
echo   [1/4] Building the website...
pushd frontend
set "REACT_APP_BACKEND_URL=http://127.0.0.1:47800"
set "CI=false"
call npx craco build || (popd & goto :fail)
popd

echo.
echo   [2/4] Bundling the server...
"backend\venv\Scripts\python.exe" -m pip install --quiet pyinstaller==6.16.0 || goto :fail
pushd backend
"venv\Scripts\python.exe" -m PyInstaller --noconfirm --onedir --console --name order-ledger-server ^
  --distpath dist --workpath build-pyinstaller --specpath build-pyinstaller ^
  --collect-submodules uvicorn --hidden-import server --hidden-import sync ^
  desktop_main.py || (popd & goto :fail)
popd

echo.
echo   [3/4] Getting MongoDB...
if not exist "desktop\vendor\mongodb\mongod.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "desktop\get-mongodb.ps1" || goto :fail
) else (
  echo   [ok] Already downloaded
)

echo.
echo   [4/4] Making the installer...
pushd desktop
call npm install --no-audit --no-fund || (popd & goto :fail)
powershell -NoProfile -ExecutionPolicy Bypass -File "prepare-signing-kit.ps1" || (popd & goto :fail)
call npx electron-builder --win nsis || (popd & goto :fail)
popd

echo.
echo   [ok] Done. The installer is in desktop\dist
explorer "desktop\dist"
echo.
pause
exit /b 0

:fail
echo.
echo   [X] The build stopped. Scroll up for the reason.
echo.
pause
exit /b 1
