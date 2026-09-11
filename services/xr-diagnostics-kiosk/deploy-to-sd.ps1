param(
  [Parameter(Mandatory = $false)]
  [ValidatePattern('^[A-Za-z]:$')]
  [string]$Drive = 'E:',

  [ValidatePattern('^[a-z][a-z0-9_-]{0,30}$')]
  [string]$UserName = '',

  [string]$PasswordHash = '',

  [switch]$EnableSsh,

  [switch]$EnableUsbGadget
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath("$Drive\")
$expectedRoot = "$Drive\"
if ($root -ne $expectedRoot) {
  throw "Resolved SD root '$root' does not match '$expectedRoot'."
}

$issuePath = Join-Path $root 'issue.txt'
$cmdlinePath = Join-Path $root 'cmdline.txt'
$userDataPath = Join-Path $root 'user-data'
$metaDataPath = Join-Path $root 'meta-data'
if (-not (Test-Path -LiteralPath $issuePath) -or -not (Test-Path -LiteralPath $cmdlinePath)) {
  throw "The target does not look like a Raspberry Pi boot partition."
}
if ((Get-Content -Raw -LiteralPath $issuePath) -notmatch 'Raspberry Pi') {
  throw "The target issue.txt does not identify a Raspberry Pi image."
}
if ((Get-Content -Raw -LiteralPath $cmdlinePath) -notmatch 'root=PARTUUID=') {
  throw "The target cmdline.txt does not contain a Raspberry Pi root partition."
}
if (-not (Test-Path -LiteralPath $userDataPath) -or -not (Test-Path -LiteralPath $metaDataPath)) {
  throw 'The target is missing Raspberry Pi Imager cloud-init seed files.'
}
if ([bool]$UserName -ne [bool]$PasswordHash) {
  throw 'UserName and PasswordHash must be provided together.'
}
if ($PasswordHash -and (-not $PasswordHash.StartsWith('$6$') -or $PasswordHash -match '[:\r\n]')) {
  throw 'PasswordHash must be a single OpenSSL SHA-512 crypt value generated with: openssl passwd -6'
}

$source = $PSScriptRoot
$releaseListPath = Join-Path $source 'release-files.txt'
$destination = Join-Path $root 'mxg-diagnostics-kiosk'
$legacy = Join-Path $root 'eve-kiosk'
$legacyInstaller = Join-Path $root 'firstrun.sh'
$firstBoot = Join-Path $root 'mxg-firstboot.sh'
$firstBootStatus = Join-Path $root 'mxg-firstboot.status'

foreach ($target in @($destination, $legacy)) {
  if (Test-Path -LiteralPath $target) {
    $resolved = [System.IO.Path]::GetFullPath($target)
    if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove path outside the SD root: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
if (Test-Path -LiteralPath $legacyInstaller) {
  Remove-Item -LiteralPath $legacyInstaller -Force
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
$payloadItems = @(Get-Content -LiteralPath $releaseListPath | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
foreach ($item in $payloadItems) {
  if ([System.IO.Path]::IsPathRooted($item) -or $item -match '(^|[\\/])\.\.([\\/]|$)') { throw "Unsafe payload item: $item" }
  $sourceItem = Join-Path $source $item
  if (-not (Test-Path -LiteralPath $sourceItem)) { throw "Required payload item is missing: $sourceItem" }
  $destinationItem = Join-Path $destination $item
  New-Item -ItemType Directory -Path (Split-Path -Parent $destinationItem) -Force | Out-Null
  Copy-Item -LiteralPath $sourceItem -Destination $destinationItem -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $source 'mxg-firstboot.sh') -Destination $firstBoot -Force

# Git checkouts on Windows may materialize executable shell files with CRLF.
# A direct systemd.run launch then resolves the shebang as /usr/bin/env bash\r
# and silently falls through to the previously installed kiosk. Normalize every
# packaged shell entry before the card leaves Windows.
$shellFiles = @($firstBoot) + @(Get-ChildItem -LiteralPath $destination -File -Filter '*.sh' -Recurse | Select-Object -ExpandProperty FullName)
foreach ($shellFile in $shellFiles) {
  $content = [System.IO.File]::ReadAllText($shellFile)
  $content = $content.Replace("`r`n", "`n").Replace("`r", "`n")
  [System.IO.File]::WriteAllText($shellFile, $content, [System.Text.UTF8Encoding]::new($false))
  $prefix = [System.IO.File]::ReadAllBytes($shellFile)
  if ($prefix.Length -lt 3 -or $prefix[0] -ne 0x23 -or $prefix[1] -ne 0x21 -or $prefix[2] -ne 0x2f) {
    throw "Packaged shell file has an invalid executable shebang: $shellFile"
  }
}
Get-ChildItem -LiteralPath $destination -Directory -Filter '__pycache__' -Recurse | ForEach-Object {
  $cachePath = [System.IO.Path]::GetFullPath($_.FullName)
  if (-not $cachePath.StartsWith($destination, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove generated cache outside the payload: $cachePath"
  }
  Remove-Item -LiteralPath $cachePath -Recurse -Force
}
Get-ChildItem -LiteralPath $destination -File -Recurse | Where-Object { $_.Extension -in @('.pyc', '.pyo') } | ForEach-Object {
  $generatedPath = [System.IO.Path]::GetFullPath($_.FullName)
  if (-not $generatedPath.StartsWith($destination, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove generated file outside the payload: $generatedPath"
  }
  Remove-Item -LiteralPath $generatedPath -Force
}

if ($UserName) {
  [System.IO.File]::WriteAllText((Join-Path $root 'userconf.txt'), "${UserName}:$PasswordHash`n", [System.Text.UTF8Encoding]::new($false))
}
if ($EnableSsh) {
  [System.IO.File]::WriteAllBytes((Join-Path $root 'ssh'), [byte[]]@())
}

$cmdline = (Get-Content -Raw -LiteralPath $cmdlinePath).Trim()
$cmdline = $cmdline -replace '\s+systemd\.run=\S+', ''
$cmdline = $cmdline -replace '\s+systemd\.run_success_action=\S+', ''
$cmdline = $cmdline -replace '\s+systemd\.unit=kernel-command-line\.target', ''
$cmdline = "$($cmdline.Trim()) systemd.run=/boot/firmware/mxg-firstboot.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target"
[System.IO.File]::WriteAllText($cmdlinePath, "$cmdline`n", [System.Text.UTF8Encoding]::new($false))

# Do not rely on cloud-init to update an already-provisioned appliance. Its
# once-per-instance stages may already be complete, so remove any previous MXG
# runcmd block and use the one-shot systemd boot hook above instead.
$userData = [System.IO.File]::ReadAllText($userDataPath)
$userData = [regex]::Replace(
  $userData,
  '(?ms)^# BEGIN MXGENIUS FIRST BOOT\r?\n.*?^# END MXGENIUS FIRST BOOT\r?\n?',
  ''
).TrimEnd()
[System.IO.File]::WriteAllText($userDataPath, "$userData`n", [System.Text.UTF8Encoding]::new($false))

$metaData = [System.IO.File]::ReadAllText($metaDataPath)
$instanceId = "mxg-release-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
if ($metaData -match '(?m)^instance-id:\s*.*$') {
  $metaData = [regex]::Replace($metaData, '(?m)^instance-id:\s*.*$', "instance-id: $instanceId")
} else {
  $metaData = "instance-id: $instanceId`n$metaData"
}
$metaData = $metaData.Replace("`r`n", "`n").Replace("`r", "`n").TrimEnd()
[System.IO.File]::WriteAllText($metaDataPath, "$metaData`n", [System.Text.UTF8Encoding]::new($false))

if (Test-Path -LiteralPath $firstBootStatus) {
  Remove-Item -LiteralPath $firstBootStatus -Force
}

if ($EnableUsbGadget) {
  $configPath = Join-Path $root 'config.txt'
  $config = [System.IO.File]::ReadAllText($configPath)
  $config = [regex]::Replace(
    $config,
    '(?ms)^# BEGIN MXGENIUS USB GADGET\r?\n.*?^# END MXGENIUS USB GADGET\r?\n?',
    ''
  ).TrimEnd()
  $gadgetBlock = @"


# BEGIN MXGENIUS USB GADGET
[pi5]
dtoverlay=dwc2,dr_mode=peripheral
[all]
# END MXGENIUS USB GADGET
"@
  [System.IO.File]::WriteAllText($configPath, "$config$gadgetBlock`n", [System.Text.UTF8Encoding]::new($false))
}

$manifest = Get-ChildItem -LiteralPath $destination -Recurse -File | ForEach-Object {
  [PSCustomObject]@{
    Path = $_.FullName.Substring($destination.Length + 1).Replace('\', '/')
    Size = $_.Length
    Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
[System.IO.File]::WriteAllText(
  (Join-Path $root 'mxg-diagnostics-manifest.json'),
  "$($manifest | ConvertTo-Json -Depth 3)`n",
  [System.Text.UTF8Encoding]::new($false)
)

$version = (Get-Content -Raw -LiteralPath (Join-Path $source 'VERSION')).Trim()
$commit = git -C (Resolve-Path (Join-Path $source '..\..')).Path rev-parse --short HEAD 2>$null
$release = [PSCustomObject]@{
  Service = 'mxg-xr-diagnostics'
  Version = $version
  Commit = if ($LASTEXITCODE -eq 0) { $commit.Trim() } else { 'working-tree' }
  StagedAtUtc = [DateTime]::UtcNow.ToString('o')
  PayloadFiles = $manifest.Count
}
[System.IO.File]::WriteAllText(
  (Join-Path $root 'mxg-diagnostics-release.json'),
  "$($release | ConvertTo-Json)`n",
  [System.Text.UTF8Encoding]::new($false)
)

Write-Output "Staged MXG diagnostics kiosk at $destination"
Write-Output "Activated one-shot systemd installer: /boot/firmware/mxg-firstboot.sh"
if ($UserName) { Write-Output "Provisioned initial user: $UserName" }
if ($EnableSsh) { Write-Output 'Enabled SSH on first boot' }
if ($EnableUsbGadget) { Write-Output 'Enabled Raspberry Pi 5 USB-C peripheral mode for the gadget capability test' }
Write-Output "Release: $version"
Write-Output "Payload files: $($manifest.Count)"
