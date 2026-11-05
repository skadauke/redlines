//! Agents' own programs: finding them (`which.rs`), starting and stopping them (`process.rs`) and
//! logging every run (`log.rs`); and the private line from a run back to the document (`relay.rs`).
//!
//! The window may start only an agent that `agent_which` found this session, and only as a provider
//! starts it (`allowed.rs`). Redlines never reads, stores or passes a credential: it runs the
//! agents' own programs, and their own status commands say whether they are signed in. Runs belong
//! to the window that started them, and there may be any number of windows.

mod allowed;
mod log;
mod process;
pub mod relay;
mod which;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Webview};

pub use process::Runs;
pub use which::Programs;

use process::{ExecOutput, RunMessage, Spec, Started};
use relay::Relays;

/// Puts what the commands below use in the app's state, and clears out old logs.
pub fn set_up(app: &AppHandle) {
    app.manage(Programs::for_this_machine());
    app.manage(Runs::default());
    app.manage(Relays::default());
    if let Ok(folder) = log_folder(app) {
        std::thread::spawn(move || log::delete_old_logs(&folder, SystemTime::now()));
    }
}

/// A window has closed: its runs stop, and their relays close.
pub fn window_closed(app: &AppHandle, window: &str) {
    app.state::<Runs>().stop_owned_by(window);
    app.state::<Relays>().close_owned_by(window);
}

/// The app is quitting: every status command is killed, and every run stops, which this waits for.
/// Then every relay closes, which leaves no socket behind.
pub fn quitting(app: &AppHandle) {
    app.state::<Programs>().stop_execs();
    app.state::<Runs>().stop_all();
    app.state::<Relays>().close_all();
}

/// Whether this machine has an agent's program: its path, or null. Only what this returns can run.
#[tauri::command(async)]
pub fn agent_which(app: AppHandle, program: String) -> Option<String> {
    app.state::<Programs>().which(&program)
}

/// Runs an agent's program to its end, for its version or sign-in status.
#[tauri::command(async)]
pub fn agent_exec(
    app: AppHandle,
    program: String,
    args: Vec<String>,
) -> Result<ExecOutput, String> {
    app.state::<Programs>().exec(&program, &args)
}

/// Starts an agent's program. Its lines and its end reach `on_line`, which is the calling window's.
#[tauri::command(async)]
pub fn agent_start(
    app: AppHandle,
    webview: Webview,
    spec: Spec,
    on_line: Channel<RunMessage>,
) -> Result<Started, String> {
    let owner = webview.label();
    app.state::<Programs>().may_start(
        &spec.program,
        &spec.args,
        &app.state::<Relays>().sockets_of(owner),
    )?;
    start_for_window(
        &app.state::<Programs>(),
        &app.state::<Runs>(),
        owner,
        &log_folder(&app)?,
        &spec,
        || app.get_webview_window(owner).is_some(),
        move |message| {
            // The window may be gone. The program is still drained, and its log still written.
            let _ = on_line.send(message);
        },
    )
}

/// Stops a run that the calling window started: SIGINT, then SIGTERM, then SIGKILL.
#[tauri::command]
pub fn agent_stop(app: AppHandle, webview: Webview, id: u32) -> Result<(), String> {
    app.state::<Runs>().stop(webview.label(), id)
}

/// Opens the folder of agent logs in Finder.
#[tauri::command(async)]
pub fn agent_logs_open(app: AppHandle) -> Result<(), String> {
    let folder = log_folder(&app)?;
    log::make_private_folder(&folder).map_err(|error| error.to_string())?;
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let status = Command::new(opener)
        .arg(&folder)
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Couldn't open {}", folder.display()))
    }
}

fn log_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let logs = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    Ok(logs.join("agents"))
}

/// Starts what the window asked for, if the window is still there. A window closing looks for its
/// runs only after Tauri has forgotten it, so a run that starts too late for that to see it finds
/// the window gone.
fn start_for_window(
    programs: &Programs,
    runs: &Runs,
    owner: &str,
    log_folder: &Path,
    spec: &Spec,
    window_open: impl Fn() -> bool,
    send: impl Fn(RunMessage) + Send + Sync + 'static,
) -> Result<Started, String> {
    let environment = programs.environment_for(Path::new(&spec.program));
    let started = runs.start(owner, log_folder, spec, &environment, send)?;
    if !window_open() {
        runs.stop_owned_by(owner);
        return Err("The window has closed.".to_owned());
    }
    Ok(started)
}

#[cfg(test)]
pub mod test_support {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A folder of a test's own, gone when the test is.
    pub struct TempFolder(PathBuf);

    impl TempFolder {
        pub fn new(name: &str) -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let unique = NEXT.fetch_add(1, Ordering::Relaxed);
            let folder = std::env::temp_dir()
                .join(format!("redlines-{name}-{}-{unique}", std::process::id()));
            std::fs::create_dir_all(&folder).unwrap();
            TempFolder(folder)
        }

        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempFolder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::os::unix::fs::symlink;
    use std::sync::Mutex;
    use std::sync::mpsc;
    use std::time::Duration;

    use super::allowed::tests::provider_lines;
    use super::log::RunInfo;
    use super::test_support::TempFolder;
    use super::*;

    /// Programs with `claude` in a known place, as a link to `target`.
    fn programs_with_claude(temp: &Path, target: &str) -> (Programs, String) {
        let known = temp.join("known");
        std::fs::create_dir_all(&known).unwrap();
        let claude = known.join("claude");
        symlink(target, &claude).unwrap();
        let environment = vec![(OsString::from("PATH"), OsString::from("/usr/bin:/bin"))];
        let programs = Programs::new(
            vec![known],
            PathBuf::from("/bin/sh"),
            environment,
            PathBuf::from(provider_lines().bundled),
        );
        (programs, claude.to_str().unwrap().to_owned())
    }

    fn spec_of(program: &str, args: Vec<String>) -> Spec {
        Spec {
            program: program.to_owned(),
            args,
            cwd: None,
            log: RunInfo {
                agent: "claude".to_owned(),
                thread: "c1".to_owned(),
                document: None,
                version: None,
            },
        }
    }

    #[test]
    fn a_line_that_is_allowed_really_runs_as_it_was_given() {
        let temp = TempFolder::new("agents-start");
        let (programs, claude) = programs_with_claude(temp.path(), "/bin/echo");
        let runs = Runs::default();
        let lines = provider_lines();
        let line = lines.lines["claude at a folder"].clone();
        let sockets = [lines.socket.clone()];

        assert!(
            programs.may_start(&claude, &line, &sockets).is_err(),
            "not before which"
        );
        programs.which("claude").unwrap();
        programs.may_start(&claude, &line, &sockets).unwrap();

        let (sender, receiver) = mpsc::channel();
        let sender = Mutex::new(sender);
        start_for_window(
            &programs,
            &runs,
            "main",
            &temp.path().join("logs"),
            &spec_of(&claude, line.clone()),
            || true,
            move |message| {
                let _ = sender.lock().unwrap().send(message);
            },
        )
        .unwrap();
        let printed = receiver.recv_timeout(Duration::from_secs(20)).unwrap();
        // `echo` prints the system prompt's own line breaks.
        let RunMessage::Line { line: first } = printed else {
            panic!("{printed:?}");
        };
        assert!(
            first.starts_with("-p --output-format stream-json --verbose --restricted"),
            "{first}"
        );
    }

    #[test]
    fn a_run_started_as_its_window_closes_is_stopped() {
        let temp = TempFolder::new("agents-closing");
        let (programs, claude) = programs_with_claude(temp.path(), "/bin/sh");
        let runs = Runs::default();
        let (sender, receiver) = mpsc::channel();
        let sender = Mutex::new(sender);
        // The window's gate has passed by now: this is about what happens next.
        let spec = spec_of(
            &claude,
            ["-c", "echo up; exec sleep 60"].map(str::to_owned).to_vec(),
        );
        let started = start_for_window(
            &programs,
            &runs,
            "doc-2",
            &temp.path().join("logs"),
            &spec,
            || false,
            move |message| {
                let _ = sender.lock().unwrap().send(message);
            },
        );
        assert!(started.is_err());
        // Well before the minute is up.
        loop {
            match receiver.recv_timeout(Duration::from_secs(20)).unwrap() {
                RunMessage::Line { line } => assert_eq!(line, "up"),
                RunMessage::Ended { code, .. } => {
                    assert_eq!(code, None, "ended by a signal");
                    break;
                }
            }
        }
    }

    #[test]
    fn the_window_can_exec_only_what_which_returned() {
        let temp = TempFolder::new("agents-exec");
        let (programs, claude) = programs_with_claude(temp.path(), "/bin/echo");
        // `auth status`, not `--version`, because GNU's `echo` takes that for its own.
        let args = ["auth".to_owned(), "status".to_owned()];
        assert!(programs.exec("/bin/echo", &args).is_err());
        assert!(programs.exec(&claude, &args).is_err());
        programs.which("claude").unwrap();
        let output = programs.exec(&claude, &args).unwrap();
        assert_eq!(output.code, Some(0));
        assert_eq!(output.stdout, "auth status\n");
    }

    #[test]
    fn the_window_can_exec_only_the_status_lines() {
        let temp = TempFolder::new("agents-exec-line");
        let (programs, claude) = programs_with_claude(temp.path(), "/bin/echo");
        programs.which("claude").unwrap();
        let args = ["-p".to_owned(), "hello".to_owned()];
        assert!(programs.exec(&claude, &args).is_err());
    }
}
