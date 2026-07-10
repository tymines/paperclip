@echo off
REM Paperclip Server (fork on :3101) — Windows startup wrapper
REM Uses tsx loader with absolute paths for reliability

set "HOST=0.0.0.0"
set "PAPERCLIP_DEPLOYMENT_MODE=authenticated"
set "PAPERCLIP_ALLOWED_HOSTNAMES=100.103.95.73,paperclip.augiport.com,127.0.0.1,localhost"
set "PAPERCLIP_LISTEN_HOST=127.0.0.1"
set "PAPERCLIP_LISTEN_PORT=3101"
set "HEARTBEAT_SCHEDULER_ENABLED=false"
set "FLEET_KB_PATH=F:\Augi Vault"

cd /d "C:\Users\Augi-T1\paperclip"

echo [%date% %time%] Paperclip Server (fork :3101) starting >> "%TEMP%\paperclip-fork.log"

REM Same invocation as the current running process (PID 33148) but with absolute paths
"C:\Users\Augi-T1\AppData\Local\hermes\node\node.exe" ^
  --require "C:\Users\Augi-T1\paperclip\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\preflight.cjs" ^
  --import "file:///C:/Users/Augi-T1/paperclip/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs" ^
  server/src/index.ts >> "%TEMP%\paperclip-fork.log" 2>&1
