param([string]$Destination = ".deps/cef")
$ErrorActionPreference = "Stop"
$version = "cef_binary_148.0.9+g0d9d52a+chromium-148.0.7778.180_windows64"
$archiveName = "$version.tar.bz2"
$expectedSha256 = "fec566831d3468460d7f8923517ce1c204f6e1a757b3352c3d3c162b41b689ff"
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$destinationPath = [IO.Path]::GetFullPath((Join-Path $repo $Destination))
$sdkPath = Join-Path $destinationPath "sdk/$version"
if (Test-Path (Join-Path $sdkPath "cmake/FindCEF.cmake")) { Write-Output $sdkPath; exit 0 }
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null
$archivePath = Join-Path $destinationPath $archiveName
if (-not (Test-Path $archivePath)) { Invoke-WebRequest -Uri "https://cef-builds.spotifycdn.com/$archiveName" -OutFile $archivePath }
$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) { throw "CEF archive SHA-256 mismatch: $actualSha256" }
New-Item -ItemType Directory -Force -Path (Join-Path $destinationPath "sdk") | Out-Null
tar -xjf $archivePath -C (Join-Path $destinationPath "sdk")
if (-not (Test-Path (Join-Path $sdkPath "cmake/FindCEF.cmake"))) { throw "CEF SDK extraction failed" }
Write-Output $sdkPath
