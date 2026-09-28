[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path $PSScriptRoot -Parent
$companionRoot = Join-Path $repositoryRoot 'services\xr-flir-companion'
$metadataPath = Join-Path $companionRoot 'meta\meta-release.json'
$metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
$apkPath = Join-Path $companionRoot $metadata.build.artifact.path

function Initialize-JavaHome {
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe') -PathType Leaf)) {
        return
    }

    $java = @(
        'D:\AAog\.tooling\jdk21\jdk-*\bin\java.exe',
        'C:\Program Files\Android\Android Studio\jbr\bin\java.exe',
        'C:\Program Files\Microsoft\jdk-21*\bin\java.exe',
        'C:\Program Files\Eclipse Adoptium\jdk-21*\bin\java.exe'
    ) | ForEach-Object { Get-Item $_ -ErrorAction SilentlyContinue } | Select-Object -First 1

    if (-not $java) {
        throw 'Java 21 was not found. Set JAVA_HOME before running the XR preflight.'
    }
    $env:JAVA_HOME = Split-Path (Split-Path $java.FullName -Parent) -Parent
}

function Initialize-AndroidHome {
    if ($env:ANDROID_HOME -and (Test-Path -LiteralPath $env:ANDROID_HOME -PathType Container)) {
        return
    }
    $androidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    if (-not (Test-Path -LiteralPath $androidSdk -PathType Container)) {
        throw 'Android SDK was not found. Set ANDROID_HOME before running the XR preflight.'
    }
    $env:ANDROID_HOME = $androidSdk
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
        }
        finally {
            $sha.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host "`n== $Label ==" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

Push-Location $repositoryRoot
try {
    Initialize-JavaHome
    Initialize-AndroidHome

    Invoke-Checked 'Focused unified-XR contract suite' {
        & node --test tests/xr-unified-acceptance.test.mjs tests/spatial-workspace-controller.test.mjs tests/xr-input-dwell.test.mjs tests/xr-headset-frame.test.mjs tests/xr-fleet-data-provider.test.mjs tests/xr-capability-registry.test.mjs tests/spatial-workspace.test.mjs tests/remote-witness.test.mjs
    }

    Invoke-Checked 'Android companion unit tests' {
        & (Join-Path $companionRoot 'gradlew.bat') -p $companionRoot testDebugUnitTest --no-daemon
    }

    if (-not (Test-Path -LiteralPath $apkPath -PathType Leaf)) {
        throw "Release APK is missing: $apkPath"
    }

    $apk = Get-Item -LiteralPath $apkPath
    $apkHash = Get-Sha256 -Path $apkPath
    if ($apk.Length -ne [long]$metadata.build.artifact.sizeBytes) {
        throw "Release APK size does not match meta-release.json"
    }
    if ($apkHash -ne [string]$metadata.build.artifact.sha256) {
        throw "Release APK SHA-256 does not match meta-release.json"
    }

    Invoke-Checked 'Release APK manifest and signature verification' {
        & (Join-Path $companionRoot 'verify-release.ps1') -ApkPath $apkPath -Configuration Release
    }

    Write-Host "`nXR candidate verified" -ForegroundColor Green
    Write-Host "Companion: $($metadata.build.versionName) (versionCode $($metadata.build.versionCode))"
    Write-Host "APK: $apkPath"
    Write-Host "SHA-256: $apkHash"
    Write-Warning "Meta Alpha still publishes $($metadata.publishedBuild.versionName) (versionCode $($metadata.publishedBuild.versionCode))."
    Write-Warning 'Physical Quest verdict remains PENDING until every XRQ row is executed on alpha.25.'
}
finally {
    Pop-Location
}
