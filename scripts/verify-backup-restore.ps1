param(
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [string]$ChecksumManifest,
  [switch]$SkipRestore
)

$ErrorActionPreference = "Stop"
$resolvedBackup = [System.IO.Path]::GetFullPath($BackupDirectory)
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ($resolvedBackup.StartsWith($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Backups must be verified outside the repository."
}

$schemaPath = Join-Path $resolvedBackup "schema.sql"
$dataPath = Join-Path $resolvedBackup "data.sql"
# backup-database.ps1 uses timestamped filenames so multiple drills can share
# an encrypted folder. Prefer an explicitly named pair, otherwise resolve the
# newest matching schema/data pair from that folder.
if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $dataPath -PathType Leaf)) {
  $schemaCandidates = @(Get-ChildItem -LiteralPath $resolvedBackup -Filter "facultyconnect-schema-*.sql" -File |
      Sort-Object LastWriteTime -Descending)
  foreach ($candidate in $schemaCandidates) {
    $stamp = $candidate.BaseName -replace '^facultyconnect-schema-', ''
    $matchingData = Join-Path $resolvedBackup "facultyconnect-data-$stamp.sql"
    if (Test-Path -LiteralPath $matchingData -PathType Leaf) {
      $schemaPath = $candidate.FullName
      $dataPath = $matchingData
      break
    }
  }
}
foreach ($path in @($schemaPath, $dataPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Backup file not found: $path" }
  $file = Get-Item -LiteralPath $path
  if ($file.Length -lt 128) { throw "Backup file is unexpectedly small: $path" }
}

if ([string]::IsNullOrWhiteSpace($ChecksumManifest)) {
  $stamp = $schemaPath | Split-Path -Leaf | ForEach-Object { $_ -replace '^facultyconnect-schema-', '' -replace '\.sql$', '' }
  $candidateManifest = Join-Path $resolvedBackup "facultyconnect-backup-$stamp.sha256"
  if (Test-Path -LiteralPath $candidateManifest -PathType Leaf) { $ChecksumManifest = $candidateManifest }
}
if ($ChecksumManifest) {
  if (-not (Test-Path -LiteralPath $ChecksumManifest -PathType Leaf)) { throw "Checksum manifest not found: $ChecksumManifest" }
  foreach ($path in @($schemaPath, $dataPath)) {
    $name = [System.IO.Path]::GetFileName($path)
    $escapedName = [regex]::Escape($name)
    $line = Get-Content -LiteralPath $ChecksumManifest | Where-Object { $_ -match "\s$escapedName$" } | Select-Object -First 1
    if (-not $line) { throw "Checksum manifest does not contain $name" }
    $expected = ($line -split '\s+')[0].ToUpperInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToUpperInvariant()
    if ($actual -ne $expected) { throw "Checksum mismatch for $name" }
  }
  Write-Host "Checksum manifest verified: $ChecksumManifest"
} else {
  Write-Warning "No checksum manifest supplied; continuing with size and restore checks only."
}

Write-Host "Backup files are present and non-empty. SHA-256 checksums:"
Get-FileHash -Algorithm SHA256 -LiteralPath $schemaPath, $dataPath |
  Select-Object Path, Hash |
  Format-Table -AutoSize

if ($SkipRestore) {
  Write-Host "Restore phase skipped by request."
  exit 0
}

$restoreUrl = [Environment]::GetEnvironmentVariable("FACULTYCONNECT_RESTORE_DATABASE_URL")
if ([string]::IsNullOrWhiteSpace($restoreUrl)) {
  throw "Set FACULTYCONNECT_RESTORE_DATABASE_URL to an isolated, non-production Postgres project before restoring."
}
try {
  $uri = [System.Uri]$restoreUrl
  if ($uri.Host -match "ieuipychazciovjhkpps|clsufacultyconnect|prod") {
    throw "Refusing to restore into a production-looking database host."
  }
} catch [System.UriFormatException] {
  throw "FACULTYCONNECT_RESTORE_DATABASE_URL is not a valid Postgres connection URL."
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw "psql is required for the restore phase. Install PostgreSQL client tools or run this drill in CI."
}

Write-Host "Restoring schema into the isolated target..."
& psql $restoreUrl --set=ON_ERROR_STOP=1 --single-transaction --file $schemaPath
if ($LASTEXITCODE -ne 0) { throw "Schema restore failed." }

Write-Host "Restoring data into the isolated target..."
& psql $restoreUrl --set=ON_ERROR_STOP=1 --single-transaction --file $dataPath
if ($LASTEXITCODE -ne 0) { throw "Data restore failed." }

$verification = "select count(*) from information_schema.tables where table_schema = 'public';"
$tableCount = (& psql $restoreUrl --tuples-only --no-align --command $verification).Trim()
if ($LASTEXITCODE -ne 0 -or [int]$tableCount -lt 1) {
  throw "Restore verification failed: no public tables were found."
}
Write-Host "Restore verification passed. Public tables restored: $tableCount"
Write-Host "Run the isolated Playwright lifecycle against this target, then delete it through the Supabase dashboard after recording evidence."
