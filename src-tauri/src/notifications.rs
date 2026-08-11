//! Windows-native toast notifications with Office360 AppUserModelID.
//!
//! `tauri-plugin-notification` intentionally omits `app_id` when the exe lives
//! under `target/debug` or `target/release`, which makes WinRT attribute toasts
//! to PowerShell. This module always uses `com.office360.desktop` and registers
//! unpackaged AppUserModelId metadata (DisplayName + IconUri).

#[cfg(windows)]
mod windows_impl {
    use std::path::PathBuf;
    use std::sync::OnceLock;

    use tauri::{AppHandle, Manager};
    use tauri_winrt_notification::Toast;
    use windows::core::w;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    use windows_registry::CURRENT_USER;

    pub const AUMID: &str = "com.office360.desktop";
    const DISPLAY_NAME: &str = "Office360";

    static IDENTITY_READY: OnceLock<bool> = OnceLock::new();

    fn resolve_icon_path(app: &AppHandle) -> Option<PathBuf> {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let candidate = resource_dir.join("icons").join("128x128.png");
            if candidate.is_file() {
                return Some(candidate);
            }
            let candidate = resource_dir.join("128x128.png");
            if candidate.is_file() {
                return Some(candidate);
            }
        }

        if let Ok(exe) = std::env::current_exe() {
            // tauri dev: .../src-tauri/target/debug/office360.exe → ../../icons
            if let Some(debug_dir) = exe.parent() {
                let candidate = debug_dir.join("icons").join("128x128.png");
                if candidate.is_file() {
                    return Some(candidate);
                }
                let candidate = debug_dir
                    .join("..")
                    .join("..")
                    .join("icons")
                    .join("128x128.png");
                if let Ok(canonical) = candidate.canonicalize() {
                    if canonical.is_file() {
                        return Some(canonical);
                    }
                }
            }
        }

        None
    }

    fn register_aumid_metadata(app: &AppHandle) -> Result<(), String> {
        let key = CURRENT_USER
            .create(format!(r"SOFTWARE\Classes\AppUserModelId\{AUMID}"))
            .map_err(|e| format!("AppUserModelId registry create failed: {e}"))?;
        key
            .set_string("DisplayName", DISPLAY_NAME)
            .map_err(|e| format!("DisplayName registry set failed: {e}"))?;
        key
            .set_string("IconBackgroundColor", "0")
            .map_err(|e| format!("IconBackgroundColor registry set failed: {e}"))?;

        if let Some(icon) = resolve_icon_path(app) {
            let uri = format!("file:///{}", icon.display().to_string().replace('\\', "/"));
            key
                .set_string("IconUri", &uri)
                .map_err(|e| format!("IconUri registry set failed: {e}"))?;
        }

        Ok(())
    }

    pub fn ensure_windows_notification_identity(app: &AppHandle) -> Result<(), String> {
        if IDENTITY_READY.get().copied().unwrap_or(false) {
            return Ok(());
        }

        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(w!("com.office360.desktop"));
        }
        register_aumid_metadata(app)?;
        let _ = IDENTITY_READY.set(true);
        Ok(())
    }

    pub fn show_office360_notification(
        app: &AppHandle,
        title: String,
        body: String,
    ) -> Result<(), String> {
        ensure_windows_notification_identity(app)?;

        let app_handle = app.clone();
        Toast::new(AUMID)
            .title(&title)
            .text1(&body)
            .on_activated(move |_args| {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                Ok(())
            })
            .show()
            .map_err(|e| format!("WinRT toast failed: {e}"))
    }
}

#[cfg(windows)]
pub use windows_impl::{ensure_windows_notification_identity, show_office360_notification};

#[cfg(not(windows))]
pub fn ensure_windows_notification_identity(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn show_office360_notification(
    _app: &tauri::AppHandle,
    _title: String,
    _body: String,
) -> Result<(), String> {
    Err("Native Office360 notifications are Windows-only".into())
}

#[tauri::command]
pub fn show_native_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    show_office360_notification(&app, title, body)
}

#[tauri::command]
pub fn ensure_notification_app_identity(app: tauri::AppHandle) -> Result<(), String> {
    ensure_windows_notification_identity(&app)
}
