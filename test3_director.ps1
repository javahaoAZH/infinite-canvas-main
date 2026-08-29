$ErrorActionPreference = 'Stop'
[Console]
Write-Output "Testing http://127.0.0.1:18080/director/index.html"
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:18080/director/index.html'
    Write-Output ("STATUS: " + $r.StatusCode)
    Write-Output ("ContentType: " + $r.Headers['Content-Type'])
    Write-Output ("Length: " +
        $r.Content.Length)
} catch {
    $msg = $_.Exception.Message
    Write-Output ("CAUGHT: " + $msg)
    $resp = $null
    if ($null -ne $_.Exception) {
        $ex = $_.Exception
        while ($null -ne $ex -and $resp -eq $null) {
            if ($ex -is [System.Net.HttpException] -and $ex.StatusCode) { $resp = $ex; break }
            $ex = $ex.InnerException
        }
    }
    Write-Output ("InnerChain: " + (Get-ExceptionChain -Error $Error -ErrorAction Error).Message)
}
function Get-ExceptionChain {
    param([Object]$Error)
    $out = $null
    $cur = $Error
    while ($null -ne $cur) {
        $msg = $cur.GetType().Name
        $msg += ": " + $cur.Message
        if ($null -ne $msg -and $msg.StartsWith('Cannot find')) {
            $out = [PSCustomObject]@{ Type = 'NotFound'; Message = "NOTFOUND_302??" }
        } else {
            $out = [PSCustomObject]@{ Type = $cur.GetType().FullName; Message = $cur.Message }
        }
        $cur = $cur.InnerException
        if ($cur -ne $null -and $out.Message -match 'Cannot find') { break }
    }
    return $out
}
