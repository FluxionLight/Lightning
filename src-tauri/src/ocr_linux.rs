//! Offline OCR via the Ubuntu-packaged Tesseract engine and language data.
use image::{DynamicImage, ImageFormat};
use std::io::Write;
use std::process::{Command, Stdio};

pub fn recognize(image: &DynamicImage) -> Result<String, String> {
    let mut png = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let mut child = Command::new("/usr/bin/tesseract")
        .args(["stdin", "stdout", "-l", "eng+chi_sim"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动本地 OCR，请检查 tesseract-ocr 是否已安装：{e}"))?;
    let input = child.stdin.take().ok_or("无法连接本地 OCR")?;
    let write_result = {
        let mut input = input;
        input.write_all(png.get_ref())
    };
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    write_result.map_err(|e| format!("无法发送 OCR 图像：{e}"))?;
    if !output.status.success() {
        return Err(format!(
            "本地 OCR 失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}
