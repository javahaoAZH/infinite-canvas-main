$ErrorActionPreference = 'Continue'

Write-Output '=== 1. Root page ==='
try {
    $r1 = Invoke-WebRequest -Uri 'http://127.0.0.1:18080/'
    Write-Output ("GET / -> Status: " + $r1.StatusCode)
    $isHtml = $r1.Content -match '<html'
    Write-Output ("IsHTML: " + $isHtml)
    Write-Output ("ContentType: " + $r1.Headers['Content-Type'])
} catch {
    Write-Output ("ROOT ERROR: " + $_.Exception.Message)
}

Write-Output '=== 2. Health endpoint ==='
try {
    $r2 = Invoke-WebRequest -Uri 'http://127.0.0.1:18080/api/health'
    Write-Output ("GET /api/health -> Status: " + $r2.StatusCode)
    Write-Output ("Body: " + $r2.Content)
} catch {
    Write-Output ("HEALTH ERROR: " + $_.Exception.Message)
}

Write-Output '=== 3. Director direct access (no redirect expected) ==='
try {
    $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:18080/director/index.html' -MaximumRedirects 0
    Write-Output ("GET /director/index.html -> Status: " + $resp.StatusCode)
} catch {
    if ($_.Exception.Response) {
        $code = [int]$_.Exception.Response.StatusCode
        Write-Output ("GET /director/index.html -> Status: " + $code)
        if ($code -eq 301 -or $code -eq 302) {
            Write-Output ("RedirectLocation: " + $_.Exception.Response.Headers['Location'])
        }
    } else {
        Write-Output ("DIRECTOR ERROR: " + $_.Exception.Message)
    }
}

Write-Output '=== 4. Process info ==='
Get-Process -Name InfiniteCanvas -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime | Format-Table | Out-String | Write-Output

