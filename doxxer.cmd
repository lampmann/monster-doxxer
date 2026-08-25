@echo off
rem ============================================================
rem  Monster Doxxer - Windows launcher.
rem
rem    doxxer            start the server (or reuse one) and open the tool
rem    doxxer stop       stop the server
rem    doxxer phone      print the address to type on your phone
rem    doxxer test       run the test suite
rem
rem  The sibling `doxx` script is POSIX shell and will not run in cmd.exe, so this
rem  is the same behaviour written for Windows. Put this file's folder on PATH and
rem  `doxxer` works from anywhere - see README.
rem
rem  The server is a plain static file server. It binds to every interface, which
rem  is what makes `doxxer phone` possible; on a public or untrusted network that
rem  also means anyone on it can read this folder, so stop it when you are done.
rem ============================================================
setlocal EnableDelayedExpansion

rem %~dp0 is this script's own folder, so the launcher works from any directory
rem and does not care where it was invoked from.
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

if "%DOXX_PORT%"=="" (set "PORT=8932") else (set "PORT=%DOXX_PORT%")
set "URL=http://localhost:%PORT%/index.html"

if /i "%~1"=="stop"  goto :stop
if /i "%~1"=="phone" goto :phone
if /i "%~1"=="test"  goto :test
if /i "%~1"=="help"  goto :help
if /i "%~1"=="/?"    goto :help
if not "%~1"=="" goto :help

rem ---------------------------------------------------------- start
call :is_up
if not errorlevel 1 (
  echo doxxer: reusing the server already on port %PORT%
  goto :open
)

if not exist "%ROOT%\data\bestiary" (
  echo doxxer: warning - no data\bestiary found.
  echo         The page will load but rank nothing. See data\README.md
)

call :find_server
if errorlevel 1 (
  echo doxxer: no python or node found on PATH.
  echo         Install Python from python.org, or serve "%ROOT%" yourself on port %PORT%.
  exit /b 1
)

echo doxxer: serving %ROOT%
rem A separate minimised window, so closing this prompt does not kill the server
rem and `doxxer stop` has something to find.
start "Monster Doxxer server" /MIN /D "%ROOT%" %SERVER_CMD%

rem Wait for it rather than racing the browser to a socket that isn't listening.
set /a tries=0
:wait
call :is_up
if not errorlevel 1 goto :open
set /a tries+=1
if %tries% GEQ 40 (
  echo doxxer: the server did not come up on port %PORT%.
  echo         Another program may be using it - try:  set DOXX_PORT=8933 ^&^& doxxer
  exit /b 1
)
rem ~250ms without needing timeout.exe, which fails when stdin is redirected.
ping -n 1 -w 250 192.0.2.1 >NUL 2>&1
goto :wait

:open
start "" "%URL%"
echo doxxer: %URL%
exit /b 0

rem ---------------------------------------------------------- stop
:stop
set "found="
for /f "tokens=5" %%p in ('netstat -ano -p TCP ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
  taskkill /PID %%p /F >NUL 2>&1
  if not errorlevel 1 (
    set "found=1"
    echo doxxer: stopped the server on port %PORT% ^(pid %%p^)
  )
)
if not defined found echo doxxer: nothing listening on port %PORT%
exit /b 0

rem ---------------------------------------------------------- phone
:phone
call :is_up
if errorlevel 1 (
  echo doxxer: the server is not running. Start it first with:  doxxer
  echo.
)
echo On a phone connected to the SAME Wi-Fi, open one of these:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
  set "ip=%%a"
  set "ip=!ip: =!"
  echo     http://!ip!:%PORT%/index.html
)
echo.
echo If it times out, Windows Firewall is blocking the port. Allow Python on
echo PRIVATE networks when prompted, or add a rule for port %PORT%.
echo The computer has to stay awake and keep running doxxer.
exit /b 0

rem ---------------------------------------------------------- test
:test
where node >NUL 2>&1
if errorlevel 1 (
  echo doxxer: node is not on PATH, and the tests need it.
  exit /b 1
)
pushd "%ROOT%"
node tests\run.js
set "rc=%ERRORLEVEL%"
popd
exit /b %rc%

rem ---------------------------------------------------------- helpers
:is_up
rem Windows 10 1803+ ships curl.exe. errorlevel 0 means something answered.
curl.exe -s -o NUL --max-time 1 "http://127.0.0.1:%PORT%/" >NUL 2>&1
exit /b %ERRORLEVEL%

:find_server
set "SERVER_CMD="
rem `py` first: it is the launcher Python's own installer puts on PATH, and it works
rem even when `python` is shadowed by the Microsoft Store stub that does nothing.
rem Written as explicit blocks rather than `where x && set y` because cmd parses a
rem conditional followed by && ambiguously, and picks the wrong branch often enough.
where py >NUL 2>&1
if not errorlevel 1 (
  set "SERVER_CMD=py -3 -m http.server %PORT%"
  exit /b 0
)
where python >NUL 2>&1
if not errorlevel 1 (
  set "SERVER_CMD=python -m http.server %PORT%"
  exit /b 0
)
where npx >NUL 2>&1
if not errorlevel 1 (
  set "SERVER_CMD=npx --yes http-server -p %PORT%"
  exit /b 0
)
exit /b 1

rem ---------------------------------------------------------- help
:help
echo Monster Doxxer - Windows launcher
echo.
echo   doxxer          start the server ^(or reuse one^) and open the tool
echo   doxxer stop     stop the server on port %PORT%
echo   doxxer phone    print the address to use from your phone
echo   doxxer test     run the test suite
echo   doxxer help     this
echo.
echo   folder: %ROOT%
echo   port:   %PORT%   ^(override with:  set DOXX_PORT=8933^)
echo   url:    %URL%
echo.
echo Put 5e.tools' data in %ROOT%\data - see data\README.md. Nothing from the
echo books is bundled with this tool, on purpose.
exit /b 0
