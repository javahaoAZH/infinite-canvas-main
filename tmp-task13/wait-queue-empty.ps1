# 等队列清空（同事的两条 noobai 出图任务出队）后停止
$base = 'https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443'
$token = '255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006'
$headers = @{ Authorization = "Bearer $token" }
$deadline = (Get-Date).AddMinutes(30)
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri "$base/v1/queue" -Headers $headers -TimeoutSec 60 -UseBasicParsing
        $q = $r.Content | ConvertFrom-Json
        $active = @($q.items | Where-Object { $_.status -eq 'running' -or $_.status -eq 'queued' -or $_.status -eq 'pending' })
        $line = (Get-Date).ToString('HH:mm:ss') + ' active=' + $active.Count
        foreach ($j in $active) { $line += ' | ' + $j.job_id + ' ' + $j.status + ' ' + $j.workflow }
        Write-Output $line
        if ($active.Count -eq 0) { Write-Output 'QUEUE EMPTY'; break }
    } catch {
        Write-Output ((Get-Date).ToString('HH:mm:ss') + ' ERROR: ' + $_.Exception.Message)
    }
    Start-Sleep -Seconds 30
}
