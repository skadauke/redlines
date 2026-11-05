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
    start_found(
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

/// Starts what the window asked for, if it may be started and the window is still there. A window
/// closing looks for its runs only after Tauri has forgotten it, so a run that starts too late for
/// that to see it finds the window gone.
fn start_found(
    programs: &Programs,
    runs: &Runs,
    owner: &str,
    log_folder: &Path,
    spec: &Spec,
    window_open: impl Fn() -> bool,
    send: impl Fn(RunMessage) + Send + Sync + 'static,
) -> Result<Started, String> {
    programs.may_start(&spec.program, &spec.args)?;
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

    use super::log::RunInfo;
    use super::test_support::TempFolder;
    use super::*;

    /// Programs with `claude` in a known place, as a link to the system's `echo`.
    fn programs_with_claude(temp: &Path) -> (Programs, String) {
        let known = temp.join("known");
        std::fs::create_dir_all(&known).unwrap();
        let claude = known.join("claude");
        symlink("/bin/echo", &claude).unwrap();
        let environment = vec![(OsString::from("HOME"), temp.as_os_str().to_owned())];
        let programs = Programs::new(
            vec![known],
            PathBuf::from("/bin/sh"),
            environment,
            PathBuf::from("/Applications/Redlines.app/Contents/MacOS/redlines"),
        );
        (programs, claude.to_str().unwrap().to_owned())
    }

    fn spec_of(program: &str) -> Spec {
        Spec {
            program: program.to_owned(),
            args: ["-p", "--verbose", "--", "hello"]
                .map(str::to_owned)
                .to_vec(),
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
    fn the_window_can_start_only_what_which_returned() {
        let temp = TempFolder::new("agents-start");
        let (programs, claude) = programs_with_claude(temp.path());
        let runs = Runs::default();
        let logs = temp.path().join("logs");
        let start =
            |spec: &Spec| start_found(&programs, &runs, "main", &logs, spec, || true, |_| {});
        assert!(start(&spec_of("/bin/echo")).is_err());
        assert!(
            start(&spec_of(&claude)).is_err(),
            "not before which has returned it"
        );
        assert!(!logs.exists(), "nothing was started, so nothing was logged");

        assert_eq!(programs.which("claude").as_ref(), Some(&claude));

        let (sender, receiver) = mpsc::channel();
        let sender = Mutex::new(sender);
        start_found(
            &programs,
            &runs,
            "main",
            &logs,
            &spec_of(&claude),
            || true,
            move |message| {
                let _ = sender.lock().unwrap().send(message);
            },
        )
        .unwrap();
        let first = receiver.recv_timeout(Duration::from_secs(20)).unwrap();
        assert_eq!(
            first,
            RunMessage::Line {
                line: "-p --verbose -- hello".to_owned()
            }
        );
    }

    #[test]
    fn the_window_can_start_it_only_as_a_provider_starts_it() {
        let temp = TempFolder::new("agents-line");
        let (programs, claude) = programs_with_claude(temp.path());
        programs.which("claude").unwrap();
        let runs = Runs::default();
        let logs = temp.path().join("logs");
        let spec = Spec {
            args: vec!["--dangerously-skip-permissions".to_owned()],
            ..spec_of(&claude)
        };
        let started = start_found(&programs, &runs, "main", &logs, &spec, || true, |_| {});
        assert!(started.is_err());
        assert!(!logs.exists(), "nothing was started, so nothing was logged");
    }

    #[test]
    fn a_run_started_as_its_window_closes_is_stopped() {
        let temp = TempFolder::new("agents-closing");
        let known = temp.path().join("known");
        std::fs::create_dir_all(&known).unwrap();
        // `claude -p -- <file>`, as a shell, reads a script, and this one would go on for a minute.
        let claude = known.join("claude");
        symlink("/bin/sh", &claude).unwrap();
        let script = temp.path().join("script");
        std::fs::write(&script, "echo up\nexec sleep 60\n").unwrap();
        let environment = vec![(OsString::from("PATH"), OsString::from("/usr/bin:/bin"))];
        let programs = Programs::new(
            vec![known],
            PathBuf::from("/bin/sh"),
            environment,
            PathBuf::from("/Applications/Redlines.app/Contents/MacOS/redlines"),
        );
        programs.which("claude").unwrap();
        let runs = Runs::default();
        let (sender, receiver) = mpsc::channel();
        let sender = Mutex::new(sender);
        let spec = Spec {
            args: vec![
                "-p".to_owned(),
                "--".to_owned(),
                script.to_str().unwrap().to_owned(),
            ],
            ..spec_of(claude.to_str().unwrap())
        };
        let started = start_found(
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
        let (programs, claude) = programs_with_claude(temp.path());
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
        let (programs, claude) = programs_with_claude(temp.path());
        programs.which("claude").unwrap();
        let args = ["-p".to_owned(), "hello".to_owned()];
        assert!(programs.exec(&claude, &args).is_err());
    }
}
