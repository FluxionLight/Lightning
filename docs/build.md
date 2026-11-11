# 构建与分发

当前源码为 0.7.0，本次提供 Ubuntu 与 Android 产物；保留的 Windows 交付为 0.6.0。0.2 起，发布和 WebView QA 脚本默认使用独立的 `src-tauri/target-v<版本>/` 构建目录。这样旧版本运行时无需结束用户进程。脚本尊重已有 `CARGO_TARGET_DIR`，例如 `$env:CARGO_TARGET_DIR='F:\Lightning\src-tauri\target-v0.7.0'`。`pnpm release` 按源码版本输出便携目录与 ZIP，不覆盖旧交付目录。

## 已验证环境

- Windows x64；Rust 1.98.0 + MSVC，Node 24.17.0，pnpm 11.24.0。
- Tauri Rust 2.11.5 / 前端 API 2.11.1；dialog Rust 2.7.2 / 前端 2.7.3。
- Vite 6.4.5、TypeScript 5.9.3、pdfium-render 0.9.3。
- PDFium 154.0.8021.0 Windows x64。项目自带 DLL 与许可证。

锁文件固定实际依赖。更新 Tauri 时同时核对 Rust 和前端包的 major/minor；CLI 会拒绝不兼容的组合。Windows 与 Linux 使用各自的 Tauri 配置；Linux PDFium 及 OCR 不依赖 Windows DLL。

## 开发

安装 Rust MSVC 工具链、Visual Studio C++ build tools、Windows SDK、Node 和 pnpm。开发机器需要 WebView2 Runtime。

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

前端服务固定 1423 端口。`pnpm dev` 只启动前端服务，真实 PDF IPC 由 Tauri 提供；浏览器回归通过测试夹具模拟 IPC，不是给最终用户的替代阅读引擎。

```powershell
pnpm build
cargo check --locked --manifest-path src-tauri/Cargo.toml
pnpm test
pnpm test:native
pnpm test:webview
```

`pnpm test` 默认使用本机 Edge，可用 `LIGHTNING_TEST_BROWSER` 指定 Chromium 可执行文件。无需额外下载浏览器。原生冒烟使用项目生成的 PDF，状态隔离在 `test-results/native-state`。Rust 首次获取依赖需要网络；完整缓存后可以设置 `$env:CARGO_NET_OFFLINE='true'` 离线构建。

`pnpm test:webview` 另外构建同源码的 QA 程序，使用专门应用标识、独立文件 / 浏览器目录与显式本机调试配置，验证真实 WebView2 和 IPC，包括两次进程重启。脚本完成后恢复普通构建，便携版始终由普通配置生成；运行测试不需要更改系统设置。

## 独立便携版

```powershell
pnpm release
```

脚本先让 Tauri 执行前端构建，再编译嵌入最新资源的 release；输出 `release/Lightning-<版本>-windows-x64/` 和同名 ZIP。目录已存在时使用新时间后缀，不覆盖运行中的交付目录。交付包括 EXE、PDFium DLL、第三方许可、快速说明、校验值和合成 PDF。

最终用户无需 Node、pnpm、Rust、Python、OCR 服务或 CRH。EXE 与 DLL、许可证一起移动；不能只复制一个 EXE 后丢掉 PDFium。DLL 查找首先使用可执行文件旁边及其 `pdfium` 子目录，开发模式再查当前工程目录。打包目录不引用原项目。

## 安装包与 WebView2

```powershell
pnpm tauri build --bundles nsis
```

NSIS 配置会携带 PDFium 和许可证；Windows 配置为 WebView2 下载引导安装，系统已具备 WebView2 时直接使用。首次构建安装包可能还要下载 NSIS 工具、模板或 WebView2 引导程序。便携版要求系统已有 WebView2；缺失时由用户从 [微软官方页面](https://developer.microsoft.com/microsoft-edge/webview2/)安装。安装器在干净虚拟机上的安装 / 卸载仍需单独验收。

## Ubuntu amd64 安装包

在 Linux（或本机 WSL 的 Ubuntu）中安装 Docker，然后从工程根目录运行：

```sh
bash scripts/release-linux.sh
```

脚本在 Ubuntu 22.04 容器中准备锁定版本的 Node、pnpm、Rust 及 WebKitGTK 4.1，使用独立构建卷，不复用 Windows 的 node_modules 或 target。先构建前端、运行 Rust 单元与 PDFium / OCR 冒烟，再生成 `release/Lightning_0.7.0_amd64.deb` 和 SHA-256 校验文件。打包后核对 Debian 内部版本，避免把缓存中的旧包重命名为新版本。

如果 Docker Hub 不可用，可运行 `bash scripts/linux/import-ubuntu.sh` 从 Canonical 官方源导入经 SHA-256 校验的最小根文件系统，然后设置 `LIGHTNING_LINUX_BASE_IMAGE=lightning-ubuntu:22.04` 再执行发布脚本。Docker 配置仍尊重 `DOCKER_CONFIG`。

Linux 配置位于 `src-tauri/tauri.linux.conf.json`，Windows 位于 `tauri.windows.conf.json`。Debian 资源目录与可执行文件目录不同，启动时使用 Tauri 的资源目录定位随包携带的 `libpdfium.so`。桌面入口以 `%F` 传入本地 PDF 路径，支持带空格和中文的路径。

安装依赖包含 WebKitGTK、GTK 和中英文 Tesseract；apt 推荐安装 Noto CJK 字体。应用无需 Rust、Node 或 Python。当前构建架构为 x86_64，不提供 ARM64 包。

Linux PDFium 归档来自同一固定 `chromium/8021` 发行，下载脚本为 `scripts/download-pdfium.sh`，归档 SHA-256：`685f7930cd184ea22cd77afe707c1cf53b173d18118b6e16cb213c9277d7cdc3`；原生库 SHA-256：`df9cf2617949dbcd8b4fef42189681948449b7c364d64908514865142526a7c4`。相应许可证随包分发。

## Android APK

在 Linux / WSL 中执行 `bash scripts/release-android.sh`。详见 [Android 构建与使用](android.md)。构建脚本准备 SDK 36、NDK 28、Java 17、ARM64 / x86_64 Rust 目标和固定版本 PDFium，使用独立卷生成 Android 项目，再复制 `src-tauri/android/` 中的 Kotlin 模板。APK 最低 API 26，包含两个架构。

Android release 保留 Rust 优化，关闭 Java R8 优化以确保 Tauri 插件的反射回调稳定。最后执行 16 KiB 对齐及 APK 签名验证，输出 `release/Lightning_0.7.0_android.apk` 和 SHA-256。项目签名密钥在 `.android-signing/`，不要提交、输出或与 APK 一起分发；后续更新必须保留并备份。

## Windows PDFium 重建

`scripts/download-pdfium.ps1` 从固定 [chromium/8021 发行](https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium%2F8021)取得 Windows x64 归档，校验 DLL 后才替换，并带齐许可证。已带入的 DLL 与公开归档逐字节校验一致：

```text
2A9031FA88F412147C3BC7115054550048C724DB6EA70298B6C6B0D13E513882
```

首次构建不需要重新下载它。升级 PDFium 时要同步检查 pdfium-render API、校验值、许可证、原生回归与发行说明。
