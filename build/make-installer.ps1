# Builds dist\Margin-Setup-<version>.exe and dist\latest.yml (read by the in-app updater):: the custom installer stub with the packaged app appended.
# Layout: [MarginSetup.exe][app zip][manifest json][zip length:8][json length:8]["MARGINPK"]
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$app = Join-Path $root 'dist\win-unpacked'
if (-not (Test-Path (Join-Path $app 'Margin.exe'))) { throw "Run electron-builder --dir first; $app\Margin.exe is missing." }

dotnet build installer\MarginSetup.csproj -c Release -o installer\bin\out --nologo -v q
if ($LASTEXITCODE) { throw 'Installer build failed.' }

# electron-builder only writes this file for its own installers, and the app needs it to find updates.
$publish = (Get-Content package.json -Raw | ConvertFrom-Json).build.publish
$updateConfig = "provider: $($publish.provider)`nowner: $($publish.owner)`nrepo: $($publish.repo)`nupdaterCacheDirName: margin-updater`n"
[IO.File]::WriteAllText((Join-Path $app 'resources\app-update.yml'), $updateConfig)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $env:TEMP "margin-payload-$version.zip"
Remove-Item $zip -ErrorAction SilentlyContinue
[IO.Compression.ZipFile]::CreateFromDirectory($app, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

$json = [Text.Encoding]::UTF8.GetBytes((@{ version = $version } | ConvertTo-Json -Compress))
# Keep only the installer being built; electron-builder never clears old ones out.
Get-ChildItem (Join-Path $root 'dist') -File | Where-Object Name -match '^Margin[ -]Setup[ -].*\.(exe|blockmap)$' | Remove-Item
$name = "Margin-Setup-$version.exe"
$out = Join-Path $root "dist\$name"
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

$stream = [IO.File]::OpenRead($out)
$sha = [Convert]::ToBase64String([Security.Cryptography.SHA512]::Create().ComputeHash($stream))
$stream.Dispose()
$size = (Get-Item $out).Length
$date = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$latest = "version: $version`nfiles:`n  - url: $name`n    sha512: $sha`n    size: $size`npath: $name`nsha512: $sha`nreleaseDate: '$date'`n"
[IO.File]::WriteAllText((Join-Path $root 'dist\latest.yml'), $latest)
"Built $out ({0:N1} MB)" -f ((Get-Item $out).Length / 1MB)
