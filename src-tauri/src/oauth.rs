use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::time::{timeout_at, Instant};

const YANDEX_OAUTH_WINDOW_LABEL: &str = "yandex-oauth";

fn oauth_cancel_slot() -> &'static Mutex<Option<oneshot::Sender<()>>> {
    static SLOT: OnceLock<Mutex<Option<oneshot::Sender<()>>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// Abort any in-flight `start_oauth_server` accept loop so port 17248 can be rebound.
fn signal_oauth_server_cancel() {
    if let Ok(mut slot) = oauth_cancel_slot().lock() {
        if let Some(tx) = slot.take() {
            let _ = tx.send(());
            log::info!("OAuth callback server cancel signaled");
        }
    }
}

fn take_oauth_cancel_receiver() -> oneshot::Receiver<()> {
    // Replace any previous session (single active OAuth flow / free the fixed port).
    signal_oauth_server_cancel();
    let (tx, rx) = oneshot::channel();
    if let Ok(mut slot) = oauth_cancel_slot().lock() {
        *slot = Some(tx);
    }
    rx
}

fn clear_oauth_cancel_slot() {
    if let Ok(mut slot) = oauth_cancel_slot().lock() {
        slot.take();
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum OAuthWindowPurpose {
    Oauth,
    PassportBootstrap,
}

fn parse_oauth_window_purpose(raw: Option<&str>) -> OAuthWindowPurpose {
    match raw.map(str::trim) {
        Some("passport-bootstrap") => OAuthWindowPurpose::PassportBootstrap,
        _ => OAuthWindowPurpose::Oauth,
    }
}

fn oauth_purpose_label(purpose: OAuthWindowPurpose) -> &'static str {
    match purpose {
        OAuthWindowPurpose::Oauth => "oauth",
        OAuthWindowPurpose::PassportBootstrap => "passport-bootstrap",
    }
}

fn redact_oauth_url_for_log(url: &Url) -> String {
    let mut pairs: Vec<(String, String)> = Vec::new();
    for (key, value) in url.query_pairs() {
        let key = key.into_owned();
        let lower = key.to_ascii_lowercase();
        let redacted = lower.contains("token")
            || lower.contains("code")
            || lower == "state"
            || lower.contains("challenge")
            || lower.contains("secret")
            || lower.contains("password");
        pairs.push((
            key,
            if redacted {
                "<redacted>".to_string()
            } else {
                value.into_owned()
            },
        ));
    }
    let mut out = format!("{}://{}{}", url.scheme(), url.host_str().unwrap_or(""), url.path());
    if !pairs.is_empty() {
        out.push('?');
        out.push_str(
            &pairs
                .into_iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("&"),
        );
    }
    out
}

fn is_allowed_oauth_start_url(url: &Url, purpose: OAuthWindowPurpose) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or("");
    match purpose {
        OAuthWindowPurpose::Oauth => matches!(host, "oauth.yandex.ru" | "oauth.yandex.com"),
        OAuthWindowPurpose::PassportBootstrap => matches!(
            host,
            "passport.yandex.ru"
                | "passport.yandex.com"
                | "login.yandex.ru"
                | "login.yandex.com"
                | "id.yandex.ru"
                | "id.yandex.com"
                | "auth.yandex.ru"
                | "auth.yandex.com"
        ),
    }
}

fn is_passport_bootstrap_complete(url: &Url) -> bool {
    url.scheme() == "https"
        && matches!(url.host_str(), Some("id.yandex.ru") | Some("id.yandex.com"))
}

async fn destroy_existing_oauth_window(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window(YANDEX_OAUTH_WINDOW_LABEL) {
        let _ = existing.destroy();
        for _ in 0..20 {
            if app.get_webview_window(YANDEX_OAUTH_WINDOW_LABEL).is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

fn is_allowed_yandex_oauth_navigation(url: &Url) -> bool {
    let scheme = url.scheme();
    let host = url.host_str().unwrap_or("");

    // Official Yandex OAuth / ID hosts only.
    if scheme == "https" {
        if host == "sso.ya.ru" {
            return url.path() == "/sync";
        }
        return matches!(
            host,
            "oauth.yandex.ru"
                | "oauth.yandex.com"
                | "passport.yandex.ru"
                | "passport.yandex.com"
                | "login.yandex.ru"
                | "login.yandex.com"
                | "id.yandex.ru"
                | "id.yandex.com"
                | "auth.yandex.ru"
                | "auth.yandex.com"
                | "sso.passport.yandex.ru"
                | "sso.passport.yandex.com"
        ) || host == "yandex.ru"
            || host == "yandex.com"
            || host.ends_with(".yandex.ru")
            || host.ends_with(".yandex.com")
            || host.ends_with(".yandex.net");
    }

    // Local callback listener (registered redirect_uri).
    if (scheme == "http" || scheme == "https")
        && (host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]")
    {
        return url.port_or_known_default() == Some(17248);
    }

    // Allow blank during WebView bootstrap.
    if scheme == "about" {
        return true;
    }

    log::info!(
        "OAuth WebView blocked navigation to host={} scheme={}",
        host,
        scheme
    );
    false
}

/// Opens (or recreates) the in-app Yandex login WebView.
///
/// On macOS the window uses the same persistent WKWebsiteDataStore as Telemost
/// (`wk_account_store`). Passport cookies stay in that store. OAuth tokens are
/// still exchanged via localhost:17248 PKCE and are never written as cookies.
#[tauri::command]
pub async fn open_oauth_login_window(
    app: AppHandle,
    url: String,
    account_key: Option<String>,
    purpose: Option<String>,
) -> Result<(), String> {
    let parsed: Url = url
        .parse()
        .map_err(|e| format!("Invalid OAuth URL: {e}"))?;
    let window_purpose = parse_oauth_window_purpose(purpose.as_deref());

    if !is_allowed_oauth_start_url(&parsed, window_purpose) {
        return Err(match window_purpose {
            OAuthWindowPurpose::Oauth => {
                "OAuth login window may only open official Yandex authorize URLs (oauth.yandex.ru)."
                    .to_string()
            }
            OAuthWindowPurpose::PassportBootstrap => {
                "Passport bootstrap may only open official Yandex ID login URLs.".to_string()
            }
        });
    }

    let account_key = account_key.unwrap_or_default();
    let purpose_name = oauth_purpose_label(window_purpose);
    #[cfg(target_os = "macos")]
    let data_store_identifier = crate::wk_account_store::data_store_identifier(&account_key)?;

    log::info!(
        "[oauth-wk] open purpose={purpose_name} host={} account_key={account_key}",
        parsed.host_str().unwrap_or("")
    );

    // Recreate the window so it cannot keep a previous (default) data store.
    destroy_existing_oauth_window(&app).await;

    let parent = app.get_webview_window("main");
    let nav_app = app.clone();
    let nav_purpose = purpose_name;
    let mut builder = WebviewWindowBuilder::new(
        &app,
        YANDEX_OAUTH_WINDOW_LABEL,
        WebviewUrl::External(parsed.clone()),
    )
    .title("Яндекс ID")
    .inner_size(520.0, 720.0)
    .min_inner_size(420.0, 560.0)
    .resizable(true)
    .center()
    .focused(true)
    .visible(true)
    .incognito(false)
    .on_navigation(move |nav_url| {
        let allowed = is_allowed_yandex_oauth_navigation(nav_url);
        log::info!(
            "[oauth-wk] NAVIGATION REQUEST purpose={nav_purpose} url={} decision={}",
            redact_oauth_url_for_log(nav_url),
            if allowed { "ALLOW" } else { "BLOCK" }
        );
        if allowed
            && window_purpose == OAuthWindowPurpose::PassportBootstrap
            && is_passport_bootstrap_complete(nav_url)
        {
            let _ = nav_app.emit("yandex-passport-bootstrap-complete", ());
        }
        allowed
    })
    .on_page_load(move |_window, payload| {
        let phase = match payload.event() {
            PageLoadEvent::Started => "START",
            PageLoadEvent::Finished => "FINISH",
        };
        log::info!(
            "[oauth-wk] PAGE LOAD {phase} purpose={purpose_name} url={}",
            redact_oauth_url_for_log(payload.url())
        );
    });

    #[cfg(target_os = "macos")]
    {
        builder = builder.data_store_identifier(data_store_identifier);
        log::debug!(
            "[oauth-wk] account_key={} store_uuid={} label={YANDEX_OAUTH_WINDOW_LABEL} default_store=false",
            account_key,
            crate::wk_account_store::data_store_uuid_string(data_store_identifier)
        );
    }

    if let Some(main) = parent.as_ref() {
        builder = builder
            .parent(main)
            .map_err(|e| format!("Failed to set OAuth window parent: {e}"))?;
    } else {
        log::warn!("[oauth-wk] parent skipped: main webview window is unavailable");
    }

    let window = builder
        .build()
        .map_err(|e| format!("Failed to create OAuth WebView: {e}"))?;

    let app_for_close = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            signal_oauth_server_cancel();
            let _ = app_for_close.emit("oauth-window-closed", ());
            log::info!("OAuth WebView destroyed (label={YANDEX_OAUTH_WINDOW_LABEL})");
        }
    });

    log::info!("OAuth WebView opened (label={YANDEX_OAUTH_WINDOW_LABEL}) purpose={purpose_name}");
    Ok(())
}

/// Closes the in-app Yandex OAuth WebView if present.
/// Prefer destroy so a blank localhost page cannot linger after callback.
#[tauri::command]
pub async fn close_oauth_login_window(app: AppHandle) -> Result<(), String> {
    signal_oauth_server_cancel();
    if let Some(window) = app.get_webview_window(YANDEX_OAUTH_WINDOW_LABEL) {
        let _ = window.hide();
        match window.destroy() {
            Ok(()) => {
                log::info!("OAuth WebView destroyed (label={YANDEX_OAUTH_WINDOW_LABEL})");
            }
            Err(destroy_err) => {
                log::warn!(
                    "OAuth WebView destroy failed (label={YANDEX_OAUTH_WINDOW_LABEL}): {destroy_err}; trying close()"
                );
                window
                    .close()
                    .map_err(|e| format!("Failed to close OAuth window: {e}"))?;
                log::info!("OAuth WebView close requested (label={YANDEX_OAUTH_WINDOW_LABEL})");
            }
        }
    }
    Ok(())
}

/// Stops the localhost OAuth callback listener (if any) without waiting for redirect.
#[tauri::command]
pub async fn stop_oauth_server() -> Result<(), String> {
    signal_oauth_server_cancel();
    // Allow the accept loop to observe cancel and drop TcpListeners before a rebind.
    tokio::time::sleep(Duration::from_millis(75)).await;
    Ok(())
}

#[derive(Serialize)]
pub struct OAuthResult {
    pub code: Option<String>,
    pub state: String,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[derive(Clone, Serialize)]
struct OAuthListeningPayload {
    port: u16,
    ipv4: bool,
    ipv6: bool,
}

/// Binds the requested localhost port for OAuth callback (IPv4 + IPv6 loopback).
/// Emits `oauth-listening` once ready so the frontend can open the browser only after bind.
/// Keeps accepting until a valid OAuth redirect is received (ignores junk/preconnect sockets).
/// Cancel via `stop_oauth_server` / OAuth window destroy so the fixed port is released immediately.
#[tauri::command]
pub async fn start_oauth_server(
    app: AppHandle,
    port: u16,
    state: String,
) -> Result<OAuthResult, String> {
    let mut cancel_rx = take_oauth_cancel_receiver();
    // Let a just-cancelled previous accept loop drop its sockets before rebind.
    tokio::time::sleep(Duration::from_millis(75)).await;

    // Bind exactly the requested port. Silent fallback to port+N breaks fixed redirect_uri
    // registrations (Yandex requires http://localhost:17248).
    let ipv4 = match TcpListener::bind(format!("127.0.0.1:{}", port)).await {
        Ok(listener) => Some(listener),
        Err(err) => {
            log::warn!("OAuth IPv4 bind 127.0.0.1:{} failed: {}", port, err);
            None
        }
    };
    let ipv6 = match TcpListener::bind(format!("[::1]:{}", port)).await {
        Ok(listener) => Some(listener),
        Err(err) => {
            log::warn!("OAuth IPv6 bind [::1]:{} failed: {}", port, err);
            None
        }
    };

    if ipv4.is_none() && ipv6.is_none() {
        clear_oauth_cancel_slot();
        // Stable machine code for frontend i18n; details stay in logs.
        return Err(format!("oauth_callback_port_in_use:{port}"));
    }

    if ipv4.is_none() {
        log::warn!(
            "OAuth listening IPv6-only on port {}. Browsers using 127.0.0.1 may fail.",
            port
        );
    }
    if ipv6.is_none() {
        log::warn!(
            "OAuth listening IPv4-only on port {}. Browsers resolving localhost to ::1 may get connection refused.",
            port
        );
    }

    let listening = OAuthListeningPayload {
        port,
        ipv4: ipv4.is_some(),
        ipv6: ipv6.is_some(),
    };
    if let Err(err) = app.emit("oauth-listening", listening.clone()) {
        log::warn!("Failed to emit oauth-listening event: {err}");
    }
    log::info!(
        "OAuth callback server listening on port {} (ipv4={}, ipv6={})",
        port,
        listening.ipv4,
        listening.ipv6
    );

    let deadline = Instant::now() + Duration::from_secs(300);
    let result = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break Err("OAuth timed out — please try again".to_string());
        }

        let mut stream = tokio::select! {
            _ = &mut cancel_rx => {
                log::info!("OAuth callback server stopped (cancel)");
                break Ok(OAuthResult {
                    code: None,
                    state: state.clone(),
                    error: Some("access_denied".to_string()),
                    error_description: Some("Авторизация отменена.".to_string()),
                });
            }
            accepted = timeout_at(deadline, accept_oauth_connection(&ipv4, &ipv6)) => {
                match accepted {
                    Ok(Ok(stream)) => stream,
                    Ok(Err(e)) => break Err(format!("Failed to accept: {}", e)),
                    Err(_) => break Err("OAuth timed out — please try again".to_string()),
                }
            }
        };

        // Cap per-connection read so a silent TCP connect cannot wedge the flow forever.
        let request = match timeout_at(Instant::now() + Duration::from_secs(10), read_http_request(&mut stream))
            .await
        {
            Ok(Ok(body)) => body,
            Ok(Err(err)) => {
                log::warn!("OAuth callback read failed: {err}");
                let _ = write_browser_response(
                    &mut stream,
                    &error_html("Не удалось прочитать ответ авторизации. Закройте вкладку и попробуйте снова."),
                )
                .await;
                continue;
            }
            Err(_) => {
                log::warn!("OAuth callback read timed out; waiting for next connection");
                let _ = write_browser_response(
                    &mut stream,
                    &error_html("Таймаут чтения callback. Закройте вкладку и повторите вход из Office360."),
                )
                .await;
                continue;
            }
        };

        if request.trim().is_empty() {
            log::info!("OAuth ignored empty connection on port {}", port);
            continue;
        }

        let callback = match parse_oauth_callback(&request) {
            Ok(payload) => payload,
            Err(err) => {
                log::info!("OAuth ignored non-callback request: {err}");
                let _ = write_browser_response(
                    &mut stream,
                    &error_html("Ожидался OAuth redirect. Закройте вкладку и завершите вход из Office360."),
                )
                .await;
                continue;
            }
        };

        // Validate state parameter (CSRF protection)
        if callback.state != state {
            let _ = write_browser_response(
                &mut stream,
                &error_html("Не удалось подтвердить состояние авторизации. Закройте вкладку и попробуйте снова из Office360."),
            )
            .await;
            break Err("OAuth state mismatch — possible CSRF attack".to_string());
        }

        if let Some(error) = callback.error.as_ref() {
            let description = callback
                .error_description
                .as_deref()
                .unwrap_or("Провайдер OAuth вернул ошибку авторизации.");
            let html = format!(
                r#"<!DOCTYPE html>
<html>
<head><title>Office360 — Ошибка авторизации</title></head>
<body style="font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #fecaca;">
<div style="text-align: center; max-width: 540px;">
<h1 style="margin-bottom: 8px;">Ошибка авторизации</h1>
<p style="opacity: 0.9; margin-bottom: 6px;">{}</p>
<p style="opacity: 0.72;">Закройте вкладку и вернитесь в Office360.</p>
</div>
</body>
</html>"#,
                html_escape(description)
            );
            let _ = write_browser_response(&mut stream, &html).await;
            log::info!("OAuth callback received provider error (state validation PASS)");
            break Ok(OAuthResult {
                code: None,
                state: callback.state,
                error: Some(error.clone()),
                error_description: callback.error_description,
            });
        }

        let code = match callback.code {
            Some(code) => code,
            None => {
                log::info!("OAuth callback missing code; waiting for next connection");
                let _ = write_browser_response(
                    &mut stream,
                    &error_html("В ответе нет кода авторизации. Повторите вход из Office360."),
                )
                .await;
                continue;
            }
        };

        let html = r#"<!DOCTYPE html>
<html>
<head><title>Office360 — Аккаунт подключён</title></head>
<body style="font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0;">
<div style="text-align: center;">
<h1 style="margin-bottom: 8px;">Аккаунт успешно подключён</h1>
<p style="opacity: 0.7;">Теперь можно закрыть вкладку и вернуться в Office360.</p>
</div>
</body>
</html>"#;
        let _ = write_browser_response(&mut stream, html).await;
        log::info!("OAuth callback received (state validation PASS)");

        break Ok(OAuthResult {
            code: Some(code),
            state: callback.state,
            error: None,
            error_description: None,
        });
    };

    clear_oauth_cancel_slot();
    result
}

async fn accept_oauth_connection(
    ipv4_listener: &Option<TcpListener>,
    ipv6_listener: &Option<TcpListener>,
) -> std::io::Result<TcpStream> {
    match (ipv4_listener.as_ref(), ipv6_listener.as_ref()) {
        (Some(ipv4), Some(ipv6)) => {
            tokio::select! {
                result = ipv4.accept() => result.map(|(stream, _)| stream),
                result = ipv6.accept() => result.map(|(stream, _)| stream),
            }
        }
        (Some(ipv4), None) => ipv4.accept().await.map(|(stream, _)| stream),
        (None, Some(ipv6)) => ipv6.accept().await.map(|(stream, _)| stream),
        (None, None) => Err(std::io::Error::new(
            std::io::ErrorKind::AddrNotAvailable,
            "no localhost listener available",
        )),
    }
}

async fn read_http_request(stream: &mut TcpStream) -> Result<String, String> {
    let mut buf = vec![0u8; 8192];
    let mut collected = Vec::new();
    loop {
        let n = stream
            .read(&mut buf)
            .await
            .map_err(|e| format!("Failed to read: {}", e))?;
        if n == 0 {
            break;
        }
        collected.extend_from_slice(&buf[..n]);
        if collected.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if collected.len() > 64 * 1024 {
            return Err("OAuth request too large".to_string());
        }
    }
    Ok(String::from_utf8_lossy(&collected).to_string())
}

struct OAuthCallbackPayload {
    code: Option<String>,
    state: String,
    error: Option<String>,
    error_description: Option<String>,
}

fn parse_oauth_callback(request: &str) -> Result<OAuthCallbackPayload, String> {
    let first_line = request.lines().next().ok_or("Empty request")?;

    let path = first_line
        .split_whitespace()
        .nth(1)
        .ok_or("No path in request")?;

    let params = parse_query_string(path);
    let state = params
        .get("state")
        .cloned()
        .ok_or_else(|| "No state in redirect".to_string())?;
    Ok(OAuthCallbackPayload {
        code: params.get("code").cloned(),
        state,
        error: params.get("error").cloned(),
        error_description: params.get("error_description").cloned(),
    })
}

fn parse_query_string(path: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    if let Some(query) = path.split('?').nth(1) {
        for pair in query.split('&') {
            let mut kv = pair.splitn(2, '=');
            if let (Some(key), Some(value)) = (kv.next(), kv.next()) {
                params.insert(key.to_string(), urlencoding_decode(value));
            }
        }
    }
    params
}

fn urlencoding_decode(s: &str) -> String {
    let mut result = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                result.push(byte);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            result.push(b' ');
        } else {
            result.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8(result).unwrap_or_else(|_| s.to_string())
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn error_html(message: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
<head><title>Office360 — Ошибка авторизации</title></head>
<body style="font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #fecaca;">
<div style="text-align: center; max-width: 540px;">
<h1 style="margin-bottom: 8px;">Ошибка авторизации</h1>
<p style="opacity: 0.85;">{}</p>
</div>
</body>
</html>"#,
        html_escape(message)
    )
}

async fn write_browser_response(stream: &mut TcpStream, html: &str) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await
}

#[derive(Serialize, Deserialize)]
pub struct TokenExchangeResult {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
    pub scope: Option<String>,
    pub id_token: Option<String>,
}

/// Exchange an OAuth authorization code for tokens via Rust HTTP client (avoids CORS).
#[tauri::command]
pub async fn oauth_exchange_token(
    token_url: String,
    code: String,
    client_id: String,
    redirect_uri: Option<String>,
    code_verifier: Option<String>,
    client_secret: Option<String>,
    scope: Option<String>,
) -> Result<TokenExchangeResult, String> {
    let mut params = vec![
        ("code", code),
        ("client_id", client_id),
        ("grant_type", "authorization_code".to_string()),
    ];
    if let Some(redirect) = redirect_uri {
        params.push(("redirect_uri", redirect));
    }
    if let Some(verifier) = code_verifier {
        params.push(("code_verifier", verifier));
    }
    if let Some(secret) = client_secret {
        if !secret.is_empty() {
            params.push(("client_secret", secret));
        }
    }
    if let Some(s) = scope {
        params.push(("scope", s));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !response.status().is_success() {
        let error = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Token exchange failed: {}", error));
    }

    response
        .json::<TokenExchangeResult>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))
}

/// Refresh an OAuth token via Rust HTTP client (avoids CORS).
#[tauri::command]
pub async fn oauth_refresh_token(
    token_url: String,
    refresh_token: String,
    client_id: String,
    client_secret: Option<String>,
    scope: Option<String>,
) -> Result<TokenExchangeResult, String> {
    let mut params = vec![
        ("refresh_token", refresh_token),
        ("client_id", client_id),
        ("grant_type", "refresh_token".to_string()),
    ];
    if let Some(secret) = client_secret {
        if !secret.is_empty() {
            params.push(("client_secret", secret));
        }
    }
    if let Some(s) = scope {
        params.push(("scope", s));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?;

    if !response.status().is_success() {
        let error = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Token refresh failed: {}", error));
    }

    response
        .json::<TokenExchangeResult>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_start_url_rejects_non_authorize_hosts() {
        let oauth = parse_oauth_window_purpose(Some("oauth"));
        let authorize: Url = "https://oauth.yandex.ru/authorize?client_id=x"
            .parse()
            .unwrap();
        let passport: Url = "https://passport.yandex.ru/auth".parse().unwrap();
        assert!(is_allowed_oauth_start_url(&authorize, oauth));
        assert!(!is_allowed_oauth_start_url(&passport, oauth));
    }

    #[test]
    fn passport_bootstrap_start_url_allows_official_login_hosts() {
        let bootstrap = parse_oauth_window_purpose(Some("passport-bootstrap"));
        let passport: Url = "https://passport.yandex.ru/auth".parse().unwrap();
        let authorize: Url = "https://oauth.yandex.ru/authorize".parse().unwrap();
        assert!(is_allowed_oauth_start_url(&passport, bootstrap));
        assert!(!is_allowed_oauth_start_url(&authorize, bootstrap));
    }

    #[test]
    fn passport_bootstrap_completes_on_id_yandex() {
        let done: Url = "https://id.yandex.ru/".parse().unwrap();
        let login: Url = "https://passport.yandex.ru/auth".parse().unwrap();
        assert!(is_passport_bootstrap_complete(&done));
        assert!(!is_passport_bootstrap_complete(&login));
    }

    #[test]
    fn oauth_window_does_not_inject_tokens() {
        let src = include_str!("oauth.rs");
        let production = src.split("#[cfg(test)]").next().expect("oauth.rs has tests");
        assert!(!production.contains("Session_id"));
        assert!(!production.contains("set_cookie"));
        assert!(production.contains("data_store_identifier"));
        assert!(production.contains("account_key"));
        assert!(production.contains("never written as cookies"));
        assert!(production.contains("store_uuid="));
        assert!(production.contains("default_store=false"));
    }

    #[test]
    fn passport_bootstrap_url_roundtrip_keeps_retpath() {
        let raw = "https://passport.yandex.ru/auth?origin=office360&retpath=https%3A%2F%2Fid.yandex.ru";
        let parsed: Url = raw.parse().unwrap();
        assert_eq!(parsed.host_str(), Some("passport.yandex.ru"));
        assert_eq!(parsed.path(), "/auth");
        let retpath = parsed
            .query_pairs()
            .find(|(key, _)| key == "retpath")
            .map(|(_, value)| value.into_owned());
        assert_eq!(retpath.as_deref(), Some("https://id.yandex.ru"));
        let serialized = parsed.as_str();
        assert_eq!(raw, serialized, "Url parse must not transform bootstrap URL");
        let unencoded_retpath = serialized.contains("retpath=https://");
        let encoded_retpath = serialized.contains("retpath=https%3A");
        assert!(
            encoded_retpath || unencoded_retpath,
            "serialized retpath missing: {serialized}"
        );
    }

    #[test]
    fn oauth_authorize_url_roundtrip_keeps_redirect_uri() {
        let raw = "https://oauth.yandex.ru/authorize?client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A17248&response_type=code";
        let parsed: Url = raw.parse().unwrap();
        assert_eq!(parsed.host_str(), Some("oauth.yandex.ru"));
        let redirect = parsed
            .query_pairs()
            .find(|(key, _)| key == "redirect_uri")
            .map(|(_, value)| value.into_owned());
        assert_eq!(redirect.as_deref(), Some("http://localhost:17248"));
    }

    #[test]
    fn oauth_navigation_allows_sso_ya_sync_only() {
        let sync: Url = "https://sso.ya.ru/sync?uuid=825def96-4905-46bf-b7f9-4caaae92bcf8&finish=https://id.yandex.ru"
            .parse()
            .unwrap();
        let other_path: Url = "https://sso.ya.ru/prepare".parse().unwrap();
        let http_sync: Url = "http://sso.ya.ru/sync".parse().unwrap();
        let ya_home: Url = "https://ya.ru/".parse().unwrap();
        let passport: Url = "https://passport.yandex.ru/auth".parse().unwrap();
        let sso_passport: Url = "https://sso.passport.yandex.ru/prepare?finish=https://id.yandex.ru"
            .parse()
            .unwrap();
        let id: Url = "https://id.yandex.ru/".parse().unwrap();
        assert!(is_allowed_yandex_oauth_navigation(&sync));
        assert!(!is_allowed_yandex_oauth_navigation(&other_path));
        assert!(!is_allowed_yandex_oauth_navigation(&http_sync));
        assert!(!is_allowed_yandex_oauth_navigation(&ya_home));
        assert!(is_allowed_yandex_oauth_navigation(&passport));
        assert!(is_allowed_yandex_oauth_navigation(&sso_passport));
        assert!(is_allowed_yandex_oauth_navigation(&id));
    }
}
