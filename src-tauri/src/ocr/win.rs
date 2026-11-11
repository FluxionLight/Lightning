//! Windows OCR 后端（`Windows.Media.Ocr`）。
//!
//! 零第三方依赖、零打包体积；直接把内存中的位图交给系统 OCR 引擎，
//! 不落临时文件。需要系统安装对应语言的 OCR 语言包。

use image::DynamicImage;
use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::{OcrEngine, OcrLine, OcrResult};
use windows::Storage::Streams::DataWriter;

/// 优先使用的语言（简体中文）。若系统未安装该语言的 OCR 包，会退回用户配置语言。
const PREFERRED_LANGUAGE: &str = "zh-CN";

/// 识别整张位图，返回按行组织的文本。
pub fn recognize(image: &DynamicImage) -> Result<String, String> {
    let max = OcrEngine::MaxImageDimension().map_err(|e| format!("无法读取 OCR 尺寸限制：{e}"))?;
    let scaled;
    let image = if image.width() > max || image.height() > max {
        scaled = image.resize(max, max, image::imageops::FilterType::Lanczos3);
        &scaled
    } else {
        image
    };
    let bitmap = to_software_bitmap(image)?;

    let engine = create_engine()?;

    let result: OcrResult = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("Windows OCR 调用失败：{e}"))?
        .join()
        .map_err(|e| format!("Windows OCR 等待结果失败：{e}"))?;

    let lines = result
        .Lines()
        .map_err(|e| format!("读取 OCR 行失败：{e}"))?;

    let mut text = String::new();
    let count = lines.Size().unwrap_or(0);
    for i in 0..count {
        let line: OcrLine = lines
            .GetAt(i)
            .map_err(|e| format!("读取第 {i} 行失败：{e}"))?;
        text.push_str(&join_line(&line)?);
        text.push('\n');
    }
    Ok(text)
}

/// 创建 OCR 引擎：先试简体中文，再退回用户配置语言。
fn create_engine() -> Result<OcrEngine, String> {
    if let Ok(language) = Language::CreateLanguage(&HSTRING::from(PREFERRED_LANGUAGE)) {
        if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&language) {
            return Ok(engine);
        }
    }
    OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| {
        format!(
            "系统未安装可用的 OCR 语言包（请安装「{}」语言的 OCR 组件）：{e}",
            PREFERRED_LANGUAGE
        )
    })
}

/// 把一行里的各个词拼成自然文本：中日韩字符之间不插空格，拉丁词之间保留空格。
fn join_line(line: &OcrLine) -> Result<String, String> {
    let words = line.Words().map_err(|e| format!("读取 OCR 词失败：{e}"))?;
    let count = words.Size().unwrap_or(0);
    let mut text = String::new();
    for i in 0..count {
        let word = words
            .GetAt(i)
            .map_err(|e| format!("读取词 {i} 失败：{e}"))?
            .Text()
            .map_err(|e| format!("读取词文本失败：{e}"))?
            .to_string();
        if word.is_empty() {
            continue;
        }
        let need_space = match (text.chars().last(), word.chars().next()) {
            (Some(prev), Some(next)) => !is_cjk(prev) && !is_cjk(next),
            _ => false,
        };
        if need_space {
            text.push(' ');
        }
        text.push_str(&word);
    }
    Ok(text)
}

/// 将 `DynamicImage` 转换为 WinRT 的 `SoftwareBitmap`（BGRA8，不落盘）。
fn to_software_bitmap(image: &DynamicImage) -> Result<SoftwareBitmap, String> {
    let rgba = image.to_rgba8();
    let (width, height) = (rgba.width() as i32, rgba.height() as i32);

    // RGBA -> BGRA（WinRT 的 Bgra8 需要蓝绿红alpha 顺序）
    let mut bgra = rgba.into_raw();
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    let writer = DataWriter::new().map_err(|e| format!("创建缓冲区失败：{e}"))?;
    writer
        .WriteBytes(&bgra)
        .map_err(|e| format!("写入缓冲区失败：{e}"))?;
    let buffer = writer
        .DetachBuffer()
        .map_err(|e| format!("取出缓冲区失败：{e}"))?;

    SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, width, height)
        .map_err(|e| format!("构造 SoftwareBitmap 失败：{e}"))
}

/// 是否属于中日韩文字（这些字符之间不插空格）。
fn is_cjk(c: char) -> bool {
    matches!(
        c as u32,
        0x3000..=0x303F | 0x4E00..=0x9FFF | 0xFF00..=0xFFEF | 0x3400..=0x4DBF
    )
}
