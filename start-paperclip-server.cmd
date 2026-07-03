@echo off
REM Paperclip Server - starts from .env config (authenticated + 0.0.0.0)
REM Updated 2026-07-01: removed hardcoded local_trusted; .env drives config
cd /d C:\Users\Augi-T1\paperclip\server
C:\Users\Augi-T1\AppData\Local\hermes\node\node.exe --require ..\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\preflight.cjs --import file:///C:/Users/Augi-T1/paperclip/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs src/index.ts
