# Builds launcher\Study Buddy.exe (the launcher and updater) with the C# compiler built into Windows.
# Also copies it to this folder so you can start your own copy with a double-click.
# Run:  powershell -ExecutionPolicy Bypass -File build-launcher.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $root 'launcher'
$obj = Join-Path $dir 'obj'
New-Item -ItemType Directory -Force $obj | Out-Null

$version = (Get-Content (Join-Path $root 'version.json') -Raw | ConvertFrom-Json).launcher
if (-not $version) { $version = '1.0.0' }

# 1. Icon: an index card with a red margin line and blue rules, as PNG frames inside an .ico file.
function New-CardPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 32.0
  $card = New-Object System.Drawing.RectangleF (2 * $s), (6 * $s), (28 * $s), (20 * $s)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 253, 246))), $card)
  $hi = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 246, 224, 94))
  $g.FillRectangle($hi, (6 * $s), (15 * $s), (16 * $s), (4 * $s))
  $rule = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 44, 91, 168)), ([Math]::Max(1, 1.4 * $s))
  $g.DrawLine($rule, (6 * $s), (21.5 * $s), (24 * $s), (21.5 * $s))
  $red = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 210, 68, 63)), ([Math]::Max(1, 1.6 * $s))
  $g.DrawLine($red, (2 * $s), (11 * $s), (30 * $s), (11 * $s))
  $border = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 44, 91, 168)), ([Math]::Max(1, 2 * $s))
  $g.DrawRectangle($border, $card.X, $card.Y, $card.Width, $card.Height)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return ,$ms.ToArray()
}
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @($sizes | ForEach-Object { ,(New-CardPng $_) })
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ico
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $px = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $w.Write([byte]$px); $w.Write([byte]$px); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$pngs[$i].Length); $w.Write([UInt32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Flush()
$icoPath = Join-Path $dir 'app.ico'
[IO.File]::WriteAllBytes($icoPath, $ico.ToArray())

# 2. Version info compiled into the exe.
$buildInfo = @"
using System.Reflection;
[assembly: AssemblyTitle("Study Buddy")]
[assembly: AssemblyProduct("Study Buddy")]
[assembly: AssemblyDescription("Study Buddy launcher and updater")]
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyFileVersion("$version.0")]
namespace StudyBuddyLauncher { static class Build { public const string Version = "$version"; } }
"@
$buildInfoPath = Join-Path $obj 'BuildInfo.cs'
[IO.File]::WriteAllText($buildInfoPath, $buildInfo)

# 3. Compile.
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$exe = Join-Path $dir 'Study Buddy.exe'
$cscArgs = @('/nologo', '/target:winexe', '/optimize+', "/out:$exe", "/win32icon:$icoPath",
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll',
  '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll',
  (Join-Path $dir 'Launcher.cs'), $buildInfoPath)
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "The launcher did not compile." }

# 4. Developer copy at the top of this folder (opens index.html here, never self-updates).
Copy-Item $exe (Join-Path $root 'Study Buddy.exe') -Force
Write-Host "Built launcher $version -> launcher\Study Buddy.exe (and a copy in this folder)"
