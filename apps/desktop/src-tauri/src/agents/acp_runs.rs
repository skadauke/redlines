//! Runs of the Agent Client Protocol agents the person added (`acp.rs`). A window names the agent
//! by its id and gives a folder; the line is the stored program and arguments, exactly, with
//! nothing a window could add, since the agent takes the prompt and the toolbox as messages on its
//! stdin. Each message a window sends passes `acp_gate.rs` on its way in, which also hears every
//! line on the way out, to know what the agent asked. `agent_start` never starts one of these: its
//! program was never returned by `which`.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use super::acp::{AcpAgent, AcpAgents};
use super::acp_gate::Conversation;
use super::log::RunInfo;
use super::process::{Input, RunMessage, Runs, Spec, Started};

/// The runs of every window's ACP agents, by the id `Runs` gave them.
#[derive(Default)]
pub struct AcpRuns {
    running: Arc<Mutex<HashMap<u32, Arc<AcpRun>>>>,
}

struct AcpRun {
    /// The label of the window that started it.
    owner: String,
    input: Input,
    shared: Arc<Shared>,
}

/// What the run and the thread reading its lines share.
struct Shared {
    conversation: Mutex<Conversation>,
    id: OnceLock<u32>,
    ended: AtomicBool,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The program to start for the agent with this id, in `cwd`: exactly the line the person allowed.
pub fn spec_for(agents: &AcpAgents, id: &str, cwd: &str, log: RunInfo) -> Result<Spec, String> {
    let AcpAgent { program, args, .. } = agents
        .get(id)
        .ok_or_else(|| "That agent isn't in Preferences any more.".to_owned())?;
    if !Path::new(cwd).is_absolute() {
        return Err("Redlines runs an agent only in an absolute folder.".to_owned());
    }
    Ok(Spec {
        program,
        args,
        cwd: Some(cwd.to_owned()),
        log,
    })
}

impl AcpRuns {
    fn running(&self) -> MutexGuard<'_, HashMap<u32, Arc<AcpRun>>> {
        locked(&self.running)
    }

    /// Starts an agent for the window `owner`, if the window is still there. `bundled` is the only
    /// MCP server its sessions may name, and `send` hears each line and then the end.
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        &self,
        runs: &Runs,
        owner: &str,
        log_folder: &Path,
        spec: &Spec,
        environment: &[(OsString, OsString)],
        bundled: &str,
        window_open: impl Fn() -> bool,
        send: impl Fn(RunMessage) + Send + Sync + 'static,
    ) -> Result<Started, String> {
        let shared = Arc::new(Shared {
            conversation: Mutex::new(Conversation::new(bundled)),
            id: OnceLock::new(),
            ended: AtomicBool::new(false),
        });
        let hearing = Arc::clone(&shared);
        let running = Arc::clone(&self.running);
        let (started, input) =
            runs.start_with_input(owner, log_folder, spec, environment, move |message| {
                match &message {
                    RunMessage::Line { line } => locked(&hearing.conversation).heard(line),
                    RunMessage::Ended { .. } => {
                        hearing.ended.store(true, Ordering::SeqCst);
                        if let Some(id) = hearing.id.get() {
                            locked(&running).remove(id);
                        }
                    }
                }
                send(message);
            })?;
        let _ = shared.id.set(started.id);
        self.running().insert(
            started.id,
            Arc::new(AcpRun {
                owner: owner.to_owned(),
                input,
                shared: Arc::clone(&shared),
            }),
        );
        // It may have ended before it was listed, and then nothing else would take it off.
        if shared.ended.load(Ordering::SeqCst) {
            self.running().remove(&started.id);
        }
        if !window_open() {
            runs.stop_owned_by(owner);
            return Err("The window has closed.".to_owned());
        }
        Ok(started)
    }

    /// Sends a message of the window `owner` to its run, if `acp_gate.rs` lets it through: what it
    /// checked is what is written. `sockets` are the window's relays.
    pub fn send(&self, owner: &str, id: u32, line: &str, sockets: &[String]) -> Result<(), String> {
        let run = self
            .running()
            .get(&id)
            .cloned()
            .ok_or_else(|| "That agent has stopped.".to_owned())?;
        if run.owner != owner {
            return Err("That run belongs to another window.".to_owned());
        }
        // Checked under the lock and written after it, so that the thread hearing the agent never
        // waits on a write the agent isn't reading.
        let checked = locked(&run.shared.conversation).check(line, sockets)?;
        run.input.send(&checked)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::mpsc::{self, Receiver};
    use std::time::Duration;

    use serde_json::{Value, json};

    use super::*;
    use crate::agents::test_support::TempFolder;
    use crate::agents::which::Programs;

    const WAIT: Duration = Duration::from_secs(20);
    const SOCKET: &str = "/var/folders/06/T/rl-7582-0/s";
    const BUNDLED: &str = "/Applications/Redlines.app/Contents/MacOS/redlines";

    fn info() -> RunInfo {
        RunInfo {
            agent: "echo".to_owned(),
            thread: "c1".to_owned(),
            document: None,
            version: None,
        }
    }

    /// The list, with one agent the person allowed: `/bin/sh` reading its stdin and printing each
    /// line back, which stands in for an agent.
    fn allowed(temp: &TempFolder) -> AcpAgents {
        let agents = AcpAgents::new(temp.path().join("acp-agents.json"));
        agents
            .add(
                "Echo",
                r#"sh -c 'while read line; do echo "$line"; done'"#,
                |_| Some("/bin/sh".to_owned()),
                |_| true,
            )
            .unwrap();
        agents
    }

    fn start(
        acp: &AcpRuns,
        runs: &Runs,
        temp: &TempFolder,
        spec: &Spec,
    ) -> (Started, Receiver<RunMessage>) {
        let (sender, receiver) = mpsc::channel();
        let sender = Mutex::new(sender);
        let started = acp
            .start(
                runs,
                "main",
                &temp.path().join("logs"),
                spec,
                &[(OsString::from("PATH"), OsString::from("/usr/bin:/bin"))],
                BUNDLED,
                || true,
                move |message| {
                    let _ = sender.lock().unwrap().send(message);
                },
            )
            .unwrap();
        (started, receiver)
    }

    fn next_line(receiver: &Receiver<RunMessage>) -> String {
        match receiver.recv_timeout(WAIT).expect("a line") {
            RunMessage::Line { line } => line,
            ended => panic!("expected a line, got {ended:?}"),
        }
    }

    fn initialize() -> String {
        json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
            "protocolVersion": 1,
            "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false },
                                    "terminal": false } } })
        .to_string()
    }

    #[test]
    fn a_run_is_exactly_the_line_the_person_allowed() {
        let temp = TempFolder::new("acp-runs-line");
        let agents = allowed(&temp);
        let spec = spec_for(&agents, "echo", "/Users/ada/project", info()).unwrap();
        let stored = agents.get("echo").unwrap();
        assert_eq!(spec.program, stored.program);
        assert_eq!(spec.args, stored.args);
        assert_eq!(spec.cwd.as_deref(), Some("/Users/ada/project"));

        assert!(spec_for(&agents, "gemini", "/Users/ada/project", info()).is_err());
        assert!(spec_for(&agents, "", "/Users/ada/project", info()).is_err());
        assert!(spec_for(&agents, "echo", "relative", info()).is_err());
    }

    #[test]
    fn the_window_cant_start_a_stored_agents_program_the_other_way() {
        // `agent_start` takes a program and arguments from the window; a stored agent's program
        // isn't one `which` returned, so no line of it starts, exact or with more on the end.
        let temp = TempFolder::new("acp-runs-other-way");
        let agents = allowed(&temp);
        let stored = agents.get("echo").unwrap();
        let programs = Programs::new(
            vec![PathBuf::from("/bin")],
            PathBuf::from("/bin/sh"),
            vec![],
            PathBuf::from(BUNDLED),
        );
        let sockets = [SOCKET.to_owned()];
        let mut longer = stored.args.clone();
        longer.push("--yolo".to_owned());
        for args in [&stored.args, &longer] {
            assert!(programs.may_start(&stored.program, args, &sockets).is_err());
        }
    }

    #[test]
    fn only_what_the_gate_lets_through_reaches_the_agent() {
        let temp = TempFolder::new("acp-runs-gate");
        let agents = allowed(&temp);
        let spec = spec_for(&agents, "echo", temp.path().to_str().unwrap(), info()).unwrap();
        let (acp, runs) = (AcpRuns::default(), Runs::default());
        let (started, receiver) = start(&acp, &runs, &temp, &spec);
        let sockets = [SOCKET.to_owned()];

        let yolo = json!({ "jsonrpc": "2.0", "id": 5, "method": "session/set_mode",
                           "params": { "sessionId": "s", "modeId": "yolo" } });
        assert!(
            acp.send("main", started.id, &yolo.to_string(), &sockets)
                .is_err()
        );
        assert!(
            acp.send("doc-2", started.id, &initialize(), &sockets)
                .is_err(),
            "another window's"
        );
        acp.send("main", started.id, &initialize(), &sockets)
            .unwrap();
        let echoed: Value = serde_json::from_str(&next_line(&receiver)).unwrap();
        assert_eq!(echoed["method"], "initialize");

        runs.stop("main", started.id).unwrap();
        loop {
            if let RunMessage::Ended { .. } = receiver.recv_timeout(WAIT).unwrap() {
                break;
            }
        }
        assert!(
            acp.send("main", started.id, &initialize(), &sockets)
                .is_err()
        );
        assert!(acp.running().is_empty(), "an ended run is let go of");

        // The log has what went in: the one message, and not the refused one.
        let log = std::fs::read_to_string(&started.log_path).unwrap();
        let sent: Vec<Value> = log
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .filter(|entry| entry["redlines"] == "stdin")
            .collect();
        assert_eq!(sent.len(), 1, "{log}");
        assert_eq!(sent[0]["message"]["method"], "initialize");
    }

    /// The real `initialize` handshake with Gemini CLI, where it is installed: nothing past it, so
    /// no session, no prompt, no model and no sign-in. `cargo test -- --ignored real_gemini`.
    #[test]
    #[ignore = "needs gemini at /opt/homebrew/bin/gemini"]
    fn real_gemini_answers_initialize() {
        let temp = TempFolder::new("acp-runs-gemini");
        let agents = AcpAgents::new(temp.path().join("acp-agents.json"));
        agents
            .add(
                "Gemini",
                "gemini --experimental-acp",
                |_| Some("/opt/homebrew/bin/gemini".to_owned()),
                |_| true,
            )
            .unwrap();
        let folder = temp.path().join("empty");
        std::fs::create_dir_all(&folder).unwrap();
        let spec = spec_for(&agents, "gemini", folder.to_str().unwrap(), info()).unwrap();
        let (acp, runs) = (AcpRuns::default(), Runs::default());
        let programs = Programs::for_this_machine();
        let environment = programs.environment_for(Path::new(&spec.program));
        let (sender, receiver) = mpsc::channel();
        let sender = Mutex::new(sender);
        let started = acp
            .start(
                &runs,
                "main",
                &temp.path().join("logs"),
                &spec,
                &environment,
                BUNDLED,
                || true,
                move |message| {
                    let _ = sender.lock().unwrap().send(message);
                },
            )
            .unwrap();
        acp.send("main", started.id, &initialize(), &[]).unwrap();
        let answer = loop {
            let line = match receiver.recv_timeout(Duration::from_secs(60)).unwrap() {
                RunMessage::Line { line } => line,
                ended => panic!("ended first: {ended:?}"),
            };
            if let Ok(message) = serde_json::from_str::<Value>(&line)
                && message["id"] == 0
            {
                break message;
            }
        };
        println!("gemini answered: {answer}");
        runs.stop("main", started.id).unwrap();
        while !matches!(
            receiver.recv_timeout(WAIT).unwrap(),
            RunMessage::Ended { .. }
        ) {}
        assert_eq!(answer["result"]["protocolVersion"], 1);
    }
}
