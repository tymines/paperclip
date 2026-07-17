@echo off
REM Paperclip Server — Windows startup wrapper
REM Survives reboot. Requires: embedded PG running, env vars set.

set "HOST=0.0.0.0"
set "PAPERCLIP_DEPLOYMENT_MODE=authenticated"
set "PAPERCLIP_ALLOWED_HOSTNAMES=100.103.95.73,paperclip.augiport.com,127.0.0.1,localhost"
set "PAPERCLIP_BRIDGE_LOCAL_API_URL=http://100.103.95.73:3100"
set "PAPERCLIP_ARES_CALLBACK_URL=http://100.103.95.73:3100"
set "PAPERCLIP_LISTEN_HOST=127.0.0.1"
set "PAPERCLIP_LISTEN_PORT=3100"
set "HEARTBEAT_SCHEDULER_ENABLED=false"

cd /d "C:\Users\Augi-T1\paperclip\server"

REM Log startup
echo [%date% %time%] Paperclip Server starting >> "%TEMP%\paperclip-server.log"

REM Use the same Node as paperclip-mcp
"C:\Users\Augi-T1\AppData\Local\hermes\node\node.exe" ^
  "C:\Users\Augi-T1\paperclip\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\cli.mjs" ^
  src/index.ts >> "%TEMP%\paperclip-server.log" 2>&1
