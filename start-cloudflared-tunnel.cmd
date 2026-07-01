@echo off
REM ============================================
REM start-cloudflared-tunnel.cmd
REM Scheduled Task entry point for cloudflared tunnel
REM Manages the paperclip.augiport.com tunnel
REM NOTE: Credentials and config must be in place first.
REM ============================================
setlocal

set PATH=%PATH%;C:\Users\Augi-T1\bin

REM Check if config exists
if not exist "%USERPROFILE%\.cloudflared\config.yml" (
    echo WARNING: cloudflared config not found at %USERPROFILE%\.cloudflared\config.yml
    echo Run: cloudflared tunnel login
    echo Then: cloudflared tunnel create <name>
    exit /b 1
)

cloudflared.exe tunnel run

echo [%date% %time%] cloudflared exited with code %errorlevel%
exit /b %errorlevel%
