//! The tool bridge: an agent asked through a Gateway edits the document it was asked from, through
//! Redlines' node tools, and only while its run is live.
//!
//! How a call finds its run (`docs/research/openclaw-connection.md`, "The tool bridge"): OpenClaw
//! puts the agent's session key on every call of a node tool. The agent's tool calls `node.invoke`
//! with `sessionKey` (`openclaw-plugin-tools-*.mjs`, the plugin tool's `execute`), and the Gateway
//! forwards it in the `node.invoke.request` event (`node-invoke-request-*.mjs`, `sessionKey`). The
//! session of a run is the key Redlines chose for the thread (`sessionOf` in `plugins/agent-acp`),
//! so a call names its run by a key only that run's thread was given.
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

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::{Value, json};

/// How long a call may take at the window: an edit is quick, and a person is never waited on.
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// How long a thread's next run waits for the run before it to be over at the Gateway: its final
/// `chat` event (`aborted`, `error` or `final`) or, failing that, this. A little longer than the
/// grace a stopped run is given for that event (`ABORT_GRACE` in `openclaw_chat.rs`).
pub const SETTLE_TIMEOUT: Duration = Duration::from_secs(8);

/// How long the window may take to answer the handshake.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);

/// Why a call is refused when no live run is behind it.
pub const NOT_LIVE: &str = "This call is not part of a live Redlines run, so it can't change \
    any document. Redlines' tools work only inside a run that a person started in Redlines, until \
    they stop it.";

/// What names a run's thread in a session key. The Gateway files a session under an agent
/// (`agent:main:redlines-0123456789abcdef`) and reports calls with that key, even when the run was
/// started with the bare `redlines-0123456789abcdef`, which it files under its default agent
/// (seen live). The part after the agent is what Redlines chose for the thread (a hash of the
/// document and the thread), so that is what a call is matched on.
fn thread_of(key: &str) -> &str {
    key.strip_prefix("agent:")
        .and_then(|rest| rest.split_once(':'))
        .map_or(key, |(_, thread)| thread)
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The line to one run's window: the program's end of a relay.
struct Line {
    /// Held while a call is in flight, so that calls go one at a time, in order.
    stream: Mutex<Wire>,
    /// The same socket, for ending the line from outside a call.
    control: UnixStream,
}

struct Wire {
    writer: UnixStream,
    reader: BufReader<UnixStream>,
    next_id: u64,
}

impl Wire {
    /// Sends a request and waits for the answer to it.
    fn ask(&mut self, method: &str, params: Value, wait: Duration) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let line = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        self.send(&line)?;
        self.reader
            .get_ref()
            .set_read_timeout(Some(wait))
            .map_err(|error| error.to_string())?;
        loop {
            let mut text = String::new();
            match self.reader.read_line(&mut text) {
                Ok(0) => return Err("The run has ended.".to_owned()),
                Ok(_) => {
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
                    return Err("The document didn’t answer in time.".to_owned());
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
    draining: Mutex<HashSet<String>>,
    settled: Condvar,
}

/// A run's hold on its tools: dropping it, or calling `end`, ends the run's tool access.
pub struct Registration {
    tools: Arc<RunTools>,
    key: String,
    line: Arc<Line>,
}

impl Registration {
    /// Ends the run's tool access now: a call that comes after this is refused, and one that is
    /// waiting is let go.
    pub fn end(&self) {
        let mut live = locked(&self.tools.live);
        if live
            .get(&self.key)
            .is_some_and(|line| Arc::ptr_eq(line, &self.line))
        {
            live.remove(&self.key);
            // Until `finish`, the thread's next run waits.
            locked(&self.tools.draining).insert(self.key.clone());
        }
        drop(live);
        let _ = self.line.control.shutdown(Shutdown::Both);
    }

    /// The run is over at the Gateway (its final event came, or the wait for it ran out): the
    /// thread's next run may begin.
    pub fn finish(&self) {
        self.end();
        locked(&self.tools.draining).remove(&self.key);
        self.tools.settled.notify_all();
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        self.finish();
    }
}

impl RunTools {
    /// Connects to the run's relay (`socket`, the window's own) as the program does, and from then
    /// until the registration ends, answers calls made from `session`. A session that already has
    /// a live run isn't taken over: the first holds it.
    pub fn register(self: &Arc<Self>, session: &str, socket: &str) -> Result<Registration, String> {
        self.register_within(session, socket, SETTLE_TIMEOUT)
    }

    /// `register`, waiting at most `wait` for the thread's last run to be over.
    fn register_within(
        self: &Arc<Self>,
        session: &str,
        socket: &str,
        wait: Duration,
    ) -> Result<Registration, String> {
        {
            let key = thread_of(session);
            let deadline = std::time::Instant::now() + wait;
            let mut draining = locked(&self.draining);
            while draining.contains(key) {
                let left = deadline.saturating_duration_since(std::time::Instant::now());
                if left.is_zero() {
                    // The wait has run out: the old run is let go of, and calls from it are
                    // refused as the new run isn't registered yet.
                    draining.remove(key);
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
        };
        // What a toolbox sees before any call.
        let hello = wire.ask(
            "initialize",
            json!({"protocolVersion": "2025-06-18", "capabilities": {}}),
            HANDSHAKE_TIMEOUT,
        )?;
        if hello.get("error").is_some() {
            return Err("Redlines’ tools for this run didn’t start.".to_owned());
        }
        wire.send(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))?;
        let line = Arc::new(Line {
            stream: Mutex::new(wire),
            control,
        });
        let key = thread_of(session).to_owned();
        let mut live = locked(&self.live);
        if live.contains_key(&key) {
            return Err("This thread already has a run with tools.".to_owned());
        }
        live.insert(key.clone(), Arc::clone(&line));
        Ok(Registration {
            tools: Arc::clone(self),
            key,
            line,
        })
    }

    /// Whether a run is live in this session.
    #[cfg(test)]
    pub fn is_live(&self, session: &str) -> bool {
        locked(&self.live).contains_key(thread_of(session))
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
        let Some(session) = session.map(thread_of) else {
            return refused(NOT_LIVE);
        };
        let line = locked(&self.live).get(session).cloned();
        let Some(line) = line else {
            return refused(NOT_LIVE);
        };
        let answered =
            locked(&line.stream).ask("tools/call", request["params"].clone(), CALL_TIMEOUT);
        // A run that ended while the call waited is a run that is not live.
        let still_live = locked(&self.live)
            .get(session)
            .is_some_and(|now| Arc::ptr_eq(now, &line));
        match answered {
            Ok(mut message) if still_live => {
                message["id"] = id;
                message
            }
            Ok(_) => refused(NOT_LIVE),
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
    use std::time::Instant;

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
        let registration = tools.register("agent:main:redlines-1", &socket).unwrap();
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
    fn a_run_is_found_by_its_thread_whatever_agent_the_gateway_files_it_under() {
        assert_eq!(thread_of("redlines-0a"), "redlines-0a");
        assert_eq!(thread_of("agent:main:redlines-0a"), "redlines-0a");
        assert_eq!(thread_of("agent:moby:redlines-0a"), "redlines-0a");
        assert_eq!(thread_of("agent:moby"), "agent:moby");
        let temp = folder("bare");
        let (socket, _window) = window(&temp);
        let tools = Arc::new(RunTools::default());
        let _held = tools.register("redlines-0a", &socket).unwrap();
        assert_ne!(
            text(&call(&tools, Some("agent:main:redlines-0a"), "view")),
            NOT_LIVE
        );
        assert_eq!(
            text(&call(&tools, Some("agent:main:redlines-0b"), "view")),
            NOT_LIVE
        );
    }

    #[test]
    fn a_late_call_of_an_aborted_run_never_reaches_the_threads_next_run() {
        let first = folder("late-1");
        let (socket_1, _window_1) = window(&first);
        let tools = Arc::new(RunTools::default());
        let old = tools.register("agent:main:redlines-0a", &socket_1).unwrap();
        // Stop: tools end now, the run isn't over at the Gateway yet.
        old.end();
        // The next run of the thread is told to wait, in a thread of its own.
        let second = folder("late-2");
        let (socket_2, window_2) = window(&second);
        let next = {
            let tools = Arc::clone(&tools);
            thread::spawn(move || {
                tools
                    .register_within("agent:main:redlines-0a", &socket_2, Duration::from_secs(5))
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
    fn a_next_run_waits_only_so_long_for_the_run_before_it() {
        let first = folder("long-1");
        let (socket_1, _window_1) = window(&first);
        let tools = Arc::new(RunTools::default());
        let old = tools.register("redlines-0a", &socket_1).unwrap();
        old.end();
        let second = folder("long-2");
        let (socket_2, _window_2) = window(&second);
        let began = Instant::now();
        let _next = tools
            .register_within("redlines-0a", &socket_2, Duration::from_millis(200))
            .unwrap();
        assert!(began.elapsed() >= Duration::from_millis(200));
        assert!(began.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn a_stopped_run_refuses_its_next_call() {
        let temp = folder("stopped");
        let (socket, window) = window(&temp);
        let tools = Arc::new(RunTools::default());
        let registration = tools.register("agent:main:redlines-1", &socket).unwrap();
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
        let _held = tools.register("agent:main:redlines-1", &first).unwrap();
        let other = folder("twice-2");
        let (second, _second_window) = window(&other);
        assert!(tools.register("agent:main:redlines-1", &second).is_err());
        assert!(tools.is_live("agent:main:redlines-1"));
    }

    #[test]
    fn a_socket_nobody_listens_on_is_an_error() {
        let tools = Arc::new(RunTools::default());
        assert!(
            tools
                .register("agent:main:redlines-1", "/nonexistent/rl-socket")
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
            .register("agent:main:redlines-1", socket.to_str().unwrap())
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
