foreach ($p in 8080, 3000) {
    $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($c) {
        foreach ($x in $c) {
            $proc = Get-Process -Id $x.OwningProcess -ErrorAction SilentlyContinue
            Write-Output ("PORT {0} PID {1} Name {2}" -f $p, $x.OwningProcess, $proc.ProcessName)
        }
    } else {
        Write-Output ("PORT {0} free" -f $p)
    }
}
