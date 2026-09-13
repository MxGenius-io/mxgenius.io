[CmdletBinding()]
param(
  [ValidatePattern('^mxg-pi-[0-9a-f]{32}$')]
  [Parameter(Mandatory = $true)]
  [string]$HardwareId,

  [ValidatePattern('^[a-z][a-z0-9-]{0,62}$')]
  [string]$Hostname = 'mxgenius-pi-01',

  [string]$BaseImage = 'D:\AAog\tooling\raspios\2026-06-18-raspios-trixie-arm64.img.xz',
  [string]$OutputDirectory = 'D:\AAog\artifacts\mxgenius-pi',
  [string]$SshKey = 'D:\AAog\.secrets\mxgenius-pi-admin',
  [string]$NetworkConfig = ''
)

$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$baseConfigPath = Join-Path $serviceRoot 'image\base-image.env'
$releasePath = Join-Path $serviceRoot '.preview\release'
$version = (Get-Content -LiteralPath (Join-Path $serviceRoot 'VERSION') -Raw).Trim()

function ConvertTo-WslPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if ($fullPath -notmatch '^([A-Za-z]):\\(.*)$') {
    throw "Only absolute local drive paths can enter the WSL image builder: $fullPath"
  }
  $drive = $Matches[1].ToLowerInvariant()
  $suffix = $Matches[2].Replace('\', '/')
  return "/mnt/$drive/$suffix"
}

if (-not (Test-Path -LiteralPath $BaseImage -PathType Leaf)) { throw "Pinned base image not found: $BaseImage" }
if (-not (Test-Path -LiteralPath $baseConfigPath -PathType Leaf)) { throw "Base image contract missing: $baseConfigPath" }

$baseConfig = @{}
Get-Content -LiteralPath $baseConfigPath | Where-Object { $_ -match '^[A-Z0-9_]+=' } | ForEach-Object {
  $key, $value = $_ -split '=', 2
  $baseConfig[$key] = $value
}
$expectedHash = $baseConfig.MXG_BASE_IMAGE_SHA256
if ((Get-FileHash -LiteralPath $BaseImage -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
  throw 'Pinned Raspberry Pi OS image checksum does not match the repository contract.'
}

$sshPublicKey = "$SshKey.pub"
if (-not (Test-Path -LiteralPath $SshKey) -or -not (Test-Path -LiteralPath $sshPublicKey)) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $SshKey) -Force | Out-Null
  & ssh-keygen.exe -q -t ed25519 -N '' -C 'mxgenius-local-appliance-admin' -f $SshKey
  if ($LASTEXITCODE -ne 0) { throw 'Could not generate the local appliance SSH key.' }
  & icacls.exe $SshKey /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
}

& (Join-Path $PSScriptRoot 'preview-release.ps1') -TestOnly -NoBrowser
if ($LASTEXITCODE -ne 0) { throw 'The exact release payload did not pass preflight.' }

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$outputPath = Join-Path $OutputDirectory "mxgenius-pi-$version-$($HardwareId.Substring($HardwareId.Length - 8)).img.xz"
$linux = @{
  Base = ConvertTo-WslPath $BaseImage
  Release = ConvertTo-WslPath $releasePath
  Output = ConvertTo-WslPath $outputPath
  PublicKey = ConvertTo-WslPath $sshPublicKey
  Script = ConvertTo-WslPath (Join-Path $PSScriptRoot 'build-appliance-image.sh')
}
$arguments = @(
  '-d', 'Ubuntu', '-u', 'root', '--', 'bash', $linux.Script,
  '--base', $linux.Base,
  '--release', $linux.Release,
  '--output', $linux.Output,
  '--hardware-id', $HardwareId,
  '--hostname', $Hostname,
  '--ssh-public-key', $linux.PublicKey,
  '--expected-sha256', $expectedHash
)
if ($NetworkConfig) {
  if (-not (Test-Path -LiteralPath $NetworkConfig -PathType Leaf)) { throw "Network configuration not found: $NetworkConfig" }
  $arguments += @('--network-config', (ConvertTo-WslPath $NetworkConfig))
}

& wsl.exe @arguments
if ($LASTEXITCODE -ne 0) { throw "Appliance image build failed with exit code $LASTEXITCODE." }

$artifact = Get-Item -LiteralPath $outputPath
$metadata = Get-Content -LiteralPath "$outputPath.json" -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.imageSha256) {
  throw 'Final appliance image checksum verification failed on Windows.'
}
Write-Host "MXG appliance image ready: $($artifact.FullName)" -ForegroundColor Green
Write-Host "SHA-256: $($metadata.imageSha256)"
