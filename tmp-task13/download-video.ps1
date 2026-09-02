param($Url = "https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443/runs/ad8b8333a1144fc4b63b14163f642e32/12__c2a_wan_00008.mp4", $Out = 'd:\infinite-canvas-main\tmp-task13\test5s_5B_wan22-ti2v-5b.mp4')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$token = '255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006'
$headers = @{ Authorization = "Bearer $token" }

Invoke-WebRequest -Uri $Url -Headers $headers -OutFile $Out -UseBasicParsing -TimeoutSec 600
$f = Get-Item $Out
Write-Output ("DOWNLOAD OK: " + $f.Name + " size=" + $f.Length + " bytes lastWrite=" + $f.LastWriteTime)
