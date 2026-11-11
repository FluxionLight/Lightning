#!/usr/bin/env bash
set -euo pipefail
mkdir -p /build
tar -C /source --exclude=node_modules --exclude=target --exclude='target-*' --exclude=release --exclude=test-results --exclude=dist --exclude=.pnpm-store --exclude=.git --exclude=.android-signing -cf - . | tar -xf - -C /build
cd /build
pnpm install --frozen-lockfile
pnpm tauri android init --ci --skip-targets-install
cat src-tauri/gen/android/app/build.gradle.kts
