$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
  $buildRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root "src-tauri/target-v$version" }
  $env:CARGO_TARGET_DIR = $buildRoot
  pnpm tauri build --no-bundle --features tauri/devtools --config tests/tauri.qa.json
  if ($LASTEXITCODE -ne 0) { throw 'QA build failed' }
  New-Item -ItemType Directory -Force -Path 'test-results/native-app' | Out-Null
  Copy-Item -LiteralPath (Join-Path $buildRoot 'release/lightning.exe') -Destination 'test-results/native-app/Lightning.exe'
  Copy-Item -LiteralPath 'src-tauri/pdfium/pdfium.dll' -Destination 'test-results/native-app/pdfium.dll'
  node tests/native-webview.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Native WebView QA failed' }
} finally {
  # Leave the ordinary build target without the QA identifier or debugging port.
  pnpm tauri build --no-bundle
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Production build restore failed' }
  Pop-Location
}
