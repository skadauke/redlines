//! What Redlines says to an OpenClaw Gateway as a node, and what it understands back: every frame's
//! shape, in one place (docs/research/openclaw-connection.md, "The node connection").
//!
//! **These shapes were first written from OpenClaw's documentation, and then checked against a
//! live `openclaw@2026.11.5` Gateway** (docs/research/openclaw-connection.md, "First live test",
//! "What the live test found"). This is the only place to change when a Gateway says otherwise.
//! What is assumed:
//!
//! - frames are JSON text: `{"type":"req","id","method","params"}` from the client,
//!   `{"type":"res","id","ok","payload"|"error"}` back, and `{"type":"event","event","payload"}`
//!   from the Gateway, among them the greeting `connect.challenge` with a `nonce`;
//! - the first request is `connect`, with the role `node`, the one command `mcp.tools.call.v1`, a
//!   token or a setup code, and this Mac's device: its id (the SHA-256 of its Ed25519 public key,
//!   in hex), the key, and a signature of a text that holds the Gateway's nonce;
//! - `hello-ok` carries the protocol it speaks and a `deviceToken` to use from then on;
//! - the node's tools are published with `node.pluginTools.update`;
//! - a call arrives as the event `node.invoke.request` and is answered with the request
//!   `node.invoke.result`.
//!
//! Checked against a live `openclaw@2026.11.5` Gateway (Epic #930's first live test): the client id
//! must be one of a closed list (`node-host`), a published tool is a closed descriptor
//! (`pluginId: "node-mcp"`, `parameters`, `mcp: {server, tool}`), and a call's `paramsJSON` is
//! `{server, tool, arguments}`.
//!
//! A Gateway that can't speak [`PROTOCOL`] refuses `connect`, and `classify` tells that apart, so
//! that the sheet says "this Gateway is newer than Redlines knows". A live Gateway answers
//! `hello-ok` with its own protocol (4) to a node that offered 3, as its own node host does, so a
//! `hello-ok` is never judged by its number.

use serde_json::{Value, json};

/// The protocol version this was written against, and the only one it offers.
pub const PROTOCOL: u64 = 3;

/// The one command this node declares, and so the only one a Gateway may send it. Never
/// `system.run` or anything that runs a program.
pub const COMMAND: &str = "mcp.tools.call.v1";

/// What this client calls itself. The Gateway checks `client.id` against a closed list (a live
/// Gateway answered "must be one of: webchat-ui, openclaw-control-ui, ... node-host"), so a third
/// party can't have an id of its own: a node says `node-host`, and the Gateway's owner tells it
/// apart by its display name and its device.
pub const CLIENT_ID: &str = "node-host";

/// The name of the MCP server the tools are published under (the Gateway sends it back in a call).
pub const SERVER: &str = "redlines";

/// The plugin id the Gateway reserves for a node's MCP tools.
pub const PLUGIN_ID: &str = "node-mcp";

/// What an operator client calls itself. A third party can't have an id of its own (the list is
/// closed, see [`CLIENT_ID`]); `gateway-client` in mode `backend` is what a program that talks to a
/// Gateway for its owner is, and a live Gateway accepted it for a chat client (see "The other
/// direction" in docs/research/openclaw-connection.md).
pub const OPERATOR_CLIENT_ID: &str = "gateway-client";
pub const OPERATOR_MODE: &str = "backend";

/// The protocol an operator speaks. A live Gateway refuses an operator that offers the node's 3
/// ("protocol mismatch", expected 4), though it takes a node's 3.
pub const OPERATOR_PROTOCOL: u64 = 4;

/// What an operator may do here: read what a session said, and write to a session. Nothing else
/// (no `operator.admin`, no pairing, no approvals).
pub const OPERATOR_SCOPES: [&str; 2] = ["operator.read", "operator.write"];

/// A Gateway's error: a code and a line, and what else it said.
#[derive(Clone, Debug, PartialEq)]
pub struct WireError {
    pub code: String,
    pub message: String,
    pub details: Value,
}

/// A frame from the Gateway, as far as this understands it.
#[derive(Clone, Debug, PartialEq)]
pub enum Incoming {
    /// The greeting, with the number to sign.
    Challenge { nonce: String },
    /// The answer to one of this client's requests.
    Response {
        id: String,
        ok: bool,
        payload: Value,
        error: Option<WireError>,
    },
    /// A tool call for this node.
    Invoke {
        id: String,
        node_id: String,
        command: String,
        params_json: String,
    },
    /// A step of a chat run: what the agent said so far, or how it ended.
    Chat(ChatEvent),
    /// Anything else (a tick, a presence event): ignored.
    Other,
}

/// What the Gateway says of a run started by `chat.send` (the event `chat`).
#[derive(Clone, Debug, PartialEq)]
pub struct ChatEvent {
    pub run_id: String,
    pub session_key: String,
    pub state: ChatState,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ChatState {
    /// Progress with no words (`preparing_workspace`, `starting_model`): not an answer.
    Status,
    /// More of the answer: the new words, or, when `replace`, the whole text so far.
    Delta {
        text: String,
        replace: bool,
    },
    /// The answer, whole.
    Final {
        text: String,
    },
    Aborted,
    Error {
        message: String,
    },
}

/// The text of a chat message as the Gateway writes it: `content` is a list of `{type, text}`.
fn message_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|part| part.get("type").and_then(Value::as_str).unwrap_or("text") == "text")
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// Reads a text frame. Anything that isn't a frame is `Other`.
pub fn parse(text: &str) -> Incoming {
    let Ok(frame) = serde_json::from_str::<Value>(text) else {
        return Incoming::Other;
    };
    let string =
        |value: &Value, key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
    match frame.get("type").and_then(Value::as_str) {
        Some("event") => {
            let payload = frame.get("payload").cloned().unwrap_or(Value::Null);
            match frame.get("event").and_then(Value::as_str) {
                Some("connect.challenge") => match string(&payload, "nonce") {
                    Some(nonce) => Incoming::Challenge { nonce },
                    None => Incoming::Other,
                },
                Some("chat") => {
                    let (Some(run_id), Some(session_key)) =
                        (string(&payload, "runId"), string(&payload, "sessionKey"))
                    else {
                        return Incoming::Other;
                    };
                    let message = payload.get("message").cloned().unwrap_or(Value::Null);
                    let state = match payload.get("state").and_then(Value::as_str) {
                        Some("delta") => ChatState::Delta {
                            text: string(&payload, "deltaText")
                                .unwrap_or_else(|| message_text(&message)),
                            replace: payload.get("replace").and_then(Value::as_bool) == Some(true),
                        },
                        Some("final") => ChatState::Final {
                            text: message_text(&message),
                        },
                        Some("aborted") => ChatState::Aborted,
                        Some("error") => ChatState::Error {
                            message: string(&payload, "errorMessage")
                                .or_else(|| string(&payload, "error"))
                                .unwrap_or_else(|| "The agent failed.".to_owned()),
                        },
                        _ => ChatState::Status,
                    };
                    Incoming::Chat(ChatEvent {
                        run_id,
                        session_key,
                        state,
                    })
                }
                Some("node.invoke.request") => {
                    let params_json = match payload.get("paramsJSON") {
                        Some(Value::String(text)) => text.clone(),
                        Some(other) => other.to_string(),
                        None => payload
                            .get("params")
                            .map_or_else(|| "{}".to_owned(), Value::to_string),
                    };
                    match (string(&payload, "id"), string(&payload, "command")) {
                        (Some(id), Some(command)) => Incoming::Invoke {
                            id,
                            node_id: string(&payload, "nodeId").unwrap_or_default(),
                            command,
                            params_json,
                        },
                        _ => Incoming::Other,
                    }
                }
                _ => Incoming::Other,
            }
        }
        Some("res") => {
            let Some(id) = string(&frame, "id") else {
                return Incoming::Other;
            };
            let error = frame
                .get("error")
                .filter(|e| !e.is_null())
                .map(|error| WireError {
                    code: string(error, "code").unwrap_or_default(),
                    message: string(error, "message").unwrap_or_default(),
                    details: error.get("details").cloned().unwrap_or(Value::Null),
                });
            Incoming::Response {
                id,
                ok: frame
                    .get("ok")
                    .and_then(Value::as_bool)
                    .unwrap_or(error.is_none()),
                payload: frame.get("payload").cloned().unwrap_or(Value::Null),
                error,
            }
        }
        _ => Incoming::Other,
    }
}

/// How the Gateway answered a `connect` that wasn't `hello-ok`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// This Mac isn't paired yet: its request waits for the Gateway's owner to approve it.
    PairingRequired { request_id: Option<String> },
    /// The setup code was used or has run out.
    CodeUsed,
    /// The token, or the device's token, isn't accepted.
    BadToken,
    /// The Gateway speaks a newer protocol than this knows.
    TooNew { protocol: Option<u64> },
    /// Another reason, in the Gateway's words, for Details.
    Other(String),
}

/// What an error from `connect` means. It looks at the code and, failing that, the words, since
/// neither is known exactly: see the header.
pub fn classify(error: &WireError, offered_setup_code: bool) -> Refusal {
    // Whole words, from the code and the message: "auth" in "too many auth attempts" is not a
    // refusal of the token.
    let text = format!("{} {}", error.code, error.message).to_ascii_lowercase();
    let words: Vec<&str> = text
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    let has = |wanted: &[&str]| wanted.iter().any(|word| words.contains(word));
    let phrase = |wanted: &str| words.join(" ").contains(wanted);
    if has(&["pairing"]) || phrase("not paired") || phrase("pending approval") {
        let request_id = ["requestId", "request_id"]
            .iter()
            .find_map(|key| error.details.get(key).and_then(Value::as_str))
            .map(str::to_owned);
        return Refusal::PairingRequired { request_id };
    }
    if has(&["protocol"]) && has(&["mismatch", "unsupported", "newer", "version", "unknown"]) {
        let protocol = error
            .details
            .get("maxProtocol")
            .or_else(|| error.details.get("protocol"))
            .and_then(Value::as_u64);
        return Refusal::TooNew { protocol };
    }
    if has(&["bootstrap"]) || phrase("setup code") {
        return Refusal::CodeUsed;
    }
    let refused = has(&["unauthorized", "unauthenticated", "forbidden"]);
    let spent = has(&[
        "expired", "used", "revoked", "invalid", "unknown", "mismatch", "missing",
    ]);
    if refused || (has(&["token"]) && spent) {
        return if offered_setup_code {
            Refusal::CodeUsed
        } else {
            Refusal::BadToken
        };
    }
    Refusal::Other(if error.message.is_empty() {
        error.code.clone()
    } else {
        error.message.clone()
    })
}

/// What a setup code holds: `openclaw qr --setup-code-only` prints base64url of
/// `{"url": ..., "bootstrapToken": ..., "expiresAtMs": ...}` (a live Gateway's), and a Gateway
/// takes only the bootstrap token in `auth.bootstrapToken`. A person may paste the whole code or,
/// from an older agent, the bare token; either way this gives the token. `None` for a code that is
/// JSON with no token.
pub fn bootstrap_token(pasted: &str) -> Option<String> {
    use base64::Engine as _;
    // A code that a chat or a terminal wrapped has line breaks inside it.
    let text = pasted
        .split_whitespace()
        .collect::<String>()
        .trim_end_matches('=')
        .replace('+', "-")
        .replace('/', "_");
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(text.as_bytes())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    match decoded {
        Some(Value::Object(object)) => object
            .get("bootstrapToken")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .map(str::to_owned),
        _ => Some(pasted.split_whitespace().collect()),
    }
}

/// The text the device signs: what the Gateway checks against the key it was given, so that the
/// connection is this Mac's and can't be replayed (the nonce is the Gateway's, fresh each time).
pub fn signed_text(
    device_id: &str,
    role: &str,
    signed_at_ms: u64,
    credential: &str,
    nonce: &str,
) -> String {
    format!("v2|{device_id}|{CLIENT_ID}|{role}|{role}||{signed_at_ms}|{credential}|{nonce}")
}

/// The same for an operator: its own client id and mode, and its scopes, comma-joined.
pub fn operator_signed_text(
    device_id: &str,
    signed_at_ms: u64,
    credential: &str,
    nonce: &str,
) -> String {
    format!(
        "v2|{device_id}|{OPERATOR_CLIENT_ID}|{OPERATOR_MODE}|operator|{}|{signed_at_ms}|{credential}|{nonce}",
        OPERATOR_SCOPES.join(",")
    )
}

/// What a `connect` carries, apart from the device's signature.
pub struct Connect<'a> {
    pub id: &'a str,
    pub display_name: &'a str,
    pub version: &'a str,
    pub device_id: &'a str,
    pub public_key: &'a str,
    pub signature: &'a str,
    pub signed_at_ms: u64,
    pub nonce: &'a str,
    /// `token` for a token (the device's, or one the person typed), `bootstrapToken` for a setup
    /// code.
    pub credential_kind: &'a str,
    pub credential: &'a str,
}

pub fn connect_request(c: &Connect<'_>) -> String {
    json!({
        "type": "req",
        "id": c.id,
        "method": "connect",
        "params": {
            "minProtocol": PROTOCOL,
            "maxProtocol": PROTOCOL,
            "client": {
                "id": CLIENT_ID,
                "displayName": c.display_name,
                "version": c.version,
                "platform": "macos",
                "mode": "node",
            },
            "role": "node",
            "scopes": [],
            "caps": ["mcp"],
            "commands": [COMMAND],
            "permissions": {},
            "auth": { (c.credential_kind): c.credential },
            "device": {
                "id": c.device_id,
                "publicKey": c.public_key,
                "signature": c.signature,
                "signedAt": c.signed_at_ms,
                "nonce": c.nonce,
            },
        },
    })
    .to_string()
}

/// The operator's `connect`: the same device as the node's, the role `operator`, and the two scopes
/// that read and write a session.
pub fn operator_connect_request(c: &Connect<'_>) -> String {
    json!({
        "type": "req",
        "id": c.id,
        "method": "connect",
        "params": {
            "minProtocol": OPERATOR_PROTOCOL,
            "maxProtocol": OPERATOR_PROTOCOL,
            "client": {
                "id": OPERATOR_CLIENT_ID,
                "displayName": c.display_name,
                "version": c.version,
                "platform": "macos",
                "mode": OPERATOR_MODE,
            },
            "role": "operator",
            "scopes": OPERATOR_SCOPES,
            "caps": [],
            "commands": [],
            "permissions": {},
            "auth": { (c.credential_kind): c.credential },
            "device": {
                "id": c.device_id,
                "publicKey": c.public_key,
                "signature": c.signature,
                "signedAt": c.signed_at_ms,
                "nonce": c.nonce,
            },
        },
    })
    .to_string()
}

/// A message into an agent's session, the way OpenClaw's own apps chat. `key` makes a repeat of the
/// same send one run, and is the run's id in the events.
pub fn chat_send_request(id: &str, session_key: &str, message: &str, key: &str) -> String {
    json!({
        "type": "req",
        "id": id,
        "method": "chat.send",
        "params": { "sessionKey": session_key, "message": message, "idempotencyKey": key },
    })
    .to_string()
}

/// Stops a run in a session.
pub fn chat_abort_request(id: &str, session_key: &str, run_id: &str) -> String {
    json!({
        "type": "req",
        "id": id,
        "method": "chat.abort",
        "params": { "sessionKey": session_key, "runId": run_id },
    })
    .to_string()
}

/// Publishes the node's tools: MCP's own descriptors (`name`, `description`, `inputSchema`), each
/// tied to the one command.
pub fn plugin_tools_request(id: &str, tools: &[Value]) -> String {
    let tools: Vec<Value> = tools
        .iter()
        .filter_map(|tool| {
            // The Gateway's descriptor is a closed object: `parameters` where MCP says
            // `inputSchema`, and the MCP server and tool a call is routed to.
            let name = tool.get("name")?.as_str()?;
            let description = tool
                .get("description")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .unwrap_or(name);
            Some(json!({
                "pluginId": PLUGIN_ID,
                "name": name,
                "description": description,
                "parameters": tool.get("inputSchema").cloned().unwrap_or_else(|| json!({"type": "object"})),
                "command": COMMAND,
                "mcp": { "server": SERVER, "tool": name },
            }))
        })
        .collect();
    json!({
        "type": "req",
        "id": id,
        "method": "node.pluginTools.update",
        "params": { "tools": tools },
    })
    .to_string()
}

/// The answer to a call: the MCP result as text, or an error line.
pub fn invoke_result(id: &str, node_id: &str, outcome: Result<&str, &str>) -> String {
    let params = match outcome {
        Ok(payload) => json!({ "id": id, "nodeId": node_id, "ok": true, "payloadJSON": payload }),
        Err(message) => json!({
            "id": id,
            "nodeId": node_id,
            "ok": false,
            "error": { "code": "UNAVAILABLE", "message": message },
        }),
    };
    json!({
        "type": "req",
        "id": format!("result-{id}"),
        "method": "node.invoke.result",
        "params": params,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_greeting_and_a_call_are_read() {
        let greeting =
            r#"{"type":"event","event":"connect.challenge","payload":{"nonce":"n1","ts":5}}"#;
        assert_eq!(parse(greeting), Incoming::Challenge { nonce: "n1".into() });
        let call = r#"{"type":"event","event":"node.invoke.request","payload":{"id":"c1","nodeId":"d1","command":"mcp.tools.call.v1","paramsJSON":"{\"server\":\"redlines\",\"tool\":\"view\"}","timeoutMs":9000}}"#;
        assert_eq!(
            parse(call),
            Incoming::Invoke {
                id: "c1".into(),
                node_id: "d1".into(),
                command: "mcp.tools.call.v1".into(),
                params_json: r#"{"server":"redlines","tool":"view"}"#.into()
            }
        );
    }

    #[test]
    fn what_isnt_a_frame_is_ignored() {
        for text in [
            "",
            "hello",
            "[]",
            r#"{"type":"event","event":"tick"}"#,
            r#"{"type":"res"}"#,
        ] {
            assert_eq!(parse(text), Incoming::Other, "{text}");
        }
    }

    #[test]
    fn a_setup_code_gives_its_bootstrap_token_and_a_bare_token_is_itself() {
        use base64::Engine as _;
        let code = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"url":"ws://127.0.0.1:18789","bootstrapToken":"Bt-1_x","expiresAtMs":5}"#);
        assert_eq!(bootstrap_token(&code).as_deref(), Some("Bt-1_x"));
        assert_eq!(
            bootstrap_token(&format!(" {code}=\n")).as_deref(),
            Some("Bt-1_x")
        );
        assert_eq!(
            bootstrap_token("CcN4abcDEF123").as_deref(),
            Some("CcN4abcDEF123")
        );
        let wrapped = format!("{}\n  {}", &code[..10], &code[10..]);
        assert_eq!(bootstrap_token(&wrapped).as_deref(), Some("Bt-1_x"));
        let none = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"url":"x"}"#);
        assert_eq!(bootstrap_token(&none), None);
    }

    #[test]
    fn a_response_carries_its_error() {
        let text = r#"{"type":"res","id":"1","ok":false,"error":{"code":"NOT_PAIRED","message":"pairing required","details":{"requestId":"r9"}}}"#;
        let Incoming::Response { ok, error, .. } = parse(text) else {
            panic!()
        };
        assert!(!ok);
        assert_eq!(
            classify(&error.unwrap(), false),
            Refusal::PairingRequired {
                request_id: Some("r9".into())
            }
        );
    }

    fn error(code: &str, message: &str) -> WireError {
        WireError {
            code: code.into(),
            message: message.into(),
            details: Value::Null,
        }
    }

    #[test]
    fn refusals_are_told_apart_by_code_or_words() {
        assert_eq!(
            classify(&error("", "bootstrap token expired"), true),
            Refusal::CodeUsed
        );
        assert_eq!(
            classify(&error("UNAUTHORIZED", "invalid token"), true),
            Refusal::CodeUsed
        );
        assert_eq!(
            classify(&error("UNAUTHORIZED", "invalid token"), false),
            Refusal::BadToken
        );
        // A device token that has run out is a bad token, not a used code.
        assert_eq!(
            classify(&error("", "token expired"), false),
            Refusal::BadToken
        );
        // Whole words only: this is a rate limit, which trying again later can fix.
        assert_eq!(
            classify(&error("RATE_LIMIT", "too many auth attempts"), false),
            Refusal::Other("too many auth attempts".into())
        );
        assert_eq!(
            classify(&error("PROTOCOL_MISMATCH", "unsupported protocol"), false),
            Refusal::TooNew { protocol: None }
        );
        assert_eq!(
            classify(&error("X", "the moon is in the wrong phase"), false),
            Refusal::Other("the moon is in the wrong phase".into())
        );
        assert_eq!(
            classify(&error("BOOM", ""), false),
            Refusal::Other("BOOM".into())
        );
    }

    #[test]
    fn connect_declares_the_one_command_and_the_node_role() {
        let text = connect_request(&Connect {
            id: "1",
            display_name: "Redlines on Ada's MacBook",
            version: "0.2.0",
            device_id: "dev",
            public_key: "pk",
            signature: "sig",
            signed_at_ms: 5,
            nonce: "n",
            credential_kind: "token",
            credential: "secret-1",
        });
        let frame: Value = serde_json::from_str(&text).unwrap();
        let params = &frame["params"];
        assert_eq!(params["role"], "node");
        assert_eq!(params["commands"], json!(["mcp.tools.call.v1"]));
        assert_eq!(params["auth"], json!({"token": "secret-1"}));
        assert_eq!(params["device"]["nonce"], "n");
        assert!(!text.contains("system.run"));
    }

    #[test]
    fn published_tools_are_tied_to_the_one_command_and_a_nameless_one_is_dropped() {
        let text = plugin_tools_request(
            "2",
            &[
                json!({"name": "view", "description": "d", "inputSchema": {}}),
                json!({"x": 1}),
                json!(3),
            ],
        );
        let frame: Value = serde_json::from_str(&text).unwrap();
        let tools = frame["params"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["command"], "mcp.tools.call.v1");
        // The Gateway's descriptor is closed: these keys and no others.
        assert_eq!(
            tools[0],
            json!({"pluginId": "node-mcp", "name": "view", "description": "d",
                "parameters": {}, "command": "mcp.tools.call.v1",
                "mcp": {"server": "redlines", "tool": "view"}})
        );
    }

    #[test]
    fn a_node_is_a_node_host_and_signs_what_the_gateway_checks() {
        // The Gateway's own text: v2|device|client id|mode|role|scopes|at|token|nonce.
        assert_eq!(
            signed_text("d", "node", 7, "tok", "n"),
            "v2|d|node-host|node|node||7|tok|n"
        );
        let text = connect_request(&Connect {
            id: "1",
            display_name: "x",
            version: "1",
            device_id: "d",
            public_key: "p",
            signature: "s",
            signed_at_ms: 1,
            nonce: "n",
            credential_kind: "token",
            credential: "t",
        });
        let frame: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(frame["params"]["client"]["id"], "node-host");
        assert_eq!(frame["params"]["client"]["mode"], "node");
    }

    #[test]
    fn a_chat_run_is_read_as_status_words_and_an_end() {
        let frame = |payload: Value| {
            let mut payload = payload;
            payload["runId"] = json!("r1");
            payload["sessionKey"] = json!("agent:main:redlines-0");
            json!({"type": "event", "event": "chat", "payload": payload}).to_string()
        };
        let state = |text: String| match parse(&text) {
            Incoming::Chat(event) => {
                assert_eq!(event.run_id, "r1");
                assert_eq!(event.session_key, "agent:main:redlines-0");
                event.state
            }
            other => panic!("{other:?}"),
        };
        assert_eq!(
            state(frame(json!({"state": "status", "phase": "starting_model"}))),
            ChatState::Status
        );
        assert_eq!(
            state(frame(json!({"state": "delta", "deltaText": "Hi"}))),
            ChatState::Delta {
                text: "Hi".into(),
                replace: false
            }
        );
        assert_eq!(
            state(frame(
                json!({"state": "delta", "deltaText": "", "replace": true,
                "message": {"content": [{"type": "text", "text": ""}]}})
            )),
            ChatState::Delta {
                text: String::new(),
                replace: true
            }
        );
        assert_eq!(
            state(frame(
                json!({"state": "final", "message": {"role": "assistant",
                "content": [{"type": "text", "text": "Hi "}, {"type": "text", "text": "there"}]}})
            )),
            ChatState::Final {
                text: "Hi there".into()
            }
        );
        assert_eq!(
            state(frame(json!({"state": "aborted"}))),
            ChatState::Aborted
        );
        assert_eq!(
            state(frame(
                json!({"state": "error", "errorMessage": "No model."})
            )),
            ChatState::Error {
                message: "No model.".into()
            }
        );
        assert_eq!(
            parse(r#"{"type":"event","event":"chat","payload":{"state":"final"}}"#),
            Incoming::Other
        );
    }

    #[test]
    fn an_operator_connects_as_a_backend_client_with_two_scopes_and_signs_for_them() {
        assert_eq!(
            operator_signed_text("d", 7, "tok", "n"),
            "v2|d|gateway-client|backend|operator|operator.read,operator.write|7|tok|n"
        );
        let text = operator_connect_request(&Connect {
            id: "1",
            display_name: "Redlines on Ada's MacBook",
            version: "0.2.0",
            device_id: "dev",
            public_key: "pk",
            signature: "sig",
            signed_at_ms: 5,
            nonce: "n",
            credential_kind: "bootstrapToken",
            credential: "code",
        });
        let frame: Value = serde_json::from_str(&text).unwrap();
        let params = &frame["params"];
        assert_eq!(params["role"], "operator");
        assert_eq!(params["minProtocol"], 4);
        assert_eq!(params["client"]["id"], "gateway-client");
        assert_eq!(params["client"]["mode"], "backend");
        assert_eq!(params["scopes"], json!(["operator.read", "operator.write"]));
        assert_eq!(params["commands"], json!([]));
        assert!(!text.contains("operator.admin"));
    }

    #[test]
    fn a_send_and_an_abort_name_the_session() {
        let send: Value =
            serde_json::from_str(&chat_send_request("3", "agent:main:redlines-0", "Hi", "k1"))
                .unwrap();
        assert_eq!(send["method"], "chat.send");
        assert_eq!(send["params"]["sessionKey"], "agent:main:redlines-0");
        assert_eq!(send["params"]["idempotencyKey"], "k1");
        let abort: Value =
            serde_json::from_str(&chat_abort_request("4", "agent:main:redlines-0", "k1")).unwrap();
        assert_eq!(abort["method"], "chat.abort");
        assert_eq!(abort["params"]["runId"], "k1");
    }

    #[test]
    fn a_result_is_ok_with_its_payload_or_an_error() {
        let ok: Value = serde_json::from_str(&invoke_result("c1", "d1", Ok("{\"x\":1}"))).unwrap();
        assert_eq!(ok["method"], "node.invoke.result");
        assert_eq!(ok["params"]["ok"], true);
        assert_eq!(ok["params"]["payloadJSON"], "{\"x\":1}");
        let no: Value = serde_json::from_str(&invoke_result("c1", "d1", Err("nope"))).unwrap();
        assert_eq!(no["params"]["ok"], false);
        assert_eq!(no["params"]["error"]["message"], "nope");
    }
}
