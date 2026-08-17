@echo off
rem ===========================================================================
rem  Sale Order App - one-click launcher
rem
rem  Double-click this file. It checks everything is installed, then opens two
rem  windows: one for the backend, one for the frontend.
rem
rem  This same file is re-used for those two windows, so keep all three
rem  sections together - do not split it up.
rem ===========================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

if /i "%~1"=="backend"  goto :run_backend
if /i "%~1"=="frontend" goto :run_frontend

title Sale Order App - Launcher
echo.
echo   ==========================================
echo     SALE ORDER APP
echo   ==========================================
echo.

rem ---------------------------------------------------------------- Python --
set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY (
  where py >nul 2>&1 && set "PY=py -3"
)
rem  A Windows Store stub can answer "where python" without actually working,
rem  so prove the interpreter really runs before trusting it.
if defined PY (
  %PY% -c "import sys" >nul 2>&1 || set "PY="
)
if not defined PY (
  echo   [X] Python was not found.
  echo.
  echo       Install it from python.org and make sure you tick
  echo       "Add python.exe to PATH" on the very first install screen.
  goto :fail
)
echo   [ok] Python found

rem ------------------------------------------------------------------ Node --
where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node.js was not found.
  echo.
  echo       Install the LTS version from nodejs.org, then restart the PC.
  goto :fail
)
echo   [ok] Node.js found

set "PKG=npm"
where yarn >nul 2>&1 && set "PKG=yarn"
echo   [ok] Using %PKG% for the frontend

rem ---------------------------------------------------------- backend/.env --
set "FRESH_ENV="
if not exist "backend\.env" (
  copy /y "backend\.env.example" "backend\.env" >nul
  set "FRESH_ENV=1"
)
findstr /b /c:"MONGO_URL=" "backend\.env" >nul 2>&1
if errorlevel 1 set "FRESH_ENV=1"

if defined FRESH_ENV (
  echo.
  echo   [setup] The backend needs your database connection string.
  echo.
  echo       Notepad will open now. Find the line that starts with
  echo       MONGO_URL=  and put your MongoDB Atlas connection string
  echo       after the equals sign.
  echo.
  echo       Make sure that line does NOT start with a # - a line
  echo       starting with # is ignored.
  echo.
  echo       Then save the file and close Notepad to carry on.
  echo.
  pause
  start /wait notepad "backend\.env"
  findstr /b /c:"MONGO_URL=" "backend\.env" >nul 2>&1
  if errorlevel 1 (
    echo   [X] There is still no active MONGO_URL line in backend\.env
    goto :fail
  )
)
echo   [ok] backend\.env looks set up

rem --------------------------------------------------------- frontend/.env --
if not exist "frontend\.env" copy /y "frontend\.env.example" "frontend\.env" >nul
echo   [ok] frontend\.env ready

rem ------------------------------------------------- backend dependencies ---
if not exist "backend\venv\Scripts\python.exe" (
  echo.
  echo   [setup] First run - creating the Python environment. This takes a minute.
  %PY% -m venv "backend\venv"
  if errorlevel 1 (
    echo   [X] Could not create the Python environment.
    goto :fail
  )
)
if not exist "backend\venv\Scripts\uvicorn.exe" (
  echo   [setup] Installing backend packages. This takes a few minutes.
  "backend\venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
  "backend\venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
  if errorlevel 1 (
    echo   [X] Backend packages failed to install - check your internet connection.
    goto :fail
  )
)
echo   [ok] Backend packages installed

rem ------------------------------------------------------------ login set ---
rem  The server refuses to start without a password, so set one on first run.
findstr /b /r /c:"APP_PASSWORD_HASH=." "backend\.env" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [setup] No login is set yet. The app will not run without one.
  echo           Choose a username and password now.
  echo.
  pushd backend
  "venv\Scripts\python.exe" "set_password.py"
  popd
  findstr /b /r /c:"APP_PASSWORD_HASH=." "backend\.env" >nul 2>&1
  if errorlevel 1 (
    echo   [X] No password was set, so the app cannot start.
    goto :fail
  )
)
echo   [ok] Login is configured

rem ------------------------------------------------ frontend dependencies ---
rem  node_modules can exist but be half-downloaded, which is what causes the
rem  "'craco' is not recognized" error - so check for craco specifically.
if not exist "frontend\node_modules\.bin\craco.cmd" (
  echo.
  echo   [setup] Installing frontend packages. This takes several minutes.
  pushd frontend
  if /i "%PKG%"=="yarn" (
    call yarn install --network-timeout 600000
  ) else (
    call npm install
  )
  popd
  if not exist "frontend\node_modules\.bin\craco.cmd" (
    echo   [X] Frontend packages did not install completely.
    echo.
    echo       Try again on a different network, or turn off any VPN.
    goto :fail
  )
)
echo   [ok] Frontend packages installed

rem ------------------------------------------------------------- old windows --
call :freeport 8000 backend
call :freeport 3000 frontend

rem ----------------------------------------------------------- launch both --
echo.
echo   Starting the backend...
start "Sale Order - Backend" cmd /k call "%~f0" backend

echo   Waiting for the backend to come up...
timeout /t 6 /nobreak >nul

echo   Starting the frontend...
start "Sale Order - Frontend" cmd /k call "%~f0" frontend

echo.
echo   ==========================================
echo     Both are starting up.
echo.
echo     The app will open by itself at
echo     http://localhost:3000
echo     after about half a minute.
echo.
echo     Two new windows have opened. Leave them
echo     running while you use the app.
echo     To stop: press Ctrl+C in each one.
echo   ==========================================
echo.
echo   You can close THIS window now.
echo.
pause
exit /b 0

rem ===========================================================================
:freeport
rem  %1 = port number, %2 = what normally uses it
set "OLDPID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"TCP.*:%~1 .*LISTENING" 2^>nul') do set "OLDPID=%%p"
if not defined OLDPID goto :eof
echo.
echo   [warn] Port %~1 is already in use - probably an old %~2 window
echo       that is still running from last time.
set "KILLIT=Y"
set /p "KILLIT=      Close it so the app can start? [Y/n] "
if /i "!KILLIT:~0,1!"=="n" goto :eof
taskkill /PID !OLDPID! /F >nul 2>&1
timeout /t 2 /nobreak >nul
echo   [ok] Freed port %~1
goto :eof

rem ===========================================================================
:fail
echo.
echo   Startup stopped. Nothing was broken - fix the item marked [X] above
echo   and run this file again.
echo.
pause
exit /b 1

rem ===========================================================================
:run_backend
title Sale Order - Backend
cd /d "%~dp0backend"
call "venv\Scripts\activate.bat"
echo.
echo   BACKEND - http://localhost:8000
echo   Leave this window open. Press Ctrl+C to stop.
echo.
uvicorn server:app --reload --port 8000
echo.
echo   The backend has stopped.
pause
exit /b 0

rem ===========================================================================
:run_frontend
title Sale Order - Frontend
cd /d "%~dp0frontend"
set "PKG=npm"
where yarn >nul 2>&1 && set "PKG=yarn"
echo.
echo   FRONTEND - http://localhost:3000
echo   Leave this window open. Press Ctrl+C to stop.
echo.
call %PKG% start
echo.
echo   The frontend has stopped.
pause
exit /b 0
