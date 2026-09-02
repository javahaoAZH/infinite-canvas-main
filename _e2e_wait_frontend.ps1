$deadline = (Get-Date).AddSeconds(180)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000/" -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        Start-Sleep -Seconds 3
    }
}
if ($ready) { Write-Output "FRONTEND READY (200)" } else { Write-Output "FRONTEND TIMEOUT" }
Write-Output "--- dev-e2e-frontend.log ---"
if (Test-Path "d:\infinite-canvas-main\dev-e2e-frontend.log") { Get-Content "d:\infinite-canvas-main\dev-e2e-frontend.log" -Tail 10 }
Write-Output "--- dev-e2e-frontend.err.log ---"
if (Test-Path "d:\infinite-canvas-main\dev-e2e-frontend.err.log") { Get-Content "d:\infinite-canvas-main\dev-e2e-frontend.err.log" -Tail 10 }
