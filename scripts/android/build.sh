#!/usr/bin/env bash
set -euo pipefail
mkdir -p /build /out /signing
tar -C /source --exclude=node_modules --exclude=target --exclude='target-*' --exclude=release --exclude=test-results --exclude=dist --exclude=.pnpm-store --exclude=.git --exclude=.android-signing -cf - . | tar -xf - -C /build
cd /build
export CARGO_TARGET_DIR=/build/target-android CARGO_BUILD_JOBS=4 GRADLE_USER_HOME=/build/gradle
pnpm install --frozen-lockfile
pnpm tauri android init --ci --skip-targets-install
android=src-tauri/gen/android
cp src-tauri/android/LightningFilesPlugin.kt "$android/app/src/main/java/com/lightning/pdfreader/"
cp src-tauri/android/MainActivity.kt "$android/app/src/main/java/com/lightning/pdfreader/"
# Keep this release on the installed stable Android SDK.
sed -i -E 's/compileSdk = [0-9]+/compileSdk = 36/;s/targetSdk = [0-9]+/targetSdk = 36/;s/enable = true/enable = false/' "$android/app/build.gradle.kts"
gradle_version="$(sed -nE 's/.*gradle-([0-9.]+)-bin.zip.*/\1/p' "$android/gradle/wrapper/gradle-wrapper.properties")"
gradle_zip="/build/gradle-distributions/gradle-$gradle_version-bin.zip"
mkdir -p /build/gradle-distributions
expected="$(curl -fsSL --max-time 240 "http://127.0.0.1:19272/gradle/gradle-$gradle_version-bin.zip.sha256")"
if ! printf '%s  %s\n' "$expected" "$gradle_zip" | sha256sum -c - 2>/dev/null; then
  curl -fSL --max-time 300 "http://127.0.0.1:19272/gradle/gradle-$gradle_version-bin.zip" -o "$gradle_zip"
  printf '%s  %s\n' "$expected" "$gradle_zip" | sha256sum -c -
fi
mkdir -p "$GRADLE_USER_HOME/init.d"
cp /source/scripts/android/repositories.gradle "$GRADLE_USER_HOME/init.d/lightning-repositories.gradle"
sed -i "s|^distributionUrl=.*|distributionUrl=file://$gradle_zip|;s/networkTimeout=.*/networkTimeout=180000/" "$android/gradle/wrapper/gradle-wrapper.properties"
for abi in arm64-v8a x86_64; do
  if [[ "$abi" == arm64-v8a ]]; then arch=arm64; expected=7d36c0ccbc436ec5ae0ba7ee4fff6c54d2766b7d9c4108b38b6a546a9a04ac8f; else arch=x64; expected=e90fc32f0bfcf398b9312d430abab1e202062bc78f97008b48ce468e5f907161; fi
  cache="/build/pdfium-android-$arch"
  mkdir -p "$cache" "$android/app/src/main/jniLibs/$abi" "$android/app/src/main/assets/licenses/pdfium-$abi"
  if [[ ! -f "$cache/lib/libpdfium.so" ]]; then
    curl -fSL --connect-timeout 20 --max-time 180 --retry 3 "https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F8021/pdfium-android-$arch.tgz" -o "$cache/archive.tgz"
    printf '%s  %s\n' "$expected" "$cache/archive.tgz" | sha256sum -c -
    tar -xzf "$cache/archive.tgz" -C "$cache"
  fi
  cp "$cache/lib/libpdfium.so" "$android/app/src/main/jniLibs/$abi/"
  cp -R "$cache/LICENSE" "$cache/licenses" "$android/app/src/main/assets/licenses/pdfium-$abi/"
done
pnpm tauri android build --apk --ci --target aarch64 x86_64
bash /source/scripts/android/sign.sh
