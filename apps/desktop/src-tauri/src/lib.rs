use std::process::Command;

use serde::Serialize;

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

/// Starts the app. The desktop binary calls this from `main`; mobile builds start here directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![identity])
        .run(tauri::generate_context!())
        .expect("error while running Redlines");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_empty_trims_and_drops_blank_values() {
        assert_eq!(non_empty(" Ada Lovelace\n".to_owned()), Some("Ada Lovelace".to_owned()));
        assert_eq!(non_empty(" \n".to_owned()), None);
    }
}
