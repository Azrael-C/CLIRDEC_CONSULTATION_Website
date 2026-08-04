
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = "C:\xampp\htdocs\FacultyConsultationPortal\faculty-consultation-mvp"

if (-not (Test-Path -LiteralPath $target)) {
    throw "XAMPP project folder was not found: $target"
}

Copy-Item -LiteralPath (Join-Path $source "src\App.tsx") -Destination (Join-Path $target "src\App.tsx") -Force
Copy-Item -LiteralPath (Join-Path $source "src\styles.css") -Destination (Join-Path $target "src\styles.css") -Force

Write-Host "Updated the XAMPP React source files."
Write-Host "Next: open PowerShell in $target and run npm install, then npm run dev."
