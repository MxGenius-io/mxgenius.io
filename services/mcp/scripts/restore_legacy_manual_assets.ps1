param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,
    [Parameter(Mandatory = $true)]
    [string]$LegacyImageMapPath,
    [string]$StagingDirectory = (Join-Path $env:TEMP 'mxgenius-manual-assets'),
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$imageExtensions = @('.png', '.jpg', '.jpeg', '.gif', '.webp')

function Get-LegacyAssetName {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][IO.FileInfo]$File
    )

    # The original bundle was produced on macOS. Normalizing separators is
    # required to reproduce its stable MD5-derived filenames on Windows.
    $relativePath = $File.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
    $bytes = [Text.Encoding]::UTF8.GetBytes($relativePath)
    $md5 = [Security.Cryptography.MD5]::Create()
    try {
        $digest = [BitConverter]::ToString($md5.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $md5.Dispose()
    }
    return "$($digest.Substring(0, 10))$($File.Extension.ToLowerInvariant())"
}

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
    throw "Manual ingest root not found: $SourceRoot"
}
if (-not (Test-Path -LiteralPath $LegacyImageMapPath -PathType Leaf)) {
    throw "Legacy image map not found: $LegacyImageMapPath"
}

$resolvedRoot = (Resolve-Path -LiteralPath $SourceRoot).Path.TrimEnd('\', '/')
$legacyMap = Get-Content -Raw -LiteralPath $LegacyImageMapPath | ConvertFrom-Json
$expectedNames = @(
    $legacyMap.PSObject.Properties |
        ForEach-Object { [IO.Path]::GetFileName([string]$_.Value) } |
        Sort-Object -Unique
)

$sourceByAssetName = @{}
$collisions = [Collections.Generic.List[object]]::new()
$sourceFiles = @(
    Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File |
        Where-Object { $imageExtensions -contains $_.Extension.ToLowerInvariant() }
)

foreach ($file in $sourceFiles) {
    $assetName = Get-LegacyAssetName -Root $resolvedRoot -File $file
    if ($sourceByAssetName.ContainsKey($assetName)) {
        $collisions.Add([ordered]@{
            asset_name = $assetName
            first_source = $sourceByAssetName[$assetName].FullName
            second_source = $file.FullName
        })
        continue
    }
    $sourceByAssetName[$assetName] = $file
}

$matched = [Collections.Generic.List[object]]::new()
$missing = [Collections.Generic.List[string]]::new()
foreach ($assetName in $expectedNames) {
    if (-not $sourceByAssetName.ContainsKey($assetName)) {
        $missing.Add($assetName)
        continue
    }
    $source = $sourceByAssetName[$assetName]
    $matched.Add([ordered]@{
        asset_name = $assetName
        source_path = $source.FullName
        source_relative_path = $source.FullName.Substring($resolvedRoot.Length).TrimStart('\', '/').Replace('\', '/')
        sha256 = (Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        byte_length = $source.Length
    })
}

if ($Apply) {
    [IO.Directory]::CreateDirectory($StagingDirectory) | Out-Null
    foreach ($asset in $matched) {
        $destination = Join-Path $StagingDirectory $asset.asset_name
        Copy-Item -LiteralPath $asset.source_path -Destination $destination -Force
        $copiedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($copiedHash -ne $asset.sha256) {
            throw "Hash verification failed after copying $($asset.asset_name)."
        }
    }
}

$report = [ordered]@{
    generated_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
    source_root = $resolvedRoot
    source_image_count = $sourceFiles.Count
    expected_asset_count = $expectedNames.Count
    matched_asset_count = $matched.Count
    missing_asset_count = $missing.Count
    collision_count = $collisions.Count
    applied = [bool]$Apply
    staging_directory = if ($Apply) { (Resolve-Path -LiteralPath $StagingDirectory).Path } else { $null }
    missing_assets = @($missing)
    collisions = @($collisions)
    matched_assets = @($matched)
}

$report | ConvertTo-Json -Depth 6

if ($missing.Count -gt 0 -or $collisions.Count -gt 0) {
    exit 2
}
