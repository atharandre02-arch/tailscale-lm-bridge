$ErrorActionPreference = 'SilentlyContinue'

function Stop-PortProcess {
  param([int]$Port)
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $conns) {
    if ($conn.OwningProcess -and $conn.OwningProcess -ne 0) {
      Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped PID $($conn.OwningProcess) on port $Port"
    }
  }
}

Stop-PortProcess -Port 3001
Stop-PortProcess -Port 3000
Write-Host "Done."
