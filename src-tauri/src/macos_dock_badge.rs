use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
use objc2_foundation::{MainThreadMarker, NSBundle, NSString, NSThread};
use tauri::AppHandle;

/// Restore `.regular` activation so the process owns a normal Dock tile.
///
/// Splash `skipTaskbar` can leave the app as Accessory. Office360 is a desktop
/// mail client (Dock icon, no LSUIElement / LSBackgroundOnly).
pub fn ensure_regular_activation(app: &AppHandle) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = set_regular_activation_policy();
        let _ = tx.send(result);
    })
    .map_err(|err| err.to_string())?;
    rx.recv().map_err(|err| err.to_string())?
}

/// Set the application Dock badge on the AppKit main thread.
///
/// Tauri `WebviewWindow::set_badge_count` is routed through tao with
/// `MainThreadMarker::new_unchecked()`, so AppKit can ignore the update when
/// the wry message is not actually on the main thread. NSDockTile.badgeLabel
/// is application-level, not window-level.
pub fn apply(app: &AppHandle, count: Option<i64>) -> Result<(), String> {
    let _ = ensure_regular_activation(app);
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = set_ns_dock_badge(count);
        let _ = tx.send(result);
    })
    .map_err(|err| err.to_string())?;
    rx.recv().map_err(|err| err.to_string())?
}

fn activation_policy_name(policy: NSApplicationActivationPolicy) -> &'static str {
    match policy {
        NSApplicationActivationPolicy::Regular => "regular",
        NSApplicationActivationPolicy::Accessory => "accessory",
        NSApplicationActivationPolicy::Prohibited => "prohibited",
        _ => "other",
    }
}

fn set_regular_activation_policy() -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or_else(|| {
        "NSApplication activation policy requires the AppKit main thread".to_string()
    })?;
    let app = NSApplication::sharedApplication(mtm);
    let before = app.activationPolicy();
    if before != NSApplicationActivationPolicy::Regular {
        let ok = app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
        log::info!(
            "[dock-badge] activationPolicy={} → regular ok={}",
            activation_policy_name(before),
            ok
        );
        if !ok {
            return Err(format!(
                "Failed to set NSApplicationActivationPolicy::Regular from {}",
                activation_policy_name(before)
            ));
        }
    }
    Ok(())
}

fn set_ns_dock_badge(count: Option<i64>) -> Result<(), String> {
    let main_thread = NSThread::isMainThread_class();
    if !main_thread {
        return Err("NSDockTile badge requires the AppKit main thread".to_string());
    }
    let mtm = MainThreadMarker::new().ok_or_else(|| {
        "NSDockTile badge requires the AppKit main thread".to_string()
    })?;
    let app = NSApplication::sharedApplication(mtm);
    let policy = app.activationPolicy();
    let bundle = NSBundle::mainBundle();
    let bundle_id = bundle
        .bundleIdentifier()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let bundle_path = bundle.bundlePath().to_string();
    let requested = count
        .filter(|value| *value > 0)
        .map(|value| value.to_string());

    let tile = app.dockTile();
    tile.setShowsApplicationBadge(true);
    match requested.as_deref() {
        Some(label) => tile.setBadgeLabel(Some(&NSString::from_str(label))),
        None => tile.setBadgeLabel(None),
    }
    tile.display();
    let readback = tile
        .badgeLabel()
        .map(|value| value.to_string())
        .unwrap_or_default();

    log::info!(
        "[dock-badge] unread={:?} invoke received main-thread={} activationPolicy={} app bundle={} requested label={:?} badgeLabel after set={:?}",
        count,
        main_thread,
        activation_policy_name(policy),
        if bundle_id.is_empty() {
            bundle_path.as_str()
        } else {
            bundle_id.as_str()
        },
        requested.as_deref().unwrap_or(""),
        readback
    );

    Ok(())
}
