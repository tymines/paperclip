# Create-FleetScheduledTask.ps1
# Creates a Scheduled Task that runs fleet-boot.ps1 at system startup.
# This replaces the HKCU Run registry entry and survives reboot without login.
# Run once as admin to install.

$taskName = "Paperclip Fleet Boot"
$scriptPath = "C:\Users\Augi-T1\paperclip\fleet-boot.ps1"
$cmdPath = "C:\Users\Augi-T1\paperclip\fleet-boot.cmd"

# First, ensure the .cmd wrapper exists
@"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$scriptPath" >> "C:\Users\Augi-T1\paperclip\fleet-boot.log" 2>&1
"@ | Out-File -FilePath $cmdPath -Encoding ASCII

# Remove old task if it exists (ignore errors)
schtasks /delete /tn "$taskName" /f 2>$null

# Create the scheduled task
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmdPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "Augi-T1" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "$taskName" `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Paperclip fleet boot orchestrator: starts PG, embedded PG check, server, and Cloudflare tunnels at system startup"

Write-Output "Scheduled task '$taskName' created successfully."
Write-Output "Run 'schtasks /run /tn `"$taskName`"' to test it now."
