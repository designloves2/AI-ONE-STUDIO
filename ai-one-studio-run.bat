@echo off
title AI ONE STUDIO
cd /d "%~dp0"

echo Starting AI ONE STUDIO server...
echo Waiting for ComfyUI (127.0.0.1:8188) before opening the browser...
echo (Gives up after 3 minutes and opens anyway.)
echo Close this window to stop the server.
echo.

start "" /min powershell -NoProfile -WindowStyle Hidden -Command ^
  "$deadline = (Get-Date).AddMinutes(3); while ((Get-Date) -lt $deadline) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8188/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200) { break } } catch {}; Start-Sleep -Seconds 2 }; Start-Process 'http://127.0.0.1:8774/'"

call npm run dev

pause
