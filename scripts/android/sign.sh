#!/usr/bin/env bash
set -euo pipefail
cd /build
unsigned=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
test -f "$unsigned"
for abi in arm64-v8a x86_64; do
  unzip -Z1 "$unsigned" | grep -x "lib/$abi/liblightning_lib.so" >/dev/null
  unzip -Z1 "$unsigned" | grep -x "lib/$abi/libpdfium.so" >/dev/null
done
if [[ ! -f /signing/lightning.jks ]]; then
  head -c 32 /dev/urandom | base64 > /signing/password
  keytool -genkeypair -keystore /signing/lightning.jks -storepass:file /signing/password -keypass:file /signing/password -alias lightning -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Lightning, OU=Local distribution, O=Lightning'
fi
version="$(node -p 'JSON.parse(require("fs").readFileSync("package.json")).version')"
output="/out/Lightning_${version}_android.apk"
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -P 16 -f 4 "$unsigned" /build/lightning-aligned.apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner" sign --ks /signing/lightning.jks --ks-key-alias lightning --ks-pass file:/signing/password --out "$output" /build/lightning-aligned.apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose "$output"
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 -v 4 "$output" | tail -n 1
cd /out
sha256sum "$(basename "$output")" > "$(basename "$output").sha256"
