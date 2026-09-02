$base = 'https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443'
$token = '255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006'
$headers = @{ Authorization = "Bearer $token" }
$deadline = (Get-Date).AddMinutes(70)
$log = 'd:\infinite-canvas-main\tmp-task13\poll-14b-4s.log'
while ((Get-Date) -lt $deadline) {
    $line = ''
    try {
        $r = Invoke-WebRequest -Uri "$base/v1/queue" -Headers $headers -TimeoutSec 60 -UseBasicParsing
        $q = $r.Content | ConvertFrom-Json
        $job = $q.items | Where-Object { $_.job_id -eq 'be7d51364e234beaaee44d23dd4b000e' }
        if ($job) {
            $line = (Get-Date).ToString('HH:mm:ss') + ' status=' + $job.status + ' progress=' + $job.progress_percent + ' node=' + $job.current_node + ' url=' + $job.url + ' error=' + $job.error
            Add-Content -Path $log -Value $line
            if ($job.status -ne 'running' -and $job.status -ne 'queued' -and $job.status -ne 'pending') {
                Add-Content -Path $log -Value ('FINAL: ' + ($job | ConvertTo-Json -Depth 6 -Compress))
                break
            }
        } else {
            Add-Content -Path $log -Value ((Get-Date).ToString('HH:mm:ss') + ' job not found in queue')
        }
    } catch {
        Add-Content -Path $log -Value ((Get-Date).ToString('HH:mm:ss') + ' ERROR: ' + $_.Exception.Message)
    }
    Start-Sleep -Seconds 60
}
