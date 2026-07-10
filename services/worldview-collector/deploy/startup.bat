@echo off
REM World View Collector — Windows startup wrapper
REM Survives reboot. Zero dependencies. Node >=18 required.

set "WORLDVIEW_PORT=8788"
set "WORLDVIEW_POLL_MS=300000"
set "NODE_PATH=C:\Users\Augi-T1\AppData\Local\hermes\node"

cd /d "C:\Users\Augi-T1\paperclip\services\worldview-collector"

REM Log startup
echo [%date% %time%] World View Collector starting on port %WORLDVIEW_PORT% >> "%TEMP%\worldview-collector.log"

"%NODE_PATH%\node.exe" server.mjs >> "%TEMP%\worldview-collector.log" 2>&1
