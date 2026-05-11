use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[derive(Serialize)]
pub struct OAuthResult {
    pub code: Option<String>,
    pub state: String,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

/// Binds to a localhost port for OAuth callback. Tries the given port first,
/// falls back to nearby ports if taken.
#[tauri::command]
pub async fn start_oauth_server(port: u16, state: String) -> Result<OAuthResult, String> {
    // Try the requested port, then a few alternatives. Bind both IPv4 and IPv6
    // loopback where possible: browsers often resolve localhost to ::1 first.
    let mut listeners = None;
    for p in [port, port + 1, port + 2, port + 3] {
        let ipv4 = TcpListener::bind(format!("127.0.0.1:{}", p)).await.ok();
        let ipv6 = TcpListener::bind(format!("[::1]:{}", p)).await.ok();
        if ipv4.is_some() || ipv6.is_some() {
            if let Some(listener) = ipv4.as_ref().or(ipv6.as_ref()) {
                let actual_port = listener
                    .local_addr()
                    .map_err(|e| format!("Failed to get addr: {}", e))?
                    .port();
                listeners = Some((actual_port, ipv4, ipv6));
                break;
            }
        }
    }

    let (actual_port, ipv4_listener, ipv6_listener) =
        listeners.ok_or("Failed to bind to any localhost port")?;

    log::info!("OAuth callback server listening on port {}", actual_port);

    // Wait for exactly one connection (the redirect from Google) with 5-minute timeout
    let mut stream = tokio::time::timeout(
        Duration::from_secs(300),
        accept_oauth_connection(ipv4_listener, ipv6_listener),
    )
        .await
        .map_err(|_| "OAuth timed out — please try again".to_string())?
        .map_err(|e| format!("Failed to accept: {}", e))?;

    // Read the HTTP request
    let mut buf = vec![0u8; 4096];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("Failed to read: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Extract callback payload from GET request line
    let callback = parse_oauth_callback(&request)?;

    // Validate state parameter (CSRF protection)
    if callback.state != state {
        let html = r#"<!DOCTYPE html>
<html>
<head><title>Office360 — Ошибка авторизации</title></head>
<body style="font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #fecaca;">
<div style="text-align: center; max-width: 540px;">
<h1 style="margin-bottom: 8px;">Ошибка авторизации</h1>
<p style="opacity: 0.85;">Не удалось подтвердить состояние авторизации. Закройте вкладку и попробуйте снова из Office360.</p>
</div>
</body>
</html>"#;
        let _ = write_browser_response(&mut stream, html).await;
        return Err("OAuth state mismatch — possible CSRF attack".to_string());
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
        return Ok(OAuthResult {
            code: None,
            state: callback.state,
            error: Some(error.clone()),
            error_description: callback.error_description,
        });
    }

    let code = callback
        .code
        .ok_or_else(|| "No auth code in redirect".to_string())?;

    // Send a success response to the browser
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

    Ok(OAuthResult {
        code: Some(code),
        state: callback.state,
        error: None,
        error_description: None,
    })
}

async fn accept_oauth_connection(
    ipv4_listener: Option<TcpListener>,
    ipv6_listener: Option<TcpListener>,
) -> std::io::Result<TcpStream> {
    match (ipv4_listener, ipv6_listener) {
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
    redirect_uri: String,
    code_verifier: Option<String>,
    client_secret: Option<String>,
    scope: Option<String>,
) -> Result<TokenExchangeResult, String> {
    let mut params = vec![
        ("code", code),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code".to_string()),
    ];
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
