# Installs, updates and uninstalls the built installer without any window.
# It changes the real user profile, so it only runs on a throwaway CI machine.
$ErrorActionPreference = 'Stop'
if (-not $env:CI) { throw 'Refusing to run outside CI: this would replace the installed Margin.' }

$setup = (Get-ChildItem dist\Margin-Setup-*.exe | Select-Object -First 1).FullName
$dir = Join-Path $env:LOCALAPPDATA 'Programs\Margin'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Margin'

function Invoke-Setup($exe, $options) {
  $p = Start-Process $exe -ArgumentList $options -PassThru
  if (-not $p.WaitForExit(180000)) { $p.Kill(); throw "$exe $options did not finish" }
  if ($p.ExitCode) { throw "$exe $options exited with $($p.ExitCode)" }
}
function Assert($ok, $what) { if (-not $ok) { throw "Failed: $what" }; "ok: $what" }

# Copies already out there came from the plain installer of 1.5.2, so first move one of those over.
$plain = Join-Path $env:RUNNER_TEMP 'margin-plain-1.5.2.exe'
Invoke-WebRequest 'https://github.com/DisarmedOne/Margin/releases/download/v1.5.2/Margin-Setup-1.5.2.exe' -OutFile $plain
Invoke-Setup $plain '/S'
function Get-MarginEntries { @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Where-Object { $_.GetValue('DisplayName') -like 'Margin*' }) }
$old = (Get-MarginEntries)[0]
$oldDir = Split-Path ($old.GetValue('UninstallString') -replace '^"([^"]+)".*', '$1')
Invoke-Setup $setup '--updated', '/S'
Assert (Test-Path "$oldDir\resources\app-update.yml") 'moving from the plain installer updates in the same folder'
Assert ((Get-MarginEntries).Count -eq 1 -and (Test-Path $key)) 'only one installed-apps entry remains'
Invoke-Setup "$oldDir\Uninstall Margin.exe" '--uninstall', '/S'
foreach ($i in 1..60) { if (-not (Test-Path $oldDir) -and -not (Test-Path $key)) { break }; Start-Sleep 1 }

Invoke-Setup $setup '/S'
Assert (Test-Path "$dir\Margin.exe") 'fresh install puts the app in place'
Assert (Test-Path "$dir\resources\app-update.yml") 'the app knows where to find updates'
Assert (Test-Path $key) 'it appears in installed apps'

Set-Content "$dir\stale.txt" 'from the old version'
Invoke-Setup $setup '--updated', '/S'
Assert ((Test-Path "$dir\Margin.exe") -and -not (Test-Path "$dir\stale.txt")) 'update replaces the old version'
Assert (-not (Test-Path "$dir.old") -and -not (Test-Path "$dir.new")) 'update leaves no spare folders'

# The uninstaller hands over to a temp copy and returns at once, so wait for the result.
Invoke-Setup "$dir\Uninstall Margin.exe" '--uninstall', '/S'
foreach ($i in 1..60) { if (-not (Test-Path $dir) -and -not (Test-Path $key)) { break }; Start-Sleep 1 }
Assert (-not (Test-Path $dir)) 'uninstall removes the app'
Assert (-not (Test-Path $key)) 'uninstall removes the installed-apps entry'
