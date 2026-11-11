use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager,
};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};
static IMPORT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

struct MobileFiles(PluginHandle<tauri::Wry>);

pub fn pick(app: &AppHandle) -> Result<Vec<String>, String> {
    #[derive(serde::Deserialize)]
    struct Picked {
        files: Vec<String>,
    }
    app.state::<MobileFiles>()
        .0
        .run_mobile_plugin::<Picked>("pickFiles", serde_json::json!({}))
        .map(|result| result.files)
        .map_err(|e| e.to_string())
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("mobile-files")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin("com.lightning.pdfreader", "LightningFilesPlugin")?;
            app.manage(MobileFiles(handle));
            Ok(())
        })
        .build()
}

pub fn import(app: &AppHandle, uri: &str, pdf: bool) -> Result<PathBuf, String> {
    if !uri.starts_with("content://") {
        return Ok(uri.into());
    }
    let info: serde_json::Value = app
        .state::<MobileFiles>()
        .0
        .run_mobile_plugin("name", serde_json::json!({"uri":uri}))
        .map_err(|e| e.to_string())?;
    let name = info["name"]
        .as_str()
        .unwrap_or(if pdf { "文档.pdf" } else { "背景.png" });
    let name: String = name
        .chars()
        .filter(|c| !c.is_control() && !['/', '\\', ':'].contains(c))
        .take(160)
        .collect();
    if pdf && !name.to_lowercase().ends_with(".pdf") {
        return Err("请选择 PDF 文件".into());
    }
    let id = format!("{:x}", Sha256::digest(uri.as_bytes()));
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("imports")
        .join(id);
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let destination = directory.join(&name);
    let temporary = directory.join(format!(
        ".import-{}.tmp",
        IMPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let limit = if pdf {
        512 * 1024 * 1024u64
    } else {
        25 * 1024 * 1024u64
    };
    let result = (|| {
        let mut options = OpenOptions::default();
        options.read(true);
        let input = app
            .fs()
            .open(uri.parse::<FilePath>().map_err(|e| e.to_string())?, options)
            .map_err(|e| e.to_string())?;
        let mut input = input.take(limit + 1);
        let mut output = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        let length = std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
        if length > limit {
            return Err(if pdf {
                "PDF 超过 512 MB"
            } else {
                "背景图片超过 25 MB"
            }
            .into());
        }
        output.flush().map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
        Ok(destination)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

pub fn save(app: &AppHandle, uri: &str, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::default();
    options.write(true).truncate(true);
    let mut output = app
        .fs()
        .open(uri.parse::<FilePath>().map_err(|e| e.to_string())?, options)
        .map_err(|e| e.to_string())?;
    output.write_all(bytes).map_err(|e| e.to_string())
}
