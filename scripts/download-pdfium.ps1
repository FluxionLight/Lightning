$ErrorActionPreference = 'Stop'
# Pinned to the verified binary used by Lightning 0.1.0; no floating latest URL.
$release = 'chromium%2F8021'
$expected = '2A9031FA88F412147C3BC7115054550048C724DB6EA70298B6C6B0D13E513882'
$root = Split-Path -Parent $PSScriptRoot
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('lightning-pdfium-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
$archive = Join-Path $temporary 'pdfium.tgz'
Invoke-WebRequest -Uri "https://github.com/bblanchon/pdfium-binaries/releases/download/$release/pdfium-win-x64.tgz" -OutFile $archive
tar -xzf $archive -C $temporary
if ($LASTEXITCODE -ne 0) { throw 'PDFium archive extraction failed' }
$dll = Join-Path $temporary 'bin/pdfium.dll'
$sha = [System.Security.Cryptography.SHA256]::Create()
$inputStream = [System.IO.File]::OpenRead($dll)
try { $actual = [System.BitConverter]::ToString($sha.ComputeHash($inputStream)).Replace('-','') }
finally { $inputStream.Dispose(); $sha.Dispose() }
if ($actual -ne $expected) { throw 'PDFium checksum mismatch; existing files were not changed' }
$out = Join-Path $root 'src-tauri/pdfium'
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item -LiteralPath $dll,(Join-Path $temporary 'LICENSE'),(Join-Path $temporary 'VERSION') -Destination $out
Copy-Item -LiteralPath (Join-Path $temporary 'licenses') -Destination $out -Recurse -Force
# All removal remains inside this one, explicitly checked temporary directory.
$resolved = [System.IO.Path]::GetFullPath($temporary)
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
if (!$resolved.StartsWith($tempRoot,[System.StringComparison]::OrdinalIgnoreCase) -or !(Split-Path -Leaf $resolved).StartsWith('lightning-pdfium-')) { throw 'Unexpected temporary path; not deleting' }
Remove-Item -LiteralPath $resolved -Recurse -Force
Write-Output 'PDFium installed with verified checksum and licenses.'
