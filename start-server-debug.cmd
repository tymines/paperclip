@echo off
REM Debug wrapper for start-paperclip-server.cmd (Dispatch, 2026-07-04)
REM Captures everything to server-debug.txt so we can see WHY startup fails.
cd /d C:\Users\Augi-T1\paperclip
echo === DEBUG RUN %date% %time% === > server-debug.txt
echo --- port 5432 (postgres) --- >> server-debug.txt
netstat -ano | findstr ":5432" >> server-debug.txt
echo --- port 3100 (paperclip) --- >> server-debug.txt
netstat -ano | findstr ":3100" >> server-debug.txt
echo --- node exists? --- >> server-debug.txt
if exist C:\Users\Augi-T1\AppData\Local\hermes\node\node.exe (echo node.exe FOUND >> server-debug.txt) else (echo node.exe MISSING >> server-debug.txt)
echo --- starting server, output follows --- >> server-debug.txt
cd /d C:\Users\Augi-T1\paperclip\server
C:\Users\Augi-T1\AppData\Local\hermes\node\node.exe --require ..\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\preflight.cjs --import file:///C:/Users/Augi-T1/paperclip/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs src/index.ts >> C:\Users\Augi-T1\paperclip\server-debug.txt 2>&1
echo --- server process EXITED with code %ERRORLEVEL% --- >> C:\Users\Augi-T1\paperclip\server-debug.txt
