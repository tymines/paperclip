@echo off
REM Wrapper so Task Scheduler can launch the fleet-boot orchestrator cleanly.
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\Augi-T1\paperclip\fleet-boot.ps1"
