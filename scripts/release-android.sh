#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/release" "$root/test-results" "$root/.android-signing"
if ! docker image inspect lightning-builder:ubuntu22 >/dev/null 2>&1; then
  docker build --network host --build-arg "BASE_IMAGE=${LIGHTNING_LINUX_BASE_IMAGE:-ubuntu:22.04}" -t lightning-builder:ubuntu22 "$root/scripts/linux"
fi
docker build --network host -t lightning-builder:android "$root/scripts/android"
docker run --rm --network host -v "$root:/source:ro" -v lightning-android-sdk:/opt/android -v lightning-android-rustup:/opt/rustup lightning-builder:android bash /source/scripts/android/setup.sh
python3 "$root/scripts/android/artifact-proxy.py" > "$root/test-results/android-artifact-cache.log" 2>&1 &
cache_pid=$!
trap 'kill "$cache_pid" 2>/dev/null || true' EXIT
docker run --rm --network host -v "$root:/source:ro" -v "$root/release:/out" -v "$root/.android-signing:/signing" -v lightning-android-sdk:/opt/android -v lightning-android-rustup:/opt/rustup -v lightning-android-build:/build lightning-builder:android bash /source/scripts/android/build.sh
