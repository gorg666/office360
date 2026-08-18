use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
use objc2_foundation::{MainThreadMarker, NSBundle, NSError, NSString, NSThread};
use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};
use tauri::AppHandle;

struct LastBadge {
    applied: bool,
    count: Option<i64>,
}

fn last_badge() -> &'static Mutex<LastBadge> {
    static SLOT: OnceLock<Mutex<LastBadge>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(LastBadge {
        applied: false,
        count: None,
    }))
}

fn remember_badge(count: Option<i64>) {
    if let Ok(mut last) = last_badge().lock() {
        last.applied = true;
        last.count = count;
    }
}

fn remembered_badge() -> Option<Option<i64>> {
    last_badge().lock().ok().and_then(|last| last.applied.then_some(last.count))
}

/// Restore `.regular` activation so the process owns a normal Dock tile.
///
/// Splash `skipTaskbar` can leave the app as Accessory. Office360 is a desktop
/// mail client (Dock icon, no LSUIElement / LSBackgroundOnly).
pub fn reapply_after_regular(app: &AppHandle) -> Result<(), String> {
    let snapshot = remembered_badge();
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            set_regular_activation_policy()?;
            request_badge_authorization(&handle);
            if let Some(count) = snapshot {
                log::info!("[dock-badge] reapply after regular unread={count:?}");
                set_ns_dock_badge(count)?;
            }
            Ok(())
        })();
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
    remember_badge(count);
    let handle = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = (|| {
            set_regular_activation_policy()?;
            request_badge_authorization(&handle);
            set_ns_dock_badge(count)
        })();
        let _ = tx.send(result);
    })
    .map_err(|err| err.to_string())?;
    rx.recv().map_err(|err| err.to_string())?
}

/// macOS 26+ ignores the visual Dock badge until the app has requested
/// `UNAuthorizationOptionBadge`. AppKit still stores/readbacks `badgeLabel`.
/// `tauri-plugin-notification` reports desktop permission as already granted
/// and never calls UserNotifications, so Office360 never appears in ncprefs.
fn request_badge_authorization(app: &AppHandle) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let app = app.clone();
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let block = RcBlock::new(move |granted: Bool, error: *mut NSError| {
        if error.is_null() {
            log::info!(
                "[dock-badge] UNUserNotificationCenter badge auth granted={}",
                granted.as_bool()
            );
        } else {
            let desc = unsafe { (*error).localizedDescription().to_string() };
            log::warn!(
                "[dock-badge] UNUserNotificationCenter badge auth granted={} error={desc}",
                granted.as_bool()
            );
        }
        let snapshot = remembered_badge();
        let hop = app.clone();
        let _ = hop.run_on_main_thread(move || {
            if let Some(count) = snapshot {
                log::info!("[dock-badge] reapply after UN auth unread={count:?}");
                if let Err(err) = set_ns_dock_badge(count) {
                    log::warn!("[dock-badge] reapply after UN auth failed: {err}");
                }
            }
        });
    });
    log::info!("[dock-badge] requesting UNUserNotificationCenter badge authorization");
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Badge,
        &block,
    );
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
    let exe = std::env::current_exe()
        .ok()
        .map(|path| path.display().to_string())
        .unwrap_or_default();
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
        "[dock-badge] pid={} exe={} unread={:?} invoke received main-thread={} activationPolicy={} app bundle={} requested label={:?} badgeLabel after set={:?}",
        std::process::id(),
        if exe.is_empty() { bundle_path.as_str() } else { exe.as_str() },
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
