#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$(uname -m)" != x86_64 ]]; then echo 'This build targets x86_64 / amd64.' >&2; exit 1; fi
if [[ ! -f "$root/src-tauri/pdfium/linux-x64/libpdfium.so" ]]; then bash "$root/scripts/download-pdfium.sh"; fi
docker build --network host --build-arg "BASE_IMAGE=${LIGHTNING_LINUX_BASE_IMAGE:-ubuntu:22.04}" -t lightning-builder:ubuntu22 "$root/scripts/linux"
mkdir -p "$root/release"
docker run --rm --network host \
    -v "$root:/source:ro" -v "$root/release:/out" -v lightning-linux-build:/build \
    -v lightning-cargo-registry:/opt/cargo/registry \
    lightning-builder:ubuntu22 bash /source/scripts/linux/build.sh
