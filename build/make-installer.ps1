# Builds dist\Margin Setup <version>.exe: the custom installer stub with the packaged app appended.
# Layout: [MarginSetup.exe][app zip][manifest json][zip length:8][json length:8]["MARGINPK"]
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$app = Join-Path $root 'dist\win-unpacked'
if (-not (Test-Path (Join-Path $app 'Margin.exe'))) { throw "Run electron-builder --dir first; $app\Margin.exe is missing." }

dotnet build installer\MarginSetup.csproj -c Release -o installer\bin\out --nologo -v q
if ($LASTEXITCODE) { throw 'Installer build failed.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $env:TEMP "margin-payload-$version.zip"
Remove-Item $zip -ErrorAction SilentlyContinue
[IO.Compression.ZipFile]::CreateFromDirectory($app, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

$json = [Text.Encoding]::UTF8.GetBytes((@{ version = $version } | ConvertTo-Json -Compress))
$out = Join-Path $root "dist\Margin Setup $version.exe"
$fs = [IO.File]::Create($out)
try {
  foreach ($part in @((Join-Path $root 'installer\bin\out\MarginSetup.exe'), $zip)) {
    $in = [IO.File]::OpenRead($part); $in.CopyTo($fs); $in.Dispose()
  }
  $fs.Write($json, 0, $json.Length)
  $fs.Write([BitConverter]::GetBytes([long](Get-Item $zip).Length), 0, 8)
  $fs.Write([BitConverter]::GetBytes([long]$json.Length), 0, 8)
  $magic = [Text.Encoding]::ASCII.GetBytes('MARGINPK'); $fs.Write($magic, 0, 8)
} finally { $fs.Dispose() }
Remove-Item $zip
"Built $out ({0:N1} MB)" -f ((Get-Item $out).Length / 1MB)
