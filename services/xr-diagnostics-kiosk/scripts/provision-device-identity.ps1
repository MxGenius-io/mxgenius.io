[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z]:$')]
  [string]$Drive = 'E:',
  [ValidateLength(1, 120)]
  [string]$DisplayName = 'MXG Pi'
)

$ErrorActionPreference = 'Stop'
$driveRoot = "$Drive\"
$resolvedRoot = (Resolve-Path -LiteralPath $driveRoot).Path
if ($resolvedRoot -notmatch '^[A-Za-z]:\\$') {
  throw "Refusing to provision outside a drive root: $resolvedRoot"
}

$issuePath = Join-Path $resolvedRoot 'issue.txt'
$cmdlinePath = Join-Path $resolvedRoot 'cmdline.txt'
if (-not (Test-Path -LiteralPath $issuePath) -or -not (Test-Path -LiteralPath $cmdlinePath)) {
  throw "The target does not look like a Raspberry Pi boot partition: $resolvedRoot"
}
if ((Get-Content -LiteralPath $issuePath -Raw) -notmatch 'Raspberry Pi') {
  throw "The target issue.txt does not identify Raspberry Pi OS: $resolvedRoot"
}

$identityPath = Join-Path $resolvedRoot 'mxg-device-identity.json'
if (Test-Path -LiteralPath $identityPath) {
  $existing = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
  if ($existing.schemaVersion -ne 1 -or [string]$existing.hardwareId -notmatch '^mxg-pi-[0-9a-f]{32}$') {
    throw "The existing device identity is invalid; it was not replaced: $identityPath"
  }
  Write-Output ([pscustomobject]@{
    HardwareId = [string]$existing.hardwareId
    IdentityPath = $identityPath
    Created = $false
  })
  exit 0
}

$hardwareId = "mxg-pi-$([Guid]::NewGuid().ToString('N'))"
$identity = [ordered]@{
  schemaVersion = 1
  hardwareId = $hardwareId
  displayName = $DisplayName.Trim()
  issuedAtUtc = [DateTime]::UtcNow.ToString('o')
  source = 'commissioning-drive'
}
$json = $identity | ConvertTo-Json
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($identityPath, "$json`n", $utf8NoBom)

$verified = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
if ([string]$verified.hardwareId -ne $hardwareId) {
  throw "The device identity could not be verified after writing: $identityPath"
}

Write-Output ([pscustomobject]@{
  HardwareId = $hardwareId
  IdentityPath = $identityPath
  Created = $true
})
