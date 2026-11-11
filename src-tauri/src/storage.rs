//! Lightning owns only its app-data state. PDF and CRH files are never written.
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub path: String,
    pub document_id: String,
}

pub fn path_id(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    #[cfg(windows)]
    let normalized = normalized.to_lowercase();
    format!("{:x}", Sha256::digest(normalized.as_bytes()))
}
pub fn resolve(path: &str) -> Result<Identity, String> {
    let canonical =
        fs::canonicalize(path).map_err(|e| format!("无法打开文件，请检查路径或访问权限：{e}"))?;
    if !canonical.is_file()
        || !canonical
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("pdf"))
    {
        return Err("请选择一个 PDF 文件".into());
    }
    let path = canonical.to_string_lossy().into_owned();
    Ok(Identity {
        document_id: path_id(&path),
        path,
    })
}

#[derive(Serialize)]
pub struct LoadResult {
    pub state: Option<Value>,
    pub warning: Option<String>,
    pub writable: bool,
}
pub struct ReadingStore {
    root: PathBuf,
    lock: Mutex<()>,
}
impl ReadingStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            lock: Mutex::new(()),
        }
    }
    fn file(&self, id: &str) -> Result<PathBuf, String> {
        if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("文档标识无效".into());
        }
        Ok(self.root.join("reading").join(format!("{id}.json")))
    }
    pub fn load(&self, id: &str, path: &str) -> Result<LoadResult, String> {
        if path_id(path) != id {
            return Err("阅读状态与文件身份不匹配".into());
        }
        let _guard = self.lock.lock().map_err(|_| "阅读存储被锁定")?;
        let file = self.file(id)?;
        if !file.exists() {
            return Ok(LoadResult {
                state: None,
                warning: None,
                writable: true,
            });
        }
        match read_valid(&file, id, path) {
            Ok(state) => Ok(LoadResult {
                state: Some(state),
                warning: None,
                writable: true,
            }),
            Err(e) => Ok(LoadResult {
                state: None,
                writable: false,
                warning: Some(format!("原阅读状态已保留，本次使用默认值且暂停写入。{e}")),
            }),
        }
    }
    pub fn save(&self, state: Value) -> Result<(), String> {
        let id = state["documentId"].as_str().ok_or("缺少文档标识")?;
        let path = state["pdfPath"].as_str().ok_or("缺少 PDF 路径")?;
        validate(&state, id, path)?;
        let file = self.file(id)?;
        let _guard = self.lock.lock().map_err(|_| "阅读存储被锁定")?;
        // An externally damaged or future-version file must survive an attempted save.
        if file.exists() {
            read_valid(&file, id, path)?;
        }
        atomic_write(
            &file,
            &serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?,
        )
    }
}

fn read_valid(file: &Path, id: &str, path: &str) -> Result<Value, String> {
    let bytes = fs::read(file).map_err(|e| format!("无法读取阅读状态：{e}"))?;
    let state: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("阅读状态 JSON 损坏：{e}"))?;
    validate(&state, id, path)?;
    Ok(state)
}
fn range(v: &Value, min: f64, max: f64, integer: bool) -> bool {
    v.as_f64()
        .is_some_and(|n| n.is_finite() && n >= min && n <= max && (!integer || n.fract() == 0.0))
}
fn geometry(v: &Value) -> bool {
    v.is_object()
        && range(&v["x"], 0.0, 1.0, false)
        && range(&v["y"], 0.0, 1.0, false)
        && (v["width"] == 0 || range(&v["width"], 48.0, 960.0, false))
        && v.get("desk").is_none_or(|p| {
            p.is_object()
                && range(&p["x"], -1e9, 1e9, false)
                && range(&p["y"], -1e9, 1e9, false)
        })
}
pub fn validate(v: &Value, id: &str, path: &str) -> Result<(), String> {
    if !v.is_object() || path_id(path) != id {
        return Err("阅读状态身份无效".into());
    }
    if v.get("documentId").is_some_and(|s| s.as_str() != Some(id))
        || v.get("pdfPath")
            .is_some_and(|s| s.as_str().map(path_id).as_deref() != Some(id))
    {
        return Err("阅读状态属于另一份文件".into());
    }
    if v.get("schemaVersion")
        .is_some_and(|s| s.as_u64() != Some(1))
    {
        return Err("不支持此阅读状态版本".into());
    }
    for (key, min, max, integer) in [("page", 0.0, 1000000.0, true), ("zoom", 0.1, 8.0, false)] {
        if v.get(key).is_some_and(|n| !range(n, min, max, integer)) {
            return Err(format!("阅读状态 {key} 超出合法范围"));
        }
    }
    if v.get("fitMode")
        .is_some_and(|s| ![Some("none"), Some("width"), Some("page")].contains(&s.as_str()))
        || v.get("readingMode")
            .is_some_and(|s| ![Some("standard"), Some("paper")].contains(&s.as_str()))
    {
        return Err("阅读形式或适配方式无效".into());
    }
    for key in ["paperLayout", "paperReadingViews"] {
        if let Some(layout) = v.get(key) {
            if !layout.is_object() {
                return Err("纸叠布局无效".into());
            }
            for side in ["before", "after"] {
                if let Some(item) = layout.get(side) {
                    if !(geometry(item) || key == "paperReadingViews" && item.is_null()) {
                        return Err("纸叠几何超出范围".into());
                    }
                }
            }
        }
    }
    if let Some(a) = v.get("anchor").filter(|v| !v.is_null()) {
        if !a.is_object()
            || !range(&a["page"], 0.0, 1000000.0, true)
            || !range(&a["scrollX"], 0.0, 1.0, false)
            || !range(&a["scrollY"], 0.0, 1.0, false)
        {
            return Err("锚点无效".into());
        }
    }
    Ok(())
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let parent = path.parent().ok_or("状态目录无效")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法建立保存目录：{e}"))?;
    let temp = path.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::SeqCst)
    ));
    let result = (|| {
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        out.write_all(bytes)
            .and_then(|_| out.sync_all())
            .map_err(|e| e.to_string())?;
        drop(out);
        replace(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e: String| format!("无法原子保存阅读状态：{e}"))
}
#[cfg(windows)]
fn replace(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|e| e.to_string())
}
#[cfg(not(windows))]
fn replace(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_desk_positions_keep_bounded_view_coordinates() {
        let path = "C:/synthetic/piles.pdf";
        let id = path_id(path);
        let mut state = serde_json::json!({"schemaVersion":1,"documentId":id,"pdfPath":path,"paperLayout":{"before":{"x":0.2,"y":0.7,"width":100,"desk":{"x":-1500,"y":2800}}}});
        assert!(validate(&state, &id, path).is_ok());
        state["paperLayout"]["before"]["desk"]["x"] = serde_json::json!(1e10);
        assert!(validate(&state, &id, path).is_err());
        state["paperLayout"]["before"]["desk"] = serde_json::json!({"x":10});
        assert!(validate(&state, &id, path).is_err());
        state["paperLayout"]["before"].as_object_mut().unwrap().remove("desk");
        assert!(validate(&state, &id, path).is_ok());
        state["paperLayout"]["before"]["x"] = serde_json::json!(-3);
        assert!(validate(&state, &id, path).is_err());
    }
    #[test]
    fn isolated_atomic_state_and_corruption_protection() {
        let root =
            std::env::temp_dir().join(format!("lightning-state-test-{}", std::process::id()));
        let store = ReadingStore::new(root.clone());
        let path = "C:/synthetic/a.pdf";
        let id = path_id(path);
        let state = serde_json::json!({"schemaVersion":1,"documentId":id,"pdfPath":path,"page":4,"zoom":1.2,"anchor":{"page":2,"scrollX":0.4,"scrollY":0.8},"paperLayout":{"after":{"x":1,"y":1,"width":120,"desk":{"x":-400,"y":1700}}}});
        store.save(state.clone()).unwrap();
        store.save(state.clone()).unwrap();
        assert_eq!(store.load(&id, path).unwrap().state.unwrap()["page"], 4);
        assert_eq!(store.load(&id, path).unwrap().state.unwrap()["paperLayout"]["after"]["desk"],serde_json::json!({"x":-400,"y":1700}));
        let mut invalid = state.clone();
        invalid["zoom"] = serde_json::json!(99);
        assert!(store.save(invalid).is_err());
        fs::write(store.file(&id).unwrap(), b"broken").unwrap();
        assert!(!store.load(&id, path).unwrap().writable);
        assert!(store.save(state).is_err());
        assert_eq!(fs::read(store.file(&id).unwrap()).unwrap(), b"broken");
        fs::remove_dir_all(root).unwrap();
    }
}
