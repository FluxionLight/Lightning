#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
expected=685f7930cd184ea22cd77afe707c1cf53b173d18118b6e16cb213c9277d7cdc3
temporary="$(mktemp -d -t lightning-pdfium-XXXXXXXX)"
trap 'rm -rf -- "$temporary"' EXIT
curl -fSL --retry 3 https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F8021/pdfium-linux-x64.tgz -o "$temporary/pdfium.tgz"
printf '%s  %s\n' "$expected" "$temporary/pdfium.tgz" | sha256sum -c -
tar -xzf "$temporary/pdfium.tgz" -C "$temporary"
out="$root/src-tauri/pdfium/linux-x64"
mkdir -p "$out"
install -m 644 "$temporary/lib/libpdfium.so" "$out/libpdfium.so"
cp "$temporary/LICENSE" "$temporary/VERSION" "$out/"
cp -R "$temporary/licenses" "$out/"
echo 'Linux PDFium and licenses installed with verified archive SHA-256.'
