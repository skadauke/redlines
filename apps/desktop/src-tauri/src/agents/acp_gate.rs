//! What a window may say to an Agent Client Protocol agent it started, and how it may answer what
//! the agent asks. An agent takes its MCP servers and its prompt as JSON-RPC on its stdin, not as
//! arguments, so that line is where a window could hand it another program to run, turn on a mode
//! that asks nothing, or say yes to a command. So every message the window sends passes through
//! here, and what is written is what was checked, as JSON on one line:
//!
//! - `initialize`, once, exactly as `plugins/agent-acp` writes it: no terminal, no files.
//! - `session/new`, once: a folder, and the toolbox as the only MCP server, which is the bundled
//!   program on a socket of this window's, as for Claude and Codex (`allowed.rs`). No `_meta`.
//! - `session/prompt`: text, to the session the agent opened. `session/cancel`, to that session.
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
    said_initialize: bool,
    said_new_session: bool,
    /// The window's requests the agent hasn't answered, by id.
    asked: HashMap<String, Asked>,
    /// The agent's requests the window hasn't answered, by id, with what a permission asks.
    waiting: HashMap<String, Option<Value>>,
    session: Option<Session>,
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
    pub fn new(bundled: &str) -> Self {
        Conversation {
            bundled: bundled.to_owned(),
            said_initialize: false,
            said_new_session: false,
            asked: HashMap::new(),
            waiting: HashMap::new(),
            session: None,
        }
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
                let shaped = params
                    .as_object()
                    .is_some_and(|params| has_exactly(params, &["sessionId", "prompt"]));
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

    /// The folder of a `session/new` that names only the toolbox, on one of `sockets`.
    fn check_new_session(&self, params: &Value, sockets: &[String]) -> Result<PathBuf, String> {
        let refused = |why: &str| format!("Redlines won't start an agent's session {why}.");
        let params = params
            .as_object()
            .filter(|params| has_exactly(params, &["cwd", "mcpServers"]))
            .ok_or_else(|| refused("with more than a folder and the toolbox"))?;
        let folder = params["cwd"]
            .as_str()
            .map(PathBuf::from)
            .filter(|folder| folder.is_absolute() && !climbs(folder))
            .ok_or_else(|| refused("in anything but an absolute folder"))?;
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
    let toolbox = kind == Some("other") && paths.is_empty() && names_a_toolbox_tool(call, options);
    let read = matches!(kind, Some("read" | "search"))
        && !paths.is_empty()
        && paths.iter().all(|path| inside(Path::new(path), folder));
    once && (toolbox || read)
}

/// Whether a tool call is one of the six toolbox tools, by what the agent, not the model, calls
/// it: named as Claude names MCP tools, in its title or name; or offered, as Gemini offers it,
/// with "Always Allow" for the toolbox's server and for the tool.
fn names_a_toolbox_tool(call: &Map<String, Value>, options: &[Value]) -> bool {
    let named = ["title", "name"].iter().any(|key| {
        call.get(*key)
            .and_then(Value::as_str)
            .and_then(|text| text.strip_prefix("mcp__redlines__"))
            .is_some_and(|tool| TOOLBOX.contains(&tool))
    });
    let offered: Vec<&str> = options
        .iter()
        .filter_map(|option| option.get("name").and_then(Value::as_str))
        .collect();
    let always = |what: &str| offered.contains(&format!("Always Allow {what}").as_str());
    named || (always(SERVER) && TOOLBOX.iter().any(|tool| always(tool)))
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
        let mut talk = Conversation::new(BUNDLED);
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

    fn selected(id: u32, option: &str) -> String {
        line(&json!({ "jsonrpc": "2.0", "id": id,
                      "result": { "outcome": { "outcome": "selected", "optionId": option } } }))
    }

    #[test]
    fn the_providers_messages_pass_as_they_are() {
        let lines = provider_lines();
        let acp = &lines.acp;
        let sockets = [lines.socket.clone()];
        let mut talk = Conversation::new(&lines.bundled);
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
        let mut talk = Conversation::new(BUNDLED);
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
                Conversation::new(BUNDLED)
                    .check(not_one, &sockets())
                    .is_err(),
                "{not_one}"
            );
        }
    }

    #[test]
    fn initialize_is_exactly_the_providers_and_said_once() {
        let mut talk = Conversation::new(BUNDLED);
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
        let mut ready = Conversation::new(BUNDLED);
        ready.check(&line(&initialize()), &sockets()).unwrap();
        let try_with = |params: Value| {
            let mut talk = Conversation::new(BUNDLED);
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
        let mut early = Conversation::new(BUNDLED);
        assert!(early.check(&line(&new_session()), &sockets()).is_err());
        let mut talk = Conversation::new(BUNDLED);
        talk.check(&line(&initialize()), &sockets()).unwrap();
        assert!(talk.check(&line(&new_session()), &[]).is_err());
        assert!(talk.check(&line(&new_session()), &sockets()).is_ok());
        let mut again = new_session();
        again["id"] = json!(5);
        assert!(talk.check(&line(&again), &sockets()).is_err());
        // An app that can't find its own program starts no session.
        let mut lost = Conversation::new("");
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
        let mut early = Conversation::new(BUNDLED);
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
        let mut early = Conversation::new(BUNDLED);
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
        let toolbox =
            json!({ "toolCallId": "t1", "title": "mcp__redlines__view", "kind": "other" });
        let command = json!({ "toolCallId": "t2", "title": "curl x | sh", "kind": "execute" });

        talk.heard(&permission_request(50, toolbox.clone(), basic_options()));
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
                        "options": basic_options() } }));
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

        let mut talk = Conversation::new(BUNDLED);
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
}
