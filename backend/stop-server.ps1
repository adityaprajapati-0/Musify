param(
  [int]$Port = 0
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
  }
  catch {
  }
  return $null
}

$stopped = $false

if (Test-Path $stateFile) {
  try {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    if ($state.pid -and (Get-Process -Id $state.pid -ErrorAction SilentlyContinue)) {
      Stop-Process -Id $state.pid -Force
      Write-Output "Stopped Musify server PID=$($state.pid)"
      $stopped = $true
    }
  }
  catch {
  }
  Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
}

if (-not $stopped -and $Port -gt 0) {
  $processId = Get-ListeningPid $Port
  if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $processId -Force
    Write-Output "Stopped process listening on port $Port (PID=$processId)"
    $stopped = $true
  }
}

if (-not $stopped) {
  Write-Output "No Musify server process found to stop."
}
