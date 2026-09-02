$base = 'https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443'
$token = '255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006'
$headers = @{ Authorization = "Bearer $token" }
try {
    $r = Invoke-WebRequest -Uri "$base/v1/queue" -Headers $headers -TimeoutSec 60 -UseBasicParsing
    $q = $r.Content | ConvertFrom-Json
    $job = $q.items | Where-Object { $_.job_id -eq '32702b8045534cdd823cb0b25a9d5155' }
    if ($job) {
        Write-Output ("14B status=" + $job.status + " started=" + $job.started_at_utc + " finished=" + $job.finished_at_utc + " duration_s=" + $job.duration_s + " progress_percent=" + $job.progress_percent + " error=" + $job.error + " url=" + $job.url)
    } else {
        Write-Output '14B job not found in queue'
    }
} catch {
    Write-Output ('ERROR: ' + $_.Exception.Message)
}
