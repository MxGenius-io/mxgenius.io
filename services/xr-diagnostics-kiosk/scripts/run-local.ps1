[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 8844,
  [switch]$NoBrowser,
  [switch]$NoSimulator
)

$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $serviceRoot 'backend'
$venvRoot = Join-Path $serviceRoot '.venv'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
$runtimeRoot = Join-Path $serviceRoot '.local'
$baseUrl = "http://127.0.0.1:$Port"

if (-not (Test-Path -LiteralPath $venvPython)) {
  $python = Get-Command python -ErrorAction Stop
  Write-Host 'Creating local diagnostics environment...'
  & $python.Source -m venv $venvRoot
}

& $venvPython -c 'import fastapi, uvicorn, websockets' 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Installing local diagnostics dependencies...'
  & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $serviceRoot 'requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$backendOut = Join-Path $runtimeRoot 'backend.stdout.log'
$backendErr = Join-Path $runtimeRoot 'backend.stderr.log'
$backend = Start-Process -FilePath $venvPython `
  -ArgumentList @('-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', "$Port") `
  -WorkingDirectory $backendRoot `
  -RedirectStandardOutput $backendOut `
  -RedirectStandardError $backendErr `
  -WindowStyle Hidden `
  -PassThru

$simulator = $null
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if ($backend.HasExited) {
      throw "Diagnostics bridge exited during startup. See $backendErr"
    }
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/v1/health" -TimeoutSec 1
      if ($health.status -eq 'ok') { $ready = $true; break }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) { throw "Diagnostics bridge did not become healthy. See $backendErr" }

  if (-not $NoSimulator) {
    $simulatorOut = Join-Path $runtimeRoot 'simulator.stdout.log'
    $simulatorErr = Join-Path $runtimeRoot 'simulator.stderr.log'
    $simulator = Start-Process -FilePath $venvPython `
      -ArgumentList @((Join-Path $PSScriptRoot 'simulate_sensor.py'), '--url', "ws://127.0.0.1:$Port/ws/ingest", '--seconds', '86400') `
      -WorkingDirectory $serviceRoot `
      -RedirectStandardOutput $simulatorOut `
      -RedirectStandardError $simulatorErr `
      -WindowStyle Hidden `
      -PassThru
  }

  if (-not $NoBrowser) { Start-Process $baseUrl }
  Write-Host "MXG diagnostics is live at $baseUrl"
  Write-Host "Backend PID: $($backend.Id)"
  if ($simulator) { Write-Host "Synthetic thermal PID: $($simulator.Id)" }
  Write-Host "Logs: $runtimeRoot"
  Write-Host 'Press Ctrl+C to stop the local stack.'
  Wait-Process -Id $backend.Id
} finally {
  if ($simulator -and -not $simulator.HasExited) { Stop-Process -Id $simulator.Id -Force }
  if (-not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
}
