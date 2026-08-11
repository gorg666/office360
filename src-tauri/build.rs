use std::{collections::HashMap, fs, path::Path};

const MVP_SECRET_FILE: &str = "../.env.mvp.local";
const MVP_SECRET_KEYS: [&str; 4] = [
    "OFFICE360_YANDEX_MVP_CORE_CLIENT_SECRET",
    "OFFICE360_YANDEX_MVP_WORK_CLIENT_SECRET",
    "OFFICE360_YANDEX_MVP_COMMUNICATIONS_CLIENT_SECRET",
    "OFFICE360_YANDEX_MVP_ADMIN_CLIENT_SECRET",
];

fn main() {
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed={MVP_SECRET_FILE}");
    embed_mvp_secrets();
    tauri_build::build()
}

fn embed_mvp_secrets() {
    let values = fs::read_to_string(Path::new(MVP_SECRET_FILE))
        .ok()
        .map(|content| parse_env(&content))
        .unwrap_or_default();

    for key in MVP_SECRET_KEYS {
        let value = std::env::var(key).ok().or_else(|| values.get(key).cloned());
        if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
            println!("cargo:rustc-env={key}={}", value.trim());
        }
    }
}

fn parse_env(content: &str) -> HashMap<String, String> {
    content
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            Some((
                key.trim().to_string(),
                value.trim().trim_matches('"').to_string(),
            ))
        })
        .collect()
}
