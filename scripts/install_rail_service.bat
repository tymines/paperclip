@echo off
REM RAIL Controller Daemon — Windows Scheduled Task Installer
REM Runs at login, auto-restarts on failure, no console window
REM Usage: install_rail_service.bat
REM        install_rail_service.bat uninstall

set TASK_NAME=RAIL Controller Daemon
set SCRIPT_DIR=%~dp0
set PYTHON=python3
set CONTROLLER=%SCRIPT_DIR%rail_controller.py
set WORKDIR=C:\Users\Augi-T1\paperclip

if "%1"=="uninstall" (
    echo Uninstalling scheduled task...
    schtasks /delete /tn "%TASK_NAME%" /f
    exit /b
)

echo Installing RAIL Controller as scheduled task...
echo   Task: %TASK_NAME%
echo   Script: %CONTROLLER%
echo   Workdir: %WORKDIR%

REM Create task: runs at logon, repeats every 1 min, kills after 1 hour (prevents zombie stack)
schtasks /create /tn "%TASK_NAME%" /tr "%PYTHON% %CONTROLLER%" /sc onlogon /delay 0001:00 /rl highest /f >nul 2>&1
if errorlevel 1 (
    REM schtasks fails if task exists — update it
    schtasks /change /tn "%TASK_NAME%" /tr "%PYTHON% %CONTROLLER%" /rl highest /f
)

REM Also create a repeating trigger every 5 min as safety net (if the daemon exits)
schtasks /create /tn "%TASK_NAME% Daily" /tr "%PYTHON% %CONTROLLER% --once" /sc minute /mo 5 /f >nul 2>&1
if errorlevel 1 (
    schtasks /change /tn "%TASK_NAME% Daily" /tr "%PYTHON% %CONTROLLER% --once" /f
)

echo DONE. Tasks installed:
schtasks /query /tn "%TASK_NAME%" /fo list | findstr /i "TaskName Status"
schtasks /query /tn "%TASK_NAME% Daily" /fo list | findstr /i "TaskName Status"
