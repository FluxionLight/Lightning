# Ubuntu 安装与使用

面向 Ubuntu 22.04 及以上的 x86_64（amd64）桌面系统；22.04 和 24.04 已验证，26.04 尚待实机验收。安装包包含 Lightning 和 Linux PDFium，系统依赖由 apt 安装。

在安装包所在目录执行：

```sh
sudo apt install ./Lightning_0.7.0_amd64.deb
```

然后从应用菜单启动 Lightning，或执行 `lightning`。支持把 PDF 拖入窗口，也支持 `lightning "/路径/文件.pdf"`。要设为默认 PDF 应用，可在系统“打开方式”中选择 Lightning，或执行：

```sh
xdg-mime default Lightning.desktop application/pdf
```

阅读器、纸叠、自由桌面、阅读框、主题、阅读状态恢复与截图均在本机工作。Ubuntu 的文字识别使用 Tesseract，安装时自动带入英文和简体中文语言数据，识别无需联网。Windows 版继续使用 Windows 系统 OCR。

0.7 接管 GTK 原生双指捏合、WebKit 手势及 Ctrl+滚轮，只放大指向的 PDF；标题栏、侧栏和纸叠不随正文放大。空白桌面的双指平移用于移动视野，普通鼠标滚轮仍可缩放桌面。精细滚动流在页边缘先累计，再每个手势最多翻一页，避免惯性连续跳页。Shift+滚轮和横向滚动只作水平移动。

应用状态在 `~/.local/share/com.lightning.pdfreader/`；不会修改原 PDF。系统需要图形桌面和 WebKitGTK 4.1。首次安装依赖需要网络；安装完成后可离线阅读和 OCR。

卸载应用：`sudo apt remove lightning`。个人阅读状态不会随卸载删除。
