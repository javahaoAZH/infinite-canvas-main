$p = Start-Process -FilePath "C:\Users\Administrator\AppData\Roaming\npm\node_modules\bun\bin\bun.exe" -ArgumentList "run", "dev" -WorkingDirectory "d:\infinite-canvas-main\web" -RedirectStandardOutput "d:\infinite-canvas-main\dev-e2e-frontend.log" -RedirectStandardError "d:\infinite-canvas-main\dev-e2e-frontend.err.log" -PassThru -WindowStyle Hidden
Write-Output ("FRONTEND_PID " + $p.Id)
