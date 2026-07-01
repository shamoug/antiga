@echo off
REM ===== Save the Date - local launcher =====
REM Serves this folder on http://localhost:5178 and opens your browser.
REM Close this window to stop the server.

setlocal
cd /d "%~dp0"
set PORT=5178

REM Pick a Python launcher (python, then py)
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY ( where py >nul 2>nul && set "PY=py" )

if not defined PY (
  echo.
  echo Python 3 was not found on this PC.
  echo Install it from https://www.python.org/downloads/  ^(tick "Add to PATH"^),
  echo or serve this folder with any static web server on port %PORT%.
  echo.
  pause
  exit /b 1
)

echo.
echo   Save the Date - The Anticipation Game
echo   Serving on http://localhost:%PORT%
echo   Opening your browser... ^(if the page is blank, just refresh^)
echo   Close this window to stop the server.
echo.

start "" http://localhost:%PORT%/
%PY% -m http.server %PORT%
