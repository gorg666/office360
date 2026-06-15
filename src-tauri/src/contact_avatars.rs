use base64::{engine::general_purpose, Engine as _};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const AVATAR_DIR: &str = "contact-avatars";
const MAX_AVATAR_BYTES: usize = 2 * 1024 * 1024;

fn avatar_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(AVATAR_DIR))
        .map_err(|error| error.to_string())
}

fn parse_data_url(data_url: &str) -> Result<(&str, &str), String> {
    let (header, payload) = data_url
        .split_once(',')
        .ok_or_else(|| "Invalid avatar data URL".to_string())?;
    let mime = header
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .ok_or_else(|| "Avatar data URL must be base64 encoded".to_string())?;
    Ok((mime, payload))
}

fn avatar_extension(mime: &str) -> Result<&'static str, String> {
    match mime {
        "image/jpeg" | "image/jpg" => Ok("jpg"),
        "image/png" => Ok("png"),
        "image/webp" => Ok("webp"),
        _ => Err("Unsupported avatar image type".to_string()),
    }
}

#[tauri::command]
pub fn save_contact_avatar(app: tauri::AppHandle, data_url: String) -> Result<String, String> {
    let (mime, payload) = parse_data_url(&data_url)?;
    let extension = avatar_extension(mime)?;
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("Avatar image is empty".to_string());
    }
    if bytes.len() > MAX_AVATAR_BYTES {
        return Err("Avatar image is too large".to_string());
    }

    let dir = avatar_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let path = dir.join(format!("avatar-{}-{}.{}", std::process::id(), now, extension));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_contact_avatar(app: tauri::AppHandle, avatar_url: String) -> Result<(), String> {
    let candidate = PathBuf::from(avatar_url);
    if !candidate.is_absolute() {
        return Ok(());
    }

    let dir = avatar_dir(&app)?;
    let Ok(canonical_dir) = dir.canonicalize() else {
        return Ok(());
    };
    let Ok(canonical_candidate) = candidate.canonicalize() else {
        return Ok(());
    };
    if !canonical_candidate.starts_with(canonical_dir) {
        return Ok(());
    }

    match fs::remove_file(canonical_candidate) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
