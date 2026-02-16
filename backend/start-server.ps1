param(
  [int]$Port = 5501
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateFile = Join-Path $root ".server.json"

function Get-ListeningPid([int]$p) {
  try {
    $line = netstat -ano -p tcp |
      Select-String -Pattern ":$p\s" |
      Where-Object { $_.ToString() -match "LISTENING" } |
      Select-Object -First 1
    if ($line) {
      $tokens = ($line.ToString() -split "\s+") | Where-Object { $_ }
      if ($tokens.Count -gt 0 -and $tokens[-1] -match "^\d+$") {
        return [int]$tokens[-1]
      }
    }
  } catch {
  }
  return $null
}

function Test-PulseHealth([int]$p) {
  try {
    $resp = Invoke-RestMethod -Uri "http://localhost:$p/health" -Method Get -TimeoutSec 3
    return ($resp.ok -eq $true -and $resp.service -eq "pulse-music-proxy")
  } catch {
    return $false
  }
}

if (Test-Path $stateFile) {
  try {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    if ($state.pid -and (Get-Process -Id $state.pid -ErrorAction SilentlyContinue) -and (Test-PulseHealth $state.port)) {
      Write-Output "Pulse server already running at http://localhost:$($state.port) (PID=$($state.pid))"
      exit 0
    }
  } catch {
  }
  Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
}

if (Test-PulseHealth $Port) {
  $existingPid = Get-ListeningPid $Port
  $stateObj = [pscustomobject]@{ pid = $existingPid; port = $Port }
  $stateObj | ConvertTo-Json | Set-Content $stateFile
  if ($existingPid) {
    Write-Output "Pulse server already running at http://localhost:$Port (PID=$existingPid)"
  } else {
    Write-Output "Pulse server already running at http://localhost:$Port"
  }
  exit 0
}

$inUsePid = Get-ListeningPid $Port
if ($inUsePid) {
  $procName = "unknown"
  try {
    $procName = (Get-Process -Id $inUsePid -ErrorAction Stop).ProcessName
  } catch {
  }
  Write-Output "Port $Port is already in use by PID=$inUsePid ($procName). Try: .\\start-server.ps1 -Port 5501"
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required to run this project server."
}

$proc = Start-Process -FilePath "node" -ArgumentList @("server.js", "--port", "$Port") -WorkingDirectory $root -PassThru

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 350
  if (Test-PulseHealth $Port) {
    $ok = $true
    break
  }
}

if (-not $ok) {
  Write-Output "Server process started (PID=$($proc.Id)) but health check failed."
  exit 1
}

$stateObj = [pscustomobject]@{ pid = $proc.Id; port = $Port }
$stateObj | ConvertTo-Json | Set-Content $stateFile
Write-Output "Started Pulse server: http://localhost:$Port (PID=$($proc.Id))"
