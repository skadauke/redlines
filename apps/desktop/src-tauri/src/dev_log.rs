//! The dev log (#1205): a rolling record of what happened, for troubleshooting a Test Drive. It
//! exists in builds that aren't releases (`build.rs` sets `redlines_release` for a release, as it
//! does for the updater), and a release build has no log: its commands write nothing, and the
//! page, told so, draws no Write to Log… command.
//!
//! The log holds the kinds of event below, one line each, with the time and the window. It never
//! holds a document's text: the page sends messages the app wrote itself, a key's name and never
//! the letter typed, and a hash of the document; and this module cuts every line short, takes the
//! home folder out, and hides anything that looks like a secret.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::crash::{append, cut, iso, now_seconds, scrub};

/// Whether this build keeps the log: every build that is not a release.
pub const ENABLED: bool = cfg!(not(redlines_release));

/// What a line can be about. The page names one; anything else is refused.
pub const KINDS: [&str; 7] = [
    "refusal", "alert", "error", "agent", "slow", "note", "snapshot",
];

const LINE_MOST: usize = 400;

/// A line of the log, or none for a kind it doesn't know.
pub fn line(at: u64, window: &str, kind: &str, detail: &str, home: Option<&str>) -> Option<String> {
    if !KINDS.contains(&kind) {
        return None;
    }
    let flat: String = detail
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let text = hide_secrets(&scrub(&cut(&flat, LINE_MOST), home));
    Some(format!("{} {window} {kind}: {text}\n", iso(at)))
}

/// Replaces what looks like a key or a token with `[hidden]`: a word after `Bearer`, a value after
/// `key=`, `token=`, `secret=` or `password=`, and any long run of letters, digits and `-_+/=.`
/// that has a digit and a letter in it (an API key). A hash of the document, 12 hexadecimal
/// digits, is shorter than that and stays.
pub fn hide_secrets(text: &str) -> String {
    let mut out = Vec::new();
    let mut after_bearer = false;
    for word in text.split(' ') {
        let lower = word.to_ascii_lowercase();
        let named = ["key=", "token=", "secret=", "password=", "apikey="]
            .iter()
            .find(|name| lower.contains(*name));
        let long = word.len() >= 24
            && word
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_+/=.".contains(c))
            && word.chars().any(|c| c.is_ascii_digit())
            && word.chars().any(|c| c.is_ascii_alphabetic());
        if after_bearer || long {
            out.push("[hidden]".to_owned());
        } else if let Some(name) = named {
            let at = lower.find(*name).unwrap_or(0) + name.len();
            out.push(format!("{}[hidden]", &word[..at]));
        } else {
            out.push(word.to_owned());
        }
        after_bearer = lower == "bearer";
    }
    out.join(" ")
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    Ok(logs.join("dev"))
}

/// Whether this build keeps the log: the page draws Write to Log… and sends lines only if so.
#[tauri::command]
pub fn dev_log_enabled() -> bool {
    ENABLED
}

/// Adds a line to `dev.log`. Nothing in a release build.
#[tauri::command(async)]
pub fn dev_log_write(app: AppHandle, window: WebviewWindow, kind: String, detail: String) {
    if !ENABLED {
        return;
    }
    let home = std::env::var("HOME").ok();
    let Some(text) = line(
        now_seconds(),
        window.label(),
        &kind,
        &detail,
        home.as_deref(),
    ) else {
        return;
    };
    if let Ok(folder) = folder(&app)
        && let Err(error) = append(&folder, "dev.log", &text)
    {
        eprintln!("Could not write the dev log: {error}");
    }
}

/// Shows `dev.log` in Finder. Nothing in a release build.
#[tauri::command(async)]
pub fn dev_log_reveal(app: AppHandle) -> Result<(), String> {
    if !ENABLED {
        return Err("There is no dev log in a release build.".to_owned());
    }
    let folder = folder(&app)?;
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let log = folder.join("dev.log");
    if !log.exists() {
        std::fs::write(&log, "").map_err(|e| e.to_string())?;
    }
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(&log)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Couldn’t show the log.".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_names_its_kind_and_refuses_another() {
        let l = line(0, "main", "refusal", "Can't edit code", None).unwrap();
        assert_eq!(l, "1970-01-01T00:00:00Z main refusal: Can't edit code\n");
        assert!(line(0, "main", "text", "anything", None).is_none());
    }

    #[test]
    fn a_line_is_one_line_cut_short_without_the_home_folder() {
        let l = line(
            0,
            "main",
            "error",
            "a\nb /Users/ann/x.md",
            Some("/Users/ann"),
        )
        .unwrap();
        assert!(l.contains("a b ~/x.md"));
        let long = line(0, "main", "note", &"w ".repeat(1000), None).unwrap();
        assert!(long.len() < LINE_MOST + 80);
        assert_eq!(long.matches('\n').count(), 1);
    }

    #[test]
    fn secrets_are_hidden_and_a_document_hash_stays() {
        assert_eq!(
            hide_secrets(
                "sent Bearer abc123 with key=sk12 and sk-ant-api03-ABCDEFGHIJKLMNOP1234567 ok"
            ),
            "sent Bearer [hidden] with key=[hidden] and [hidden] ok"
        );
        assert_eq!(hide_secrets("doc 3f9a8c1b2d4e"), "doc 3f9a8c1b2d4e");
    }

    /// A release build keeps no log: the flag is the one `build.rs` sets for it.
    #[test]
    fn a_release_build_has_no_log() {
        // The tests run in a dev build, which does keep it; a release build compiles it out.
        let release = cfg!(redlines_release);
        assert_eq!(ENABLED, !release);
        assert_eq!(dev_log_enabled(), !release);
    }
}
