@echo off
rem ===========================================================================
rem  Sale Order App - Sync now
rem
rem  Double-click to swap changes with the online site right now. The app
rem  already does this by itself every few minutes while it is open.
rem ===========================================================================

title Sale Order App - Sync now
cd /d "%~dp0backend"

if not exist "venv\Scripts\python.exe" (
  echo.
  echo   [X] The Python environment is missing. Run start-app.bat once first.
  echo.
  pause
  exit /b 1
)

echo.
"venv\Scripts\python.exe" "sync.py" %1

echo.
pause
