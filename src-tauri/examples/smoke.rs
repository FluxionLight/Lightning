use lightning_lib::{
    capture::{capture, Region},
    pdf::PdfState,
    storage::{resolve, ReadingStore},
};
fn main() {
    if let Some(dir) = std::env::var_os("LIGHTNING_SMOKE_RESOURCE_DIR") {
        lightning_lib::pdf::set_resource_directory(dir.into());
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    std::env::set_current_dir(root.join("src-tauri")).unwrap();
    let path = root.join("tests/fixtures/reading-sample.pdf");
    let identity = resolve(path.to_str().unwrap()).unwrap();
    let pdf = PdfState::default();
    let info = pdf.load(&identity.path).unwrap();
    assert_eq!(info.page_count, 10);
    let first = pdf.render(info.tab_id, 0, 0.6).unwrap();
    assert!(first.width_px > 300);
    assert!(!first.image_base64.is_empty());
    let landscape = pdf.render(info.tab_id, 8, 0.4).unwrap();
    assert!(landscape.page_width_pt > landscape.page_height_pt);
    let bounded = pdf.render(info.tab_id, 5, 8.0).unwrap();
    assert!(u64::from(bounded.width_px) * u64::from(bounded.height_px) <= 16_000_000);
    assert!(pdf.render(info.tab_id, 10, 1.0).is_err());
    assert!(pdf.render(info.tab_id, 0, f32::NAN).is_err());
    assert_eq!(pdf.outline(info.tab_id).unwrap().len(), 2);
    assert!(pdf
        .page_text(info.tab_id, 0)
        .unwrap()
        .contains("room to think"));
    let png = capture(
        &pdf,
        Region {
            tab_id: info.tab_id,
            page_index: 0,
            x: 0.05,
            y: 0.05,
            width: 0.7,
            height: 0.3,
            mode: "png".into(),
        },
    )
    .unwrap();
    assert!(png.data_url.unwrap().starts_with("data:image/png;base64,"));
    #[cfg(any(windows, target_os = "linux"))]
    {
        match capture(
            &pdf,
            Region {
                tab_id: info.tab_id,
                page_index: 0,
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 0.4,
                mode: "ocr".into(),
            },
        ) {
            Ok(result) => {
                assert!(!result.text.as_deref().unwrap_or("").is_empty());
                println!("Local OCR: {}", result.text.unwrap());
            }
            Err(e) => panic!("Local OCR smoke failed: {e}"),
        }
    }
    let state_dir = root.join("test-results/native-state");
    let store = ReadingStore::new(state_dir);
    let state = serde_json::json!({"schemaVersion":1,"documentId":identity.document_id,"pdfPath":identity.path,"page":3,"zoom":0.8,"anchor":{"page":1,"scrollX":0.4,"scrollY":0.6}});
    store.save(state.clone()).unwrap();
    store.save(state).unwrap();
    assert_eq!(
        store
            .load(&identity.document_id, &identity.path)
            .unwrap()
            .state
            .unwrap()["page"],
        3
    );
    pdf.close(info.tab_id).unwrap();
    assert!(pdf.render(info.tab_id, 0, 1.0).is_err());
    println!(
        "PASS: native PDF load/render/mixed sizes/budget/outline/text/capture/OCR/state/close"
    );
}
