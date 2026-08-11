#[cfg(not(target_os = "linux"))]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconId},
};
use tauri::{Emitter, Manager};

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn emit_to_main(app: &tauri::AppHandle, event: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(event, ());
    }
}
use tauri_plugin_autostart::MacosLauncher;

mod commands;
mod contact_avatars;
mod audio;
mod cef;
mod imap;
mod ldap;
mod messengers;
mod notifications;
mod oauth;
mod smtp;

#[tauri::command]
fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("splashscreen") {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn set_tray_tooltip(app: tauri::AppHandle, tooltip: String) -> Result<(), String> {
    #[cfg(not(target_os = "linux"))]
    {
        let tray = app
            .tray_by_id(&TrayIconId::new("main-tray"))
            .ok_or_else(|| "Tray icon not found".to_string())?;
        tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let _ = tooltip;
        let _ = app;
        log::debug!("set_tray_tooltip is not supported on Linux (KSNI tray)");
        Ok(())
    }
}

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        w.open_devtools();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Set explicit AUMID on Windows so toast notifications show "Office360"
    // instead of "Windows PowerShell"
    #[cfg(windows)]
    {
        use windows::core::w;
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(w!("com.office360.desktop"));
        }
    }

    tauri::Builder::default()
        // Single instance MUST be first
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
            // Forward args for deep linking
            let _ = app.emit("single-instance-args", argv);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            oauth::start_oauth_server,
            oauth::oauth_exchange_token,
            oauth::oauth_refresh_token,
            oauth::open_oauth_login_window,
            oauth::close_oauth_login_window,
            set_tray_tooltip,
            close_splashscreen,
            open_devtools,
            cef::cef_initialize,
            cef::cef_create_browser,
            cef::cef_set_bounds,
            cef::cef_set_visible,
            cef::cef_navigate,
            cef::cef_back,
            cef::cef_forward,
            cef::cef_reload,
            cef::cef_dom_command,
            cef::cef_permission_response,
            audio::play_notification_sound,
            notifications::show_native_notification,
            notifications::ensure_notification_app_identity,
            contact_avatars::save_contact_avatar,
            contact_avatars::delete_contact_avatar,
            commands::imap_test_connection,
            commands::imap_list_folders,
            commands::imap_create_folder,
            commands::imap_delete_folder,
            commands::imap_rename_folder,
            commands::imap_set_folder_subscription,
            commands::imap_list_subscribed_folders,
            commands::imap_get_capabilities,
            commands::imap_get_folder_quota,
            commands::imap_fetch_messages,
            commands::imap_fetch_message_headers,
            commands::imap_fetch_new_uids,
            commands::imap_search_all_uids,
            commands::imap_fetch_message_body,
            commands::imap_fetch_raw_message,
            commands::imap_set_flags,
            commands::imap_move_messages,
            commands::imap_delete_messages,
            commands::imap_get_folder_status,
            commands::imap_fetch_attachment,
            commands::imap_append_message,
            commands::imap_search_folder,
            commands::imap_sync_folder,
            commands::imap_raw_fetch_diagnostic,
            commands::imap_delta_check,
            commands::smtp_send_email,
            commands::smtp_test_connection,
            ldap::ldap_test_connection,
            ldap::ldap_search,
            messengers::messenger_request,
            messengers::messenger_download_file,
            messengers::messenger_send_file_base64,
            messengers::max_client_start_auth,
            messengers::max_client_check_code,
            messengers::max_client_check_password,
            messengers::max_client_complete_registration,
            messengers::max_client_get_session,
            messengers::max_client_get_history,
            messengers::max_client_send_message,
            messengers::max_client_mark_as_read,
            messengers::max_client_connect,
            messengers::max_client_disconnect,
        ])
        .setup(|app| {
            if let Err(err) = notifications::ensure_windows_notification_identity(app.handle()) {
                log::warn!("Windows notification identity setup: {err}");
            }

            {
                let level = if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                };
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(level)
                        .level_for("sqlx::query", log::LevelFilter::Warn)
                        .build(),
                )?;
            }

            #[cfg(not(target_os = "linux"))]
            {
                // Build system tray menu
                let show = MenuItem::with_id(app, "show", "Открыть Офис360", true, None::<&str>)?;
                let compose =
                    MenuItem::with_id(app, "compose", "Написать письмо", true, None::<&str>)?;
                let check_mail =
                    MenuItem::with_id(app, "check_mail", "Проверить почту", true, None::<&str>)?;
                let unread =
                    MenuItem::with_id(app, "unread", "Непрочитанные", true, None::<&str>)?;
                let settings =
                    MenuItem::with_id(app, "settings", "Настройки", true, None::<&str>)?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit =
                    MenuItem::with_id(app, "quit", "Выйти из Офис360", true, None::<&str>)?;
                let menu = Menu::with_items(
                    app,
                    &[
                        &show,
                        &compose,
                        &check_mail,
                        &unread,
                        &settings,
                        &separator,
                        &quit,
                    ],
                )?;

                let icon = app
                    .default_window_icon()
                    .cloned()
                    .expect("app should have a default icon configured in tauri.conf.json bundle");

                TrayIconBuilder::with_id("main-tray")
                    .icon(icon)
                    .tooltip("Office360")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => focus_main_window(app),
                        "compose" => emit_to_main(app, "tray-compose"),
                        "check_mail" => emit_to_main(app, "tray-check-mail"),
                        "unread" => {
                            focus_main_window(app);
                            emit_to_main(app, "tray-open-unread");
                        }
                        "settings" => {
                            focus_main_window(app);
                            emit_to_main(app, "tray-open-settings");
                        }
                        "quit" => {
                            cef::shutdown();
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                            focus_main_window(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }

            #[cfg(target_os = "linux")]
            {
                use tray_item::{IconSource, TrayItem};

                let app_handle = app.handle().clone();

                std::thread::spawn(move || {
                    let mut tray =
                        match TrayItem::new("Office360", IconSource::Resource("mail-read")) {
                            Ok(t) => t,
                            Err(e) => {
                                log::warn!("Failed to create system tray: {e}");
                                return;
                            }
                        };

                    let app_handle_show = app_handle.clone();
                    if let Err(e) = tray.add_menu_item("Открыть Офис360", move || {
                        focus_main_window(&app_handle_show);
                    }) {
                        log::warn!("Failed to add tray menu item 'Открыть Офис360': {e}");
                    }

                    let app_handle_compose = app_handle.clone();
                    if let Err(e) = tray.add_menu_item("Написать письмо", move || {
                        emit_to_main(&app_handle_compose, "tray-compose");
                    }) {
                        log::warn!("Failed to add tray menu item 'Написать письмо': {e}");
                    }

                    let app_handle_check = app_handle.clone();
                    if let Err(e) = tray.add_menu_item("Проверить почту", move || {
                        emit_to_main(&app_handle_check, "tray-check-mail");
                    }) {
                        log::warn!("Failed to add tray menu item 'Проверить почту': {e}");
                    }

                    let app_handle_unread = app_handle.clone();
                    if let Err(e) = tray.add_menu_item("Непрочитанные", move || {
                        focus_main_window(&app_handle_unread);
                        emit_to_main(&app_handle_unread, "tray-open-unread");
                    }) {
                        log::warn!("Failed to add tray menu item 'Непрочитанные': {e}");
                    }

                    let app_handle_settings = app_handle.clone();
                    if let Err(e) = tray.add_menu_item("Настройки", move || {
                        focus_main_window(&app_handle_settings);
                        emit_to_main(&app_handle_settings, "tray-open-settings");
                    }) {
                        log::warn!("Failed to add tray menu item 'Настройки': {e}");
                    }

                    let app_handle_quit = app_handle.clone();
                    if let Err(e) = tray.add_menu_item("Выйти из Офис360", move || {
                        app_handle_quit.exit(0);
                    }) {
                        log::warn!("Failed to add tray menu item 'Выйти из Офис360': {e}");
                    }

                    loop {
                        std::thread::park();
                    }
                });
            }

            // On Windows/Linux, remove decorations for custom titlebar.
            // macOS uses titleBarStyle: "overlay" from config instead, which
            // preserves native event routing in WKWebView.
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            // Start hidden in tray if launched with --hidden (autostart)
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
                // Also close splash screen when starting hidden
                if let Some(splash) = app.get_webview_window("splashscreen") {
                    let _ = splash.close();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray on close instead of quitting (main window only)
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                focus_main_window(app);
            }
        });

    cef::shutdown();
    log::info!("Tauri application exited normally");
}
