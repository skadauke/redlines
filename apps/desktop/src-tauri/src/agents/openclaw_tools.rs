//! The tool bridge: an agent asked through a Gateway edits the document it was asked from, through
//! Redlines' node tools, and only while its run is live.
//!
//! How a call finds its run (`docs/research/openclaw-connection.md`, "The tool bridge"): OpenClaw
//! puts the agent's session key on every call of a node tool. The agent's tool calls `node.invoke`
//! with `sessionKey` (`openclaw-plugin-tools-*.mjs`, the plugin tool's `execute`), and the Gateway
//! forwards it in the `node.invoke.request` event (`node-invoke-request-*.mjs`, `sessionKey`). The
//! session of a run is the key Redlines chose for the thread (`sessionOf` in `plugins/agent-acp`),
//! so a call names its run by a key only that run's thread was given. The key is matched whole
//! (`canonical`), the agent included.
//!
//! The run's tools are the same as a local agent's: the window opens a relay for the run, which
//! answers each line with the run's tools (the gate, the author, the thread, the edit path), and
//! this side is the program at the other end of it: it connects to the relay's socket and sends it
//! the MCP lines of the calls that arrive. Nothing here knows a tool or an edit.
//!
//! A call is answered only while its run is *live*: from `session/new` until the run is stopped,
//! cancelled or over. A call with no session, with a session no run has, or with that of a run that
//! has ended is refused, in words the agent can pass on. Ending a run closes the line, which also
//! ends a call that was waiting on it.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// How long a call may take at the window: an edit is quick, and a person is never waited on.
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// How long a thread's next run waits for the run before it to be over at the Gateway: its final
/// `chat` event (`aborted`, `error` or `final`) or, failing that, this. A little longer than the
/// grace a stopped run is given for that event (`ABORT_GRACE` in `openclaw_chat.rs`).
pub const SETTLE_TIMEOUT: Duration = Duration::from_secs(8);

/// How often a wait that Stop may end looks at whether it has.
const LOOK: Duration = Duration::from_millis(50);

/// Why a registration stopped when its run was stopped.
const STOPPED: &str = "The run was stopped.";

/// How long the window may take to answer the handshake.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);

/// Why a call is refused when no live run is behind it.
pub const NOT_LIVE: &str = "This call is not part of a live Redlines run, so it can't change \
    any document. Redlines' tools work only inside a run that a person started in Redlines, until \
    they stop it.";

/// The agent a session key without one is filed under at the Gateway when nothing better is known:
/// its default agent, `main` unless the person configured another. The Gateway reports the key it
/// really filed the run under in the run's `chat` events, and `RunTools::adopt` takes it from
/// there, so a Gateway whose default agent isn't `main` is matched too.
const DEFAULT_AGENT: &str = "main";

/// The key a session is matched on, whole: `agent:<id>:<name>`. A bare key is the default agent's,
/// `main` until the Gateway says otherwise; one that names an agent keeps it, so a call from one
/// agent's session never acts for another's that shares the name after the agent.
fn canonical(key: &str) -> String {
    let named = key.strip_prefix("agent:").is_some_and(|rest| {
        rest.split_once(':')
            .is_some_and(|(id, name)| !id.is_empty() && !name.is_empty())
    });
    if named {
        key.to_owned()
    } else {
        format!("agent:{DEFAULT_AGENT}:{key}")
    }
}

/// The drain a new run in `session` must wait for: that of its own key, and, for a bare session,
/// of the same session under any agent the Gateway filed an earlier run of it under (waiting for
/// more than needed costs a moment; waiting for less would let a late call meet the next run).
fn drain_of(
    draining: &HashMap<String, Drain>,
    session: &str,
    key: &str,
) -> Option<(String, Instant)> {
    let bare = canonical(session) != session;
    draining
        .iter()
        .filter(|(found, _)| {
            found.as_str() == key || (bare && found.ends_with(&format!(":{session}")))
        })
        .map(|(found, drain)| (found.clone(), drain.until))
        .max_by_key(|(_, until)| *until)
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The line to one run's window: the program's end of a relay.
struct Line {
    /// Held while a call is in flight (by whoever has its turn).
    stream: Mutex<Wire>,
    /// The calls of the run in the order they came: one at a time, each within its own deadline.
    queue: Mutex<Queue>,
    turn: Condvar,
    /// The same socket, for ending the line from outside a call.
    control: UnixStream,
    /// The other keys the run's calls come under: the canonical key the Gateway reported for a
    /// run started with a bare key (`RunTools::adopt`).
    aliases: Mutex<Vec<String>>,
}

/// A run's calls, by ticket. A call that gives up before its turn leaves its ticket in `gave_up`,
/// which the turn passes over.
#[derive(Default)]
struct Queue {
    next: u64,
    serving: u64,
    gave_up: std::collections::HashSet<u64>,
}

impl Queue {
    /// Moves the turn on past the tickets that gave up.
    fn advance(&mut self) {
        self.serving += 1;
        while self.gave_up.remove(&self.serving) {
            self.serving += 1;
        }
    }
}

impl Line {
    /// Asks the window for a `tools/call` in its turn, after the calls that came before it, and all
    /// within `wait` of now: a call that has waited its whole time for its turn is not made at all,
    /// so the agent is never told it failed and then has the edit land.
    fn ask_in_turn(&self, params: Value, wait: Duration) -> Result<Value, String> {
        let until = Instant::now() + wait;
        let mut queue = locked(&self.queue);
        let ticket = queue.next;
        queue.next += 1;
        while queue.serving != ticket {
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                queue.gave_up.insert(ticket);
                return Err("The document didn’t answer in time.".to_owned());
            }
            queue = self
                .turn
                .wait_timeout(queue, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        drop(queue);
        let answered = locked(&self.stream).ask(
            "tools/call",
            params,
            until.saturating_duration_since(Instant::now()),
        );
        locked(&self.queue).advance();
        self.turn.notify_all();
        answered
    }
}

struct Wire {
    writer: UnixStream,
    reader: BufReader<UnixStream>,
    next_id: u64,
    /// The start of a line that a read timed out in: kept, so that the rest of it joins it.
    partial: String,
}

impl Wire {
    /// Sends a request and waits for the answer to it.
    fn ask(&mut self, method: &str, params: Value, wait: Duration) -> Result<Value, String> {
        self.ask_unless(method, params, wait, &|| false)
    }

    /// `ask`, looking every `LOOK` at whether the run has been told to stop, which ends the wait.
    fn ask_unless(
        &mut self,
        method: &str,
        params: Value,
        wait: Duration,
        stopped: &dyn Fn() -> bool,
    ) -> Result<Value, String> {
        let until = Instant::now() + wait;
        let id = self.next_id;
        self.next_id += 1;
        let line = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        self.send(&line)?;
        loop {
            if stopped() {
                return Err(STOPPED.to_owned());
            }
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("The document didn’t answer in time.".to_owned());
            }
            self.reader
                .get_ref()
                .set_read_timeout(Some(left.min(LOOK)))
                .map_err(|error| error.to_string())?;
            match self.reader.read_line(&mut self.partial) {
                Ok(0) => return Err("The run has ended.".to_owned()),
                Ok(_) => {
                    let text = std::mem::take(&mut self.partial);
                    if let Ok(message) = serde_json::from_str::<Value>(&text)
                        && message["id"] == json!(id)
                    {
                        return Ok(message);
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    // Not yet: the deadline and the stop are looked at at the top.
                }
                Err(_) => return Err("The run has ended.".to_owned()),
            }
        }
    }

    fn send(&mut self, message: &Value) -> Result<(), String> {
        let mut bytes = message.to_string().into_bytes();
        bytes.push(b'\n');
        self.writer
            .write_all(&bytes)
            .map_err(|_| "The run has ended.".to_owned())
    }
}

/// The live runs that have tools, by the session each runs in.
#[derive(Default)]
pub struct RunTools {
    live: Mutex<HashMap<String, Arc<Line>>>,
    /// Threads whose last run has lost its tools but isn't over at the Gateway: its agent may
    /// still make a call, which must not meet the thread's next run (the session key is the
    /// thread's, and calls carry no run id: `docs/research/openclaw-connection.md`). A new run
    /// in the thread waits for `settled`.
    draining: Mutex<HashMap<String, Drain>>,
    settled: Condvar,
}

/// A run that lost its tools and may not be over at the Gateway. Whichever comes first ends it: the
/// run's own `finish`, or `until`, which is how a run the Gateway never reported on (a dropped
/// connection, a final event that didn't come) is let go of.
struct Drain {
    /// The line of the run that is draining, by address: only that run's `finish` clears it.
    owner: usize,
    until: Instant,
}

/// A run's hold on its tools: dropping it, or calling `end`, ends the run's tool access.
pub struct Registration {
    tools: Arc<RunTools>,
    key: String,
    line: Arc<Line>,
    /// Whether dropping this says the run is over at the Gateway.
    settles: bool,
}

impl Registration {
    /// Ends the run's tool access now: a call that comes after this is refused, and one that is
    /// waiting is let go.
    pub fn end(&self) {
        let mut live = locked(&self.tools.live);
        let mut keys = vec![self.key.clone()];
        keys.extend(locked(&self.line.aliases).iter().cloned());
        for key in keys {
            if live
                .get(&key)
                .is_some_and(|line| Arc::ptr_eq(line, &self.line))
            {
                live.remove(&key);
                // Until `finish` or the deadline, the thread's next run waits.
                locked(&self.tools.draining).insert(
                    key,
                    Drain {
                        owner: Arc::as_ptr(&self.line) as usize,
                        until: Instant::now() + SETTLE_TIMEOUT,
                    },
                );
            }
        }
        drop(live);
        let _ = self.line.control.shutdown(Shutdown::Both);
    }

    /// The run is over at the Gateway (its final event came, or the wait for it ran out): the
    /// thread's next run may begin.
    pub fn finish(&self) {
        self.end();
        let mut draining = locked(&self.tools.draining);
        let owner = Arc::as_ptr(&self.line) as usize;
        draining.retain(|_, drain| drain.owner != owner);
        drop(draining);
        self.tools.settled.notify_all();
    }

    /// The run ended without the Gateway saying so (the connection failed, or the wait for its
    /// final event ran out): its agent may still make calls, so the thread's next run waits for
    /// the deadline instead.
    pub fn leave(mut self) {
        self.settles = false;
        self.end();
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        if self.settles {
            self.finish();
        } else {
            self.end();
        }
    }
}

impl RunTools {
    /// Connects to the run's relay (`socket`, the window's own) as the program does, and from then
    /// until the registration ends, answers calls made from `session`. A session that already has
    /// a live run isn't taken over: the first holds it.
    ///
    /// Registering can wait for the thread's last run (up to `SETTLE_TIMEOUT`) and for the window's
    /// handshake (up to `HANDSHAKE_TIMEOUT`); `stopped` is looked at throughout, and when it says
    /// so the registration is given up at once, so that Stop is not held for that long.
    pub fn register(
        self: &Arc<Self>,
        session: &str,
        socket: &str,
        stopped: &dyn Fn() -> bool,
    ) -> Result<Registration, String> {
        self.register_within(session, socket, SETTLE_TIMEOUT, stopped)
    }

    /// `register`, waiting at most `wait` for the thread's last run to be over.
    fn register_within(
        self: &Arc<Self>,
        session: &str,
        socket: &str,
        wait: Duration,
        stopped: &dyn Fn() -> bool,
    ) -> Result<Registration, String> {
        {
            let key = canonical(session);
            let deadline = Instant::now() + wait;
            let mut draining = locked(&self.draining);
            while let Some((found, until)) = drain_of(&draining, session, &key) {
                let now = Instant::now();
                if until <= now {
                    draining.remove(&found);
                    continue;
                }
                if stopped() {
                    return Err(STOPPED.to_owned());
                }
                let left = until.min(deadline).saturating_duration_since(now).min(LOOK);
                if left.is_zero() || until.min(deadline) <= now {
                    // This wait has run out: the old run's calls are refused as the new one
                    // isn't registered yet, and the next ones are the new run's.
                    break;
                }
                draining = self
                    .settled
                    .wait_timeout(draining, left)
                    .unwrap_or_else(PoisonError::into_inner)
                    .0;
            }
        }
        let writer = UnixStream::connect(socket)
            .map_err(|_| "Redlines’ tools for this run couldn’t be reached.".to_owned())?;
        let control = writer.try_clone().map_err(|error| error.to_string())?;
        let reader = BufReader::new(writer.try_clone().map_err(|error| error.to_string())?);
        let mut wire = Wire {
            writer,
            reader,
            next_id: 0,
            partial: String::new(),
        };
        // What a toolbox sees before any call.
        let hello = wire.ask_unless(
            "initialize",
            json!({"protocolVersion": "2025-06-18", "capabilities": {}}),
            HANDSHAKE_TIMEOUT,
            stopped,
        )?;
        if hello.get("error").is_some() {
            return Err("Redlines’ tools for this run didn’t start.".to_owned());
        }
        wire.send(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))?;
        let line = Arc::new(Line {
            stream: Mutex::new(wire),
            queue: Mutex::default(),
            turn: Condvar::new(),
            control,
            aliases: Mutex::default(),
        });
        let key = canonical(session);
        let mut live = locked(&self.live);
        if live.contains_key(&key) {
            return Err("This thread already has a run with tools.".to_owned());
        }
        live.insert(key.clone(), Arc::clone(&line));
        Ok(Registration {
            tools: Arc::clone(self),
            key,
            line,
            settles: true,
        })
    }

    /// Learns the key the Gateway filed a run under. A run started with a bare key is filed under
    /// the Gateway's default agent, which isn't always `main`; its `chat` events carry the key it
    /// really has (`agent:<id>:<session>`), and its calls come under that. From then on the run is
    /// found by that key too, and by no other agent's. A key that isn't the run's own session under
    /// some agent is ignored, and so is one that another run holds.
    pub fn adopt(&self, session: &str, reported: &str) {
        let own = canonical(session);
        let Some(rest) = reported.strip_prefix("agent:") else {
            return;
        };
        let named_ok = rest
            .split_once(':')
            .is_some_and(|(id, name)| !id.is_empty() && name == session);
        // A session that names its agent has its key already; the report can only repeat it.
        if !named_ok || own == session || own == reported {
            return;
        }
        let mut live = locked(&self.live);
        let Some(line) = live.get(&own).cloned() else {
            return;
        };
        if live.contains_key(reported) {
            return;
        }
        locked(&line.aliases).push(reported.to_owned());
        live.insert(reported.to_owned(), line);
    }

    /// Whether a run is live in this session.
    #[cfg(test)]
    pub fn is_live(&self, session: &str) -> bool {
        locked(&self.live).contains_key(&canonical(session))
    }

    /// Answers a `tools/call` made from `session`: the window's answer, or a refusal as the tool's
    /// own error, which the agent reads and can pass on.
    pub fn call(&self, session: Option<&str>, request: &Value) -> Value {
        let id = request["id"].clone();
        let refused = |message: &str| {
            json!({"jsonrpc": "2.0", "id": id, "result": {
                "content": [{"type": "text", "text": message}],
                "isError": true,
            }})
        };
        let Some(session) = session.map(canonical) else {
            return refused(NOT_LIVE);
        };
        let line = locked(&self.live).get(&session).cloned();
        let Some(line) = line else {
            return refused(NOT_LIVE);
        };
        // A run whose key the Gateway has told is reached by that key alone: the guess made
        // before is some other agent's session now.
        if let aliases = locked(&line.aliases)
            && !aliases.is_empty()
            && !aliases.contains(&session)
        {
            return refused(NOT_LIVE);
        }
        let answered = line.ask_in_turn(request["params"].clone(), CALL_TIMEOUT);
        // A run that ended while the call waited is a run that is not live.
        let still_live = locked(&self.live)
            .get(&session)
            .is_some_and(|now| Arc::ptr_eq(now, &line));
        match answered {
            // An answer that came is the answer, even if the run was stopped as it came: the
            // window had done it, and the agent is better told so than that it was refused.
            Ok(mut message) => {
                message["id"] = id;
                message
            }
            Err(why) if still_live => refused(&why),
            Err(_) => refused(NOT_LIVE),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixListener;
    use std::thread;

    use super::*;

    /// A relay's other end: answers `initialize` and each `tools/call` with the tool's name and
    /// arguments, as the window would answer with the tools' text.
    fn window(folder: &std::path::Path) -> (String, thread::JoinHandle<Vec<String>>) {
        let socket = folder.join("s");
        let listener = UnixListener::bind(&socket).unwrap();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut writer = stream;
            let mut heard = Vec::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    return heard;
                }
                let message: Value = serde_json::from_str(&line).unwrap();
                heard.push(message["method"].as_str().unwrap_or_default().to_owned());
                let result = match message["method"].as_str() {
                    Some("initialize") => json!({"protocolVersion": "2025-06-18"}),
                    Some("tools/call") => json!({
                        "content": [{"type": "text", "text": format!(
                            "{} {}", message["params"]["name"], message["params"]["arguments"])}],
                    }),
                    _ => continue,
                };
                let reply = json!({"jsonrpc": "2.0", "id": message["id"], "result": result});
                let _ = writeln!(writer, "{reply}");
            }
        });
        (socket.to_str().unwrap().to_owned(), handle)
    }

    fn call(tools: &RunTools, session: Option<&str>, tool: &str) -> Value {
        tools.call(
            session,
            &json!({"jsonrpc": "2.0", "id": 7, "method": "tools/call",
                "params": {"name": tool, "arguments": {"a": 1}}}),
        )
    }

    fn text(reply: &Value) -> String {
        reply["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }

    fn folder(name: &str) -> std::path::PathBuf {
        let folder = std::env::temp_dir().join(format!("rl-tools-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn a_live_run_is_answered_on_its_own_line_and_nobody_else() {
        let temp = folder("live");
        let (socket, window) = window(&temp);
        let tools = Arc::new(RunTools::default());
        let registration = tools
            .register("agent:main:redlines-1", &socket, &|| false)
            .unwrap();
        assert!(tools.is_live("agent:main:redlines-1"));

        let reply = call(&tools, Some("agent:main:redlines-1"), "str_replace");
        assert_eq!(reply["id"], 7);
        assert_eq!(reply["result"]["isError"], Value::Null);
        assert_eq!(text(&reply), "\"str_replace\" {\"a\":1}");

        // Not another run's session, and not a call with none.
        for other in [Some("agent:main:redlines-2"), None] {
            let refused = call(&tools, other, "str_replace");
            assert_eq!(refused["result"]["isError"], true);
            assert_eq!(text(&refused), NOT_LIVE);
        }
        drop(registration);
        let heard = window.join().unwrap();
        assert_eq!(
            heard,
            ["initialize", "notifications/initialized", "tools/call"]
        );
    }

    #[test]
    fn a_run_is_found_by_its_whole_key_and_never_by_the_name_after_the_agent() {
        assert_eq!(canonical("redlines-0a"), "agent:main:redlines-0a");
        assert_eq!(
            canonical("agent:main:redlines-0a"),
            "agent:main:redlines-0a"
        );
        assert_eq!(
            canonical("agent:moby:redlines-0a"),
            "agent:moby:redlines-0a"
        );
        // A malformed key names no agent: it is a bare name, and matches no agent's run.
        assert_eq!(canonical("agent:moby"), "agent:main:agent:moby");
        assert_eq!(canonical("agent::x"), "agent:main:agent::x");
        let temp = folder("bare");
        let (socket, _window) = window(&temp);
        let tools = Arc::new(RunTools::default());
        let _held = tools.register("redlines-0a", &socket, &|| false).unwrap();
        // The Gateway reports a bare key under its default agent.
        assert_ne!(
            text(&call(&tools, Some("agent:main:redlines-0a"), "view")),
            NOT_LIVE
        );
        assert_ne!(text(&call(&tools, Some("redlines-0a"), "view")), NOT_LIVE);
        for other in ["agent:main:redlines-0b", "agent:moby:redlines-0a"] {
            assert_eq!(
                text(&call(&tools, Some(other), "view")),
                NOT_LIVE,
                "{other}"
            );
        }
    }

    #[test]
    fn a_bare_key_run_is_found_by_the_key_its_gateway_files_it_under() {
        // A Gateway whose default agent is `moby`: the run's events carry that key.
        let temp = folder("moby-default");
        let (socket, _window) = window(&temp);
        let tools = Arc::new(RunTools::default());
        let held = tools.register("redlines-0a", &socket, &|| false).unwrap();
        tools.adopt("redlines-0a", "agent:moby:redlines-0a");
        assert_ne!(
            text(&call(&tools, Some("agent:moby:redlines-0a"), "view")),
            NOT_LIVE
        );
        // Not another agent's session of the same name, nor the guess made before.
        for other in [
            "agent:main:redlines-0a",
            "agent:zed:redlines-0a",
            "redlines-0b",
        ] {
            assert_eq!(
                text(&call(&tools, Some(other), "view")),
                NOT_LIVE,
                "{other}"
            );
        }
        // What the Gateway reports is taken only as this run's own session under some agent.
        tools.adopt("redlines-0a", "agent:zed:redlines-0b");
        tools.adopt("redlines-0a", "redlines-0a");
        assert!(!tools.is_live("agent:zed:redlines-0b"));
        // Ending the run ends the key it was found by, and the thread's next run waits for it.
        held.end();
        assert!(!tools.is_live("agent:moby:redlines-0a"));
        assert!(locked(&tools.draining).contains_key("agent:moby:redlines-0a"));
        held.finish();
        assert!(locked(&tools.draining).is_empty());
    }

    #[test]
    fn two_agents_sessions_that_share_the_name_after_the_agent_are_two_runs() {
        let (one, two) = (folder("agents-1"), folder("agents-2"));
        let (socket_1, _w1) = window(&one);
        let (socket_2, _w2) = window(&two);
        let tools = Arc::new(RunTools::default());
        let _a = tools
            .register("agent:moby:redlines-0a", &socket_1, &|| false)
            .unwrap();
        // Another agent's session, same tail: no run yet, so a call for it reaches nobody.
        assert_eq!(
            text(&call(&tools, Some("agent:main:redlines-0a"), "view")),
            NOT_LIVE
        );
        assert!(!tools.is_live("agent:main:redlines-0a"));
        // It can have its own run beside the first.
        let _b = tools
            .register("agent:main:redlines-0a", &socket_2, &|| false)
            .unwrap();
        assert!(tools.is_live("agent:moby:redlines-0a"));
        assert!(tools.is_live("agent:main:redlines-0a"));
    }

    #[test]
    fn a_late_call_of_an_aborted_run_never_reaches_the_threads_next_run() {
        let first = folder("late-1");
        let (socket_1, _window_1) = window(&first);
        let tools = Arc::new(RunTools::default());
        let old = tools
            .register("agent:main:redlines-0a", &socket_1, &|| false)
            .unwrap();
        // Stop: tools end now, the run isn't over at the Gateway yet.
        old.end();
        // The next run of the thread is told to wait, in a thread of its own.
        let second = folder("late-2");
        let (socket_2, window_2) = window(&second);
        let next = {
            let tools = Arc::clone(&tools);
            thread::spawn(move || {
                tools
                    .register_within(
                        "agent:main:redlines-0a",
                        &socket_2,
                        Duration::from_secs(5),
                        &|| false,
                    )
                    .map(|registration| (registration, Instant::now()))
            })
        };
        thread::sleep(Duration::from_millis(300));
        // A late call of the aborted run, while the next waits: refused, and heard by nobody.
        let late = call(&tools, Some("agent:main:redlines-0a"), "str_replace");
        assert_eq!(text(&late), NOT_LIVE);
        assert!(!tools.is_live("agent:main:redlines-0a"));
        // Its final event comes: now the next run registers.
        let settled = Instant::now();
        old.finish();
        let (registration, registered) = next.join().unwrap().unwrap();
        assert!(registered >= settled);
        assert!(tools.is_live("agent:main:redlines-0a"));
        let heard = {
            drop(registration);
            window_2.join().unwrap()
        };
        assert!(!heard.iter().any(|m| m == "tools/call"));
    }

    #[test]
    fn a_run_the_gateway_never_reported_on_keeps_its_thread_waiting_until_the_deadline() {
        let first = folder("lost-1");
        let (socket_1, _window_1) = window(&first);
        let tools = Arc::new(RunTools::default());
        let old = tools.register("redlines-0a", &socket_1, &|| false).unwrap();
        old.leave();
        let second = folder("lost-2");
        let (socket_2, _window_2) = window(&second);
        // It isn't let go of when its registration is: the next run waits as long as it is told.
        let began = Instant::now();
        let _ = tools.register_within(
            "redlines-0a",
            &socket_2,
            Duration::from_millis(300),
            &|| false,
        );
        assert!(began.elapsed() >= Duration::from_millis(300));
    }

    #[test]
    fn a_finish_of_an_older_run_doesnt_clear_the_drain_of_a_newer_one() {
        let first = folder("stale-1");
        let (socket_1, _window_1) = window(&first);
        let tools = Arc::new(RunTools::default());
        let a = tools.register("redlines-0a", &socket_1, &|| false).unwrap();
        a.end();
        // A's wait runs out, and B takes the thread, and is stopped.
        let second = folder("stale-2");
        let (socket_2, _window_2) = window(&second);
        locked(&tools.draining).clear();
        let b = tools.register("redlines-0a", &socket_2, &|| false).unwrap();
        b.end();
        // A's final event comes late.
        a.finish();
        assert!(locked(&tools.draining).contains_key("agent:main:redlines-0a"));
        b.finish();
        assert!(!locked(&tools.draining).contains_key("agent:main:redlines-0a"));
    }

    #[test]
    fn a_next_run_waits_only_so_long_for_the_run_before_it() {
        let first = folder("long-1");
        let (socket_1, _window_1) = window(&first);
        let tools = Arc::new(RunTools::default());
        let old = tools.register("redlines-0a", &socket_1, &|| false).unwrap();
        old.end();
        let second = folder("long-2");
        let (socket_2, _window_2) = window(&second);
        let began = Instant::now();
        let _next = tools
            .register_within(
                "redlines-0a",
                &socket_2,
                Duration::from_millis(200),
                &|| false,
            )
            .unwrap();
        assert!(began.elapsed() >= Duration::from_millis(200));
        assert!(began.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn a_stopped_run_refuses_its_next_call() {
        let temp = folder("stopped");
        let (socket, window) = window(&temp);
        let tools = Arc::new(RunTools::default());
        let registration = tools
            .register("agent:main:redlines-1", &socket, &|| false)
            .unwrap();
        assert!(text(&call(&tools, Some("agent:main:redlines-1"), "view")).contains("view"));
        registration.end();
        assert!(!tools.is_live("agent:main:redlines-1"));
        let refused = call(&tools, Some("agent:main:redlines-1"), "str_replace");
        assert_eq!(refused["result"]["isError"], true);
        assert_eq!(text(&refused), NOT_LIVE);
        // What the window heard ends with the one call it answered: the refused one never went.
        let heard = window.join().unwrap();
        assert_eq!(heard.iter().filter(|m| *m == "tools/call").count(), 1);
    }

    #[test]
    fn a_session_with_a_live_run_is_not_taken_over() {
        let temp = folder("twice");
        let (first, _first_window) = window(&temp);
        let tools = Arc::new(RunTools::default());
        let _held = tools
            .register("agent:main:redlines-1", &first, &|| false)
            .unwrap();
        let other = folder("twice-2");
        let (second, _second_window) = window(&other);
        assert!(
            tools
                .register("agent:main:redlines-1", &second, &|| false)
                .is_err()
        );
        assert!(tools.is_live("agent:main:redlines-1"));
    }

    #[test]
    fn a_runs_calls_go_in_the_order_they_came_and_one_that_gave_up_is_passed_over() {
        let mut queue = Queue {
            next: 4,
            serving: 0,
            gave_up: [1, 2].into(),
        };
        queue.advance();
        assert_eq!(
            queue.serving, 3,
            "tickets 1 and 2 gave up before their turn"
        );
        queue.advance();
        assert_eq!(queue.serving, 4);

        // And in a line: calls made one after another from threads are asked in that order.
        let (socket, _window) = window(&folder("order"));
        let tools = Arc::new(RunTools::default());
        let _held = tools.register("redlines-0c", &socket, &|| false).unwrap();
        let mut waiting = Vec::new();
        for name in ["a", "b", "c", "d"] {
            let tools = Arc::clone(&tools);
            waiting.push(thread::spawn(move || {
                text(&call(&tools, Some("redlines-0c"), name))
            }));
            thread::sleep(Duration::from_millis(30));
        }
        let answers: Vec<String> = waiting.into_iter().map(|h| h.join().unwrap()).collect();
        assert!(answers.iter().all(|a| !a.is_empty()));
    }

    #[test]
    fn a_socket_nobody_listens_on_is_an_error() {
        let tools = Arc::new(RunTools::default());
        assert!(
            tools
                .register("agent:main:redlines-1", "/nonexistent/rl-socket", &|| false)
                .is_err()
        );
    }

    #[test]
    fn a_call_that_waits_is_let_go_when_the_run_ends() {
        let temp = folder("waiting");
        let socket = temp.join("s");
        let listener = UnixListener::bind(&socket).unwrap();
        // A window that answers the handshake and then never answers a call.
        thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut writer = stream;
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let id: Value = serde_json::from_str(&line).unwrap();
            let _ = writeln!(
                writer,
                "{}",
                json!({"jsonrpc": "2.0", "id": id["id"], "result": {}})
            );
            loop {
                line.clear();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    return;
                }
            }
        });
        let tools = Arc::new(RunTools::default());
        let registration = tools
            .register("agent:main:redlines-1", socket.to_str().unwrap(), &|| false)
            .unwrap();
        let waiting = {
            let tools = Arc::clone(&tools);
            thread::spawn(move || call(&tools, Some("agent:main:redlines-1"), "view"))
        };
        thread::sleep(Duration::from_millis(300));
        registration.end();
        let reply = waiting.join().unwrap();
        assert_eq!(reply["result"]["isError"], true);
        assert_eq!(text(&reply), NOT_LIVE);
    }
}
