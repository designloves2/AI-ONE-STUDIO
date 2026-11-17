@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist .git (
  echo [1/3] Updating... git pull
  git pull --ff-only
)
echo [2/3] Checking packages...
call npm install --no-audit --no-fund --loglevel=error
echo [3/3] Building the screen...
call npm run build
if errorlevel 1 (
  echo Build failed. Fix the errors above, then run this again.
  pause
  exit /b 1
)
if "%COMFY_URL%"=="" set COMFY_URL=http://127.0.0.1:8188
if "%PORT%"=="" set PORT=8778
echo ComfyUI: %COMFY_URL%
echo AI ONE STUDIO: http://127.0.0.1:%PORT%   (close this window to stop the server)
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%PORT%/'"
node serve.mjs
pause
