Set-Location d:\infinite-canvas-main
$p = Start-Process -FilePath "go" -ArgumentList "run", "." -WorkingDirectory "d:\infinite-canvas-main" -RedirectStandardOutput "d:\infinite-canvas-main\dev-e2e-backend.log" -RedirectStandardError "d:\infinite-canvas-main\dev-e2e-backend.err.log" -PassThru -WindowStyle Hidden
Write-Output ("BACKEND_PID " + $p.Id)
