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
//! The same connection record also lets Redlines *ask* the agent (`openclaw_chat.rs`): the setup
//! code is first used to open an operator connection, whose token is kept beside the node's, and
//! an OpenClaw connection that holds one is an agent in the @ picker and in Ask (`chat_agents`,
//! `chat_for`).
//!
//! Calls are answered with a plain "not connected to documents yet": which document an agent's call
//! acts on is the next piece of work (the tool bridge), and until then the Gateway's agent can see
//! the tools and will be told so when it uses one.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use super::acp::{AcpAgent, Bridge};
use super::connections::{Connections, Kind, Secret};
use super::gateway::target;
use super::node::{
    Config, Credential, Event, Identity, Running, Status, Timing, TokenStore, ToolHost, start,
};
use super::openclaw_agent::Talk;
use super::openclaw_chat::{Outcome, ask, connect_operator, run_key};
use super::openclaw_protocol as protocol;
use super::openclaw_tools::RunTools;

/// The six tools, as `tools/list` says them.
const TOOLS: &str = include_str!("openclaw-tools.json");

/// The six tools, and the runs they answer (`openclaw_tools.rs`): a call acts on the document of
/// the run it was made from, and is refused when no live run is behind it.
struct Tools {
    runs: Arc<RunTools>,
}

impl ToolHost for Tools {
    fn mcp(&self, request: &str) -> Option<String> {
        self.mcp_in(request, None)
    }

    fn mcp_in(&self, request: &str, session: Option<&str>) -> Option<String> {
        let request: Value = serde_json::from_str(request).ok()?;
        let reply = match request["method"].as_str()? {
            "tools/list" => {
                let tools: Value = serde_json::from_str(TOOLS).ok()?;
                json!({"jsonrpc": "2.0", "id": 1, "result": {"tools": tools}})
            }
            "tools/call" => self.runs.call(session, &request),
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
    /// The runs whose tools the nodes answer.
    tools: Arc<RunTools>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Nodes {
    /// The runs that have tools, which a run at a Gateway registers with.
    pub fn tools(&self) -> Arc<RunTools> {
        Arc::clone(&self.tools)
    }

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
            Some(code) => {
                let token = protocol::bootstrap_token(code.expose())
                    .and_then(|token| Secret::new(&token).ok())
                    .ok_or("That setup code has no token in it. Ask for a new one.")?;
                Credential::SetupCode(token)
            }
            None => match store.secret(handle, Kind::NodeToken) {
                Some(token) => Credential::Token(token),
                None => return Err("There is no setup code or token to connect with.".to_owned()),
            },
        };
        let seed = store.device_key(handle)?;
        let identity = Identity::from_seed(seed.expose()).ok_or("The device key is damaged.")?;
        // A setup code is good for both roles of a device when the operator goes first (a live
        // Gateway refused it to an operator once the node had used it), so a new code opens the
        // operator connection, keeps its token, and then the node starts with the same code.
        if let Credential::SetupCode(code) = &first {
            let operator = Config {
                target: target(&connection.url, None)?,
                identity: Identity::from_seed(seed.expose()).ok_or("The device key is damaged.")?,
                display_name: format!("Redlines on {computer}"),
                version: env!("CARGO_PKG_VERSION").to_owned(),
                timing: Timing::default(),
            };
            let offered = Credential::SetupCode(Secret::new(code.expose())?);
            // A failure here only means no chat yet: the node still connects, and says its own.
            if let Ok((mut socket, Some(token))) =
                connect_operator(&operator, &offered, &AtomicBool::new(false))
            {
                let _ = store.keep(handle, Kind::OperatorToken, &token);
                let _ = socket.close(None);
                let _ = app.emit(super::ACP_AGENTS_CHANGED, ());
            }
        }
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
            Arc::new(Tools {
                runs: Arc::clone(&self.tools),
            }),
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

/// The OpenClaw connections that can be asked, as the agents the window lists: the handle is what
/// people write after an @, and the OpenClaw agent the person named, if they did, is the bridge's.
pub fn chat_agents(app: &AppHandle) -> Vec<AcpAgent> {
    app.state::<Connections>()
        .views()
        .into_iter()
        .filter(|view| view.operator_token && view.device_key)
        .map(|view| AcpAgent {
            id: view.connection.handle,
            name: view.connection.name,
            program: String::new(),
            args: Vec::new(),
            bridge: Some(Bridge {
                agent: view.connection.agent,
            }),
        })
        .collect()
}

/// What a run of this connection as an agent needs: the OpenClaw agent it asks, and the way to
/// ask. Nothing for a connection that has no operator token.
pub fn chat_for(app: &AppHandle, handle: &str) -> Option<(Bridge, Talk)> {
    let store = app.state::<Connections>();
    let connection = store.get(handle)?;
    let token = store.secret(handle, Kind::OperatorToken)?;
    let seed = store.device_key(handle).ok()?;
    let gateway = target(&connection.url, None).ok()?;
    let (owner, name) = (app.clone(), handle.to_owned());
    let talk: Talk = Arc::new(move |session: &str, text: &str, stop: &AtomicBool| {
        let config = Config {
            target: gateway.clone(),
            identity: Identity::from_seed(seed.expose()).ok_or("The device key is damaged.")?,
            display_name: format!("Redlines on {}", this_mac()),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            timing: Timing::default(),
        };
        let credential =
            Credential::Token(Secret::new(token.expose()).map_err(|_| "The token is damaged.")?);
        let (mut socket, issued) =
            connect_operator(&config, &credential, stop).map_err(|error| error.message())?;
        // A Gateway that rotates the device's token says so in the answer to connect.
        if let Some(fresh) = issued
            && fresh.expose() != token.expose()
        {
            let _ = owner
                .state::<Connections>()
                .keep(&name, Kind::OperatorToken, &fresh);
        }
        let outcome = ask(&mut socket, &config, session, text, &run_key(), stop);
        let _ = socket.close(None);
        if matches!(outcome, Ok(Outcome::Done(_))) {
            let _ = owner.state::<Connections>().used(&name, super::now());
        }
        outcome
    });
    Some((
        Bridge {
            agent: connection.agent,
        },
        talk,
    ))
}

/// This Mac's name for the Gateway's owner to read in a request.
fn this_mac() -> String {
    super::this_mac_name()
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
    fn the_tools_are_the_six_and_a_call_outside_a_live_run_is_refused() {
        let tools = || Tools {
            runs: Arc::default(),
        };
        let list: Value = serde_json::from_str(
            &tools()
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
            &tools()
                .mcp(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"view"}}"#)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(call["result"]["isError"], true);
        assert!(tools().mcp("not json").is_none());
        assert!(tools().mcp(r#"{"method":"shutdown"}"#).is_none());
    }

    #[test]
    fn a_computer_name_shows_as_itself() {
        assert_eq!(computer_name("  Ada’s MacBook ").unwrap(), "Ada’s MacBook");
        for bad in ["", "   ", "a\nb", &"x".repeat(61), "evil\u{202e}name"] {
            assert!(computer_name(bad).is_err(), "{bad:?}");
        }
    }

    /// The live check of the tool bridge, by hand, against a throwaway Gateway with a stand-in
    /// model (docs/research/openclaw-connection.md, "The tool bridge"):
    /// `REDLINES_LIVE_GATEWAY=ws://127.0.0.1:PORT REDLINES_LIVE_CODE=<a new setup code>
    /// rtk proxy cargo test live_tools -- --ignored --nocapture`. The window is a stand-in: a
    /// document in memory that `str_replace` edits, behind a socket as a relay's.
    #[test]
    #[ignore = "needs a Gateway and a stand-in model, see REDLINES_LIVE_GATEWAY"]
    fn live_tools() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::net::UnixListener;
        use std::sync::atomic::AtomicBool;
        use std::time::Duration;

        use super::super::node::{now_ms, response_to, send};
        use super::super::openclaw_chat::{Outcome, ask, connect_operator, run_key};
        use super::super::openclaw_tools::NOT_LIVE;

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
        }
        let (Ok(address), Ok(code)) = (
            std::env::var("REDLINES_LIVE_GATEWAY"),
            std::env::var("REDLINES_LIVE_CODE"),
        ) else {
            return;
        };
        let setup = || {
            Credential::SetupCode(Secret::new(&protocol::bootstrap_token(&code).unwrap()).unwrap())
        };
        let seed = format!("{:016x}", now_ms()).repeat(4);
        let config = || Config {
            target: target(&address, None).unwrap(),
            identity: Identity::from_seed(&seed).unwrap(),
            display_name: "Redlines live tools test".into(),
            version: "0.2.0".into(),
            timing: Timing::default(),
        };
        let stop = AtomicBool::new(false);
        // The operator first, which takes the code, and then the node with the same code.
        let (socket, token) = connect_operator(&config(), &setup(), &stop).unwrap();
        drop(socket);
        let token = token.expect("an operator token");
        let runs = Arc::new(RunTools::default());
        let status: Arc<Mutex<Option<Status>>> = Arc::default();
        let shown = Arc::clone(&status);
        let node = start(
            config(),
            setup(),
            Arc::new(Tools {
                runs: Arc::clone(&runs),
            }),
            Box::new(Memory(Arc::default())),
            Box::new(move |event| {
                eprintln!("LIVE {event:?}");
                if let Event::Status(now) = event {
                    *shown.lock().unwrap() = Some(now);
                }
            }),
        );
        let until = std::time::Instant::now() + Duration::from_secs(30);
        while !matches!(*status.lock().unwrap(), Some(Status::Connected { .. })) {
            assert!(
                std::time::Instant::now() < until,
                "the node never connected"
            );
            std::thread::sleep(Duration::from_millis(100));
        }

        // The stand-in window of one run: a document, and what its tools were asked.
        let document = Arc::new(Mutex::new("A sentence with teh typo.".to_owned()));
        let asked: Arc<Mutex<Vec<String>>> = Arc::default();
        let window = |name: &str| {
            let folder =
                std::env::temp_dir().join(format!("rl-live-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&folder);
            std::fs::create_dir_all(&folder).unwrap();
            let socket = folder.join("s");
            let listener = UnixListener::bind(&socket).unwrap();
            let (document, asked) = (Arc::clone(&document), Arc::clone(&asked));
            std::thread::spawn(move || {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut writer = stream;
                let mut line = String::new();
                while reader.read_line(&mut line).unwrap_or(0) > 0 {
                    let message: Value = serde_json::from_str(&line).unwrap();
                    line.clear();
                    let text = match message["method"].as_str() {
                        Some("initialize") => None,
                        Some("tools/call") => {
                            let name = message["params"]["name"].as_str().unwrap_or_default();
                            asked.lock().unwrap().push(name.to_owned());
                            let args = &message["params"]["arguments"];
                            let mut doc = document.lock().unwrap();
                            Some(match name {
                                "view" => format!("     1\t{doc}"),
                                "str_replace" => {
                                    let old = args["old_str"].as_str().unwrap_or_default();
                                    if doc.matches(old).count() == 1 {
                                        *doc = doc.replace(old, args["new_str"].as_str().unwrap());
                                        "Replaced.".to_owned()
                                    } else {
                                        "old_str must match exactly once.".to_owned()
                                    }
                                }
                                _ => "ok".to_owned(),
                            })
                        }
                        _ => continue,
                    };
                    let result = match text {
                        None => json!({"protocolVersion": "2025-06-18"}),
                        Some(text) => json!({"content": [{"type": "text", "text": text}]}),
                    };
                    let _ = writeln!(
                        writer,
                        "{}",
                        json!({"jsonrpc": "2.0", "id": message["id"], "result": result})
                    );
                }
            });
            socket.to_str().unwrap().to_owned()
        };
        let open = |config: &Config| {
            connect_operator(
                config,
                &Credential::Token(Secret::new(token.expose()).unwrap()),
                &stop,
            )
            .unwrap()
            .0
        };
        let node_id = config().identity.id();
        // A call straight to the node, as `openclaw nodes invoke` or an operator makes it.
        let invoke = |socket: &mut super::super::gateway::Socket,
                      session: Option<&str>,
                      tool: &str|
         -> Value {
            let mut params = json!({
                "nodeId": node_id, "command": protocol::COMMAND,
                "params": {"server": protocol::SERVER, "tool": tool,
                           "arguments": {"old_str": "typo", "new_str": "mistake"}},
                "timeoutMs": 20000,
                "idempotencyKey": format!("live-{}-{:?}", now_ms(), session),
            });
            if let Some(session) = session {
                params["sessionKey"] = json!(session);
            }
            let sent = send(
                socket,
                json!({"type": "req", "id": "9", "method": "node.invoke", "params": params})
                    .to_string(),
            );
            assert!(sent.is_ok(), "the request wasn't sent");
            let until = std::time::Instant::now() + Duration::from_secs(30);
            let Ok(Some((ok, payload, error))) = response_to(socket, "9", until, &stop) else {
                panic!("no answer to node.invoke");
            };
            eprintln!("LIVE invoke ok={ok} payload={payload} error={error:?}");
            json!({"ok": ok, "payload": payload, "error": error.map(|e| e.message)})
        };

        // 1. A run that edits through the node: the stand-in model calls str_replace.
        let session = format!("agent:main:redlines-{:016x}", now_ms());
        let relay = window("edit");
        let registration = runs.register(&session, &relay).unwrap();
        let mut socket = open(&config());
        let outcome = ask(
            &mut socket,
            &config(),
            &session,
            "EDIT: fix the typo in the document.",
            &run_key(),
            &stop,
        );
        eprintln!("LIVE run 1: {outcome:?}");
        eprintln!("LIVE tools asked: {:?}", asked.lock().unwrap());
        eprintln!("LIVE document: {:?}", document.lock().unwrap());
        assert!(matches!(outcome, Ok(Outcome::Done(_))));
        assert!(
            asked
                .lock()
                .unwrap()
                .iter()
                .any(|tool| tool == "str_replace")
        );
        assert_eq!(*document.lock().unwrap(), "A sentence with the typo.");
        // A call that names no session, or another run's, is refused.
        let outside = invoke(&mut socket, None, "str_replace");
        assert!(outside.to_string().contains(&NOT_LIVE[..30]));
        let other = invoke(
            &mut socket,
            Some("agent:main:redlines-0000000000000000"),
            "str_replace",
        );
        assert!(other.to_string().contains(&NOT_LIVE[..30]));
        assert_eq!(*document.lock().unwrap(), "A sentence with the typo.");
        drop(registration);

        // A session the person gave no agent for, which the Gateway files under its default agent:
        // the calls name it by that key, and still find the run.
        *document.lock().unwrap() = "Another teh typo.".to_owned();
        let bare = format!("redlines-{:016x}", now_ms() + 2);
        let relay = window("bare");
        let registration = runs.register(&bare, &relay).unwrap();
        let mut again = open(&config());
        let outcome = ask(
            &mut again,
            &config(),
            &bare,
            "EDIT: fix it.",
            &run_key(),
            &stop,
        );
        eprintln!(
            "LIVE run with a bare key: {outcome:?}, document {:?}",
            document.lock().unwrap()
        );
        assert!(matches!(outcome, Ok(Outcome::Done(_))));
        assert_eq!(*document.lock().unwrap(), "Another the typo.");
        drop(registration);
        *document.lock().unwrap() = "A sentence with the typo.".to_owned();

        // 2. A run that is stopped: its next call is refused, and the document is not touched.
        let session = format!("agent:main:redlines-{:016x}", now_ms() + 1);
        let relay = window("stopped");
        let registration = runs.register(&session, &relay).unwrap();
        let before = asked.lock().unwrap().len();
        let halt = Arc::new(AtomicBool::new(false));
        let waiting = {
            let (halt, session, config) = (Arc::clone(&halt), session.clone(), config());
            let mut socket = open(&config);
            std::thread::spawn(move || {
                ask(
                    &mut socket,
                    &config,
                    &session,
                    "SLOW: wait.",
                    &run_key(),
                    &halt,
                )
            })
        };
        std::thread::sleep(Duration::from_secs(3));
        // Stop: the run ends, and with it its tool access (as `serve` does at Stop or cancel).
        halt.store(true, std::sync::atomic::Ordering::Relaxed);
        registration.end();
        eprintln!("LIVE run 2: {:?}", waiting.join().unwrap());
        let refused = invoke(&mut socket, Some(&session), "str_replace");
        assert!(refused.to_string().contains(&NOT_LIVE[..30]));
        assert_eq!(
            asked.lock().unwrap().len(),
            before,
            "no call reached the window"
        );
        assert_eq!(*document.lock().unwrap(), "A sentence with the typo.");
        node.stop();
    }
}
