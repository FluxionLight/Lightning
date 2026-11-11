pub mod appearance;
pub mod capture;
#[cfg(target_os = "linux")]
mod linux_input;
#[cfg(target_os = "android")]
mod mobile_files;
#[cfg(target_os = "linux")]
pub mod ocr_linux;
pub mod pdf;
pub mod storage;
#[cfg(windows)]
pub mod ocr {
    pub mod win;
}
use pdf::{OutlineEntry, PdfDocumentInfo, PdfState, RenderedPage};
use storage::{Identity, LoadResult, ReadingStore};
use tauri::{AppHandle, Manager};

#[tauri::command]
async fn choose_mobile_files(_app: AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        return tauri::async_runtime::spawn_blocking(move || mobile_files::pick(&_app))
            .await
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("当前平台请使用系统文件对话框".into())
    }
}

#[tauri::command]
async fn resolve_document(_app: AppHandle, path: String) -> Result<Identity, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        let path = mobile_files::import(&_app, &path, true)?
            .to_string_lossy()
            .into_owned();
        storage::resolve(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_pdf(app: AppHandle, path: String) -> Result<PdfDocumentInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let identity = storage::resolve(&path)?;
        app.state::<PdfState>().load(&identity.path)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn close_pdf(app: AppHandle, tab_id: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<PdfState>().close(tab_id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn render_page(
    app: AppHandle,
    tab_id: u64,
    page_index: u32,
    zoom: f32,
) -> Result<RenderedPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<PdfState>().render(tab_id, page_index, zoom)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_outline(app: AppHandle, tab_id: u64) -> Result<Vec<OutlineEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<PdfState>().outline(tab_id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn load_reading_state(
    app: AppHandle,
    document_id: String,
    path: String,
) -> Result<LoadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<ReadingStore>().load(&document_id, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_reading_state(app: AppHandle, state: serde_json::Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<ReadingStore>().save(state))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn capture_region(
    app: AppHandle,
    region: capture::Region,
) -> Result<capture::CaptureResult, String> {
    tauri::async_runtime::spawn_blocking(move || capture::capture(&app.state::<PdfState>(), region))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_capture(_app: AppHandle, path: String, data_url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        if (!path.to_lowercase().ends_with(".png") && !cfg!(target_os = "android"))
            || data_url.len() > 34 * 1024 * 1024
        {
            return Err("PNG 保存参数无效".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(
                data_url
                    .strip_prefix("data:image/png;base64,")
                    .ok_or("截图格式无效")?,
            )
            .map_err(|e| e.to_string())?;
        image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        #[cfg(target_os = "android")]
        if path.starts_with("content://") {
            return mobile_files::save(&_app, &path, &bytes);
        }
        storage::atomic_write(std::path::Path::new(&path), &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn startup_paths() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|p| p.to_lowercase().ends_with(".pdf"))
        .collect()
}

#[tauri::command]
async fn load_appearance(app: AppHandle) -> Result<appearance::LoadAppearance, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(appearance::load(
            &app.path().app_data_dir().map_err(|e| e.to_string())?,
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_appearance(
    app: AppHandle,
    preferences: appearance::Appearance,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        appearance::save(
            &app.path().app_data_dir().map_err(|e| e.to_string())?,
            preferences,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn import_background(_app: AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        let path = mobile_files::import(&_app, &path, false)?
            .to_string_lossy()
            .into_owned();
        appearance::import_background(std::path::Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(tauri_plugin_fs::init())
        .plugin(mobile_files::init());
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .manage(PdfState::default())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            linux_input::install(app)?;
            pdf::set_resource_directory(app.path().resource_dir()?);
            app.manage(ReadingStore::new(app.path().app_data_dir()?));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_mobile_files,
            resolve_document,
            open_pdf,
            close_pdf,
            render_page,
            get_outline,
            load_reading_state,
            save_reading_state,
            capture_region,
            save_capture,
            startup_paths,
            load_appearance,
            save_appearance,
            import_background
        ]);
    #[cfg(all(target_os = "linux", feature = "input-qa"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        resolve_document,
        open_pdf,
        close_pdf,
        render_page,
        get_outline,
        load_reading_state,
        save_reading_state,
        capture_region,
        save_capture,
        startup_paths,
        load_appearance,
        save_appearance,
        import_background,
        linux_input::simulate_native_pinch
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("Lightning 无法启动");
}
