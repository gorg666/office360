//! Happy Eyeballs TCP connect for mail servers.
//!
//! `tokio::net::TcpStream::connect((host, port))` tries `getaddrinfo` order.
//! Outside Russia, Yandex AAAA records often hang while A records succeed in
//! ~300ms. Wrapping the whole connect in a 30s timeout then fails before IPv4
//! is reached. Race IPv6 and IPv4 (RFC 8305 delay) and keep the first winner.
//!
//! Never log credentials.

use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

use tokio::net::{lookup_host, TcpStream};
use tokio::time::{sleep, timeout};

/// Delay before starting the other address family (RFC 8305 CONNECTION_ATTEMPT_DELAY).
const FAMILY_ATTEMPT_DELAY: Duration = Duration::from_millis(250);

pub struct MailTcpConnect {
    pub stream: TcpStream,
    pub addr: SocketAddr,
}

pub fn addr_to_literal(addr: SocketAddr) -> String {
    match addr.ip() {
        IpAddr::V4(ip) => ip.to_string(),
        IpAddr::V6(ip) => ip.to_string(),
    }
}

pub fn ip_family(addr: SocketAddr) -> &'static str {
    if addr.is_ipv4() {
        "ipv4"
    } else {
        "ipv6"
    }
}

pub async fn connect_tcp(
    host: &str,
    port: u16,
    overall: Duration,
) -> Result<MailTcpConnect, String> {
    let started = Instant::now();
    log::info!(
        target: "app.mail_tcp",
        "[mail-tcp] connect start host={host} port={port}"
    );

    let addrs: Vec<SocketAddr> = lookup_host((host, port))
        .await
        .map_err(|e| format!("DNS lookup for {host}:{port} failed: {e}"))?
        .collect();

    if addrs.is_empty() {
        return Err(format!("DNS lookup for {host}:{port} returned no addresses"));
    }

    let v4: Vec<SocketAddr> = addrs.iter().copied().filter(SocketAddr::is_ipv4).collect();
    let v6: Vec<SocketAddr> = addrs.iter().copied().filter(SocketAddr::is_ipv6).collect();
    log::info!(
        target: "app.mail_tcp",
        "[mail-tcp] host={host} port={port} resolved_v4={} resolved_v6={}",
        v4.len(),
        v6.len()
    );

    match timeout(overall, race_happy_eyeballs(v6, v4)).await {
        Err(_) => Err(format!(
            "TCP connect to {host}:{port} timed out after {}s — check your server settings or network connection",
            overall.as_secs()
        )),
        Ok(Err(e)) => Err(format!("TCP connect to {host}:{port} failed: {e}")),
        Ok(Ok((stream, addr))) => {
            log::info!(
                target: "app.mail_tcp",
                "[mail-tcp] host={host} port={port} connect ok family={} elapsed_ms={}",
                ip_family(addr),
                started.elapsed().as_millis()
            );
            Ok(MailTcpConnect { stream, addr })
        }
    }
}

async fn race_happy_eyeballs(
    v6: Vec<SocketAddr>,
    v4: Vec<SocketAddr>,
) -> Result<(TcpStream, SocketAddr), String> {
    if v6.is_empty() {
        return connect_family(&v4).await;
    }
    if v4.is_empty() {
        return connect_family(&v6).await;
    }

    let v6_fut = connect_family(&v6);
    let v4_fut = async {
        sleep(FAMILY_ATTEMPT_DELAY).await;
        connect_family(&v4).await
    };
    tokio::pin!(v6_fut);
    tokio::pin!(v4_fut);

    tokio::select! {
        r = &mut v6_fut => match r {
            Ok(connected) => Ok(connected),
            Err(v6_err) => v4_fut.await.map_err(|v4_err| format!("{v6_err}; {v4_err}")),
        },
        r = &mut v4_fut => match r {
            Ok(connected) => Ok(connected),
            Err(v4_err) => v6_fut.await.map_err(|v6_err| format!("{v6_err}; {v4_err}")),
        },
    }
}

async fn connect_family(addrs: &[SocketAddr]) -> Result<(TcpStream, SocketAddr), String> {
    let mut last = "no addresses".to_string();
    for addr in addrs {
        match TcpStream::connect(addr).await {
            Ok(stream) => return Ok((stream, *addr)),
            Err(e) => last = format!("{addr}: {e}"),
        }
    }
    Err(last)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    #[test]
    fn addr_to_literal_formats_v4_without_port() {
        let addr: SocketAddr = "77.88.21.125:993".parse().unwrap();
        assert_eq!(addr_to_literal(addr), "77.88.21.125");
        assert_eq!(ip_family(addr), "ipv4");
    }

    #[tokio::test]
    async fn connects_to_local_ipv4_listener() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            socket.write_all(b"ok").await.unwrap();
        });

        let connected = connect_tcp("127.0.0.1", port, Duration::from_secs(2))
            .await
            .expect("local ipv4 connect");
        assert!(connected.addr.is_ipv4());
    }

    #[tokio::test]
    async fn times_out_closed_port_with_host_in_message() {
        // 127.0.0.1:1 is typically closed / permission denied quickly; use a blackhole-ish high port
        // with a very short timeout against an address that will not accept in time.
        let err = connect_tcp("127.0.0.1", 1, Duration::from_millis(50))
            .await
            .err();
        assert!(err.is_some());
        let message = err.unwrap();
        assert!(
            message.contains("127.0.0.1:1"),
            "unexpected error: {message}"
        );
    }

    #[tokio::test]
    #[ignore = "live network; run on the operator Mac"]
    async fn yandex_imap_happy_eyeballs_reaches_ipv4() {
        let connected = connect_tcp("imap.yandex.ru", 993, Duration::from_secs(8))
            .await
            .expect("Yandex IMAP should connect via IPv4 when IPv6 hangs");
        assert_eq!(ip_family(connected.addr), "ipv4");
    }

    #[tokio::test]
    #[ignore = "live network; run on the operator Mac"]
    async fn yandex_smtp_465_happy_eyeballs_reaches_ipv4() {
        let connected = connect_tcp("smtp.yandex.com", 465, Duration::from_secs(8))
            .await
            .expect("Yandex SMTP 465 should connect via IPv4 when IPv6 hangs");
        assert_eq!(ip_family(connected.addr), "ipv4");
    }
}
