use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use lettre::{
    transport::smtp::{
        authentication::{Credentials, Mechanism},
        client::{Tls, TlsParametersBuilder},
    },
    AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
};

use super::types::{SmtpConfig, SmtpSendResult};

/// Hard cap for SMTP verify — without this, TCP/TLS/auth can hang indefinitely in the UI.
const SMTP_TEST_TIMEOUT: Duration = Duration::from_secs(35);

/// Hard cap for SMTP send — auth/TLS hangs must surface as errors, not silent UI.
const SMTP_SEND_TIMEOUT: Duration = Duration::from_secs(45);

/// Decode a base64url-encoded string (Gmail format) to raw bytes.
fn decode_base64url(input: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(input)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

/// Pick a reachable IP with Happy Eyeballs, then let lettre connect to that
/// literal while keeping the original hostname for TLS SNI/cert checks.
///
/// This avoids lettre hanging on a broken IPv6 AAAA record for the full SMTP timeout.
async fn build_transport(config: &SmtpConfig) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let reachable = crate::mail_tcp::connect_tcp(&config.host, config.port, Duration::from_secs(15)).await?;
    let tcp_host = crate::mail_tcp::addr_to_literal(reachable.addr);
    log::info!(
        target: "app.smtp",
        "[mail-tcp] smtp endpoint host={} port={} family={} implicit_tls={}",
        config.host,
        config.port,
        crate::mail_tcp::ip_family(reachable.addr),
        config.security == "tls"
    );
    drop(reachable.stream);
    build_transport_to_endpoint(config, &tcp_host)
}

fn smtp_tls_parameters(config: &SmtpConfig) -> Result<lettre::transport::smtp::client::TlsParameters, String> {
    let mut builder = TlsParametersBuilder::new(config.host.clone());
    if config.accept_invalid_certs {
        builder = builder
            .dangerous_accept_invalid_certs(true)
            .dangerous_accept_invalid_hostnames(true);
    }
    builder
        .build()
        .map_err(|e| format!("SMTP TLS params error: {}", e))
}

fn build_transport_to_endpoint(
    config: &SmtpConfig,
    tcp_host: &str,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let credentials = Credentials::new(config.username.clone(), config.password.clone());
    let auth_mechanisms = if config.auth_method == "oauth2" {
        vec![Mechanism::Xoauth2]
    } else {
        vec![Mechanism::Plain, Mechanism::Login]
    };
    let tls_params = smtp_tls_parameters(config)?;

    let transport = match config.security.as_str() {
        "tls" => {
            // Implicit TLS (Yandex: 465). Do not use STARTTLS on this port.
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(tcp_host)
                .port(config.port)
                .tls(Tls::Wrapper(tls_params))
                .credentials(credentials)
                .authentication(auth_mechanisms)
                .build()
        }
        "starttls" => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(tcp_host)
            .port(config.port)
            .tls(Tls::Required(tls_params))
            .credentials(credentials)
            .authentication(auth_mechanisms)
            .build(),
        _ => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(tcp_host)
            .port(config.port)
            .tls(Tls::None)
            .credentials(credentials)
            .authentication(auth_mechanisms)
            .build(),
    };

    Ok(transport)
}

/// Extract an SMTP envelope (sender + recipients) from raw RFC 2822 bytes.
///
/// The envelope tells the SMTP server who the mail is from and who to deliver
/// it to, which is separate from the header fields visible to the recipient.
fn extract_envelope(raw: &[u8]) -> Result<lettre::address::Envelope, String> {
    let message = mail_parser::MessageParser::default()
        .parse(raw)
        .ok_or("Failed to parse email for envelope extraction")?;

    // Extract From address
    let from = message
        .from()
        .and_then(|list| list.first())
        .and_then(|addr| addr.address())
        .ok_or("No From address found in email")?;

    let from_addr: lettre::Address = from
        .parse()
        .map_err(|e| format!("Invalid From address '{}': {}", from, e))?;

    // Collect all recipient addresses (To, Cc, Bcc)
    let mut recipients: Vec<lettre::Address> = Vec::new();

    if let Some(to_list) = message.to() {
        for addr in to_list.iter() {
            if let Some(email) = addr.address() {
                if let Ok(a) = email.parse::<lettre::Address>() {
                    recipients.push(a);
                }
            }
        }
    }

    if let Some(cc_list) = message.cc() {
        for addr in cc_list.iter() {
            if let Some(email) = addr.address() {
                if let Ok(a) = email.parse::<lettre::Address>() {
                    recipients.push(a);
                }
            }
        }
    }

    if let Some(bcc_list) = message.bcc() {
        for addr in bcc_list.iter() {
            if let Some(email) = addr.address() {
                if let Ok(a) = email.parse::<lettre::Address>() {
                    recipients.push(a);
                }
            }
        }
    }

    if recipients.is_empty() {
        return Err("No recipients found in email".to_string());
    }

    lettre::address::Envelope::new(Some(from_addr), recipients)
        .map_err(|e| format!("Envelope error: {}", e))
}

/// Send a pre-built RFC 2822 email via SMTP.
///
/// The `raw_email_base64url` parameter is the full email message encoded as
/// base64url (the same encoding Gmail uses: `+` → `-`, `/` → `_`, no padding).
/// The function decodes it, extracts the envelope from headers, and sends it.
pub async fn send_raw_email(
    config: &SmtpConfig,
    raw_email_base64url: &str,
) -> Result<SmtpSendResult, String> {
    let raw_bytes = decode_base64url(raw_email_base64url)?;
    let envelope = extract_envelope(&raw_bytes)?;
    let transport = build_transport(config).await?;

    let outcome = tokio::time::timeout(
        SMTP_SEND_TIMEOUT,
        transport.send_raw(&envelope, &raw_bytes),
    )
    .await;

    match outcome {
        Err(_) => Err(format!(
            "SMTP send timed out after {} seconds. Check server, auth, and network.",
            SMTP_SEND_TIMEOUT.as_secs()
        )),
        Ok(result) => result
            .map(|_response| SmtpSendResult {
                success: true,
                message: "Письмо отправлено".to_string(),
            })
            .map_err(|e| format!("SMTP send error: {}", e)),
    }
}

/// Test SMTP connectivity by connecting, authenticating, and disconnecting.
pub async fn test_connection(config: &SmtpConfig) -> Result<SmtpSendResult, String> {
    log::info!(
        target: "app.smtp",
        "smtp_test_connection start host={} port={} security={} auth_method={} username_len={} accept_invalid_certs={}",
        config.host,
        config.port,
        config.security,
        config.auth_method,
        config.username.len(),
        config.accept_invalid_certs
    );
    let started = Instant::now();
    let transport = build_transport(config).await?;

    let outcome = tokio::time::timeout(SMTP_TEST_TIMEOUT, transport.test_connection()).await;

    let elapsed_ms = started.elapsed().as_millis();
    match outcome {
        Err(_) => {
            log::warn!(
                target: "app.smtp",
                "smtp_test_connection timeout after {}ms (limit {}s) host={}:{}",
                elapsed_ms,
                SMTP_TEST_TIMEOUT.as_secs(),
                config.host,
                config.port
            );
            Err(format!(
                "SMTP test timed out after {} seconds. Check server, port, SSL/TLS, and sign-in method.",
                SMTP_TEST_TIMEOUT.as_secs()
            ))
        }
        Ok(result) => {
            let mapped = result
                .map(|success| SmtpSendResult {
                    success,
                    message: if success {
                        "Connection successful".to_string()
                    } else {
                        "Connection failed".to_string()
                    },
                })
                .map_err(|e| format!("SMTP test error: {}", e));
            let ok_flag = mapped.as_ref().map(|r| r.success).unwrap_or(false);
            log::info!(
                target: "app.smtp",
                "smtp_test_connection end elapsed_ms={} success={}",
                elapsed_ms,
                ok_flag
            );
            mapped
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_base64url_valid() {
        // "Hello" in base64url
        let encoded = "SGVsbG8";
        let decoded = decode_base64url(encoded).unwrap();
        assert_eq!(decoded, b"Hello");
    }

    #[test]
    fn test_decode_base64url_invalid() {
        let result = decode_base64url("!!!invalid!!!");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Base64 decode error"));
    }

    #[test]
    fn test_extract_envelope_valid() {
        let raw = b"From: alice@example.com\r\nTo: bob@example.com\r\nCc: carol@example.com\r\nSubject: Test\r\n\r\nBody";
        let envelope = extract_envelope(raw).unwrap();
        // Envelope should have from and 2 recipients (To + Cc)
        assert!(envelope.from().is_some());
        assert_eq!(envelope.to().len(), 2);
    }

    #[test]
    fn test_extract_envelope_no_from() {
        let raw = b"To: bob@example.com\r\nSubject: Test\r\n\r\nBody";
        let result = extract_envelope(raw);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No From address"));
    }

    #[test]
    fn test_extract_envelope_no_recipients() {
        let raw = b"From: alice@example.com\r\nSubject: Test\r\n\r\nBody";
        let result = extract_envelope(raw);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No recipients found"));
    }

    #[test]
    fn test_extract_envelope_with_bcc() {
        let raw = b"From: alice@example.com\r\nTo: bob@example.com\r\nBcc: secret@example.com\r\nSubject: Test\r\n\r\nBody";
        let envelope = extract_envelope(raw).unwrap();
        assert_eq!(envelope.to().len(), 2);
    }
}
