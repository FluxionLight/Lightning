#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$ANDROID_HOME"
if [[ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
  curl -fSL --connect-timeout 20 --max-time 300 --retry 3 https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip -o /tmp/android-tools.zip
  unzip -q /tmp/android-tools.zip -d /tmp/android-tools
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  mv /tmp/android-tools/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
fi
yes | sdkmanager --licenses >/tmp/android-licenses.log || true
sdkmanager 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' 'ndk;28.2.13676358'
rustup target add aarch64-linux-android x86_64-linux-android
