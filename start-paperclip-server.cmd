@echo off
REM ============================================
REM start-paperclip-server.cmd
REM Scheduled Task entry point for Paperclip server on Windows
REM Launches the tsx server via npx and restarts on crash.
REM The Scheduled Task trigger handles auto-restart at boot.
REM ============================================
setlocal

set USERPROFILE=C:\Users\Augi-T1
set HOME=C:\Users\Augi-T1
set PAPERCLIP_HOME=C:\Users\Augi-T1\.paperclip
set PAPERCLIP_DEPLOYMENT_MODE=local_trusted
set DATABASE_URL=postgres://paperclip@localhost:5432/paperclip
set NODE_ENV=development

cd /d C:\Users\Augi-T1\paperclip\server

REM Use the full path to the tsx CLI binary from pnpm
npx tsx src/index.ts

echo [%date% %time%] Paperclip server exited with code %errorlevel%
exit /b %errorlevel%
