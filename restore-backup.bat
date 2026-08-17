@echo off
rem ===========================================================================
rem  Sale Order App - restore a backup
rem
rem  Drag a backup .json file onto this file, or double-click it and type the
rem  file name when asked.
rem ===========================================================================

title Sale Order App - Restore Backup
cd /d "%~dp0backend"

if not exist "venv\Scripts\python.exe" (
  echo.
  echo   [X] The Python environment is missing. Run start-app.bat once first.
  echo.
  pause
  exit /b 1
)

set "FILE=%~1"
if "%FILE%"=="" (
  echo.
  echo   Which backup file do you want to restore?
  echo   Tip: you can also drag the file onto restore-backup.bat next time.
  echo.
  set /p "FILE=  Full path to the .json file: "
)

if "%FILE%"=="" (
  echo   Nothing to do.
  pause
  exit /b 1
)

"venv\Scripts\python.exe" "restore_backup.py" "%FILE%" %2 %3

echo.
pause
