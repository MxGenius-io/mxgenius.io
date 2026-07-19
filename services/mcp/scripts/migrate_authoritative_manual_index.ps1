param(
    [string]$ResourceGroup = 'mxg-rg-50106',
    [string]$SearchService = 'mxg-search-50106',
    [string]$StorageAccount = 'mxgstorage50106',
    [string]$Container = 'documents',
    [string]$SourceIndex = 'manuals-index',
    [string]$TargetIndex = 'manuals-authoritative-v1',
    [Parameter(Mandatory = $true)]
    [string]$LegacyImageMapPath
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

function Get-ManualMetadata {
    param([object]$Blob)
    $BlobName = [string]$Blob.name
    $parts = $BlobName -split '_', 2
    $sourceName = if ($parts.Count -eq 2) { $parts[1] } else { $BlobName }
    $lineageKey = $sourceName -replace '_extracted\.md$', ''
    $title = $lineageKey -replace '_', ' '
    $ata = $null
    if ($title -match '(?i)(?:CHAPTER\s+|^)(\d{2})(?:\D|$)') { $ata = $Matches[1] }
    $manualType = $null
    if ($title -match '(?i)(?:^|[\s_-])(AMM|IPC|WDM|SRM|SPM|GHM)(?:$|[\s_-])') {
        $manualType = $Matches[1].ToUpperInvariant()
    }
    [pscustomobject]@{
        document_id = $parts[0]
        source_name = $sourceName
        source_blob = "$Container/$BlobName"
        source_content_md5 = [string]$Blob.contentMd5
        lineage_key = $lineageKey
        title = $title.Trim()
        ata = $ata
        manual_type = $manualType
    }
}

function Get-LegacyAssetCatalog {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Legacy image lineage map not found: $Path"
    }
    $map = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    $catalog = @{}
    foreach ($entry in @($map.PSObject.Properties)) {
        if ($entry.Name -notmatch '^(.*)_p(\d+)$') { continue }
        $lineageKey = $Matches[1]
        $page = [int]$Matches[2]
        $pathValue = [string]$entry.Value
        $assetFile = [IO.Path]::GetFileName($pathValue)
        $extension = [IO.Path]::GetExtension($assetFile).TrimStart('.').ToLowerInvariant()
        $mediaType = switch ($extension) {
            'png' { 'image/png' }
            'jpg' { 'image/jpeg' }
            'jpeg' { 'image/jpeg' }
            'webp' { 'image/webp' }
            default { $null }
        }
        if (-not $catalog.ContainsKey($lineageKey)) { $catalog[$lineageKey] = @() }
        $catalog[$lineageKey] += [ordered]@{
            asset_id = [IO.Path]::GetFileNameWithoutExtension($assetFile)
            kind = 'diagram'
            source_reference = "legacy-rag-image://$assetFile"
            media_type = $mediaType
            page = $page
            caption = "Manual figure from page $page"
            content_hash = $null
            availability = 'missing'
        }
    }
    return $catalog
}

Write-Host 'Resolving Azure identity and Search credentials.'
$searchAdminKey = Invoke-WithRetry {
    $value = az search admin-key show `
        --resource-group $ResourceGroup `
        --service-name $SearchService `
        --query primaryKey `
        -o tsv 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $value) {
        throw 'Transient Azure CLI failure while resolving Search credentials.'
    }
    return $value
}
if (-not $searchAdminKey) { throw 'Azure Search admin key is unavailable through the authenticated CLI.' }
Write-Host 'Search credentials resolved.'
$headers = @{ 'api-key' = $searchAdminKey }
$searchBase = "https://$SearchService.search.windows.net"

Write-Host 'Reading authoritative blob inventory.'
$blobInventoryJson = Invoke-WithRetry {
    $value = az storage blob list `
        --account-name $StorageAccount `
        --container-name $Container `
        --auth-mode login `
        --num-results '*' `
        --query "[].{name:name,contentMd5:properties.contentSettings.contentMd5}" `
        -o json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $value) {
        throw 'Transient Azure CLI failure while reading blob inventory.'
    }
    return $value
}
if (-not $blobInventoryJson) { throw 'Blob inventory is unavailable.' }
$manualCatalog = @{}
($blobInventoryJson | ConvertFrom-Json) |
    Where-Object { $_.name -match '_extracted\.md$' -and $_.name -notmatch '_NTSB_|_GENERAL_FAA_' } |
    ForEach-Object {
        $metadata = Get-ManualMetadata $_
        $manualCatalog[$metadata.document_id] = $metadata
    }
if ($manualCatalog.Count -eq 0) { throw 'No classified manual source blobs were found.' }
Write-Host "Classified $($manualCatalog.Count) manual source blobs."

$legacyAssetCatalog = Get-LegacyAssetCatalog $LegacyImageMapPath
$documentsByLineageKey = @{}
foreach ($metadata in $manualCatalog.Values) {
    if (-not $documentsByLineageKey.ContainsKey($metadata.lineage_key)) {
        $documentsByLineageKey[$metadata.lineage_key] = @()
    }
    $documentsByLineageKey[$metadata.lineage_key] += $metadata.document_id
}
Write-Host "Loaded $($legacyAssetCatalog.Count) legacy image lineage keys."
foreach ($metadata in $manualCatalog.Values) {
    $assets = @($legacyAssetCatalog[$metadata.lineage_key])
    $matchingDocumentCount = @($documentsByLineageKey[$metadata.lineage_key]).Count
    if ($assets.Count -gt 0 -and $matchingDocumentCount -eq 1) {
        $metadata | Add-Member -NotePropertyName assets_json -NotePropertyValue ($assets | ConvertTo-Json -Depth 5 -Compress)
        $metadata | Add-Member -NotePropertyName lineage_state -NotePropertyValue 'legacy_map_assets_missing'
    }
    elseif ($assets.Count -gt 0) {
        $metadata | Add-Member -NotePropertyName assets_json -NotePropertyValue '[]'
        $metadata | Add-Member -NotePropertyName lineage_state -NotePropertyValue 'legacy_map_ambiguous'
    }
    else {
        $metadata | Add-Member -NotePropertyName assets_json -NotePropertyValue '[]'
        $metadata | Add-Member -NotePropertyName lineage_state -NotePropertyValue 'text_only'
    }
}

$indexDefinition = @{
    name = $TargetIndex
    fields = @(
        @{ name = 'id'; type = 'Edm.String'; key = $true; filterable = $true },
        @{ name = 'document_id'; type = 'Edm.String'; filterable = $true },
        @{ name = 'content'; type = 'Edm.String'; searchable = $true },
        @{ name = 'content_vector'; type = 'Collection(Edm.Single)'; searchable = $true; dimensions = 1536; vectorSearchProfile = 'manualHnswProfile' },
        @{ name = 'source_class'; type = 'Edm.String'; filterable = $true; facetable = $true },
        @{ name = 'source_name'; type = 'Edm.String'; searchable = $true; filterable = $true },
        @{ name = 'source_blob'; type = 'Edm.String'; filterable = $true },
        @{ name = 'source_content_md5'; type = 'Edm.String'; filterable = $true },
        @{ name = 'title'; type = 'Edm.String'; searchable = $true; filterable = $true },
        @{ name = 'aircraft_model'; type = 'Edm.String'; searchable = $true; filterable = $true; facetable = $true },
        @{ name = 'manual_type'; type = 'Edm.String'; filterable = $true; facetable = $true },
        @{ name = 'ata'; type = 'Edm.String'; filterable = $true; facetable = $true },
        @{ name = 'section'; type = 'Edm.String'; searchable = $true; filterable = $true },
        @{ name = 'revision'; type = 'Edm.String'; filterable = $true },
        @{ name = 'effective_date'; type = 'Edm.DateTimeOffset'; filterable = $true; sortable = $true },
        @{ name = 'content_hash'; type = 'Edm.String'; filterable = $true },
        @{ name = 'assets_json'; type = 'Edm.String' },
        @{ name = 'lineage_state'; type = 'Edm.String'; filterable = $true; facetable = $true },
        @{ name = 'ingested_at'; type = 'Edm.DateTimeOffset'; filterable = $true; sortable = $true }
    )
    vectorSearch = @{
        algorithms = @(@{ name = 'manualHnsw'; kind = 'hnsw' })
        profiles = @(@{ name = 'manualHnswProfile'; algorithm = 'manualHnsw' })
    }
}

$targetUri = "$searchBase/indexes/$TargetIndex`?api-version=$ApiVersion"
$indexDefinitionJson = $indexDefinition | ConvertTo-Json -Depth 8
Write-Host "Creating or updating target index $TargetIndex."
$null = Invoke-WithRetry {
    Invoke-SearchRest -Method Put -Uri $targetUri -Body $indexDefinitionJson
}
Write-Host "Created or updated target index $TargetIndex; migration will merge or upload records."

$documentIds = @($manualCatalog.Keys)
$filter = "search.in(document_id, '$($documentIds -join ',')', ',')"
$sourceSearchUri = "$searchBase/indexes/$SourceIndex/docs/search?api-version=$ApiVersion"
$targetUploadUri = "$searchBase/indexes/$TargetIndex/docs/index?api-version=$ApiVersion"
$pageSize = 100
$uploadSize = 50
$skip = 0
$migrated = 0
$observedDocuments = @{}
$ingestedAt = [DateTimeOffset]::UtcNow.ToString('o')

while ($true) {
    $searchBody = @{
        search = '*'
        filter = $filter
        select = 'id,document_id,content,content_vector'
        orderby = 'id asc'
        top = $pageSize
        skip = $skip
    } | ConvertTo-Json -Depth 5
    $page = Invoke-WithRetry {
        Invoke-SearchRest -Method Post -Uri $sourceSearchUri -Body $searchBody
    }
    if (-not $page.value -or $page.value.Count -eq 0) { break }

    $actions = foreach ($source in $page.value) {
        $metadata = $manualCatalog[$source.document_id]
        if (-not $metadata) { continue }
        $observedDocuments[$source.document_id] = $true
        $hasher = [Security.Cryptography.SHA256]::Create()
        try {
            $hashBytes = $hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$source.content))
        }
        finally { $hasher.Dispose() }
        $contentHash = 'sha256:' + ([BitConverter]::ToString($hashBytes) -replace '-', '').ToLowerInvariant()
        [ordered]@{
            '@search.action' = 'mergeOrUpload'
            id = $source.id
            document_id = $source.document_id
            content = $source.content
            content_vector = $source.content_vector
            source_class = 'manual'
            source_name = $metadata.source_name
            source_blob = $metadata.source_blob
            source_content_md5 = $metadata.source_content_md5
            title = $metadata.title
            aircraft_model = $null
            manual_type = $metadata.manual_type
            ata = $metadata.ata
            section = $null
            revision = $null
            effective_date = $null
            content_hash = $contentHash
            assets_json = $metadata.assets_json
            lineage_state = $metadata.lineage_state
            ingested_at = $ingestedAt
        }
    }

    for ($offset = 0; $offset -lt $actions.Count; $offset += $uploadSize) {
        $end = [Math]::Min($offset + $uploadSize - 1, $actions.Count - 1)
        $batch = @($actions[$offset..$end])
        $batchJson = @{ value = $batch } | ConvertTo-Json -Depth 8 -Compress
        $response = Invoke-WithRetry {
            Invoke-SearchRest -Method Post -Uri $targetUploadUri -Body $batchJson
        }
        $failed = @($response.value | Where-Object { -not $_.status })
        if ($failed.Count -gt 0) { throw "$($failed.Count) Search indexing actions failed." }
        $migrated += $batch.Count
    }

    $skip += $page.value.Count
    Write-Host "Migrated $migrated chunks from $($observedDocuments.Count) source documents."
    if ($page.value.Count -lt $pageSize) { break }
}

$stats = Invoke-WithRetry {
    Invoke-SearchRest -Method Get -Uri "$searchBase/indexes/$TargetIndex/stats?api-version=$ApiVersion"
}
[pscustomobject]@{
    targetIndex = $TargetIndex
    migratedChunks = $migrated
    migratedDocuments = $observedDocuments.Count
    indexedDocumentCount = $stats.documentCount
    storageSize = $stats.storageSize
    classifiedManualBlobs = $manualCatalog.Count
} | ConvertTo-Json
