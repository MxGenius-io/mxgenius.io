[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug',
    [string]$FlirSdkHome = $env:FLIR_MOBILE_SDK_HOME
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
if (-not $FlirSdkHome) {
    $FlirSdkHome = 'D:\AAog\Flir-SDK\atlas-java-sdk-android-2.22.0'
}
$requiredAars = @('androidsdk-release.aar', 'thermalsdk-release.aar')
foreach ($aar in $requiredAars) {
    $candidate = Join-Path $FlirSdkHome $aar
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Missing FLIR SDK file: $candidate"
    }
}

if (-not $env:ANDROID_HOME) {
    $androidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    if (Test-Path -LiteralPath $androidSdk -PathType Container) {
        $env:ANDROID_HOME = $androidSdk
    }
}
$env:FLIR_MOBILE_SDK_HOME = (Resolve-Path -LiteralPath $FlirSdkHome).Path

if ($Configuration -eq 'Release') {
    $signingRoot = 'D:\AAog\.secrets'
    $keystorePath = Join-Path $signingRoot 'mxgenius-sensor-bridge-release.jks'
    $credentialPath = Join-Path $signingRoot 'mxgenius-sensor-bridge-signing.xml'
    foreach ($requiredSigningFile in @($keystorePath, $credentialPath)) {
        if (-not (Test-Path -LiteralPath $requiredSigningFile -PathType Leaf)) {
            throw "Missing release signing material: $requiredSigningFile"
        }
    }

    $credential = Import-Clixml -LiteralPath $credentialPath
    if ($credential -isnot [System.Management.Automation.PSCredential]) {
        throw "Invalid signing credential file: $credentialPath"
    }
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
    try {
        $signingPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        $env:MXGENIUS_SIGNING_STORE_FILE = (Resolve-Path -LiteralPath $keystorePath).Path
        $env:MXGENIUS_SIGNING_STORE_PASSWORD = $signingPassword
        $env:MXGENIUS_SIGNING_KEY_ALIAS = $credential.UserName
        $env:MXGENIUS_SIGNING_KEY_PASSWORD = $signingPassword
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
}

$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) {
    $knownJava = @(
        $(if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' }),
        'D:\AAog\.tooling\jdk21\jdk-*\bin\java.exe',
        'C:\Program Files\Android\Android Studio\jbr\bin\java.exe',
        'C:\Program Files\Microsoft\jdk-21*\bin\java.exe',
        'C:\Program Files\Eclipse Adoptium\jdk-21*\bin\java.exe'
    ) | ForEach-Object { Get-Item $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
    if (-not $knownJava) {
        throw 'Java 21 was not found. Install Android Studio or a JDK 21, then run this script again.'
    }
    $env:JAVA_HOME = Split-Path (Split-Path $knownJava.FullName -Parent) -Parent
}

$projectWrapper = Join-Path $projectRoot 'gradlew.bat'
if (-not (Test-Path -LiteralPath $projectWrapper -PathType Leaf)) {
    throw "Project Gradle wrapper not found: $projectWrapper"
}
$assembleTask = if ($Configuration -eq 'Release') { ':app:assembleRelease' } else { ':app:assembleDebug' }
& $projectWrapper --project-dir $projectRoot ':app:testDebugUnitTest' $assembleTask
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$apkName = if ($Configuration -eq 'Release') { 'app-release.apk' } else { 'app-debug.apk' }
$apk = Join-Path $projectRoot "app\build\outputs\apk\$($Configuration.ToLowerInvariant())\$apkName"
& (Join-Path $projectRoot 'verify-release.ps1') -ApkPath $apk -Configuration $Configuration
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "APK ready: $apk"
