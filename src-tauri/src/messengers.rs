use native_tls::{TlsConnector, TlsStream};
use serde::Deserialize;
use serde_json::{json, Map, Number, Value};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream as StdTcpStream;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::OnceLock;
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::Duration;

const MAX_PLATFORM_API_URL: &str = "https://platform-api.max.ru";
const MAX_CLIENT_SOCKET_HOST: &str = "api.oneme.ru";
const MAX_CLIENT_SOCKET_PORT: u16 = 443;
const MAX_CLIENT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const YANDEX_BOT_API_URL: &str = "https://botapi.messenger.yandex.net/bot/v1";

const OPCODE_HEARTBEAT: u64 = 1;
const OPCODE_HANDSHAKE: u64 = 6;
const OPCODE_SEND_VERIFY_CODE: u64 = 17;
const OPCODE_CHECK_VERIFY_CODE: u64 = 18;
const OPCODE_AUTHENTICATE: u64 = 19;
const OPCODE_AUTH_CONFIRM: u64 = 23;
const OPCODE_GET_CONTACT_DETAILS: u64 = 32;
const OPCODE_GET_HISTORY: u64 = 49;
const OPCODE_MARK_AS_READ: u64 = 50;
const OPCODE_SEND_MESSAGE: u64 = 64;
const OPCODE_SUBSCRIBE_TO_CHAT: u64 = 75;
const OPCODE_PHOTO_UPLOAD: u64 = 80;
const OPCODE_VIDEO_UPLOAD: u64 = 82;
const OPCODE_FILE_UPLOAD: u64 = 87;
const OPCODE_AUTH_LOGIN_CHECK_PASSWORD: u64 = 115;

static MAX_CLIENT_TASK: OnceLock<Mutex<Option<JoinHandle<()>>>> = OnceLock::new();

struct MaxSocket {
    stream: TlsStream<StdTcpStream>,
    seq: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaxClientAttachmentUpload {
    path: String,
    kind: String,
    name: Option<String>,
    mime_type: Option<String>,
}

#[tauri::command]
pub async fn messenger_request(
    provider: String,
    token: String,
    method: String,
    path: String,
    query: Option<Vec<(String, String)>>,
    body: Option<Value>,
) -> Result<Value, String> {
    let (base_url, authorization) = match provider.as_str() {
        "max" => (MAX_PLATFORM_API_URL, token),
        "yandex" => (YANDEX_BOT_API_URL, format!("OAuth {token}")),
        other => return Err(format!("Unsupported messenger provider: {other}")),
    };

    let normalized_path = if path.starts_with('/') {
        path
    } else {
        format!("/{path}")
    };
    let url = format!("{base_url}{normalized_path}");

    let method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        other => return Err(format!("Unsupported messenger API method: {other}")),
    };

    let client = reqwest::Client::new();
    let mut request = client
        .request(method, url)
        .header("Authorization", authorization)
        .header("Content-Type", "application/json");

    if let Some(query) = query {
        request = request.query(&query);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    let parsed = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str::<Value>(&text).unwrap_or_else(|_| Value::String(text.clone()))
    };

    if !status.is_success() {
        return Err(format_api_error(status.as_u16(), parsed));
    }

    Ok(parsed)
}

#[tauri::command]
pub async fn max_client_start_auth(phone: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut socket = connect_max_socket()?;
        handshake_max_socket(&mut socket)?;
        send_max_socket_command(
            &mut socket,
            OPCODE_SEND_VERIFY_CODE,
            json!({
                "phone": phone,
                "type": "START_AUTH",
                "language": "ru"
            }),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn max_client_check_code(auth_token: String, code: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut socket = connect_max_socket()?;
        handshake_max_socket(&mut socket)?;
        let response = send_max_socket_command(
            &mut socket,
            OPCODE_CHECK_VERIFY_CODE,
            json!({
                "token": auth_token,
                "verifyCode": code,
                "authTokenType": "CHECK_CODE"
            }),
        )?;

        if let Some(error) = response
            .get("payload")
            .and_then(|payload| payload.get("error"))
        {
            return Err(format!("MAX auth error: {error}"));
        }

        if response
            .get("payload")
            .and_then(|payload| payload.get("passwordChallenge"))
            .is_some()
        {
            return Ok(json!({
                "auth": response,
                "needsPassword": true,
                "passwordChallenge": response.get("payload").and_then(|payload| payload.get("passwordChallenge")).cloned()
            }));
        }

        if let Some(login_token) = extract_max_login_token(&response) {
            let session = authenticate_max_socket(&mut socket, &login_token)?;
            return Ok(json!({
                "auth": response,
                "token": login_token,
                "session": session
            }));
        }

        if let Some(register_token) = response
            .get("payload")
            .and_then(|payload| payload.get("tokenAttrs"))
            .and_then(|attrs| attrs.get("REGISTER"))
            .and_then(|register| register.get("token"))
            .and_then(Value::as_str)
        {
            return Ok(json!({
                "auth": response,
                "needsRegistration": true,
                "registrationToken": register_token
            }));
        }

        Ok(json!({
            "auth": response,
            "missingToken": true
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn max_client_check_password(
    track_id: String,
    password: String,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut socket = connect_max_socket()?;
        handshake_max_socket(&mut socket)?;
        let response = send_max_socket_command(
            &mut socket,
            OPCODE_AUTH_LOGIN_CHECK_PASSWORD,
            json!({
                "trackId": track_id,
                "password": password
            }),
        )?;

        if let Some(error) = response
            .get("payload")
            .and_then(|payload| payload.get("error"))
        {
            return Err(format!("MAX password error: {error}"));
        }

        let token = extract_max_login_token(&response)
            .ok_or_else(|| format!("MAX password check did not return login token: {response}"))?;
        let session = authenticate_max_socket(&mut socket, &token)?;

        Ok(json!({
            "auth": response,
            "token": token,
            "session": session
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn max_client_complete_registration(
    registration_token: String,
    first_name: String,
    last_name: Option<String>,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut socket = connect_max_socket()?;
        handshake_max_socket(&mut socket)?;
        let response = send_max_socket_command(
            &mut socket,
            OPCODE_AUTH_CONFIRM,
            json!({
                "firstName": first_name,
                "lastName": last_name,
                "token": registration_token,
                "tokenType": "REGISTER"
            }),
        )?;

        if let Some(error) = response
            .get("payload")
            .and_then(|payload| payload.get("error"))
        {
            return Err(format!("MAX registration error: {error}"));
        }

        let token = response
            .get("payload")
            .and_then(|payload| payload.get("token"))
            .and_then(Value::as_str)
            .ok_or_else(|| format!("MAX registration did not return token: {response}"))?
            .to_owned();
        let session = authenticate_max_socket(&mut socket, &token)?;

        Ok(json!({
            "auth": response,
            "token": token,
            "session": session
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn max_client_get_session(token: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut socket = connect_max_socket()?;
        handshake_max_socket(&mut socket)?;
        authenticate_max_socket(&mut socket, &token)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn max_client_get_history(
    token: String,
    chat_id: String,
    count: Option<u64>,
    from_timestamp: Option<i64>,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut socket = connect_max_socket()?;
        handshake_max_socket(&mut socket)?;
        authenticate_max_socket(&mut socket, &token)?;
        send_max_socket_command(
            &mut socket,
            OPCODE_GET_HISTORY,
            json!({
                "chatId": parse_i64(&chat_id, "chat_id")?,
                "from": from_timestamp.unwrap_or_else(current_millis),
                "forward": 0,
                "backward": count.unwrap_or(50),
                "getMessages": true
            }),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn max_client_send_message(
    token: String,
    chat_id: String,
    text: String,
    reply_id: Option<String>,
    attachments: Option<Vec<MaxClientAttachmentUpload>>,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut socket = connect_max_socket()?;
        handshake_max_socket(&mut socket)?;
        authenticate_max_socket(&mut socket, &token)?;

        let mut attaches = Vec::new();
        for attachment in attachments.unwrap_or_default() {
            attaches.push(upload_max_client_attachment(&mut socket, attachment)?);
        }

        let mut message = json!({
            "text": text,
            "cid": current_millis(),
            "elements": [],
            "attaches": attaches
        });
        if let Some(reply_id) = reply_id.filter(|value| !value.trim().is_empty()) {
            message["link"] = json!({
                "type": "REPLY",
                "messageId": parse_i64(&reply_id, "reply_id")?
            });
        }

        send_max_socket_command(
            &mut socket,
            OPCODE_SEND_MESSAGE,
            json!({
                "chatId": parse_i64(&chat_id, "chat_id")?,
                "message": message,
                "notify": true
            }),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn max_client_mark_as_read(
    token: String,
    chat_id: String,
    message_id: String,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut socket = connect_max_socket()?;
        handshake_max_socket(&mut socket)?;
        authenticate_max_socket(&mut socket, &token)?;
        send_max_socket_command(
            &mut socket,
            OPCODE_MARK_AS_READ,
            json!({
                "type": "READ_MESSAGE",
                "chatId": parse_i64(&chat_id, "chat_id")?,
                "messageId": message_id,
                "mark": current_millis()
            }),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn max_client_connect(app: tauri::AppHandle, token: String) -> Result<Value, String> {
    max_client_disconnect().await?;

    let (session, socket) = tokio::task::spawn_blocking(move || {
        let mut socket = connect_max_socket()?;
        handshake_max_socket(&mut socket)?;
        let session = authenticate_max_socket(&mut socket, &token)?;

        for chat_id in session
            .get("chats")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|chat| chat.get("id").and_then(Value::as_i64))
        {
            let _ = send_max_socket_command(
                &mut socket,
                OPCODE_SUBSCRIBE_TO_CHAT,
                json!({
                    "chatId": chat_id,
                    "subscribe": true
                }),
            );
        }

        Ok::<_, String>((session, socket))
    })
    .await
    .map_err(|error| error.to_string())??;

    let handle = tokio::task::spawn_blocking(move || run_max_socket_events(app, socket));

    let state = MAX_CLIENT_TASK.get_or_init(|| Mutex::new(None));
    *state.lock().await = Some(handle);
    Ok(session)
}

#[tauri::command]
pub async fn max_client_disconnect() -> Result<(), String> {
    let state = MAX_CLIENT_TASK.get_or_init(|| Mutex::new(None));
    if let Some(handle) = state.lock().await.take() {
        handle.abort();
    }
    Ok(())
}

fn connect_max_socket() -> Result<MaxSocket, String> {
    let tcp = StdTcpStream::connect((MAX_CLIENT_SOCKET_HOST, MAX_CLIENT_SOCKET_PORT))
        .map_err(|error| format!("MAX socket connection failed: {error}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| error.to_string())?;
    tcp.set_write_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| error.to_string())?;
    let connector = TlsConnector::new().map_err(|error| error.to_string())?;
    let stream = connector
        .connect(MAX_CLIENT_SOCKET_HOST, tcp)
        .map_err(|error| format!("MAX TLS connection failed: {error}"))?;

    Ok(MaxSocket { stream, seq: 0 })
}

fn handshake_max_socket(socket: &mut MaxSocket) -> Result<Value, String> {
    send_max_socket_command(
        socket,
        OPCODE_HANDSHAKE,
        json!({
            "deviceId": "velo-desktop",
            "userAgent": max_user_agent()
        }),
    )
    .map(|_| Value::Null)
}

fn authenticate_max_socket(socket: &mut MaxSocket, token: &str) -> Result<Value, String> {
    let response = send_max_socket_command(
        socket,
        OPCODE_AUTHENTICATE,
        json!({
            "interactive": true,
            "token": token,
            "chatsSync": 0,
            "contactsSync": 0,
            "presenceSync": 0,
            "draftsSync": 0,
            "chatsCount": 100,
            "userAgent": max_user_agent()
        }),
    )?;

    let mut payload = response.get("payload").cloned().unwrap_or(Value::Null);
    if let Some(error) = payload.get("error") {
        return Err(format!("MAX auth error: {error}"));
    }
    enrich_max_session_contacts(socket, &mut payload);
    Ok(payload)
}

fn enrich_max_session_contacts(socket: &mut MaxSocket, payload: &mut Value) {
    let contact_ids = collect_max_session_contact_ids(payload);
    if contact_ids.is_empty() {
        return;
    }

    let Ok(response) = send_max_socket_command(
        socket,
        OPCODE_GET_CONTACT_DETAILS,
        json!({ "contactIds": contact_ids }),
    ) else {
        return;
    };

    let Some(contacts) = response
        .get("payload")
        .and_then(|payload| payload.get("contacts"))
        .cloned()
    else {
        return;
    };

    if let Value::Object(payload_object) = payload {
        payload_object.insert("contacts".to_string(), contacts);
    }
}

fn collect_max_session_contact_ids(payload: &Value) -> Vec<i64> {
    let mut ids = std::collections::BTreeSet::new();
    let profile_id = payload
        .get("profile")
        .and_then(|profile| profile.get("contact"))
        .and_then(|contact| contact.get("id"))
        .and_then(Value::as_i64);

    if let Some(chats) = payload.get("chats").and_then(Value::as_array) {
        for chat in chats {
            if let Some(owner) = chat.get("owner").and_then(Value::as_i64) {
                ids.insert(owner);
            }

            if let Some(sender) = chat
                .get("lastMessage")
                .and_then(|message| message.get("sender"))
                .and_then(Value::as_i64)
            {
                ids.insert(sender);
            }

            match chat.get("participants") {
                Some(Value::Object(participants)) => {
                    for key in participants.keys() {
                        if let Ok(id) = key.parse::<i64>() {
                            ids.insert(id);
                        }
                    }
                }
                Some(Value::Array(participants)) => {
                    for participant in participants {
                        if let Some(id) = participant.as_i64() {
                            ids.insert(id);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    if let Some(profile_id) = profile_id {
        ids.remove(&profile_id);
    }

    ids.into_iter().take(500).collect()
}

fn send_max_socket_command(
    socket: &mut MaxSocket,
    opcode: u64,
    payload: Value,
) -> Result<Value, String> {
    let seq = next_socket_seq(socket);
    let packet = pack_max_socket_packet(11, 0, seq, opcode, &payload)?;
    socket
        .stream
        .write_all(&packet)
        .map_err(|error| error.to_string())?;
    socket.stream.flush().map_err(|error| error.to_string())?;

    loop {
        let response = read_max_socket_packet(&mut socket.stream)?;
        if response.get("cmd").and_then(Value::as_u64) == Some(3) {
            return Err(format!("MAX API error: {response}"));
        }
        if response.get("seq").and_then(Value::as_u64) == Some(seq % 256) {
            return Ok(normalize_max_socket_response(response));
        }
    }
}

fn upload_max_client_attachment(
    socket: &mut MaxSocket,
    attachment: MaxClientAttachmentUpload,
) -> Result<Value, String> {
    let path = Path::new(&attachment.path);
    let file_name = attachment
        .name
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            path.file_name()
                .map(|value| value.to_string_lossy().into_owned())
        })
        .ok_or_else(|| "Не удалось определить имя файла MAX.".to_string())?;
    let mime_type = attachment
        .mime_type
        .unwrap_or_else(|| infer_mime_type(&file_name));
    let file_bytes = fs::read(path)
        .map_err(|error| format!("Не удалось прочитать файл {file_name}: {error}"))?;
    let file_len = file_bytes.len();
    if file_len == 0 {
        return Err(format!("Файл {file_name} пустой."));
    }

    match attachment.kind.as_str() {
        "photo" => upload_max_photo(socket, file_bytes, file_name, mime_type),
        "video" => upload_max_binary_attachment(
            socket,
            OPCODE_VIDEO_UPLOAD,
            file_bytes,
            file_name,
            "videoId",
            |id, token| {
                Ok(json!({
                    "_type": "VIDEO",
                    "videoId": id,
                    "token": token.ok_or_else(|| "MAX не вернул token видео.".to_string())?
                }))
            },
        ),
        _ => upload_max_binary_attachment(
            socket,
            OPCODE_FILE_UPLOAD,
            file_bytes,
            file_name,
            "fileId",
            |id, _| {
                Ok(json!({
                    "_type": "FILE",
                    "fileId": id
                }))
            },
        ),
    }
}

fn upload_max_photo(
    socket: &mut MaxSocket,
    file_bytes: Vec<u8>,
    file_name: String,
    mime_type: String,
) -> Result<Value, String> {
    let upload = send_max_socket_command(
        socket,
        OPCODE_PHOTO_UPLOAD,
        json!({
            "count": 1,
            "profile": false
        }),
    )?;
    let url = upload
        .get("payload")
        .and_then(|payload| payload.get("url"))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("MAX не вернул URL загрузки фото: {upload}"))?;

    let part = reqwest::blocking::multipart::Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str(&mime_type)
        .map_err(|error| error.to_string())?;
    let form = reqwest::blocking::multipart::Form::new().part("file", part);
    let response = reqwest::blocking::Client::new()
        .post(url)
        .multipart(form)
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("MAX отклонил загрузку фото: {}", response.status()));
    }
    let payload = response
        .json::<Value>()
        .map_err(|error| error.to_string())?;
    let token = payload
        .get("photos")
        .and_then(Value::as_object)
        .and_then(|photos| photos.values().find_map(|photo| photo.get("token")))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("MAX не вернул token фото: {payload}"))?;

    Ok(json!({
        "_type": "PHOTO",
        "photoToken": token
    }))
}

fn upload_max_binary_attachment<F>(
    socket: &mut MaxSocket,
    opcode: u64,
    file_bytes: Vec<u8>,
    file_name: String,
    id_key: &str,
    build_attach: F,
) -> Result<Value, String>
where
    F: FnOnce(Value, Option<Value>) -> Result<Value, String>,
{
    let upload = send_max_socket_command(
        socket,
        opcode,
        json!({
            "count": 1,
            "profile": false
        }),
    )?;
    let info = upload
        .get("payload")
        .and_then(|payload| payload.get("info"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .ok_or_else(|| format!("MAX не вернул info для загрузки: {upload}"))?;
    let url = info
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("MAX не вернул URL загрузки: {upload}"))?;
    let id = info
        .get(id_key)
        .cloned()
        .ok_or_else(|| format!("MAX не вернул {id_key}: {upload}"))?;
    let token = info.get("token").cloned();
    let file_len = file_bytes.len();
    let response = reqwest::blocking::Client::new()
        .post(url)
        .header(
            "Content-Disposition",
            format!("attachment; filename={file_name}"),
        )
        .header("Content-Length", file_len.to_string())
        .header("Content-Range", format!("0-{}/{}", file_len - 1, file_len))
        .body(file_bytes)
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "MAX отклонил загрузку файла: {}",
            response.status()
        ));
    }

    build_attach(id, token)
}

fn infer_mime_type(file_name: &str) -> String {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn normalize_max_socket_response(mut response: Value) -> Value {
    let Some(payload) = response.get("payload").cloned() else {
        return response;
    };

    if let Value::Array(items) = payload {
        if let Some(item) = items
            .iter()
            .find(|item| {
                item.get("token").is_some()
                    || item.get("tokenAttrs").is_some()
                    || item.get("passwordChallenge").is_some()
                    || item.get("error").is_some()
            })
            .cloned()
            .or_else(|| items.first().cloned())
        {
            response["payload"] = item;
        }
    }

    response
}

fn extract_max_login_token(response: &Value) -> Option<String> {
    let attrs = response
        .get("payload")
        .and_then(|payload| payload.get("tokenAttrs"))
        .and_then(Value::as_object)?;

    if let Some(token) = attrs
        .get("LOGIN")
        .and_then(|login| login.get("token"))
        .and_then(Value::as_str)
    {
        return Some(token.to_owned());
    }

    attrs
        .iter()
        .filter(|(kind, _)| kind.as_str() != "REGISTER")
        .find_map(|(_, value)| {
            value
                .get("token")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
}

fn run_max_socket_events(app: tauri::AppHandle, mut socket: MaxSocket) {
    let _ = socket
        .stream
        .get_ref()
        .set_read_timeout(Some(Duration::from_secs(1)));
    let mut last_ping = std::time::Instant::now();

    loop {
        if last_ping.elapsed() >= Duration::from_secs(30) {
            if send_max_socket_command(
                &mut socket,
                OPCODE_HEARTBEAT,
                json!({ "interactive": true }),
            )
            .is_err()
            {
                let _ = app.emit(
                    "max-client-disconnected",
                    json!({ "reason": "heartbeat_failed" }),
                );
                break;
            }
            last_ping = std::time::Instant::now();
        }

        match read_max_socket_packet(&mut socket.stream) {
            Ok(data) => {
                if data.get("cmd").and_then(Value::as_u64) == Some(0) {
                    let _ = app.emit("max-client-event", data);
                }
            }
            Err(error) if error.contains("timed out") || error.contains("WouldBlock") => {}
            Err(error) => {
                let _ = app.emit("max-client-disconnected", json!({ "reason": error }));
                break;
            }
        }
    }
}

fn pack_max_socket_packet(
    ver: u8,
    cmd: u16,
    seq: u64,
    opcode: u64,
    payload: &Value,
) -> Result<Vec<u8>, String> {
    let payload_bytes = rmp_serde::to_vec(payload).map_err(|error| error.to_string())?;
    if payload_bytes.len() > 0xFF_FFFF {
        return Err("MAX socket payload is too large".to_string());
    }

    let mut packet = Vec::with_capacity(10 + payload_bytes.len());
    packet.push(ver);
    packet.extend_from_slice(&cmd.to_be_bytes());
    packet.push((seq % 256) as u8);
    packet.extend_from_slice(&(opcode as u16).to_be_bytes());
    packet.extend_from_slice(&(payload_bytes.len() as u32).to_be_bytes());
    packet.extend_from_slice(&payload_bytes);
    Ok(packet)
}

fn read_max_socket_packet(stream: &mut TlsStream<StdTcpStream>) -> Result<Value, String> {
    let mut header = [0_u8; 10];
    stream
        .read_exact(&mut header)
        .map_err(|error| error.to_string())?;

    let ver = header[0];
    let cmd = u16::from_be_bytes([header[1], header[2]]) as u64;
    let seq = header[3] as u64;
    let opcode = u16::from_be_bytes([header[4], header[5]]) as u64;
    let packed_len = u32::from_be_bytes([header[6], header[7], header[8], header[9]]);
    let compression_flag = packed_len >> 24;
    let payload_len = (packed_len & 0xFF_FFFF) as usize;

    let mut payload_bytes = vec![0_u8; payload_len];
    if payload_len > 0 {
        stream
            .read_exact(&mut payload_bytes)
            .map_err(|error| error.to_string())?;
    }

    if compression_flag != 0 && !payload_bytes.is_empty() {
        payload_bytes = decompress_max_payload(&payload_bytes)?;
    }

    let payload = if payload_bytes.is_empty() {
        Value::Null
    } else {
        let rmp_value =
            rmpv::decode::read_value(&mut &payload_bytes[..]).map_err(|error| error.to_string())?;
        rmp_to_json(rmp_value)
    };

    Ok(json!({
        "ver": ver,
        "cmd": cmd,
        "seq": seq,
        "opcode": opcode,
        "payload": payload
    }))
}

fn rmp_to_json(value: rmpv::Value) -> Value {
    match value {
        rmpv::Value::Nil => Value::Null,
        rmpv::Value::Boolean(value) => Value::Bool(value),
        rmpv::Value::Integer(value) => {
            if let Some(value) = value.as_i64() {
                Value::Number(Number::from(value))
            } else if let Some(value) = value.as_u64() {
                Value::Number(Number::from(value))
            } else {
                Value::String(value.to_string())
            }
        }
        rmpv::Value::F32(value) => Number::from_f64(value as f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        rmpv::Value::F64(value) => Number::from_f64(value)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        rmpv::Value::String(value) => Value::String(
            value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string()),
        ),
        rmpv::Value::Binary(value) => Value::Array(
            value
                .into_iter()
                .map(|byte| Value::Number(Number::from(byte)))
                .collect(),
        ),
        rmpv::Value::Array(values) => Value::Array(values.into_iter().map(rmp_to_json).collect()),
        rmpv::Value::Map(entries) => {
            let mut object = Map::new();
            for (key, value) in entries {
                object.insert(rmp_key_to_string(key), rmp_to_json(value));
            }
            Value::Object(object)
        }
        rmpv::Value::Ext(kind, value) => json!({
            "_type": "ext",
            "kind": kind,
            "data": value
        }),
    }
}

fn rmp_key_to_string(key: rmpv::Value) -> String {
    match key {
        rmpv::Value::String(value) => value
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| value.to_string()),
        rmpv::Value::Integer(value) => value.to_string(),
        rmpv::Value::Boolean(value) => value.to_string(),
        other => rmp_to_json(other).to_string(),
    }
}

fn decompress_max_payload(payload_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut last_error = "unknown LZ4 decode error".to_string();
    let min_size = payload_bytes.len().saturating_mul(64).max(99_999);
    let sizes = [
        min_size,
        256 * 1024,
        1024 * 1024,
        4 * 1024 * 1024,
        16 * 1024 * 1024,
    ];

    for size in sizes {
        let mut decompressed = vec![0_u8; size];
        let result = catch_unwind(AssertUnwindSafe(|| {
            lz4_flex::block::decompress_into(payload_bytes, &mut decompressed)
        }));

        match result {
            Ok(Ok(decoded_len)) => {
                decompressed.truncate(decoded_len);
                return Ok(decompressed);
            }
            Ok(Err(error)) => {
                last_error = error.to_string();
            }
            Err(_) => {
                last_error = format!("LZ4 decoder panicked with destination buffer size {size}");
            }
        }
    }

    Err(format!(
        "MAX compressed payload decode failed: {last_error}"
    ))
}

fn next_socket_seq(socket: &mut MaxSocket) -> u64 {
    socket.seq += 1;
    socket.seq
}

fn max_user_agent() -> Value {
    json!({
        "deviceType": "DESKTOP",
        "locale": "ru",
        "deviceLocale": "ru",
        "osVersion": "Windows 11",
        "deviceName": "Chrome",
        "headerUserAgent": MAX_CLIENT_USER_AGENT,
        "appVersion": "25.12.14",
        "screen": "1080x1920 1.0x",
        "timezone": "Europe/Moscow",
        "clientSessionId": 7,
        "buildNumber": 38859
    })
}

fn current_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_i64(value: &str, label: &str) -> Result<i64, String> {
    value
        .trim()
        .parse::<i64>()
        .map_err(|_| format!("{label} must be a number"))
}

fn format_api_error(status: u16, parsed: Value) -> String {
    let message = parsed
        .get("description")
        .and_then(Value::as_str)
        .or_else(|| parsed.get("message").and_then(Value::as_str))
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if parsed.is_string() {
                parsed.as_str().unwrap_or_default().to_string()
            } else {
                parsed.to_string()
            }
        });

    match status {
        401 | 403 => format!("{status}: token неверный или недостаточно прав. {message}"),
        404 => format!("{status}: endpoint или чат не найден. {message}"),
        _ => format!("{status}: {message}"),
    }
}
