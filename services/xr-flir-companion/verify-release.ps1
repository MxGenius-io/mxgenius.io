[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ApkPath,
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$releaseMetadataPath = Join-Path $projectRoot 'meta\meta-release.json'
$releaseMetadata = Get-Content -Raw -LiteralPath $releaseMetadataPath | ConvertFrom-Json

function Assert-ReleaseRequirement {
    param(
        [bool]$Condition,
        [string]$Message
    )
    if (-not $Condition) {
        throw "Release verification failed: $Message"
    }
}

function Resolve-BuildTool {
    param([string]$Name)
    $androidHome = $env:ANDROID_HOME
    if (-not $androidHome) {
        $androidHome = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    }
    $buildToolsRoot = Join-Path $androidHome 'build-tools'
    $buildTools = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1
    Assert-ReleaseRequirement ($null -ne $buildTools) "Android build tools were not found under $buildToolsRoot"
    $tool = Join-Path $buildTools.FullName $Name
    Assert-ReleaseRequirement (Test-Path -LiteralPath $tool -PathType Leaf) "Missing Android build tool: $tool"
    return $tool
}

function Ensure-JavaHome {
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe') -PathType Leaf)) {
        return
    }
    $knownJava = @(
        'D:\AAog\.tooling\jdk21\jdk-*\bin\java.exe',
        'C:\Program Files\Android\Android Studio\jbr\bin\java.exe',
        'C:\Program Files\Microsoft\jdk-21*\bin\java.exe',
        'C:\Program Files\Eclipse Adoptium\jdk-21*\bin\java.exe'
    ) | ForEach-Object { Get-Item $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
    Assert-ReleaseRequirement ($null -ne $knownJava) 'Java 21 is required to verify the APK signature'
    $env:JAVA_HOME = Split-Path (Split-Path $knownJava.FullName -Parent) -Parent
}

$manifestSourcePath = Join-Path $projectRoot 'app\src\main\AndroidManifest.xml'
$manifestSource = Get-Content -Raw -LiteralPath $manifestSourcePath
foreach ($requiredManifestToken in @(
    'com.oculus.supportedDevices',
    'com.oculus.vrshell.SHELL_MAIN',
    'com.oculus.intent.category.2D',
    'com.oculus.intent.category.VR',
    'com.oculus.vrshell.panel_activity',
    'ThermalImmersiveActivity',
    'libossdk.oculus.so',
    'android.permission.CAMERA',
    'horizonos.permission.HEADSET_CAMERA',
    'android.permission.FOREGROUND_SERVICE_CAMERA',
    'dataSync|camera',
    '@mipmap/mxgenius_launcher',
    '@mipmap/mxgenius_launcher_round'
)) {
    Assert-ReleaseRequirement ($manifestSource.Contains($requiredManifestToken)) "Android manifest is missing $requiredManifestToken"
}
foreach ($forbiddenManifestToken in @('android.permission.BLUETOOTH_CONNECT', 'android.hardware.bluetooth')) {
    Assert-ReleaseRequirement (-not $manifestSource.Contains($forbiddenManifestToken)) "FLIR companion must not depend on $forbiddenManifestToken"
}

$layoutSourcePath = Join-Path $projectRoot 'app\src\main\res\layout\activity_main.xml'
$layoutSource = Get-Content -Raw -LiteralPath $layoutSourcePath
Assert-ReleaseRequirement ($layoutSource.Contains('@+id/thermal_preview')) 'standalone panel is missing the native thermal preview'
foreach ($forbiddenLayoutToken in @('@+id/connect_pi', '@+id/pi_status', 'Connect MxGenius Pi')) {
    Assert-ReleaseRequirement (-not $layoutSource.Contains($forbiddenLayoutToken)) "standalone FLIR panel still contains $forbiddenLayoutToken"
}

$immersiveLayoutSourcePath = Join-Path $projectRoot 'app\src\main\res\layout\immersive_thermal_panel.xml'
$immersiveLayoutSource = Get-Content -Raw -LiteralPath $immersiveLayoutSourcePath
foreach ($requiredImmersiveToken in @(
    '@+id/immersive_thermal_preview',
    '@+id/immersive_pin_toggle',
    '@+id/immersive_reconnect',
    '@+id/immersive_commission',
    '@+id/immersive_commission_status',
    '@+id/immersive_trace'
)) {
    Assert-ReleaseRequirement ($immersiveLayoutSource.Contains($requiredImmersiveToken)) "native immersive panel is missing $requiredImmersiveToken"
}

$companionSources = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'app\src\main\java') -Recurse -File |
    Where-Object { $_.Extension -in @('.java', '.kt') } |
    ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName } |
    Out-String
foreach ($forbiddenSourceToken in @('PiDiagnosticsClient', 'pi-diagnostics-rfcomm', 'edge-diagnostics-1')) {
    Assert-ReleaseRequirement (-not $companionSources.Contains($forbiddenSourceToken)) "standalone FLIR source still contains $forbiddenSourceToken"
}
foreach ($requiredTransportToken in @('LocalThermalBroker', 'ThermalTransport', '127.0.0.1')) {
    Assert-ReleaseRequirement ($companionSources.Contains($requiredTransportToken)) "Quest-local thermal transport is missing $requiredTransportToken"
}
foreach ($requiredSnapshotToken in @('HeadsetSnapshotController', 'headset.snapshot.request', 'headset.snapshot.result', 'N21', 'N23')) {
    Assert-ReleaseRequirement ($companionSources.Contains($requiredSnapshotToken)) "Quest snapshot seam is missing $requiredSnapshotToken"
}
foreach ($requiredSpatialToken in @('AppSystemActivity', 'LayoutXMLPanelRegistration', 'ThermalPanelFollowSystem', 'N16', 'N18')) {
    Assert-ReleaseRequirement ($companionSources.Contains($requiredSpatialToken)) "native Spatial workspace is missing $requiredSpatialToken"
}
foreach ($requiredCommissioningToken in @('ThermalCommissioningRun', 'commissioning.browser_ack', 'RUN FULL DIAGNOSTIC', 'C05')) {
    Assert-ReleaseRequirement ($companionSources.Contains($requiredCommissioningToken)) "deterministic commissioning path is missing $requiredCommissioningToken"
}

$resourceRoot = Join-Path $projectRoot 'app\src\main\res'
Assert-ReleaseRequirement (-not (Test-Path -LiteralPath (Join-Path $resourceRoot 'drawable-nodpi\mxgenius_launcher.png'))) 'obsolete drawable-nodpi launcher image is still packaged'
foreach ($density in @('mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi')) {
    foreach ($icon in @('mxgenius_launcher.png', 'mxgenius_launcher_round.png', 'mxgenius_launcher_foreground.png')) {
        $iconPath = Join-Path $resourceRoot "mipmap-$density\$icon"
        Assert-ReleaseRequirement (Test-Path -LiteralPath $iconPath -PathType Leaf) "missing density-aware launcher resource $iconPath"
    }
}
foreach ($adaptiveIcon in @(
    'mipmap-anydpi-v26\mxgenius_launcher.xml',
    'mipmap-anydpi-v26\mxgenius_launcher_round.xml',
    'mipmap-anydpi-v33\mxgenius_launcher.xml',
    'mipmap-anydpi-v33\mxgenius_launcher_round.xml'
)) {
    $adaptivePath = Join-Path $resourceRoot $adaptiveIcon
    Assert-ReleaseRequirement (Test-Path -LiteralPath $adaptivePath -PathType Leaf) "missing adaptive launcher resource $adaptivePath"
}

$storeManifestPath = Join-Path (Split-Path $releaseMetadataPath -Parent) $releaseMetadata.metadata.storeAssetsManifest
Assert-ReleaseRequirement (Test-Path -LiteralPath $storeManifestPath -PathType Leaf) "missing Meta store asset manifest $storeManifestPath"
$storeManifest = Get-Content -Raw -LiteralPath $storeManifestPath | ConvertFrom-Json
$storeRoot = Split-Path $storeManifestPath -Parent
Assert-ReleaseRequirement (($storeManifest.assets | Where-Object { $_.canonicalUpload -and $_.requiredForRelease }).Count -eq 1) 'store asset manifest must identify exactly one required canonical upload'
Add-Type -AssemblyName System.Drawing
foreach ($asset in $storeManifest.assets) {
    Assert-ReleaseRequirement (-not [string]::IsNullOrWhiteSpace($asset.metaDashboardField)) "store asset $($asset.file) has no Meta dashboard field mapping"
    $assetPath = Join-Path $storeRoot $asset.file
    Assert-ReleaseRequirement (Test-Path -LiteralPath $assetPath -PathType Leaf) "missing Meta store asset $assetPath"
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $assetPath).Hash.ToLowerInvariant()
    Assert-ReleaseRequirement ($actualHash -eq $asset.sha256.ToLowerInvariant()) "checksum mismatch for Meta store asset $($asset.file)"
    $image = [System.Drawing.Image]::FromFile($assetPath)
    try {
        Assert-ReleaseRequirement ($image.Width -eq $asset.width -and $image.Height -eq $asset.height) "dimension mismatch for Meta store asset $($asset.file)"
        if ($asset.pixelFormat -eq '24-bit RGB') {
            Assert-ReleaseRequirement ($image.PixelFormat -eq [System.Drawing.Imaging.PixelFormat]::Format24bppRgb) "pixel format mismatch for Meta store asset $($asset.file)"
        }
    }
    finally {
        $image.Dispose()
    }
}

$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
$aapt2 = Resolve-BuildTool 'aapt2.exe'
$badging = (& $aapt2 dump badging $resolvedApk 2>&1 | Out-String)
Assert-ReleaseRequirement ($LASTEXITCODE -eq 0) 'aapt2 could not read APK badging'
Assert-ReleaseRequirement ($badging -match "package: name='$([regex]::Escape($releaseMetadata.application.package))'") 'APK package name does not match release metadata'
Assert-ReleaseRequirement ($badging -match "versionCode='$($releaseMetadata.build.versionCode)'") 'APK versionCode does not match release metadata'
Assert-ReleaseRequirement ($badging -match "versionName='$([regex]::Escape($releaseMetadata.build.versionName))'") 'APK versionName does not match release metadata'

$manifestTree = (& $aapt2 dump xmltree $resolvedApk --file AndroidManifest.xml 2>&1 | Out-String)
Assert-ReleaseRequirement ($LASTEXITCODE -eq 0) 'aapt2 could not inspect the packaged Android manifest'
foreach ($requiredPackagedToken in @(
    'com.oculus.supportedDevices',
    'com.oculus.vrshell.SHELL_MAIN',
    'com.oculus.intent.category.2D',
    'com.oculus.intent.category.VR',
    'com.oculus.vrshell.panel_activity',
    'ThermalImmersiveActivity',
    'libossdk.oculus.so',
    'android.permission.CAMERA',
    'horizonos.permission.HEADSET_CAMERA',
    'android.permission.FOREGROUND_SERVICE_CAMERA'
)) {
    Assert-ReleaseRequirement ($manifestTree.Contains($requiredPackagedToken)) "packaged Android manifest is missing $requiredPackagedToken"
}
foreach ($forbiddenPackagedToken in @('android.permission.BLUETOOTH_CONNECT', 'android.hardware.bluetooth')) {
    Assert-ReleaseRequirement (-not $manifestTree.Contains($forbiddenPackagedToken)) "packaged FLIR manifest still contains $forbiddenPackagedToken"
}

$packagedResources = (& $aapt2 dump resources $resolvedApk 2>&1 | Out-String)
Assert-ReleaseRequirement ($LASTEXITCODE -eq 0) 'aapt2 could not inspect packaged resources'
Assert-ReleaseRequirement ($packagedResources.Contains('id/thermal_preview')) 'packaged standalone panel is missing id/thermal_preview'
foreach ($requiredImmersiveResource in @('immersive_thermal_preview', 'immersive_pin_toggle', 'immersive_reconnect', 'immersive_commission', 'immersive_commission_status', 'immersive_trace')) {
    Assert-ReleaseRequirement ($packagedResources.Contains("id/$requiredImmersiveResource")) "packaged immersive panel is missing id/$requiredImmersiveResource"
}
foreach ($forbiddenPackagedLayoutToken in @('connect_pi', 'pi_status')) {
    Assert-ReleaseRequirement (-not $packagedResources.Contains("id/$forbiddenPackagedLayoutToken")) "packaged standalone panel still contains id/$forbiddenPackagedLayoutToken"
}
$layoutResourceMatch = [regex]::Match(
    $packagedResources,
    '(?s)layout/activity_main\s+(?<body>.*?)(?=\r?\n\s+resource|\r?\n\s+type)')
Assert-ReleaseRequirement ($layoutResourceMatch.Success) 'APK resource table has no layout/activity_main block'
$layoutFileMatch = [regex]::Match($layoutResourceMatch.Groups['body'].Value, '\(file\)\s+(?<path>\S+)\s+type=XML')
Assert-ReleaseRequirement ($layoutFileMatch.Success) 'APK resource table does not map layout/activity_main to compiled XML'
$packagedLayoutPath = $layoutFileMatch.Groups['path'].Value
$packagedLayout = (& $aapt2 dump xmltree $resolvedApk --file $packagedLayoutPath 2>&1 | Out-String)
Assert-ReleaseRequirement ($LASTEXITCODE -eq 0) "aapt2 could not inspect packaged standalone panel layout $packagedLayoutPath"
Assert-ReleaseRequirement ($packagedLayout.Contains('E: ImageView')) 'packaged standalone panel is missing its thermal ImageView'
Assert-ReleaseRequirement ($packagedLayout.Contains('Live FLIR ONE thermal preview')) 'packaged standalone panel is missing its thermal preview description'
foreach ($requiredPackagedResource in @(
    'mipmap/mxgenius_launcher',
    'mipmap/mxgenius_launcher_round',
    'mipmap/mxgenius_launcher_foreground'
)) {
    Assert-ReleaseRequirement ($packagedResources.Contains($requiredPackagedResource)) "APK is missing packaged launcher resource $requiredPackagedResource"
}
foreach ($launcherResource in @('mxgenius_launcher', 'mxgenius_launcher_round', 'mxgenius_launcher_foreground')) {
    $resourcePattern = "(?s)mipmap/$launcherResource\s+(?<body>.*?)(?=\r?\n\s+resource|\r?\n\s+type)"
    $resourceMatch = [regex]::Match($packagedResources, $resourcePattern)
    Assert-ReleaseRequirement ($resourceMatch.Success) "APK resource table has no block for mipmap/$launcherResource"
    foreach ($density in @('mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi')) {
        Assert-ReleaseRequirement ($resourceMatch.Groups['body'].Value.Contains("($density)")) "APK mipmap/$launcherResource is missing the $density density"
    }
    if ($launcherResource -ne 'mxgenius_launcher_foreground') {
        Assert-ReleaseRequirement ($resourceMatch.Groups['body'].Value.Contains('(anydpi)')) "APK mipmap/$launcherResource is missing its adaptive anydpi resource"
    }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedApk)
try {
    $nativeEntries = @($archive.Entries | Where-Object { $_.FullName -match '^lib/([^/]+)/[^/]+\.so$' })
    Assert-ReleaseRequirement ($nativeEntries.Count -gt 0) 'APK contains no native libraries'
    $abis = @($nativeEntries | ForEach-Object { [regex]::Match($_.FullName, '^lib/([^/]+)/').Groups[1].Value } | Sort-Object -Unique)
    Assert-ReleaseRequirement ($abis.Count -eq 1 -and $abis[0] -eq 'arm64-v8a') "APK must contain only ARM64 native libraries; found: $($abis -join ', ')"
}
finally {
    $archive.Dispose()
}

Ensure-JavaHome
$apkSigner = Resolve-BuildTool 'apksigner.bat'
$signatureOutput = (& $apkSigner verify --verbose --print-certs $resolvedApk 2>&1 | Out-String)
$signatureExitCode = $LASTEXITCODE
Assert-ReleaseRequirement ($signatureExitCode -eq 0 -and $signatureOutput.Contains('Verifies')) 'APK signature verification failed'
Assert-ReleaseRequirement ($signatureOutput -match 'Verified using v2 scheme \(APK Signature Scheme v2\): true') 'APK is not signed with APK Signature Scheme v2'
if ($Configuration -eq 'Release') {
    Assert-ReleaseRequirement ($null -ne $releaseMetadata.build.artifact) 'release metadata has no artifact record'
    $artifactSize = (Get-Item -LiteralPath $resolvedApk).Length
    $artifactHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedApk).Hash.ToLowerInvariant()
    Assert-ReleaseRequirement ($artifactSize -eq $releaseMetadata.build.artifact.sizeBytes) 'release APK size does not match artifact metadata'
    Assert-ReleaseRequirement ($artifactHash -eq $releaseMetadata.build.artifact.sha256.ToLowerInvariant()) 'release APK checksum does not match artifact metadata'
    $expectedCertificate = $releaseMetadata.signing.certificateSha256.ToLowerInvariant()
    $actualCertificate = $signatureOutput | Select-String -Pattern 'Signer #1 certificate SHA-256 digest: ([0-9a-f]+)' |
        ForEach-Object { $_.Matches[0].Groups[1].Value.ToLowerInvariant() } |
        Select-Object -First 1
    Assert-ReleaseRequirement ($actualCertificate -eq $expectedCertificate) 'release APK is not signed by the permanent MxGenius certificate'
    Assert-ReleaseRequirement ($signatureOutput -notmatch 'Android Debug') 'release APK is signed with a debug certificate'
}

Write-Host "Release verification passed: $resolvedApk"
Write-Host "Build: $($releaseMetadata.build.versionName) (code $($releaseMetadata.build.versionCode)); ABI: arm64-v8a; configuration: $Configuration"
