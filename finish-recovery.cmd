@echo off
REM Dispatch 2026-07-04: rebuild UI (dist was half-emptied by the crash mid-build),
REM then restart the Paperclip server so it serves the fresh UI.
title Paperclip recovery - DO NOT CLOSE
cd /d C:\Users\Augi-T1\paperclip
echo === RECOVERY %date% %time% === > recovery.log

echo [1/3] Rebuilding UI (takes ~40s)... >> recovery.log
cd /d C:\Users\Augi-T1\paperclip\ui
call node_modules\.bin\vite.cmd build >> C:\Users\Augi-T1\paperclip\recovery.log 2>&1
echo [1/3] vite exit code: %ERRORLEVEL% >> C:\Users\Augi-T1\paperclip\recovery.log

echo [2/3] Stopping any server on :3100... >> C:\Users\Augi-T1\paperclip\recovery.log
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }" >> C:\Users\Augi-T1\paperclip\recovery.log 2>&1
timeout /t 3 /nobreak > nul

echo [3/3] Starting Paperclip server... >> C:\Users\Augi-T1\paperclip\recovery.log
cd /d C:\Users\Augi-T1\paperclip\server
C:\Users\Augi-T1\AppData\Local\hermes\node\node.exe --require ..\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\preflight.cjs --import file:///C:/Users/Augi-T1/paperclip/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs src/index.ts >> C:\Users\Augi-T1\paperclip\recovery.log 2>&1
echo SERVER EXITED code %ERRORLEVEL% >> C:\Users\Augi-T1\paperclip\recovery.log
pause > nul
