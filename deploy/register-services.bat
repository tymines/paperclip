@echo off
REM === Register World View + Paperclip as Windows Scheduled Tasks ===
REM Run ONCE as Administrator. Survives reboot, auto-restarts on failure.
REM Uses SYSTEM account (no password prompt needed).

echo === Step 1: World View Collector (:8788) ===

schtasks /create /tn "PaperclipWorldViewCollector" ^
  /tr "C:\Users\Augi-T1\paperclip\services\worldview-collector\deploy\startup.bat" ^
  /sc onstart ^
  /ru "SYSTEM" ^
  /rl highest ^
  /delay 0000:30 ^
  /f

echo === Step 2: Paperclip Fork (:3101) ===

schtasks /create /tn "PaperclipFork" ^
  /tr "C:\Users\Augi-T1\paperclip\deploy\startup-fork.bat" ^
  /sc onstart ^
  /ru "SYSTEM" ^
  /rl highest ^
  /delay 0001:00 ^
  /f

echo === Done. Verify: ===
echo   schtasks /query /tn "PaperclipWorldViewCollector"
echo   schtasks /query /tn "PaperclipFork"
echo.
echo === Test (manual start): ===
echo   schtasks /run /tn "PaperclipWorldViewCollector"
echo   schtasks /run /tn "PaperclipFork"
echo.
echo === Check logs: ===
echo   type %%TEMP%%\worldview-collector.log
echo   type %%TEMP%%\paperclip-fork.log
echo.
echo === Remove (if needed): ===
echo   schtasks /delete /tn "PaperclipWorldViewCollector" /f
echo   schtasks /delete /tn "PaperclipFork" /f
