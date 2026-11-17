//! Sessions (docs/research/collaboration.md, "One app as the authority"): one document in several
//! windows of this app. The windows of a document are its members; one of them, the leader, runs the
//! session's authority (`packages/collab`, TypeScript) and is the only one that saves the file. The
//! app decides who leads, counts the epochs, and keeps the authority's write-ahead log, so that a
//! window that takes over, or the next start after a crash, begins from what was confirmed.
//!
//! The app never reads what the windows say to each other: they send their calls and notices to
//! one another as events (`src/session.ts`). It only keeps the order of leaders honest: a leader
//! that was replaced, and is slow to learn it (its page was busy), can no longer write the log: its
//! appends name its epoch, and a smaller one than the session's is turned away.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/// What a window is told when its session has a new leader.
pub const MOVED: &str = "session-moved";

/// What the leader is told when another window leaves its session.
pub const LEFT: &str = "session-left";

/// One document's session.
#[derive(Debug, Clone, PartialEq)]
struct Session {
    /// The window that runs the authority and saves.
    leader: String,
    /// The windows, in the order they joined; the next leader is the first that is left.
    members: Vec<String>,
    /// Counts the leaders: it grows with each handover. A log write below it is refused.
    epoch: u32,
}

/// What the app tells a window that joins.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Joined {
    /// The window that leads.
    pub leader: String,
    pub epoch: u32,
    /// Whether it is the window that asked.
    pub leading: bool,
}

/// A change of leader, for the members to be told.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    pub path: String,
    pub leader: String,
    pub epoch: u32,
    #[serde(skip)]
    pub members: Vec<String>,
}

/// A window that left a session it did not lead, for the leader to be told.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gone {
    pub path: String,
    pub window: String,
    #[serde(skip)]
    pub leader: String,
}

/// What came of a window leaving.
#[derive(Debug, Default, PartialEq)]
pub struct Left {
    /// Sessions whose leader it was, now led by another.
    pub moved: Vec<Moved>,
    /// The paths of the sessions that ended with it.
    pub ended: Vec<String>,
    /// Sessions it was a member of, and not the leader.
    pub gone: Vec<Gone>,
}

/// The sessions, by the document's file.
#[derive(Debug, Default)]
pub struct Registry {
    sessions: HashMap<String, Session>,
}

impl Registry {
    /// A window joins the session of `path`, which it starts if there is none, as its leader.
    pub fn join(&mut self, path: &str, label: &str) -> Joined {
        let session = self
            .sessions
            .entry(path.to_owned())
            .or_insert_with(|| Session {
                leader: label.to_owned(),
                members: Vec::new(),
                epoch: 1,
            });
        if !session.members.iter().any(|member| member == label) {
            session.members.push(label.to_owned());
        }
        Joined {
            leader: session.leader.clone(),
            epoch: session.epoch,
            leading: session.leader == label,
        }
    }

    /// The window `label` leaves, from `path`'s session or from all of them.
    pub fn leave(&mut self, label: &str, path: Option<&str>) -> Left {
        let mut left = Left::default();
        for (key, session) in &mut self.sessions {
            if path.is_some_and(|path| path != key) {
                continue;
            }
            let Some(at) = session.members.iter().position(|member| member == label) else {
                continue;
            };
            session.members.remove(at);
            if session.members.is_empty() {
                left.ended.push(key.clone());
            } else if session.leader == label {
                session.leader = session.members[0].clone();
                session.epoch += 1;
                left.moved.push(Moved {
                    path: key.clone(),
                    leader: session.leader.clone(),
                    epoch: session.epoch,
                    members: session.members.clone(),
                });
            } else {
                left.gone.push(Gone {
                    path: key.clone(),
                    window: label.to_owned(),
                    leader: session.leader.clone(),
                });
            }
        }
        for key in &left.ended {
            self.sessions.remove(key);
        }
        left
    }

    /// Whether `label` may write `path`'s log at `epoch`: it leads, and no later epoch has begun.
    pub fn may_write(&self, path: &str, label: &str, epoch: u32) -> Result<(), String> {
        let Some(session) = self.sessions.get(path) else {
            return Err("There is no session for this document.".to_owned());
        };
        if session.leader != label {
            return Err("This window does not lead the session.".to_owned());
        }
        if epoch < session.epoch {
            return Err(format!(
                "The session is in epoch {}, not {epoch}.",
                session.epoch
            ));
        }
        Ok(())
    }

    /// The window that leads `path`'s session, and its members.
    pub fn members(&self, path: &str) -> Vec<String> {
        self.sessions
            .get(path)
            .map(|session| session.members.clone())
            .unwrap_or_default()
    }
}

/// The sessions, as the app's state.
#[derive(Default)]
pub struct Sessions(Mutex<Registry>);

impl Sessions {
    fn lock(&self) -> MutexGuard<'_, Registry> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

// --- the log -----------------------------------------------------------------------------------

/// FNV-1a, which names a file the same way in every run.
fn hash(key: &str) -> u64 {
    key.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn file_of(folder: &Path, path: &str) -> PathBuf {
    folder.join(format!("{:016x}.wal", hash(path)))
}

/// What a log holds: the text the session began with, and the records the authority wrote, as the
/// lines the window gave.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Log {
    pub base: String,
    pub records: Vec<String>,
}

/// Starts the log of `path` over, with its first line the base text as a JSON string.
pub fn start(folder: &Path, path: &str, base: &str) -> std::io::Result<()> {
    fs::create_dir_all(folder)?;
    let line = serde_json::to_string(base).map_err(std::io::Error::other)?;
    fs::write(file_of(folder, path), format!("{line}\n"))
}

/// Adds records, one line each. A line is JSON by the window's word: the app does not read it, but
/// it keeps each on one line.
pub fn append(folder: &Path, path: &str, lines: &[String]) -> std::io::Result<()> {
    let mut file = OpenOptions::new()
        .append(true)
        .open(file_of(folder, path))?;
    let mut bytes = String::new();
    for line in lines {
        if line.contains('\n') {
            return Err(std::io::Error::other("A record is one line."));
        }
        bytes.push_str(line);
        bytes.push('\n');
    }
    file.write_all(bytes.as_bytes())
}

/// The log of `path`, if there is a whole one: a cut last line (the app ended mid-write) is left
/// out, as the record it would have been never was acknowledged.
pub fn read(folder: &Path, path: &str) -> Option<Log> {
    let text = fs::read_to_string(file_of(folder, path)).ok()?;
    let complete = text.rfind('\n').map(|at| &text[..=at])?;
    let mut lines = complete.lines();
    let base: String = serde_json::from_str(lines.next()?).ok()?;
    Some(Log {
        base,
        records: lines.map(str::to_owned).collect(),
    })
}

pub fn delete(folder: &Path, path: &str) {
    let _ = fs::remove_file(file_of(folder, path));
}

/// Deletes every log: a clean quit leaves nothing to restore.
pub fn clear(folder: &Path) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.path().extension().and_then(|e| e.to_str()) == Some("wal") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("sessions"))
        .map_err(|e| e.to_string())
}

// --- commands ----------------------------------------------------------------------------------

/// What a window that joins is given besides its place: the log an earlier run left, for the leader
/// to restore from, or None.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinReply {
    #[serde(flatten)]
    pub joined: Joined,
    pub left: Option<Log>,
}

/// This window joins the session of its document `path`, or starts it.
#[tauri::command(async)]
pub fn session_join(
    window: WebviewWindow,
    sessions: tauri::State<'_, Sessions>,
    path: String,
) -> Result<JoinReply, String> {
    let app = window.app_handle();
    let (joined, fresh) = {
        let mut registry = sessions.lock();
        let fresh = registry.members(&path).is_empty();
        (registry.join(&path, window.label()), fresh)
    };
    // A log left by a run that ended is for the window that starts the session to look at.
    let left = if fresh {
        read(&folder(app)?, &path)
    } else {
        None
    };
    Ok(JoinReply { joined, left })
}

/// The leader starts the session's log over from `base`.
#[tauri::command(async)]
pub fn session_wal_start(
    window: WebviewWindow,
    sessions: tauri::State<'_, Sessions>,
    path: String,
    epoch: u32,
    base: String,
) -> Result<(), String> {
    sessions.lock().may_write(&path, window.label(), epoch)?;
    start(&folder(window.app_handle())?, &path, &base).map_err(|e| e.to_string())
}

/// The leader adds the records the authority wrote. Refused to a window that doesn't lead, or leads
/// an epoch that is over.
#[tauri::command(async)]
pub fn session_wal_append(
    window: WebviewWindow,
    sessions: tauri::State<'_, Sessions>,
    path: String,
    epoch: u32,
    lines: Vec<String>,
) -> Result<(), String> {
    sessions.lock().may_write(&path, window.label(), epoch)?;
    append(&folder(window.app_handle())?, &path, &lines).map_err(|e| e.to_string())
}

/// What the session's log holds, for the window that takes the lead to begin from: the base and
/// the records confirmed so far. Any member may ask.
#[tauri::command(async)]
pub fn session_wal_read(
    window: WebviewWindow,
    sessions: tauri::State<'_, Sessions>,
    path: String,
) -> Result<Option<Log>, String> {
    if !sessions
        .lock()
        .members(&path)
        .iter()
        .any(|m| m == window.label())
    {
        return Err("This window is not in the session.".to_owned());
    }
    Ok(read(&folder(window.app_handle())?, &path))
}

/// This window leaves its document's session (it opened another document, or stops being synced).
#[tauri::command]
pub fn session_leave(
    window: WebviewWindow,
    sessions: tauri::State<'_, Sessions>,
    path: String,
) -> Result<(), String> {
    let app = window.app_handle();
    let left = sessions.lock().leave(window.label(), Some(&path));
    after_leaving(app, left);
    Ok(())
}

/// A window is gone: it leaves every session it was in, as if it had said so.
pub fn window_closed(app: &AppHandle, label: &str) {
    let left = app.state::<Sessions>().lock().leave(label, None);
    after_leaving(app, left);
}

fn after_leaving(app: &AppHandle, left: Left) {
    for gone in &left.gone {
        let _ = app.emit_to(gone.leader.as_str(), LEFT, gone);
    }
    for path in left.ended {
        if let Ok(folder) = folder(app) {
            delete(&folder, &path);
        }
    }
    for change in left.moved {
        for member in &change.members {
            let _ = app.emit_to(member.as_str(), MOVED, &change);
        }
    }
}

/// The app is quitting for good: no log is kept.
pub fn quit(app: &AppHandle) {
    if let Ok(folder) = folder(app) {
        clear(&folder);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("redlines-session-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn the_first_window_leads_and_the_next_follow() {
        let mut registry = Registry::default();
        let first = registry.join("/a/plan.md", "doc-1");
        assert_eq!((first.leading, first.epoch), (true, 1));
        let second = registry.join("/a/plan.md", "doc-2");
        assert_eq!((second.leading, second.leader.as_str()), (false, "doc-1"));
        // Joining twice changes nothing.
        registry.join("/a/plan.md", "doc-2");
        assert_eq!(registry.members("/a/plan.md"), ["doc-1", "doc-2"]);
        // Another document has a session of its own.
        assert!(registry.join("/a/other.md", "doc-3").leading);
    }

    #[test]
    fn a_leader_that_leaves_hands_over_in_a_new_epoch() {
        let mut registry = Registry::default();
        registry.join("/a/plan.md", "doc-1");
        registry.join("/a/plan.md", "doc-2");
        registry.join("/a/plan.md", "doc-3");
        let left = registry.leave("doc-1", None);
        assert!(left.ended.is_empty());
        assert_eq!(left.moved.len(), 1);
        assert_eq!(
            (left.moved[0].leader.as_str(), left.moved[0].epoch),
            ("doc-2", 2)
        );
        assert_eq!(left.moved[0].members, ["doc-2", "doc-3"]);
        // A follower that leaves moves nothing, and the leader is told it went.
        let left = registry.leave("doc-3", None);
        assert!(left.moved.is_empty());
        assert_eq!(left.gone.len(), 1);
        assert_eq!(
            (left.gone[0].window.as_str(), left.gone[0].leader.as_str()),
            ("doc-3", "doc-2")
        );
        // The last one leaving ends the session.
        let left = registry.leave("doc-2", None);
        assert!(left.moved.is_empty());
        assert_eq!(left.ended, ["/a/plan.md"]);
        assert!(registry.members("/a/plan.md").is_empty());
    }

    #[test]
    fn a_late_write_of_a_leader_that_was_replaced_is_refused() {
        let mut registry = Registry::default();
        registry.join("/a/plan.md", "doc-1");
        registry.join("/a/plan.md", "doc-2");
        assert!(registry.may_write("/a/plan.md", "doc-1", 1).is_ok());
        registry.leave("doc-1", None);
        // The old leader's page was frozen and writes after the handover: not its place, not its epoch.
        assert!(registry.may_write("/a/plan.md", "doc-1", 1).is_err());
        // A follower can't write in the old epoch either, nor can the new leader name it.
        assert!(registry.may_write("/a/plan.md", "doc-2", 1).is_err());
        assert!(registry.may_write("/a/plan.md", "doc-2", 2).is_ok());
        assert!(registry.may_write("/a/none.md", "doc-2", 2).is_err());
    }

    #[test]
    fn a_log_comes_back_as_it_was_written() {
        let dir = temp("log");
        assert_eq!(read(&dir, "/a/plan.md"), None);
        start(&dir, "/a/plan.md", "Base\ntext\n").unwrap();
        append(
            &dir,
            "/a/plan.md",
            &[r#"{"v":1}"#.to_owned(), r#"{"v":2}"#.to_owned()],
        )
        .unwrap();
        append(&dir, "/a/plan.md", &[r#"{"v":3}"#.to_owned()]).unwrap();
        let log = read(&dir, "/a/plan.md").unwrap();
        assert_eq!(log.base, "Base\ntext\n");
        assert_eq!(log.records, [r#"{"v":1}"#, r#"{"v":2}"#, r#"{"v":3}"#]);
        // A record is one line.
        assert!(append(&dir, "/a/plan.md", &["a\nb".to_owned()]).is_err());
        // Starting again forgets the old log.
        start(&dir, "/a/plan.md", "New").unwrap();
        assert!(read(&dir, "/a/plan.md").unwrap().records.is_empty());
        delete(&dir, "/a/plan.md");
        assert_eq!(read(&dir, "/a/plan.md"), None);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_record_cut_short_by_a_crash_was_never_confirmed() {
        let dir = temp("cut");
        start(&dir, "/a/plan.md", "Base").unwrap();
        append(&dir, "/a/plan.md", &[r#"{"v":1}"#.to_owned()]).unwrap();
        // The app ended in the middle of the next line.
        let mut file = OpenOptions::new()
            .append(true)
            .open(file_of(&dir, "/a/plan.md"))
            .unwrap();
        file.write_all(br#"{"v":"#).unwrap();
        let log = read(&dir, "/a/plan.md").unwrap();
        assert_eq!(log.records, [r#"{"v":1}"#]);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_page_names_a_document_and_never_a_path() {
        let dir = temp("names");
        start(&dir, "../../escape", "x").unwrap();
        assert!(!dir.parent().unwrap().join("escape").exists());
        clear(&dir);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        let _ = fs::remove_dir_all(dir);
    }
}
