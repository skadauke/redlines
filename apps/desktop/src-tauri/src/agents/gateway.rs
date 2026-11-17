//! Reaching an OpenClaw Gateway on another computer: the address the person gives or picks, the rules
//! it must follow, and a probe that opens its WebSocket, reads the first frame and closes, so that
//! the setup sheet can say "Found an OpenClaw Gateway on studio-mini", or why not
//! (docs/research/openclaw-connection.md, screen 3).
//!
//! The probe sends **nothing**: no text, no credential, no `connect`. A Gateway greets a new
//! connection with a `connect.challenge` event; seeing it is the whole answer. The same opening
//! (`open`) is what the node's connection uses afterwards (`node.rs`).

use std::io;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::Serialize;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{HandshakeError, Message, WebSocket};

use super::acp::gateway_url_problem;

/// The port of a Gateway that isn't behind Tailscale Serve, which answers on 443.
const DEFAULT_PORT: u16 = 18789;

/// How long the probe waits for the connection, and then for the greeting.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

/// Where to connect: a `ws://` or `wss://` address that the rules below accept.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Target {
    /// The address as a URL, with no secret in it.
    pub url: String,
    pub host: String,
    pub port: u16,
    pub tls: bool,
}

/// What the probe found.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Probe {
    /// A Gateway answered with its greeting.
    Found { url: String, host: String },
    /// Nothing answered in time: the computer may be asleep, off the network, or the network
    /// blocks the way.
    NotAnswering {
        url: String,
        host: String,
        detail: String,
    },
    /// Something answered, and it isn't an OpenClaw Gateway: connection refused, no WebSocket, or
    /// no greeting.
    NoGateway {
        url: String,
        host: String,
        detail: String,
    },
    /// The address can't be used, and why, in a line to show.
    BadAddress { message: String },
}

/// Whether a host is on this Mac's own network or a private one, where a plain `ws://` is as safe as
/// the network: loopback, the private ranges, Tailscale's own range (100.64.0.0/10), link-local,
/// `.local` and `.ts.net` names.
fn is_private_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".local") || host.ends_with(".ts.net") {
        return true;
    }
    if host == "::1" {
        return true;
    }
    let octets: Vec<u8> = host
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect();
    if octets.len() != 4 || host.split('.').count() != 4 {
        return false;
    }
    match (octets[0], octets[1]) {
        (127, _) | (10, _) | (192, 168) | (169, 254) => true,
        (172, second) => (16..=31).contains(&second),
        (100, second) => (64..=127).contains(&second),
        _ => false,
    }
}

fn is_tailscale_name(host: &str) -> bool {
    host.to_ascii_lowercase().ends_with(".ts.net")
}

/// The address to connect to, from what the person typed or picked. `suffix` is the network's name
/// (`yak-bebop.ts.net`), which a bare computer name (`studio-mini`) is completed with.
///
/// A name or address with no scheme is `wss://` for `.ts.net` names (port 443) and for public
/// hosts, and `ws://` for the private places a plain address is accepted. A public host with a
/// `ws://` scheme is refused: the Gateway's token and the setup code would cross the open internet.
pub fn target(input: &str, suffix: Option<&str>) -> Result<Target, String> {
    let input = input.trim();
    let bad = |message: &str| Err(message.to_string());
    if input.is_empty() {
        return bad("Type the computer’s Tailscale name or address.");
    }
    let (scheme, rest) = match input.split_once("://") {
        Some((scheme, rest)) => (Some(scheme.to_ascii_lowercase()), rest),
        None => (None, input),
    };
    if matches!(scheme.as_deref(), Some(scheme) if scheme != "ws" && scheme != "wss") {
        return bad("Give the address as wss:// or ws://, or just the computer’s name.");
    }
    let rest = rest.trim_end_matches('/');
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    // The host, and its port if any: an IPv6 address is in brackets.
    let (host, port) = match authority.strip_prefix('[') {
        Some(inside) => match inside.split_once(']') {
            Some((host, after)) => (host.to_string(), after.strip_prefix(':')),
            None => return bad("That address doesn’t look right."),
        },
        None => match authority.split_once(':') {
            Some((host, port)) => (host.to_string(), Some(port)),
            None => (authority.to_string(), None),
        },
    };
    let host = host.trim_end_matches('.').to_string();
    if host.is_empty() {
        return bad("That address doesn’t look right.");
    }
    // A short name is the computer's name on the person's network.
    let host = match suffix {
        Some(suffix) if !host.contains('.') && !host.contains(':') && host != "localhost" => {
            format!("{host}.{}", suffix.trim_matches('.'))
        }
        _ => host,
    };
    let private = is_private_host(&host);
    let tls = match scheme.as_deref() {
        Some("wss") => true,
        Some(_) => false,
        None => is_tailscale_name(&host) || !private,
    };
    if !tls && !private {
        return bad(
            "A plain ws:// address is only for this Mac and private networks. \
             Use wss:// for any other computer.",
        );
    }
    let port: u16 = match port {
        Some(port) => port
            .parse()
            .ok()
            .filter(|number| *number != 0)
            .ok_or_else(|| "That port isn’t a number.".to_string())?,
        None if tls && is_tailscale_name(&host) => 443,
        None => DEFAULT_PORT,
    };
    let shown_host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.clone()
    };
    let scheme = if tls { "wss" } else { "ws" };
    let default = tls && port == 443;
    let mut url = format!("{scheme}://{shown_host}");
    if !default {
        url.push_str(&format!(":{port}"));
    }
    if !path.is_empty() {
        url.push('/');
        url.push_str(path);
    }
    if let Some(problem) = gateway_url_problem(&url) {
        return Err(problem);
    }
    Ok(Target {
        url,
        host,
        port,
        tls,
    })
}

/// An open WebSocket to a Gateway, over TLS for `wss://`.
pub type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

/// Why a connection could not be opened.
#[derive(Debug)]
pub enum OpenError {
    /// No answer in time, at the connection or in the opening handshake.
    TimedOut,
    /// Refused, or no such computer.
    Unreachable(String),
    /// Something answered, and it wasn't a WebSocket (or the certificate was wrong).
    NotAGateway(String),
}

fn timed_out(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}

/// Connects to a target and finishes the WebSocket handshake, every wait within `timeout`. The
/// stream's timeouts stay set, so that a later read never waits forever.
pub fn open(target: &Target, timeout: Duration) -> Result<Socket, OpenError> {
    let addresses = (target.host.as_str(), target.port)
        .to_socket_addrs()
        .map_err(|error| OpenError::Unreachable(format!("No such computer: {error}")))?;
    let mut last = OpenError::Unreachable("No address.".to_string());
    for address in addresses {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(stream) => {
                let _ = stream.set_read_timeout(Some(timeout));
                let _ = stream.set_write_timeout(Some(timeout));
                let _ = stream.set_nodelay(true);
                return match tungstenite::client_tls(target.url.as_str(), stream) {
                    Ok((socket, _)) => Ok(socket),
                    Err(HandshakeError::Interrupted(_)) => Err(OpenError::TimedOut),
                    Err(HandshakeError::Failure(tungstenite::Error::Io(error)))
                        if timed_out(&error) =>
                    {
                        Err(OpenError::TimedOut)
                    }
                    Err(HandshakeError::Failure(error)) => {
                        Err(OpenError::NotAGateway(error.to_string()))
                    }
                };
            }
            Err(error) if timed_out(&error) => last = OpenError::TimedOut,
            Err(error) => last = OpenError::Unreachable(error.to_string()),
        }
    }
    Err(last)
}

/// Whether a text frame is a Gateway's greeting: an event named `connect.challenge`.
pub fn is_challenge(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .is_some_and(|frame| {
            frame.get("event").and_then(|event| event.as_str()) == Some("connect.challenge")
        })
}

/// Opens the Gateway at `target`, waits for its greeting, and closes. Sends no frame but the
/// WebSocket's own close.
pub fn probe(target: &Target, timeout: Duration) -> Probe {
    let (url, host) = (target.url.clone(), target.host.clone());
    let mut socket = match open(target, timeout) {
        Ok(socket) => socket,
        Err(OpenError::TimedOut) => {
            return Probe::NotAnswering {
                url,
                host,
                detail: "No answer in time.".to_string(),
            };
        }
        Err(OpenError::Unreachable(detail)) | Err(OpenError::NotAGateway(detail)) => {
            return Probe::NoGateway { url, host, detail };
        }
    };
    let found = loop {
        match socket.read() {
            Ok(Message::Text(text)) => break is_challenge(text.as_str()),
            Ok(Message::Ping(_) | Message::Pong(_)) => continue,
            Ok(_) => break false,
            Err(tungstenite::Error::Io(error)) if timed_out(&error) => {
                let _ = socket.close(None);
                return Probe::NotAnswering {
                    url,
                    host,
                    detail: "It answered, but sent no greeting in time.".to_string(),
                };
            }
            Err(_) => break false,
        }
    };
    let _ = socket.close(None);
    if found {
        Probe::Found { url, host }
    } else {
        Probe::NoGateway {
            url,
            host,
            detail: "It answered, but it isn’t an OpenClaw Gateway.".into(),
        }
    }
}

/// Looks for an OpenClaw Gateway at what the person typed or picked. Sends nothing.
#[tauri::command(async)]
pub fn gateway_probe(address: String, suffix: Option<String>) -> Probe {
    match target(&address, suffix.as_deref()) {
        Ok(target) => probe(&target, PROBE_TIMEOUT),
        Err(message) => Probe::BadAddress { message },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    fn ok(input: &str) -> Target {
        target(input, Some("yak-bebop.ts.net")).unwrap_or_else(|error| panic!("{input}: {error}"))
    }

    #[test]
    fn a_computer_name_on_the_network_is_wss_on_443() {
        let found = ok("studio-mini");
        assert_eq!(found.url, "wss://studio-mini.yak-bebop.ts.net");
        assert_eq!((found.port, found.tls), (443, true));
        assert_eq!(ok("studio-mini.yak-bebop.ts.net").url, found.url);
        assert_eq!(ok("wss://studio-mini.yak-bebop.ts.net/").url, found.url);
        assert_eq!(
            ok("  Studio-Mini.yak-bebop.ts.net. ").host,
            "Studio-Mini.yak-bebop.ts.net"
        );
    }

    #[test]
    fn other_hosts_use_the_gateways_own_port() {
        let found = ok("wss://gateway.example.org");
        assert_eq!(
            (found.url.as_str(), found.port),
            ("wss://gateway.example.org:18789", 18789)
        );
        assert_eq!(
            ok("gateway.example.org").url,
            "wss://gateway.example.org:18789"
        );
        assert_eq!(ok("wss://gateway.example.org:8443").port, 8443);
    }

    #[test]
    fn plain_ws_is_for_this_mac_and_private_networks_only() {
        for private in [
            "ws://127.0.0.1:18789",
            "ws://localhost",
            "ws://[::1]:18789",
            "ws://10.0.0.5",
            "ws://192.168.1.20:18789",
            "ws://172.20.0.1",
            "ws://100.101.102.103:18789",
            "ws://studio.local",
            "ws://studio-mini.yak-bebop.ts.net:18789",
        ] {
            assert!(!ok(private).tls, "{private}");
        }
        for public in [
            "ws://gateway.example.org",
            "ws://8.8.8.8",
            "ws://172.32.0.1",
            "ws://100.128.0.1",
        ] {
            assert!(target(public, None).is_err(), "{public}");
        }
        // No scheme: a private address is plain, a public one is wss.
        assert_eq!(ok("192.168.1.20").url, "ws://192.168.1.20:18789");
        assert_eq!(ok("100.101.102.103").url, "ws://100.101.102.103:18789");
        assert_eq!(ok("8.8.8.8").url, "wss://8.8.8.8:18789");
    }

    #[test]
    fn an_address_with_a_secret_or_another_scheme_is_refused() {
        for bad in [
            "",
            "   ",
            "https://studio-mini.yak-bebop.ts.net",
            "javascript:alert(1)",
            "wss://user:hunter2@studio-mini.yak-bebop.ts.net",
            "wss://studio-mini.yak-bebop.ts.net:hunter2",
            "wss://studio-mini.yak-bebop.ts.net?token=abc",
            "wss://studio-mini.yak-bebop.ts.net/#token",
            "wss://studio-mini.yak-bebop.ts.net:0",
            "wss://host with spaces",
            "wss://",
        ] {
            assert!(target(bad, Some("yak-bebop.ts.net")).is_err(), "{bad:?}");
        }
    }

    /// A Gateway for the tests: accepts one connection, and does what `serve` says.
    fn gateway(serve: impl FnOnce(TcpStream) + Send + 'static) -> (Target, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            serve(stream);
        });
        (ok(&format!("ws://127.0.0.1:{port}")), handle)
    }

    #[test]
    fn a_gateways_greeting_is_found_and_nothing_is_sent() {
        let (found, server) = gateway(|stream| {
            let mut socket = tungstenite::accept(stream).unwrap();
            socket
                .send(Message::text(
                    r#"{"type":"event","event":"connect.challenge","payload":{"nonce":"n1"}}"#,
                ))
                .unwrap();
            // Whatever the probe sends after the opening must be the close, and only that.
            let mut sent = Vec::new();
            while let Ok(message) = socket.read() {
                sent.push(message);
            }
            assert!(
                sent.iter()
                    .all(|message| matches!(message, Message::Close(_))),
                "{sent:?}"
            );
        });
        let result = probe(&found, Duration::from_secs(5));
        assert!(matches!(result, Probe::Found { .. }), "{result:?}");
        server.join().unwrap();
    }

    #[test]
    fn a_websocket_that_isnt_a_gateway_is_no_gateway() {
        let (found, server) = gateway(|stream| {
            let mut socket = tungstenite::accept(stream).unwrap();
            socket.send(Message::text(r#"{"hello":"world"}"#)).unwrap();
            let _ = socket.read();
        });
        assert!(matches!(
            probe(&found, Duration::from_secs(5)),
            Probe::NoGateway { .. }
        ));
        server.join().unwrap();
    }

    #[test]
    fn a_plain_web_server_is_no_gateway() {
        let (found, server) = gateway(|mut stream| {
            use io::{Read, Write};
            let mut buffer = [0u8; 1024];
            let _ = stream.read(&mut buffer);
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi");
        });
        assert!(matches!(
            probe(&found, Duration::from_secs(5)),
            Probe::NoGateway { .. }
        ));
        server.join().unwrap();
    }

    #[test]
    fn a_closed_port_is_no_gateway() {
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let found = ok(&format!("ws://127.0.0.1:{port}"));
        assert!(matches!(
            probe(&found, Duration::from_secs(5)),
            Probe::NoGateway { .. }
        ));
    }

    #[test]
    fn a_greeting_that_never_comes_is_not_answering() {
        let (found, server) = gateway(|stream| {
            let mut socket = tungstenite::accept(stream).unwrap();
            // Say nothing until the probe gives up and closes.
            let _ = socket.read();
        });
        let result = probe(&found, Duration::from_millis(300));
        assert!(matches!(result, Probe::NotAnswering { .. }), "{result:?}");
        server.join().unwrap();
    }

    #[test]
    fn a_connection_that_never_opens_the_websocket_is_not_answering() {
        let (found, server) = gateway(|mut stream| {
            use io::Read;
            let mut buffer = [0u8; 1024];
            // Reads the request and never answers.
            let _ = stream.read(&mut buffer);
            let _ = stream.read(&mut buffer);
        });
        let result = probe(&found, Duration::from_millis(300));
        assert!(matches!(result, Probe::NotAnswering { .. }), "{result:?}");
        server.join().unwrap();
    }

    #[test]
    fn a_bad_address_is_said_before_any_connection() {
        let result = gateway_probe("https://studio-mini".to_string(), None);
        assert!(matches!(result, Probe::BadAddress { .. }));
    }

    #[test]
    fn the_greeting_is_an_event_named_connect_challenge() {
        assert!(is_challenge(
            r#"{"type":"event","event":"connect.challenge","payload":{}}"#
        ));
        assert!(!is_challenge(r#"{"type":"event","event":"tick"}"#));
        assert!(!is_challenge("connect.challenge"));
        assert!(!is_challenge(""));
    }
}
