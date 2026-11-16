//! Recovery copies (#693). While a document has unsaved edits, its window keeps a copy of its text
//! here every few seconds and at each pause in typing (`src/recovery.ts`), in the app's support
//! folder and never next to the file. After the page's process ends, or the app crashes, the window
//! that opens the document again finds the copy and puts the edits back.
//!
//! A copy lives from the first unsaved edit to the save (or the close without saving) of its
//! document, and each of those deletes it. A quit that goes through the questions about unsaved
//! edits ends with every document saved or given up, so the app deletes them all as it exits; only
//! a crash, or a force quit, leaves any. A document is known by its key: its path, or for one that
//! was never saved `untitled:<window>`. The page names the key and the app turns it into a file
//! name, so that nothing the page says reaches another path.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// A recovery copy.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    pub key: String,
    /// The document's file, or None for one that was never saved.
    pub path: Option<String>,
    pub text: String,
}

/// FNV-1a, which names a file the same way in every run (the standard hasher promises nothing).
fn hash(key: &str) -> u64 {
    key.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn file_of(folder: &Path, key: &str) -> PathBuf {
    folder.join(format!("{:016x}.json", hash(key)))
}

/// Keeps the copy of `key`, whole or not at all.
pub fn write(folder: &Path, recovery: &Recovery) -> std::io::Result<()> {
    fs::create_dir_all(folder)?;
    let file = file_of(folder, &recovery.key);
    let temp = file.with_extension("tmp");
    fs::write(
        &temp,
        serde_json::to_vec(recovery).map_err(std::io::Error::other)?,
    )?;
    fs::rename(temp, file)
}

/// The copy of `key`, if there is a whole one.
pub fn read(folder: &Path, key: &str) -> Option<Recovery> {
    let bytes = fs::read(file_of(folder, key)).ok()?;
    let found: Recovery = serde_json::from_slice(&bytes).ok()?;
    // Two keys that hash alike are not one document.
    (found.key == key).then_some(found)
}

/// Deletes the copy of `key`, if there is one.
pub fn delete(folder: &Path, key: &str) {
    let _ = fs::remove_file(file_of(folder, key));
}

/// Deletes every copy, and what a write that was cut short left.
pub fn clear(folder: &Path) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("json" | "tmp")
        ) {
            let _ = fs::remove_file(path);
        }
    }
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("recovery"))
        .map_err(|e| e.to_string())
}

/// Keeps the text of a document with unsaved edits.
#[tauri::command(async)]
pub fn recovery_write(
    app: AppHandle,
    key: String,
    path: Option<String>,
    text: String,
) -> Result<(), String> {
    write(&folder(&app)?, &Recovery { key, path, text }).map_err(|e| e.to_string())
}

/// What a window kept of the document `key` before it ended, or None.
#[tauri::command(async)]
pub fn recovery_read(app: AppHandle, key: String) -> Result<Option<Recovery>, String> {
    Ok(read(&folder(&app)?, &key))
}

/// The document `key` is saved, or given up: nothing of it is kept.
#[tauri::command(async)]
pub fn recovery_delete(app: AppHandle, key: String) -> Result<(), String> {
    delete(&folder(&app)?, &key);
    Ok(())
}

/// The app is quitting for good, every document saved or given up: no copy is kept.
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
            std::env::temp_dir().join(format!("redlines-recovery-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn copy(key: &str, text: &str) -> Recovery {
        Recovery {
            key: key.to_owned(),
            path: Some(key.to_owned()),
            text: text.to_owned(),
        }
    }

    #[test]
    fn a_copy_lives_from_the_first_edit_to_the_save() {
        let dir = temp("life");
        assert_eq!(read(&dir, "/a/plan.md"), None);
        write(&dir, &copy("/a/plan.md", "first")).unwrap();
        write(&dir, &copy("/a/plan.md", "second")).unwrap();
        assert_eq!(read(&dir, "/a/plan.md").unwrap().text, "second");
        delete(&dir, "/a/plan.md");
        assert_eq!(read(&dir, "/a/plan.md"), None);
        // Deleting what isn't there is nothing.
        delete(&dir, "/a/plan.md");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn each_document_has_its_own_copy_and_an_untitled_one_too() {
        let dir = temp("each");
        write(&dir, &copy("/a/one.md", "one")).unwrap();
        write(
            &dir,
            &Recovery {
                key: "untitled:main".into(),
                path: None,
                text: "new".into(),
            },
        )
        .unwrap();
        assert_eq!(read(&dir, "/a/one.md").unwrap().text, "one");
        let untitled = read(&dir, "untitled:main").unwrap();
        assert_eq!((untitled.path, untitled.text.as_str()), (None, "new"));
        assert_eq!(read(&dir, "/a/two.md"), None);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_clean_quit_leaves_no_copy_and_a_cut_write_is_no_copy() {
        let dir = temp("quit");
        write(&dir, &copy("/a/one.md", "one")).unwrap();
        write(&dir, &copy("/a/two.md", "two")).unwrap();
        fs::write(dir.join("0000000000000001.tmp"), "{").unwrap();
        // A file that isn't a whole copy is none.
        fs::write(file_of(&dir, "/a/three.md"), "{\"key\": ").unwrap();
        assert_eq!(read(&dir, "/a/three.md"), None);
        clear(&dir);
        assert_eq!(read(&dir, "/a/one.md"), None);
        assert_eq!(read(&dir, "/a/two.md"), None);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_page_names_a_key_and_never_a_path() {
        let dir = temp("names");
        write(&dir, &copy("../../escape", "x")).unwrap();
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(names.len(), 1);
        assert!(names[0].to_string_lossy().ends_with(".json"));
        assert!(!dir.parent().unwrap().join("escape").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_large_document_is_kept_whole() {
        let dir = temp("large");
        let text = "line of a long document\n".repeat(200_000);
        write(&dir, &copy("/a/big.md", &text)).unwrap();
        assert_eq!(read(&dir, "/a/big.md").unwrap().text.len(), text.len());
        let _ = fs::remove_dir_all(dir);
    }
}
