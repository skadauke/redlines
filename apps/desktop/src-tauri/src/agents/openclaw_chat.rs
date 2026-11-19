//! Redlines asking an OpenClaw agent: the other direction of the connection
//! (docs/research/openclaw-connection.md, "The other direction").
//!
//! The node connection (`node.rs`) carries the agent's tool calls *to* Redlines. It cannot carry a
//! message *to* the agent: a live Gateway refuses `chat.send` from a node ("unauthorized role:
//! node"), because chat is an operator's method. So a message goes over a second connection of
//! the same device, as an operator with two scopes (`operator.read`, `operator.write`: no admin),
//! the way OpenClaw's own apps chat with an agent: `chat.send` into a session, and the `chat`
//! events of its run until `final`.
//!
//! One connection for each message: it opens with the operator token the Gateway gave this device
//! (or the setup code, once, to get it), sends, follows the run and closes. Nothing here keeps a
//! connection open between messages. Stopping a run sends `chat.abort`.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use tungstenite::Message;

use super::connections::Secret;
use super::gateway::{OpenError, Socket, open};
use super::node::{Config, Credential, Ended, next_frame, now_ms, response_to, send, set_poll};
use super::openclaw_protocol::{
    self as protocol, ChatState, Connect, Incoming, Refusal, chat_abort_request, chat_send_request,
    operator_connect_request, operator_signed_text,
};

/// How long a run that was asked to stop gets to say so before this gives up on its words.
const ABORT_GRACE: Duration = Duration::from_secs(5);

/// Why an operator connection could not be made, in words for a person.
#[derive(Debug, PartialEq, Eq)]
pub enum ChatError {
    /// The Gateway can't be reached, or dropped the connection.
    Unreachable(String),
    /// The Gateway answered and said no.
    Refused(Refusal),
}

impl ChatError {
    pub fn message(&self) -> String {
        match self {
            ChatError::Unreachable(detail) => format!("Couldn’t reach the Gateway. {detail}"),
            ChatError::Refused(Refusal::PairingRequired { .. }) => {
                "The Gateway hasn’t approved this Mac for chat yet. Its owner approves the \
                 request in `openclaw devices list`."
                    .to_owned()
            }
            ChatError::Refused(Refusal::ApproveAgain { .. }) => {
                // OpenClaw has no way to hand a waiting client the token an approval makes: the
                // approval replaces the device's token, and the one Redlines holds stops working.
                "This Mac has to be approved again before it can chat. The Gateway’s owner approves \
                 it in `openclaw devices list`, then `openclaw devices approve`. That replaces \
                 this Mac’s chat token, so when it is done, connect again with a new setup code."
                    .to_owned()
            }
            ChatError::Refused(Refusal::CodeUsed) => {
                "The Gateway doesn’t accept this Mac’s chat sign-in any more. Connect again with \
                 a new setup code."
                    .to_owned()
            }
            ChatError::Refused(Refusal::BadToken) => {
                "The Gateway doesn’t accept this Mac’s chat token. It may have been replaced when \
                 this Mac was approved again. Connect again with a new setup code."
                    .to_owned()
            }
            ChatError::Refused(Refusal::TooNew { .. }) => {
                "That Gateway is newer than this Redlines knows how to chat with.".to_owned()
            }
            ChatError::Refused(Refusal::Other(message)) => message.clone(),
        }
    }
}

fn unreachable(ended: Ended) -> ChatError {
    match ended {
        Ended::Dropped(detail) => ChatError::Unreachable(detail),
        Ended::Refused(refusal) => ChatError::Refused(refusal),
        Ended::Stopped => ChatError::Unreachable("Stopped.".to_owned()),
        Ended::ToolsRefused(message) => ChatError::Unreachable(message),
    }
}

/// Opens an operator connection with a setup code or a token. Gives the socket, ready for
/// `chat.send`, and the device token the Gateway issued for this role, if it issued one.
pub fn connect_operator(
    config: &Config,
    credential: &Credential,
    stop: &AtomicBool,
) -> Result<(Socket, Option<Secret>), ChatError> {
    let timing = config.timing;
    let mut socket = match open(&config.target, timing.open) {
        Ok(socket) => socket,
        Err(OpenError::TimedOut) => {
            return Err(ChatError::Unreachable("No answer in time.".to_owned()));
        }
        Err(OpenError::Unreachable(detail) | OpenError::NotAGateway(detail)) => {
            return Err(ChatError::Unreachable(detail));
        }
    };
    set_poll(&mut socket, timing.poll);
    let until = || Instant::now() + timing.open;
    let greeting_until = until();
    let nonce = loop {
        match next_frame(&mut socket, greeting_until, stop) {
            Ok(Some(text)) => {
                if let Incoming::Challenge { nonce } = protocol::parse(&text) {
                    break nonce;
                }
            }
            Ok(None) => {
                return Err(ChatError::Unreachable(
                    "The Gateway sent no greeting.".to_owned(),
                ));
            }
            Err(ended) => return Err(unreachable(ended)),
        }
    };
    let signed_at = now_ms();
    let device_id = config.identity.id();
    let secret = credential.secret().expose();
    let signature = config
        .identity
        .sign(&operator_signed_text(&device_id, signed_at, secret, &nonce));
    let connect = operator_connect_request(&Connect {
        id: "1",
        display_name: &config.display_name,
        version: &config.version,
        device_id: &device_id,
        public_key: &config.identity.public_key(),
        signature: &signature,
        signed_at_ms: signed_at,
        nonce: &nonce,
        credential_kind: credential.kind(),
        credential: secret,
    });
    send(&mut socket, connect).map_err(unreachable)?;
    let (ok, payload, error) = match response_to(&mut socket, "1", until(), stop) {
        Ok(Some(answer)) => answer,
        Ok(None) => {
            return Err(ChatError::Unreachable(
                "The Gateway didn’t answer connect.".to_owned(),
            ));
        }
        Err(ended) => return Err(unreachable(ended)),
    };
    if !ok {
        let error = error.unwrap_or(protocol::WireError {
            code: String::new(),
            message: "The Gateway refused the connection.".into(),
            details: serde_json::Value::Null,
        });
        let _ = socket.close(None);
        return Err(ChatError::Refused(protocol::classify(
            &error,
            matches!(credential, Credential::SetupCode(_)),
        )));
    }
    let token = payload["auth"]["deviceToken"]
        .as_str()
        .and_then(|text| Secret::new(text).ok());
    Ok((socket, token))
}

/// How a message ended.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// The agent's answer, whole.
    Done(String),
    /// The run was stopped, and the Gateway said so (`aborted`).
    Cancelled,
    /// The run was asked to stop and the Gateway never said it had: it may still be going.
    Lost,
}

/// A name for a run that no other has: it is the run's id in the Gateway's events, and makes a
/// repeat of the same send one run.
pub fn run_key() -> String {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    format!(
        "redlines-{}-{}-{}",
        std::process::id(),
        now_ms(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

/// Sends `message` into the session `session_key` and follows the run until the agent's answer.
/// When `stop` is set the run is aborted at the Gateway and this ends with `Cancelled`.
#[cfg(test)]
pub fn ask(
    socket: &mut Socket,
    config: &Config,
    session_key: &str,
    message: &str,
    key: &str,
    stop: &AtomicBool,
) -> Result<Outcome, String> {
    ask_seen(socket, config, session_key, message, key, stop, &|_| {})
}

/// `ask`, telling `seen` the session key the Gateway reports on the run's events (the key it
/// filed the session under, which for a bare key names its default agent).
pub fn ask_seen(
    socket: &mut Socket,
    config: &Config,
    session_key: &str,
    message: &str,
    key: &str,
    stop: &AtomicBool,
    seen: &dyn Fn(&str),
) -> Result<Outcome, String> {
    let timing = config.timing;
    let ended_text = |ended: Ended| match ended {
        Ended::Dropped(detail) => detail,
        _ => "The connection ended.".to_owned(),
    };
    send(socket, chat_send_request("2", session_key, message, key)).map_err(ended_text)?;
    let mut said = String::new();
    let mut aborted_at: Option<Instant> = None;
    let mut last_heard = Instant::now();
    let mut last_ping = Instant::now();
    loop {
        if stop.load(Ordering::Relaxed) && aborted_at.is_none() {
            aborted_at = Some(Instant::now());
            let _ = send(socket, chat_abort_request("3", session_key, key));
        }
        if aborted_at.is_some_and(|at| at.elapsed() >= ABORT_GRACE) {
            return Ok(Outcome::Lost);
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                last_heard = Instant::now();
                let incoming = protocol::parse(text.as_str());
                if let Incoming::Chat(event) = &incoming
                    && event.run_id == key
                {
                    seen(&event.session_key);
                }
                match incoming {
                    Incoming::Response {
                        id,
                        ok: false,
                        error,
                        ..
                    } if id == "2" => {
                        return Err(error
                            .map(|error| error.message)
                            .filter(|message| !message.is_empty())
                            .unwrap_or_else(|| "The Gateway refused the message.".to_owned()));
                    }
                    Incoming::Chat(event) if event.run_id == key => match event.state {
                        ChatState::Status => {}
                        ChatState::Delta { text, replace } => {
                            if replace {
                                said = text;
                            } else {
                                said.push_str(&text);
                            }
                        }
                        ChatState::Final { text } => {
                            let answer = if text.trim().is_empty() { said } else { text };
                            return Ok(Outcome::Done(answer));
                        }
                        ChatState::Aborted => return Ok(Outcome::Cancelled),
                        ChatState::Error { message } => return Err(message),
                    },
                    _ => {}
                }
            }
            Ok(Message::Close(_)) => return Err("The Gateway closed the connection.".to_owned()),
            Ok(_) => last_heard = Instant::now(),
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if last_ping.elapsed() >= timing.ping_every {
                    last_ping = Instant::now();
                    if socket.send(Message::Ping(Vec::new().into())).is_err() {
                        return Err("The connection broke.".to_owned());
                    }
                }
                // A Gateway ticks while a run goes on; nothing in six pings' time is a Gateway
                // that has gone.
                if last_heard.elapsed() > timing.ping_every * 6 {
                    return Err("The Gateway went quiet.".to_owned());
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    use base64::Engine as _;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use serde_json::{Value, json};
    use sha2::{Digest, Sha256};
    use tungstenite::WebSocket;

    use super::super::gateway::target;
    use super::super::node::{Identity, Timing};
    use super::*;

    const SEED: &str = "0202020202020202020202020202020202020202020202020202020202020202";

    type Ws = WebSocket<std::net::TcpStream>;
    type Frames = Arc<Mutex<Vec<Value>>>;

    pub(crate) struct Fake {
        pub(crate) config: Config,
        pub(crate) frames: Frames,
        thread: std::thread::JoinHandle<()>,
    }

    impl Fake {
        pub(crate) fn finish(self) -> Vec<Value> {
            let _ = self.thread.join();
            self.frames.lock().unwrap().clone()
        }
    }

    fn timing() -> Timing {
        Timing {
            open: Duration::from_secs(3),
            poll: Duration::from_millis(20),
            ping_every: Duration::from_secs(5),
            call: Duration::from_secs(5),
            pairing_retry: Duration::from_millis(10),
            pairing_window: Duration::from_secs(1),
            backoff_start: Duration::from_millis(10),
            backoff_max: Duration::from_millis(40),
        }
    }

    fn read(socket: &mut Ws, frames: &Frames) -> Option<Value> {
        loop {
            match socket.read() {
                Ok(Message::Text(text)) => {
                    let value: Value = serde_json::from_str(text.as_str()).ok()?;
                    frames.lock().unwrap().push(value.clone());
                    return Some(value);
                }
                Ok(Message::Close(_)) | Err(_) => return None,
                Ok(_) => {}
            }
        }
    }

    fn say(socket: &mut Ws, value: Value) {
        let _ = socket.send(Message::text(value.to_string()));
    }

    /// Reads the operator's `connect` and checks it as a Gateway would: the signature over the
    /// nonce, the role, the scopes. Answers `hello-ok` with an operator token, or refuses.
    ///
    /// A device the Gateway has paired is modeled by `paired`: the device family it pinned, and the
    /// device token it holds. A claim of another family is a `metadata-upgrade` request, as in the
    /// Gateway's `resolvePinnedClientMetadata`, and a device token that isn't the one held is
    /// `AUTH_DEVICE_TOKEN_MISMATCH` (sent as `auth.token` it would be a shared-token mismatch).
    fn accept(
        socket: &mut Ws,
        frames: &Frames,
        refuse: Option<(&str, &str)>,
        paired: Option<Paired>,
    ) -> bool {
        say(
            socket,
            json!({"type": "event", "event": "connect.challenge", "payload": {"nonce": "n9"}}),
        );
        let connect = read(socket, frames).expect("connect");
        assert_eq!(connect["method"], "connect");
        let params = &connect["params"];
        assert_eq!(params["role"], "operator");
        assert_eq!(params["client"]["id"], "gateway-client");
        assert_eq!(params["minProtocol"], 4);
        assert_eq!(params["scopes"], json!(["operator.read", "operator.write"]));
        let device = &params["device"];
        let key = URL_SAFE_NO_PAD
            .decode(device["publicKey"].as_str().unwrap())
            .unwrap();
        let id: String = Sha256::digest(&key)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let credential = params["auth"]["deviceToken"]
            .as_str()
            .or_else(|| params["auth"]["token"].as_str())
            .or_else(|| params["auth"]["bootstrapToken"].as_str())
            .unwrap();
        let signed =
            operator_signed_text(&id, device["signedAt"].as_u64().unwrap(), credential, "n9");
        let signature = URL_SAFE_NO_PAD
            .decode(device["signature"].as_str().unwrap())
            .unwrap();
        VerifyingKey::from_bytes(&key.try_into().unwrap())
            .unwrap()
            .verify(
                signed.as_bytes(),
                &Signature::from_bytes(&signature.try_into().unwrap()),
            )
            .expect("the operator's signature");
        let refused = |socket: &mut Ws, code: &str, message: &str, details: Value| {
            say(
                socket,
                json!({"type": "res", "id": "1", "ok": false,
                    "error": {"code": code, "message": message, "details": details}}),
            );
        };
        if let Some(paired) = paired {
            let claimed = params["client"]["deviceFamily"]
                .as_str()
                .unwrap_or_default();
            if !paired.family.is_empty() && !claimed.eq_ignore_ascii_case(paired.family) {
                refused(
                    socket,
                    "NOT_PAIRED",
                    "pairing required: device identity changed and must be re-approved",
                    json!({"code": "PAIRING_REQUIRED", "reason": "metadata-upgrade",
                        "requestId": "r-9", "requestedRole": "operator"}),
                );
                return false;
            }
            let has_code = params["auth"]["bootstrapToken"].is_string();
            if !has_code && params["auth"]["deviceToken"].as_str() != Some(paired.token) {
                let (message, code) = if params["auth"]["token"].is_string() {
                    (
                        "unauthorized: gateway token mismatch",
                        "AUTH_TOKEN_MISMATCH",
                    )
                } else {
                    (
                        "unauthorized: device token mismatch",
                        "AUTH_DEVICE_TOKEN_MISMATCH",
                    )
                };
                refused(socket, "INVALID_REQUEST", message, json!({"code": code}));
                return false;
            }
        }
        if let Some((code, message)) = refuse {
            say(
                socket,
                json!({"type": "res", "id": "1", "ok": false,
                    "error": {"code": code, "message": message}}),
            );
            return false;
        }
        say(
            socket,
            json!({"type": "res", "id": "1", "ok": true,
                "payload": {"type": "hello-ok", "protocol": 4,
                    "auth": {"role": "operator", "deviceToken": "op-token-1"}}}),
        );
        true
    }

    /// What a Gateway holds of a device it has paired: the family it pinned (empty for none), and
    /// the operator token it knows.
    #[derive(Clone, Copy)]
    pub(crate) struct Paired {
        pub(crate) family: &'static str,
        pub(crate) token: &'static str,
    }

    /// A Gateway that takes one operator connection and then runs `after` with it.
    pub(crate) fn fake(
        refuse: Option<(&'static str, &'static str)>,
        after: impl FnOnce(&mut Ws, &Frames) + Send + 'static,
    ) -> Fake {
        fake_paired(refuse, None, after)
    }

    /// The same for a device the Gateway has paired.
    pub(crate) fn fake_paired(
        refuse: Option<(&'static str, &'static str)>,
        paired: Option<Paired>,
        after: impl FnOnce(&mut Ws, &Frames) + Send + 'static,
    ) -> Fake {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let frames: Frames = Arc::default();
        let seen = Arc::clone(&frames);
        let thread = std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            let Ok(mut socket) = tungstenite::accept(stream) else {
                return;
            };
            if accept(&mut socket, &seen, refuse, paired) {
                after(&mut socket, &seen);
            }
        });
        Fake {
            config: Config {
                target: target(&format!("ws://127.0.0.1:{port}"), None).unwrap(),
                identity: Identity::from_seed(SEED).unwrap(),
                display_name: "Redlines on Ada's MacBook".into(),
                version: "0.2.0".into(),
                timing: timing(),
            },
            frames,
            thread,
        }
    }

    fn chat(key: &str, mut payload: Value) -> Value {
        payload["runId"] = json!(key);
        payload["sessionKey"] = json!("agent:main:redlines-0123456789abcdef");
        json!({"type": "event", "event": "chat", "payload": payload})
    }

    fn token(text: &str) -> Credential {
        Credential::Token(Secret::new(text).unwrap())
    }

    const SESSION: &str = "agent:main:redlines-0123456789abcdef";

    #[test]
    fn a_message_goes_into_the_session_and_the_final_text_is_the_answer() {
        let key = "run-1";
        let gateway = fake(None, move |socket, frames| {
            let send = read(socket, frames).expect("chat.send");
            assert_eq!(send["method"], "chat.send");
            assert_eq!(send["params"]["sessionKey"], SESSION);
            assert_eq!(send["params"]["message"], "Fix the spelling.");
            assert_eq!(send["params"]["idempotencyKey"], key);
            say(
                socket,
                json!({"type": "res", "id": "2", "ok": true,
                    "payload": {"runId": key, "status": "started"}}),
            );
            // Another run's words, and a status, are not the answer.
            say(
                socket,
                chat(
                    "someone-else",
                    json!({"state": "final",
                "message": {"content": [{"type": "text", "text": "Not mine."}]}}),
                ),
            );
            say(
                socket,
                chat(key, json!({"state": "status", "phase": "starting_model"})),
            );
            say(
                socket,
                chat(key, json!({"state": "delta", "deltaText": "Fixed "})),
            );
            say(
                socket,
                chat(
                    key,
                    json!({"state": "delta", "deltaText": "", "replace": true}),
                ),
            );
            say(
                socket,
                chat(
                    key,
                    json!({"state": "final",
                "message": {"content": [{"type": "text", "text": "Fixed it."}]}}),
                ),
            );
        });
        let stop = AtomicBool::new(false);
        let (mut socket, issued) =
            connect_operator(&gateway.config, &token("device-1"), &stop).unwrap();
        assert!(issued.is_some_and(|token| token.expose() == "op-token-1"));
        let outcome = ask(
            &mut socket,
            &gateway.config,
            SESSION,
            "Fix the spelling.",
            key,
            &stop,
        )
        .unwrap();
        assert_eq!(outcome, Outcome::Done("Fixed it.".to_owned()));
        let frames = gateway.finish();
        assert!(
            !serde_json::to_string(&frames)
                .unwrap()
                .contains("operator.admin")
        );
    }

    #[test]
    fn a_run_without_a_final_text_gives_the_words_so_far() {
        let key = "run-2";
        let gateway = fake(None, move |socket, frames| {
            read(socket, frames).expect("chat.send");
            say(
                socket,
                chat(key, json!({"state": "delta", "deltaText": "Hello"})),
            );
            say(
                socket,
                chat(key, json!({"state": "delta", "deltaText": ", world"})),
            );
            say(
                socket,
                chat(key, json!({"state": "final", "message": {"content": []}})),
            );
        });
        let stop = AtomicBool::new(false);
        let (mut socket, _) = connect_operator(&gateway.config, &token("t"), &stop).unwrap();
        assert_eq!(
            ask(&mut socket, &gateway.config, SESSION, "Hi", key, &stop).unwrap(),
            Outcome::Done("Hello, world".to_owned())
        );
    }

    #[test]
    fn the_session_key_the_gateway_reports_is_told_to_the_one_who_asked() {
        let key = "run-3";
        let gateway = fake(None, move |socket, frames| {
            read(socket, frames).expect("chat.send");
            let mut event = chat(key, json!({"state": "delta", "deltaText": "Hi"}));
            event["payload"]["sessionKey"] = json!("agent:moby:redlines-0123456789abcdef");
            say(socket, event);
            say(
                socket,
                chat(key, json!({"state": "final", "message": {"content": []}})),
            );
        });
        let stop = AtomicBool::new(false);
        let (mut socket, _) = connect_operator(&gateway.config, &token("t"), &stop).unwrap();
        let told = Mutex::new(Vec::<String>::new());
        let outcome = ask_seen(
            &mut socket,
            &gateway.config,
            SESSION,
            "Hi",
            key,
            &stop,
            &|reported| {
                told.lock().unwrap().push(reported.to_owned());
            },
        );
        assert_eq!(outcome.unwrap(), Outcome::Done("Hi".to_owned()));
        assert_eq!(
            told.lock().unwrap().first().map(String::as_str),
            Some("agent:moby:redlines-0123456789abcdef")
        );
    }

    #[test]
    fn a_refused_send_and_a_failed_run_are_errors_in_the_gateways_words() {
        let gateway = fake(None, |socket, frames| {
            read(socket, frames).expect("chat.send");
            say(
                socket,
                json!({"type": "res", "id": "2", "ok": false,
                    "error": {"code": "UNAVAILABLE", "message": "No model is signed in."}}),
            );
        });
        let stop = AtomicBool::new(false);
        let (mut socket, _) = connect_operator(&gateway.config, &token("t"), &stop).unwrap();
        assert_eq!(
            ask(&mut socket, &gateway.config, SESSION, "Hi", "k", &stop).unwrap_err(),
            "No model is signed in."
        );

        let gateway = fake(None, |socket, frames| {
            read(socket, frames).expect("chat.send");
            say(
                socket,
                chat(
                    "k",
                    json!({"state": "error", "errorMessage": "Rate limited."}),
                ),
            );
        });
        let (mut socket, _) = connect_operator(&gateway.config, &token("t"), &stop).unwrap();
        assert_eq!(
            ask(&mut socket, &gateway.config, SESSION, "Hi", "k", &stop).unwrap_err(),
            "Rate limited."
        );
    }

    #[test]
    fn stopping_aborts_the_run_at_the_gateway() {
        let key = "run-3";
        let gateway = fake(None, move |socket, frames| {
            read(socket, frames).expect("chat.send");
            let abort = read(socket, frames).expect("chat.abort");
            assert_eq!(abort["method"], "chat.abort");
            assert_eq!(abort["params"]["sessionKey"], SESSION);
            assert_eq!(abort["params"]["runId"], key);
            say(socket, chat(key, json!({"state": "aborted"})));
        });
        let stop = Arc::new(AtomicBool::new(false));
        let (mut socket, _) = connect_operator(&gateway.config, &token("t"), &stop).unwrap();
        let later = Arc::clone(&stop);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            later.store(true, Ordering::Relaxed);
        });
        assert_eq!(
            ask(&mut socket, &gateway.config, SESSION, "Hi", key, &stop).unwrap(),
            Outcome::Cancelled
        );
        gateway.finish();
    }

    #[test]
    fn a_gateway_that_wants_the_device_approved_or_the_code_fresh_says_so() {
        let stop = AtomicBool::new(false);
        let gateway = fake(Some(("NOT_PAIRED", "pairing required")), |_, _| {});
        let error = connect_operator(&gateway.config, &token("t"), &stop)
            .err()
            .unwrap();
        assert_eq!(
            error,
            ChatError::Refused(Refusal::PairingRequired { request_id: None })
        );
        assert!(error.message().contains("approved"));

        let gateway = fake(
            Some((
                "INVALID_REQUEST",
                "unauthorized: setup code invalid, expired, revoked, or already used",
            )),
            |_, _| {},
        );
        let error = connect_operator(
            &gateway.config,
            &Credential::SetupCode(Secret::new("code").unwrap()),
            &stop,
        )
        .err()
        .unwrap();
        assert_eq!(error, ChatError::Refused(Refusal::CodeUsed));
    }

    fn device_token(text: &str) -> Credential {
        Credential::DeviceToken(Secret::new(text).unwrap())
    }

    /// The Gateway of #1154: it paired this Mac with the family `Mac`, and compares it on every
    /// connect. A reconnect with the device's token that claims the same family gets no request.
    #[test]
    fn a_paired_device_that_claims_its_family_is_not_asked_to_be_approved_again() {
        let paired = Paired {
            family: "Mac",
            token: "dt-1",
        };
        let gateway = fake_paired(None, Some(paired), |_, _| {});
        let stop = AtomicBool::new(false);
        let (_, issued) = connect_operator(&gateway.config, &device_token("dt-1"), &stop).unwrap();
        assert!(issued.is_some());
        let frames = gateway.finish();
        assert_eq!(frames[0]["params"]["client"]["deviceFamily"], "Mac");
        assert_eq!(frames[0]["params"]["client"]["platform"], "macos");
        // The device's own token is `auth.deviceToken`, never `auth.token`.
        assert_eq!(frames[0]["params"]["auth"], json!({"deviceToken": "dt-1"}));
    }

    /// A reconnect that the Gateway wants approved again is its own state, in words that say what
    /// to do and what it costs, and not a bad token.
    #[test]
    fn a_reconnect_that_needs_approval_again_is_its_own_state() {
        // The device was approved as something else, so this claim is a metadata upgrade.
        let paired = Paired {
            family: "iPad",
            token: "dt-1",
        };
        let gateway = fake_paired(None, Some(paired), |_, _| {});
        let stop = AtomicBool::new(false);
        let error = connect_operator(&gateway.config, &device_token("dt-1"), &stop)
            .err()
            .unwrap();
        assert_eq!(
            error,
            ChatError::Refused(Refusal::ApproveAgain {
                request_id: Some("r-9".into())
            })
        );
        let said = error.message();
        assert!(said.contains("approved again"), "{said}");
        assert!(said.contains("new setup code"), "{said}");
        assert!(!said.contains("doesn’t accept"), "{said}");
    }

    /// What follows an approval (#1154) and what a new code does (#1161): the approval replaced
    /// the token, the old one is refused as a device token that is stale (and not as a shared
    /// token that is wrong), and a new setup code pairs this Mac again, whatever was kept.
    #[test]
    fn after_an_approval_replaced_the_token_a_new_code_pairs_again() {
        let stale = Paired {
            family: "Mac",
            token: "dt-2",
        };
        let gateway = fake_paired(None, Some(stale), |_, _| {});
        let stop = AtomicBool::new(false);
        let error = connect_operator(&gateway.config, &device_token("dt-1"), &stop)
            .err()
            .unwrap();
        assert_eq!(error, ChatError::Refused(Refusal::BadToken));
        assert!(error.message().contains("new setup code"));
        let frames = gateway.finish();
        assert_eq!(frames[0]["params"]["auth"], json!({"deviceToken": "dt-1"}));

        let gateway = fake_paired(None, Some(stale), |_, _| {});
        let (_, issued) = connect_operator(
            &gateway.config,
            &Credential::SetupCode(Secret::new("code-2").unwrap()),
            &stop,
        )
        .unwrap();
        assert!(issued.is_some_and(|token| token.expose() == "op-token-1"));
        let frames = gateway.finish();
        assert_eq!(
            frames[0]["params"]["auth"],
            json!({"bootstrapToken": "code-2"})
        );
    }

    #[test]
    fn a_token_the_person_typed_is_still_a_shared_token() {
        let gateway = fake(None, |_, _| {});
        let stop = AtomicBool::new(false);
        connect_operator(&gateway.config, &token("typed-1"), &stop).unwrap();
        let frames = gateway.finish();
        assert_eq!(frames[0]["params"]["auth"], json!({"token": "typed-1"}));
    }

    #[test]
    fn a_setup_code_is_offered_as_a_bootstrap_token() {
        let gateway = fake(None, |_, _| {});
        let stop = AtomicBool::new(false);
        let (_, issued) = connect_operator(
            &gateway.config,
            &Credential::SetupCode(Secret::new("code-1").unwrap()),
            &stop,
        )
        .unwrap();
        assert!(issued.is_some());
        let frames = gateway.finish();
        assert_eq!(
            frames[0]["params"]["auth"],
            json!({"bootstrapToken": "code-1"})
        );
    }

    /// The live test: a real Gateway, by hand (docs/research/openclaw-connection.md, "The other
    /// direction"). `REDLINES_LIVE_GATEWAY=ws://127.0.0.1:PORT` and `REDLINES_LIVE_CODE=<a setup
    /// code>`. It opens an operator connection with the code, again with the token the Gateway
    /// gave, sends a message into a new session and prints what comes back. Use
    /// `rtk proxy cargo test live_chat -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs a Gateway, see REDLINES_LIVE_GATEWAY"]
    fn live_chat() {
        let (Ok(address), Ok(code)) = (
            std::env::var("REDLINES_LIVE_GATEWAY"),
            std::env::var("REDLINES_LIVE_CODE"),
        ) else {
            return;
        };
        let config = Config {
            target: target(&address, None).unwrap(),
            // A new device each time: one a Gateway has paired as a node only would need its owner
            // to approve the upgrade to operator.
            identity: Identity::from_seed(&format!("{:016x}", now_ms()).repeat(4)).unwrap(),
            display_name: "Redlines live chat test".into(),
            version: "0.2.0".into(),
            timing: Timing::default(),
        };
        let stop = AtomicBool::new(false);
        let first =
            Credential::SetupCode(Secret::new(&protocol::bootstrap_token(&code).unwrap()).unwrap());
        let (socket, token) = connect_operator(&config, &first, &stop).unwrap();
        drop(socket);
        let token = token.expect("the Gateway gave this device an operator token");
        eprintln!("LIVE operator token kept: true");
        let (mut socket, _) = connect_operator(&config, &Credential::Token(token), &stop).unwrap();
        let key = run_key();
        let session = format!("agent:main:redlines-{:016x}", now_ms());
        let outcome = ask(&mut socket, &config, &session, "Say hello.", &key, &stop);
        eprintln!("LIVE answer: {outcome:?}");
        assert!(matches!(outcome, Ok(Outcome::Done(text)) if !text.is_empty()));
    }

    #[test]
    fn run_keys_are_not_repeated() {
        assert_ne!(run_key(), run_key());
    }
}
