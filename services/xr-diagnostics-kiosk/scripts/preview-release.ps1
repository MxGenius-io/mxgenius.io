[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 8844,
  [switch]$NoBrowser,
  [switch]$TestOnly
)

$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$releaseListPath = Join-Path $serviceRoot 'release-files.txt'
$previewBase = Join-Path $serviceRoot '.preview'
$previewRoot = Join-Path $previewBase 'release'
$manifestPath = Join-Path $previewBase 'preview-manifest.json'
$venvRoot = Join-Path $serviceRoot '.venv'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
$baseUrl = "http://127.0.0.1:$Port"

function Get-ReleaseItems {
  if (-not (Test-Path -LiteralPath $releaseListPath)) { throw "Release list not found: $releaseListPath" }
  $items = Get-Content -LiteralPath $releaseListPath |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') }
  if (-not $items) { throw 'The release file list is empty.' }
  foreach ($item in $items) {
    if ([System.IO.Path]::IsPathRooted($item) -or $item -match '(^|[\\/])\.\.([\\/]|$)') {
      throw "Unsafe release path: $item"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $serviceRoot $item))) {
      throw "Release item is missing: $item"
    }
  }
  return $items
}

$releaseItems = @(Get-ReleaseItems)
$serviceBoundary = [System.IO.Path]::GetFullPath("$serviceRoot\")
$resolvedPreview = [System.IO.Path]::GetFullPath($previewRoot)
if (-not $resolvedPreview.StartsWith($serviceBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Preview path escaped the service root: $resolvedPreview"
}

$portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $portProbe.Start() } catch { throw "Port $Port is already in use. Close the other preview or choose -Port <number>." } finally { $portProbe.Stop() }

if (Test-Path -LiteralPath $previewRoot) { Remove-Item -LiteralPath $resolvedPreview -Recurse -Force }
New-Item -ItemType Directory -Path $previewRoot -Force | Out-Null
foreach ($item in $releaseItems) {
  $sourceItem = Join-Path $serviceRoot $item
  $targetItem = Join-Path $previewRoot $item
  $targetParent = Split-Path -Parent $targetItem
  New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
  Copy-Item -LiteralPath $sourceItem -Destination $targetItem -Recurse -Force
}

$previewBoundary = [System.IO.Path]::GetFullPath("$previewRoot\")
Get-ChildItem -LiteralPath $previewRoot -Directory -Filter '__pycache__' -Recurse | ForEach-Object {
  $cachePath = [System.IO.Path]::GetFullPath($_.FullName)
  if (-not $cachePath.StartsWith($previewBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Generated cache path escaped the preview root: $cachePath"
  }
  Remove-Item -LiteralPath $cachePath -Recurse -Force
}
Get-ChildItem -LiteralPath $previewRoot -File -Recurse | Where-Object { $_.Extension -in @('.pyc', '.pyo') } | ForEach-Object {
  $generatedPath = [System.IO.Path]::GetFullPath($_.FullName)
  if (-not $generatedPath.StartsWith($previewBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Generated Python file escaped the preview root: $generatedPath"
  }
  Remove-Item -LiteralPath $generatedPath -Force
}

$manifest = Get-ChildItem -LiteralPath $previewRoot -File -Recurse |
  Sort-Object FullName |
  ForEach-Object {
    [PSCustomObject]@{
      Path = $_.FullName.Substring($previewRoot.Length + 1).Replace('\', '/')
      Size = $_.Length
      Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
New-Item -ItemType Directory -Path $previewBase -Force | Out-Null
[System.IO.File]::WriteAllText(
  $manifestPath,
  "$($manifest | ConvertTo-Json -Depth 3)`n",
  [System.Text.UTF8Encoding]::new($false)
)

$version = (Get-Content -Raw -LiteralPath (Join-Path $previewRoot 'VERSION')).Trim()
$totalBytes = ($manifest | Measure-Object -Property Size -Sum).Sum
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ' MXGENIUS DIAGNOSTICS — EXACT FLASH PAYLOAD PREVIEW' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host "Version : $version"
Write-Host "Files   : $($manifest.Count)"
Write-Host "Bytes   : $totalBytes"
Write-Host "Payload : $previewRoot"
Write-Host "Manifest: $manifestPath"
Write-Host ''

$bashCandidates = @(
  'C:\Program Files\Git\bin\bash.exe',
  'C:\Program Files\Git\usr\bin\bash.exe',
  'C:\Program Files (x86)\Git\bin\bash.exe'
)
$gitBash = $bashCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($gitBash) {
  Push-Location $previewRoot
  try {
    & $gitBash -n install.sh update.sh mxg-firstboot.sh
    if ($LASTEXITCODE -ne 0) { throw 'A Raspberry Pi shell script failed its syntax check.' }
  } finally { Pop-Location }
  Write-Host '[preflight] Raspberry Pi shell scripts parsed.' -ForegroundColor Green
} else {
  Write-Warning 'Git Bash was not found; Raspberry Pi shell syntax was not checked on this machine.'
}

if (-not (Test-Path -LiteralPath $venvPython)) {
  $python = Get-Command python -ErrorAction Stop
  Write-Host '[1/5] Creating the isolated preview environment...'
  & $python.Source -m venv $venvRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the preview environment.' }
}

& $venvPython -c 'import fastapi, uvicorn, websockets' 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host '[1/5] Installing preview dependencies...'
  & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $previewRoot 'requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Preview dependency installation failed.' }
} else {
  Write-Host '[1/5] Preview dependencies ready.' -ForegroundColor Green
}

$backendJob = $null
$simulatorJob = $null
try {
  Write-Host '[2/5] Starting the staged diagnostics bridge...'
  $backendJob = Start-Job -ScriptBlock {
    param($PythonPath, $BackendPath, $ListenPort)
    $env:PYTHONDONTWRITEBYTECODE = '1'
    Set-Location -LiteralPath $BackendPath
    & $PythonPath -m uvicorn app:app --host 127.0.0.1 --port $ListenPort
    if ($LASTEXITCODE -ne 0) { throw "uvicorn exited with code $LASTEXITCODE" }
  } -ArgumentList $venvPython, (Join-Path $previewRoot 'backend'), $Port

  $healthy = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    if ($backendJob.State -notin @('Running', 'NotStarted')) { break }
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/v1/health" -TimeoutSec 1
      if ($health.status -eq 'ok') { $healthy = $true; break }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $healthy) { throw 'The staged diagnostics bridge did not become healthy.' }
  if ($health.version -ne $version) { throw "Version mismatch: payload=$version service=$($health.version)" }
  Write-Host "[2/5] Bridge healthy: $version" -ForegroundColor Green

  Write-Host '[3/5] Running HTTP, schema, state, and WebSocket checks...'
  & $venvPython (Join-Path $previewRoot 'scripts\smoke_test.py') --base-url $baseUrl
  if ($LASTEXITCODE -ne 0) { throw 'Release smoke test failed.' }

  Write-Host '[4/5] Starting the synthetic MXGS/1 thermal source...'
  $simulatorJob = Start-Job -ScriptBlock {
    param($PythonPath, $SimulatorPath, $SocketUrl, $Seconds)
    $env:PYTHONDONTWRITEBYTECODE = '1'
    & $PythonPath $SimulatorPath --url $SocketUrl --seconds $Seconds --fps 8
    if ($LASTEXITCODE -ne 0) { throw "thermal simulator exited with code $LASTEXITCODE" }
  } -ArgumentList $venvPython, (Join-Path $previewRoot 'scripts\simulate_sensor.py'), "ws://127.0.0.1:$Port/ws/ingest", $(if ($TestOnly) { 3 } else { 86400 })

  $thermalReady = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 200
    $health = Invoke-RestMethod -Uri "$baseUrl/api/v1/health" -TimeoutSec 1
    if ($health.bridge.thermalFrames -gt 0) { $thermalReady = $true; break }
  }
  if (-not $thermalReady) { throw 'Synthetic thermal frames did not reach the staged bridge.' }
  Write-Host "[4/5] Thermal relay verified: $($health.bridge.thermalFrames) frame(s)" -ForegroundColor Green

  $currentManifest = Get-ChildItem -LiteralPath $previewRoot -File -Recurse |
    Sort-Object FullName |
    ForEach-Object {
      [PSCustomObject]@{
        Path = $_.FullName.Substring($previewRoot.Length + 1).Replace('\', '/')
        Size = $_.Length
        Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    }
  $integrityDelta = @(Compare-Object -ReferenceObject $manifest -DifferenceObject $currentManifest -Property Path, Size, Sha256)
  if ($integrityDelta.Count) { throw 'The staged payload changed while its tests were running.' }

  Write-Host '[5/5] Exact release preview passed.' -ForegroundColor Green
  if ($TestOnly) { return }

  if (-not $NoBrowser) { Start-Process "$baseUrl/?preview=release" }
  Write-Host ''
  Write-Host "PREVIEW LIVE: $baseUrl" -ForegroundColor Cyan
  Write-Host 'This browser is running the exact staged release payload.'
  Write-Host 'Press Ctrl+C or close this console to stop the bridge and simulator.'
  while ($backendJob.State -eq 'Running') { Start-Sleep -Seconds 1 }
  throw 'The preview bridge stopped unexpectedly.'
} catch {
  Write-Host ''
  Write-Host "PREVIEW FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($backendJob) { Receive-Job -Job $backendJob -Keep -ErrorAction SilentlyContinue }
  if ($simulatorJob) { Receive-Job -Job $simulatorJob -Keep -ErrorAction SilentlyContinue }
  throw
} finally {
  foreach ($job in @($simulatorJob, $backendJob)) {
    if ($job) {
      Stop-Job -Job $job -ErrorAction SilentlyContinue
      Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
  }
}
