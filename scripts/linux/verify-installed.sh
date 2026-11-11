#!/usr/bin/env bash
set -euo pipefail
# Run only in a disposable Ubuntu container. No developer packages are required.
export DEBIAN_FRONTEND=noninteractive
export LIGHTNING_QA_OUTPUT=/qaout
export LIGHTNING_QA_PORT=4446
mkdir -p /qaout
echo force-unsafe-io > /etc/dpkg/dpkg.cfg.d/02-lightning-qa
apt-get update -qq
apt-get install -y --no-install-recommends "/out/Lightning_${LIGHTNING_QA_VERSION:-0.7.0}_amd64.deb" \
    fonts-noto-cjk xvfb xauth dbus-x11 webkit2gtk-driver desktop-file-utils python3
dpkg-query -W lightning
desktop="$(dpkg -L lightning | grep '/applications/.*\.desktop$')"
desktop-file-validate "$desktop"
grep -E '^(Exec|MimeType|Icon)=' "$desktop"
resource="$(dpkg -L lightning | grep '/libpdfium\.so$')"
ldd /usr/bin/lightning > /qaout/ubuntu-ldd.txt
ldd "$resource" >> /qaout/ubuntu-ldd.txt
if grep -q 'not found' /qaout/ubuntu-ldd.txt; then cat /qaout/ubuntu-ldd.txt; exit 1; fi
export XDG_DATA_HOME=/tmp/lightning-qa/data XDG_CONFIG_HOME=/tmp/lightning-qa/config XDG_CACHE_HOME=/tmp/lightning-qa/cache
export TAURI_WEBVIEW_AUTOMATION=true LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
# WebKit's nested sandbox is unavailable inside this disposable root container.
# This flag is limited to the test process; it is never set in the shipped app.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" /build/tests/fixtures
cp /source/tests/fixtures/reading-sample.pdf /build/tests/fixtures/
xvfb-run -a -s '-screen 0 1440x1000x24' dbus-run-session -- python3 /source/tests/ubuntu-native.py
apt-get remove -y lightning
test ! -e /usr/bin/lightning
test ! -e "$resource"
echo 'PASS: clean Ubuntu installation, dependencies, desktop entry, native WebKit/IPC and uninstall'
