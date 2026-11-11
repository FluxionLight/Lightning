# 第三方来源

## CRH

本地参考工程 `F:\Comp-Read-Handwrite`。按功能移植 / 重构的部分：PDFium 引擎、前台最新目标渲染缓存、纸叠几何与动画、阅读控制器、SVG 临时笔、快捷键注册与设置、Windows OCR。应用入口、文档状态存储、捕获结果面板、打包脚本与 Lightning 测试重新实现。

没有复制个人文档、笔记、聊天或授权数据。最终程序没有该参考路径依赖。

## PDFium

随附 PDFium 154.0.8021.0，来自 [bblanchon/pdfium-binaries chromium/8021](https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium%2F8021)，已把原工程 DLL 与这一公开归档校验到相同 SHA-256。

`src-tauri/pdfium/LICENSE` 是二进制分发项目许可；`src-tauri/pdfium/licenses/` 中包含 PDFium 及其所含第三方组件的许可。便携版和安装包同时带入。

Ubuntu 包使用同一发行的 `pdfium-linux-x64.tgz`，SHA-256 与上游发行资产的 digest 核对。Linux 原生库和对应许可证保存在 `src-tauri/pdfium/linux-x64/`，随 `.deb` 分发。

## Ubuntu OCR

Ubuntu 使用系统包管理器安装的 [Tesseract](https://github.com/tesseract-ocr/tesseract) 和中英文语言数据，通过标准输入 / 输出在本机识别截图。Tesseract 不嵌入 Windows 版，不发送图片或文字到网络服务。

## 构建依赖

直接前端依赖仅 Tauri API 与系统对话框插件；开发依赖 Vite、TypeScript、Tauri CLI、Playwright。Rust 直接依赖见 Cargo.toml，精确解析见 Cargo.lock；不包含 Rig、AI 请求客户端、Markdown 编辑器、OCR 模型运行时。各上游依赖的许可随其包元数据和源代码分发。
