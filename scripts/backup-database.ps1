param(
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$resolved = [System.IO.Path]::GetFullPath($OutputDirectory)
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ($resolved.StartsWith($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Database backups must be written outside the repository. Choose an encrypted CLSU-controlled folder."
}
New-Item -ItemType Directory -Path $resolved -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$schemaPath = Join-Path $resolved "facultyconnect-schema-$timestamp.sql"
$dataPath = Join-Path $resolved "facultyconnect-data-$timestamp.sql"

Write-Host "Creating a schema backup without printing credentials..."
npx.cmd supabase db dump --linked --file $schemaPath
if ($LASTEXITCODE -ne 0) { throw "Schema backup failed." }

Write-Host "Creating a data-only backup..."
npx.cmd supabase db dump --linked --data-only --file $dataPath
if ($LASTEXITCODE -ne 0) { throw "Data backup failed." }

Get-FileHash -Algorithm SHA256 $schemaPath,$dataPath |
  Select-Object Path,Hash |
  Format-Table -AutoSize

Write-Host "Backups created in $resolved. Move them to encrypted CLSU-controlled storage."
