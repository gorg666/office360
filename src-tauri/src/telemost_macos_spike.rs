use tauri::{AppHandle, Emitter, Manager};

const WINDOW_LABEL: &str = "telemost-macos-spike";
const CREATE_WINDOW_LABEL: &str = "telemost-macos-create";
const EMBEDDED_LABEL: &str = "telemost-embedded";
const MEETING_ISOLATION_SCRIPT: &str = include_str!("telemost_surface_isolation.js");

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TelemostBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn profile_identifier(account_key: &str) -> Result<[u8; 16], String> {
    let key = account_key.trim();
    if key.is_empty() || key.len() > 256 {
        return Err("Telemost account profile is invalid".to_string());
    }
    Ok(*uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_URL, format!("office360:telemost:{key}").as_bytes()).as_bytes())
}

fn validate_bounds(bounds: &TelemostBounds) -> Result<(), String> {
    if ![bounds.x, bounds.y, bounds.width, bounds.height]
        .into_iter()
        .all(f64::is_finite)
    {
        return Err("Telemost surface bounds are invalid".to_string());
    }
    if bounds.width < 32.0 || bounds.height < 32.0 {
        return Err("Telemost surface bounds are too small".to_string());
    }
    Ok(())
}

fn is_allowed_navigation(url: &tauri::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }

    if url.host_str() == Some("yandex.ru") {
        return url.path() == "/user-id";
    }

    matches!(
        url.host_str(),
        Some("telemost.yandex.ru")
            | Some("telemost.360.yandex.ru")
            | Some("passport.yandex.ru")
            | Some("oauth.yandex.ru")
            | Some("passport.yandex.com")
            | Some("oauth.yandex.com")
    )
}

fn is_generic_yandex_destination(url: &tauri::Url) -> bool {
    matches!(url.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru"))
        && !url.path().starts_with("/j/")
        || matches!(url.host_str(), Some("yandex.ru") | Some("www.yandex.ru"))
            && url.path() != "/user-id"
}

fn parse_meeting_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url).map_err(|_| "Telemost URL is invalid".to_string())?;
    if !matches!(parsed.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru"))
        || parsed.scheme() != "https"
        || !parsed.path().starts_with("/j/")
    {
        return Err("Only a Telemost meeting join URL can be opened internally".to_string());
    }
    Ok(parsed)
}

fn close_embedded_webview(app: &AppHandle) {
    if let Some(webview) = app.get_webview(EMBEDDED_LABEL) {
        let _ = webview.close();
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_telemost_macos_embedded(
    app: AppHandle,
    url: String,
    account_key: String,
    bounds: TelemostBounds,
) -> Result<(), String> {
    use tauri::{
        webview::{NewWindowResponse, WebviewBuilder},
        LogicalPosition, LogicalSize, WebviewUrl,
    };
    use tauri_plugin_opener::OpenerExt;

    validate_bounds(&bounds)?;
    let parsed = parse_meeting_url(&url)?;
    let data_store_identifier = profile_identifier(&account_key)?;

    // Prefer a single surface: close standalone fallback if it was open.
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
    }

    if let Some(existing) = app.get_webview(EMBEDDED_LABEL) {
        existing
            .set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|error| format!("Failed to position embedded Telemost: {error}"))?;
        existing
            .set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(|error| format!("Failed to size embedded Telemost: {error}"))?;
        existing
            .navigate(parsed)
            .map_err(|error| format!("Failed to navigate embedded Telemost: {error}"))?;
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window is unavailable".to_string())?;
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let builder = WebviewBuilder::new(EMBEDDED_LABEL, WebviewUrl::External(parsed))
        .initialization_script(MEETING_ISOLATION_SCRIPT)
        .data_store_identifier(data_store_identifier)
        .on_document_title_changed(|webview, title| {
            if title == "__O360_TELEMOST_SURFACE_DEGRADED__" {
                if let Some(main) = webview.app_handle().get_webview_window("main") {
                    let _ = main.emit("telemost-macos-surface-degraded", ());
                }
            }
        })
        .on_navigation(move |target| {
            let allowed = is_allowed_navigation(target);
            if !allowed {
                log::warn!("[telemost-embedded] blocked navigation: {target}");
                if is_generic_yandex_destination(target) {
                    if let Some(main) = navigation_app.get_webview_window("main") {
                        let _ = main.emit("telemost-macos-routing-error", target.as_str());
                    }
                } else if target.scheme() == "https" {
                    let _ = navigation_app.opener().open_url(target.as_str(), None::<&str>);
                }
            }
            allowed
        })
        .on_new_window(move |target, _features| {
            log::info!("[telemost-embedded] external popup redirected: {target}");
            let _ = popup_app.opener().open_url(target.as_str(), None::<&str>);
            NewWindowResponse::Deny
        });

    window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|error| format!("Failed to create embedded Telemost surface: {error}"))?;

    log::info!("[telemost-embedded] child WKWebView opened without a matching IPC capability");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn open_telemost_macos_embedded(
    _app: AppHandle,
    _url: String,
    _account_key: String,
    _bounds: TelemostBounds,
) -> Result<(), String> {
    Err("Embedded Telemost is available only on macOS".to_string())
}

#[tauri::command]
pub fn set_telemost_macos_embedded_bounds(app: AppHandle, bounds: TelemostBounds) -> Result<(), String> {
    validate_bounds(&bounds)?;
    let Some(webview) = app.get_webview(EMBEDDED_LABEL) else {
        return Ok(());
    };
    use tauri::{LogicalPosition, LogicalSize};
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| format!("Failed to position embedded Telemost: {error}"))?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|error| format!("Failed to size embedded Telemost: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn close_telemost_macos_embedded(app: AppHandle) -> Result<(), String> {
    close_embedded_webview(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
        let _ = main.emit("telemost-macos-embedded-closed", ());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_telemost_macos_spike(app: AppHandle, url: String, account_key: String) -> Result<(), String> {
    use tauri::{webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder};
    use tauri_plugin_opener::OpenerExt;

    let parsed = parse_meeting_url(&url)?;
    let data_store_identifier = profile_identifier(&account_key)?;

    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        existing
            .navigate(parsed)
            .map_err(|error| format!("Failed to navigate Telemost spike: {error}"))?;
        existing.show().map_err(|error| error.to_string())?;
        existing.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable".to_string())?;
    let popup_app = app.clone();
    let navigation_app = app.clone();
    let monitor = main.current_monitor().ok().flatten().or_else(|| app.primary_monitor().ok().flatten());
    let (meeting_width, meeting_height) = monitor
        .map(|value| {
            let scale = value.scale_factor();
            let area = value.work_area().size.to_logical::<f64>(scale);
            ((area.width * 0.9).max(800.0), (area.height * 0.9).max(600.0))
        })
        .unwrap_or((1200.0, 780.0));
    let builder = WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::External(parsed))
        .title("Яндекс Телемост")
        .inner_size(meeting_width, meeting_height)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .center()
        .focused(true)
        .visible(true)
        .devtools(cfg!(debug_assertions))
        .incognito(false)
        .data_store_identifier(data_store_identifier)
        .initialization_script(MEETING_ISOLATION_SCRIPT)
        .on_document_title_changed(|window, title| {
            if title == "__O360_TELEMOST_SURFACE_DEGRADED__" {
                if let Some(main) = window.app_handle().get_webview_window("main") {
                    let _ = main.emit("telemost-macos-surface-degraded", ());
                }
            }
        })
        .on_navigation(move |target| {
            let allowed = is_allowed_navigation(target);
            if !allowed {
                log::warn!("[telemost-macos-spike] blocked navigation: {target}");
                if is_generic_yandex_destination(target) {
                    if let Some(main) = navigation_app.get_webview_window("main") {
                        let _ = main.emit("telemost-macos-routing-error", target.as_str());
                    }
                } else if target.scheme() == "https" {
                    let _ = navigation_app.opener().open_url(target.as_str(), None::<&str>);
                }
            }
            allowed
        })
        .on_new_window(move |target, _features| {
            log::info!("[telemost-macos-spike] external popup redirected: {target}");
            let _ = popup_app.opener().open_url(target.as_str(), None::<&str>);
            NewWindowResponse::Deny
        });

    let window = builder
        .build()
        .map_err(|error| format!("Failed to create Telemost WKWebView spike: {error}"))?;

    let app_for_close = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Some(main) = app_for_close.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
                let _ = main.emit("telemost-macos-spike-closed", ());
            }
        }
    });

    log::info!("[telemost-macos-spike] WKWebView opened without a matching IPC capability");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn open_telemost_macos_spike(_app: AppHandle, _url: String, _account_key: String) -> Result<(), String> {
    Err("The Telemost WKWebView spike is available only on macOS".to_string())
}

#[tauri::command]
pub fn close_telemost_macos_spike(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window
            .close()
            .map_err(|error| format!("Failed to close Telemost spike: {error}"))?;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_telemost_macos_create(app: AppHandle, account_key: String) -> Result<(), String> {
    use tauri::{webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder};
    use tauri_plugin_opener::OpenerExt;

    close_embedded_webview(&app);

    if let Some(existing) = app.get_webview_window(CREATE_WINDOW_LABEL) {
        existing.show().map_err(|error| error.to_string())?;
        existing.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let main = app.get_webview_window("main").ok_or_else(|| "Main window is unavailable".to_string())?;
    let data_store_identifier = profile_identifier(&account_key)?;
    let start = tauri::Url::parse("https://telemost.yandex.ru/?browser-auto-create=1").map_err(|error| error.to_string())?;
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let mut builder = WebviewWindowBuilder::new(&app, CREATE_WINDOW_LABEL, WebviewUrl::External(start))
        .title("Создание встречи — Яндекс Телемост")
        .inner_size(1100.0, 760.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .center()
        .focused(true)
        .visible(true)
        .devtools(cfg!(debug_assertions))
        .incognito(false)
        .data_store_identifier(data_store_identifier)
        .on_navigation(move |target| {
            let allowed = is_allowed_navigation(target);
            if allowed
                && matches!(target.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru"))
                && target.path().starts_with("/j/")
            {
                if let Some(main) = navigation_app.get_webview_window("main") {
                    let _ = main.emit("telemost-macos-created", target.as_str());
                }
            } else if !allowed && target.scheme() == "https" {
                let _ = navigation_app.opener().open_url(target.as_str(), None::<&str>);
            }
            allowed
        })
        .on_new_window(move |target, _features| {
            if is_allowed_navigation(&target) {
                if matches!(target.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru"))
                    && target.path().starts_with("/j/")
                {
                    if let Some(main) = popup_app.get_webview_window("main") {
                        let _ = main.emit("telemost-macos-created", target.as_str());
                    }
                }
            } else if target.scheme() == "https" {
                let _ = popup_app.opener().open_url(target.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        });
    builder = builder.parent(&main).map_err(|error| error.to_string())?;
    let window = builder.build().map_err(|error| format!("Failed to create Telemost create window: {error}"))?;
    let url_watch_window = window.clone();
    let url_watch_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
        loop {
            interval.tick().await;
            if url_watch_app.get_webview_window(CREATE_WINDOW_LABEL).is_none() {
                break;
            }
            let Ok(target) = url_watch_window.url() else { continue };
            if matches!(target.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru"))
                && target.path().starts_with("/j/")
            {
                if let Some(main) = url_watch_app.get_webview_window("main") {
                    let _ = main.emit("telemost-macos-created", target.as_str());
                }
                break;
            }
        }
    });
    let app_for_close = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Some(main) = app_for_close.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
                let _ = main.emit("telemost-macos-create-closed", ());
            }
        }
    });
    log::info!("[telemost-macos-create] WKWebView opened without a matching IPC capability");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn open_telemost_macos_create(_app: AppHandle, _account_key: String) -> Result<(), String> {
    Err("The Telemost create window is available only on macOS".to_string())
}

#[tauri::command]
pub fn close_telemost_macos_create(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(CREATE_WINDOW_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn reset_telemost_macos_profile(app: AppHandle, account_key: String) -> Result<(), String> {
    close_embedded_webview(&app);
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
    }
    if let Some(window) = app.get_webview_window(CREATE_WINDOW_LABEL) {
        let _ = window.close();
    }
    app.remove_data_store(profile_identifier(&account_key)?)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        is_allowed_navigation, is_generic_yandex_destination, profile_identifier, validate_bounds, TelemostBounds,
    };

    #[test]
    fn derives_stable_account_scoped_profile_identifiers() {
        assert_eq!(profile_identifier("account-a").unwrap(), profile_identifier("account-a").unwrap());
        assert_ne!(profile_identifier("account-a").unwrap(), profile_identifier("account-b").unwrap());
        assert!(profile_identifier("").is_err());
    }

    #[test]
    fn allows_only_expected_yandex_navigation_origins() {
        for value in [
            "https://telemost.yandex.ru/j/123",
            "https://telemost.360.yandex.ru/j/123",
            "https://passport.yandex.ru/auth",
            "https://oauth.yandex.ru/authorize",
            "https://yandex.ru/user-id?from=Telemost",
        ] {
            assert!(is_allowed_navigation(&value.parse().unwrap()), "{value}");
        }
        for value in [
            "http://telemost.yandex.ru/j/123",
            "https://evil.example/",
            "https://yandex.ru/search/",
            "telemost://join/example",
            "file:///etc/passwd",
        ] {
            assert!(!is_allowed_navigation(&value.parse().unwrap()), "{value}");
        }
    }

    #[test]
    fn detects_generic_yandex_destinations_without_flagging_meeting_or_session_routes() {
        for value in [
            "https://telemost.yandex.ru/",
            "https://telemost.360.yandex.ru/home",
            "https://yandex.ru/",
            "https://yandex.ru/services/",
        ] {
            assert!(is_generic_yandex_destination(&value.parse().unwrap()), "{value}");
        }
        for value in [
            "https://telemost.yandex.ru/j/123",
            "https://yandex.ru/user-id?from=Telemost",
            "https://passport.yandex.ru/auth",
        ] {
            assert!(!is_generic_yandex_destination(&value.parse().unwrap()), "{value}");
        }
    }

    #[test]
    fn rejects_invalid_or_tiny_embedded_bounds() {
        assert!(validate_bounds(&TelemostBounds { x: 0.0, y: 0.0, width: 640.0, height: 480.0 }).is_ok());
        assert!(validate_bounds(&TelemostBounds { x: 0.0, y: 0.0, width: 10.0, height: 480.0 }).is_err());
        assert!(validate_bounds(&TelemostBounds {
            x: f64::NAN,
            y: 0.0,
            width: 640.0,
            height: 480.0
        })
        .is_err());
    }
}
