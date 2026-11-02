# Builds the shareable production APKs for Chess Alokas.
#
#   powershell -ExecutionPolicy Bypass -File apps\mobile\scripts\build-production-apk.ps1
#   ... -CheckOnly   checks the inputs and says how it would sign, without building
#
# Points at the production API. The Supabase URL and public anon key are read
# from apps\web\.env.desktop when this runs, never copied anywhere or printed.
# Signing comes from %USERPROFILE%\.chess-alokas\key.properties; without that
# file the build still works, signed with the debug key, and says so loudly.
#
# Builds from a temporary copy without the desktop folders, because Flutter's
# plugin symlinks for those need Windows Developer Mode.
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'

$apiBaseUrl = 'https://chess-manager.alokas.com/api'
$mobile = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent (Split-Path -Parent $mobile)
$envFile = Join-Path $repo 'apps\web\.env.desktop'
$keyProperties = Join-Path $env:USERPROFILE '.chess-alokas\key.properties'
$work = Join-Path $env:TEMP 'alokas-production-apk'
$output = Join-Path $mobile 'build\production-apk'

function Read-EnvValue([string]$name) {
    foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
        if ($line -match "^\s*$name\s*=\s*(.*)$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ''
}

if (-not (Test-Path -LiteralPath $envFile)) { throw "Not found: $envFile" }
$supabaseUrl = Read-EnvValue 'VITE_SUPABASE_URL'
$anonKey = Read-EnvValue 'VITE_SUPABASE_ANON_KEY'
if (-not $supabaseUrl) { throw "VITE_SUPABASE_URL is empty in $envFile" }
if (-not $anonKey) { throw "VITE_SUPABASE_ANON_KEY is empty in $envFile" }
Write-Host 'Supabase settings: found (not shown)'
Write-Host "API: $apiBaseUrl"

if (Test-Path -LiteralPath $keyProperties) {
    Write-Host "Signing: release key, from $keyProperties"
} else {
    Write-Warning "No $keyProperties. These APKs will be signed with the DEBUG key. Fine to try out; they can't go on Play, and a later build signed with the real key won't install over them."
}

if ($CheckOnly) {
    Write-Host 'Check only: nothing built.'
    exit 0
}

if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
& robocopy $mobile $work /E /NFL /NDL /NJH /NJS /NP /XD build .dart_tool windows linux macos ios web .idea | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the app failed (robocopy $LASTEXITCODE)" }

Push-Location $work
try {
    & flutter pub get
    if ($LASTEXITCODE -ne 0) { throw 'flutter pub get failed' }
    # Per-architecture APKs are about half the size of a universal one, which
    # matters when sharing over WhatsApp.
    & flutter build apk --release --split-per-abi `
        --target-platform android-arm,android-arm64 `
        "--dart-define=API_BASE_URL=$apiBaseUrl" `
        "--dart-define=SUPABASE_URL=$supabaseUrl" `
        "--dart-define=SUPABASE_ANON_KEY=$anonKey"
    if ($LASTEXITCODE -ne 0) { throw 'flutter build failed' }

    New-Item -ItemType Directory -Force -Path $output | Out-Null
    Copy-Item 'build\app\outputs\flutter-apk\app-arm64-v8a-release.apk' (Join-Path $output 'chess-alokas-arm64.apk') -Force
    Copy-Item 'build\app\outputs\flutter-apk\app-armeabi-v7a-release.apk' (Join-Path $output 'chess-alokas-arm32-older-phones.apk') -Force
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Built:'
Get-ChildItem -LiteralPath $output -Filter '*.apk' | ForEach-Object {
    Write-Host ('  {0}  {1:N0} MB' -f $_.FullName, ($_.Length / 1MB))
}
Write-Host 'Share chess-alokas-arm64.apk: it fits nearly every phone from the last ten years.'
