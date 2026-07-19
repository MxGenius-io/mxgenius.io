param(
    [string]$ResourceGroup = 'mxg-rg-50106',
    [string]$SearchService = 'mxg-search-50106',
    [string]$StorageAccount = 'mxgstorage50106',
    [string]$Container = 'documents',
    [string]$AssetPrefix = 'manual-assets/legacy-rag',
    [string]$TargetIndex = 'manuals-authoritative-v1',
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,
    [Parameter(Mandatory = $true)]
    [string]$LegacyImageMapPath,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$ApiVersion = '2023-11-01'

function Invoke-WithRetry {
    param([scriptblock]$Action, [int]$Attempts = 5)
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try { return & $Action }
        catch {
            if ($attempt -eq $Attempts) { throw }
            Start-Sleep -Milliseconds (400 * $attempt)
        }
    }
}

function Invoke-SearchRest {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [string]$Body
    )

    $responseFile = [IO.Path]::GetTempFileName()
    $requestFile = $null
    try {
        $arguments = @(
            '--silent', '--show-error', '--fail-with-body', '--max-time', '60',
            '--request', $Method,
            '--header', "api-key: $searchAdminKey",
            '--header', 'Accept: application/json',
            '--output', $responseFile
        )
        if ($null -ne $Body) {
            $requestFile = [IO.Path]::GetTempFileName()
            [IO.File]::WriteAllText($requestFile, $Body, (New-Object Text.UTF8Encoding($false)))
            $arguments += @(
                '--header', 'Content-Type: application/json; charset=utf-8',
                '--data-binary', "@$requestFile"
            )
        }
        $arguments += $Uri
        & curl.exe @arguments
        if ($LASTEXITCODE -ne 0) {
            $details = [IO.File]::ReadAllText($responseFile)
            throw "Azure Search request failed (curl $LASTEXITCODE): $details"
        }
        $payload = [IO.File]::ReadAllText($responseFile)
        if ([string]::IsNullOrWhiteSpace($payload)) { return $null }
        return $payload | ConvertFrom-Json
    }
    finally {
        if ($requestFile -and (Test-Path -LiteralPath $requestFile)) {
            Remove-Item -LiteralPath $requestFile -Force
        }
        if (Test-Path -LiteralPath $responseFile) {
            Remove-Item -LiteralPath $responseFile -Force
        }
    }
}

$restoreScript = Join-Path $PSScriptRoot 'restore_legacy_manual_assets.ps1'
$manifestJson = & $restoreScript `
    -SourceRoot $SourceRoot `
    -LegacyImageMapPath $LegacyImageMapPath
$manifest = $manifestJson | ConvertFrom-Json
if ($manifest.missing_asset_count -ne 0 -or $manifest.collision_count -ne 0) {
    throw 'Legacy asset manifest contains missing files or collisions.'
}
$assetsByName = @{}
foreach ($asset in $manifest.matched_assets) { $assetsByName[[string]$asset.asset_name] = $asset }
$legacyMap = Get-Content -Raw -LiteralPath $LegacyImageMapPath | ConvertFrom-Json
$assetsByLineage = @{}
foreach ($entry in $legacyMap.PSObject.Properties) {
    if ($entry.Name -notmatch '^(.*)_p(\d+)$') { continue }
    $lineageKey = $Matches[1]
    $page = [int]$Matches[2]
    $assetName = [IO.Path]::GetFileName([string]$entry.Value)
    if (-not $assetsByLineage.ContainsKey($lineageKey)) { $assetsByLineage[$lineageKey] = @() }
    $assetRecord = [pscustomobject][ordered]@{
        asset_name = $assetName
        page = $page
    }
    $assetsByLineage[$lineageKey] = @($assetsByLineage[$lineageKey]) + @($assetRecord)
}

$blobJson = Invoke-WithRetry {
    $value = az storage blob list `
        --account-name $StorageAccount `
        --container-name $Container `
        --auth-mode login `
        --prefix "$AssetPrefix/" `
        --only-show-errors `
        --output json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $value) {
        throw 'Unable to verify the restored Azure asset inventory.'
    }
    return $value
}
$blobInventory = ConvertFrom-Json -InputObject ($blobJson -join [Environment]::NewLine)
$blobNames = @{}
foreach ($blob in $blobInventory) { $blobNames[[string]$blob.name] = $true }
foreach ($assetName in $assetsByName.Keys) {
    $blobName = "$AssetPrefix/$assetName"
    if (-not $blobNames.ContainsKey($blobName)) { throw "Restored Azure asset is missing: $blobName" }
}

$searchAdminKey = Invoke-WithRetry {
    $value = az search admin-key show `
        --resource-group $ResourceGroup `
        --service-name $SearchService `
        --query primaryKey `
        --output tsv 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $value) {
        throw 'Azure Search admin key is unavailable through the authenticated CLI.'
    }
    return $value
}
$searchBase = "https://$SearchService.search.windows.net"
$searchUri = "$searchBase/indexes/$TargetIndex/docs/search?api-version=$ApiVersion"
$uploadUri = "$searchBase/indexes/$TargetIndex/docs/index?api-version=$ApiVersion"
$skip = 0
$pageSize = 1000
$actions = [Collections.Generic.List[object]]::new()
$referencedAssets = @{}
$sourceDocuments = [Collections.Generic.List[object]]::new()

while ($true) {
    $body = @{
        search = '*'
        select = 'id,document_id,source_name'
        top = $pageSize
        skip = $skip
    } | ConvertTo-Json -Compress
    $page = Invoke-SearchRest -Method Post -Uri $searchUri -Body $body
    foreach ($document in @($page.value)) {
        $sourceDocuments.Add($document)
    }
    $skip += @($page.value).Count
    if (@($page.value).Count -lt $pageSize) { break }
}

$documentIdsByLineage = @{}
foreach ($document in $sourceDocuments) {
    $lineageKey = ([string]$document.source_name) -replace '_extracted\.md$', ''
    if (-not $assetsByLineage.ContainsKey($lineageKey)) { continue }
    if (-not $documentIdsByLineage.ContainsKey($lineageKey)) { $documentIdsByLineage[$lineageKey] = @{} }
    $documentIdsByLineage[$lineageKey][[string]$document.document_id] = $true
}

$ambiguousLineageKeys = @(
    $documentIdsByLineage.Keys |
        Where-Object { $documentIdsByLineage[$_].Count -ne 1 }
)

foreach ($document in $sourceDocuments) {
    $lineageKey = ([string]$document.source_name) -replace '_extracted\.md$', ''
    if (-not $assetsByLineage.ContainsKey($lineageKey)) { continue }
    if ($documentIdsByLineage[$lineageKey].Count -ne 1) { continue }
    $lineageAssets = @($assetsByLineage[$lineageKey])
    $assets = foreach ($lineageAsset in $lineageAssets) {
        $assetName = [string]$lineageAsset.asset_name
        $assetPage = [int]$lineageAsset.page
        if (-not $assetsByName.ContainsKey($assetName)) {
            throw "Search record $($document.id) references an unknown legacy asset: $assetName"
        }
        $manifestAsset = $assetsByName[$assetName]
        $referencedAssets[$assetName] = $true
        $extension = [IO.Path]::GetExtension($assetName).TrimStart('.').ToLowerInvariant()
        $mediaType = switch ($extension) {
            'png' { 'image/png' }
            'jpg' { 'image/jpeg' }
            'jpeg' { 'image/jpeg' }
            'gif' { 'image/gif' }
            'webp' { 'image/webp' }
            default { 'application/octet-stream' }
        }
        [ordered]@{
            asset_id = [IO.Path]::GetFileNameWithoutExtension($assetName)
            kind = 'diagram'
            source_reference = "azure-blob://$StorageAccount/$Container/$AssetPrefix/$assetName"
            media_type = $mediaType
            page = $assetPage
            caption = "Manual figure from page $assetPage"
            content_hash = "sha256:$($manifestAsset.sha256)"
            availability = 'available'
        }
    }
    $actions.Add([ordered]@{
        '@search.action' = 'merge'
        id = [string]$document.id
        assets_json = ($assets | ConvertTo-Json -Depth 6 -Compress)
        lineage_state = 'legacy_assets_available'
    })
}

if ($Apply) {
    $batchSize = 100
    for ($offset = 0; $offset -lt $actions.Count; $offset += $batchSize) {
        $end = [Math]::Min($offset + $batchSize - 1, $actions.Count - 1)
        $batch = @($actions[$offset..$end])
        $response = Invoke-SearchRest `
            -Method Post `
            -Uri $uploadUri `
            -Body (@{ value = $batch } | ConvertTo-Json -Depth 8 -Compress)
        $failed = @($response.value | Where-Object { -not $_.status })
        if ($failed.Count -gt 0) { throw "$($failed.Count) Search asset promotion actions failed." }
    }
}

[ordered]@{
    target_index = $TargetIndex
    apply = [bool]$Apply
    verified_blob_assets = $blobNames.Count
    available_manifest_assets = $assetsByName.Count
    referenced_assets = $referencedAssets.Count
    affected_chunks = $actions.Count
    ambiguous_lineage_keys = $ambiguousLineageKeys.Count
} | ConvertTo-Json
