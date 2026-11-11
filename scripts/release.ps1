$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
  $buildRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root "src-tauri/target-v$version" }
  $env:CARGO_TARGET_DIR = $buildRoot
  # Tauri runs the frontend build first, then embeds that dist into the executable.
  pnpm tauri build --no-bundle
  if ($LASTEXITCODE -ne 0) { throw 'Release build failed' }
  $destination = Join-Path $root "release/Lightning-$version-windows-x64"
  if (Test-Path -LiteralPath $destination) {
    $destination = "$destination-$(Get-Date -Format yyyyMMdd-HHmmss)"
  }
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Copy-Item -LiteralPath (Join-Path $buildRoot 'release/lightning.exe') -Destination (Join-Path $destination 'Lightning.exe')
  Copy-Item -LiteralPath 'src-tauri/pdfium/pdfium.dll' -Destination $destination
  Copy-Item -LiteralPath 'src-tauri/pdfium/LICENSE' -Destination (Join-Path $destination 'PDFium-binaries-LICENSE.txt')
  Copy-Item -LiteralPath 'src-tauri/pdfium/licenses' -Destination (Join-Path $destination 'licenses') -Recurse
  Copy-Item -LiteralPath 'docs/quick-start.txt' -Destination $destination
  Copy-Item -LiteralPath 'tests/fixtures/reading-sample.pdf' -Destination $destination
  $checksums = foreach ($file in 'Lightning.exe','pdfium.dll') {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $inputStream = [System.IO.File]::OpenRead((Join-Path $destination $file))
    try { $hash = [System.BitConverter]::ToString($sha.ComputeHash($inputStream)).Replace('-',''); "$hash  $file" }
    finally { $inputStream.Dispose(); $sha.Dispose() }
  }
  [System.IO.File]::WriteAllLines((Join-Path $destination 'SHA256.txt'),[string[]]$checksums)
  $archive = "$destination.zip"
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($destination,$archive)
  Write-Output "Portable release: $destination"
  Write-Output "Archive: $archive"
} finally { Pop-Location }
