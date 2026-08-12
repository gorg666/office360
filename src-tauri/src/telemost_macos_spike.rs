use tauri::{AppHandle, Emitter, Manager};

const WINDOW_LABEL: &str = "telemost-macos-spike";
const CREATE_WINDOW_LABEL: &str = "telemost-macos-create";

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

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_telemost_macos_spike(app: AppHandle, url: String) -> Result<(), String> {
    use tauri::{webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder};
    use tauri_plugin_opener::OpenerExt;

    let parsed = tauri::Url::parse(&url).map_err(|_| "Telemost URL is invalid".to_string())?;
    if !matches!(parsed.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru"))
        || parsed.scheme() != "https"
        || !parsed.path().starts_with("/j/")
    {
        return Err("Only a Telemost meeting join URL can be opened internally".to_string());
    }

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
    let mut builder = WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::External(parsed))
        .title("Яндекс Телемост")
        .inner_size(1100.0, 760.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .center()
        .focused(true)
        .visible(true)
        .devtools(cfg!(debug_assertions))
        .incognito(false)
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

    builder = builder
        .parent(&main)
        .map_err(|error| format!("Failed to set Telemost spike parent: {error}"))?;

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
pub fn open_telemost_macos_spike(_app: AppHandle, _url: String) -> Result<(), String> {
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
pub fn open_telemost_macos_create(app: AppHandle) -> Result<(), String> {
    use tauri::{webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder};
    use tauri_plugin_opener::OpenerExt;

    if let Some(existing) = app.get_webview_window(CREATE_WINDOW_LABEL) {
        existing.show().map_err(|error| error.to_string())?;
        existing.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let main = app.get_webview_window("main").ok_or_else(|| "Main window is unavailable".to_string())?;
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
        .on_navigation(move |target| {
            let allowed = is_allowed_navigation(target);
            if allowed && matches!(target.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru")) && target.path().starts_with("/j/") {
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
                if matches!(target.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru")) && target.path().starts_with("/j/") {
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
pub fn open_telemost_macos_create(_app: AppHandle) -> Result<(), String> {
    Err("The Telemost create window is available only on macOS".to_string())
}

#[tauri::command]
pub fn close_telemost_macos_create(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(CREATE_WINDOW_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_navigation, is_generic_yandex_destination};

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
}
