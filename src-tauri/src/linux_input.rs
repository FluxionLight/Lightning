//! Consume GTK touchpad pinches before WebKit turns them into whole-page zoom.
use gtk::prelude::*;
use tauri::Manager;

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let target = window.clone();
        window.with_webview(move |webview| {
            webview.inner().connect_event(move |_, event| {
                if let Some(scroll) = event.downcast_ref::<gdk::EventScroll>() {
                    let touchpad = event.source_device().or_else(||scroll.device()).is_some_and(|device| device.source()==gdk::InputSource::Touchpad);
                    let detail = serde_json::json!({"touchpad":touchpad,"stop":scroll.is_stop()});
                    let _ = target.eval(format!("window.dispatchEvent(new CustomEvent('lightning-scroll-source',{{detail:{detail}}}))"));
                }
                let Some(pinch) = event.downcast_ref::<gdk::EventTouchpadPinch>() else {
                    return gtk::glib::Propagation::Proceed;
                };
                if pinch.n_fingers() != 2 {
                    return gtk::glib::Propagation::Proceed;
                }
                let raw: &gdk::ffi::GdkEventTouchpadPinch = pinch.as_ref();
                let (x, y) = pinch.position();
                let scale = if pinch.scale().is_finite() && pinch.scale()>0.0 {pinch.scale()} else {1.0};
                if x.is_finite() && y.is_finite() {
                    let detail = serde_json::json!({"phase":raw.phase,"x":x,"y":y,"scale":scale});
                    let _ = target.eval(format!("window.dispatchEvent(new CustomEvent('lightning-native-pinch',{{detail:{detail}}}))"));
                }
                gtk::glib::Propagation::Stop
            });
        })?;
    }
    Ok(())
}

#[cfg(feature = "input-qa")]
#[tauri::command]
pub async fn simulate_native_pinch(
    app: tauri::AppHandle,
    phase: u8,
    scale: f64,
    x: f64,
    y: f64,
) -> Result<(), String> {
    use gtk::glib::translate::{ToGlibPtr, ToGlibPtrMut};
    let window = app.get_webview_window("main").ok_or("Window missing")?;
    window
        .with_webview(move |webview| {
            let mut event = gdk::Event::new(gdk::EventType::TouchpadPinch);
            let pointer: *mut gdk::ffi::GdkEvent = event.to_glib_none_mut().0;
            let raw = pointer as *mut gdk::ffi::GdkEventTouchpadPinch;
            // A synthetic GDK event exercises the actual widget handler, only in QA builds.
            unsafe {
            if let Some(window)=webview.inner().window(){(*raw).window=window.to_glib_full();}
            (*raw).send_event=1;
            (*raw).time=1;
                (*raw).phase = phase as i8;
                (*raw).n_fingers = 2;
                (*raw).scale = scale;
                (*raw).x = x;
                (*raw).y = y;
            }
            webview.inner().event(&event);
        })
        .map_err(|e| e.to_string())
}
