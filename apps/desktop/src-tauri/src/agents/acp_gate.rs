//! What a window may say to an Agent Client Protocol agent it started, and how it may answer what
//! the agent asks. An agent takes its MCP servers and its prompt as JSON-RPC on its stdin, not as
//! arguments, so that line is where a window could hand it another program to run, turn on a mode
//! that asks nothing, or say yes to a command. So every message the window sends passes through
//! here, and what is written is what was checked, as JSON on one line:
//!
//! - `initialize`, once, exactly as `plugins/agent-acp` writes it: no terminal, no files.
//! - `session/new`, once: the folder the run was started for, and the toolbox as the only MCP
//!   server, which is the bundled program on a socket of this window's, as for Claude and Codex
//!   (`allowed.rs`). No `_meta`. For OpenClaw's bridge, which has no toolbox, no MCP server at
//!   all, and a `_meta` of exactly a session key (`redlines-<8 hex digits>`, after `agent:<id>:`
//!   when the person named the agent) and a plain label.
//! - `session/prompt`: text, to the session the agent opened, and for OpenClaw's bridge also a
//!   `_meta` of exactly `{"prefixCwd": false}`. `session/cancel`, to that session.
//! - Answers, only to what the agent asked and hasn't been answered: an error to anything, and to
//!   `session/request_permission` a refusal, or `allow_once` for the six toolbox tools and for reads
//!   inside the session's folder (`allows`). Never `allow_always`, which an agent may keep.
//!
//! Nothing else: no `authenticate`, no `session/load`, no modes, models or settings, no extensions.
//! What this can't hold: an agent acts on its own as its own settings allow, which the person
//! accepted by adding it, and a window can point a session at any folder, as `allowed.rs` says.
//! `acp-permissions.json` holds the permission rule for a test on each side, and
//! `provider-lines.json` the messages the provider writes.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use serde_json::{Map, Value, json};

use super::acp::Bridge;

/// The six tools of the toolbox, which the relay answers and which act only on the document.
const TOOLBOX: [&str; 6] = [
    "view",
    "read_thread",
    "str_replace",
    "comment",
    "reply",
    "status",
];

/// The name the toolbox's server goes by in `session/new`.
const SERVER: &str = "redlines";

/// One run's conversation, as far as the window's side of it goes.
pub struct Conversation {
    /// The `redlines` program in the app, the only MCP server.
    bundled: String,
    /// The folder the run was started for, as it was given: the only one its session may be in.
    folder: String,
    said_initialize: bool,
    said_new_session: bool,
    /// The window's requests the agent hasn't answered, by id.
    asked: HashMap<String, Asked>,
    /// The agent's requests the window hasn't answered, by id, with what a permission asks.
    waiting: HashMap<String, Option<Value>>,
    session: Option<Session>,
    /// Set for OpenClaw's bridge: no toolbox, and a session of its own for the document.
    bridge: Option<Bridge>,
}

enum Asked {
    Initialize,
    NewSession(PathBuf),
    Prompt,
}

struct Session {
    id: String,
    folder: PathBuf,
}

impl Conversation {
    pub fn new(bundled: &str, folder: &str) -> Self {
        Conversation {
            bundled: bundled.to_owned(),
            folder: folder.to_owned(),
            said_initialize: false,
            said_new_session: false,
            asked: HashMap::new(),
            waiting: HashMap::new(),
            session: None,
            bridge: None,
        }
    }

    /// The same conversation with an agent that is OpenClaw's bridge, if it is one.
    pub fn for_bridge(mut self, bridge: Option<Bridge>) -> Self {
        self.bridge = bridge;
        self
    }

    /// A line from the agent, which may ask something the window may then answer, or open the
    /// session. A line that isn't a message is nothing.
    pub fn heard(&mut self, line: &str) {
        let Ok(Value::Object(message)) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let Some(id) = message.get("id").and_then(key_of) else {
            return;
        };
        match message.get("method") {
            Some(Value::String(method)) => {
                let permission = (method == "session/request_permission")
                    .then(|| message.get("params").cloned())
                    .flatten();
                self.waiting.insert(id, permission);
            }
            Some(_) => {}
            None => {
                if let Some(Asked::NewSession(folder)) = self.asked.remove(&id)
                    && let Some(session) = message
                        .get("result")
                        .and_then(|result| result.get("sessionId"))
                        .and_then(Value::as_str)
                {
                    self.session = Some(Session {
                        id: session.to_owned(),
                        folder,
                    });
                }
            }
        }
    }

    /// A line the window asks to send, given the sockets of its relays: the line to write, or why
    /// not, which never repeats the window's words.
    pub fn check(&mut self, line: &str, sockets: &[String]) -> Result<String, String> {
        let refused = |why: &str| format!("Redlines won't send an agent {why}.");
        let Ok(Value::Object(message)) = serde_json::from_str::<Value>(line) else {
            return Err(refused("a line that isn't one message"));
        };
        if message.get("jsonrpc") != Some(&json!("2.0")) {
            return Err(refused("a message that isn't JSON-RPC 2.0"));
        }
        let id = message.get("id");
        let method = message.get("method").and_then(Value::as_str);
        match (id, method) {
            (Some(id), Some(method)) => {
                let id = key_of(id).ok_or_else(|| refused("a request with that id"))?;
                if !has_exactly(&message, &["jsonrpc", "id", "method", "params"]) {
                    return Err(refused("a request with more in it"));
                }
                if self.asked.contains_key(&id) {
                    return Err(refused("a second request with the same id"));
                }
                let asked = self.check_request(method, &message["params"], sockets)?;
                self.asked.insert(id, asked);
            }
            (None, Some(method)) => {
                if !has_exactly(&message, &["jsonrpc", "method", "params"]) {
                    return Err(refused("a notification with more in it"));
                }
                let to_session = message["params"].as_object().is_some_and(|params| {
                    has_exactly(params, &["sessionId"]) && self.is_session(&params["sessionId"])
                });
                if method != "session/cancel" || !to_session {
                    return Err(refused("that notification"));
                }
            }
            (Some(id), None) => {
                let id = key_of(id).ok_or_else(|| refused("an answer with that id"))?;
                let permission = self
                    .waiting
                    .get(&id)
                    .ok_or_else(|| refused("an answer to something it didn't ask"))?;
                if !self.may_answer(&message, permission.as_ref()) {
                    return Err(refused("that answer"));
                }
                self.waiting.remove(&id);
            }
            (None, None) => return Err(refused("a line that isn't a request or an answer")),
        }
        Ok(Value::Object(message).to_string())
    }

    fn check_request(
        &mut self,
        method: &str,
        params: &Value,
        sockets: &[String],
    ) -> Result<Asked, String> {
        let refused = |why: &str| Err(format!("Redlines won't send an agent {why}."));
        match method {
            "initialize" if !self.said_initialize => {
                let expected = json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "fs": { "readTextFile": false, "writeTextFile": false },
                        "terminal": false,
                    },
                });
                if *params != expected {
                    return refused("an initialize other than Redlines' own");
                }
                self.said_initialize = true;
                Ok(Asked::Initialize)
            }
            "session/new" if self.said_initialize && !self.said_new_session => {
                let folder = self.check_new_session(params, sockets)?;
                self.said_new_session = true;
                Ok(Asked::NewSession(folder))
            }
            "session/prompt" => {
                // OpenClaw's bridge is asked not to put this Mac's folder at the head of a prompt.
                let shaped = params.as_object().is_some_and(|params| {
                    has_exactly(params, &["sessionId", "prompt"])
                        || (self.bridge.is_some()
                            && has_exactly(params, &["sessionId", "prompt", "_meta"])
                            && params["_meta"] == json!({ "prefixCwd": false }))
                });
                let text_only = params
                    .get("prompt")
                    .and_then(Value::as_array)
                    .is_some_and(|blocks| blocks.iter().all(is_text));
                if !(shaped && self.is_session(&params["sessionId"]) && text_only) {
                    return refused("a prompt other than text to its session");
                }
                Ok(Asked::Prompt)
            }
            _ => refused("that request"),
        }
    }

    /// The folder of a `session/new` that names only the toolbox, on one of `sockets`; for
    /// OpenClaw's bridge, that names no MCP server, and a key and a label that are the shape this
    /// writes (`session_of`).
    fn check_new_session(&self, params: &Value, sockets: &[String]) -> Result<PathBuf, String> {
        let refused = |why: &str| format!("Redlines won't start an agent's session {why}.");
        if let Some(bridge) = &self.bridge {
            return self.check_bridge_session(params, bridge);
        }
        let params = params
            .as_object()
            .filter(|params| has_exactly(params, &["cwd", "mcpServers"]))
            .ok_or_else(|| refused("with more than a folder and the toolbox"))?;
        let folder = params["cwd"]
            .as_str()
            .filter(|cwd| *cwd == self.folder)
            .map(PathBuf::from)
            .filter(|folder| folder.is_absolute() && !climbs(folder))
            .ok_or_else(|| refused("in any folder but the one it was started for"))?;
        if self.bundled.is_empty() {
            return Err(refused("when it can't find its own program"));
        }
        let toolbox = |socket: &String| {
            json!([{
                "name": SERVER,
                "command": self.bundled,
                "args": ["mcp", "--relay", socket],
                "env": [],
            }])
        };
        if !sockets
            .iter()
            .any(|socket| params["mcpServers"] == toolbox(socket))
        {
            return Err(refused(
                "with any MCP server but the toolbox on this window's relay",
            ));
        }
        Ok(folder)
    }

    /// The folder of a `session/new` to OpenClaw's bridge: the run's folder, no MCP server, which
    /// the bridge rejects and which has none to name, and the document's session in `_meta`.
    fn check_bridge_session(&self, params: &Value, bridge: &Bridge) -> Result<PathBuf, String> {
        let refused = |why: &str| format!("Redlines won't start an agent's session {why}.");
        let params = params
            .as_object()
            .filter(|params| has_exactly(params, &["cwd", "mcpServers", "_meta"]))
            .ok_or_else(|| refused("with more than a folder, no MCP server and a session's key"))?;
        let folder = params["cwd"]
            .as_str()
            .filter(|cwd| *cwd == self.folder)
            .map(PathBuf::from)
            .filter(|folder| folder.is_absolute() && !climbs(folder))
            .ok_or_else(|| refused("in any folder but the one it was started for"))?;
        if params["mcpServers"] != json!([]) {
            return Err(refused("with an MCP server: this agent has no toolbox"));
        }
        let meta = params["_meta"]
            .as_object()
            .filter(|meta| has_exactly(meta, &["sessionKey", "sessionLabel"]))
            .ok_or_else(|| refused("with more than a key and a label"))?;
        let key = meta["sessionKey"].as_str().unwrap_or_default();
        if !session_key_is_ours(key, bridge) {
            return Err(refused(
                "with a key that isn't one of Redlines' for this agent",
            ));
        }
        if !session_label_is_ours(meta["sessionLabel"].as_str().unwrap_or_default()) {
            return Err(refused("with a label that isn't plain"));
        }
        Ok(folder)
    }

    /// Whether this is the id of the session the agent opened for this run.
    fn is_session(&self, id: &Value) -> bool {
        self.session
            .as_ref()
            .is_some_and(|session| id.as_str() == Some(session.id.as_str()))
    }

    /// Whether an answer to one of the agent's requests may go: an error to anything, and to a
    /// permission an outcome the rule allows.
    fn may_answer(&self, message: &Map<String, Value>, permission: Option<&Value>) -> bool {
        if has_exactly(message, &["jsonrpc", "id", "error"]) {
            return message["error"].as_object().is_some_and(|error| {
                has_exactly(error, &["code", "message"])
                    && error["code"].is_i64()
                    && error["message"].is_string()
            });
        }
        let (Some(permission), true) = (
            permission,
            has_exactly(message, &["jsonrpc", "id", "result"]),
        ) else {
            return false;
        };
        let result = &message["result"];
        if *result == json!({ "outcome": { "outcome": "cancelled" } }) {
            return true;
        }
        let Some(chosen) = result
            .as_object()
            .filter(|result| has_exactly(result, &["outcome"]))
            .and_then(|result| result["outcome"].as_object())
            .filter(|outcome| {
                has_exactly(outcome, &["outcome", "optionId"])
                    && outcome["outcome"] == json!("selected")
            })
            .and_then(|outcome| outcome["optionId"].as_str())
        else {
            return false;
        };
        match kind_of_option(permission, chosen) {
            Some("reject_once" | "reject_always") => true,
            Some("allow_once") => self.session.as_ref().is_some_and(|session| {
                self.is_session(&permission["sessionId"])
                    && allows_by(permission, &session.folder, &really_inside)
            }),
            _ => false,
        }
    }
}

/// Whether a session key is the shape `sessionOf` in `plugins/agent-acp` writes: `redlines-` and
/// eight lowercase hex digits, after `agent:<id>:` when the person named the agent, and with no
/// agent in front of it when they didn't (a key could otherwise say any agent's name).
fn session_key_is_ours(key: &str, bridge: &Bridge) -> bool {
    let rest = match &bridge.agent {
        Some(agent) => key.strip_prefix(&format!("agent:{agent}:")),
        None => Some(key),
    };
    rest.and_then(|rest| rest.strip_prefix("redlines-"))
        .is_some_and(|hash| {
            hash.len() == 8
                && hash
                    .chars()
                    .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
        })
}

/// Whether a session label is `Redlines: ` and up to eighty plain ASCII characters.
fn session_label_is_ours(label: &str) -> bool {
    label.strip_prefix("Redlines: ").is_some_and(|name| {
        !name.is_empty()
            && name.len() <= 80
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || " ._()-".contains(c))
    })
}

/// A JSON-RPC id as a key, as the agent wrote it: `1` and `"1"` are two ids. Only whole numbers
/// and strings are ids.
fn key_of(id: &Value) -> Option<String> {
    (id.is_string() || id.is_i64() || id.is_u64()).then(|| id.to_string())
}

/// Whether a block of a prompt is text and nothing else.
fn is_text(block: &Value) -> bool {
    block.as_object().is_some_and(|block| {
        has_exactly(block, &["type", "text"])
            && block["type"] == json!("text")
            && block["text"].is_string()
    })
}

/// Whether an object has these keys and no others.
fn has_exactly(object: &Map<String, Value>, keys: &[&str]) -> bool {
    object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
}

/// The kind of the option a permission request offers with this id.
fn kind_of_option<'a>(permission: &'a Value, chosen: &str) -> Option<&'a str> {
    permission
        .get("options")?
        .as_array()?
        .iter()
        .find(|option| option.get("optionId").and_then(Value::as_str) == Some(chosen))?
        .get("kind")?
        .as_str()
}

/// Whether a permission request may be allowed: for one of the six toolbox tools, or for reads
/// inside the folder, with `inside` deciding what is inside; and only where there is an
/// `allow_once` to give.
fn allows_by(params: &Value, folder: &Path, inside: &dyn Fn(&Path, &Path) -> bool) -> bool {
    let Some(call) = params.get("toolCall").and_then(Value::as_object) else {
        return false;
    };
    let options = params
        .get("options")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    let once = options.iter().any(|option| {
        option.get("kind") == Some(&json!("allow_once"))
            && option.get("optionId").is_some_and(Value::is_string)
    });
    // A call that names no kind is `other`; one whose kind or files aren't what the protocol says
    // is neither.
    let kind = match call.get("kind") {
        None | Some(Value::Null) => Some("other"),
        Some(Value::String(kind)) => Some(kind.as_str()),
        Some(_) => None,
    };
    let paths: Option<Vec<&str>> = match call.get("locations") {
        None | Some(Value::Null) => Some(Vec::new()),
        Some(Value::Array(locations)) => locations
            .iter()
            .map(|location| location.get("path").and_then(Value::as_str))
            .collect(),
        Some(_) => None,
    };
    let Some(paths) = paths else {
        return false;
    };
    let toolbox = kind == Some("other") && paths.is_empty() && names_a_toolbox_tool(options);
    let read = matches!(kind, Some("read" | "search"))
        && !paths.is_empty()
        && paths.iter().all(|path| inside(Path::new(path), folder));
    once && (toolbox || read)
}

/// Whether a tool call is one of the six toolbox tools, by what the agent, not the model, says of
/// it. ACP has no field for which server a tool is from, so this knows the agents one by one:
///
/// - Gemini CLI offers "Always Allow <server>" and "Always Allow <tool>" for an MCP tool, named
///   from its own registry (its title is the JSON of the arguments, which the model writes).
///
/// An agent that asks in any other way is refused, which fails its toolbox calls and nothing else.
fn names_a_toolbox_tool(options: &[Value]) -> bool {
    let offered: Vec<&str> = options
        .iter()
        .filter_map(|option| option.get("name").and_then(Value::as_str))
        .collect();
    let always = |what: &str| offered.contains(&format!("Always Allow {what}").as_str());
    always(SERVER) && TOOLBOX.iter().any(|tool| always(tool))
}

/// Whether a path names `..` anywhere.
fn climbs(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

/// Whether `path` is inside `folder` by its name: absolute, never climbing out, and under it.
fn lexically_inside(path: &Path, folder: &Path) -> bool {
    path.is_absolute() && !climbs(path) && path.starts_with(folder)
}

/// Whether `path` is inside `folder` by its name and as it really is, so that a link inside can't
/// lead out. A path that isn't there isn't inside.
fn really_inside(path: &Path, folder: &Path) -> bool {
    lexically_inside(path, folder)
        && match (path.canonicalize(), folder.canonicalize()) {
            (Ok(path), Ok(folder)) => path.starts_with(folder),
            _ => false,
        }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use serde::Deserialize;

    use super::*;
    use crate::agents::allowed::tests::provider_lines;
    use crate::agents::test_support::TempFolder;

    const BUNDLED: &str = "/Applications/Redlines.app/Contents/MacOS/redlines";
    const SOCKET: &str = "/var/folders/06/T/rl-7582-0/s";
    const FOLDER: &str = "/Users/ada/project";
    const SESSION: &str = "sess-1";

    fn sockets() -> Vec<String> {
        vec![SOCKET.to_owned()]
    }

    fn line(message: &Value) -> String {
        message.to_string()
    }

    fn initialize() -> Value {
        json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
            "protocolVersion": 1,
            "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false },
                                    "terminal": false } } })
    }

    fn server(command: &str, socket: &str) -> Value {
        json!({ "name": "redlines", "command": command, "args": ["mcp", "--relay", socket],
                "env": [] })
    }

    fn new_session_with(params: Value) -> Value {
        json!({ "jsonrpc": "2.0", "id": 1, "method": "session/new", "params": params })
    }

    fn new_session() -> Value {
        new_session_with(json!({ "cwd": FOLDER, "mcpServers": [server(BUNDLED, SOCKET)] }))
    }

    fn prompt_with(params: Value) -> Value {
        json!({ "jsonrpc": "2.0", "id": 2, "method": "session/prompt", "params": params })
    }

    fn prompt() -> Value {
        prompt_with(json!({ "sessionId": SESSION,
                            "prompt": [{ "type": "text", "text": "Fix the spelling." }] }))
    }

    fn cancel() -> Value {
        json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": SESSION } })
    }

    /// A conversation that has said `initialize` and `session/new`, and been given a session.
    fn opened() -> Conversation {
        let mut talk = Conversation::new(BUNDLED, FOLDER);
        talk.check(&line(&initialize()), &sockets()).unwrap();
        talk.heard(r#"{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1}}"#);
        talk.check(&line(&new_session()), &sockets()).unwrap();
        talk.heard(r#"{"jsonrpc":"2.0","id":1,"result":{"sessionId":"sess-1"}}"#);
        talk
    }

    fn permission_request(id: u32, tool_call: Value, options: Value) -> String {
        line(
            &json!({ "jsonrpc": "2.0", "id": id, "method": "session/request_permission",
                      "params": { "sessionId": SESSION, "toolCall": tool_call,
                                  "options": options } }),
        )
    }

    fn basic_options() -> Value {
        json!([
            { "optionId": "allow", "name": "Allow", "kind": "allow_once" },
            { "optionId": "always", "name": "Always Allow", "kind": "allow_always" },
            { "optionId": "reject", "name": "Reject", "kind": "reject_once" },
        ])
    }

    /// The options Gemini CLI offers for a tool of the toolbox's server, with the ids the tests use.
    fn toolbox_options(tool: &str) -> Value {
        json!([
            { "optionId": "always", "name": "Always Allow redlines", "kind": "allow_always" },
            { "optionId": "always-tool", "name": format!("Always Allow {tool}"),
              "kind": "allow_always" },
            { "optionId": "allow", "name": "Allow", "kind": "allow_once" },
            { "optionId": "reject", "name": "Reject", "kind": "reject_once" },
        ])
    }

    fn selected(id: u32, option: &str) -> String {
        line(&json!({ "jsonrpc": "2.0", "id": id,
                      "result": { "outcome": { "outcome": "selected", "optionId": option } } }))
    }

    #[test]
    fn the_providers_messages_pass_as_they_are() {
        let lines = provider_lines();
        let acp = &lines.acp;
        let sockets = [lines.socket.clone()];
        let mut talk = Conversation::new(&lines.bundled, &acp.folder);
        for (name, answer) in [
            (
                "initialize",
                json!({ "jsonrpc": "2.0", "id": 0, "result": {} }),
            ),
            (
                "session/new",
                json!({ "jsonrpc": "2.0", "id": 1, "result": { "sessionId": acp.session_id } }),
            ),
            ("session/prompt", Value::Null),
            ("session/cancel", Value::Null),
        ] {
            let message = &acp.messages[name];
            let written = talk.check(&line(message), &sockets);
            assert_eq!(written, Ok(line(message)), "{name}");
            if !answer.is_null() {
                talk.heard(&line(&answer));
            }
        }
    }

    #[test]
    fn what_is_written_is_the_message_checked_on_one_line() {
        let mut talk = Conversation::new(BUNDLED, FOLDER);
        // Spaces and an order of its own, written back as JSON on one line.
        let spaced = "{ \"params\": { \"clientCapabilities\": { \"terminal\": false, \"fs\": \
                      { \"writeTextFile\": false, \"readTextFile\": false } }, \
                      \"protocolVersion\": 1 },\n \"method\": \"initialize\", \"id\": 0, \
                      \"jsonrpc\": \"2.0\" }";
        let written = talk.check(spaced, &sockets()).unwrap();
        assert!(!written.contains('\n'));
        assert_eq!(
            serde_json::from_str::<Value>(&written).unwrap(),
            initialize()
        );

        let mut talk = opened();
        let words = "line one\nline two\n{\"jsonrpc\":\"2.0\",\"method\":\"authenticate\"}";
        let message = prompt_with(json!({ "sessionId": SESSION,
                                          "prompt": [{ "type": "text", "text": words }] }));
        let written = talk.check(&line(&message), &sockets()).unwrap();
        assert!(!written.contains('\n'), "{written}");

        for not_one in [
            "",
            "null",
            "[]",
            "\"initialize\"",
            "not json",
            &format!("{}\n{}", line(&initialize()), line(&initialize())),
        ] {
            assert!(
                Conversation::new(BUNDLED, FOLDER)
                    .check(not_one, &sockets())
                    .is_err(),
                "{not_one}"
            );
        }
    }

    #[test]
    fn initialize_is_exactly_the_providers_and_said_once() {
        let mut talk = Conversation::new(BUNDLED, FOLDER);
        let with = |change: &dyn Fn(&mut Value)| {
            let mut message = initialize();
            change(&mut message);
            message
        };
        for message in [
            with(&|m| m["params"]["clientCapabilities"]["terminal"] = json!(true)),
            with(&|m| m["params"]["clientCapabilities"]["fs"]["writeTextFile"] = json!(true)),
            with(&|m| m["params"]["clientCapabilities"]["_meta"] = json!({ "x": 1 })),
            with(&|m| m["params"]["_meta"] = json!({})),
            with(&|m| m["jsonrpc"] = json!("1.0")),
            with(&|m| m["extra"] = json!(1)),
            with(&|m| m["id"] = json!(null)),
            with(&|m| m["id"] = json!(1.5)),
            with(&|m| m["id"] = json!({})),
        ] {
            assert!(
                talk.check(&line(&message), &sockets()).is_err(),
                "{message}"
            );
        }
        assert!(talk.check(&line(&initialize()), &sockets()).is_ok());
        assert!(talk.check(&line(&initialize()), &sockets()).is_err());
    }

    #[test]
    fn the_only_mcp_server_is_the_bundled_program_on_this_windows_socket() {
        let mut ready = Conversation::new(BUNDLED, FOLDER);
        ready.check(&line(&initialize()), &sockets()).unwrap();
        let try_with = |params: Value| {
            let mut talk = Conversation::new(BUNDLED, FOLDER);
            talk.check(&line(&initialize()), &sockets()).unwrap();
            talk.check(&line(&new_session_with(params)), &sockets())
        };
        let refused = [
            json!({ "cwd": FOLDER, "mcpServers": [server("/bin/sh", SOCKET)] }),
            json!({ "cwd": FOLDER, "mcpServers": [server(BUNDLED, "/tmp/another/s")] }),
            json!({ "cwd": FOLDER, "mcpServers": [server(BUNDLED, SOCKET), server("/bin/sh", SOCKET)] }),
            json!({ "cwd": FOLDER, "mcpServers": [] }),
            json!({ "cwd": FOLDER }),
            json!({ "cwd": FOLDER, "mcpServers": [{ "name": "redlines", "command": BUNDLED,
                "args": ["mcp", "--relay", SOCKET], "env": [{ "name": "NODE_OPTIONS",
                "value": "--require /tmp/x.js" }] }] }),
            json!({ "cwd": FOLDER, "mcpServers": [{ "name": "redlines", "command": BUNDLED,
                "args": ["mcp", "--relay", SOCKET, "--x"], "env": [] }] }),
            json!({ "cwd": FOLDER, "mcpServers": [{ "name": "other", "command": BUNDLED,
                "args": ["mcp", "--relay", SOCKET], "env": [] }] }),
            json!({ "cwd": FOLDER, "mcpServers": [{ "type": "http", "name": "redlines",
                "url": "http://localhost:1/", "headers": [] }] }),
            json!({ "cwd": FOLDER, "mcpServers": [server(BUNDLED, SOCKET)], "_meta": {
                "claudeCode": { "options": { "permissionMode": "bypassPermissions" } } } }),
            json!({ "cwd": "relative", "mcpServers": [server(BUNDLED, SOCKET)] }),
            json!({ "cwd": "/Users/ada/other", "mcpServers": [server(BUNDLED, SOCKET)] }),
            json!({ "cwd": "/Users/ada/project/", "mcpServers": [server(BUNDLED, SOCKET)] }),
            json!({ "cwd": "/Users/ada/project/../..", "mcpServers": [server(BUNDLED, SOCKET)] }),
            json!({ "cwd": 1, "mcpServers": [server(BUNDLED, SOCKET)] }),
        ];
        for params in refused {
            assert!(try_with(params.clone()).is_err(), "{params}");
        }
        assert!(
            try_with(json!({ "cwd": FOLDER, "mcpServers": [server(BUNDLED, SOCKET)] })).is_ok()
        );

        // Not before `initialize`, not twice, and not with no relay of this window's open.
        let mut early = Conversation::new(BUNDLED, FOLDER);
        assert!(early.check(&line(&new_session()), &sockets()).is_err());
        let mut talk = Conversation::new(BUNDLED, FOLDER);
        talk.check(&line(&initialize()), &sockets()).unwrap();
        assert!(talk.check(&line(&new_session()), &[]).is_err());
        assert!(talk.check(&line(&new_session()), &sockets()).is_ok());
        let mut again = new_session();
        again["id"] = json!(5);
        assert!(talk.check(&line(&again), &sockets()).is_err());
        // An app that can't find its own program starts no session.
        let mut lost = Conversation::new("", FOLDER);
        lost.check(&line(&initialize()), &sockets()).unwrap();
        let params = json!({ "cwd": FOLDER, "mcpServers": [server("", SOCKET)] });
        assert!(
            lost.check(&line(&new_session_with(params)), &sockets())
                .is_err()
        );
    }

    #[test]
    fn nothing_else_is_asked_of_an_agent() {
        let mut talk = opened();
        for method in [
            "authenticate",
            "session/load",
            "session/resume",
            "session/fork",
            "session/set_mode",
            "session/set_model",
            "session/set_config_option",
            "session/list",
            "_vendor/anything",
            "fs/read_text_file",
        ] {
            let request = json!({ "jsonrpc": "2.0", "id": 9, "method": method,
                                  "params": { "sessionId": SESSION, "modeId": "yolo" } });
            assert!(talk.check(&line(&request), &sockets()).is_err(), "{method}");
            let notification = json!({ "jsonrpc": "2.0", "method": method,
                                       "params": { "sessionId": SESSION } });
            assert!(
                talk.check(&line(&notification), &sockets()).is_err(),
                "{method}"
            );
        }
    }

    #[test]
    fn a_prompt_is_text_to_the_session_the_agent_opened() {
        let mut early = Conversation::new(BUNDLED, FOLDER);
        early.check(&line(&initialize()), &sockets()).unwrap();
        early.check(&line(&new_session()), &sockets()).unwrap();
        assert!(
            early.check(&line(&prompt()), &sockets()).is_err(),
            "not before the agent has opened it"
        );

        let mut talk = opened();
        for params in [
            json!({ "sessionId": "another", "prompt": [{ "type": "text", "text": "x" }] }),
            json!({ "sessionId": SESSION, "prompt": [{ "type": "resource_link",
                    "uri": "file:///Users/ada/.ssh/id_rsa", "name": "id_rsa" }] }),
            json!({ "sessionId": SESSION, "prompt": [{ "type": "text", "text": "x",
                    "_meta": { "x": 1 } }] }),
            json!({ "sessionId": SESSION, "prompt": [{ "type": "text", "text": 1 }] }),
            json!({ "sessionId": SESSION, "prompt": "x" }),
            json!({ "sessionId": SESSION, "prompt": [], "_meta": {} }),
        ] {
            assert!(
                talk.check(&line(&prompt_with(params.clone())), &sockets())
                    .is_err(),
                "{params}"
            );
        }
        assert!(talk.check(&line(&prompt()), &sockets()).is_ok());
    }

    #[test]
    fn cancel_is_a_notification_to_that_session() {
        let mut early = Conversation::new(BUNDLED, FOLDER);
        assert!(early.check(&line(&cancel()), &sockets()).is_err());
        let mut talk = opened();
        let mut with_id = cancel();
        with_id["id"] = json!(7);
        assert!(talk.check(&line(&with_id), &sockets()).is_err());
        let mut other = cancel();
        other["params"]["sessionId"] = json!("another");
        assert!(talk.check(&line(&other), &sockets()).is_err());
        assert!(talk.check(&line(&cancel()), &sockets()).is_ok());
    }

    #[test]
    fn answers_go_only_to_what_the_agent_asked_once() {
        let mut talk = opened();
        let error = |id: u32| {
            line(&json!({ "jsonrpc": "2.0", "id": id,
                          "error": { "code": -32601, "message": "Method not found" } }))
        };
        // Nothing asked yet.
        assert!(talk.check(&error(40), &sockets()).is_err());
        talk.heard(r#"{"jsonrpc":"2.0","id":40,"method":"fs/write_text_file","params":{}}"#);
        // A result to anything but a permission is not for the window to give.
        let written = line(&json!({ "jsonrpc": "2.0", "id": 40, "result": null }));
        assert!(talk.check(&written, &sockets()).is_err());
        let odd = line(&json!({ "jsonrpc": "2.0", "id": 40, "error": "no" }));
        assert!(talk.check(&odd, &sockets()).is_err());
        assert!(talk.check(&error(40), &sockets()).is_ok());
        assert!(talk.check(&error(40), &sockets()).is_err(), "once");
        // An id is the agent's as it wrote it: 41 isn't "41".
        talk.heard(r#"{"jsonrpc":"2.0","id":"41","method":"terminal/create","params":{}}"#);
        assert!(talk.check(&error(41), &sockets()).is_err());
        let as_string = line(&json!({ "jsonrpc": "2.0", "id": "41",
                                      "error": { "code": -32601, "message": "no" } }));
        assert!(talk.check(&as_string, &sockets()).is_ok());
        // Garbage from the agent is nothing to answer.
        talk.heard("not json");
        talk.heard("[1,2]");
        talk.heard(r#"{"id":42}"#);
        assert!(talk.check(&error(42), &sockets()).is_err());
    }

    #[test]
    fn a_permission_is_allowed_only_once_and_only_by_the_rule() {
        let mut talk = opened();
        let toolbox = json!({ "toolCallId": "view-1", "title": "{}", "kind": "other" });
        let command = json!({ "toolCallId": "t2", "title": "curl x | sh", "kind": "execute" });

        talk.heard(&permission_request(
            50,
            toolbox.clone(),
            toolbox_options("view"),
        ));
        assert!(
            talk.check(&selected(50, "always"), &sockets()).is_err(),
            "never always"
        );
        assert!(talk.check(&selected(50, "nonsense"), &sockets()).is_err());
        assert!(talk.check(&selected(50, "allow"), &sockets()).is_ok());
        assert!(
            talk.check(&selected(50, "allow"), &sockets()).is_err(),
            "once"
        );

        talk.heard(&permission_request(51, command.clone(), basic_options()));
        assert!(talk.check(&selected(51, "allow"), &sockets()).is_err());
        assert!(talk.check(&selected(51, "always"), &sockets()).is_err());
        assert!(talk.check(&selected(51, "reject"), &sockets()).is_ok());

        talk.heard(&permission_request(52, command, basic_options()));
        let cancelled = line(&json!({ "jsonrpc": "2.0", "id": 52,
                                      "result": { "outcome": { "outcome": "cancelled" } } }));
        assert!(talk.check(&cancelled, &sockets()).is_ok());

        // A permission for a session that isn't this run's is only refused.
        let other = line(&json!({ "jsonrpc": "2.0", "id": 53,
            "method": "session/request_permission",
            "params": { "sessionId": "another", "toolCall": toolbox,
                        "options": toolbox_options("view") } }));
        talk.heard(&other);
        assert!(talk.check(&selected(53, "allow"), &sockets()).is_err());
        assert!(talk.check(&selected(53, "reject"), &sockets()).is_ok());

        // An answer with more in it than an outcome is refused.
        talk.heard(&permission_request(
            54,
            json!({ "toolCallId": "t" }),
            basic_options(),
        ));
        let more = line(&json!({ "jsonrpc": "2.0", "id": 54, "result": {
            "outcome": { "outcome": "selected", "optionId": "reject" }, "_meta": {} } }));
        assert!(talk.check(&more, &sockets()).is_err());
    }

    #[test]
    fn reads_are_held_to_the_folder_as_it_really_is() {
        let temp = TempFolder::new("acp-gate-folder");
        let root = std::fs::canonicalize(temp.path()).unwrap();
        let folder = root.join("project");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("notes.md"), "").unwrap();
        std::fs::write(root.join("secret.md"), "").unwrap();
        symlink(root.join("secret.md"), folder.join("link.md")).unwrap();

        let mut talk = Conversation::new(BUNDLED, folder.to_str().unwrap());
        talk.check(&line(&initialize()), &sockets()).unwrap();
        let params = json!({ "cwd": folder, "mcpServers": [server(BUNDLED, SOCKET)] });
        talk.check(&line(&new_session_with(params)), &sockets())
            .unwrap();
        talk.heard(r#"{"jsonrpc":"2.0","id":1,"result":{"sessionId":"sess-1"}}"#);
        let read = |path: &Path| {
            json!({ "toolCallId": "r", "title": "Read", "kind": "read",
                    "locations": [{ "path": path }] })
        };
        talk.heard(&permission_request(
            60,
            read(&folder.join("notes.md")),
            basic_options(),
        ));
        assert!(talk.check(&selected(60, "allow"), &sockets()).is_ok());
        talk.heard(&permission_request(
            61,
            read(&folder.join("link.md")),
            basic_options(),
        ));
        assert!(
            talk.check(&selected(61, "allow"), &sockets()).is_err(),
            "a link out"
        );
        talk.heard(&permission_request(
            62,
            read(&folder.join("gone.md")),
            basic_options(),
        ));
        assert!(
            talk.check(&selected(62, "allow"), &sockets()).is_err(),
            "nothing there"
        );
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Permissions {
        folder: String,
        options: Value,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        what: String,
        tool_call: Value,
        options: Option<Value>,
        allowed: bool,
    }

    #[test]
    fn the_permission_rule_is_the_providers() {
        let file: Permissions = serde_json::from_str(include_str!("acp-permissions.json")).unwrap();
        assert!(file.cases.len() > 20);
        for case in &file.cases {
            let params = json!({ "sessionId": SESSION, "toolCall": case.tool_call,
                                 "options": case.options.as_ref().unwrap_or(&file.options) });
            assert_eq!(
                allows_by(&params, Path::new(&file.folder), &lexically_inside),
                case.allowed,
                "{}",
                case.what
            );
        }
    }

    #[test]
    fn a_refusal_doesnt_repeat_someones_words() {
        let mut talk = opened();
        let message = prompt_with(json!({ "sessionId": "my private words",
                                          "prompt": [{ "type": "text", "text": "secret" }] }));
        let refused = talk.check(&line(&message), &sockets()).unwrap_err();
        assert!(!refused.contains("private"), "{refused}");
        assert!(!refused.contains("secret"), "{refused}");
    }

    fn for_openclaw(agent: Option<&str>) -> Conversation {
        Conversation::new(BUNDLED, FOLDER).for_bridge(Some(Bridge {
            agent: agent.map(str::to_owned),
        }))
    }

    fn bridge_new_session_with(meta: Value) -> Value {
        new_session_with(json!({ "cwd": FOLDER, "mcpServers": [], "_meta": meta }))
    }

    fn bridge_new_session(key: &str) -> Value {
        bridge_new_session_with(json!({ "sessionKey": key, "sessionLabel": "Redlines: plan.md" }))
    }

    fn bridge_prompt_with(meta: Value) -> Value {
        prompt_with(json!({ "sessionId": SESSION,
                            "prompt": [{ "type": "text", "text": "Fix the spelling." }],
                            "_meta": meta }))
    }

    /// A conversation with OpenClaw's bridge that has opened its session.
    fn bridge_opened(agent: Option<&str>, key: &str) -> Conversation {
        let mut talk = for_openclaw(agent);
        talk.check(&line(&initialize()), &sockets()).unwrap();
        talk.heard(r#"{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1}}"#);
        talk.check(&line(&bridge_new_session(key)), &sockets())
            .unwrap();
        talk.heard(r#"{"jsonrpc":"2.0","id":1,"result":{"sessionId":"sess-1"}}"#);
        talk
    }

    #[test]
    fn the_providers_messages_for_openclaws_bridge_pass_as_they_are() {
        let lines = provider_lines();
        let acp = &lines.acp;
        let sockets = [lines.socket.clone()];
        for bridge in [&acp.bridge, &acp.bridge_default] {
            let mut talk =
                Conversation::new(&lines.bundled, &acp.folder).for_bridge(Some(Bridge {
                    agent: bridge.agent.clone(),
                }));
            for (name, message, answer) in [
                (
                    "initialize",
                    &acp.messages["initialize"],
                    json!({ "jsonrpc": "2.0", "id": 0, "result": {} }),
                ),
                (
                    "session/new",
                    &bridge.messages["session/new"],
                    json!({ "jsonrpc": "2.0", "id": 1, "result": { "sessionId": acp.session_id } }),
                ),
                (
                    "session/prompt",
                    &bridge.messages["session/prompt"],
                    Value::Null,
                ),
                (
                    "session/cancel",
                    &acp.messages["session/cancel"],
                    Value::Null,
                ),
            ] {
                assert_eq!(
                    talk.check(&line(message), &sockets),
                    Ok(line(message)),
                    "{name}"
                );
                if !answer.is_null() {
                    talk.heard(&line(&answer));
                }
            }
        }
        // And the same messages are not the toolbox agents': the other way round is refused too.
        let mut talk = Conversation::new(&lines.bundled, &acp.folder);
        talk.check(&line(&acp.messages["initialize"]), &sockets)
            .unwrap();
        assert!(
            talk.check(&line(&acp.bridge.messages["session/new"]), &sockets)
                .is_err(),
            "a session with no toolbox, to an agent that has one"
        );
    }

    #[test]
    fn a_bridges_session_has_no_mcp_server_and_a_key_and_a_label_of_redlines() {
        let key = "agent:moby:redlines-0a1b2c3d";
        let said = |agent: Option<&str>, message: &Value| {
            let mut talk = for_openclaw(agent);
            talk.check(&line(&initialize()), &sockets()).unwrap();
            talk.check(&line(message), &sockets())
        };
        assert!(said(Some("moby"), &bridge_new_session(key)).is_ok());
        assert!(said(None, &bridge_new_session("redlines-0a1b2c3d")).is_ok());
        // The toolbox, which the bridge rejects, and which an agent with none has no use for.
        assert!(
            said(
                Some("moby"),
                &new_session_with(
                    json!({ "cwd": FOLDER, "mcpServers": [server(BUNDLED, SOCKET)],
                                          "_meta": { "sessionKey": key,
                                                     "sessionLabel": "Redlines: plan.md" } })
                )
            )
            .is_err()
        );
        // No `_meta`, or more of it than a key and a label, or another folder.
        assert!(
            said(
                Some("moby"),
                &new_session_with(json!({ "cwd": FOLDER, "mcpServers": [] }))
            )
            .is_err()
        );
        assert!(
            said(
                Some("moby"),
                &bridge_new_session_with(
                    json!({ "sessionKey": key, "sessionLabel": "Redlines: plan.md", "resetSession": true })
                )
            )
            .is_err()
        );
        assert!(
            said(
                Some("moby"),
                &bridge_new_session_with(json!({ "sessionKey": key }))
            )
            .is_err()
        );
        assert!(
            said(
                Some("moby"),
                &new_session_with(json!({ "cwd": "/Users/ada/else", "mcpServers": [],
                                          "_meta": { "sessionKey": key,
                                                     "sessionLabel": "Redlines: plan.md" } }))
            )
            .is_err()
        );
    }

    #[test]
    fn a_bridges_key_names_the_agent_the_person_named_and_no_other() {
        let said = |agent: Option<&str>, key: &str| {
            let mut talk = for_openclaw(agent);
            talk.check(&line(&initialize()), &sockets()).unwrap();
            talk.check(&line(&bridge_new_session(key)), &sockets())
        };
        for refused in [
            // Another agent's namespace, or none, or the main session itself.
            ("agent:main:redlines-0a1b2c3d", Some("moby")),
            ("redlines-0a1b2c3d", Some("moby")),
            ("agent:moby:main", Some("moby")),
            ("agent:moby:redlines-0a1b2c3d", None),
            ("agent:main:redlines-0a1b2c3d", None),
            // Not eight lowercase hex digits, or something after them.
            ("agent:moby:redlines-0A1B2C3D", Some("moby")),
            ("agent:moby:redlines-0a1b2c3", Some("moby")),
            ("agent:moby:redlines-0a1b2c3de", Some("moby")),
            ("agent:moby:redlines-0a1b2c3g", Some("moby")),
            ("agent:moby:redlines-0a1b2c3d:more", Some("moby")),
            ("agent:moby:redlines-", Some("moby")),
            ("", None),
            ("acp-bridge:0a1b2c3d", None),
        ] {
            assert!(said(refused.1, refused.0).is_err(), "{refused:?}");
        }
        // The label shows as itself, in plain ASCII, and is short.
        let mut talk = for_openclaw(None);
        talk.check(&line(&initialize()), &sockets()).unwrap();
        for label in [
            "Redlines: ",
            "plan.md",
            "Redlines: plan\nmd",
            "Redlines: plan 🙂.md",
            "Redlines: plan\u{202e}.md",
            &format!("Redlines: {}", "a".repeat(81)),
        ] {
            let message = bridge_new_session_with(
                json!({ "sessionKey": "redlines-0a1b2c3d", "sessionLabel": label }),
            );
            assert!(
                talk.check(&line(&message), &sockets()).is_err(),
                "{label:?}"
            );
        }
    }

    #[test]
    fn only_a_bridge_may_ask_for_no_cwd_prefix_and_only_that() {
        let key = "agent:moby:redlines-0a1b2c3d";
        let mut talk = bridge_opened(Some("moby"), key);
        for refused in [
            json!({ "prefixCwd": true }),
            json!({ "prefixCwd": false, "thinking": "high" }),
            json!({ "thinking": "high" }),
            json!({ "deliver": true }),
            json!({}),
        ] {
            assert!(
                talk.check(&line(&bridge_prompt_with(refused.clone())), &sockets())
                    .is_err(),
                "{refused}"
            );
        }
        assert!(
            talk.check(
                &line(&bridge_prompt_with(json!({ "prefixCwd": false }))),
                &sockets()
            )
            .is_ok()
        );
        // An agent with a toolbox is sent no `_meta` at all.
        let mut other = opened();
        assert!(
            other
                .check(
                    &line(&bridge_prompt_with(json!({ "prefixCwd": false }))),
                    &sockets()
                )
                .is_err()
        );
        assert!(other.check(&line(&prompt()), &sockets()).is_ok());
    }

    #[test]
    fn a_bridge_is_refused_what_any_agent_is_refused() {
        let mut talk = bridge_opened(Some("moby"), "agent:moby:redlines-0a1b2c3d");
        // A prompt that isn't text to its session, a second session and the modes.
        assert!(
            talk.check(
                &line(&prompt_with(
                    json!({ "sessionId": "other", "prompt": [], "_meta": { "prefixCwd": false } })
                )),
                &sockets()
            )
            .is_err()
        );
        assert!(
            talk.check(
                &line(&bridge_new_session("agent:moby:redlines-0a1b2c3d")),
                &sockets()
            )
            .is_err(),
            "a second session"
        );
        assert!(
            talk.check(
                &line(
                    &json!({ "jsonrpc": "2.0", "id": 9, "method": "session/set_mode",
                                "params": { "sessionId": SESSION, "modeId": "bypass" } })
                ),
                &sockets()
            )
            .is_err()
        );
        // A refusal of a command, which OpenClaw relays when a Gateway asks, is allowed; its
        // approval is not.
        talk.heard(&permission_request(
            7,
            json!({ "toolCallId": "x", "title": "Command approval requested", "kind": "execute",
                    "status": "pending" }),
            json!([
                { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
                { "optionId": "allow-always", "name": "Allow always", "kind": "allow_always" },
                { "optionId": "deny", "name": "Deny", "kind": "reject_once" },
            ]),
        ));
        assert!(talk.check(&selected(7, "allow-once"), &sockets()).is_err());
        assert!(
            talk.check(&selected(7, "allow-always"), &sockets())
                .is_err()
        );
        assert!(talk.check(&selected(7, "deny"), &sockets()).is_ok());
    }
}
