FROM lightning-builder:ubuntu22
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip zip && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ANDROID_HOME=/opt/android NDK_HOME=/opt/android/ndk/28.2.13676358
ENV PATH=/opt/android/cmdline-tools/latest/bin:/opt/android/platform-tools:$PATH
