//! Agents' own programs: finding them (`which.rs`), starting and stopping them (`process.rs`) and
//! logging every run (`log.rs`); and the private line from a run back to the document (`relay.rs`).
//!
//! The window may start only an agent that `agent_which` found this session. Redlines never reads,
//! stores or passes a credential: it runs the agents' own programs, and their own status commands
//! say whether they are signed in. Runs belong to the window that started them, and there may be
//! any number of windows.

mod log;
mod process;
pub mod relay;
mod which;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Webview};

pub use process::Runs;
pub use which::Programs;

use process::{ExecOutput, RunMessage, Spec, Started};
use relay::Relays;

/// How long a status command may take before it's killed.
const EXEC_TIMEOUT: Duration = Duration::from_secs(30);

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

/// The app is quitting: every run stops, and this waits for them. Then every relay closes, which
/// leaves no socket behind.
pub fn quitting(app: &AppHandle) {
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
    exec_found(&app.state::<Programs>(), &program, &args)
}

/// Starts an agent's program. Its lines and its end reach `on_line`, which is the calling window's.
#[tauri::command(async)]
pub fn agent_start(
    app: AppHandle,
    webview: Webview,
    spec: Spec,
    on_line: Channel<RunMessage>,
) -> Result<Started, String> {
    start_found(
        &app.state::<Programs>(),
        &app.state::<Runs>(),
        webview.label(),
        &log_folder(&app)?,
        &spec,
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
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
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

fn exec_found(programs: &Programs, program: &str, args: &[String]) -> Result<ExecOutput, String> {
    programs.may_exec(program)?;
    let environment = programs.environment_for(Path::new(program));
    process::exec(program, args, &environment, EXEC_TIMEOUT)
}

fn start_found(
    programs: &Programs,
    runs: &Runs,
    owner: &str,
    log_folder: &Path,
    spec: &Spec,
    send: impl Fn(RunMessage) + Send + Sync + 'static,
) -> Result<Started, String> {
    programs.may_start(&spec.program)?;
    let environment = programs.environment_for(Path::new(&spec.program));
    runs.start(owner, log_folder, spec, &environment, send)
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
    use std::sync::mpsc;

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
        let programs = Programs::new(vec![known], PathBuf::from("/bin/sh"), environment);
        (programs, claude.to_str().unwrap().to_owned())
    }

    fn spec_of(program: &str) -> Spec {
        Spec {
            program: program.to_owned(),
            args: vec!["hello".to_owned()],
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
        let refused = start_found(
            &programs,
            &runs,
            "main",
            &logs,
            &spec_of("/bin/echo"),
            |_| {},
        );
        assert!(refused.is_err());
        let early = start_found(&programs, &runs, "main", &logs, &spec_of(&claude), |_| {});
        assert!(early.is_err(), "not before which has returned it");
        assert!(!logs.exists(), "nothing was started, so nothing was logged");

        assert_eq!(programs.which("claude").as_ref(), Some(&claude));

        let (sender, receiver) = mpsc::channel();
        let sender = std::sync::Mutex::new(sender);
        start_found(
            &programs,
            &runs,
            "main",
            &logs,
            &spec_of(&claude),
            move |message| {
                let _ = sender.lock().unwrap().send(message);
            },
        )
        .unwrap();
        let first = receiver.recv_timeout(Duration::from_secs(20)).unwrap();
        assert_eq!(
            first,
            RunMessage::Line {
                line: "hello".to_owned()
            }
        );
    }

    #[test]
    fn the_window_can_exec_only_what_which_returned() {
        let temp = TempFolder::new("agents-exec");
        let (programs, claude) = programs_with_claude(temp.path());
        let args = ["--version".to_owned()];
        assert!(exec_found(&programs, "/bin/echo", &args).is_err());
        assert!(exec_found(&programs, &claude, &args).is_err());
        programs.which("claude").unwrap();
        let output = exec_found(&programs, &claude, &args).unwrap();
        assert_eq!(output.code, Some(0));
        assert_eq!(output.stdout, "--version\n");
    }
}
