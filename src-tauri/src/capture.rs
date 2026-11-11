use crate::pdf::PdfState;
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub tab_id: u64,
    pub page_index: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub mode: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub mode: String,
    pub page: u32,
    pub source_path: String,
    pub text: Option<String>,
    pub data_url: Option<String>,
    pub width: u32,
    pub height: u32,
}
pub fn crop(page: &DynamicImage, r: &Region) -> Result<DynamicImage, String> {
    if ![r.x, r.y, r.width, r.height].iter().all(|v| v.is_finite())
        || r.x < 0.0
        || r.y < 0.0
        || r.width <= 0.0
        || r.height <= 0.0
        || r.x + r.width > 1.000001
        || r.y + r.height > 1.000001
    {
        return Err("选区超出 PDF 页面".into());
    }
    let x = (r.x * page.width() as f64).floor() as u32;
    let y = (r.y * page.height() as f64).floor() as u32;
    let right = (((r.x + r.width) * page.width() as f64 - 1e-7).ceil() as u32).min(page.width());
    let bottom =
        (((r.y + r.height) * page.height() as f64 - 1e-7).ceil() as u32).min(page.height());
    if right <= x || bottom <= y {
        return Err("选区太小，请重新框选".into());
    }
    Ok(page.crop_imm(x, y, right - x, bottom - y))
}
pub fn capture(pdf: &PdfState, region: Region) -> Result<CaptureResult, String> {
    if !["png", "ocr"].contains(&region.mode.as_str()) {
        return Err("捕获方式无效".into());
    }
    let source_path = pdf.path_for(region.tab_id)?;
    let page = pdf.render_to_image(region.tab_id, region.page_index, 2400)?;
    let image = crop(&page, &region)?;
    let mut result = CaptureResult {
        mode: region.mode.clone(),
        page: region.page_index,
        source_path,
        text: None,
        data_url: None,
        width: image.width(),
        height: image.height(),
    };
    if region.mode == "png" {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        // One capture, at most 16M rendered pixels and 24MiB PNG; no chat attachment limits.
        if bytes.get_ref().len() > 24 * 1024 * 1024 {
            return Err("截图超过 24 MB，请缩小选区".into());
        }
        result.data_url = Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(bytes.into_inner())
        ));
    } else {
        #[cfg(windows)]
        {
            result.text = Some(crate::ocr::win::recognize(&image)?.trim().to_owned());
        }
        #[cfg(target_os = "linux")]
        {
            result.text = Some(crate::ocr_linux::recognize(&image)?.trim().to_owned());
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            return Err("当前平台暂不支持 OCR".into());
        }
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_crop_and_invalid_regions() {
        let page = DynamicImage::new_rgb8(100, 200);
        let mut r = Region {
            tab_id: 1,
            page_index: 0,
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.4,
            mode: "png".into(),
        };
        let out = crop(&page, &r).unwrap();
        assert_eq!((out.width(), out.height()), (30, 80));
        r.x = 0.9;
        assert!(crop(&page, &r).is_err());
        r.x = f64::NAN;
        assert!(crop(&page, &r).is_err());
    }
}
