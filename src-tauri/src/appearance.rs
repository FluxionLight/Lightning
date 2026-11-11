use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Appearance {
    pub schema_version: u32,
    pub mode: String,
    pub accent: String,
    pub background_image: Option<String>,
    pub background_name: String,
    pub image_opacity: f64,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            schema_version: 1,
            mode: "light".into(),
            accent: "#1a73e8".into(),
            background_image: None,
            background_name: String::new(),
            image_opacity: 0.45,
        }
    }
}
impl Appearance {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1
            || !["light", "dark", "system"].contains(&self.mode.as_str())
            || self.accent.len() != 7
            || !self.accent.starts_with('#')
            || !self.accent[1..].bytes().all(|b| b.is_ascii_hexdigit())
            || !self.image_opacity.is_finite()
            || !(0.0..=1.0).contains(&self.image_opacity)
            || self.background_name.len() > 1000
        {
            return Err("外观设置格式或范围无效".into());
        }
        if let Some(data) = &self.background_image {
            if data.len() > 8 * 1024 * 1024 {
                return Err("背景图片过大".into());
            }
            let bytes = STANDARD
                .decode(
                    data.strip_prefix("data:image/jpeg;base64,")
                        .ok_or("背景图片格式无效")?,
                )
                .map_err(|_| "背景图片编码无效")?;
            let (w, h) = image::ImageReader::with_format(
                std::io::Cursor::new(&bytes),
                image::ImageFormat::Jpeg,
            )
            .into_dimensions()
            .map_err(|_| "背景图片无法读取")?;
            if w == 0 || h == 0 || w > 2560 || h > 2560 {
                return Err("背景图片尺寸无效".into());
            }
        }
        Ok(())
    }
}
#[derive(Serialize)]
pub struct LoadAppearance {
    pub preferences: Appearance,
    pub warning: Option<String>,
    pub writable: bool,
}
pub fn load(root: &Path) -> LoadAppearance {
    let file = root.join("appearance.json");
    if !file.exists() {
        return LoadAppearance {
            preferences: Appearance::default(),
            warning: None,
            writable: true,
        };
    }
    match read(&file) {
        Ok(preferences) => LoadAppearance {
            preferences,
            warning: None,
            writable: true,
        },
        Err(e) => LoadAppearance {
            preferences: Appearance::default(),
            warning: Some(format!("原外观配置已保留，使用默认外观：{e}")),
            writable: false,
        },
    }
}
fn read(file: &Path) -> Result<Appearance, String> {
    let meta = std::fs::metadata(file).map_err(|e| e.to_string())?;
    if meta.len() > 9 * 1024 * 1024 {
        return Err("外观配置文件过大".into());
    }
    let preferences: Appearance =
        serde_json::from_slice(&std::fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    preferences.validate()?;
    Ok(preferences)
}
pub fn save(root: &Path, preferences: Appearance) -> Result<(), String> {
    preferences.validate()?;
    let file = root.join("appearance.json");
    if file.exists() {
        read(&file)?;
    }
    crate::storage::atomic_write(
        &file,
        &serde_json::to_vec(&preferences).map_err(|e| e.to_string())?,
    )
}
pub fn import_background(path: &Path) -> Result<String, String> {
    let size = std::fs::metadata(path)
        .map_err(|e| format!("无法读取背景图片：{e}"))?
        .len();
    if size > 25 * 1024 * 1024 {
        return Err("请选择 25 MB 以内的背景图片".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    if !matches!(
        reader.format(),
        Some(image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP)
    ) {
        return Err("请选择 PNG、JPEG 或 WebP 图片".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16000);
    limits.max_image_height = Some(16000);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|e| format!("图片无法解码或尺寸过大：{e}"))?
        .thumbnail(2560, 2560)
        .to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 88)
        .encode_image(&image)
        .map_err(|e| e.to_string())?;
    if out.len() > 6 * 1024 * 1024 {
        return Err("压缩后的背景图片仍过大，请选择较简单的图片".into());
    }
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(out)))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appearance_validates_and_preserves_damaged_file() {
        let mut p = Appearance::default();
        p.validate().unwrap();
        p.image_opacity = f64::NAN;
        assert!(p.validate().is_err());
        p = Appearance::default();
        p.accent = "red".into();
        assert!(p.validate().is_err());
        let root = std::env::temp_dir().join(format!("lightning-theme-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        save(&root, Appearance::default()).unwrap();
        assert!(load(&root).writable);
        std::fs::write(root.join("appearance.json"), "broken").unwrap();
        assert!(!load(&root).writable);
        assert!(save(&root, Appearance::default()).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("appearance.json")).unwrap(),
            "broken"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
