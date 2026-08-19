//! Bounded persistent Telemost lifecycle telemetry.
//! Writes `[telemost-flow]` lines to a dedicated log file so IMAP rotation
//! cannot erase the last WEB CREATE → PREJOIN handoff.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use tauri::{AppHandle, Manager};

const FLOW_FILE: &str = "telemost-flow.log";
const FLOW_PREV: &str = "telemost-flow.log.1";
const MAX_BYTES: u64 = 256 * 1024;

fn short_owner(owner: &str) -> &str {
    let trimmed = owner.trim();
    trimmed.get(..8).unwrap_or(trimmed)
}

pub fn sanitized_url_path(url: &str) -> String {
    let trimmed = url.trim();
    if let Ok(parsed) = tauri::Url::parse(trimmed) {
        return parsed.path().to_string();
    }
    if trimmed.starts_with('/') {
        return trimmed.split(['?', '#']).next().unwrap_or(trimmed).to_string();
    }
    String::new()
}

pub fn conference_id_from_path(path: &str) -> Option<&str> {
    path.strip_prefix("/j/")
        .map(|rest| rest.split(['/', '?', '#']).next().unwrap_or(rest))
        .filter(|id| !id.is_empty())
}

fn format_line(
    transition: &str,
    owner: Option<&str>,
    epoch: Option<u64>,
    conference_id: Option<&str>,
    url_path: Option<&str>,
) -> String {
    let mut line = String::from("[telemost-flow]");
    if let Some(owner) = owner.filter(|value| !value.is_empty()) {
        line.push_str(" owner=");
        line.push_str(short_owner(owner));
    }
    if let Some(epoch) = epoch {
        line.push_str(" epoch=");
        line.push_str(&epoch.to_string());
    }
    line.push_str(" transition=");
    line.push_str(transition);
    if let Some(id) = conference_id.filter(|value| !value.is_empty()) {
        line.push_str(" conference_id=");
        line.push_str(id);
    }
    if let Some(path) = url_path.filter(|value| !value.is_empty()) {
        line.push_str(" url_path=");
        line.push_str(path);
    }
    line
}

fn append_line(dir: &Path, line: &str) {
    let path = dir.join(FLOW_FILE);
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let _ = fs::rename(&path, dir.join(FLOW_PREV));
        }
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

pub fn emit_flow(
    app: &AppHandle,
    transition: &str,
    owner: Option<&str>,
    epoch: Option<u64>,
    conference_id: Option<&str>,
    url_path: Option<&str>,
) {
    let line = format_line(transition, owner, epoch, conference_id, url_path);
    log::info!("{line}");
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = fs::create_dir_all(&dir);
        append_line(&dir, &line);
    }
}

#[tauri::command]
pub fn telemost_flow_log(
    app: AppHandle,
    transition: String,
    owner: Option<String>,
    epoch: Option<u64>,
    conference_id: Option<String>,
    url_path: Option<String>,
) {
    let path = url_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitized_url_path)
        .filter(|value| !value.is_empty());
    let id = conference_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| path.as_deref().and_then(conference_id_from_path));
    emit_flow(
        &app,
        transition.trim(),
        owner.as_deref(),
        epoch,
        id,
        path.as_deref(),
    );
}

#[cfg(test)]
mod tests {
    use super::{conference_id_from_path, format_line, sanitized_url_path};

    #[test]
    fn strips_query_and_extracts_conference_id() {
        let path = sanitized_url_path("https://telemost.yandex.ru/j/98543805636845?browser-auto-create=1");
        assert_eq!(path, "/j/98543805636845");
        assert_eq!(sanitized_url_path("/j/98543805636845?browser-auto-create=1"), "/j/98543805636845");
        assert_eq!(conference_id_from_path(&path), Some("98543805636845"));
        assert!(!path.contains('?'));
        let line = format_line("WEB_CREATED", Some("14cc00df-a949-4b45-9f75-4d71f574c4f1"), Some(1), Some("98543805636845"), Some(&path));
        assert!(line.contains("transition=WEB_CREATED"));
        assert!(line.contains("owner=14cc00df"));
        assert!(line.contains("url_path=/j/98543805636845"));
        assert!(!line.contains("browser-auto-create"));
    }
}
