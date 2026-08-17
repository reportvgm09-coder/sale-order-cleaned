@echo off
rem ===========================================================================
rem  Sale Order App - database connection check
rem
rem  Double-click this when the app says it cannot reach the backend.
rem  It tells you exactly why the database is unreachable.
rem ===========================================================================

title Sale Order App - Database Check
cd /d "%~dp0backend"

if not exist "venv\Scripts\python.exe" (
  echo.
  echo   [X] The Python environment is missing. Run start-app.bat once first.
  echo.
  pause
  exit /b 1
)

"venv\Scripts\python.exe" "check_db.py"

echo.
pause
