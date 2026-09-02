$urls = @(
    "http://127.0.0.1:3000/",
    "http://127.0.0.1:3000/api/v1/comfy/workflows",
    "http://127.0.0.1:3000/api/v1/media-proxy"
)
foreach ($u in $urls) {
    try {
        $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop
        Write-Output ("URL " + $u + " => " + $r.StatusCode)
        Write-Output ("BODY " + $r.Content.Substring(0, [Math]::Min(300, $r.Content.Length)))
    } catch {
        $resp = $_.Exception.Response
        if ($resp) {
            $code = [int]$resp.StatusCode
            $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $body = $sr.ReadToEnd()
            Write-Output ("URL " + $u + " => " + $code)
            Write-Output ("BODY " + $body.Substring(0, [Math]::Min(300, $body.Length)))
        } else {
            Write-Output ("URL " + $u + " => ERROR " + $_.Exception.Message)
        }
    }
    Write-Output "---"
}
