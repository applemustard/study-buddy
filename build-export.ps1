# Builds the "export" folder you can send to friends:
#   export\Study Buddy (Windows).zip   - launcher + app; updates itself (best for Windows)
#   export\Study Buddy.html            - the whole app in one file (Mac, Linux, or a quick look; no auto-updates)
#   export\READ ME FIRST.txt           - how to open it
# Run again after changing the app:  powershell -ExecutionPolicy Bypass -File build-export.ps1
# Your own data (subjects, cards, API key) lives in your browser and is never included.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root 'export'
New-Item -ItemType Directory -Force $out | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding $false

# 1. Single-file app: inline the stylesheet and every local script.
$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'), $utf8)
$css = [IO.File]::ReadAllText((Join-Path $root 'css\styles.css'), $utf8)
$html = $html.Replace('<link rel="stylesheet" href="css/styles.css">', "<style>`n$css`n</style>")
$found = [regex]::Matches($html, '<script src="(js/[^"]+)"></script>')
foreach ($m in $found) {
  $file = $m.Groups[1].Value
  $js = [IO.File]::ReadAllText((Join-Path $root $file), $utf8)
  if ($js -match '</script') { throw "$file contains '</script' and cannot be inlined." }
  $html = $html.Replace($m.Value, "<script>/* $file */`n$js`n</script>")
}
[IO.File]::WriteAllText((Join-Path $out 'Study Buddy.html'), $html, $utf8)

# 2. Windows package: Study Buddy.exe next to an app folder.
$exe = Join-Path $root 'launcher\Study Buddy.exe'
if (-not (Test-Path $exe)) { & (Join-Path $root 'build-launcher.ps1') }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('study-buddy-' + [guid]::NewGuid())
$pkg = Join-Path $stage 'Study Buddy'
$app = Join-Path $pkg 'app'
New-Item -ItemType Directory -Force $app | Out-Null
Copy-Item $exe $pkg
foreach ($item in @('index.html', 'css', 'js', 'version.json', 'update.json', 'README.md')) {
  Copy-Item -Recurse (Join-Path $root $item) $app
}

# 3. Instructions for whoever receives it.
$version = (Get-Content (Join-Path $root 'version.json') -Raw | ConvertFrom-Json).version
$readme = @"
STUDY BUDDY $version
Turn your PDFs into quizzes, flashcards, notes and an exam study plan.

ON WINDOWS (recommended)
1. Right-click the Study Buddy zip file and choose "Extract All". Put the folder
   somewhere you'll keep it, such as Documents. Don't run it from inside the zip.
2. Open the folder and double-click "Study Buddy.exe".
   If Windows says "Windows protected your PC", click "More info", then "Run anyway".
   (It shows this for any app that isn't from a big company.)
3. Say Yes to the desktop icon if you want one. From now on, open Study Buddy from that icon.
   It checks for a new version each time and installs it by itself.

ON MAC OR LINUX
Double-click "Study Buddy.html". It opens in your browser. This copy does not update itself.

FIRST TIME IN THE APP
1. Go to Settings and paste a Groq API key. Get one free at https://console.groq.com
   (sign in, then API Keys, then Create API Key). The key stays on your computer.
2. Make a subject, upload a PDF and start studying. You need an internet connection.

GOT SOMETHING FROM A FRIEND?
Click "Import from a friend" (on the Subjects or Notes page) and paste the code
they sent you (it starts with SB1.) or pick the file they sent.

GOOD TO KNOW
- Your work is saved on your computer, inside the browser the app opens in.
  Updates never touch it. Keep the Study Buddy folder in the same place.
- Settings > Export backup makes a copy you can move to another computer.
"@
$readmeText = $readme -replace "`r?`n", "`r`n"
[IO.File]::WriteAllText((Join-Path $out 'READ ME FIRST.txt'), $readmeText, $utf8)
[IO.File]::WriteAllText((Join-Path $pkg 'READ ME FIRST.txt'), $readmeText, $utf8)

$zip = Join-Path $out 'Study Buddy (Windows).zip'
if (Test-Path $zip) { Remove-Item $zip }
# Entry names use "/" (the zip standard); PowerShell 5's own zip tools write "\" which some unzip tools mishandle.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in Get-ChildItem $pkg -Recurse -File) {
    $name = 'Study Buddy/' + $file.FullName.Substring($pkg.Length + 1).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $archive.Dispose() }
Remove-Item -Recurse -Force $stage

# Same zip in download\ (committed), so the repo always offers the latest version at a fixed link:
#   https://github.com/<user>/<repo>/raw/main/download/StudyBuddy-Windows.zip
$download = Join-Path $root 'download'
New-Item -ItemType Directory -Force $download | Out-Null
Copy-Item $zip (Join-Path $download 'StudyBuddy-Windows.zip') -Force
$oldZip = Join-Path $out 'Study Buddy (app folder).zip'
if (Test-Path $oldZip) { Remove-Item $oldZip }

Write-Host "Export ready in $out"
Get-ChildItem $out | ForEach-Object { Write-Host ("  {0}  ({1:N0} KB)" -f $_.Name, ($_.Length / 1KB)) }
