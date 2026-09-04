$deadline = (Get-Date).AddSeconds(120)
$found = $false
while ((Get-Date) -lt $deadline) {
    foreach ($f in "d:\infinite-canvas-main\dev-e2e-backend.log", "d:\infinite-canvas-main\dev-e2e-backend.err.log") {
        if (Test-Path $f) {
            $m = Select-String -Path $f -Pattern "Listening and serving HTTP on :18080" -SimpleMatch -ErrorAction SilentlyContinue
            if ($m) { $found = $true; break }
        }
    }
    if ($found) { break }
    Start-Sleep -Seconds 2
}
if ($found) { Write-Output "BACKEND READY" } else { Write-Output "BACKEND TIMEOUT" }
Write-Output "--- dev-e2e-backend.log ---"
if (Test-Path "d:\infinite-canvas-main\dev-e2e-backend.log") { Get-Content "d:\infinite-canvas-main\dev-e2e-backend.log" -Tail 5 }
Write-Output "--- dev-e2e-backend.err.log ---"
if (Test-Path "d:\infinite-canvas-main\dev-e2e-backend.err.log") { Get-Content "d:\infinite-canvas-main\dev-e2e-backend.err.log" -Tail 20 }
