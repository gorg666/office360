param([Parameter(Mandatory=$true)][string]$PayloadPath)
$ErrorActionPreference = "Stop"
$payload = [IO.Path]::GetFullPath($PayloadPath)
$required = @("office360_cef_host.dll", "office360-cef-subprocess.exe", "libcef.dll", "chrome_elf.dll", "icudtl.dat", "resources.pak", "chrome_100_percent.pak", "chrome_200_percent.pak", "v8_context_snapshot.bin", "locales/ru.pak", "locales/en-US.pak")
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $payload $_)) })
if ($missing.Count) { throw "CEF payload is incomplete: $($missing -join ', ')" }
Write-Output "CEF payload verified: $payload"
