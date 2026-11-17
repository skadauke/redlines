//! An OpenClaw agent as the window sees every agent: the same Agent Client Protocol it speaks to a
//! program, but with a Gateway behind it instead (`openclaw_chat.rs`). An @-mention or Ask of an
//! OpenClaw connection that has chat access starts one of these runs, with its thread, its log and
//! its stop like any other run; what the agent says comes back as the agent's message, and the
//! window needs nothing new to read it.
//!
//! It answers the four messages `acp_gate.rs` lets a window send an OpenClaw agent that has no
//! toolbox: `initialize`; `session/new`, whose `_meta.sessionKey` names the thread's session at the
//! Gateway; `session/prompt`, which goes to the session as one message; and `session/cancel`, which
//! aborts the run. The agent's words are one `agent_message_chunk` and the prompt ends with
//! `end_turn`, `cancelled`, or an error in the Gateway's words.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};

use super::acp::AcpAgent;
use super::openclaw_chat::Outcome;
use super::openclaw_tools::{Registration, RunTools};
use super::process::ThreadRun;

/// Sends a message into a session and gives the agent's answer: the session's key, the text, and
/// the flag that says stop. It blocks until the run ends.
pub type Talk = Arc<dyn Fn(&str, &str, &AtomicBool) -> Result<Outcome, String> + Send + Sync>;

/// The session id this answers `session/new` with: the window only echoes it back.
const SESSION: &str = "gateway";

/// How often a waiting run looks at its stop flag and at the window's lines.
const LOOK: Duration = Duration::from_millis(50);

/// What the list of agents says of one that runs through a Gateway, which no program stands behind.
#[derive(Serialize)]
pub struct Listed {
    #[serde(flatten)]
    pub agent: AcpAgent,
    /// The window starts it as any other, and the host answers it from a Gateway.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub gateway: bool,
}

fn reply(id: &Value, result: Value) -> String {
    json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string()
}

fn failure(id: &Value, code: i64, message: &str) -> String {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}).to_string()
}

/// The text of a prompt: its blocks of text, the system's first, as one message.
fn prompt_text(params: &Value) -> String {
    params["prompt"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block["type"] == "text")
                .filter_map(|block| block["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .unwrap_or_default()
}

/// Speaks the protocol to a window until it stops the run or goes away. `talk` is the Gateway.
pub fn serve(lines: Receiver<String>, link: &ThreadRun, talk: &Talk, tools: &Arc<RunTools>) {
    let cancel = AtomicBool::new(false);
    // The run's hold on its tools (`openclaw_tools.rs`): ended with the run, and by Stop or cancel.
    let mut hold: Option<Registration> = None;
    let (done_in, done) = mpsc::channel::<(Value, Result<Outcome, String>)>();
    std::thread::scope(|scope| {
        let mut key: Option<String> = None;
        let mut busy = false;
        loop {
            if link.stopped() {
                cancel.store(true, Ordering::Relaxed);
                if let Some(held) = &hold {
                    held.end();
                }
            }
            if let Ok((id, outcome)) = done.try_recv() {
                busy = false;
                cancel.store(false, Ordering::Relaxed);
                // One run is one prompt: the tools end with it, and a second prompt in this session
                // would have none.
                // The run is over at the Gateway when it said so (its final event, `aborted` or
                // an error event): the thread's next run may have its tools. A run it never
                // reported on may still be going, and its thread waits for a deadline instead.
                if matches!(outcome, Ok(Outcome::Lost) | Err(_)) {
                    if let Some(held) = hold.take() {
                        held.leave();
                    }
                } else {
                    hold = None;
                }
                match outcome {
                    Ok(Outcome::Done(text)) => {
                        if !text.trim().is_empty() {
                            link.say(
                                json!({"jsonrpc": "2.0", "method": "session/update", "params": {
                                    "sessionId": SESSION,
                                    "update": {
                                        "sessionUpdate": "agent_message_chunk",
                                        "content": {"type": "text", "text": text},
                                    },
                                }})
                                .to_string(),
                            );
                        }
                        link.say(reply(&id, json!({"stopReason": "end_turn"})));
                    }
                    Ok(Outcome::Cancelled | Outcome::Lost) => {
                        link.say(reply(&id, json!({"stopReason": "cancelled"})));
                    }
                    Err(message) => link.say(failure(&id, -32603, &message)),
                }
                if link.stopped() {
                    return;
                }
            }
            if link.stopped() && !busy {
                return;
            }
            let line = match lines.recv_timeout(LOOK) {
                Ok(line) => line,
                Err(RecvTimeoutError::Timeout) => continue,
                // The window has let go of the run: what is running is told to stop.
                Err(RecvTimeoutError::Disconnected) => {
                    cancel.store(true, Ordering::Relaxed);
                    if let Some(held) = &hold {
                        held.end();
                    }
                    if !busy {
                        return;
                    }
                    std::thread::sleep(LOOK);
                    continue;
                }
            };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let id = message.get("id").cloned();
            match (message["method"].as_str(), id) {
                (Some("initialize"), Some(id)) => link.say(reply(
                    &id,
                    json!({"protocolVersion": 1, "agentCapabilities": {}, "authMethods": []}),
                )),
                (Some("session/new"), Some(id)) => {
                    match message["params"]["_meta"]["sessionKey"].as_str() {
                        Some(session) => {
                            // The relay the window opened for this run's tools, if it did: the
                            // gate has checked that it is the window's own.
                            if let Some(socket) = message["params"]["_meta"]["tools"].as_str() {
                                match tools.register(session, socket) {
                                    Ok(registered) => hold = Some(registered),
                                    Err(why) => {
                                        link.say(failure(&id, -32603, &why));
                                        continue;
                                    }
                                }
                            }
                            key = Some(session.to_owned());
                            link.say(reply(&id, json!({"sessionId": SESSION})));
                        }
                        None => link.say(failure(&id, -32602, "The session has no key.")),
                    }
                }
                (Some("session/prompt"), Some(id)) => {
                    let Some(session) = key.clone() else {
                        link.say(failure(&id, -32600, "There is no session yet."));
                        continue;
                    };
                    if busy {
                        link.say(failure(&id, -32600, "A prompt is already running."));
                        continue;
                    }
                    busy = true;
                    cancel.store(false, Ordering::Relaxed);
                    let (text, done_in, cancel) =
                        (prompt_text(&message["params"]), done_in.clone(), &cancel);
                    scope.spawn(move || {
                        // A panic in the talk is a failure of the prompt, not a run that never ends.
                        let outcome =
                            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                talk(&session, &text, cancel)
                            }))
                            .unwrap_or_else(|_| Err("The chat failed unexpectedly.".to_owned()));
                        let _ = done_in.send((id, outcome));
                    });
                }
                (Some("session/cancel"), None) => {
                    // Only a prompt that is running is cancelled: a cancel with none would stop the
                    // next one before it began.
                    if busy {
                        cancel.store(true, Ordering::Relaxed);
                        // Stop ends the run's tool access at once, before the Gateway has
                        // finished stopping the run; the thread's next run waits for that.
                        if let Some(held) = &hold {
                            held.end();
                        }
                    }
                }
                (Some(_), Some(id)) => link.say(failure(&id, -32601, "Method not found")),
                _ => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::Mutex;
    use std::time::Instant;

    use super::super::log::RunInfo;
    use super::super::process::{RunMessage, Runs};
    use super::*;
    use crate::agents::test_support::TempFolder;

    fn info() -> RunInfo {
        RunInfo {
            agent: "moby-ada".into(),
            thread: "t1".into(),
            document: None,
            version: None,
        }
    }

    type Heard = Arc<Mutex<Vec<RunMessage>>>;

    /// Starts a run served by `talk` and gives its input and what the window hears.
    fn start(runs: &Runs, folder: &Path, talk: Talk) -> (super::super::process::Input, Heard, u32) {
        let tools = Arc::new(RunTools::default());
        let heard: Heard = Arc::default();
        let sink = Arc::clone(&heard);
        let (started, input) = runs
            .start_thread(
                "main",
                folder,
                &info(),
                "OpenClaw Gateway",
                move |message| sink.lock().unwrap().push(message),
                move |lines, link| serve(lines, link, &talk, &tools),
            )
            .unwrap();
        (input, heard, started.id)
    }

    fn lines(heard: &Heard) -> Vec<Value> {
        heard
            .lock()
            .unwrap()
            .iter()
            .filter_map(|message| match message {
                RunMessage::Line { line } => serde_json::from_str(line).ok(),
                RunMessage::Ended { .. } => None,
            })
            .collect()
    }

    fn wait_for(heard: &Heard, what: impl Fn(&[Value]) -> bool) {
        let until = Instant::now() + Duration::from_secs(10);
        while Instant::now() < until {
            if what(&lines(heard)) {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("never heard it: {:?}", lines(heard));
    }

    fn input(line: Value) -> String {
        line.to_string()
    }

    const KEY: &str = "agent:moby:redlines-0123456789abcdef";

    fn open(input: &super::super::process::Input, heard: &Heard) {
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {}}),
            ))
            .unwrap();
        wait_for(heard, |l| l.iter().any(|m| m["id"] == 0));
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 1, "method": "session/new", "params": {
                    "cwd": "/x", "mcpServers": [], "_meta": {"sessionKey": KEY}}}),
            ))
            .unwrap();
        wait_for(heard, |l| l.iter().any(|m| m["id"] == 1));
    }

    fn input_of(value: Value) -> String {
        input(value)
    }

    #[test]
    fn a_prompt_goes_to_the_session_and_the_answer_comes_back_as_the_agents_words() {
        let folder = TempFolder::new("gw-run");
        let runs = Runs::default();
        let seen: Arc<Mutex<Vec<(String, String)>>> = Arc::default();
        let log = Arc::clone(&seen);
        let talk: Talk = Arc::new(move |session, text, _| {
            log.lock()
                .unwrap()
                .push((session.to_owned(), text.to_owned()));
            Ok(Outcome::Done("Fixed it.".to_owned()))
        });
        let (input, heard, _) = start(&runs, folder.path(), talk);
        open(&input, &heard);
        let initialized = lines(&heard);
        assert_eq!(initialized[0]["result"]["protocolVersion"], 1);
        assert_eq!(initialized[1]["result"]["sessionId"], "gateway");
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 2, "method": "session/prompt",
                "params": {"sessionId": "gateway", "prompt": [
                    {"type": "text", "text": "You are an editor."},
                    {"type": "text", "text": "Fix the spelling."}],
                    "_meta": {"prefixCwd": false}}}),
            ))
            .unwrap();
        wait_for(&heard, |l| l.iter().any(|m| m["id"] == 2));
        let all = lines(&heard);
        let chunk = &all[2];
        assert_eq!(chunk["method"], "session/update");
        assert_eq!(
            chunk["params"]["update"]["sessionUpdate"],
            "agent_message_chunk"
        );
        assert_eq!(chunk["params"]["update"]["content"]["text"], "Fixed it.");
        assert_eq!(all[3]["result"]["stopReason"], "end_turn");
        assert_eq!(
            seen.lock().unwrap()[0],
            (
                KEY.to_owned(),
                "You are an editor.\n\nFix the spelling.".to_owned()
            )
        );
    }

    #[test]
    fn a_runs_tools_live_from_its_session_until_it_is_cancelled() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::net::UnixListener;
        let folder = TempFolder::new("gw-tools");
        let socket = folder.path().join("s");
        let listener = UnixListener::bind(&socket).unwrap();
        // The window's relay: answers the handshake, and then only listens.
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut writer = stream;
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                let message: Value = serde_json::from_str(&line).unwrap();
                if message["method"] == "initialize" {
                    let _ = writeln!(
                        writer,
                        "{}",
                        json!({"jsonrpc": "2.0", "id": message["id"], "result": {}})
                    );
                }
                line.clear();
            }
        });
        let runs = Runs::default();
        let tools = Arc::new(RunTools::default());
        let talk: Talk = Arc::new(|_, _, stop| {
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(5));
            }
            Ok(Outcome::Cancelled)
        });
        let heard: Heard = Arc::default();
        let sink = Arc::clone(&heard);
        let (_, input) = runs
            .start_thread(
                "main",
                folder.path(),
                &info(),
                "OpenClaw Gateway",
                move |message| sink.lock().unwrap().push(message),
                {
                    let tools = Arc::clone(&tools);
                    move |lines, link| serve(lines, link, &talk, &tools)
                },
            )
            .unwrap();
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {}}),
            ))
            .unwrap();
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 1, "method": "session/new", "params": {
                    "cwd": "/x", "mcpServers": [],
                    "_meta": {"sessionKey": KEY, "tools": socket.to_str().unwrap()}}}),
            ))
            .unwrap();
        wait_for(&heard, |l| l.iter().any(|m| m["id"] == 1));
        assert!(tools.is_live(KEY));
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 2, "method": "session/prompt",
                "params": {"sessionId": "gateway", "prompt": [{"type": "text", "text": "Hi"}]}}),
            ))
            .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert!(tools.is_live(KEY), "live while the prompt runs");
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "method": "session/cancel", "params": {"sessionId": "gateway"}}),
            ))
            .unwrap();
        wait_for(&heard, |l| l.iter().any(|m| m["id"] == 2));
        assert!(!tools.is_live(KEY), "cancel ends the tool access");
    }

    #[test]
    fn a_run_whose_tools_cant_start_doesnt_open_a_session() {
        let folder = TempFolder::new("gw-tools");
        let runs = Runs::default();
        let tools = Arc::new(RunTools::default());
        let talk: Talk = Arc::new(|_, _, _| panic!("no session, no message"));
        let heard: Heard = Arc::default();
        let sink = Arc::clone(&heard);
        let (_, input) = runs
            .start_thread(
                "main",
                folder.path(),
                &info(),
                "OpenClaw Gateway",
                move |message| sink.lock().unwrap().push(message),
                move |lines, link| serve(lines, link, &talk, &tools),
            )
            .unwrap();
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 1, "method": "session/new", "params": {
                    "cwd": "/x", "mcpServers": [],
                    "_meta": {"sessionKey": KEY, "tools": "/nonexistent/rl/s"}}}),
            ))
            .unwrap();
        wait_for(&heard, |l| l.iter().any(|m| m["id"] == 1));
        assert!(lines(&heard)[0]["error"]["message"].is_string());
    }

    #[test]
    fn a_failure_is_an_error_in_the_gateways_words() {
        let folder = TempFolder::new("gw-run");
        let runs = Runs::default();
        let talk: Talk = Arc::new(|_, _, _| Err("No model is signed in.".to_owned()));
        let (input, heard, _) = start(&runs, folder.path(), talk);
        open(&input, &heard);
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 2, "method": "session/prompt",
                "params": {"sessionId": "gateway", "prompt": [{"type": "text", "text": "Hi"}]}}),
            ))
            .unwrap();
        wait_for(&heard, |l| l.iter().any(|m| m["id"] == 2));
        let error = lines(&heard).pop().unwrap();
        assert_eq!(error["error"]["message"], "No model is signed in.");
    }

    #[test]
    fn cancel_and_stop_both_reach_the_run_and_it_ends() {
        let folder = TempFolder::new("gw-run");
        let runs = Runs::default();
        let talk: Talk = Arc::new(|_, _, stop| {
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(5));
            }
            Ok(Outcome::Cancelled)
        });
        let (input, heard, id) = start(&runs, folder.path(), talk);
        open(&input, &heard);
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 2, "method": "session/prompt",
                "params": {"sessionId": "gateway", "prompt": [{"type": "text", "text": "Hi"}]}}),
            ))
            .unwrap();
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "method": "session/cancel", "params": {"sessionId": "gateway"}}),
            ))
            .unwrap();
        wait_for(&heard, |l| {
            l.iter()
                .any(|m| m["id"] == 2 && m["result"]["stopReason"] == "cancelled")
        });
        // Stopping the run itself ends it, and the window hears the end.
        runs.stop("main", id).unwrap();
        let until = Instant::now() + Duration::from_secs(10);
        while !heard
            .lock()
            .unwrap()
            .iter()
            .any(|m| matches!(m, RunMessage::Ended { .. }))
        {
            assert!(Instant::now() < until, "the run never ended");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn what_it_does_not_do_is_refused_and_a_prompt_before_a_session_is_an_error() {
        let folder = TempFolder::new("gw-run");
        let runs = Runs::default();
        let talk: Talk = Arc::new(|_, _, _| panic!("no session, no message"));
        let (input, heard, _) = start(&runs, folder.path(), talk);
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 5, "method": "session/prompt",
                "params": {"sessionId": "gateway", "prompt": []}}),
            ))
            .unwrap();
        input
            .send(&input_of(
                json!({"jsonrpc": "2.0", "id": 6, "method": "session/load", "params": {}}),
            ))
            .unwrap();
        wait_for(&heard, |l| l.iter().any(|m| m["id"] == 6));
        let all = lines(&heard);
        assert_eq!(all[0]["error"]["code"], -32600);
        assert_eq!(all[1]["error"]["code"], -32601);
    }
}
