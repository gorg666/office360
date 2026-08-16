use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

const WINDOW_LABEL: &str = "telemost-macos-spike";
const CREATE_WINDOW_LABEL: &str = "telemost-macos-create";
const EMBEDDED_LABEL: &str = "telemost-embedded";
const CREATE_MASK_LABEL: &str = "telemost-create-mask";
const CREATE_MASK_SCRIPT: &str = r#"(function(){
  document.documentElement.lang = "ru";
  document.documentElement.innerHTML = "<head><meta charset=\"utf-8\"><style>html,body{margin:0;height:100%;background:#18181b;color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-items:center;-webkit-user-select:none;user-select:none}main{text-align:center;padding:2rem}h1{font-size:1.125rem;font-weight:600;margin:0 0 .5rem}p{font-size:.875rem;line-height:1.4;color:#a1a1aa;margin:0;max-width:22em}</style></head><body><main aria-label=\"Создаём встречу\"><h1>Создаём встречу</h1><p>Официальный Телемост откроется на экране подключения.</p></main></body>";
})();"#;
const MEETING_ISOLATION_SCRIPT: &str = include_str!("telemost_surface_isolation.js");
const EMBEDDED_PROMO_DISMISS_SCRIPT: &str = include_str!("telemost_embedded_promo_dismiss.js");
const OFFICIAL_CREATE_CLICK_SCRIPT: &str = include_str!("telemost_official_create_click.js");
const STAGE3_SURFACE_ISOLATION_SCRIPT: &str = include_str!("telemost_stage3_surface_isolation.js");
const LEAVE_TO_IDLE_SCRIPT: &str = include_str!("telemost_leave_to_idle.js");
const LEFT_TITLE: &str = "__O360_TELEMOST_LEFT__";
const DESTROY_CONFIRM_ATTEMPTS: u32 = 20;
const DESTROY_CONFIRM_DELAY_MS: u64 = 50;
const DATA_STORE_RETRY_ATTEMPTS: u32 = 5;
const DATA_STORE_RETRY_DELAY_MS: u64 = 100;

type ProfileId = [u8; 16];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EmbeddedSurfaceMode {
    Create,
    Meeting,
}

/// Native surface → owner profile. WebKit owns cookies/login.
struct TelemostMacSessionState {
    embedded_profile: Option<ProfileId>,
    create_profile: Option<ProfileId>,
    standalone_profile: Option<ProfileId>,
    resetting: Option<ProfileId>,
    embedded_mode: Option<EmbeddedSurfaceMode>,
    last_created_join: Option<String>,
    embedded_bounds: Option<TelemostBounds>,
    auth_challenge: bool,
}

fn session_state() -> &'static Mutex<TelemostMacSessionState> {
    static STATE: OnceLock<Mutex<TelemostMacSessionState>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(TelemostMacSessionState {
            embedded_profile: None,
            create_profile: None,
            standalone_profile: None,
            resetting: None,
            embedded_mode: None,
            last_created_join: None,
            embedded_bounds: None,
            auth_challenge: false,
        })
    })
}

fn lock_session() -> MutexGuard<'static, TelemostMacSessionState> {
    session_state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn lifecycle() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn reconcile_surface_owner(view_exists: bool, stored: Option<ProfileId>) -> Option<ProfileId> {
    if view_exists {
        stored
    } else {
        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EmbeddedOpenAction {
    Reuse,
    Recreate,
    Create,
}

fn decide_embedded_open(
    view_exists: bool,
    stored: Option<ProfileId>,
    incoming: ProfileId,
) -> EmbeddedOpenAction {
    let owned = reconcile_surface_owner(view_exists, stored);
    if view_exists && owned == Some(incoming) {
        EmbeddedOpenAction::Reuse
    } else if view_exists {
        EmbeddedOpenAction::Recreate
    } else {
        EmbeddedOpenAction::Create
    }
}

fn should_close_owned_surface(owned: Option<ProfileId>, target: ProfileId, view_exists: bool) -> bool {
    view_exists && owned == Some(target)
}

fn can_open_during_reset(resetting: Option<ProfileId>, incoming: ProfileId) -> bool {
    resetting != Some(incoming)
}

fn ownership_after_create_attempt(created: bool, incoming: ProfileId) -> Option<ProfileId> {
    created.then_some(incoming)
}

fn is_data_store_in_use_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("failed to remove data store")
        || lower.contains("data store is currently opened")
        || lower.contains("datastoreinuse")
}

fn should_retry_data_store_removal(message: &str, attempts_remaining: u32) -> bool {
    attempts_remaining > 0 && is_data_store_in_use_error(message)
}

fn should_reuse_embedded_webview(existing_profile: Option<ProfileId>, incoming_profile: ProfileId) -> bool {
    decide_embedded_open(true, existing_profile, incoming_profile) == EmbeddedOpenAction::Reuse
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
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

fn is_about_document(url: &tauri::Url) -> bool {
    url.scheme() == "about"
        && matches!(
            url.as_str().split(['?', '#']).next(),
            Some("about:blank") | Some("about:srcdoc")
        )
}

fn intercept_telemost_deep_link(url: &tauri::Url) -> bool {
    if url.scheme() != "telemost" {
        return false;
    }
    log::info!(
        "[telemost-wk-poc] TELEMOST DEEP LINK INTERCEPTED scheme={} path={}",
        url.scheme(),
        url.path()
    );
    true
}

fn is_allowed_navigation(url: &tauri::Url) -> bool {
    // about:blank and about:srcdoc: Telemost bootstrap and Passport SSO iframes.
    // Live Prompt 48: login completion navigated to about:srcdoc then sso.passport.
    if is_about_document(url) {
        return true;
    }
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
            | Some("sso.passport.yandex.ru")
            | Some("sso.passport.yandex.com")
    )
}

fn is_generic_yandex_destination(url: &tauri::Url) -> bool {
    matches!(url.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru"))
        && !url.path().starts_with("/j/")
        || matches!(url.host_str(), Some("yandex.ru") | Some("www.yandex.ru"))
            && url.path() != "/user-id"
}

fn is_telemost_host(url: &tauri::Url) -> bool {
    matches!(url.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru"))
}

fn is_telemost_join_path(url: &tauri::Url) -> bool {
    is_telemost_host(url) && url.path().starts_with("/j/") && url.path().len() > 3
}

fn is_telemost_create_path(url: &tauri::Url) -> bool {
    is_telemost_host(url)
        && (url.path() == "/" || url.path().is_empty() || url.path() == "/browser-auto-create")
}

fn parse_meeting_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url).map_err(|_| "Telemost URL is invalid".to_string())?;
    if parsed.scheme() != "https" || !is_telemost_join_path(&parsed) {
        return Err("Only a Telemost meeting join URL can be opened internally".to_string());
    }
    Ok(parsed)
}

fn parse_embedded_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url).map_err(|_| "Telemost URL is invalid".to_string())?;
    if parsed.scheme() != "https" || !(is_telemost_join_path(&parsed) || is_telemost_create_path(&parsed)) {
        return Err("Only a Telemost meeting or create URL can be opened internally".to_string());
    }
    Ok(parsed)
}

fn embedded_mode_for_url(url: &tauri::Url) -> EmbeddedSurfaceMode {
    if is_telemost_join_path(url) {
        EmbeddedSurfaceMode::Meeting
    } else {
        EmbeddedSurfaceMode::Create
    }
}

fn join_id(url: &tauri::Url) -> Option<&str> {
    url.path()
        .strip_prefix("/j/")
        .map(|rest| rest.split(['/', '?', '#']).next().unwrap_or(rest))
        .filter(|id| !id.is_empty())
}

fn same_embedded_destination(current: &tauri::Url, target: &tauri::Url) -> bool {
    if current.as_str() == target.as_str() {
        return true;
    }
    match (join_id(current), join_id(target)) {
        (Some(left), Some(right)) => left == right,
        _ => is_telemost_create_path(current) && is_telemost_create_path(target),
    }
}

fn should_emit_created_join(
    mode: Option<EmbeddedSurfaceMode>,
    last_created_join: Option<&str>,
    url: &tauri::Url,
) -> bool {
    mode == Some(EmbeddedSurfaceMode::Create)
        && is_telemost_join_path(url)
        && last_created_join != Some(url.as_str())
}

fn is_passport_url(url: &tauri::Url) -> bool {
    matches!(
        url.host_str(),
        Some("passport.yandex.ru")
            | Some("passport.yandex.com")
            | Some("oauth.yandex.ru")
            | Some("oauth.yandex.com")
            | Some("sso.passport.yandex.ru")
            | Some("sso.passport.yandex.com")
    )
}

fn should_resume_create_after_auth(
    auth_challenge: bool,
    mode: Option<EmbeddedSurfaceMode>,
    url: &tauri::Url,
) -> bool {
    auth_challenge && mode == Some(EmbeddedSurfaceMode::Create) && is_telemost_create_path(url)
}

fn remember_embedded_bounds(bounds: TelemostBounds) {
    lock_session().embedded_bounds = Some(bounds);
}

fn hide_create_mask(app: &AppHandle) {
    if app.get_webview(CREATE_MASK_LABEL).is_none() {
        return;
    }
    close_labeled_webview(app, CREATE_MASK_LABEL);
    log::info!("[telemost-wk-poc] CREATE MASK OFF");
}

fn sync_create_mask_bounds(app: &AppHandle, bounds: &TelemostBounds) {
    let Some(mask) = app.get_webview(CREATE_MASK_LABEL) else { return };
    use tauri::{LogicalPosition, LogicalSize};
    let _ = mask.set_position(LogicalPosition::new(bounds.x, bounds.y));
    let _ = mask.set_size(LogicalSize::new(bounds.width, bounds.height));
}

#[cfg(target_os = "macos")]
fn show_create_mask(app: &AppHandle) {
    use tauri::{webview::WebviewBuilder, LogicalPosition, LogicalSize, WebviewUrl};

    let Some(bounds) = lock_session().embedded_bounds else {
        log::warn!("[telemost-wk-poc] CREATE MASK SKIP missing bounds");
        return;
    };
    if app.get_webview(CREATE_MASK_LABEL).is_some() {
        sync_create_mask_bounds(app, &bounds);
        if let Some(mask) = app.get_webview(CREATE_MASK_LABEL) {
            let _ = mask.show();
        }
        log::info!("[telemost-wk-poc] CREATE MASK ON reuse");
        return;
    }
    let Some(window) = app.get_window("main") else {
        log::warn!("[telemost-wk-poc] CREATE MASK SKIP missing window");
        return;
    };
    let Ok(blank) = tauri::Url::parse("about:blank") else { return };
    let builder = WebviewBuilder::new(CREATE_MASK_LABEL, WebviewUrl::External(blank))
        .initialization_script(CREATE_MASK_SCRIPT);
    match window.add_child(
        builder,
        LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(bounds.width, bounds.height),
    ) {
        Ok(_) => log::info!("[telemost-wk-poc] CREATE MASK ON"),
        Err(error) => log::error!("[telemost-wk-poc] CREATE MASK FAIL: {error}"),
    }
}

#[cfg(not(target_os = "macos"))]
fn show_create_mask(_app: &AppHandle) {}

fn reveal_embedded_surface(app: &AppHandle) {
    hide_create_mask(app);
    set_embedded_visible(app, true);
}

fn cover_embedded_create(app: &AppHandle) {
    if let Some(webview) = app.get_webview(EMBEDDED_LABEL) {
        let _ = webview.show();
        log::info!("[telemost-wk-poc] WK SHOW");
    }
    show_create_mask(app);
}

fn set_embedded_visible(app: &AppHandle, visible: bool) {
    let Some(webview) = app.get_webview(EMBEDDED_LABEL) else { return };
    if visible {
        let _ = webview.show();
        let _ = webview.set_focus();
        log::info!("[telemost-wk-poc] WK SHOW");
    } else {
        let _ = webview.hide();
        log::info!("[telemost-wk-poc] WK HIDE");
    }
}

fn emit_auth_required(app: &AppHandle) {
    lock_session().auth_challenge = true;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("telemost-macos-auth-required", ());
    }
    reveal_embedded_surface(app);
    log::info!("[telemost-wk-poc] AUTH REQUIRED");
}

fn try_resume_create_after_auth(app: &AppHandle, url: &tauri::Url) -> bool {
    let should_resume = {
        let state = lock_session();
        should_resume_create_after_auth(state.auth_challenge, state.embedded_mode, url)
    };
    if !should_resume {
        return false;
    }
    lock_session().auth_challenge = false;
    cover_embedded_create(app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("telemost-macos-auth-resumed", ());
    }
    log::info!("[telemost-wk-poc] AUTH RESUMED CREATE URL={url}");
    true
}

fn try_emit_created_join(app: &AppHandle, url: &tauri::Url) -> bool {
    let payload = url.as_str().to_string();
    {
        let mut state = lock_session();
        if !should_emit_created_join(state.embedded_mode, state.last_created_join.as_deref(), url) {
            return false;
        }
        state.last_created_join = Some(payload.clone());
        state.embedded_mode = Some(EmbeddedSurfaceMode::Meeting);
        state.auth_challenge = false;
    }
    reveal_embedded_surface(app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("telemost-macos-created", payload.as_str());
    }
    log::info!("[telemost-wk-poc] CREATE JOIN CAPTURED URL={payload}");
    true
}

fn remember_embedded_mode(url: &tauri::Url) {
    let mut state = lock_session();
    let mode = embedded_mode_for_url(url);
    state.embedded_mode = Some(mode);
    if mode == EmbeddedSurfaceMode::Create {
        state.last_created_join = None;
        state.auth_challenge = false;
    }
}

fn spawn_embedded_create_join_watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(250));
        for _ in 0..240 {
            interval.tick().await;
            if app.get_webview(EMBEDDED_LABEL).is_none() {
                break;
            }
            if lock_session().embedded_mode != Some(EmbeddedSurfaceMode::Create) {
                break;
            }
            let Some(webview) = app.get_webview(EMBEDDED_LABEL) else { break };
            let Ok(target) = webview.url() else { continue };
            if try_emit_created_join(&app, &target) {
                break;
            }
        }
    });
}

fn close_labeled_webview(app: &AppHandle, label: &str) {
    if let Some(webview) = app.get_webview(label) {
        match webview.close() {
            Ok(()) => log::info!("[telemost-wk-poc] VIEW DETACHED label={label}"),
            Err(error) => log::error!("[telemost-wk-poc] VIEW DETACH FAIL label={label}: {error}"),
        }
    }
}

fn close_labeled_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        if let Err(error) = window.close() {
            log::error!("[telemost-wk-poc] WINDOW DETACH FAIL label={label}: {error}");
        }
    }
}

fn close_embedded_webview(app: &AppHandle) {
    hide_create_mask(app);
    close_labeled_webview(app, EMBEDDED_LABEL);
    let mut state = lock_session();
    state.embedded_profile = None;
    state.embedded_mode = None;
    state.last_created_join = None;
    state.embedded_bounds = None;
    state.auth_challenge = false;
}

fn reconcile_live_ownership(app: &AppHandle) {
    let mut state = lock_session();
    state.embedded_profile = reconcile_surface_owner(app.get_webview(EMBEDDED_LABEL).is_some(), state.embedded_profile);
    state.create_profile =
        reconcile_surface_owner(app.get_webview_window(CREATE_WINDOW_LABEL).is_some(), state.create_profile);
    state.standalone_profile =
        reconcile_surface_owner(app.get_webview_window(WINDOW_LABEL).is_some(), state.standalone_profile);
}

async fn wait_until_absent(mut still_present: impl FnMut() -> bool) -> bool {
    for _ in 0..DESTROY_CONFIRM_ATTEMPTS {
        if !still_present() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(DESTROY_CONFIRM_DELAY_MS)).await;
    }
    !still_present()
}

async fn confirm_embedded_gone(app: &AppHandle) -> Result<(), String> {
    if wait_until_absent(|| app.get_webview(EMBEDDED_LABEL).is_some()).await {
        lock_session().embedded_profile = None;
        return Ok(());
    }
    lock_session().embedded_profile = None;
    Err("Previous Telemost surface did not close".to_string())
}

async fn confirm_window_gone(app: &AppHandle, label: &str, clear: impl FnOnce()) -> Result<(), String> {
    if wait_until_absent(|| app.get_webview_window(label).is_some()).await {
        clear();
        return Ok(());
    }
    clear();
    Err(format!("Previous Telemost window did not close ({label})"))
}

async fn remove_profile_data_store(app: &AppHandle, profile: ProfileId) -> Result<(), String> {
    let mut last = String::new();
    for attempt in 0..DATA_STORE_RETRY_ATTEMPTS {
        match app.remove_data_store(profile).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                let message = error.to_string();
                let remaining = DATA_STORE_RETRY_ATTEMPTS.saturating_sub(attempt + 1);
                log::warn!(
                    "[telemost-wk-poc] DATA STORE REMOVE FAIL attempt={} remaining={} class={}",
                    attempt + 1,
                    remaining,
                    if is_data_store_in_use_error(&message) {
                        "DataStoreInUse"
                    } else {
                        "Other"
                    }
                );
                if !should_retry_data_store_removal(&message, remaining) {
                    return Err(message);
                }
                last = message;
                tokio::time::sleep(Duration::from_millis(DATA_STORE_RETRY_DELAY_MS)).await;
            }
        }
    }
    Err(format!("Telemost data store still in use: {last}"))
}

fn log_page_kind(url: &tauri::Url) {
    let value = url.as_str();
    if matches!(url.host_str(), Some("passport.yandex.ru") | Some("passport.yandex.com")) {
        log::info!("[telemost-wk-poc] LOGIN PAGE DETECTED URL={value}");
        return;
    }
    if matches!(url.host_str(), Some("telemost.yandex.ru") | Some("telemost.360.yandex.ru")) {
        log::info!("[telemost-wk-poc] TELEMOST PAGE DETECTED URL={value}");
        if url.path().starts_with("/j/") {
            log::info!("[telemost-wk-poc] PREJOIN DETECTED URL={value}");
        }
    }
}

fn log_title_kind(title: &str) {
    if let Some(payload) = title.strip_prefix("__O360_DOM_CAPTURE__") {
        log::info!("[telemost-isolation] DOM CAPTURE {payload}");
        return;
    }
    log::info!("[telemost-wk-poc] TITLE {title}");
    let normalized = title.trim().to_lowercase();
    if normalized.is_empty() {
        return;
    }
    if normalized.contains("passport") || normalized.contains("яндекс id") || normalized.contains("yandex id") {
        log::info!("[telemost-wk-poc] LOGIN PAGE DETECTED TITLE={title}");
        return;
    }
    // Join URL stays /j/ for both prejoin and in-meeting; title is the only
    // child-webview signal. Visual confirm of remote A/V remains required.
    log::info!("[telemost-wk-poc] MEETING PAGE DETECTED TITLE={title}");
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn open_telemost_macos_embedded(
    app: AppHandle,
    url: String,
    account_key: String,
    bounds: TelemostBounds,
) -> Result<(), String> {
    use tauri::{
        webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
        LogicalPosition, LogicalSize, WebviewUrl,
    };

    validate_bounds(&bounds)?;
    let parsed = parse_embedded_url(&url)?;
    let incoming_mode = embedded_mode_for_url(&parsed);
    let data_store_identifier = profile_identifier(&account_key)?;
    let _lifecycle = lifecycle().lock().await;
    reconcile_live_ownership(&app);
    if !can_open_during_reset(lock_session().resetting, data_store_identifier) {
        return Err("Telemost profile is being reset".to_string());
    }

    // Prefer a single surface: close standalone fallback if it was open.
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
        lock_session().standalone_profile = None;
    }

    let view_exists = app.get_webview(EMBEDDED_LABEL).is_some();
    let stored = lock_session().embedded_profile;
    match decide_embedded_open(view_exists, stored, data_store_identifier) {
        EmbeddedOpenAction::Reuse => {
            let existing = app
                .get_webview(EMBEDDED_LABEL)
                .ok_or_else(|| "Embedded Telemost surface disappeared".to_string())?;
            log::info!("[telemost-wk-poc] WK INIT reuse persistent child view");
            existing
                .set_position(LogicalPosition::new(bounds.x, bounds.y))
                .map_err(|error| format!("Failed to position embedded Telemost: {error}"))?;
            existing
                .set_size(LogicalSize::new(bounds.width, bounds.height))
                .map_err(|error| format!("Failed to size embedded Telemost: {error}"))?;
            let skip_navigate = existing
                .url()
                .ok()
                .map(|current| same_embedded_destination(&current, &parsed))
                .unwrap_or(false);
            remember_embedded_mode(&parsed);
            remember_embedded_bounds(bounds);
            if skip_navigate {
                log::info!("[telemost-wk-poc] NAV SKIP already on target URL={parsed}");
                if incoming_mode == EmbeddedSurfaceMode::Create {
                    if let Err(error) = existing.eval(OFFICIAL_CREATE_CLICK_SCRIPT) {
                        log::warn!("[telemost-create] eval fail: {error}");
                    }
                }
            } else {
                existing.navigate(parsed.clone()).map_err(|error| {
                    log::error!("[telemost-wk-poc] NAV FAIL: {error}");
                    format!("Failed to navigate embedded Telemost: {error}")
                })?;
            }
            if incoming_mode == EmbeddedSurfaceMode::Create {
                cover_embedded_create(&app);
                spawn_embedded_create_join_watch(app.clone());
            } else {
                reveal_embedded_surface(&app);
            }
            log::info!(
                "[telemost-wk-poc] RESIZE x={} y={} width={} height={}",
                bounds.x, bounds.y, bounds.width, bounds.height
            );
            return Ok(());
        }
        EmbeddedOpenAction::Recreate => {
            log::info!("[telemost-wk-poc] WK INIT recreate different_profile");
            close_embedded_webview(&app);
            confirm_embedded_gone(&app).await?;
        }
        EmbeddedOpenAction::Create => {
            lock_session().embedded_profile = None;
        }
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window is unavailable".to_string())?;
    remember_embedded_mode(&parsed);
    let nav_app = app.clone();
    let load_app = app.clone();
    let popup_app = app.clone();
    log::info!("[telemost-wk-poc] WK INIT persistent_store=true url={parsed}");
    let builder = WebviewBuilder::new(EMBEDDED_LABEL, WebviewUrl::External(parsed.clone()))
        .initialization_script(EMBEDDED_PROMO_DISMISS_SCRIPT)
        .initialization_script(OFFICIAL_CREATE_CLICK_SCRIPT)
        .initialization_script(STAGE3_SURFACE_ISOLATION_SCRIPT)
        .initialization_script(LEAVE_TO_IDLE_SCRIPT)
        .data_store_identifier(data_store_identifier)
        .on_document_title_changed({
            let title_app = app.clone();
            move |_webview, title| {
                if title == LEFT_TITLE {
                    log::info!("[telemost-create] left → idle");
                    let _ = title_app.emit("telemost-macos-left", "");
                    if let Some(main) = title_app.get_webview_window("main") {
                        let _ = main.emit("telemost-macos-left", "");
                    }
                    hide_create_mask(&title_app);
                    set_embedded_visible(&title_app, false);
                    return;
                }
                if let Some(payload) = title.strip_prefix("__O360_TELEMOST_CREATE__:") {
                    log::info!("[telemost-create] {payload}");
                    return;
                }
                log_title_kind(&title);
                if title.to_lowercase().contains("passport")
                    || title.to_lowercase().contains("яндекс id")
                    || title.to_lowercase().contains("yandex id")
                {
                    emit_auth_required(&title_app);
                }
            }
        })
        .on_navigation(move |target| {
            if intercept_telemost_deep_link(target) {
                return false;
            }
            let allowed = is_allowed_navigation(target);
            if allowed {
                log::info!("[telemost-wk-poc] NAV START URL={target}");
                log_page_kind(target);
                if is_passport_url(target) {
                    emit_auth_required(&nav_app);
                } else {
                    try_resume_create_after_auth(&nav_app, target);
                }
                try_emit_created_join(&nav_app, target);
            } else {
                log::warn!("[telemost-wk-poc] NAV FAIL blocked URL={target}");
            }
            allowed
        })
        .on_page_load(move |webview, payload| match payload.event() {
            PageLoadEvent::Started => {
                log::info!("[telemost-wk-poc] NAV COMMIT URL={}", payload.url());
                log_page_kind(payload.url());
            }
            PageLoadEvent::Finished => {
                log::info!("[telemost-wk-poc] NAV FINISH URL={}", payload.url());
                log_page_kind(payload.url());
                if is_telemost_create_path(payload.url()) {
                    try_resume_create_after_auth(&load_app, payload.url());
                    if let Err(error) = webview.eval(OFFICIAL_CREATE_CLICK_SCRIPT) {
                        log::warn!("[telemost-create] eval fail: {error}");
                    }
                }
                try_emit_created_join(&load_app, payload.url());
            }
        })
        .on_new_window(move |target, _features| {
            if intercept_telemost_deep_link(&target) {
                return NewWindowResponse::Deny;
            }
            if is_allowed_navigation(&target) {
                log::info!("[telemost-wk-poc] popup redirected into child URL={target}");
                if is_passport_url(&target) {
                    emit_auth_required(&popup_app);
                } else {
                    try_resume_create_after_auth(&popup_app, &target);
                }
                try_emit_created_join(&popup_app, &target);
                if let Some(webview) = popup_app.get_webview(EMBEDDED_LABEL) {
                    if let Err(error) = webview.navigate(target) {
                        log::error!("[telemost-wk-poc] NAV FAIL popup: {error}");
                    }
                }
            } else {
                log::warn!("[telemost-wk-poc] NAV FAIL blocked popup URL={target}");
            }
            NewWindowResponse::Deny
        });

    let created = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map(|_| true)
        .map_err(|error| {
            log::error!("[telemost-wk-poc] NAV FAIL child creation: {error}");
            format!("Failed to create embedded Telemost surface: {error}")
        });
    lock_session().embedded_profile = ownership_after_create_attempt(created.is_ok(), data_store_identifier);
    created?;
    remember_embedded_bounds(bounds);
    if incoming_mode == EmbeddedSurfaceMode::Create {
        cover_embedded_create(&app);
        spawn_embedded_create_join_watch(app.clone());
    } else {
        reveal_embedded_surface(&app);
    }

    log::info!("[telemost-wk-poc] VIEW ATTACHED");
    log::info!(
        "[telemost-wk-poc] RESIZE x={} y={} width={} height={}",
        bounds.x, bounds.y, bounds.width, bounds.height
    );
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn open_telemost_macos_embedded(
    _app: AppHandle,
    _url: String,
    _account_key: String,
    _bounds: TelemostBounds,
) -> Result<(), String> {
    Err("Embedded Telemost is available only on macOS".to_string())
}

#[tauri::command]
pub fn set_telemost_macos_embedded_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if visible {
        reveal_embedded_surface(&app);
    } else {
        hide_create_mask(&app);
        set_embedded_visible(&app, false);
    }
    Ok(())
}

#[tauri::command]
pub fn set_telemost_macos_embedded_bounds(app: AppHandle, bounds: TelemostBounds) -> Result<(), String> {
    validate_bounds(&bounds)?;
    let Some(webview) = app.get_webview(EMBEDDED_LABEL) else {
        lock_session().embedded_profile = None;
        return Ok(());
    };
    use tauri::{LogicalPosition, LogicalSize};
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| format!("Failed to position embedded Telemost: {error}"))?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|error| format!("Failed to size embedded Telemost: {error}"))?;
    remember_embedded_bounds(bounds);
    sync_create_mask_bounds(&app, &bounds);
    log::info!(
        "[telemost-wk-poc] RESIZE x={} y={} width={} height={}",
        bounds.x, bounds.y, bounds.width, bounds.height
    );
    Ok(())
}

#[tauri::command]
pub async fn close_telemost_macos_embedded(app: AppHandle) -> Result<(), String> {
    let _lifecycle = lifecycle().lock().await;
    close_embedded_webview(&app);
    let _ = confirm_embedded_gone(&app).await;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
        let _ = main.emit("telemost-macos-embedded-closed", ());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn open_telemost_macos_spike(app: AppHandle, url: String, account_key: String) -> Result<(), String> {
    use tauri::{webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder};
    use tauri_plugin_opener::OpenerExt;

    let parsed = parse_meeting_url(&url)?;
    let data_store_identifier = profile_identifier(&account_key)?;
    let _lifecycle = lifecycle().lock().await;
    reconcile_live_ownership(&app);
    if !can_open_during_reset(lock_session().resetting, data_store_identifier) {
        return Err("Telemost profile is being reset".to_string());
    }

    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        if should_reuse_embedded_webview(lock_session().standalone_profile, data_store_identifier) {
            existing
                .navigate(parsed)
                .map_err(|error| format!("Failed to navigate Telemost spike: {error}"))?;
            existing.show().map_err(|error| error.to_string())?;
            existing.set_focus().map_err(|error| error.to_string())?;
            return Ok(());
        }
        close_labeled_window(&app, WINDOW_LABEL);
        confirm_window_gone(&app, WINDOW_LABEL, || lock_session().standalone_profile = None).await?;
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

    let window = match builder.build() {
        Ok(window) => {
            lock_session().standalone_profile = Some(data_store_identifier);
            window
        }
        Err(error) => {
            lock_session().standalone_profile = None;
            return Err(format!("Failed to create Telemost WKWebView spike: {error}"));
        }
    };

    let app_for_close = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            lock_session().standalone_profile = None;
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
pub async fn open_telemost_macos_spike(_app: AppHandle, _url: String, _account_key: String) -> Result<(), String> {
    Err("The Telemost WKWebView spike is available only on macOS".to_string())
}

#[tauri::command]
pub async fn close_telemost_macos_spike(app: AppHandle) -> Result<(), String> {
    let _lifecycle = lifecycle().lock().await;
    close_labeled_window(&app, WINDOW_LABEL);
    let _ = confirm_window_gone(&app, WINDOW_LABEL, || lock_session().standalone_profile = None).await;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn open_telemost_macos_create(app: AppHandle, account_key: String) -> Result<(), String> {
    use tauri::{webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder};
    use tauri_plugin_opener::OpenerExt;

    let data_store_identifier = profile_identifier(&account_key)?;
    let _lifecycle = lifecycle().lock().await;
    reconcile_live_ownership(&app);
    if !can_open_during_reset(lock_session().resetting, data_store_identifier) {
        return Err("Telemost profile is being reset".to_string());
    }

    // Only tear down the embedded JOIN surface if it belongs to the SAME
    // account requesting CREATE. A different account's active meeting must
    // survive this call (Stage 2 ownership hardening).
    let embedded_owned = lock_session().embedded_profile;
    let embedded_view_exists = app.get_webview(EMBEDDED_LABEL).is_some();
    if should_close_owned_surface(embedded_owned, data_store_identifier, embedded_view_exists) {
        close_embedded_webview(&app);
        let _ = confirm_embedded_gone(&app).await;
    }

    if let Some(existing) = app.get_webview_window(CREATE_WINDOW_LABEL) {
        if should_reuse_embedded_webview(lock_session().create_profile, data_store_identifier) {
            existing.show().map_err(|error| error.to_string())?;
            existing.set_focus().map_err(|error| error.to_string())?;
            return Ok(());
        }
        close_labeled_window(&app, CREATE_WINDOW_LABEL);
        confirm_window_gone(&app, CREATE_WINDOW_LABEL, || lock_session().create_profile = None).await?;
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
    let window = match builder.build() {
        Ok(window) => {
            lock_session().create_profile = Some(data_store_identifier);
            window
        }
        Err(error) => {
            lock_session().create_profile = None;
            return Err(format!("Failed to create Telemost create window: {error}"));
        }
    };
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
            lock_session().create_profile = None;
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
pub async fn open_telemost_macos_create(_app: AppHandle, _account_key: String) -> Result<(), String> {
    Err("The Telemost create window is available only on macOS".to_string())
}

#[tauri::command]
pub async fn close_telemost_macos_create(app: AppHandle) -> Result<(), String> {
    let _lifecycle = lifecycle().lock().await;
    close_labeled_window(&app, CREATE_WINDOW_LABEL);
    let _ = confirm_window_gone(&app, CREATE_WINDOW_LABEL, || lock_session().create_profile = None).await;
    Ok(())
}

#[tauri::command]
pub async fn reset_telemost_macos_profile(app: AppHandle, account_key: String) -> Result<(), String> {
    let target = profile_identifier(&account_key)?;
    let _lifecycle = lifecycle().lock().await;
    lock_session().resetting = Some(target);
    let result = reset_owned_profile_surfaces(&app, target).await;
    lock_session().resetting = None;
    result
}

async fn reset_owned_profile_surfaces(app: &AppHandle, target: ProfileId) -> Result<(), String> {
    reconcile_live_ownership(app);
    let (embedded_owned, create_owned, standalone_owned) = {
        let state = lock_session();
        (state.embedded_profile, state.create_profile, state.standalone_profile)
    };

    let close_embedded = should_close_owned_surface(
        embedded_owned,
        target,
        app.get_webview(EMBEDDED_LABEL).is_some(),
    );
    let close_create = should_close_owned_surface(
        create_owned,
        target,
        app.get_webview_window(CREATE_WINDOW_LABEL).is_some(),
    );
    let close_standalone = should_close_owned_surface(
        standalone_owned,
        target,
        app.get_webview_window(WINDOW_LABEL).is_some(),
    );

    if close_embedded {
        close_embedded_webview(app);
        confirm_embedded_gone(app).await?;
    }
    if close_create {
        close_labeled_window(app, CREATE_WINDOW_LABEL);
        confirm_window_gone(app, CREATE_WINDOW_LABEL, || lock_session().create_profile = None).await?;
    }
    if close_standalone {
        close_labeled_window(app, WINDOW_LABEL);
        confirm_window_gone(app, WINDOW_LABEL, || lock_session().standalone_profile = None).await?;
    }

    remove_profile_data_store(app, target).await
}

#[cfg(test)]
mod tests {
    use super::{
        can_open_during_reset, decide_embedded_open, embedded_mode_for_url, is_allowed_navigation,
        is_data_store_in_use_error, is_generic_yandex_destination, is_telemost_create_path, ownership_after_create_attempt,
        parse_embedded_url, parse_meeting_url, profile_identifier, reconcile_surface_owner, same_embedded_destination,
        should_close_owned_surface, should_emit_created_join, should_resume_create_after_auth,
        should_retry_data_store_removal, should_reuse_embedded_webview, validate_bounds, EmbeddedOpenAction,
        EmbeddedSurfaceMode, TelemostBounds,
    };

    #[test]
    fn portal_free_scripts_and_visibility_are_wired() {
        let src = include_str!("telemost_macos_spike.rs");
        assert!(src.contains("OFFICIAL_CREATE_CLICK_SCRIPT"));
        assert!(src.contains("LEAVE_TO_IDLE_SCRIPT"));
        assert!(src.contains("set_embedded_visible"));
        assert!(src.contains("emit_auth_required"));
        assert!(src.contains("telemost-macos-left"));
        assert!(src.contains("telemost-macos-auth-required"));
        assert!(src.contains("telemost-macos-auth-resumed"));
        assert!(src.contains("sso.passport.yandex.ru"));
        assert!(src.contains("STAGE3_SURFACE_ISOLATION_SCRIPT"));
        assert!(src.contains("CREATE_MASK_LABEL"));
        assert!(src.contains("show_create_mask"));
        assert!(src.contains("cover_embedded_create"));
        assert!(src.contains("reveal_embedded_surface"));
        let create = include_str!("telemost_official_create_click.js");
        assert!(create.contains("[telemost-create] "));
        assert!(create.contains("clicked once"));
        assert!(create.contains("official CTA matched"));
        assert!(create.contains("epoch reset"));
        assert!(create.contains("readyState"));
        assert!(!create.contains("getBoundingClientRect"));
        let leave = include_str!("telemost_leave_to_idle.js");
        assert!(leave.contains("__O360_TELEMOST_LEFT__"));
        assert!(leave.contains("onJoinPath"));
        assert!(leave.contains("оцените качество связи"));
        assert!(leave.contains("PREJOIN_CTA"));
        assert!(leave.contains("sawRating"));
        assert!(leave.contains("sawLeave"));
        assert!(leave.contains("выйти из встречи"));
        assert!(leave.contains("RATING_WAIT_MS"));
    }

    #[test]
    fn derives_stable_account_scoped_profile_identifiers() {
        assert_eq!(profile_identifier("account-a").unwrap(), profile_identifier("account-a").unwrap());
        assert_ne!(profile_identifier("account-a").unwrap(), profile_identifier("account-b").unwrap());
        assert!(profile_identifier("").is_err());
        assert!(profile_identifier("   ").is_err());
        assert!(profile_identifier(&"x".repeat(257)).is_err());
    }

    #[test]
    fn reuses_embedded_webview_only_for_the_same_profile() {
        let account_a = profile_identifier("account-a").unwrap();
        let account_b = profile_identifier("account-b").unwrap();
        assert_eq!(decide_embedded_open(true, Some(account_a), account_a), EmbeddedOpenAction::Reuse);
        assert_eq!(decide_embedded_open(true, Some(account_a), account_b), EmbeddedOpenAction::Recreate);
        assert_eq!(decide_embedded_open(false, Some(account_a), account_a), EmbeddedOpenAction::Create);
        assert_eq!(decide_embedded_open(true, None, account_a), EmbeddedOpenAction::Recreate);
        assert!(should_reuse_embedded_webview(Some(account_a), account_a));
        assert!(!should_reuse_embedded_webview(Some(account_a), account_b));
        assert!(!should_reuse_embedded_webview(None, account_a));
    }

    #[test]
    fn reconciles_stale_ownership_when_view_is_missing() {
        let account_a = profile_identifier("account-a").unwrap();
        assert_eq!(reconcile_surface_owner(false, Some(account_a)), None);
        assert_eq!(reconcile_surface_owner(true, Some(account_a)), Some(account_a));
        assert_eq!(reconcile_surface_owner(true, None), None);
        assert_eq!(decide_embedded_open(false, Some(account_a), account_a), EmbeddedOpenAction::Create);
    }

    #[test]
    fn create_failure_clears_ownership() {
        let account_b = profile_identifier("account-b").unwrap();
        assert_eq!(ownership_after_create_attempt(false, account_b), None);
        assert_eq!(ownership_after_create_attempt(true, account_b), Some(account_b));
    }

    #[test]
    fn reset_b_does_not_close_active_a() {
        let account_a = profile_identifier("account-a").unwrap();
        let account_b = profile_identifier("account-b").unwrap();
        assert!(!should_close_owned_surface(Some(account_a), account_b, true));
        assert!(should_close_owned_surface(Some(account_a), account_a, true));
        assert!(!should_close_owned_surface(None, account_b, true));
        assert!(!should_close_owned_surface(Some(account_a), account_b, false));
    }

    #[test]
    fn reset_active_a_closes_before_store_removal() {
        let account_a = profile_identifier("account-a").unwrap();
        assert!(should_close_owned_surface(Some(account_a), account_a, true));
        assert!(!should_close_owned_surface(Some(account_a), account_a, false));
    }

    #[test]
    fn open_same_profile_is_blocked_while_that_profile_resets() {
        let account_a = profile_identifier("account-a").unwrap();
        let account_b = profile_identifier("account-b").unwrap();
        assert!(!can_open_during_reset(Some(account_b), account_b));
        assert!(can_open_during_reset(Some(account_b), account_a));
        assert!(can_open_during_reset(None, account_b));
    }

    #[test]
    fn data_store_in_use_is_retried_then_fails_explicitly() {
        assert!(is_data_store_in_use_error("runtime error: failed to remove data store"));
        assert!(is_data_store_in_use_error("DataStoreInUse"));
        assert!(should_retry_data_store_removal("failed to remove data store", 4));
        assert!(!should_retry_data_store_removal("failed to remove data store", 0));
        assert!(!should_retry_data_store_removal("permission denied", 4));
    }

    #[test]
    fn allows_only_expected_yandex_navigation_origins() {
        for value in [
            "https://telemost.yandex.ru/j/123",
            "https://telemost.360.yandex.ru/j/123",
            "https://passport.yandex.ru/auth",
            "https://oauth.yandex.ru/authorize",
            "https://sso.passport.yandex.ru/prepare?finish=https%3A%2F%2Ftelemost.yandex.ru%2F",
            "https://yandex.ru/user-id?from=Telemost",
            "about:blank",
            "about:srcdoc",
        ] {
            assert!(is_allowed_navigation(&value.parse().unwrap()), "{value}");
        }
        for value in [
            "http://telemost.yandex.ru/j/123",
            "https://evil.example/",
            "https://yandex.ru/search/",
            "https://mc.yandex.ru/metrika/match.html",
            "https://ya.ru/",
            "telemost://join/example",
            "file:///etc/passwd",
        ] {
            assert!(!is_allowed_navigation(&value.parse().unwrap()), "{value}");
        }
    }

    #[test]
    fn resumes_create_only_after_an_auth_challenge_returns_to_telemost_home() {
        let home: tauri::Url = "https://telemost.yandex.ru/?browser-auto-create=1".parse().unwrap();
        let finish: tauri::Url = "https://telemost.yandex.ru/browser-auto-create?from_passport=1".parse().unwrap();
        let join: tauri::Url = "https://telemost.yandex.ru/j/abc".parse().unwrap();
        let passport: tauri::Url = "https://passport.yandex.ru/auth".parse().unwrap();
        assert!(is_telemost_create_path(&home));
        assert!(is_telemost_create_path(&finish));
        assert!(!is_telemost_create_path(&join));
        assert!(should_resume_create_after_auth(true, Some(EmbeddedSurfaceMode::Create), &home));
        assert!(should_resume_create_after_auth(true, Some(EmbeddedSurfaceMode::Create), &finish));
        assert!(!should_resume_create_after_auth(false, Some(EmbeddedSurfaceMode::Create), &home));
        assert!(!should_resume_create_after_auth(true, Some(EmbeddedSurfaceMode::Meeting), &home));
        assert!(!should_resume_create_after_auth(true, Some(EmbeddedSurfaceMode::Create), &join));
        assert!(!should_resume_create_after_auth(true, Some(EmbeddedSurfaceMode::Create), &passport));
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

    #[test]
    fn parses_embedded_create_and_join_urls() {
        for value in [
            "https://telemost.yandex.ru/",
            "https://telemost.yandex.ru/?browser-auto-create=1",
            "https://telemost.360.yandex.ru/",
            "https://telemost.yandex.ru/j/123456789",
            "https://telemost.360.yandex.ru/j/123456789",
        ] {
            assert!(parse_embedded_url(value).is_ok(), "{value}");
        }
        assert!(parse_meeting_url("https://telemost.yandex.ru/").is_err());
        assert!(parse_embedded_url("https://telemost.yandex.ru/home").is_err());
        assert!(parse_embedded_url("https://evil.example/").is_err());
        assert!(parse_embedded_url("https://passport.yandex.ru/auth").is_err());
        assert!(is_telemost_create_path(
            &"https://telemost.yandex.ru/?browser-auto-create=1".parse().unwrap()
        ));
        assert_eq!(
            embedded_mode_for_url(&"https://telemost.yandex.ru/?browser-auto-create=1".parse().unwrap()),
            EmbeddedSurfaceMode::Create
        );
        assert_eq!(
            embedded_mode_for_url(&"https://telemost.yandex.ru/j/123".parse().unwrap()),
            EmbeddedSurfaceMode::Meeting
        );
    }

    #[test]
    fn emits_created_join_only_from_create_mode_once() {
        let join: tauri::Url = "https://telemost.yandex.ru/j/123456789".parse().unwrap();
        let create: tauri::Url = "https://telemost.yandex.ru/?browser-auto-create=1".parse().unwrap();
        assert!(should_emit_created_join(Some(EmbeddedSurfaceMode::Create), None, &join));
        assert!(!should_emit_created_join(Some(EmbeddedSurfaceMode::Meeting), None, &join));
        assert!(!should_emit_created_join(Some(EmbeddedSurfaceMode::Create), None, &create));
        assert!(!should_emit_created_join(
            Some(EmbeddedSurfaceMode::Create),
            Some(join.as_str()),
            &join
        ));
    }

    #[test]
    fn skips_reuse_navigate_for_the_same_join_or_create_surface() {
        let join_a: tauri::Url = "https://telemost.yandex.ru/j/123456789".parse().unwrap();
        let join_a_query: tauri::Url = "https://telemost.yandex.ru/j/123456789?from=create".parse().unwrap();
        let join_b: tauri::Url = "https://telemost.yandex.ru/j/987654321".parse().unwrap();
        let create: tauri::Url = "https://telemost.yandex.ru/?browser-auto-create=1".parse().unwrap();
        let create_home: tauri::Url = "https://telemost.yandex.ru/".parse().unwrap();
        assert!(same_embedded_destination(&join_a, &join_a_query));
        assert!(!same_embedded_destination(&join_a, &join_b));
        assert!(same_embedded_destination(&create, &create_home));
        assert!(!same_embedded_destination(&create, &join_a));
    }
}
