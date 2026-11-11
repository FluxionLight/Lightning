#!/usr/bin/env bash
set -euo pipefail
# /source is read-only; compilation and dependency caches live in /build.
mkdir -p /build /out
tar -C /source --exclude=node_modules --exclude=target --exclude='target-*' \
    --exclude=release --exclude=test-results --exclude=dist --exclude=.pnpm-store \
    --exclude=.git --exclude=.android-signing -cf - . | tar -xf - -C /build
cd /build
export CARGO_TARGET_DIR=/build/target-linux CARGO_BUILD_JOBS=4 CARGO_PROFILE_DEV_DEBUG=0
pnpm install --frozen-lockfile
pnpm build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
cargo run --locked --manifest-path src-tauri/Cargo.toml --example smoke
pnpm tauri build --bundles deb
version="$(node -p 'JSON.parse(require("fs").readFileSync("package.json")).version')"
package="$CARGO_TARGET_DIR/release/bundle/deb/Lightning_${version}_amd64.deb"
test -f "$package"
test "$(dpkg-deb --field "$package" Version)" = "$version"
output="/out/Lightning_${version}_amd64.deb"
cp "$package" "$output"
cp docs/ubuntu.md /out/README-Ubuntu.md
cd /out
sha256sum "$(basename "$output")" > "$(basename "$output").sha256"
dpkg-deb --info "$output"
