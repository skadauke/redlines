//! What Redlines says to an OpenClaw Gateway as a node, and what it understands back: every frame's
//! shape, in one place (docs/research/openclaw-connection.md, "The node connection").
//!
//! **These shapes are from OpenClaw's documentation and from what its apps are known to send, not
//! from its schemas, and nothing has been run against a real Gateway yet.** They are the first thing
//! the first live test (docs/research/openclaw-connection.md, "First live test") checks, and the
//! only place to change when a Gateway says otherwise. What is assumed:
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
//! A Gateway that speaks a newer protocol than [`PROTOCOL`] is told apart (`is_newer`), so that the
//! sheet says "this Gateway is newer than Redlines knows" rather than failing in a strange way.

// Nothing starts the node until the tool bridge is wired (OC 5): what is here is run by its tests.
#![allow(dead_code)]

use serde_json::{Value, json};

/// The protocol version this was written against, and the only one it offers.
pub const PROTOCOL: u64 = 3;

/// The one command this node declares, and so the only one a Gateway may send it. Never
/// `system.run` or anything that runs a program.
pub const COMMAND: &str = "mcp.tools.call.v1";

/// What this client calls itself.
pub const CLIENT_ID: &str = "redlines";

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
    /// Anything else (a tick, a presence event): ignored.
    Other,
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
    let code = error.code.to_ascii_lowercase();
    let said = error.message.to_ascii_lowercase();
    let text = format!("{code} {said}");
    let has = |words: &[&str]| words.iter().any(|word| text.contains(word));
    if has(&[
        "not_paired",
        "not-paired",
        "not paired",
        "pairing",
        "pending approval",
    ]) {
        let request_id = ["requestId", "request_id"]
            .iter()
            .find_map(|key| error.details.get(key).and_then(Value::as_str))
            .map(str::to_owned);
        return Refusal::PairingRequired { request_id };
    }
    if has(&["protocol"]) && has(&["mismatch", "unsupported", "newer", "version"]) {
        let protocol = error
            .details
            .get("maxProtocol")
            .or_else(|| error.details.get("protocol"))
            .and_then(Value::as_u64);
        return Refusal::TooNew { protocol };
    }
    if has(&[
        "bootstrap",
        "setup code",
        "setup_code",
        "expired",
        "already used",
        "used",
    ]) {
        return Refusal::CodeUsed;
    }
    if has(&[
        "unauthorized",
        "invalid token",
        "token",
        "auth",
        "forbidden",
    ]) {
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

/// Whether a `hello-ok` speaks a newer protocol than this one.
pub fn is_newer(hello: &Value) -> bool {
    hello
        .get("protocol")
        .and_then(Value::as_u64)
        .is_some_and(|protocol| protocol > PROTOCOL)
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

/// Publishes the node's tools: MCP's own descriptors (`name`, `description`, `inputSchema`), each
/// tied to the one command.
pub fn plugin_tools_request(id: &str, tools: &[Value]) -> String {
    let tools: Vec<Value> = tools
        .iter()
        .filter_map(|tool| {
            let mut tool = tool.as_object()?.clone();
            tool.get("name")?.as_str()?;
            tool.insert("command".to_owned(), json!(COMMAND));
            Some(Value::Object(tool))
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
        let call = r#"{"type":"event","event":"node.invoke.request","payload":{"id":"c1","nodeId":"d1","command":"mcp.tools.call.v1","paramsJSON":"{\"name\":\"view\"}","timeoutMs":9000}}"#;
        assert_eq!(
            parse(call),
            Incoming::Invoke {
                id: "c1".into(),
                node_id: "d1".into(),
                command: "mcp.tools.call.v1".into(),
                params_json: r#"{"name":"view"}"#.into()
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
    fn a_newer_protocol_is_noticed() {
        assert!(is_newer(&json!({"protocol": PROTOCOL + 1})));
        assert!(!is_newer(&json!({"protocol": PROTOCOL})));
        assert!(!is_newer(&json!({})));
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
