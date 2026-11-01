use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_fs::FsExt;

/// The person using the app: the author of their changes and comments.
#[derive(Debug, Serialize)]
struct Identity {
    name: String,
    email: Option<String>,
}

/// Reads the user's name and email from git's global config. Without a git name, the login name
/// stands in.
#[tauri::command(async)]
fn identity() -> Identity {
    let name = git_config("user.name")
        .or_else(login_name)
        .unwrap_or_else(|| "Me".to_owned());
    Identity {
        name,
        email: git_config("user.email"),
    }
}

/// One value from git's global config, or `None` when it is unset or git can't run.
fn git_config(key: &str) -> Option<String> {
    if !git_available() {
        return None;
    }
    let output = Command::new("git")
        .args(["config", "--global", "--get", key])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    non_empty(String::from_utf8(output.stdout).ok()?)
}

/// On macOS, `/usr/bin/git` is a stub that asks to install the command line tools when they are
/// missing, so git runs only when the developer directory it needs exists.
#[cfg(target_os = "macos")]
fn git_available() -> bool {
    let Ok(output) = Command::new("xcode-select").arg("-p").output() else {
        return false;
    };
    output.status.success()
        && String::from_utf8(output.stdout)
            .ok()
            .and_then(non_empty)
            .is_some_and(|dir| std::path::Path::new(&dir).exists())
}

#[cfg(not(target_os = "macos"))]
fn git_available() -> bool {
    true
}

fn login_name() -> Option<String> {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok()
        .and_then(non_empty)
}

fn non_empty(value: String) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

/// Files the app was asked to open, on its command line or by the system (`open -a Redlines
/// plan.md`), until the window takes them.
#[derive(Default)]
struct Opened(Mutex<Vec<PathBuf>>);

/// The files among `paths`, by their full paths. Anything else, such as an option or the process
/// serial number that older macOS versions pass, is left out.
fn files_in<P: Into<PathBuf>>(paths: impl IntoIterator<Item = P>) -> Vec<PathBuf> {
    paths
        .into_iter()
        .map(Into::into)
        .filter(|path| path.is_file())
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .collect()
}

/// Keeps files for the window and lets it read, write and watch them wherever they are, as the
/// open dialog does for the file it picks. Tells the window there is something to open.
fn offer(app: &AppHandle, files: Vec<PathBuf>) {
    if files.is_empty() {
        return;
    }
    let scope = app.fs_scope();
    let opened = app.state::<Opened>();
    let mut waiting = opened
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    for file in files {
        if scope.allow_file(&file).is_ok() {
            waiting.push(file);
        }
    }
    drop(waiting);
    // The window asks for the files when it starts, so an event it misses loses nothing.
    let _ = app.emit("opened", ());
}

/// The files given to the app since the window last asked, oldest first.
#[tauri::command]
fn opened_files(opened: tauri::State<'_, Opened>) -> Vec<String> {
    let mut waiting = opened
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    waiting
        .drain(..)
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Starts the app. The desktop binary calls this from `main`; mobile builds start here directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Opened::default())
        .setup(|app| {
            offer(app.handle(), files_in(std::env::args_os().skip(1)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![identity, opened_files])
        .build(tauri::generate_context!())
        .expect("error while building Redlines")
        .run(|app, event| {
            // Finder, the Dock and `open -a Redlines plan.md` hand files to a running app.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                offer(
                    app,
                    files_in(urls.iter().filter_map(|url| url.to_file_path().ok())),
                );
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_empty_trims_and_drops_blank_values() {
        assert_eq!(
            non_empty(" Ada Lovelace\n".to_owned()),
            Some("Ada Lovelace".to_owned())
        );
        assert_eq!(non_empty(" \n".to_owned()), None);
    }

    #[test]
    fn files_in_keeps_files_by_their_full_paths_and_nothing_else() {
        let folder = std::env::temp_dir().join(format!("redlines-files-in-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("plan.md");
        std::fs::write(&file, "# Plan\n").unwrap();
        let found = files_in([
            file.clone(),
            folder.clone(),
            folder.join("missing.md"),
            PathBuf::from("-psn_0_12345"),
        ]);
        assert_eq!(found, vec![std::fs::canonicalize(&file).unwrap()]);
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
