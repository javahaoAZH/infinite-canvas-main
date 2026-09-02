Write-Output ("bun.exe exists: " + (Test-Path 'C:\Users\Administrator\.bun\bin\bun.exe'))
Write-Output '--- bun.cmd ---'
if (Test-Path 'C:\Users\Administrator\AppData\Roaming\npm\bun.cmd') { Get-Content 'C:\Users\Administrator\AppData\Roaming\npm\bun.cmd' -TotalCount 15 }
Write-Output '--- bun.ps1 ---'
if (Test-Path 'C:\Users\Administrator\AppData\Roaming\npm\bun.ps1') { Get-Content 'C:\Users\Administrator\AppData\Roaming\npm\bun.ps1' -TotalCount 20 }
