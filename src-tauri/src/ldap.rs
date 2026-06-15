use serde::{Deserialize, Serialize};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;
use ldap3::{LdapConnAsync, Scope, SearchEntry};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapTestRequest {
    host: String,
    port: u16,
    security: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapTestResponse {
    success: bool,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapSearchRequest {
    host: String,
    port: u16,
    security: Option<String>,
    bind_dn: Option<String>,
    password: Option<String>,
    base_dn: String,
    filter: String,
    query: String,
    limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapContactResult {
    dn: String,
    display_name: Option<String>,
    email: Option<String>,
    organization: Option<String>,
    title: Option<String>,
}

#[tauri::command]
pub fn ldap_test_connection(request: LdapTestRequest) -> Result<LdapTestResponse, String> {
    let host = request.host.trim();
    if host.is_empty() {
        return Ok(LdapTestResponse {
            success: false,
            message: "LDAP host is required".to_string(),
        });
    }

    let port = if request.port == 0 { 389 } else { request.port };
    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(5_000).clamp(500, 30_000));
    let addr = format!("{host}:{port}");
    let mut addrs = addr
        .to_socket_addrs()
        .map_err(|_| "Unable to resolve LDAP host".to_string())?;
    let Some(socket_addr) = addrs.next() else {
        return Ok(LdapTestResponse {
            success: false,
            message: "Unable to resolve LDAP host".to_string(),
        });
    };

    match TcpStream::connect_timeout(&socket_addr, timeout) {
        Ok(_) => {
            let mode = request.security.unwrap_or_else(|| "plain".to_string());
            Ok(LdapTestResponse {
                success: true,
                message: format!("LDAP endpoint reachable over {mode} on port {port}"),
            })
        }
        Err(err) => Ok(LdapTestResponse {
            success: false,
            message: format!("LDAP endpoint is not reachable: {}", sanitize_error(&err.to_string())),
        }),
    }
}

fn sanitize_error(input: &str) -> String {
    input
        .replace("password", "[redacted]")
        .replace("Password", "[redacted]")
        .chars()
        .take(300)
        .collect()
}

#[tauri::command]
pub async fn ldap_search(request: LdapSearchRequest) -> Result<Vec<LdapContactResult>, String> {
    let host = request.host.trim();
    if host.is_empty() {
        return Err("LDAP host is required".to_string());
    }
    if request.base_dn.trim().is_empty() {
        return Err("LDAP base DN is required".to_string());
    }

    let port = if request.port == 0 { default_port(request.security.as_deref()) } else { request.port };
    let url = match request.security.as_deref() {
        Some("ldaps") => format!("ldaps://{host}:{port}"),
        Some("starttls") => format!("starttls://{host}:{port}"),
        _ => format!("ldap://{host}:{port}"),
    };

    let (conn, mut ldap) = LdapConnAsync::new(&url)
        .await
        .map_err(|err| sanitize_error(&format!("LDAP connection failed: {err}")))?;
    ldap3::drive!(conn);

    if let Some(bind_dn) = request.bind_dn.as_deref().filter(|value| !value.trim().is_empty()) {
        ldap.simple_bind(bind_dn, request.password.as_deref().unwrap_or(""))
            .await
            .map_err(|err| sanitize_error(&format!("LDAP bind failed: {err}")))?
            .success()
            .map_err(|err| sanitize_error(&format!("LDAP bind rejected: {err}")))?;
    }

    let filter = request.filter.replace("{query}", &escape_ldap_filter_value(&request.query));
    let attrs = vec!["cn", "displayName", "mail", "o", "company", "title"];
    let (entries, _result) = ldap
        .search(
            request.base_dn.as_str(),
            Scope::Subtree,
            filter.as_str(),
            attrs,
        )
        .await
        .map_err(|err| sanitize_error(&format!("LDAP search failed: {err}")))?
        .success()
        .map_err(|err| sanitize_error(&format!("LDAP search rejected: {err}")))?;

    let limit = request.limit.unwrap_or(25).min(100) as usize;
    let results = entries
        .into_iter()
        .take(limit)
        .map(SearchEntry::construct)
        .map(|entry| LdapContactResult {
            dn: entry.dn,
            display_name: first_attr(&entry.attrs, &["displayName", "cn"]),
            email: first_attr(&entry.attrs, &["mail"]),
            organization: first_attr(&entry.attrs, &["o", "company"]),
            title: first_attr(&entry.attrs, &["title"]),
        })
        .filter(|entry| entry.email.is_some() || entry.display_name.is_some())
        .collect();

    let _ = ldap.unbind().await;
    Ok(results)
}

fn default_port(security: Option<&str>) -> u16 {
    if security == Some("ldaps") {
        636
    } else {
        389
    }
}

fn first_attr(attrs: &std::collections::HashMap<String, Vec<String>>, names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(values) = attrs.get(*name) {
            if let Some(value) = values.iter().find(|value| !value.trim().is_empty()) {
                return Some(value.chars().take(300).collect());
            }
        }
    }
    None
}

fn escape_ldap_filter_value(value: &str) -> String {
    value
        .replace('\\', "\\5c")
        .replace('*', "\\2a")
        .replace('(', "\\28")
        .replace(')', "\\29")
        .replace('\0', "\\00")
}
