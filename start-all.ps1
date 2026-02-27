param(
  [string]$ApiKey = $env:LM_STUDIO_API_KEY,
  [string]$LmStudioUrl = $env:LM_STUDIO_URL,
  [int]$MaxHealthWaitSeconds = 25,
  [switch]$KeepRunningProcesses
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendOutLog = Join-Path $RepoRoot 'backend\backend-runtime.out.log'
$BackendErrLog = Join-Path $RepoRoot 'backend\backend-runtime.err.log'
$FrontendOutLog = Join-Path $RepoRoot 'frontend\frontend-runtime.out.log'
$FrontendErrLog = Join-Path $RepoRoot 'frontend\frontend-runtime.err.log'

function Stop-PortProcess {
  param([int]$Port)
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
      if ($conn.OwningProcess -and $conn.OwningProcess -ne 0) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    # no listener / command unavailable
  }
}

function Invoke-JsonGet {
  param(
    [string]$Url,
    [hashtable]$Headers = @{},
    [int]$TimeoutSeconds = 4
  )

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    $args = @('-s', '--max-time', "$TimeoutSeconds")
    foreach ($k in $Headers.Keys) {
      $args += '-H'
      $args += ("{0}: {1}" -f $k, $Headers[$k])
    }
    $args += $Url
    $raw = & curl.exe @args
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
      return @{ ok = $false; raw = ''; error = "curl exit $LASTEXITCODE" }
    }
    return @{ ok = $true; raw = $raw; error = '' }
  }

  try {
    $resp = Invoke-WebRequest -Uri $Url -Headers $Headers -TimeoutSec $TimeoutSeconds
    return @{ ok = $true; raw = $resp.Content; error = '' }
  } catch {
    return @{ ok = $false; raw = ''; error = $_.Exception.Message }
  }
}

function Test-LmStudioAuth {
  param([string]$Url, [string]$Key)

  $r = Invoke-JsonGet -Url "$Url/api/v1/models" -Headers @{ Authorization = "Bearer $Key" } -TimeoutSeconds 4
  if (-not $r.ok) {
    return @{ ok = $false; message = $r.error }
  }

  if ($r.raw -match '"models"' -or $r.raw -match '"data"') {
    return @{ ok = $true; message = 'ok' }
  }

  if ($r.raw -match 'invalid_api_key' -or $r.raw -match '401') {
    return @{ ok = $false; message = $r.raw }
  }

  return @{ ok = $false; message = $r.raw }
}

function Get-BackendHealthState {
  $r = Invoke-JsonGet -Url 'http://localhost:3001/api/health' -TimeoutSeconds 2
  if (-not $r.ok) {
    return @{ state = 'unreachable'; message = $r.error }
  }

  try {
    $body = $r.raw | ConvertFrom-Json
    if ($body.ok -eq $true) {
      return @{ state = 'healthy'; message = 'ok' }
    }
    return @{ state = 'unhealthy'; message = ($body.error | Out-String).Trim() }
  } catch {
    if ($r.raw -match 'invalid_api_key' -or $r.raw -match '401') {
      return @{ state = 'unhealthy'; message = $r.raw }
    }
    return @{ state = 'unreachable'; message = 'health returned non-json' }
  }
}

if (-not $ApiKey) {
  Write-Host 'LM_STUDIO_API_KEY is not set.' -ForegroundColor Red
  Write-Host "Run: .\start-all.ps1 -ApiKey 'your-token'" -ForegroundColor Yellow
  exit 1
}

if (-not $LmStudioUrl) {
  $LmStudioUrl = 'http://localhost:7002'
}

Write-Host "Checking LM Studio auth at $LmStudioUrl ..." -ForegroundColor Cyan
$lmTest = Test-LmStudioAuth -Url $LmStudioUrl -Key $ApiKey
if (-not $lmTest.ok) {
  Write-Host 'LM Studio auth check failed. Backend would stay unhealthy.' -ForegroundColor Red
  Write-Host $lmTest.message -ForegroundColor Yellow
  exit 1
}
Write-Host 'LM Studio auth looks good.' -ForegroundColor Green

if (-not $KeepRunningProcesses) {
  Stop-PortProcess -Port 3001
  Stop-PortProcess -Port 3000
}

$apiKeyEscaped = $ApiKey.Replace('"', '\"')
$urlEscaped = $LmStudioUrl.Replace('"', '\"')

Write-Host "Starting backend (out: $BackendOutLog) ..." -ForegroundColor Cyan
$backendCmd = ('set "LM_STUDIO_API_KEY={0}" && set "LM_STUDIO_URL={1}" && npm --prefix backend start' -f $apiKeyEscaped, $urlEscaped)
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $backendCmd -WorkingDirectory $RepoRoot -WindowStyle Minimized -RedirectStandardOutput $BackendOutLog -RedirectStandardError $BackendErrLog | Out-Null

Write-Host "Starting frontend (out: $FrontendOutLog) ..." -ForegroundColor Cyan
$frontendCmd = 'npm --prefix frontend run dev -- --host 0.0.0.0 --port 3000'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $frontendCmd -WorkingDirectory $RepoRoot -WindowStyle Minimized -RedirectStandardOutput $FrontendOutLog -RedirectStandardError $FrontendErrLog | Out-Null

Write-Host 'Waiting for backend health check...' -ForegroundColor Cyan
$healthy = $false
for ($i = 1; $i -le $MaxHealthWaitSeconds; $i++) {
  $h = Get-BackendHealthState
  if ($h.state -eq 'healthy') {
    $healthy = $true
    break
  }

  Write-Host ("  attempt {0}/{1}: {2}" -f $i, $MaxHealthWaitSeconds, $h.state) -ForegroundColor DarkGray

  if ($h.state -eq 'unhealthy' -and ($h.message -match '401' -or $h.message -match 'invalid_api_key')) {
    Write-Host 'Backend is up but LM Studio rejected the API key.' -ForegroundColor Red
    Write-Host $h.message -ForegroundColor Yellow
    break
  }

  Start-Sleep -Seconds 1
}

if ($healthy) {
  Write-Host 'Backend is healthy.' -ForegroundColor Green
} else {
  Write-Host 'Backend is not healthy yet.' -ForegroundColor Yellow
  Write-Host "Check backend logs: $BackendOutLog / $BackendErrLog" -ForegroundColor Yellow
  if (Test-Path $BackendErrLog) {
    Write-Host 'Last backend error lines:' -ForegroundColor DarkYellow
    Get-Content $BackendErrLog -Tail 20
  }
}

Write-Host ''
Write-Host 'Open frontend: http://localhost:3000' -ForegroundColor Green
Write-Host 'Remote URL:    http://<your-tailscale-ip>:3000' -ForegroundColor Green
Write-Host 'Unity MCP URL: http://<your-host-ip>:3010' -ForegroundColor DarkCyan
