use objc2_app_kit::NSApplication;
use objc2_foundation::{MainThreadMarker, NSString};
use tauri::AppHandle;

/// Set the application Dock badge on the AppKit main thread.
///
/// Tauri `WebviewWindow::set_badge_count` is routed through tao with
/// `MainThreadMarker::new_unchecked()`, so AppKit can ignore the update when
/// the wry message is not actually on the main thread. NSDockTile.badgeLabel
/// is application-level, not window-level.
pub fn apply(app: &AppHandle, count: Option<i64>) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = set_ns_dock_badge(count);
        let _ = tx.send(result);
    })
    .map_err(|err| err.to_string())?;
    rx.recv().map_err(|err| err.to_string())?
}

fn set_ns_dock_badge(count: Option<i64>) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or_else(|| {
        "NSDockTile badge requires the AppKit main thread".to_string()
    })?;
    let app = NSApplication::sharedApplication(mtm);
    let tile = app.dockTile();
    tile.setShowsApplicationBadge(true);
    match count.filter(|value| *value > 0) {
        Some(value) => {
            let label = NSString::from_str(&value.to_string());
            tile.setBadgeLabel(Some(&label));
        }
        None => {
            tile.setBadgeLabel(None);
        }
    }
    tile.display();
    Ok(())
}
