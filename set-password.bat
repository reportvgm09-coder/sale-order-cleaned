@echo off
rem ===========================================================================
rem  Sale Order App - set the login username and password
rem
rem  Double-click this to choose the username and password you sign in with.
rem  The password is stored only as a hash, never as readable text.
rem ===========================================================================

title Sale Order App - Set Password
cd /d "%~dp0backend"

if not exist "venv\Scripts\python.exe" (
  echo.
  echo   [X] The Python environment is missing. Run start-app.bat once first.
  echo.
  pause
  exit /b 1
)

"venv\Scripts\python.exe" "set_password.py" %1

echo.
pause
