$base = 'https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443'
$token = '255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006'
$headers = @{ Authorization = "Bearer $token" }

$r = Invoke-WebRequest -Uri "$base/v1/queue" -Headers $headers -TimeoutSec 60 -UseBasicParsing
$q = $r.Content | ConvertFrom-Json
Write-Output ("counts: completed=" + $q.counts.completed + " failed=" + $q.counts.failed + " running=" + $q.counts.running)
Write-Output ("items total: " + $q.items.Count)
$last = $q.items | Sort-Object created_at | Select-Object -Last 5
foreach ($j in $last) {
    Write-Output ($j.created_at_utc + ' | ' + $j.status + ' | ' + $j.kind + ' | ' + $j.workflow + ' | job=' + $j.job_id + ' | seconds=' + $j.seconds + ' | url=' + $j.url + ' | err=' + $j.error)
}

Write-Output '=== direct job query ==='
try {
    $r2 = Invoke-WebRequest -Uri "$base/v1/jobs/video_be7d51364e234beaaee44d23dd4b000e" -Headers $headers -TimeoutSec 60 -UseBasicParsing
    Write-Output ('STATUS ' + $r2.StatusCode)
    Write-Output $r2.Content
} catch {
    Write-Output ('ERROR: ' + $_.Exception.Message)
}
