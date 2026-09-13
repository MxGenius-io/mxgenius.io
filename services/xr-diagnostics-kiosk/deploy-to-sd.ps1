param(
  [Parameter(Mandatory = $false)]
  [ValidatePattern('^[A-Za-z]:$')]
  [string]$Drive = 'E:',

  [ValidatePattern('^[a-z][a-z0-9_-]{0,30}$')]
  [string]$UserName = '',

  [string]$PasswordHash = '',

  [ValidateLength(1, 120)]
  [string]$DeviceDisplayName = 'MXG Pi',

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
if (-not (Test-Path -LiteralPath $issuePath) -or -not (Test-Path -LiteralPath $cmdlinePath)) {
  throw "The target does not look like a Raspberry Pi boot partition."
}
if ((Get-Content -Raw -LiteralPath $issuePath) -notmatch 'Raspberry Pi') {
  throw "The target issue.txt does not identify a Raspberry Pi image."
}
if ((Get-Content -Raw -LiteralPath $cmdlinePath) -notmatch 'root=PARTUUID=') {
  throw "The target cmdline.txt does not contain a Raspberry Pi root partition."
}
if ([bool]$UserName -ne [bool]$PasswordHash) {
  throw 'UserName and PasswordHash must be provided together.'
}
if ($PasswordHash -and (-not $PasswordHash.StartsWith('$6$') -or $PasswordHash -match '[:\r\n]')) {
  throw 'PasswordHash must be a single OpenSSL SHA-512 crypt value generated with: openssl passwd -6'
}

$destination = Join-Path $root 'mxg-diagnostics-kiosk'
$legacy = Join-Path $root 'eve-kiosk'
$firstBoot = Join-Path $root 'mxg-firstboot.sh'
$firstBootStatus = Join-Path $root 'mxg-firstboot.status'
$legacyManifest = Join-Path $root 'mxg-diagnostics-manifest.json'
$legacyRelease = Join-Path $root 'mxg-diagnostics-release.json'

foreach ($target in @($destination, $legacy)) {
  if (Test-Path -LiteralPath $target) {
    $resolved = [System.IO.Path]::GetFullPath($target)
    if (-not $resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove path outside the SD root: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
$deviceIdentity = & (Join-Path $PSScriptRoot 'scripts\provision-device-identity.ps1') -Drive $Drive -DisplayName $DeviceDisplayName
if (-not $deviceIdentity -or [string]$deviceIdentity.HardwareId -notmatch '^mxg-pi-[0-9a-f]{32}$') {
  throw 'The permanent device identity could not be provisioned.'
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
$cmdline = $cmdline -replace '(^|\s+)splash(?=\s|$)', ' '
$cmdline = $cmdline -replace '(^|\s+)fullscreen_logo=\S+', ' '
$cmdline = $cmdline -replace '(^|\s+)fullscreen_logo_name=\S+', ' '
[System.IO.File]::WriteAllText($cmdlinePath, "$($cmdline.Trim())`n", [System.Text.UTF8Encoding]::new($false))

foreach ($obsoleteHook in @($firstBoot, $firstBootStatus, $legacyManifest, $legacyRelease)) {
  if (Test-Path -LiteralPath $obsoleteHook) {
    Remove-Item -LiteralPath $obsoleteHook -Force
  }
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

Write-Output "Commissioned Raspberry Pi boot partition at $root"
Write-Output 'Preserved the normal Raspberry Pi boot path; no first-boot hook was installed'
if ($UserName) { Write-Output "Provisioned initial user: $UserName" }
if ($EnableSsh) { Write-Output 'Enabled SSH on first boot' }
if ($EnableUsbGadget) { Write-Output 'Enabled permanent Raspberry Pi 5 USB-C peripheral mode for the Equipment Pack drive' }
Write-Output "Hardware ID: $($deviceIdentity.HardwareId)"
Write-Output 'Use scripts/deploy-pi.ps1 for the one-time runtime install or subsequent software updates'
