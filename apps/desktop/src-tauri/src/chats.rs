//! Chat history (#1194). A document's chat is kept here, in the app's support folder and never in
//! the Markdown file: a chat is a private conversation, and a file is shared. The page names the
//! chat by its key, the document's path, and hands over its text, which is JSON that only the page
//! reads; the app turns the key into a file name, so that nothing the page says reaches another
//! path, and writes a whole file or none.

use std::fs;
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// The most a chat may hold, so that a page can't fill the disk through it.
const LIMIT: usize = 8 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Kept {
    key: String,
    text: String,
}

/// FNV-1a, which names a file the same way in every run.
fn hash(key: &str) -> u64 {
    key.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn file_of(folder: &Path, key: &str) -> PathBuf {
    folder.join(format!("{:016x}.json", hash(key)))
}

/// Makes the folder readable by this user only: a chat holds the document's path and the whole
/// conversation, which no other user of the Mac may read.
fn make_private_folder(folder: &Path) -> std::io::Result<()> {
    match fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(folder)
    {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    // Made earlier with another mode, by an earlier version: made private now.
    fs::set_permissions(folder, fs::Permissions::from_mode(0o700))
}

/// Gives each write a temp name of its own, so that two writes never share one.
static WRITES: AtomicU64 = AtomicU64::new(0);

fn write(folder: &Path, key: &str, text: &str) -> std::io::Result<()> {
    if text.len() > LIMIT {
        return Err(std::io::Error::other("The chat is too long to keep."));
    }
    make_private_folder(folder)?;
    let file = file_of(folder, key);
    let temp = file.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        WRITES.fetch_add(1, Ordering::Relaxed)
    ));
    let kept = Kept {
        key: key.to_owned(),
        text: text.to_owned(),
    };
    let bytes = serde_json::to_vec(&kept).map_err(std::io::Error::other)?;
    // Made new, with the mode it keeps, and whole or not at all.
    let written = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temp)
        .and_then(|mut out| {
            out.write_all(&bytes)?;
            out.sync_all()
        });
    match written.and_then(|()| fs::rename(&temp, file)) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(error)
        }
    }
}

fn read(folder: &Path, key: &str) -> Option<String> {
    let bytes = fs::read(file_of(folder, key)).ok()?;
    let found: Kept = serde_json::from_slice(&bytes).ok()?;
    // Two keys that hash alike are not one chat.
    (found.key == key).then_some(found.text)
}

fn delete(folder: &Path, key: &str) {
    let _ = fs::remove_file(file_of(folder, key));
}

/// The chat of `from` becomes the chat of `to`. A chat already at `to` belonged to a document that
/// had that name before, and is replaced, so that no file is left that nothing will ever read.
fn rekey(folder: &Path, from: &str, to: &str) -> std::io::Result<()> {
    if from == to {
        return Ok(());
    }
    let Some(text) = read(folder, from) else {
        return Ok(());
    };
    write(folder, to, &text)?;
    delete(folder, from);
    Ok(())
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("chats"))
        .map_err(|e| e.to_string())
}

/// Keeps the chat of the document `key`.
#[tauri::command(async)]
pub fn chat_write(app: AppHandle, key: String, text: String) -> Result<(), String> {
    write(&folder(&app)?, &key, &text).map_err(|e| e.to_string())
}

/// What was kept of the chat of the document `key`, or None.
#[tauri::command(async)]
pub fn chat_read(app: AppHandle, key: String) -> Result<Option<String>, String> {
    Ok(read(&folder(&app)?, &key))
}

/// Deletes the chat of the document `key`.
#[tauri::command(async)]
pub fn chat_delete(app: AppHandle, key: String) -> Result<(), String> {
    delete(&folder(&app)?, &key);
    Ok(())
}

/// The document was moved or renamed in Redlines: its chat goes with it.
#[tauri::command(async)]
pub fn chat_move(app: AppHandle, from: String, to: String) -> Result<(), String> {
    rekey(&folder(&app)?, &from, &to).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("redlines-chats-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_chat_is_kept_whole_and_found_by_its_key() {
        let dir = temp("keep");
        assert_eq!(read(&dir, "/a.md"), None);
        write(&dir, "/a.md", "{\"turns\":[]}").unwrap();
        write(&dir, "/b.md", "other").unwrap();
        assert_eq!(read(&dir, "/a.md").as_deref(), Some("{\"turns\":[]}"));
        assert_eq!(read(&dir, "/b.md").as_deref(), Some("other"));
        delete(&dir, "/a.md");
        assert_eq!(read(&dir, "/a.md"), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_move_carries_the_chat_and_leaves_no_file_behind() {
        let dir = temp("move");
        write(&dir, "/a.md", "mine").unwrap();
        rekey(&dir, "/a.md", "/c.md").unwrap();
        assert_eq!(read(&dir, "/a.md"), None);
        assert_eq!(read(&dir, "/c.md").as_deref(), Some("mine"));
        // A chat already at the new path is the old document's: it is replaced, not orphaned.
        write(&dir, "/d.md", "theirs").unwrap();
        rekey(&dir, "/c.md", "/d.md").unwrap();
        assert_eq!(read(&dir, "/d.md").as_deref(), Some("mine"));
        assert_eq!(read(&dir, "/c.md"), None);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_folder_and_its_files_are_for_this_user_only() {
        let dir = temp("modes");
        // A folder an earlier version made, open to others, is made private.
        fs::create_dir_all(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        write(&dir, "/a.md", "private").unwrap();
        let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&file_of(&dir, "/a.md")), 0o600);
        // No temp file is left, and a rewrite keeps the mode.
        write(&dir, "/a.md", "again").unwrap();
        assert_eq!(mode(&file_of(&dir, "/a.md")), 0o600);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_chat_over_the_limit_is_not_kept() {
        let dir = temp("limit");
        let big = "x".repeat(LIMIT + 1);
        assert!(write(&dir, "/a.md", &big).is_err());
        assert_eq!(read(&dir, "/a.md"), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
