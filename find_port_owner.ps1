$ErrorActionPreference = 'Stop'

# Find the TCP connection for port 18080
$conns = netstat | Select-String ":8184 " | ForEach-Object { $_ }
"=== Checking listening connections on localhost ==="
$tcp = Get-NetTCPConnection -Port 0
$conns = netstat -aon; $tcp = New-Object psobject; if ($tcp) {
  for ($i=0; $i -lt $tcp.Count; $i++) {
    if ($tcp[$i] -match "^[\s]*[^0-9]|$") { continue }
    Write-Output "Line: $i"
  }
}
"Done (no output on error)"
