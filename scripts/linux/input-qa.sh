#!/usr/bin/env bash
set -euo pipefail
cd /build
cp /source/src-tauri/src/lib.rs src-tauri/src/
cp /source/src-tauri/src/linux_input.rs src-tauri/src/
cp /source/src-tauri/Cargo.toml src-tauri/Cargo.toml
export CARGO_TARGET_DIR=/build/target-linux CARGO_PROFILE_DEV_DEBUG=0
cargo build --locked --manifest-path src-tauri/Cargo.toml --features input-qa,custom-protocol
cp src-tauri/pdfium/linux-x64/libpdfium.so "$CARGO_TARGET_DIR/debug/"
export LIGHTNING_QA_OUTPUT=/qaout LIGHTNING_QA_BINARY=/build/target-linux/debug/lightning
export LIGHTNING_QA_PORT=4445
export XDG_DATA_HOME=/tmp/lightning-input-qa/data XDG_CONFIG_HOME=/tmp/lightning-input-qa/config XDG_CACHE_HOME=/tmp/lightning-input-qa/cache
export TAURI_WEBVIEW_AUTOMATION=true LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
xvfb-run -a -s '-screen 0 1440x1000x24' dbus-run-session -- python3 /source/tests/ubuntu-native.py
