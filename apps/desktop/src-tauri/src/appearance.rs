//! The app's appearance: light, dark, or as the system is (Match System), as Preferences ›
//! Appearance says (design §6.6). It is every window's at once, the window itself with its title
//! bar, scroll bars and the system's menus and dialogs, and About Redlines', the system's panel.
//!
//! The person's choice is in the windows' settings, which the app can't read before a window
//! opens. So the app keeps a copy, in `appearance.json` in its data folder, and takes that
//! appearance first thing at the start, before it opens a window, so that no window ever shows
//! another one first. A copy that is missing or can't be read is Match System. The windows set the
//! appearance through `set_appearance` (`src/window-theme.ts`): Preferences as the person chooses
//! it, and each document window as it opens, which keeps the copy the same as the settings.

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, Theme};

/// The file in the app's data folder that holds the copy.
const REMEMBERED_FILE: &str = "appearance.json";

/// The choice, in the words of the windows' settings (`AppearanceChoice` in `src/settings.ts`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    /// Match System.
    #[default]
    System,
    Light,
    Dark,
}

impl Appearance {
    /// The app's theme in Tauri's words: none follows the system.
    fn theme(self) -> Option<Theme> {
        match self {
            Self::System => None,
            Self::Light => Some(Theme::Light),
            Self::Dark => Some(Theme::Dark),
        }
    }
}

/// What the file holds.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct Remembered {
    appearance: Appearance,
}

/// The copy in `file`, or Match System when it isn't there or can't be understood.
fn read_remembered(file: &Path) -> Appearance {
    std::fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Remembered>(&bytes).ok())
        .map(|remembered| remembered.appearance)
        .unwrap_or_default()
}

/// Keeps `appearance` in `file` for the next start, unless the file holds it already.
fn keep(file: &Path, appearance: Appearance) -> io::Result<()> {
    if read_remembered(file) == appearance {
        return Ok(());
    }
    if let Some(folder) = file.parent() {
        std::fs::create_dir_all(folder)?;
    }
    std::fs::write(file, serde_json::to_vec(&Remembered { appearance })?)
}

/// Where the copy is, if the app has a data folder.
fn remembered_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let folder = app.path().app_data_dir().ok()?;
    Some(folder.join(REMEMBERED_FILE))
}

/// Takes the appearance the app kept. First thing in `setup`, which runs on the main thread, where
/// Tauri takes it at once: every window opened after it is drawn in it from its first frame.
pub fn set_up<R: Runtime>(app: &AppHandle<R>) {
    let appearance =
        remembered_file(app).map_or_else(Appearance::default, |file| read_remembered(&file));
    app.set_theme(appearance.theme());
}

/// Sets the appearance of every window at once, and keeps it for the next start. Only Preferences
/// and the document windows are granted the command (`capabilities/`); the install question shows
/// what the app took at the start, and has nothing to set.
#[tauri::command]
pub fn set_appearance(app: AppHandle, appearance: Appearance) -> Result<(), String> {
    app.set_theme(appearance.theme());
    if let Some(file) = remembered_file(&app)
        && let Err(error) = keep(&file, appearance)
    {
        eprintln!(
            "Redlines can't keep its appearance in {}: {error}",
            file.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder for one test, which the test removes.
    fn scratch(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("redlines-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        folder
    }

    #[test]
    fn the_appearance_has_the_words_of_the_windows_settings() {
        // `AppearanceChoice` in src/settings.ts.
        for (word, appearance) in [
            ("\"system\"", Appearance::System),
            ("\"light\"", Appearance::Light),
            ("\"dark\"", Appearance::Dark),
        ] {
            assert_eq!(
                serde_json::from_str::<Appearance>(word).unwrap(),
                appearance
            );
            assert_eq!(serde_json::to_string(&appearance).unwrap(), word);
        }
        for other in ["\"auto\"", "\"Dark\"", "\"\"", "null", "1", "true"] {
            assert!(
                serde_json::from_str::<Appearance>(other).is_err(),
                "{other}"
            );
        }
    }

    #[test]
    fn match_system_leaves_the_appearance_to_the_system() {
        assert_eq!(Appearance::default(), Appearance::System);
        assert_eq!(Appearance::System.theme(), None);
        assert_eq!(Appearance::Light.theme(), Some(Theme::Light));
        assert_eq!(Appearance::Dark.theme(), Some(Theme::Dark));
    }

    #[test]
    fn the_copy_comes_back_from_its_file_and_its_folder_is_made() {
        let folder = scratch("appearance-kept");
        let file = folder.join("data").join(REMEMBERED_FILE);
        assert_eq!(read_remembered(&file), Appearance::System);
        keep(&file, Appearance::Dark).unwrap();
        assert_eq!(read_remembered(&file), Appearance::Dark);
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            r#"{"appearance":"dark"}"#
        );
        keep(&file, Appearance::Light).unwrap();
        assert_eq!(read_remembered(&file), Appearance::Light);
        keep(&file, Appearance::System).unwrap();
        assert_eq!(read_remembered(&file), Appearance::System);
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            r#"{"appearance":"system"}"#
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_copy_that_is_missing_or_not_understood_is_match_system() {
        let folder = scratch("appearance-unreadable");
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join(REMEMBERED_FILE);
        assert_eq!(read_remembered(&file), Appearance::System);
        let read = |contents: &str| {
            std::fs::write(&file, contents).unwrap();
            read_remembered(&file)
        };
        for contents in [
            "not json",
            "",
            "null",
            "{}",
            "\"dark\"",
            r#"{"appearance":"auto"}"#,
            r#"{"appearance":3}"#,
        ] {
            assert_eq!(read(contents), Appearance::System, "{contents:?}");
        }
        // What is understood is kept, whatever else the file holds.
        assert_eq!(
            read(r#"{"appearance":"light","another":1}"#),
            Appearance::Light
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn the_copy_is_written_only_when_it_changes() {
        // Each document window says what the settings hold as it opens, which the copy holds
        // already, nearly always.
        let folder = scratch("appearance-unchanged");
        let file = folder.join(REMEMBERED_FILE);
        // No copy is Match System already.
        keep(&file, Appearance::System).unwrap();
        assert!(!file.exists());
        // A copy that says the same in other words is left as it is.
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(&file, r#"{ "appearance": "dark" }"#).unwrap();
        keep(&file, Appearance::Dark).unwrap();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            r#"{ "appearance": "dark" }"#
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn the_windows_call_the_command_the_app_has() {
        let window = include_str!("../../src/appearance-command.ts");
        assert!(
            window.contains("'set_appearance'"),
            "src/appearance-command.ts doesn't call set_appearance"
        );
        assert!(
            include_str!("lib.rs").contains("appearance::set_appearance,"),
            "lib.rs doesn't register set_appearance"
        );
    }

    #[test]
    fn no_window_sets_the_apps_theme_but_through_the_app() {
        // Tauri's own command would set the theme and leave the copy as it was, for the next start.
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut read = 0;
        for entry in std::fs::read_dir(&folder).unwrap() {
            let path = entry.unwrap().path();
            if path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                let capability = std::fs::read_to_string(&path).unwrap();
                assert!(
                    !capability.contains("set-app-theme"),
                    "{} lets its windows set the theme themselves",
                    path.display()
                );
                read += 1;
            }
        }
        assert!(read >= 3, "only {read} capabilities");
    }
}
