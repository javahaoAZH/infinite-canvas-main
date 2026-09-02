# 任务 #3 收尾：补交 seconds=4 的 14B 边界测试（图片复用服务端 stored_input）
$ErrorActionPreference = 'Stop'
$base = 'https://u399822-85b3-74c9a625.nmb1.seetacloud.com:8443'
$token = '255e2e14ac50edf9bac8fa74e44b1b619e7ef73e82663f59cebb7b4a51e3b006'

$form = @{
    model   = 'wan22-i2v-14b'
    prompt  = '画面中的人物缓缓转身，发丝随风飘动，镜头保持平稳，自然光变化'
    seconds = '4'
    size    = '1280x720'
    input_reference = Get-Item 'd:\infinite-canvas-main\_tmp_small.png'
}
try {
    $r = Invoke-RestMethod -Uri "$base/v1/videos" -Method Post -Headers @{ Authorization = "Bearer $token" } -Form $form -TimeoutSec 120
    Write-Output ('SUBMIT OK: ' + ($r | ConvertTo-Json -Compress))
} catch {
    Write-Output ('SUBMIT ERROR: ' + $_.Exception.Message)
    if ($_.Exception.Response) {
        try {
            $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            Write-Output ('BODY: ' + $sr.ReadToEnd())
        } catch {}
    }
}
