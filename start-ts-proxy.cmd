@echo off
REM ============================================
REM start-ts-proxy.cmd
REM Scheduled Task entry point for the Tailscale API proxy
REM Forwards from Tailscale IP:3100 -> localhost:3100
REM ============================================
setlocal

cd /d C:\Users\Augi-T1\paperclip

REM The proxy binds to the Tailscale IP 100.103.95.73:3100 and
REM forwards requests to 127.0.0.1:3100 (the Paperclip server).
REM This lets Macs, Box 2, and bridge daemon reach Windows Paperclip.
node ts-proxy.mjs

echo [%date% %time%] TS proxy exited with code %errorlevel%
exit /b %errorlevel%
