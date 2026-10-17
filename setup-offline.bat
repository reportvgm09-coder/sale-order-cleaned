@echo off
rem ===========================================================================
rem  Sale Order App - Use offline
rem
rem  Double-click once to give this PC its own database, so the app keeps
rem  working without internet and syncs with the online site when it can.
rem  Run with --undo to go back to using the online database directly.
rem ===========================================================================

title Sale Order App - Use offline
cd /d "%~dp0backend"

if not exist "venv\Scripts\python.exe" (
  echo.
  echo   [X] The Python environment is missing. Run start-app.bat once first.
  echo.
  pause
  exit /b 1
)

echo.
"venv\Scripts\python.exe" "setup_offline.py" %1

echo.
pause
