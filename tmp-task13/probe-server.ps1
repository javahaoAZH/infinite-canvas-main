param($Mode = 'health')

$ErrorActionPreference = 'Continue'
$base = 'https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443'
$token = '255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006'
$headers = @{ Authorization = "Bearer $token" }

function Get-Json($url, $label) {
    Write-Output "=== $label ==="
    try {
        $r = Invoke-WebRequest -Uri $url -Headers $headers -TimeoutSec 60 -UseBasicParsing
        Write-Output ('STATUS: ' + $r.StatusCode)
        Write-Output $r.Content
    } catch {
        Write-Output ('ERROR: ' + $_.Exception.Message)
        if ($_.Exception.Response) {
            try {
                $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                Write-Output ('BODY: ' + $sr.ReadToEnd())
            } catch {}
        }
    }
    Write-Output ''
}

if ($Mode -eq 'health' -or $Mode -eq 'all') {
    Write-Output '=== HEALTH ==='
    try {
        $r = Invoke-WebRequest -Uri "$base/health" -TimeoutSec 30 -UseBasicParsing
        Write-Output ('STATUS: ' + $r.StatusCode)
        Write-Output $r.Content
    } catch {
        Write-Output ('ERROR: ' + $_.Exception.Message)
    }
    Write-Output ''
}

if ($Mode -eq 'jobs' -or $Mode -eq 'all') {
    Get-Json "$base/v1/jobs/video_ad8b8333a1144fc4b63b14163f642e32" 'JOB 5B'
    Get-Json "$base/v1/jobs/video_32702b8045534cdd823cb0b25a9d5155" 'JOB 14B'
    Get-Json "$base/v1/queue" 'QUEUE'
}
