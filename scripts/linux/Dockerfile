ARG BASE_IMAGE=ubuntu:22.04
FROM ${BASE_IMAGE}
ARG DEBIAN_FRONTEND=noninteractive
RUN echo force-unsafe-io > /etc/dpkg/dpkg.cfg.d/02-lightning-build \
    && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils build-essential pkg-config file \
    libwebkit2gtk-4.1-dev libssl-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim \
    xvfb xauth dbus-x11 desktop-file-utils webkit2gtk-driver python3 \
    && rm -rf /var/lib/apt/lists/*
ARG NODE_VERSION=24.17.0
RUN curl -fSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" | grep " node-v${NODE_VERSION}-linux-x64.tar.xz$" | sha256sum -c - \
    && tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" --strip-components=1 -C /usr/local \
    && rm "node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && npm install --global pnpm@11.24.0
ENV CARGO_HOME=/opt/cargo RUSTUP_HOME=/opt/rustup PATH=/opt/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o /tmp/rustup.sh \
    && sh /tmp/rustup.sh -y --profile minimal --default-toolchain 1.98.0 \
    && rm /tmp/rustup.sh
WORKDIR /build
