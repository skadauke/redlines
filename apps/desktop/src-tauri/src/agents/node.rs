//! Redlines as an OpenClaw node: it dials out to a Gateway, proves which Mac it is, publishes the
//! Redlines tools, and answers the calls the Gateway sends back over the same connection
//! (docs/research/openclaw-connection.md). Nothing listens on this Mac.
//!
//! One connection's life (`session`): open the WebSocket, read the Gateway's greeting, send
//! `connect` with the one command this node has, a token or a setup code, and a signature of the
//! greeting's nonce with this Mac's device key; wait for `hello-ok` (and keep the device token it
//! gives); publish the tools; then answer calls until the connection ends. What ends it decides
//! what happens next (`start`): a dropped connection is retried with a growing wait; a Mac that
//! is not yet approved is asked about every few seconds for five minutes; a refusal that trying
//! again can't fix (a used setup code, a bad token, a newer protocol) stops, and says so.
//!
//! Tool calls go to a [`ToolHost`], which speaks MCP's JSON-RPC lines, so that the node needs no
//! list of tools of its own and the tools stay the ones every agent has (`packages/agent-tools`).
//! The wire's shapes are in `openclaw_protocol.rs`, checked against a live `openclaw@2026.11.5`
//! Gateway on loopback (the `live_gateway` test, by hand).
//! Secrets are given to the connection as [`Secret`]s and leave it only in the one frame that
//! carries them; nothing here logs or reports one.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tungstenite::{Message, WebSocket};

use super::connections::Secret;
use super::gateway::{OpenError, Socket, Target, open};
use super::openclaw_protocol::{self as protocol, COMMAND, Connect, Incoming, Refusal};

/// What proves this connection to the Gateway.
pub enum Credential {
    /// The token the Gateway gave this device in an earlier `hello-ok`: sent as `auth.deviceToken`.
    DeviceToken(Secret),
    /// A shared token the person typed: sent as `auth.token`.
    Token(Secret),
    /// A setup code, used once.
    SetupCode(Secret),
}

impl Credential {
    pub(super) fn kind(&self) -> &'static str {
        match self {
            Credential::DeviceToken(_) => "deviceToken",
            Credential::Token(_) => "token",
            Credential::SetupCode(_) => "bootstrapToken",
        }
    }

    pub(super) fn secret(&self) -> &Secret {
        match self {
            Credential::DeviceToken(secret)
            | Credential::Token(secret)
            | Credential::SetupCode(secret) => secret,
        }
    }
}

/// This Mac's device identity for one connection: an Ed25519 key made here and never sent. Its id
/// is the SHA-256 of the public key, so the Gateway can't be given an id that isn't the key's.
pub struct Identity {
    key: SigningKey,
}

impl Identity {
    /// From the key's 32 bytes as 64 hex digits (`connections.rs` keeps them).
    pub fn from_seed(hex: &str) -> Option<Self> {
        if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        let mut seed = [0u8; 32];
        for (byte, pair) in seed.iter_mut().zip(hex.as_bytes().chunks(2)) {
            *byte = u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()?;
        }
        Some(Identity {
            key: SigningKey::from_bytes(&seed),
        })
    }

    pub fn public_key(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.key.verifying_key().to_bytes())
    }

    /// The device's id: 64 hex digits.
    pub fn id(&self) -> String {
        Sha256::digest(self.key.verifying_key().to_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The short code both sides can read to each other, `7QF-2K9`: the first digits of the id.
    pub fn short_code(&self) -> String {
        let id = self.id().to_uppercase();
        format!("{}-{}", &id[..3], &id[3..6])
    }

    pub(super) fn sign(&self, text: &str) -> String {
        URL_SAFE_NO_PAD.encode(self.key.sign(text.as_bytes()).to_bytes())
    }
}

/// Where the tools are. It takes one line of MCP (a JSON-RPC request) and gives the line back, or
/// nothing when the tools can't answer now.
pub trait ToolHost: Send + Sync {
    fn mcp(&self, request: &str) -> Option<String>;

    /// The same for a call that came from the run of an agent, which the Gateway names by the
    /// session it runs in (`None` for a call made outside any run, such as `openclaw nodes invoke`).
    /// A host that doesn't tell runs apart answers as `mcp` does.
    fn mcp_in(&self, request: &str, _session: Option<&str>) -> Option<String> {
        self.mcp(request)
    }
}

/// Why a connection gave up, in the terms of the sheet's failure cards.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "why", rename_all = "kebab-case")]
pub enum Failure {
    /// The setup code was used or has run out.
    CodeUsed,
    /// The Gateway doesn't accept the token.
    BadToken,
    /// Nobody approved this Mac in time.
    NotApproved,
    /// The Gateway speaks a newer protocol than Redlines knows.
    TooNew { protocol: Option<u64> },
    /// Connected, but the Gateway refused the Redlines tools.
    ToolsRefused { message: String },
    /// Another reason, in the Gateway's words.
    Other { message: String },
}

/// Where a connection is, for the sheet and the agent's card.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum Status {
    Connecting,
    /// Waiting for the Gateway's owner to approve this Mac. `code` is what to read to them.
    Pairing {
        request_id: Option<String>,
        code: String,
    },
    Connected {
        tools: usize,
    },
    /// The connection dropped or can't be made; trying again.
    Reconnecting {
        detail: String,
    },
    Failed(Failure),
    Stopped,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    Status(Status),
    /// A tool was called, for "Last used".
    Called {
        tool: String,
    },
}

/// The waits. Tests make them short.
#[derive(Clone, Copy, Debug)]
pub struct Timing {
    /// For the connection, and for each answer to the first requests.
    pub open: Duration,
    /// How long a wait for a frame lasts before the stop flag is looked at.
    pub poll: Duration,
    /// How often an idle connection is pinged.
    pub ping_every: Duration,
    /// How long a call may be waited on before the Gateway is told it failed. Each call has its
    /// own, and none holds up another or the connection's pings.
    pub call: Duration,
    pub pairing_retry: Duration,
    /// How long a request to approve this Mac lasts (the Gateway's own is five minutes).
    pub pairing_window: Duration,
    pub backoff_start: Duration,
    pub backoff_max: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Timing {
            open: Duration::from_secs(10),
            poll: Duration::from_millis(250),
            ping_every: Duration::from_secs(25),
            // A little over the most a call waits at the window (`CALL_TIMEOUT`).
            call: Duration::from_secs(125),
            pairing_retry: Duration::from_secs(4),
            pairing_window: Duration::from_secs(5 * 60),
            backoff_start: Duration::from_secs(1),
            backoff_max: Duration::from_secs(30),
        }
    }
}

pub struct Config {
    pub target: Target,
    pub identity: Identity,
    /// "Redlines on Ada's MacBook": what the Gateway's owner sees in the request.
    pub display_name: String,
    pub version: String,
    pub timing: Timing,
}

/// How one connection ended.
pub(super) enum Ended {
    Stopped,
    Dropped(String),
    Refused(Refusal),
    ToolsRefused(String),
}

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64)
}

/// Waits for the next frame of text within `until`, sending nothing, or says how it ended.
pub(super) fn next_frame(
    socket: &mut Socket,
    until: Instant,
    stop: &AtomicBool,
) -> Result<Option<String>, Ended> {
    loop {
        if stop.load(Ordering::Relaxed) {
            return Err(Ended::Stopped);
        }
        match socket.read() {
            Ok(Message::Text(text)) => return Ok(Some(text.as_str().to_owned())),
            Ok(Message::Close(_)) => {
                return Err(Ended::Dropped("The Gateway closed the connection.".into()));
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if Instant::now() >= until {
                    return Ok(None);
                }
            }
            Err(error) => return Err(Ended::Dropped(error.to_string())),
        }
        if Instant::now() >= until {
            return Ok(None);
        }
    }
}

pub(super) fn set_poll(socket: &mut Socket, poll: Duration) {
    if let tungstenite::stream::MaybeTlsStream::Plain(stream) = socket.get_mut() {
        let _ = stream.set_read_timeout(Some(poll));
    } else if let tungstenite::stream::MaybeTlsStream::Rustls(stream) = socket.get_mut() {
        let _ = stream.sock.set_read_timeout(Some(poll));
    }
}

pub(super) fn send(
    socket: &mut WebSocket<impl std::io::Read + std::io::Write>,
    text: String,
) -> Result<(), Ended> {
    socket
        .send(Message::text(text))
        .map_err(|error| Ended::Dropped(error.to_string()))
}

/// Waits for the response to the request `id`, passing over other frames.
pub(super) fn response_to(
    socket: &mut Socket,
    id: &str,
    until: Instant,
    stop: &AtomicBool,
) -> Result<Option<(bool, Value, Option<protocol::WireError>)>, Ended> {
    while let Some(text) = next_frame(socket, until, stop)? {
        if let Incoming::Response {
            id: got,
            ok,
            payload,
            error,
        } = protocol::parse(&text)
            && got == id
        {
            return Ok(Some((ok, payload, error)));
        }
    }
    Ok(None)
}

/// The tools the host offers, as MCP describes them.
fn tools_of(host: &dyn ToolHost) -> Vec<Value> {
    let request = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).to_string();
    host.mcp(&request)
        .and_then(|line| serde_json::from_str::<Value>(&line).ok())
        .and_then(|reply| reply["result"]["tools"].as_array().cloned())
        .unwrap_or_default()
}

/// The most a call may carry, in text.
const MAX_CALL: usize = 1024 * 1024;

/// Answers a call: the MCP result as text, or why it can't be answered.
fn answer_call(
    host: &dyn ToolHost,
    published: &[String],
    command: &str,
    params_json: &str,
    session: Option<&str>,
) -> Result<(String, String), String> {
    if command != COMMAND {
        return Err(format!("This node has no command {command}."));
    }
    // What a Gateway sends is bounded, and names only a tool that was published.
    if params_json.len() > MAX_CALL {
        return Err("The call is too large.".to_owned());
    }
    let params: Value =
        serde_json::from_str(params_json).map_err(|_| "The call isn’t JSON.".to_owned())?;
    if params["server"].as_str() != Some(protocol::SERVER) {
        return Err("The call is for another server.".to_owned());
    }
    let name = params["tool"]
        .as_str()
        .ok_or("The call names no tool.")?
        .to_owned();
    if !published.contains(&name) {
        return Err(format!("There is no tool {name} here."));
    }
    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": name, "arguments": params.get("arguments").cloned().unwrap_or(json!({})) },
    })
    .to_string();
    let reply = host
        .mcp_in(&request, session)
        .ok_or("The Redlines tools aren’t available right now.")?;
    let reply: Value =
        serde_json::from_str(&reply).map_err(|_| "The tools gave no answer.".to_owned())?;
    if let Some(error) = reply.get("error") {
        return Err(error["message"]
            .as_str()
            .unwrap_or("The tool failed.")
            .to_owned());
    }
    Ok((name, reply["result"].to_string()))
}

/// How many calls may be out at once.
const MAX_PENDING: usize = 64;

/// A call's answer, on its way from the thread that made it to the one that writes.
struct Finished {
    id: String,
    node_id: String,
    answered: Result<(String, String), String>,
}

/// One connection, from opening to its end.
fn session(
    config: &Config,
    credential: &Credential,
    host: &Arc<dyn ToolHost>,
    emit: &mut dyn FnMut(Event),
    keep_token: &mut dyn FnMut(Secret),
    stop: &AtomicBool,
) -> Ended {
    let timing = config.timing;
    let mut socket = match open(&config.target, timing.open) {
        Ok(socket) => socket,
        Err(OpenError::TimedOut) => return Ended::Dropped("No answer in time.".into()),
        Err(OpenError::Unreachable(detail) | OpenError::NotAGateway(detail)) => {
            return Ended::Dropped(detail);
        }
    };
    set_poll(&mut socket, timing.poll);
    let outcome = run(
        &mut socket,
        config,
        credential,
        host,
        emit,
        keep_token,
        stop,
    );
    let _ = socket.close(None);
    outcome
}

fn run(
    socket: &mut Socket,
    config: &Config,
    credential: &Credential,
    host: &Arc<dyn ToolHost>,
    emit: &mut dyn FnMut(Event),
    keep_token: &mut dyn FnMut(Secret),
    stop: &AtomicBool,
) -> Ended {
    let timing = config.timing;
    let until = || Instant::now() + timing.open;

    // The greeting, within one deadline: a Gateway that talks of other things doesn't extend it.
    let greeting_until = until();
    let nonce = loop {
        match next_frame(socket, greeting_until, stop) {
            Ok(Some(text)) => {
                if let Incoming::Challenge { nonce } = protocol::parse(&text) {
                    break nonce;
                }
            }
            Ok(None) => return Ended::Dropped("The Gateway sent no greeting.".into()),
            Err(ended) => return ended,
        }
    };

    // Who this is, signed.
    let signed_at = now_ms();
    let device_id = config.identity.id();
    let secret = credential.secret().expose();
    let signature = config.identity.sign(&protocol::signed_text(
        &device_id, "node", signed_at, secret, &nonce,
    ));
    let connect = protocol::connect_request(&Connect {
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
    if let Err(ended) = send(socket, connect) {
        return ended;
    }
    let (ok, payload, error) = match response_to(socket, "1", until(), stop) {
        Ok(Some(answer)) => answer,
        Ok(None) => return Ended::Dropped("The Gateway didn’t answer connect.".into()),
        Err(ended) => return ended,
    };
    if !ok {
        let error = error.unwrap_or(protocol::WireError {
            code: String::new(),
            message: "The Gateway refused the connection.".into(),
            details: Value::Null,
        });
        return Ended::Refused(protocol::classify(
            &error,
            matches!(credential, Credential::SetupCode(_)),
        ));
    }
    // What the Gateway gave this device to use from now on.
    if let Some(token) = payload["auth"]["deviceToken"]
        .as_str()
        .and_then(|text| Secret::new(text).ok())
    {
        keep_token(token);
    }

    // The tools.
    let tools = tools_of(host.as_ref());
    let published: Arc<Vec<String>> = Arc::new(
        tools
            .iter()
            .filter_map(|tool| tool["name"].as_str().map(str::to_owned))
            .collect(),
    );
    if let Err(ended) = send(socket, protocol::plugin_tools_request("2", &tools)) {
        return ended;
    }
    emit(Event::Status(Status::Connected { tools: tools.len() }));

    // Calls, until the end. A call is answered on a thread of its own, so that one that waits on
    // the window (up to `timing.call`) holds back neither another call nor the pings; the answers
    // come back here, the one thread that writes, each with the id of its own call, in the order
    // they finish. A call still unanswered at its deadline is answered with an error, and the
    // late answer, when it comes, is dropped.
    let (finished_in, finished) = mpsc::channel::<Finished>();
    let mut pending: HashMap<String, (String, Instant)> = HashMap::new();
    let mut polling_fast = false;
    let mut last_heard = Instant::now();
    let mut last_ping = Instant::now();
    loop {
        if stop.load(Ordering::Relaxed) {
            return Ended::Stopped;
        }
        while let Ok(done) = finished.try_recv() {
            if pending.remove(&done.id).is_none() {
                continue;
            }
            let frame = match &done.answered {
                Ok((tool, result)) => {
                    emit(Event::Called { tool: tool.clone() });
                    protocol::invoke_result(&done.id, &done.node_id, Ok(result))
                }
                Err(message) => protocol::invoke_result(&done.id, &done.node_id, Err(message)),
            };
            if let Err(ended) = send(socket, frame) {
                return ended;
            }
        }
        let now = Instant::now();
        let late: Vec<String> = pending
            .iter()
            .filter(|(_, (_, deadline))| *deadline <= now)
            .map(|(id, _)| id.clone())
            .collect();
        for id in late {
            if let Some((node_id, _)) = pending.remove(&id) {
                let frame = protocol::invoke_result(
                    &id,
                    &node_id,
                    Err("The document didn’t answer in time."),
                );
                if let Err(ended) = send(socket, frame) {
                    return ended;
                }
            }
        }
        // While calls are out, an answer is looked for often; idle, the wait is the long one.
        if pending.is_empty() == polling_fast {
            polling_fast = !pending.is_empty();
            set_poll(
                socket,
                if polling_fast {
                    timing.poll.min(Duration::from_millis(20))
                } else {
                    timing.poll
                },
            );
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                last_heard = Instant::now();
                match protocol::parse(text.as_str()) {
                    Incoming::Invoke {
                        id,
                        node_id,
                        command,
                        params_json,
                        session_key,
                    } => {
                        // A call that is already out, or one too many, is refused, not run twice.
                        if pending.contains_key(&id) || pending.len() >= MAX_PENDING {
                            let frame = protocol::invoke_result(
                                &id,
                                &node_id,
                                Err("Redlines is busy with other calls."),
                            );
                            if let Err(ended) = send(socket, frame) {
                                return ended;
                            }
                            continue;
                        }
                        pending.insert(id.clone(), (node_id.clone(), Instant::now() + timing.call));
                        let (host, published, done) = (
                            Arc::clone(host),
                            Arc::clone(&published),
                            finished_in.clone(),
                        );
                        std::thread::spawn(move || {
                            let answered =
                                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                    answer_call(
                                        host.as_ref(),
                                        &published,
                                        &command,
                                        &params_json,
                                        session_key.as_deref(),
                                    )
                                }))
                                .unwrap_or_else(|_| {
                                    Err("The tool failed unexpectedly.".to_owned())
                                });
                            let _ = done.send(Finished {
                                id,
                                node_id,
                                answered,
                            });
                        });
                    }
                    Incoming::Response {
                        id,
                        ok: false,
                        error,
                        ..
                    } if id == "2" => {
                        let message = error.map_or_else(String::new, |error| error.message);
                        return Ended::ToolsRefused(message);
                    }
                    _ => {}
                }
            }
            Ok(Message::Close(_)) => {
                return Ended::Dropped("The Gateway closed the connection.".into());
            }
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
                        return Ended::Dropped("The connection broke.".into());
                    }
                }
                // Nothing at all, not even an answer to a ping, in three pings' time: gone.
                if last_heard.elapsed() > timing.ping_every * 3 {
                    return Ended::Dropped("The Gateway went quiet.".into());
                }
            }
            Err(error) => return Ended::Dropped(error.to_string()),
        }
    }
}

/// A node that is running: stop it, and it ends.
pub struct Running {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Running {
    /// Ends the connection and waits for the thread.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Running {
    /// Tells the connection to end, and doesn't wait for it: for the app quitting.
    pub fn signal(self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Sleeps `wait`, or less if `stop` is set.
fn nap(stop: &AtomicBool, wait: Duration) {
    let end = Instant::now() + wait;
    while Instant::now() < end && !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(10).min(wait));
    }
}

/// What stands for the device's token between connections: kept and read back by the caller (in
/// files, `connections.rs`).
pub trait TokenStore: Send {
    fn keep(&mut self, token: Secret);
    fn get(&self) -> Option<Secret>;
    /// Forgets the device's token: a new setup code starts a pairing from nothing, and a token
    /// from before it is never preferred to the code.
    fn forget(&mut self);
}

/// Starts the connection on a thread of its own, and keeps it up. `first` is what the first
/// connection proves itself with; once the Gateway has given this device a token, that is used.
pub fn start(
    config: Config,
    first: Credential,
    host: Arc<dyn ToolHost>,
    mut tokens: Box<dyn TokenStore>,
    mut emit: Box<dyn FnMut(Event) + Send>,
) -> Running {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let thread = std::thread::spawn(move || {
        let timing = config.timing;
        // A new setup code starts a fresh pairing, whatever this device held before: the token an
        // old pairing left behind (one the Gateway has since replaced) is dropped, never sent.
        if matches!(first, Credential::SetupCode(_)) {
            tokens.forget();
        }
        let mut first = Some(first);
        let mut wait = timing.backoff_start;
        let mut pairing_since: Option<Instant> = None;
        emit(Event::Status(Status::Connecting));
        loop {
            // The device's own token, once there is one; else what the person gave.
            let credential = match tokens.get() {
                Some(token) => Credential::DeviceToken(token),
                None => match first.take() {
                    Some(credential) => credential,
                    None => {
                        emit(Event::Status(Status::Failed(Failure::BadToken)));
                        return;
                    }
                },
            };
            let was_setup_code = matches!(credential, Credential::SetupCode(_));
            let began = Instant::now();
            let mut keep = |token: Secret| tokens.keep(token);
            let mut connected = false;
            let mut report = |event: Event| {
                if matches!(event, Event::Status(Status::Connected { .. })) {
                    connected = true;
                }
                emit(event);
            };
            let ended = session(&config, &credential, &host, &mut report, &mut keep, &flag);
            // A connection that held for a while starts the waits over; one that drops at once,
            // again and again, does not.
            if connected && began.elapsed() >= timing.backoff_max {
                wait = timing.backoff_start;
                pairing_since = None;
            }
            // A setup code is used once; if this connection didn't end in a token, it is spent.
            let _ = was_setup_code;
            match ended {
                Ended::Stopped => {
                    emit(Event::Status(Status::Stopped));
                    return;
                }
                Ended::Dropped(detail) => {
                    emit(Event::Status(Status::Reconnecting { detail }));
                    nap(&flag, wait);
                    wait = (wait * 2).min(timing.backoff_max);
                    first = Some(credential);
                }
                Ended::Refused(
                    Refusal::PairingRequired { request_id } | Refusal::ApproveAgain { request_id },
                ) => {
                    let since = *pairing_since.get_or_insert_with(Instant::now);
                    if since.elapsed() >= timing.pairing_window {
                        emit(Event::Status(Status::Failed(Failure::NotApproved)));
                        return;
                    }
                    emit(Event::Status(Status::Pairing {
                        request_id,
                        code: config.identity.short_code(),
                    }));
                    nap(&flag, timing.pairing_retry);
                    first = Some(credential);
                }
                Ended::Refused(Refusal::CodeUsed) => {
                    emit(Event::Status(Status::Failed(Failure::CodeUsed)));
                    return;
                }
                Ended::Refused(Refusal::BadToken) => {
                    emit(Event::Status(Status::Failed(Failure::BadToken)));
                    return;
                }
                Ended::Refused(Refusal::TooNew { protocol }) => {
                    emit(Event::Status(Status::Failed(Failure::TooNew { protocol })));
                    return;
                }
                Ended::Refused(Refusal::Other(message)) => {
                    emit(Event::Status(Status::Failed(Failure::Other { message })));
                    return;
                }
                Ended::ToolsRefused(message) => {
                    emit(Event::Status(Status::Failed(Failure::ToolsRefused {
                        message,
                    })));
                    return;
                }
            }
            if flag.load(Ordering::Relaxed) {
                emit(Event::Status(Status::Stopped));
                return;
            }
        }
    });
    Running {
        stop,
        thread: Some(thread),
    }
}

#[cfg(test)]
mod tests {
    use std::net::{TcpListener, TcpStream};
    use std::sync::Mutex;

    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    use super::super::gateway::target;
    use super::*;

    const SEED: &str = "0101010101010101010101010101010101010101010101010101010101010101";
    const TOKEN: &str = "sk-device-token-aaaa";
    const CODE: &str = "setup-code-bbbb";

    type Frames = Arc<Mutex<Vec<String>>>;
    type Ws = WebSocket<TcpStream>;
    type Handler = Box<dyn FnOnce(&mut Ws, &Frames) + Send>;

    /// A Gateway for the tests: one handler for each connection it takes, in order.
    struct Fake {
        target: Target,
        frames: Frames,
        thread: JoinHandle<()>,
    }

    fn fake(handlers: Vec<Handler>) -> Fake {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let frames: Frames = Arc::default();
        let seen = Arc::clone(&frames);
        let thread = std::thread::spawn(move || {
            for handler in handlers {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                if let Ok(mut socket) = tungstenite::accept(stream) {
                    handler(&mut socket, &seen);
                }
            }
        });
        Fake {
            target: target(&format!("ws://127.0.0.1:{port}"), None).unwrap(),
            frames,
            thread,
        }
    }

    fn read_frame(socket: &mut Ws, frames: &Frames) -> Option<Value> {
        loop {
            match socket.read() {
                Ok(Message::Text(text)) => {
                    frames.lock().unwrap().push(text.as_str().to_owned());
                    return serde_json::from_str(text.as_str()).ok();
                }
                Ok(Message::Close(_)) | Err(_) => return None,
                Ok(_) => {}
            }
        }
    }

    fn text(socket: &mut Ws, value: Value) {
        let _ = socket.send(Message::text(value.to_string()));
    }

    fn greet(socket: &mut Ws, nonce: &str) {
        text(
            socket,
            json!({"type": "event", "event": "connect.challenge", "payload": {"nonce": nonce}}),
        );
    }

    /// Reads the node's `connect` and checks its signature as a Gateway would. Returns its params.
    fn take_connect(socket: &mut Ws, frames: &Frames, nonce: &str) -> Value {
        let connect = read_frame(socket, frames).expect("a connect frame");
        assert_eq!(connect["method"], "connect");
        let params = connect["params"].clone();
        let device = &params["device"];
        assert_eq!(device["nonce"], nonce);
        let key = URL_SAFE_NO_PAD
            .decode(device["publicKey"].as_str().unwrap())
            .unwrap();
        // The id is the key's hash, so the Gateway is told no other.
        let id: String = Sha256::digest(&key)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(device["id"], id.as_str());
        let credential = params["auth"]["deviceToken"]
            .as_str()
            .or_else(|| params["auth"]["token"].as_str())
            .or_else(|| params["auth"]["bootstrapToken"].as_str())
            .unwrap();
        assert_eq!(params["client"]["deviceFamily"], "Mac");
        let signed = protocol::signed_text(
            &id,
            "node",
            device["signedAt"].as_u64().unwrap(),
            credential,
            nonce,
        );
        let signature = URL_SAFE_NO_PAD
            .decode(device["signature"].as_str().unwrap())
            .unwrap();
        let key = VerifyingKey::from_bytes(&key.try_into().unwrap()).unwrap();
        key.verify(
            signed.as_bytes(),
            &Signature::from_bytes(&signature.try_into().unwrap()),
        )
        .expect("the signature of the greeting's nonce");
        assert_eq!(params["role"], "node");
        assert_eq!(params["commands"], json!(["mcp.tools.call.v1"]));
        params
    }

    fn hello(socket: &mut Ws, device_token: Option<&str>) {
        let auth = device_token.map_or(json!({}), |token| json!({"deviceToken": token}));
        text(
            socket,
            json!({"type": "res", "id": "1", "ok": true,
            "payload": {"type": "hello-ok", "protocol": protocol::PROTOCOL, "auth": auth}}),
        );
    }

    fn refuse(socket: &mut Ws, code: &str, message: &str, details: Value) {
        text(
            socket,
            json!({"type": "res", "id": "1", "ok": false,
            "error": {"code": code, "message": message, "details": details}}),
        );
    }

    struct Tools;

    impl ToolHost for Tools {
        fn mcp(&self, request: &str) -> Option<String> {
            let request: Value = serde_json::from_str(request).ok()?;
            let reply = match request["method"].as_str()? {
                "tools/list" => json!({"jsonrpc": "2.0", "id": 1, "result": {"tools": [
                    {"name": "view", "description": "Read", "inputSchema": {"type": "object"}},
                    {"name": "comment", "description": "Comment", "inputSchema": {"type": "object"}},
                ]}}),
                "tools/call" if request["params"]["name"] == "view" => json!({
                "jsonrpc": "2.0", "id": 1,
                "result": {"content": [{"type": "text", "text": "Hello, document."}], "isError": false}}),
                // The slow one: a call that waits on a window.
                "tools/call" if request["params"]["name"] == "comment" => {
                    std::thread::sleep(Duration::from_millis(600));
                    json!({
                    "jsonrpc": "2.0", "id": 1,
                    "result": {"content": [{"type": "text", "text": "Commented."}], "isError": false}})
                }
                _ => {
                    json!({"jsonrpc": "2.0", "id": 1, "error": {"code": -32601, "message": "No such tool."}})
                }
            };
            Some(reply.to_string())
        }
    }

    struct Memory(Arc<Mutex<Option<String>>>);

    impl TokenStore for Memory {
        fn keep(&mut self, token: Secret) {
            *self.0.lock().unwrap() = Some(token.expose().to_owned());
        }
        fn get(&self) -> Option<Secret> {
            self.0
                .lock()
                .unwrap()
                .as_deref()
                .and_then(|text| Secret::new(text).ok())
        }
        fn forget(&mut self) {
            *self.0.lock().unwrap() = None;
        }
    }

    fn timing() -> Timing {
        Timing {
            open: Duration::from_secs(5),
            poll: Duration::from_millis(20),
            ping_every: Duration::from_secs(30),
            call: Duration::from_secs(5),
            pairing_retry: Duration::from_millis(30),
            pairing_window: Duration::from_millis(400),
            backoff_start: Duration::from_millis(20),
            backoff_max: Duration::from_millis(80),
        }
    }

    struct Run {
        node: Option<Running>,
        events: Arc<Mutex<Vec<Event>>>,
        token: Arc<Mutex<Option<String>>>,
    }

    impl Run {
        fn start(fake: &Fake, first: Credential, token: Option<&str>) -> Run {
            Run::start_with(fake, first, token, timing().call)
        }

        fn start_with(fake: &Fake, first: Credential, token: Option<&str>, call: Duration) -> Run {
            let events: Arc<Mutex<Vec<Event>>> = Arc::default();
            let kept = Arc::new(Mutex::new(token.map(str::to_owned)));
            let sink = Arc::clone(&events);
            let node = start(
                Config {
                    target: fake.target.clone(),
                    identity: Identity::from_seed(SEED).unwrap(),
                    display_name: "Redlines on Ada's MacBook".into(),
                    version: "0.2.0".into(),
                    timing: Timing { call, ..timing() },
                },
                first,
                Arc::new(Tools),
                Box::new(Memory(Arc::clone(&kept))),
                Box::new(move |event| sink.lock().unwrap().push(event)),
            );
            Run {
                node: Some(node),
                events,
                token: kept,
            }
        }

        fn wait(&self, what: &str, found: impl Fn(&Event) -> bool) {
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(5) {
                if self.events.lock().unwrap().iter().any(&found) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            panic!("never saw {what}: {:?}", self.events.lock().unwrap());
        }

        fn statuses(&self) -> Vec<Status> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter_map(|event| match event {
                    Event::Status(status) => Some(status.clone()),
                    Event::Called { .. } => None,
                })
                .collect()
        }

        fn stop(&mut self) {
            self.node.take().unwrap().stop();
        }
    }

    fn secret(text: &str) -> Secret {
        Secret::new(text).unwrap()
    }

    fn drain(socket: &mut Ws, frames: &Frames) {
        while read_frame(socket, frames).is_some() {}
    }

    #[test]
    fn a_token_connects_publishes_the_tools_and_answers_a_call() {
        let answered: Arc<Mutex<Option<Value>>> = Arc::default();
        let got = Arc::clone(&answered);
        let gateway = fake(vec![Box::new(move |socket, frames| {
            greet(socket, "n-1");
            take_connect(socket, frames, "n-1");
            hello(socket, None);
            let published = read_frame(socket, frames).unwrap();
            assert_eq!(published["method"], "node.pluginTools.update");
            let names: Vec<_> = published["params"]["tools"]
                .as_array()
                .unwrap()
                .iter()
                .map(|tool| {
                    (
                        tool["name"].as_str().unwrap().to_owned(),
                        tool["command"].clone(),
                    )
                })
                .collect();
            assert_eq!(names[0], ("view".to_owned(), json!("mcp.tools.call.v1")));
            assert_eq!(names.len(), 2);
            text(
                socket,
                json!({"type": "event", "event": "node.invoke.request", "payload": {
                "id": "c1", "nodeId": "n", "command": "mcp.tools.call.v1",
                "paramsJSON": "{\"server\":\"redlines\",\"tool\":\"view\",\"arguments\":{}}"}}),
            );
            *got.lock().unwrap() = read_frame(socket, frames);
            // A command that is not the one this node has, and a tool that isn't there.
            text(
                socket,
                json!({"type": "event", "event": "node.invoke.request", "payload": {
                "id": "c2", "nodeId": "n", "command": "system.run", "paramsJSON": "{}"}}),
            );
            let refused = read_frame(socket, frames).unwrap();
            assert_eq!(refused["params"]["ok"], false);
            assert!(
                refused["params"]["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("system.run")
            );
            text(
                socket,
                json!({"type": "event", "event": "node.invoke.request", "payload": {
                "id": "c3", "nodeId": "n", "command": "mcp.tools.call.v1",
                "paramsJSON": "{\"server\":\"redlines\",\"tool\":\"nope\"}"}}),
            );
            let missing = read_frame(socket, frames).unwrap();
            assert_eq!(missing["params"]["ok"], false);
            drain(socket, frames);
        })]);
        let mut run = Run::start(&gateway, Credential::Token(secret(TOKEN)), Some(TOKEN));
        run.wait("connected", |event| {
            *event == Event::Status(Status::Connected { tools: 2 })
        });
        run.wait("the call", |event| {
            *event
                == Event::Called {
                    tool: "view".into(),
                }
        });
        std::thread::sleep(Duration::from_millis(100));
        run.stop();
        gateway.thread.join().unwrap();
        let result = answered.lock().unwrap().clone().unwrap();
        assert_eq!(result["method"], "node.invoke.result");
        assert_eq!(result["params"]["id"], "c1");
        assert_eq!(result["params"]["ok"], true);
        let payload: Value =
            serde_json::from_str(result["params"]["payloadJSON"].as_str().unwrap()).unwrap();
        assert_eq!(payload["content"][0]["text"], "Hello, document.");
        assert_eq!(run.statuses().last(), Some(&Status::Stopped));
    }

    #[test]
    fn a_setup_code_is_exchanged_for_a_device_token_which_is_kept_and_never_repeated() {
        let gateway = fake(vec![Box::new(move |socket, frames| {
            greet(socket, "n-2");
            let params = take_connect(socket, frames, "n-2");
            assert_eq!(params["auth"], json!({"bootstrapToken": CODE}));
            hello(socket, Some("dt-from-the-gateway"));
            read_frame(socket, frames);
            drain(socket, frames);
        })]);
        let mut run = Run::start(&gateway, Credential::SetupCode(secret(CODE)), None);
        run.wait("connected", |event| {
            matches!(event, Event::Status(Status::Connected { .. }))
        });
        assert_eq!(
            run.token.lock().unwrap().as_deref(),
            Some("dt-from-the-gateway")
        );
        run.stop();
        gateway.thread.join().unwrap();
        // The code went out once, in the connect; the device token never went back out; neither
        // is in anything the node reported.
        let frames = gateway.frames.lock().unwrap();
        assert_eq!(
            frames.iter().filter(|frame| frame.contains(CODE)).count(),
            1
        );
        assert!(
            frames
                .iter()
                .all(|frame| !frame.contains("dt-from-the-gateway"))
        );
        let said = format!("{:?}", run.events.lock().unwrap());
        assert!(
            !said.contains(CODE) && !said.contains("dt-from-the-gateway"),
            "{said}"
        );
    }

    #[test]
    fn a_mac_that_isnt_approved_waits_shows_its_code_and_then_connects() {
        let gateway = fake(vec![
            Box::new(|socket, frames| {
                greet(socket, "a");
                take_connect(socket, frames, "a");
                refuse(
                    socket,
                    "NOT_PAIRED",
                    "pairing required",
                    json!({"requestId": "req-7"}),
                );
            }),
            Box::new(|socket, frames| {
                greet(socket, "b");
                take_connect(socket, frames, "b");
                hello(socket, Some("dt"));
                read_frame(socket, frames);
                drain(socket, frames);
            }),
        ]);
        let mut run = Run::start(&gateway, Credential::SetupCode(secret(CODE)), None);
        run.wait("connected", |event| {
            matches!(event, Event::Status(Status::Connected { .. }))
        });
        run.stop();
        gateway.thread.join().unwrap();
        let identity = Identity::from_seed(SEED).unwrap();
        let code = identity.short_code();
        assert_eq!(code.len(), 7);
        assert!(run.statuses().contains(&Status::Pairing {
            request_id: Some("req-7".into()),
            code
        }));
    }

    /// #1154: a device-token reconnect that the Gateway wants approved again (`metadata-upgrade`)
    /// is told apart from a first pairing in the Gateway's words, and the node waits for it as it
    /// does for a pairing: it is told `wait_then_retry`.
    #[test]
    fn a_reconnect_that_needs_approval_again_waits_as_a_pairing_does() {
        let gateway = fake(vec![
            Box::new(|socket, frames| {
                greet(socket, "a");
                let params = take_connect(socket, frames, "a");
                assert_eq!(params["auth"], json!({"deviceToken": TOKEN}));
                refuse(
                    socket,
                    "NOT_PAIRED",
                    "pairing required: device identity changed and must be re-approved",
                    json!({"code": "PAIRING_REQUIRED", "reason": "metadata-upgrade",
                        "requestId": "req-8", "recommendedNextStep": "wait_then_retry"}),
                );
            }),
            Box::new(|socket, frames| {
                greet(socket, "b");
                take_connect(socket, frames, "b");
                hello(socket, Some("dt-rotated"));
                read_frame(socket, frames);
                drain(socket, frames);
            }),
        ]);
        let mut run = Run::start(
            &gateway,
            Credential::DeviceToken(secret(TOKEN)),
            Some(TOKEN),
        );
        run.wait("connected", |event| {
            matches!(event, Event::Status(Status::Connected { .. }))
        });
        run.stop();
        gateway.thread.join().unwrap();
        assert!(run.statuses().iter().any(
            |status| matches!(status, Status::Pairing { request_id: Some(id), .. } if id == "req-8")
        ));
        assert_eq!(run.token.lock().unwrap().as_deref(), Some("dt-rotated"));
    }

    /// #1161: a new setup code starts a fresh pairing, whatever an old pairing left behind. The
    /// stale device token is not sent in its place, and the token the code earns replaces it.
    #[test]
    fn a_new_setup_code_is_sent_whatever_token_an_old_pairing_left() {
        let gateway = fake(vec![Box::new(|socket, frames| {
            greet(socket, "n-fresh");
            let params = take_connect(socket, frames, "n-fresh");
            assert_eq!(params["auth"], json!({"bootstrapToken": CODE}));
            hello(socket, Some("dt-new"));
            read_frame(socket, frames);
            drain(socket, frames);
        })]);
        let mut run = Run::start(
            &gateway,
            Credential::SetupCode(secret(CODE)),
            Some("dt-stale"),
        );
        run.wait("connected", |event| {
            matches!(event, Event::Status(Status::Connected { .. }))
        });
        run.stop();
        gateway.thread.join().unwrap();
        assert_eq!(run.token.lock().unwrap().as_deref(), Some("dt-new"));
        assert!(
            !run.statuses()
                .iter()
                .any(|s| matches!(s, Status::Failed(_)))
        );
    }

    #[test]
    fn a_mac_nobody_approves_gives_up_when_the_request_runs_out() {
        let handlers: Vec<Handler> = (0..40)
            .map(|n| -> Handler {
                Box::new(move |socket, frames| {
                    let nonce = format!("n{n}");
                    greet(socket, &nonce);
                    take_connect(socket, frames, &nonce);
                    refuse(socket, "NOT_PAIRED", "pairing required", json!({}));
                })
            })
            .collect();
        let gateway = fake(handlers);
        let run = Run::start(&gateway, Credential::Token(secret(TOKEN)), Some(TOKEN));
        run.wait("the end", |event| {
            *event == Event::Status(Status::Failed(Failure::NotApproved))
        });
        drop(run);
    }

    #[test]
    fn what_trying_again_cant_fix_stops_and_says_why() {
        for (code, message, setup, expected) in [
            (
                "UNAUTHORIZED",
                "bootstrap token expired",
                true,
                Failure::CodeUsed,
            ),
            ("UNAUTHORIZED", "invalid token", false, Failure::BadToken),
        ] {
            let gateway = fake(vec![Box::new(move |socket, frames| {
                greet(socket, "n");
                take_connect(socket, frames, "n");
                refuse(socket, code, message, json!({}));
            })]);
            let credential = if setup {
                Credential::SetupCode(secret(CODE))
            } else {
                Credential::Token(secret(TOKEN))
            };
            let run = Run::start(&gateway, credential, if setup { None } else { Some(TOKEN) });
            run.wait("the failure", |event| {
                *event == Event::Status(Status::Failed(expected.clone()))
            });
            // One connection only: no retry of a refusal.
            gateway.thread.join().unwrap();
        }
    }

    #[test]
    fn a_slow_call_holds_back_neither_a_fast_one_nor_the_pings() {
        let order: Arc<Mutex<Vec<(String, u128)>>> = Arc::default();
        let seen = Arc::clone(&order);
        let gateway = fake(vec![Box::new(move |socket, frames| {
            greet(socket, "n-9");
            take_connect(socket, frames, "n-9");
            hello(socket, None);
            read_frame(socket, frames);
            let began = Instant::now();
            // The slow one first, then the fast one.
            for (id, tool) in [("slow", "comment"), ("fast", "view")] {
                text(
                    socket,
                    json!({"type": "event", "event": "node.invoke.request", "payload": {
                    "id": id, "nodeId": "n", "command": "mcp.tools.call.v1",
                    "paramsJSON": format!("{{\"server\":\"redlines\",\"tool\":\"{tool}\",\"arguments\":{{}}}}")}}),
                );
            }
            for _ in 0..2 {
                let result = read_frame(socket, frames).unwrap();
                assert_eq!(result["params"]["ok"], true);
                seen.lock().unwrap().push((
                    result["params"]["id"].as_str().unwrap().to_owned(),
                    began.elapsed().as_millis(),
                ));
            }
            drain(socket, frames);
        })]);
        let mut run = Run::start(&gateway, Credential::Token(secret(TOKEN)), Some(TOKEN));
        run.wait("both calls", |event| {
            *event
                == Event::Called {
                    tool: "comment".into(),
                }
        });
        run.stop();
        gateway.thread.join().unwrap();
        let order = order.lock().unwrap().clone();
        let ids: Vec<&str> = order.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, ["fast", "slow"], "the fast call is answered first");
        assert!(
            order[0].1 < 400,
            "and without waiting on the slow one: {order:?}"
        );
    }

    #[test]
    fn a_call_that_never_answers_is_answered_with_an_error_at_its_deadline() {
        let gateway = fake(vec![Box::new(move |socket, frames| {
            greet(socket, "n-10");
            take_connect(socket, frames, "n-10");
            hello(socket, None);
            read_frame(socket, frames);
            text(
                socket,
                json!({"type": "event", "event": "node.invoke.request", "payload": {
                "id": "stuck", "nodeId": "n", "command": "mcp.tools.call.v1",
                "paramsJSON": "{\"server\":\"redlines\",\"tool\":\"comment\",\"arguments\":{}}"}}),
            );
            let result = read_frame(socket, frames).unwrap();
            assert_eq!(result["params"]["id"], "stuck");
            assert_eq!(result["params"]["ok"], false);
            drain(socket, frames);
        })]);
        let mut run = Run::start_with(
            &gateway,
            Credential::Token(secret(TOKEN)),
            Some(TOKEN),
            Duration::from_millis(100),
        );
        std::thread::sleep(Duration::from_millis(400));
        run.stop();
        gateway.thread.join().unwrap();
    }

    #[test]
    fn a_call_for_another_server_or_no_tool_is_refused() {
        let published = vec!["view".to_owned()];
        for params in [
            r#"{"server":"other","tool":"view"}"#,
            r#"{"tool":"view"}"#,
            r#"{"server":"redlines"}"#,
            r#"{"server":"redlines","tool":""}"#,
        ] {
            assert!(
                answer_call(&Tools, &published, COMMAND, params, None).is_err(),
                "{params}"
            );
        }
        let good = r#"{"server":"redlines","tool":"view"}"#;
        assert!(answer_call(&Tools, &published, COMMAND, good, None).is_ok());
    }

    #[test]
    fn a_gateway_with_a_newer_protocol_is_said_to_be_newer() {
        let gateway = fake(vec![Box::new(|socket, frames| {
            greet(socket, "n");
            take_connect(socket, frames, "n");
            text(
                socket,
                json!({"type": "res", "id": "1", "ok": false, "error": {"code": "INVALID_REQUEST",
                    "message": "protocol mismatch", "details": {"maxProtocol": 99}}}),
            );
        })]);
        let run = Run::start(&gateway, Credential::Token(secret(TOKEN)), Some(TOKEN));
        run.wait("too new", |event| {
            *event == Event::Status(Status::Failed(Failure::TooNew { protocol: Some(99) }))
        });
        gateway.thread.join().unwrap();
    }

    #[test]
    fn a_gateway_that_refuses_the_tools_is_a_tools_failure() {
        let gateway = fake(vec![Box::new(|socket, frames| {
            greet(socket, "n");
            take_connect(socket, frames, "n");
            hello(socket, None);
            read_frame(socket, frames);
            text(
                socket,
                json!({"type": "res", "id": "2", "ok": false,
                "error": {"code": "FORBIDDEN", "message": "plugin tools are off"}}),
            );
        })]);
        let run = Run::start(&gateway, Credential::Token(secret(TOKEN)), Some(TOKEN));
        run.wait("tools refused", |event| {
            *event
                == Event::Status(Status::Failed(Failure::ToolsRefused {
                    message: "plugin tools are off".into(),
                }))
        });
        gateway.thread.join().unwrap();
    }

    #[test]
    fn a_dropped_connection_is_made_again_with_the_device_token() {
        let gateway = fake(vec![
            Box::new(|socket, frames| {
                greet(socket, "a");
                take_connect(socket, frames, "a");
                hello(socket, Some("dt-1"));
                read_frame(socket, frames);
                // Gone, with no goodbye.
            }),
            Box::new(|socket, frames| {
                greet(socket, "b");
                let params = take_connect(socket, frames, "b");
                assert_eq!(
                    params["auth"],
                    json!({"deviceToken": "dt-1"}),
                    "the device's own token from now on, as a device token"
                );
                hello(socket, None);
                read_frame(socket, frames);
                drain(socket, frames);
            }),
        ]);
        let mut run = Run::start(&gateway, Credential::SetupCode(secret(CODE)), None);
        run.wait("a second connection", |event| {
            matches!(event, Event::Status(Status::Reconnecting { .. }))
        });
        let started = Instant::now();
        while run
            .statuses()
            .iter()
            .filter(|s| matches!(s, Status::Connected { .. }))
            .count()
            < 2
        {
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "{:?}",
                run.statuses()
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        run.stop();
        gateway.thread.join().unwrap();
    }

    #[test]
    fn nobody_listening_is_retried_and_stop_ends_it_at_once() {
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let nobody = Fake {
            target: target(&format!("ws://127.0.0.1:{port}"), None).unwrap(),
            frames: Arc::default(),
            thread: std::thread::spawn(|| {}),
        };
        let mut run = Run::start(&nobody, Credential::Token(secret(TOKEN)), Some(TOKEN));
        run.wait("a retry", |event| {
            matches!(event, Event::Status(Status::Reconnecting { .. }))
        });
        let started = Instant::now();
        run.stop();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(run.statuses().last(), Some(&Status::Stopped));
    }

    #[test]
    fn a_device_is_its_keys_hash_and_a_bad_seed_is_no_device() {
        let identity = Identity::from_seed(SEED).unwrap();
        assert_eq!(identity.id().len(), 64);
        assert_eq!(identity.short_code().len(), 7);
        assert_eq!(identity.id(), Identity::from_seed(SEED).unwrap().id());
        assert_ne!(
            identity.id(),
            Identity::from_seed(&"02".repeat(32)).unwrap().id()
        );
        for bad in [
            "",
            "xyz",
            &"0".repeat(63),
            &"g".repeat(64),
            "é".repeat(32).as_str(),
        ] {
            assert!(Identity::from_seed(bad).is_none(), "{bad:?}");
        }
    }
    #[test]
    fn a_status_reaches_the_page_in_the_shape_the_sheet_reads() {
        let said = |status: Status| serde_json::to_value(status).unwrap();
        assert_eq!(said(Status::Connecting), json!({"state": "connecting"}));
        assert_eq!(
            said(Status::Pairing {
                request_id: Some("r".into()),
                code: "7QF-2K9".into()
            }),
            json!({"state": "pairing", "request_id": "r", "code": "7QF-2K9"})
        );
        assert_eq!(
            said(Status::Connected { tools: 6 }),
            json!({"state": "connected", "tools": 6})
        );
        assert_eq!(
            said(Status::Failed(Failure::CodeUsed)),
            json!({"state": "failed", "why": "code-used"})
        );
        assert_eq!(
            said(Status::Failed(Failure::TooNew { protocol: Some(4) })),
            json!({"state": "failed", "why": "too-new", "protocol": 4})
        );
        assert_eq!(
            said(Status::Failed(Failure::ToolsRefused {
                message: "off".into()
            })),
            json!({"state": "failed", "why": "tools-refused", "message": "off"})
        );
    }

    /// The live test: a real Gateway, by hand (docs/research/openclaw-connection.md, "First live
    /// test"). `REDLINES_LIVE_GATEWAY=ws://127.0.0.1:PORT` and either `REDLINES_LIVE_TOKEN=...` or
    /// `REDLINES_LIVE_CODE=<a setup code>`; optionally `REDLINES_LIVE_SEED` (64 hex digits: a new
    /// device) and `REDLINES_LIVE_SECONDS` (default 60). Prints every event to stderr. Use
    /// `rtk proxy cargo test live_gateway -- --ignored --nocapture` to see them.
    #[test]
    #[ignore = "needs a Gateway, see REDLINES_LIVE_GATEWAY"]
    fn live_gateway() {
        struct Six;
        impl ToolHost for Six {
            fn mcp(&self, request: &str) -> Option<String> {
                let request: Value = serde_json::from_str(request).ok()?;
                let tools: Value =
                    serde_json::from_str(include_str!("openclaw-tools.json")).ok()?;
                Some(
                    match request["method"].as_str()? {
                        "tools/list" => {
                            json!({"jsonrpc": "2.0", "id": 1, "result": {"tools": tools}})
                        }
                        _ => json!({"jsonrpc": "2.0", "id": 1, "result": {"content": [
                        {"type": "text", "text": "No document is open (live test)."}],
                        "isError": false}}),
                    }
                    .to_string(),
                )
            }
        }
        let Ok(address) = std::env::var("REDLINES_LIVE_GATEWAY") else {
            return;
        };
        let first = match std::env::var("REDLINES_LIVE_CODE") {
            Ok(code) => Credential::SetupCode(secret(&protocol::bootstrap_token(&code).unwrap())),
            Err(_) => Credential::Token(secret(&std::env::var("REDLINES_LIVE_TOKEN").unwrap())),
        };
        let seed = std::env::var("REDLINES_LIVE_SEED").unwrap_or_else(|_| SEED.to_owned());
        let seconds: u64 = std::env::var("REDLINES_LIVE_SECONDS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60);
        let kept = Arc::new(Mutex::new(std::env::var("REDLINES_LIVE_DEVICE_TOKEN").ok()));
        let device_token = Arc::clone(&kept);
        let node = start(
            Config {
                target: target(&address, None).unwrap(),
                identity: Identity::from_seed(&seed).unwrap(),
                display_name: "Redlines live test".into(),
                version: "0.2.0".into(),
                timing: Timing::default(),
            },
            first,
            Arc::new(Six),
            Box::new(Memory(kept)),
            Box::new(|event| eprintln!("LIVE {event:?}")),
        );
        std::thread::sleep(Duration::from_secs(seconds));
        eprintln!(
            "LIVE device token kept: {}",
            device_token.lock().unwrap().is_some()
        );
        node.stop();
    }
}
