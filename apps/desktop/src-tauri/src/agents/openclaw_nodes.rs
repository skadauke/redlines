//! The running nodes: one connection to a Gateway for each OpenClaw connection the person made
//! (`connections.rs`), started from Preferences with a setup code or when the app opens, and
//! stopped when the person removes the connection or the app quits (`node.rs` is the connection
//! itself).
//!
//! The page can say only *which* connection to start, and give the setup code the person pasted,
//! which goes to the node and nowhere else. It can't name a Gateway, a key or the tools: those are
//! the record's, the device key's, and `openclaw-tools.json`, which is a copy of the six tools of
//! `packages/agent-tools` that a test keeps equal.
//!
//! Calls are answered with a plain "not connected to documents yet": which document an agent's call
//! acts on is the next piece of work (the tool bridge), and until then the Gateway's agent can see
//! the tools and will be told so when it uses one.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::connections::{Connections, Kind, Secret};
use super::gateway::target;
use super::node::{
    Config, Credential, Event, Identity, Running, Status, Timing, TokenStore, ToolHost, start,
};

/// The six tools, as `tools/list` says them.
const TOOLS: &str = include_str!("openclaw-tools.json");

/// What the tools are, until a call has a document to act on.
struct Tools;

impl ToolHost for Tools {
    fn mcp(&self, request: &str) -> Option<String> {
        let request: Value = serde_json::from_str(request).ok()?;
        let tools: Value = serde_json::from_str(TOOLS).ok()?;
        let reply = match request["method"].as_str()? {
            "tools/list" => json!({"jsonrpc": "2.0", "id": 1, "result": {"tools": tools}}),
            "tools/call" => json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "content": [{
                        "type": "text",
                        "text": "Redlines isn’t connected to a document for this call yet.",
                    }],
                    "isError": true,
                },
            }),
            _ => return None,
        };
        Some(reply.to_string())
    }
}

/// The device's token, kept in the connection's folder.
struct Tokens {
    app: AppHandle,
    handle: String,
}

impl TokenStore for Tokens {
    fn keep(&mut self, token: Secret) {
        let _ = self
            .app
            .state::<Connections>()
            .keep(&self.handle, Kind::NodeToken, &token);
    }

    fn get(&self) -> Option<Secret> {
        self.app
            .state::<Connections>()
            .secret(&self.handle, Kind::NodeToken)
    }
}

struct Entry {
    running: Running,
    status: Arc<Mutex<Status>>,
}

/// The nodes that are running, by the connection's handle.
#[derive(Default)]
pub struct Nodes {
    running: Mutex<HashMap<String, Entry>>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Nodes {
    /// Where a node is, or nothing if none runs for this connection.
    pub fn status(&self, handle: &str) -> Option<Status> {
        lock(&self.running)
            .get(handle)
            .map(|entry| lock(&entry.status).clone())
    }

    /// Stops the node of a connection, if one runs.
    pub fn stop(&self, handle: &str) {
        let entry = lock(&self.running).remove(handle);
        if let Some(entry) = entry {
            entry.running.stop();
        }
    }

    pub fn stop_all(&self) {
        let all: Vec<Entry> = lock(&self.running)
            .drain()
            .map(|(_, entry)| entry)
            .collect();
        // The app is quitting: each is told to stop and none is waited for, so that a connection
        // still waiting for a computer to answer doesn't hold the quit up.
        for entry in all {
            entry.running.signal();
        }
    }

    /// Starts the node of a connection that is in the records, with the setup code if there is one
    /// and else with the token it kept. Replaces a node already running for it.
    pub fn connect(
        &self,
        app: &AppHandle,
        handle: &str,
        setup_code: Option<Secret>,
        computer: &str,
    ) -> Result<(), String> {
        let store = app.state::<Connections>();
        let connection = store
            .get(handle)
            .ok_or("That connection isn’t there any more.")?;
        let gateway = target(&connection.url, None)?;
        let first = match setup_code {
            Some(code) => Credential::SetupCode(code),
            None => match store.secret(handle, Kind::NodeToken) {
                Some(token) => Credential::Token(token),
                None => return Err("There is no setup code or token to connect with.".to_owned()),
            },
        };
        let seed = store.device_key(handle)?;
        let identity = Identity::from_seed(seed.expose()).ok_or("The device key is damaged.")?;
        let status = Arc::new(Mutex::new(Status::Connecting));
        let (shown, owner, name) = (Arc::clone(&status), app.clone(), handle.to_owned());
        let running = start(
            Config {
                target: gateway,
                identity,
                display_name: format!("Redlines on {computer}"),
                version: env!("CARGO_PKG_VERSION").to_owned(),
                timing: Timing::default(),
            },
            first,
            Arc::new(Tools),
            Box::new(Tokens {
                app: app.clone(),
                handle: handle.to_owned(),
            }),
            Box::new(move |event| match event {
                Event::Status(now) => *lock(&shown) = now,
                Event::Called { .. } => {
                    let _ = owner
                        .state::<Connections>()
                        .used(&name, crate::agents::now());
                }
            }),
        );
        // One node for a handle: whatever was running for it is stopped as the new one goes in, under
        // the one lock, so two connects at once leave one.
        let replaced = lock(&self.running).insert(handle.to_owned(), Entry { running, status });
        if let Some(old) = replaced {
            old.running.stop();
        }
        Ok(())
    }
}

/// The name of this Mac as people know it, for what the Gateway's owner sees in a request.
pub fn computer_name(given: &str) -> Result<String, String> {
    let name = given.trim();
    let fine = !name.is_empty()
        && name.chars().count() <= 60
        && name.chars().all(|c| !c.is_control() && c != '\u{202e}');
    if fine {
        Ok(name.to_owned())
    } else {
        Err("Give this Mac a short name that shows as it is.".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tools_are_the_six_and_calls_say_they_are_not_connected_yet() {
        let list: Value = serde_json::from_str(
            &Tools
                .mcp(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#)
                .unwrap(),
        )
        .unwrap();
        let names: Vec<&str> = list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "view",
                "read_thread",
                "str_replace",
                "comment",
                "reply",
                "status"
            ]
        );
        let call: Value = serde_json::from_str(
            &Tools
                .mcp(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"view"}}"#)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(call["result"]["isError"], true);
        assert!(Tools.mcp("not json").is_none());
        assert!(Tools.mcp(r#"{"method":"shutdown"}"#).is_none());
    }

    #[test]
    fn a_computer_name_shows_as_itself() {
        assert_eq!(computer_name("  Ada’s MacBook ").unwrap(), "Ada’s MacBook");
        for bad in ["", "   ", "a\nb", &"x".repeat(61), "evil\u{202e}name"] {
            assert!(computer_name(bad).is_err(), "{bad:?}");
        }
    }
}
