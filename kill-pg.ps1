Stop-Process -Id 58996 -Force
Start-Sleep 2
# Remove PG data dir
$dataDir = "$env:USERPROFILE\.paperclip\instances\default\db"
if (Test-Path $dataDir) {
    Remove-Item -Recurse -Force $dataDir
    Write-Output "Deleted $dataDir"
} else {
    Write-Output "Data dir not found at $dataDir"
}
# Remove migration tool's temp db too
$tempDb = "$env:USERPROFILE\.paperclip\instances\default\db-54331"
if (Test-Path $tempDb) {
    Remove-Item -Recurse -Force $tempDb
    Write-Output "Deleted $tempDb"
}
# Check if process is gone
$p = Get-Process -Id 58996 -ErrorAction SilentlyContinue
if ($p) {
    Write-Output "Process 58996 still alive"
} else {
    Write-Output "Process 58996 killed"
}
