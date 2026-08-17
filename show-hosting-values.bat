@echo off
rem ===========================================================================
rem  Sale Order App - values needed to put the app online
rem
rem  Double-click this. It shows the three values you paste into Render.
rem  It only reads what is already saved - it changes nothing.
rem ===========================================================================

title Sale Order App - Hosting Values
cd /d "%~dp0backend"

if not exist "venv\Scripts\python.exe" (
  echo.
  echo   [X] The Python environment is missing. Run start-app.bat once first.
  echo.
  pause
  exit /b 1
)

"venv\Scripts\python.exe" "set_password.py" --show

echo.
pause
