param([string]$CefRoot = "", [ValidateSet("Debug", "Release")][string]$Configuration = "Release")
$ErrorActionPreference = "Stop"
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $CefRoot) { $CefRoot = & (Join-Path $PSScriptRoot "bootstrap-cef.ps1") }
$CefRoot = [IO.Path]::GetFullPath($CefRoot).Replace('\','/')
$build = Join-Path $repo "cef-host/build"
$stage = Join-Path $repo "src-tauri/cef-runtime"
cmake -S (Join-Path $repo "cef-host") -B $build -G "Visual Studio 17 2022" -A x64 "-DCEF_ROOT=$CefRoot"
if ($LASTEXITCODE -ne 0) { throw "CEF host configure failed" }
cmake --build $build --config $Configuration --parallel
if ($LASTEXITCODE -ne 0) { throw "CEF host build failed" }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -Force (Join-Path $build "$Configuration/office360_cef_host.dll") $stage
Copy-Item -Force (Join-Path $build "$Configuration/office360-cef-subprocess.exe") $stage
Get-ChildItem -File (Join-Path $CefRoot "Release") | Copy-Item -Force -Destination $stage
Get-ChildItem -File (Join-Path $CefRoot "Resources") | Copy-Item -Force -Destination $stage
$locales = Join-Path $stage "locales"
New-Item -ItemType Directory -Force -Path $locales | Out-Null
Get-ChildItem -File (Join-Path $CefRoot "Resources/locales") | Copy-Item -Force -Destination $locales
& (Join-Path $PSScriptRoot "verify-cef-payload.ps1") -PayloadPath $stage
Write-Output $stage
