//! Pdfium-backed PDF document loading and page rendering.
//!
//! CRH renders pages on the Rust side using Google's PDFium engine (via the
//! [`pdfium_render`] crate) and ships each page to the WebView as a
//! base64-encoded PNG. The heavy lifting stays native; the WebView only has to
//! paint pixels onto the main panel.
//!
//! Multiple documents (tabs) are supported: each open document is keyed by a
//! monotonically increasing `tab_id` assigned at open time.
//!
//! Binding notes
//! -------------
//! `pdfium-render` loads the native PDFium library at runtime through
//! `libloading`, so the crate compiles and links without PDFium present. The
//! library is only required when a document is actually opened. Use
//! `scripts/download-pdfium.ps1` (or `.sh`) to fetch a prebuilt binary, or
//! place `pdfium.dll` / `libpdfium.so` / `libpdfium.dylib` next to the
//! executable. See [`bind_native_library`] for the exact search order.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use pdfium_render::prelude::*;
use serde::Serialize;

/// The process-wide PDFium engine, bound lazily on first use.
///
/// A `OnceLock` provides a `'static` handle so a loaded `PdfDocument` (which
/// borrows the engine) can live inside [`PdfState`] without self-referential
/// borrows. `thread_safe` (enabled by default) makes `Pdfium` `Send + Sync`.
static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();
// Debian installs resources under /usr/lib/<product>, separately from /usr/bin.
static RESOURCE_DIRECTORY: OnceLock<PathBuf> = OnceLock::new();

pub fn set_resource_directory(path: PathBuf) {
    let _ = RESOURCE_DIRECTORY.set(path);
}

/// Base output scale: pages are rasterized at 2x their natural size for crisp
/// text on high-DPI displays. `zoom` multiplies this further. This value is
/// returned to the frontend so fit-to-width/page math stays in sync.
const BASE_SCALE: f32 = 2.0;

/// Upper bound for a rendered page's height in pixels.
const MAX_RENDER_HEIGHT: i32 = 20_000;

/// Bound both dimensions and total bitmap allocation (roughly 64MB RGBA).
fn safe_width(width: f32, height: f32, requested: f32) -> Result<i32, String> {
    if ![width, height, requested]
        .iter()
        .all(|n| n.is_finite() && *n > 0.0)
    {
        return Err("PDF 页面尺寸无效".into());
    }
    let ratio = height / width;
    Ok(requested
        .min(12000.0)
        .min(MAX_RENDER_HEIGHT as f32 / ratio)
        .min((16_000_000.0 / ratio).sqrt())
        .floor()
        .max(1.0) as i32)
}

/// Managed state holding every open document, keyed by tab id.
pub struct PdfState {
    inner: Mutex<HashMap<u64, LoadedDocument>>,
    next_id: AtomicU64,
}

struct LoadedDocument {
    document: PdfDocument<'static>,
    path: String,
}

impl Default for PdfState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }
}

/// Metadata about an open document, returned to the frontend after loading.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDocumentInfo {
    pub tab_id: u64,
    pub path: String,
    pub page_count: u32,
    /// First page width in PDF points (1/72 inch).
    pub page_width: f32,
    /// First page height in PDF points (1/72 inch).
    pub page_height: f32,
    /// The base render scale applied on top of `zoom` (see [`BASE_SCALE`]).
    pub base_scale: f32,
}

/// A single rendered page, shipped to the frontend as a base64 PNG.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedPage {
    pub page_index: u32,
    pub width_px: u32,
    pub height_px: u32,
    /// The rendered page's natural width in PDF points (may differ between
    /// pages in a mixed-size document).
    pub page_width_pt: f32,
    /// The rendered page's natural height in PDF points.
    pub page_height_pt: f32,
    /// Raw PNG bytes encoded as base64 (no `data:` prefix).
    pub image_base64: String,
}

/// 一个 PDF 书签（大纲）条目。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineEntry {
    pub title: String,
    /// 目标页码（0-based）。
    pub page: u32,
    /// 层级（0 = 顶层，用于缩进显示）。
    pub depth: u32,
}

impl PdfState {
    /// Opens the PDF at `path` in a new tab and returns its metadata.
    pub fn load(&self, path: &str) -> Result<PdfDocumentInfo, String> {
        let pdfium = pdfium()?;
        let document = pdfium
            .load_pdf_from_file(path, None)
            .map_err(|e| format!("failed to load PDF '{path}': {e}"))?;

        let pages = document.pages();
        let page_count = pages.len().max(0) as u32;

        // Read the first page's dimensions so the frontend can compute an
        // aspect ratio before the first render arrives.
        let (page_width, page_height) = if page_count > 0 {
            let page = pages
                .get(0)
                .map_err(|e| format!("failed to read first page: {e}"))?;
            (page.width().value, page.height().value)
        } else {
            (0.0, 0.0)
        };

        let tab_id = self.next_id.fetch_add(1, Ordering::SeqCst);

        let info = PdfDocumentInfo {
            tab_id,
            path: path.to_string(),
            page_count,
            page_width,
            page_height,
            base_scale: BASE_SCALE,
        };

        self.inner
            .lock()
            .map_err(|_| "pdf state lock poisoned".to_string())?
            .insert(
                tab_id,
                LoadedDocument {
                    document,
                    path: path.to_string(),
                },
            );

        Ok(info)
    }

    pub fn path_for(&self, id: u64) -> Result<String, String> {
        self.inner
            .lock()
            .map_err(|_| "PDF lock poisoned")?
            .get(&id)
            .map(|d| d.path.clone())
            .ok_or_else(|| "PDF 已关闭".into())
    }

    pub fn page_count_for(&self, id: u64) -> Result<u32, String> {
        self.inner
            .lock()
            .map_err(|_| "PDF lock poisoned")?
            .get(&id)
            .map(|d| d.document.pages().len().max(0) as u32)
            .ok_or_else(|| "PDF 已关闭".into())
    }

    pub fn page_text(&self, id: u64, index: u32) -> Result<String, String> {
        let docs = self.inner.lock().map_err(|_| "PDF lock poisoned")?;
        let doc = docs.get(&id).ok_or("PDF 已关闭")?;
        let pages = doc.document.pages();
        let page = pages
            .get(index.try_into().map_err(|_| "页码超出范围")?)
            .map_err(|e| e.to_string())?;
        let text = page.text().map_err(|e| e.to_string())?.all();
        Ok(text)
    }

    /// Closes the document identified by `tab_id`, releasing native resources.
    pub fn close(&self, tab_id: u64) -> Result<(), String> {
        self.inner
            .lock()
            .map_err(|_| "pdf state lock poisoned".to_string())?
            .remove(&tab_id);
        Ok(())
    }

    /// Renders `page_index` of the document `tab_id` at `zoom`, returning a
    /// base64 PNG together with the page's natural point dimensions.
    pub fn render(&self, tab_id: u64, page_index: u32, zoom: f32) -> Result<RenderedPage, String> {
        if !zoom.is_finite() || !(0.1..=8.0).contains(&zoom) {
            return Err("缩放必须在 10%–800% 之间".into());
        }
        let inner = self
            .inner
            .lock()
            .map_err(|_| "pdf state lock poisoned".to_string())?;
        let loaded = inner
            .get(&tab_id)
            .ok_or("document not found (tab may have been closed)")?;

        let pages = loaded.document.pages();
        let page_count = pages.len();
        let index = page_index as i32;

        if index < 0 || index >= page_count {
            return Err(format!(
                "page index {index} is out of range (document has {page_count} pages)"
            ));
        }

        let page = pages
            .get(index)
            .map_err(|e| format!("failed to fetch page {index}: {e}"))?;

        let (page_width_pt, page_height_pt) = (page.width().value, page.height().value);

        // Clamp zoom and derive the target raster width from the page's natural
        // width (points) multiplied by the base output scale and the zoom.
        let target_width = safe_width(
            page_width_pt,
            page_height_pt,
            page_width_pt * BASE_SCALE * zoom,
        )?;

        let config = PdfRenderConfig::new()
            .set_target_width(target_width)
            .set_maximum_height(MAX_RENDER_HEIGHT);

        let image = page
            .render_with_config(&config)
            .map_err(|e| format!("failed to render page {index}: {e}"))?
            .as_image()
            .map_err(|e| format!("failed to read rendered bitmap: {e}"))?;

        let (width_px, height_px) = (image.width(), image.height());

        let mut png: Vec<u8> = Vec::new();
        image
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .map_err(|e| format!("failed to encode PNG: {e}"))?;

        Ok(RenderedPage {
            page_index: index as u32,
            width_px,
            height_px,
            page_width_pt,
            page_height_pt,
            image_base64: base64::engine::general_purpose::STANDARD.encode(&png),
        })
    }

    /// 渲染指定页为位图（不编码 PNG），供 OCR 等内部功能使用。
    ///
    /// `target_width_px` 是渲染的目标像素宽度；页面高度按比例缩放。
    pub fn render_to_image(
        &self,
        tab_id: u64,
        page_index: u32,
        target_width_px: u32,
    ) -> Result<image::DynamicImage, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "pdf state lock poisoned".to_string())?;
        let loaded = inner
            .get(&tab_id)
            .ok_or("document not found (tab may have been closed)")?;

        let pages = loaded.document.pages();
        let page_count = pages.len();
        let index = page_index as i32;
        if index < 0 || index >= page_count {
            return Err(format!(
                "page index {index} is out of range (document has {page_count} pages)"
            ));
        }

        let page = pages
            .get(index)
            .map_err(|e| format!("failed to fetch page {index}: {e}"))?;

        let target_width = safe_width(
            page.width().value,
            page.height().value,
            target_width_px.max(64) as f32,
        )?;
        let config = PdfRenderConfig::new()
            .set_target_width(target_width)
            .set_maximum_height(MAX_RENDER_HEIGHT);

        let bitmap = page
            .render_with_config(&config)
            .map_err(|e| format!("failed to render page {index}: {e}"))?;
        let image = bitmap
            .as_image()
            .map_err(|e| format!("failed to read rendered bitmap: {e}"))?;
        Ok(image)
    }

    /// 返回文档的书签（大纲）列表，按深度优先顺序，含层级与目标页码。
    pub fn outline(&self, tab_id: u64) -> Result<Vec<OutlineEntry>, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "pdf state lock poisoned".to_string())?;
        let loaded = inner
            .get(&tab_id)
            .ok_or("document not found (tab may have been closed)")?;

        let mut entries = Vec::new();
        collect_outline(loaded.document.bookmarks().root(), 0, &mut entries);
        Ok(entries)
    }
}

/// 深度优先遍历书签树，收集 (标题, 页码, 层级)。
fn collect_outline(bookmark: Option<PdfBookmark<'_>>, depth: u32, entries: &mut Vec<OutlineEntry>) {
    let mut current = bookmark;
    while let Some(bm) = current {
        if let Some(title) = bm.title() {
            let page = bm
                .destination()
                .and_then(|d| d.page_index().ok())
                .map(|p| p.max(0) as u32)
                .unwrap_or(0);
            entries.push(OutlineEntry { title, page, depth });
        }
        collect_outline(bm.first_child(), depth + 1, entries);
        current = bm.next_sibling();
    }
}

/// Returns the process-wide PDFium engine, binding the native library lazily.
fn pdfium() -> Result<&'static Pdfium, String> {
    match PDFIUM.get_or_init(|| {
        bind_native_library()
            .map(Pdfium::new)
            .map_err(|e| format!("could not locate a native PDFium library: {e}"))
    }) {
        Ok(pdfium) => Ok(pdfium),
        Err(e) => Err(e.clone()),
    }
}

/// Binds the native PDFium library, searching conventional locations.
fn bind_native_library() -> Result<Box<dyn PdfiumLibraryBindings>, PdfiumError> {
    #[cfg(target_os = "android")]
    if let Ok(bindings) = Pdfium::bind_to_library("libpdfium.so") {
        return Ok(bindings);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = RESOURCE_DIRECTORY.get() {
        candidates.push(dir.clone());
    }

    // 1. Directory containing the running executable (release layout), plus a
    //    `pdfium/` subfolder next to it.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.to_path_buf());
            candidates.push(dir.join("pdfium"));
        }
    }

    // 2. Current working directory and a local `pdfium/` subfolder
    //    (dev layout: `src-tauri/pdfium/` when running `tauri dev`).
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.clone());
        candidates.push(cwd.join("pdfium"));
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        candidates.push(cwd.join("pdfium/linux-x64"));
    }

    for dir in candidates {
        let library = Pdfium::pdfium_platform_library_name_at_path(&dir);
        if library.is_file() {
            if let Ok(bindings) = Pdfium::bind_to_library(&library) {
                return Ok(bindings);
            }
        }
    }

    // 3. Fall back to a system-installed PDFium, if any.
    Pdfium::bind_to_system_library()
}
