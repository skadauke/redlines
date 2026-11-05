//! Starting an agent's program, following it, and stopping it.
//!
//! A program gets its own process group, so that stopping it reaches whatever it started. Its
//! stdin is closed, because with a piped stdin Codex reads it and adds it to the prompt. Its lines
//! reach the window that started it through a sink, and its log (`log.rs`) as they arrive.
//!
//! A run belongs to the window that started it: another window can't stop it, and the sink is that
//! window's own channel. The app can have any number of windows, each with its own runs.

use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};

use super::log::{RunEnd, RunInfo, RunLog};

/// How long a program gets to end after SIGINT, and then after SIGTERM, before SIGKILL.
pub const STOP_GRACE: Duration = Duration::from_secs(3);

/// How much of a program's stderr is kept for the end of a run.
const STDERR_KEPT: usize = 8192;

/// How long what a program left behind gets to go, after SIGTERM and again after SIGKILL. Something
/// that has left the group can hold the program's pipes open forever, and this is as long as it can
/// hold back the end of the run.
const LEFTOVER_GRACE: Duration = Duration::from_millis(500);

/// A program to start: `ProcessSpec` from `@redlines/plugin-api`, whose other fields, if any, aren't
/// for this side.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Spec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub log: RunInfo,
}

/// What a window hears about its run. `src/agent-host.ts` reads these by name.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RunMessage {
    Line { line: String },
    Ended { code: Option<i32>, stderr: String },
}

/// A run that has started. `src/agent-host.ts` reads these by name.
#[derive(Clone, Debug, Serialize)]
pub struct Started {
    pub id: u32,
    pub log_path: String,
}

/// What `exec` gives back. `src/agent-host.ts` reads these by name.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ExecOutput {
    pub code: Option<i32>,
    pub stdout: String,
}

/// The environment a program should get from `variables`. Started from inside a Claude Code
/// session the app inherits what turns off a plan's sign-in, such as `CLAUDE_CODE_SIMPLE`, so when
/// `CLAUDECODE` is set those go. Otherwise nothing does: the rest is the person's own.
pub fn clean_environment(
    variables: impl IntoIterator<Item = (OsString, OsString)>,
) -> Vec<(OsString, OsString)> {
    let variables: Vec<_> = variables.into_iter().collect();
    if !variables.iter().any(|(name, _)| name == "CLAUDECODE") {
        return variables;
    }
    variables
        .into_iter()
        .filter(|(name, _)| {
            let name = name.to_string_lossy();
            !(name == "CLAUDECODE"
                || name == "ANTHROPIC_BASE_URL"
                || name.starts_with("CLAUDE_CODE_")
                || name.starts_with("CLAUDE_AGENT_SDK_"))
        })
        .collect()
}

/// A command for a program: in a group of its own, with stdin closed and only this environment.
fn command_for(program: &str, args: &[String], environment: &[(OsString, OsString)]) -> Command {
    let mut command = Command::new(program);
    command
        .args(args)
        .env_clear()
        .envs(environment.iter().map(|(name, value)| (name, value)))
        .stdin(Stdio::null())
        .process_group(0);
    command
}

/// Runs a program to its end and gives back its stdout, in its own group with stdin closed. A
/// program still going after `timeout` is killed, and has no exit code.
pub fn exec(
    program: &str,
    args: &[String],
    environment: &[(OsString, OsString)],
    timeout: Duration,
) -> Result<ExecOutput, String> {
    let mut child = command_for(program, args, environment)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Couldn't run {program}: {error}"))?;
    let group = group_of(&child);
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let (printed, reading) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        let _ = printed.send(bytes);
    });

    let status = wait_until(&mut child, Instant::now() + timeout);
    if status.is_none() {
        signal_group(group, libc::SIGKILL);
        let _ = child.wait();
    }
    // Whatever it left behind goes too, so that nothing holds its stdout open.
    signal_group(group, libc::SIGKILL);
    let stdout = reading.recv_timeout(LEFTOVER_GRACE).unwrap_or_default();
    Ok(ExecOutput {
        code: status.and_then(|status| status.code()),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
    })
}

/// A child's status, or `None` if it is still running at `deadline`.
fn wait_until(child: &mut Child, deadline: Instant) -> Option<ExitStatus> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) if Instant::now() >= deadline => return None,
            Ok(None) => thread::sleep(Duration::from_millis(5)),
            Err(_) => return None,
        }
    }
}

/// A started process leads its own group, so its id is the group's.
fn group_of(child: &Child) -> i32 {
    i32::try_from(child.id()).expect("a process id fits an i32")
}

fn signal_group(group: i32, signal: i32) {
    // SAFETY: `kill` has no memory effects. `group` is a group this module made, so the negative
    // id reaches that group and no other, and never every process, which is what -1 would mean.
    unsafe { libc::kill(-group, signal) };
}

/// The runs of every window.
pub struct Runs {
    next_id: AtomicU32,
    running: Arc<Mutex<HashMap<u32, Arc<Run>>>>,
    grace: Duration,
}

/// A program that is running.
struct Run {
    /// The label of the window that started it.
    owner: String,
    group: i32,
    /// Someone has asked it to stop.
    stopping: AtomicBool,
    over: Over,
}

/// Whether a run is over, which can be waited for.
#[derive(Default)]
struct Over {
    over: Mutex<bool>,
    changed: Condvar,
}

impl Over {
    fn set(&self) {
        *self.over.lock().unwrap_or_else(PoisonError::into_inner) = true;
        self.changed.notify_all();
    }

    /// Whether it's over, waiting up to `timeout` for that.
    fn wait(&self, timeout: Duration) -> bool {
        let over = self.over.lock().unwrap_or_else(PoisonError::into_inner);
        let (over, _) = self
            .changed
            .wait_timeout_while(over, timeout, |over| !*over)
            .unwrap_or_else(PoisonError::into_inner);
        *over
    }
}

impl Run {
    /// SIGINT, which ends Claude's turn cleanly; then SIGTERM; then SIGKILL, to the whole group, on
    /// a thread of its own. Once is enough.
    fn stop(self: &Arc<Self>, grace: Duration) {
        if self.stopping.swap(true, Ordering::SeqCst) {
            return;
        }
        let run = Arc::clone(self);
        thread::spawn(move || {
            for signal in [libc::SIGINT, libc::SIGTERM] {
                signal_group(run.group, signal);
                if run.over.wait(grace) {
                    return;
                }
            }
            signal_group(run.group, libc::SIGKILL);
        });
    }
}

impl Default for Runs {
    fn default() -> Self {
        Runs::with_grace(STOP_GRACE)
    }
}

impl Runs {
    fn with_grace(grace: Duration) -> Self {
        Runs {
            next_id: AtomicU32::new(1),
            running: Arc::default(),
            grace,
        }
    }

    fn running(&self) -> MutexGuard<'_, HashMap<u32, Arc<Run>>> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Starts a program for the window `owner`. `send` hears each line and then the end.
    pub fn start(
        &self,
        owner: &str,
        log_folder: &Path,
        spec: &Spec,
        environment: &[(OsString, OsString)],
        send: impl Fn(RunMessage) + Send + Sync + 'static,
    ) -> Result<Started, String> {
        let log =
            RunLog::create(log_folder, &spec.log.agent, SystemTime::now()).map_err(|error| {
                format!("Couldn't start a log in {}: {error}", log_folder.display())
            })?;
        log.started(&spec.log, &spec.program, &spec.args, spec.cwd.as_deref());

        let mut command = command_for(&spec.program, &spec.args, environment);
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(cwd) = &spec.cwd {
            command.current_dir(cwd);
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                log.stderr(&error.to_string());
                log.ended(RunEnd::default());
                return Err(format!("Couldn't start {}: {error}", spec.program));
            }
        };

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let run = Arc::new(Run {
            owner: owner.to_owned(),
            group: group_of(&child),
            stopping: AtomicBool::new(false),
            over: Over::default(),
        });
        self.running().insert(id, Arc::clone(&run));

        let started = Started {
            id,
            log_path: log.path().to_string_lossy().into_owned(),
        };
        let following = Following {
            log: Arc::new(log),
            send: Arc::new(send),
            finished: Arc::new(AtomicBool::new(false)),
            stderr: Arc::default(),
        };
        let (reader_ended, readers) = mpsc::channel::<()>();
        following.read_stdout(
            child.stdout.take().expect("stdout is piped"),
            reader_ended.clone(),
        );
        following.read_stderr(child.stderr.take().expect("stderr is piped"), reader_ended);
        let running = Arc::clone(&self.running);
        thread::spawn(move || {
            let status = child.wait().ok();
            remove_what_is_left(run.group, &readers);
            following.finish(status, run.stopping.load(Ordering::SeqCst));
            running
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
            run.over.set();
        });
        Ok(started)
    }

    /// Stops a run of the window `owner`, and returns at once. A run that has ended is stopped.
    pub fn stop(&self, owner: &str, id: u32) -> Result<(), String> {
        let Some(run) = self.running().get(&id).cloned() else {
            return Ok(());
        };
        if run.owner != owner {
            return Err("That run belongs to another window.".to_owned());
        }
        run.stop(self.grace);
        Ok(())
    }

    /// Stops the runs of a window that has closed, and returns at once.
    pub fn stop_owned_by(&self, owner: &str) {
        for run in self.running().values().filter(|run| run.owner == owner) {
            run.stop(self.grace);
        }
    }

    /// Stops every run and waits for them to end, for when the app quits.
    pub fn stop_all(&self) {
        let runs: Vec<_> = self.running().values().cloned().collect();
        for run in &runs {
            run.stop(self.grace);
        }
        // By then SIGKILL has gone out, and nothing can survive that but what has left the group.
        let patience = self.grace * 2 + LEFTOVER_GRACE * 4;
        let deadline = Instant::now() + patience;
        for run in &runs {
            run.over
                .wait(deadline.saturating_duration_since(Instant::now()));
        }
    }
}

/// When a program has ended, sends what it left behind in its group on its way, and waits for its
/// pipes to close, which ends the threads reading them.
fn remove_what_is_left(group: i32, readers: &Receiver<()>) {
    for signal in [libc::SIGTERM, libc::SIGKILL] {
        signal_group(group, signal);
        // The readers send nothing, so all of them having gone is what ends the wait early.
        if matches!(
            readers.recv_timeout(LEFTOVER_GRACE),
            Err(RecvTimeoutError::Disconnected)
        ) {
            return;
        }
    }
}

/// What the threads following a program share.
struct Following {
    log: Arc<RunLog>,
    send: Arc<dyn Fn(RunMessage) + Send + Sync>,
    /// The end has gone out, and a later line, from something that got away, goes nowhere.
    finished: Arc<AtomicBool>,
    stderr: Arc<Mutex<VecDeque<u8>>>,
}

impl Following {
    fn read_stdout(&self, stdout: impl Read + Send + 'static, ended: mpsc::Sender<()>) {
        let (log, send, finished) = (
            Arc::clone(&self.log),
            Arc::clone(&self.send),
            Arc::clone(&self.finished),
        );
        thread::spawn(move || {
            let _ended = ended;
            for_each_line(stdout, |line| {
                if !finished.load(Ordering::SeqCst) {
                    log.stdout(&line);
                    send(RunMessage::Line { line });
                }
            });
        });
    }

    fn read_stderr(&self, stderr: impl Read + Send + 'static, ended: mpsc::Sender<()>) {
        let (log, kept, finished) = (
            Arc::clone(&self.log),
            Arc::clone(&self.stderr),
            Arc::clone(&self.finished),
        );
        thread::spawn(move || {
            let _ended = ended;
            for_each_line(stderr, |line| {
                if finished.load(Ordering::SeqCst) {
                    return;
                }
                log.stderr(&line);
                let mut kept = kept.lock().unwrap_or_else(PoisonError::into_inner);
                kept.extend(line.as_bytes());
                kept.push_back(b'\n');
                let over = kept.len().saturating_sub(STDERR_KEPT);
                kept.drain(..over);
            });
        });
    }

    /// Writes the end of the log and tells the window, last of all.
    fn finish(&self, status: Option<ExitStatus>, stopped: bool) {
        self.finished.store(true, Ordering::SeqCst);
        let code = status.and_then(|status| status.code());
        self.log.ended(RunEnd {
            code,
            signal: status.and_then(|status| status.signal()),
            stopped,
        });
        let stderr = {
            let mut kept = self.stderr.lock().unwrap_or_else(PoisonError::into_inner);
            let bytes: Vec<u8> = kept.drain(..).collect();
            String::from_utf8_lossy(&bytes).into_owned()
        };
        (self.send)(RunMessage::Ended { code, stderr });
    }
}

/// Calls `each` with every line of `reader`, however long, without its line ending. A last line
/// with no ending counts, and bytes that aren't UTF-8 don't end the stream.
fn for_each_line(reader: impl Read, mut each: impl FnMut(String)) {
    let mut reader = BufReader::new(reader);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes) {
            Ok(0) | Err(_) => return,
            Ok(_) => {
                if bytes.last() == Some(&b'\n') {
                    bytes.pop();
                    if bytes.last() == Some(&b'\r') {
                        bytes.pop();
                    }
                }
                each(String::from_utf8_lossy(&bytes).into_owned());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::mpsc::{self, Receiver};
    use std::time::Instant;

    use super::*;
    use crate::agents::test_support::TempFolder;

    const WAIT: Duration = Duration::from_secs(20);

    /// A program for tests: `/bin/sh` with a script, so nothing has to run a file just written.
    /// `$1` in the script is `arg`.
    fn script(body: &str, arg: &str) -> Spec {
        Spec {
            program: "/bin/sh".to_owned(),
            args: vec![
                "-c".to_owned(),
                body.to_owned(),
                "sh".to_owned(),
                arg.to_owned(),
            ],
            cwd: None,
            log: RunInfo {
                agent: "claude".to_owned(),
                thread: "c1".to_owned(),
                document: None,
                version: None,
            },
        }
    }

    fn plain_environment() -> Vec<(OsString, OsString)> {
        vec![(OsString::from("PATH"), OsString::from("/usr/bin:/bin"))]
    }

    fn start(runs: &Runs, folder: &Path, spec: &Spec) -> (Started, Receiver<RunMessage>) {
        start_as(runs, "main", folder, spec, &plain_environment())
    }

    fn start_as(
        runs: &Runs,
        owner: &str,
        folder: &Path,
        spec: &Spec,
        environment: &[(OsString, OsString)],
    ) -> (Started, Receiver<RunMessage>) {
        let (sender, receiver) = mpsc::channel();
        let sender = Mutex::new(sender);
        let started = runs
            .start(owner, folder, spec, environment, move |message| {
                let _ = sender.lock().unwrap().send(message);
            })
            .unwrap();
        (started, receiver)
    }

    /// Every message up to and including the end.
    fn to_the_end(receiver: &Receiver<RunMessage>) -> Vec<RunMessage> {
        let mut messages = Vec::new();
        loop {
            let message = receiver.recv_timeout(WAIT).expect("the run to end");
            let last = matches!(message, RunMessage::Ended { .. });
            messages.push(message);
            if last {
                return messages;
            }
        }
    }

    fn lines(messages: &[RunMessage]) -> Vec<String> {
        messages
            .iter()
            .filter_map(|message| match message {
                RunMessage::Line { line } => Some(line.clone()),
                RunMessage::Ended { .. } => None,
            })
            .collect()
    }

    fn next_line(receiver: &Receiver<RunMessage>) -> String {
        match receiver.recv_timeout(WAIT).expect("a line") {
            RunMessage::Line { line } => line,
            ended => panic!("expected a line, got {ended:?}"),
        }
    }

    fn is_alive(pid: i32) -> bool {
        // SAFETY: signal 0 only asks whether the process exists.
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    fn a_program_starts_with_stdin_closed() {
        let folder = TempFolder::new("run-stdin");
        let runs = Runs::default();
        let spec = script(
            "if read line; then echo \"read: $line\"; else echo nothing; fi",
            "",
        );
        let (_, receiver) = start(&runs, folder.path(), &spec);
        assert_eq!(lines(&to_the_end(&receiver)), ["nothing"]);
    }

    #[test]
    fn it_runs_in_the_folder_it_was_given() {
        let folder = TempFolder::new("run-cwd");
        let runs = Runs::default();
        let spec = Spec {
            cwd: Some(folder.path().to_str().unwrap().to_owned()),
            ..script("pwd -P", "")
        };
        let (_, receiver) = start(&runs, folder.path(), &spec);
        let real = fs::canonicalize(folder.path()).unwrap();
        assert_eq!(
            lines(&to_the_end(&receiver)),
            [real.to_str().unwrap().to_owned()]
        );
    }

    #[test]
    fn it_runs_in_its_own_process_group() {
        let folder = TempFolder::new("run-group");
        let runs = Runs::default();
        let spec = script("ps -o pgid= -p $$; echo $$", "");
        let (_, receiver) = start(&runs, folder.path(), &spec);
        let lines = lines(&to_the_end(&receiver));
        assert_eq!(lines[0].trim(), lines[1].trim());
    }

    #[test]
    fn lines_arrive_as_written_and_a_very_long_line_is_not_cut() {
        let folder = TempFolder::new("run-lines");
        let runs = Runs::default();
        // 2 MiB in one line, an empty line, bytes that aren't UTF-8, and a last line with no end.
        let spec = script(
            "echo first; head -c 2097152 /dev/zero | tr '\\0' x; echo; echo; \
             printf '\\377 not utf-8\\n'; printf '  spaces kept  \\n'; printf 'the last'",
            "",
        );
        let (_, receiver) = start(&runs, folder.path(), &spec);
        let lines = lines(&to_the_end(&receiver));
        assert_eq!(lines.len(), 6, "{}", lines.len());
        assert_eq!(lines[0], "first");
        assert_eq!(lines[1].len(), 2_097_152);
        assert!(lines[1].bytes().all(|byte| byte == b'x'));
        assert_eq!(lines[2], "");
        assert!(lines[3].ends_with(" not utf-8"));
        assert_eq!(lines[4], "  spaces kept  ");
        assert_eq!(lines[5], "the last");
    }

    #[test]
    fn the_end_gives_the_code_and_the_end_of_stderr() {
        let folder = TempFolder::new("run-end");
        let runs = Runs::default();
        // Far more stderr than a pipe holds, and it can't block the program.
        let spec = script(
            "i=0; while [ $i -lt 4000 ]; do echo \"noise $i and some more words to fill it\" >&2; \
             i=$((i+1)); done; echo 'the last words' >&2; exit 3",
            "",
        );
        let (_, receiver) = start(&runs, folder.path(), &spec);
        let messages = to_the_end(&receiver);
        let Some(RunMessage::Ended { code, stderr }) = messages.last() else {
            panic!("no end");
        };
        assert_eq!(*code, Some(3));
        assert!(stderr.ends_with("the last words\n"), "{stderr}");
        assert!(stderr.len() <= 8192, "{}", stderr.len());
    }

    #[test]
    fn a_program_that_cant_start_is_an_error_with_a_log() {
        let folder = TempFolder::new("run-missing");
        let runs = Runs::default();
        let spec = Spec {
            program: folder.path().join("missing").to_str().unwrap().to_owned(),
            ..script("", "")
        };
        let result = runs.start("main", folder.path(), &spec, &plain_environment(), |_| {});
        assert!(result.is_err());
        let logs = fs::read_dir(folder.path()).unwrap().count();
        assert_eq!(logs, 1);
    }

    #[test]
    fn stop_sends_sigint_then_kills_the_group() {
        let folder = TempFolder::new("run-stop");
        let runs = Runs::with_grace(Duration::from_millis(300));
        let marks = folder.path().join("marks");
        // It traps INT and TERM and carries on, and so does the child it started: only KILL works.
        let spec = script(
            "trap 'echo INT >> \"$1\"' INT; trap 'echo TERM >> \"$1\"' TERM; \
             (trap '' INT TERM; sleep 300) & echo $$; echo $!; \
             while :; do sleep 0.05; done",
            marks.to_str().unwrap(),
        );
        let (started, receiver) = start(&runs, folder.path(), &spec);
        let group: i32 = next_line(&receiver).parse().unwrap();
        let child: i32 = next_line(&receiver).parse().unwrap();
        assert!(is_alive(child));

        runs.stop("main", started.id).unwrap();
        let messages = to_the_end(&receiver);

        let Some(RunMessage::Ended { code, .. }) = messages.last() else {
            panic!("no end");
        };
        assert_eq!(*code, None, "killed by a signal");
        assert_eq!(fs::read_to_string(&marks).unwrap(), "INT\nTERM\n");
        assert!(!is_alive(child), "the child is gone too");
        // SAFETY: signal 0 only asks whether the group has anyone in it.
        assert_ne!(unsafe { libc::kill(-group, 0) }, 0, "the group is gone");
    }

    #[test]
    fn sigint_is_enough_for_a_program_that_listens() {
        let folder = TempFolder::new("run-int");
        let runs = Runs::default();
        let marks = folder.path().join("marks");
        let spec = script(
            "trap 'echo INT >> \"$1\"; exit 7' INT; trap 'echo TERM >> \"$1\"' TERM; echo up; \
             while :; do sleep 0.05; done",
            marks.to_str().unwrap(),
        );
        let (started, receiver) = start(&runs, folder.path(), &spec);
        assert_eq!(next_line(&receiver), "up");
        let began = Instant::now();
        runs.stop("main", started.id).unwrap();
        let messages = to_the_end(&receiver);
        let Some(RunMessage::Ended { code, .. }) = messages.last() else {
            panic!("no end");
        };
        assert_eq!(*code, Some(7));
        assert!(began.elapsed() < STOP_GRACE, "no wait for the next signal");
        assert_eq!(fs::read_to_string(&marks).unwrap(), "INT\n");
    }

    #[test]
    fn the_grace_between_signals_is_three_seconds() {
        assert_eq!(STOP_GRACE, Duration::from_secs(3));
    }

    #[test]
    fn stopping_a_run_that_ended_is_nothing() {
        let folder = TempFolder::new("run-stopped");
        let runs = Runs::default();
        let (started, receiver) = start(&runs, folder.path(), &script("exit 0", ""));
        to_the_end(&receiver);
        assert!(runs.stop("main", started.id).is_ok());
        assert!(runs.stop("main", 999_999).is_ok());
    }

    #[test]
    fn what_a_program_leaves_behind_goes_when_it_ends() {
        let folder = TempFolder::new("run-leftover");
        let runs = Runs::default();
        // The child holds the stdout pipe open, so without this the run would never seem to end.
        let spec = script("(trap '' TERM; sleep 300) & echo $!; exit 0", "");
        let (_, receiver) = start(&runs, folder.path(), &spec);
        let child: i32 = next_line(&receiver).parse().unwrap();
        to_the_end(&receiver);
        assert!(!is_alive(child));
    }

    #[test]
    fn a_program_that_got_away_cant_hold_the_end_back() {
        let folder = TempFolder::new("run-escaped");
        let runs = Runs::default();
        // In a group of its own (job control) the signals don't reach it, and it keeps the pipes open.
        let spec = script("set -m; sleep 5 & echo $!; set +m; exit 0", "");
        let (_, receiver) = start(&runs, folder.path(), &spec);
        let child: i32 = next_line(&receiver).parse().unwrap();
        let began = Instant::now();
        let messages = to_the_end(&receiver);
        assert!(began.elapsed() < Duration::from_secs(4));
        assert!(matches!(messages.last(), Some(RunMessage::Ended { .. })));
        // SAFETY: killing the test's own leftover child.
        unsafe { libc::kill(child, libc::SIGKILL) };
    }

    #[test]
    fn stop_all_stops_every_run_and_waits() {
        let folder = TempFolder::new("run-all");
        let runs = Runs::with_grace(Duration::from_millis(200));
        let stubborn = script("trap '' INT; echo up; while :; do sleep 0.05; done", "");
        let plain = script("echo up; sleep 300", "");
        let (_, first) = start_as(
            &runs,
            "main",
            folder.path(),
            &stubborn,
            &plain_environment(),
        );
        let (_, second) = start_as(&runs, "doc-2", folder.path(), &plain, &plain_environment());
        assert_eq!(next_line(&first), "up");
        assert_eq!(next_line(&second), "up");

        runs.stop_all();

        assert!(runs.running.lock().unwrap().is_empty());
        assert!(matches!(
            to_the_end(&first).last(),
            Some(RunMessage::Ended { .. })
        ));
        assert!(matches!(
            to_the_end(&second).last(),
            Some(RunMessage::Ended { .. })
        ));
    }

    #[test]
    fn closing_a_window_stops_its_runs_and_no_others() {
        let folder = TempFolder::new("run-window");
        let runs = Runs::default();
        let long = script("echo up; sleep 300", "");
        let (_, mine) = start_as(&runs, "doc-2", folder.path(), &long, &plain_environment());
        let (other, others) = start_as(&runs, "main", folder.path(), &long, &plain_environment());
        assert_eq!(next_line(&mine), "up");
        assert_eq!(next_line(&others), "up");

        runs.stop_owned_by("doc-2");

        to_the_end(&mine);
        assert!(others.try_recv().is_err(), "the other window's run goes on");
        runs.stop("main", other.id).unwrap();
        to_the_end(&others);
    }

    #[test]
    fn one_run_cant_read_anothers_id() {
        let folder = TempFolder::new("run-ids");
        let runs = Runs::default();
        // Each program prints its environment, so what it could know of a run is in its lines.
        let spec = script("env; echo up; sleep 300", "");
        let (first, first_lines) =
            start_as(&runs, "main", folder.path(), &spec, &plain_environment());
        let (second, second_lines) =
            start_as(&runs, "doc-2", folder.path(), &spec, &plain_environment());
        assert_ne!(first.id, second.id);
        assert_ne!(first.log_path, second.log_path);

        // Nothing tells a program its own id, let alone another's.
        for lines in [&first_lines, &second_lines] {
            loop {
                let line = next_line(lines);
                if line == "up" {
                    break;
                }
                assert!(!line.contains("REDLINES"), "{line}");
            }
        }

        // One window can't stop another's run, by a guess at its id or at all.
        assert!(runs.stop("doc-2", first.id).is_err());
        assert!(runs.stop("main", second.id).is_err());
        assert!(first_lines.try_recv().is_err(), "it goes on");
        assert!(second_lines.try_recv().is_err(), "it goes on");

        // A run's messages reach only its own window, and each has its own log.
        runs.stop("main", first.id).unwrap();
        to_the_end(&first_lines);
        assert!(second_lines.try_recv().is_err());
        runs.stop("doc-2", second.id).unwrap();
        to_the_end(&second_lines);
        for log in [&first.log_path, &second.log_path] {
            let log = fs::read_to_string(log).unwrap();
            assert_eq!(log.matches("\"redlines\":\"end\"").count(), 1);
        }
    }

    #[test]
    fn log_has_the_start_lines_then_every_line_and_the_end() {
        let folder = TempFolder::new("run-log");
        let runs = Runs::default();
        let spec = Spec {
            cwd: Some(folder.path().to_str().unwrap().to_owned()),
            log: RunInfo {
                agent: "codex".to_owned(),
                thread: "c9".to_owned(),
                document: Some("/docs/plan.md".to_owned()),
                version: Some("0.166.0".to_owned()),
            },
            ..script(
                "echo '{\"type\":\"thread.started\"}'; echo 'plain words'; \
                 echo 'a warning' >&2; echo '{\"type\":\"turn.completed\"}'; exit 2",
                "",
            )
        };
        let (started, receiver) = start(&runs, folder.path(), &spec);
        to_the_end(&receiver);

        let log = fs::read_to_string(&started.log_path).unwrap();
        let lines: Vec<&str> = log.lines().collect();
        let parsed: Vec<serde_json::Value> = lines
            .iter()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let first = &parsed[0];
        assert_eq!(first["redlines"], "start");
        assert_eq!(first["agent"], "codex");
        assert_eq!(first["version"], "0.166.0");
        assert_eq!(first["thread"], "c9");
        assert_eq!(first["document"], "/docs/plan.md");
        assert_eq!(first["program"], "/bin/sh");
        assert_eq!(first["args"][0], "-c");
        assert_eq!(first["folder"], folder.path().to_str().unwrap());

        assert!(lines.contains(&"{\"type\":\"thread.started\"}"));
        assert!(lines.contains(&"{\"type\":\"turn.completed\"}"));
        let position = |wanted: &str| lines.iter().position(|line| *line == wanted).unwrap();
        assert!(
            position("{\"type\":\"thread.started\"}") < position("{\"type\":\"turn.completed\"}")
        );
        assert!(log.contains("plain words"));
        assert!(log.contains("a warning"));

        let last = parsed.last().unwrap();
        assert_eq!(last["redlines"], "end");
        assert_eq!(last["code"], 2);
        assert_eq!(last["stopped"], false);
    }

    #[test]
    fn the_logs_end_says_a_run_was_stopped() {
        let folder = TempFolder::new("run-log-stop");
        let runs = Runs::default();
        let (started, receiver) = start(&runs, folder.path(), &script("echo up; sleep 300", ""));
        assert_eq!(next_line(&receiver), "up");
        runs.stop("main", started.id).unwrap();
        to_the_end(&receiver);
        let log = fs::read_to_string(&started.log_path).unwrap();
        let last: serde_json::Value = serde_json::from_str(log.lines().last().unwrap()).unwrap();
        assert_eq!(last["redlines"], "end");
        assert_eq!(last["stopped"], true);
        assert_eq!(last["code"], serde_json::Value::Null);
        assert_eq!(last["signal"], libc::SIGINT);
    }

    #[test]
    fn log_records_flags_but_never_the_environment() {
        let folder = TempFolder::new("run-secret");
        let runs = Runs::default();
        let mut spec = script("exit 0", "");
        spec.args.push("--strict-mcp-config".to_owned());
        let mut environment = plain_environment();
        environment.push((
            OsString::from("ANTHROPIC_API_KEY"),
            OsString::from("sk-the-secret-value"),
        ));
        environment.push((OsString::from("MY_TOKEN"), OsString::from("another-secret")));
        let (started, receiver) = start_as(&runs, "main", folder.path(), &spec, &environment);
        to_the_end(&receiver);
        let log = fs::read_to_string(&started.log_path).unwrap();
        assert!(log.contains("--strict-mcp-config"));
        assert!(!log.contains("the-secret-value"));
        assert!(!log.contains("another-secret"));
        assert!(!log.contains("ANTHROPIC_API_KEY"));
        assert!(!log.contains("MY_TOKEN"));
    }

    fn variables(names: &[&str]) -> Vec<(OsString, OsString)> {
        names
            .iter()
            .map(|name| (OsString::from(name), OsString::from("1")))
            .collect()
    }

    fn printed_names(lines: &[String]) -> Vec<String> {
        lines
            .iter()
            .filter_map(|line| line.split_once('=').map(|(name, _)| name.to_owned()))
            .collect()
    }

    #[test]
    fn started_inside_claude_code_it_drops_claude_code_s_environment() {
        let folder = TempFolder::new("run-env");
        let runs = Runs::default();
        let inside = variables(&[
            "CLAUDECODE",
            "CLAUDE_CODE_SIMPLE",
            "CLAUDE_CODE_ENTRYPOINT",
            "CLAUDE_CODE_OAUTH_SCOPES",
            "CLAUDE_AGENT_SDK_VERSION",
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_API_KEY",
            "CLAUDE_CONFIG_DIR",
            "HOME",
            "PATH",
        ]);
        let spec = Spec {
            program: "/usr/bin/env".to_owned(),
            args: vec![],
            ..script("", "")
        };

        let (_, receiver) = start_as(
            &runs,
            "main",
            folder.path(),
            &spec,
            &clean_environment(inside.clone()),
        );
        let printed = lines(&to_the_end(&receiver));
        let names = printed_names(&printed);
        for gone in [
            "CLAUDECODE",
            "CLAUDE_CODE_SIMPLE",
            "CLAUDE_CODE_ENTRYPOINT",
            "CLAUDE_CODE_OAUTH_SCOPES",
            "CLAUDE_AGENT_SDK_VERSION",
            "ANTHROPIC_BASE_URL",
        ] {
            assert!(!names.iter().any(|name| name == gone), "{gone} reached it");
        }
        for kept in ["ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "HOME", "PATH"] {
            assert!(names.iter().any(|name| name == kept), "{kept} didn't");
        }

        // Without `CLAUDECODE`, nothing is removed: these belong to the person.
        let outside: Vec<_> = inside
            .into_iter()
            .filter(|(name, _)| name != "CLAUDECODE")
            .collect();
        assert_eq!(clean_environment(outside.clone()), outside);
    }

    #[test]
    fn exec_gives_the_code_and_stdout_with_stdin_closed() {
        let output = exec(
            "/bin/sh",
            &[
                "-c".to_owned(),
                "if read line; then echo read; else echo nothing; fi; echo err >&2; exit 4"
                    .to_owned(),
            ],
            &plain_environment(),
            WAIT,
        )
        .unwrap();
        assert_eq!(
            output,
            ExecOutput {
                code: Some(4),
                stdout: "nothing\n".to_owned()
            }
        );
    }

    #[test]
    fn exec_passes_only_the_environment_it_was_given() {
        let output = exec("/usr/bin/env", &[], &variables(&["ONLY_THIS"]), WAIT).unwrap();
        assert_eq!(output.stdout, "ONLY_THIS=1\n");
    }

    #[test]
    fn exec_kills_what_runs_too_long() {
        let began = Instant::now();
        let output = exec(
            "/bin/sh",
            &["-c".to_owned(), "echo up; sleep 300 & wait".to_owned()],
            &plain_environment(),
            Duration::from_millis(200),
        )
        .unwrap();
        assert!(began.elapsed() < Duration::from_secs(10));
        assert_eq!(output.code, None);
        assert_eq!(output.stdout, "up\n");
    }

    #[test]
    fn exec_of_a_program_that_isnt_there_is_an_error() {
        let result = exec("/no/such/program", &[], &plain_environment(), WAIT);
        assert!(result.is_err());
    }

    #[test]
    fn what_the_window_reads_keeps_its_names() {
        // src/agent-host.ts reads these by name.
        assert_eq!(
            serde_json::to_value(RunMessage::Line {
                line: "x".to_owned()
            })
            .unwrap(),
            serde_json::json!({ "kind": "line", "line": "x" })
        );
        assert_eq!(
            serde_json::to_value(RunMessage::Ended {
                code: None,
                stderr: "e".to_owned()
            })
            .unwrap(),
            serde_json::json!({ "kind": "ended", "code": null, "stderr": "e" })
        );
        assert_eq!(
            serde_json::to_value(Started {
                id: 3,
                log_path: "/l".to_owned()
            })
            .unwrap(),
            serde_json::json!({ "id": 3, "log_path": "/l" })
        );
        assert_eq!(
            serde_json::to_value(ExecOutput {
                code: Some(0),
                stdout: "s".to_owned()
            })
            .unwrap(),
            serde_json::json!({ "code": 0, "stdout": "s" })
        );
    }

    #[test]
    fn the_window_sends_a_spec_by_name_and_extra_fields_dont_matter() {
        let spec: Spec = serde_json::from_value(serde_json::json!({
            "program": "/bin/claude",
            "args": ["-p"],
            "cwd": "/docs",
            "somethingNew": { "for": "the other side" },
            "log": { "agent": "claude", "thread": "c1", "document": "/docs/a.md", "version": "2" },
        }))
        .unwrap();
        assert_eq!(spec.program, "/bin/claude");
        assert_eq!(spec.args, ["-p"]);
        assert_eq!(spec.cwd.as_deref(), Some("/docs"));
        assert_eq!(spec.log.agent, "claude");
        assert_eq!(spec.log.thread, "c1");
        assert_eq!(spec.log.document.as_deref(), Some("/docs/a.md"));
        assert_eq!(spec.log.version.as_deref(), Some("2"));

        let spec: Spec = serde_json::from_value(serde_json::json!({
            "program": "/bin/claude",
            "args": [],
            "log": { "agent": "claude", "thread": "c1" },
        }))
        .unwrap();
        assert_eq!(spec.cwd, None);
        assert_eq!(spec.log.document, None);
    }
}
