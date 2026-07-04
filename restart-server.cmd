@echo off
REM Dispatch: quick server restart to load new env (SMTP block). Window must stay open.
title Paperclip Server - DO NOT CLOSE
cd /d C:\Users\Augi-T1\paperclip
echo === RESTART %date% %time% === > restart.log
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }" >> restart.log 2>&1
timeout /t 3 /nobreak > nul
cd /d C:\Users\Augi-T1\paperclip\server
C:\Users\Augi-T1\AppData\Local\hermes\node\node.exe --require ..\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\preflight.cjs --import file:///C:/Users/Augi-T1/paperclip/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs src/index.ts >> C:\Users\Augi-T1\paperclip\restart.log 2>&1
echo SERVER EXITED %ERRORLEVEL% >> C:\Users\Augi-T1\paperclip\restart.log
pause > nul
