$base = 'https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443'
$token = '255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006'
$headers = @{ Authorization = "Bearer $token" }
$job = 'be7d51364e234beaaee44d23dd4b000e'
$candidates = @('14__c2a_wan14b_00005.mp4', '14__c2a_wan14b_00006.mp4', '14__c2a_wan14b_00004.mp4')
foreach ($c in $candidates) {
    $url = "$base/runs/$job/$c"
    try {
        $resp = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 60 -UseBasicParsing -Headers @{ Authorization = "Bearer $token" }
        Write-Output ("FOUND: $c status=" + $resp.StatusCode + " length=" + $resp.Headers['Content-Length'])
    } catch {
        Write-Output ("MISS: $c -> " + $_.Exception.Message)
    }
}
Write-Output '=== health ==='
try {
    $h = Invoke-WebRequest -Uri "$base/health" -TimeoutSec 30 -UseBasicParsing
    Write-Output ('health ' + $h.StatusCode + ' ' + $h.Content)
} catch {
    Write-Output ('health ERROR: ' + $_.Exception.Message)
}
