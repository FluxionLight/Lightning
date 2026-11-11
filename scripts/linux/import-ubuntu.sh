#!/usr/bin/env bash
set -euo pipefail
# Alternative to Docker Hub: import the official Canonical minimal rootfs.
root="$(cd "$(dirname "$0")/../.." && pwd)"
cache="$root/test-results/linux-downloads"
mkdir -p "$cache"
cd "$cache"
version="${1:-22.04}"
case "$version" in 22.04) codename=jammy;;24.04)codename=noble;;*)exit 1;;esac
base="https://cloud-images.ubuntu.com/minimal/releases/$codename/release"
archive="ubuntu-$version-minimal-cloudimg-amd64-root.tar.xz"
curl -4 -fSL --connect-timeout 20 --max-time 60 --retry 2 "$base/SHA256SUMS" -o SHA256SUMS
curl -4 -fSL --connect-timeout 20 --max-time 300 --retry 2 "$base/$archive" -o "$archive"
grep " \*$archive$" SHA256SUMS | sha256sum -c -
docker --config "$root/test-results/docker-public" import "$archive" "lightning-ubuntu:$version"
