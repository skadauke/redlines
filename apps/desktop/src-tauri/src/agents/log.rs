//! A run's log: one JSON Lines file for each run in the app's log folder, for troubleshooting.
//!
//! The file starts with what was started. Then comes every line of the agent's event stream as it
//! came, which holds the session id and every tool call with its result, and every line of its
//! stderr. It ends with how the run ended. Redlines' own lines carry a `redlines` field. The log
//! records flags and events and never the environment, so no credential can land in one.

use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde::de::IgnoredAny;
use serde_json::json;

/// Logs quote the document and the repository, so they don't stay around.
const KEPT_FOR: Duration = Duration::from_secs(30 * 86_400);

/// What a log says about a run besides the command, from `ProcessSpec.log`.
#[derive(Debug, Deserialize)]
pub struct RunInfo {
    pub agent: String,
    pub thread: String,
    pub document: Option<String>,
    pub version: Option<String>,
}

/// How a run ended, for the last line of its log.
#[derive(Clone, Copy, Debug, Default)]
pub struct RunEnd {
    pub code: Option<i32>,
    pub signal: Option<i32>,
    /// Someone asked it to stop, as against ending by itself.
    pub stopped: bool,
}

/// An open log. Nothing goes in it after `ended`.
pub struct RunLog {
    path: PathBuf,
    file: Mutex<Option<File>>,
}

impl RunLog {
    /// Starts a new log in `folder`, and deletes the logs that have grown too old.
    pub fn create(folder: &Path, agent: &str, now: SystemTime) -> io::Result<Self> {
        make_private_folder(folder)?;
        delete_old_logs(folder, now);
        let stem = format!("{}-{}", file_stamp(&local_time(now)), file_safe(agent));
        for attempt in 1.. {
            // Two runs can start in the same second. A second name, then, and never someone else's
            // file: `create_new` won't open what's there, or follow a link.
            let name = match attempt {
                1 => format!("{stem}.jsonl"),
                _ => format!("{stem}-{attempt}.jsonl"),
            };
            let path = folder.join(name);
            match OpenOptions::new()
                .append(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
            {
                Ok(file) => {
                    return Ok(RunLog {
                        path,
                        file: Mutex::new(Some(file)),
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error),
            }
        }
        unreachable!("the attempts above never run out")
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The first line: what was started.
    pub fn started(&self, info: &RunInfo, program: &str, args: &[String], cwd: Option<&str>) {
        self.write(&json!({
            "redlines": "start",
            "time": log_time(SystemTime::now()),
            "agent": info.agent,
            "version": info.version,
            "thread": info.thread,
            "document": info.document,
            "program": program,
            "args": args,
            "folder": cwd,
        }));
    }

    /// A line of the event stream, as it came. A line that isn't JSON is wrapped, so that the file
    /// stays JSON Lines.
    pub fn stdout(&self, line: &str) {
        if serde_json::from_str::<IgnoredAny>(line).is_ok() {
            self.append(line);
        } else {
            self.write(&json!({ "redlines": "stdout", "text": line }));
        }
    }

    pub fn stderr(&self, line: &str) {
        self.write(&json!({ "redlines": "stderr", "text": line }));
    }

    /// The last line: how the run ended.
    pub fn ended(&self, end: RunEnd) {
        self.write(&json!({
            "redlines": "end",
            "time": log_time(SystemTime::now()),
            "code": end.code,
            "signal": end.signal,
            "stopped": end.stopped,
        }));
        *self.open_file() = None;
    }

    fn write(&self, value: &serde_json::Value) {
        self.append(&value.to_string());
    }

    /// Adds a line. A log that can't be written, on a full disk say, doesn't stop a run.
    fn append(&self, line: &str) {
        if let Some(file) = self.open_file().as_mut() {
            let mut bytes = Vec::with_capacity(line.len() + 1);
            bytes.extend_from_slice(line.as_bytes());
            bytes.push(b'\n');
            let _ = file.write_all(&bytes);
        }
    }

    fn open_file(&self) -> MutexGuard<'_, Option<File>> {
        self.file
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Makes the log folder if it isn't there, and makes sure only this user can look inside. Logs quote
/// the document and the repository.
pub fn make_private_folder(folder: &Path) -> io::Result<()> {
    DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(folder)?;
    fs::set_permissions(folder, fs::Permissions::from_mode(0o700))
}

/// Deletes the logs in `folder` last written more than 30 days before `now`.
pub fn delete_old_logs(folder: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .is_none_or(|extension| extension != "jsonl")
        {
            continue;
        }
        // `DirEntry::metadata` doesn't follow a link, so only a real file is ever considered.
        let old = entry
            .metadata()
            .ok()
            .filter(|metadata| metadata.is_file())
            .and_then(|metadata| {
                let age = now.duration_since(metadata.modified().ok()?).ok()?;
                Some(age > KEPT_FOR)
            });
        if old == Some(true) {
            let _ = fs::remove_file(path);
        }
    }
}

/// An agent's name as a part of a file's name. The window sends the name, so it can't be trusted to
/// stay in the folder.
fn file_safe(agent: &str) -> String {
    let safe: String = agent
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => c,
            _ => '_',
        })
        .collect();
    if safe.is_empty() {
        "agent".to_owned()
    } else {
        safe
    }
}

fn local_time(at: SystemTime) -> libc::tm {
    let seconds = at
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    let seconds = libc::time_t::try_from(seconds).unwrap_or_default();
    // SAFETY: `tm` is plain data that all zeroes is valid for, `localtime_r` fills it, and both
    // pointers are to locals that outlive the call.
    unsafe {
        let mut local: libc::tm = std::mem::zeroed();
        libc::localtime_r(&seconds, &mut local);
        local
    }
}

/// `2026-11-05T14-30-00`, in local time, for a file name.
fn file_stamp(at: &libc::tm) -> String {
    format!(
        "{:04}-{:02}-{:02}T{:02}-{:02}-{:02}",
        at.tm_year + 1900,
        at.tm_mon + 1,
        at.tm_mday,
        at.tm_hour,
        at.tm_min,
        at.tm_sec
    )
}

/// `2026-11-05T14:30:00+01:00`, in local time, for a line of the log.
fn log_time(at: SystemTime) -> String {
    let local = local_time(at);
    let offset_minutes = local.tm_gmtoff / 60;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{}{:02}:{:02}",
        local.tm_year + 1900,
        local.tm_mon + 1,
        local.tm_mday,
        local.tm_hour,
        local.tm_min,
        local.tm_sec,
        if offset_minutes < 0 { '-' } else { '+' },
        offset_minutes.abs() / 60,
        offset_minutes.abs() % 60
    )
}

#[cfg(test)]
mod tests {
    use std::time::UNIX_EPOCH;

    use super::*;
    use crate::agents::test_support::TempFolder;

    const DAY: Duration = Duration::from_secs(86_400);

    fn lines_of(path: &Path) -> Vec<String> {
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn a_log_is_named_for_when_and_who_is_private_and_opens_for_appending() {
        let folder = TempFolder::new("log-name");
        let log = RunLog::create(folder.path(), "claude", SystemTime::now()).unwrap();
        let name = log.path().file_name().unwrap().to_str().unwrap().to_owned();
        // YYYY-MM-DDTHH-MM-SS-claude.jsonl
        let shape: String = name
            .chars()
            .map(|c| if c.is_ascii_digit() { '0' } else { c })
            .collect();
        assert_eq!(shape, "0000-00-00T00-00-00-claude.jsonl");
        assert_eq!(log.path().parent(), Some(folder.path()));
        let mode = fs::metadata(log.path()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);

        log.stdout("{\"one\":1}");
        // Someone else writing to the file doesn't get overwritten: every write goes to the end.
        let mut other = fs::OpenOptions::new()
            .append(true)
            .open(log.path())
            .unwrap();
        std::io::Write::write_all(&mut other, b"{\"two\":2}\n").unwrap();
        log.stdout("{\"three\":3}");
        assert_eq!(
            lines_of(log.path()),
            ["{\"one\":1}", "{\"two\":2}", "{\"three\":3}"]
        );
    }

    #[test]
    fn two_runs_in_the_same_second_get_two_logs() {
        let folder = TempFolder::new("log-twice");
        let now = SystemTime::now();
        let first = RunLog::create(folder.path(), "codex", now).unwrap();
        let second = RunLog::create(folder.path(), "codex", now).unwrap();
        assert_ne!(first.path(), second.path());
        first.stdout("{\"run\":1}");
        second.stdout("{\"run\":2}");
        assert_eq!(lines_of(first.path()), ["{\"run\":1}"]);
        assert_eq!(lines_of(second.path()), ["{\"run\":2}"]);
    }

    #[test]
    fn an_agents_name_cant_leave_the_log_folder() {
        let folder = TempFolder::new("log-escape");
        let log = RunLog::create(folder.path(), "../../evil/.\n", SystemTime::now()).unwrap();
        assert_eq!(log.path().parent(), Some(folder.path()));
        let name = log.path().file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with(".jsonl"), "{name}");
        assert!(!name.contains(".."), "{name}");
    }

    #[test]
    fn the_log_starts_with_what_was_started() {
        let folder = TempFolder::new("log-start");
        let log = RunLog::create(folder.path(), "claude", SystemTime::now()).unwrap();
        let info = RunInfo {
            agent: "claude".to_owned(),
            thread: "c7".to_owned(),
            document: Some("/docs/plan.md".to_owned()),
            version: Some("2.1.318".to_owned()),
        };
        log.started(
            &info,
            "/bin/claude",
            &["-p".to_owned(), "hello".to_owned()],
            Some("/docs"),
        );
        let lines = lines_of(log.path());
        let first: serde_json::Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(first["redlines"], "start");
        assert_eq!(first["agent"], "claude");
        assert_eq!(first["version"], "2.1.318");
        assert_eq!(first["thread"], "c7");
        assert_eq!(first["document"], "/docs/plan.md");
        assert_eq!(first["program"], "/bin/claude");
        assert_eq!(first["args"], serde_json::json!(["-p", "hello"]));
        assert_eq!(first["folder"], "/docs");
        assert!(first["time"].as_str().unwrap().contains(':'));
    }

    #[test]
    fn events_stay_as_they_came_and_everything_else_stays_json_lines() {
        let folder = TempFolder::new("log-lines");
        let log = RunLog::create(folder.path(), "codex", SystemTime::now()).unwrap();
        // Spacing and key order as the program wrote them.
        log.stdout("{ \"type\" : \"turn.started\",\"a\":1 }");
        log.stdout("Not JSON at all");
        log.stderr("Reading additional input from stdin...");
        log.ended(RunEnd {
            code: Some(1),
            signal: None,
            stopped: false,
        });
        let lines = lines_of(log.path());
        assert_eq!(lines[0], "{ \"type\" : \"turn.started\",\"a\":1 }");
        let parsed: Vec<serde_json::Value> = lines
            .iter()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(parsed[1]["redlines"], "stdout");
        assert_eq!(parsed[1]["text"], "Not JSON at all");
        assert_eq!(parsed[2]["redlines"], "stderr");
        assert_eq!(parsed[2]["text"], "Reading additional input from stdin...");
        assert_eq!(parsed[3]["redlines"], "end");
        assert_eq!(parsed[3]["code"], 1);
        assert_eq!(parsed[3]["stopped"], false);
    }

    #[test]
    fn nothing_goes_in_after_the_end() {
        let folder = TempFolder::new("log-end");
        let log = RunLog::create(folder.path(), "codex", SystemTime::now()).unwrap();
        log.ended(RunEnd::default());
        log.stdout("{\"late\":true}");
        log.stderr("late");
        assert_eq!(lines_of(log.path()).len(), 1);
    }

    #[test]
    fn logs_older_than_30_days_are_deleted_at_start() {
        let folder = TempFolder::new("log-old");
        let now = UNIX_EPOCH + DAY * 20_000;
        let aged = |name: &str, age: Duration| {
            let path = folder.path().join(name);
            let file = File::create(&path).unwrap();
            file.set_modified(now - age).unwrap();
            path
        };
        let old = aged("2026-01-01T00-00-00-claude.jsonl", DAY * 31);
        let recent = aged("2026-02-01T00-00-00-claude.jsonl", DAY * 29);
        let not_a_log = aged("notes.txt", DAY * 365);

        let log = RunLog::create(folder.path(), "claude", now).unwrap();

        assert!(!old.exists());
        assert!(recent.exists());
        assert!(not_a_log.exists());
        assert!(log.path().exists());
    }

    #[test]
    fn deleting_old_logs_in_a_folder_that_isnt_there_is_nothing() {
        let folder = TempFolder::new("log-none");
        delete_old_logs(&folder.path().join("missing"), SystemTime::now());
    }

    #[test]
    fn create_makes_the_folder_private() {
        let folder = TempFolder::new("log-folder");
        let agents = folder.path().join("agents");
        RunLog::create(&agents, "claude", SystemTime::now()).unwrap();
        let mode = fs::metadata(&agents).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
    }

    #[test]
    fn a_folder_that_others_can_read_is_tightened() {
        let folder = TempFolder::new("log-tighten");
        let agents = folder.path().join("agents");
        fs::create_dir(&agents).unwrap();
        fs::set_permissions(&agents, fs::Permissions::from_mode(0o755)).unwrap();
        make_private_folder(&agents).unwrap();
        let mode = fs::metadata(&agents).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
    }

    #[test]
    fn make_private_folder_makes_a_new_one_private_with_its_parents() {
        let folder = TempFolder::new("log-new");
        let agents = folder.path().join("md.redlines.editor").join("agents");
        make_private_folder(&agents).unwrap();
        for made in [&agents, &folder.path().join("md.redlines.editor")] {
            let mode = fs::metadata(made).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700);
        }
    }
}
