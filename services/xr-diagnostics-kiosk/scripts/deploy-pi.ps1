[CmdletBinding()]
param(
  [string]$HostName = 'mxgenius.local',
  [ValidatePattern('^[a-z][a-z0-9_-]{0,30}$')]
  [string]$UserName = 'mxgenius',
  [ValidateRange(1, 65535)]
  [int]$SshPort = 22,
  [string]$IdentityFile = ''
)

$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$releaseListPath = Join-Path $serviceRoot 'release-files.txt'
$archive = Join-Path ([System.IO.Path]::GetTempPath()) 'mxg-diagnostics-kiosk-release.tgz'
$target = "$UserName@$HostName"
$sshArgs = @('-t', '-p', "$SshPort")
$scpArgs = @('-P', "$SshPort")
if ($IdentityFile) {
  $resolvedIdentity = (Resolve-Path -LiteralPath $IdentityFile).Path
  $sshArgs += @('-i', $resolvedIdentity)
  $scpArgs += @('-i', $resolvedIdentity)
}

try {
  $releaseItems = @(Get-Content -LiteralPath $releaseListPath | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
  foreach ($item in $releaseItems) {
    if ([System.IO.Path]::IsPathRooted($item) -or $item -match '(^|[\\/])\.\.([\\/]|$)' -or -not (Test-Path -LiteralPath (Join-Path $serviceRoot $item))) {
      throw "Invalid or missing release item: $item"
    }
  }
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  & tar.exe -czf $archive --exclude='*/__pycache__' --exclude='*.pyc' --exclude='*.pyo' -C $serviceRoot @releaseItems
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the diagnostics release archive.' }

  Write-Host "Uploading MXG diagnostics to $target..."
  & scp @scpArgs $archive "${target}:/tmp/mxg-diagnostics-kiosk-release.tgz"
  if ($LASTEXITCODE -ne 0) { throw 'Release upload failed.' }

  $remoteInstall = @'
set -euo pipefail
STAGE=/tmp/mxg-diagnostics-kiosk-release
rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -xzf /tmp/mxg-diagnostics-kiosk-release.tgz -C "$STAGE"
if [ -d /opt/mxg-diagnostics-kiosk/venv ]; then
  sudo bash "$STAGE/update.sh" "$STAGE"
else
  sudo bash "$STAGE/install.sh" "$STAGE"
fi
for attempt in $(seq 1 30); do
  if python3 -c 'import json,urllib.request; data=json.load(urllib.request.urlopen("http://127.0.0.1:8844/api/v1/health",timeout=2)); assert data["status"] == "ok"; print("HEALTH",data.get("version"),"ready=" + str(data.get("ready")))'; then
    exit 0
  fi
  sleep 1
done
echo 'Diagnostics service did not become healthy.' >&2
systemctl status mxg-diagnostics-kiosk.service --no-pager >&2
exit 1
'@
  & ssh @sshArgs $target $remoteInstall
  if ($LASTEXITCODE -ne 0) { throw 'Remote install or health verification failed.' }
  Write-Host "Deployment complete: http://$HostName`:8844/"
} finally {
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
