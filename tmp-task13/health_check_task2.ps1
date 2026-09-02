# Task #2: health check
try {
    $r = Invoke-WebRequest -Uri 'https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443/health' -UseBasicParsing -TimeoutSec 30
    Write-Output ('STATUS ' + $r.StatusCode)
    Write-Output $r.Content
} catch {
    Write-Output ('ERROR ' + $_.Exception.Message)
}
