# Checks the app's scripts for a mistake that breaks the whole app without any warning while editing.
# All scripts share one global scope, so two files declaring the same top-level const, let or class
# makes the browser reject the second file entirely. (Version 1.0.6 shipped with that bug.)
# Run by publish-update.ps1 before every release; run it by hand any time:
#   powershell -ExecutionPolicy Bypass -File check-scripts.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$html = Get-Content (Join-Path $root 'index.html') -Raw
$files = [regex]::Matches($html, '<script src="(js/[^"]+)"></script>') | ForEach-Object { $_.Groups[1].Value }

$seen = @{}
$problems = @()
foreach ($f in $files) {
  $path = Join-Path $root $f
  if (-not (Test-Path $path)) { $problems += "index.html loads $f, but that file does not exist."; continue }
  $lineNo = 0
  foreach ($line in [IO.File]::ReadAllLines($path)) {
    $lineNo++
    # Top-level declarations start at the beginning of the line.
    $m = [regex]::Match($line, '^(?:const|let|var|class|function|async function)\s+([A-Za-z_$][\w$]*)')
    if (-not $m.Success) { continue }
    $name = $m.Groups[1].Value
    if ($seen.ContainsKey($name)) { $problems += "'$name' is declared in both $($seen[$name]) and ${f}:$lineNo" }
    else { $seen[$name] = "${f}:$lineNo" }
  }
}

if ($problems.Count) {
  $problems | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  throw "Script check failed: rename one of each pair above (the second file would not load)."
}
Write-Host "Script check passed: $($files.Count) files, $($seen.Count) top-level names, no clashes."
