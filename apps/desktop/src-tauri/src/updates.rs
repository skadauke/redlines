//! Updates (#34). The window checks for an update, downloads it and installs it through the
//! updater plugin (`src/updates.ts`). This module says whether this copy of Redlines can update
//! itself at all, and starts the new version once an update is installed, with the documents that
//! were open.
//!
//! A copy updates itself where it is installed, in `~/Applications` or `/Applications`, by
//! replacing its own bundle. It doesn't when that would need an administrator's password (no
//! dialog ever asks for one), when it runs from its disk image (there it offers to install itself,
//! `install.rs`, and the installed copy updates), or when it isn't a release build: a development
//! or test build stays the build it is.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

// The app's own checks, download and install, which no window owns (#122). The windows move over
// to them next; until then only the tests use them.
#[cfg_attr(not(test), allow(dead_code))]
mod checks;

/// Whether this copy of Redlines can update itself, or why not. The window reads it by name.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Availability {
    Available,
    /// A development or test build, which never replaces itself with a release.
    Development,
    /// The build has no public key to verify updates with (`tauri.conf.json`).
    NotSetUp,
    /// It runs from its disk image, or from the copy macOS makes of an app it hasn't moved (App
    /// Translocation). The copy in an Applications folder updates.
    DiskImage,
    /// It can't replace itself where it is without an administrator.
    ReadOnly,
    /// Releases are built for macOS only, so far.
    Unsupported,
}

/// What decides whether this copy can update itself.
#[derive(Debug, Default)]
pub struct Facts {
    /// Releases with updates are built for this system.
    pub supported: bool,
    /// The release workflow built this copy for a release.
    pub release: bool,
    /// The updater has a public key to verify updates with.
    pub key_set: bool,
    /// It runs from an app bundle, which is what an update replaces (`tauri dev` doesn't).
    pub bundled: bool,
    /// It runs from a disk image, or translocated.
    pub on_image: bool,
    /// It may replace its bundle: it can write the bundle and the folder the bundle is in.
    pub writable: bool,
}

pub fn availability(facts: &Facts) -> Availability {
    if !facts.supported {
        Availability::Unsupported
    } else if !facts.release || !facts.bundled {
        Availability::Development
    } else if !facts.key_set {
        Availability::NotSetUp
    } else if facts.on_image {
        Availability::DiskImage
    } else if !facts.writable {
        Availability::ReadOnly
    } else {
        Availability::Available
    }
}

/// Whether the updater has a public key (`plugins.updater.pubkey` in `tauri.conf.json`). A fork
/// that doesn't sign its releases empties it, and its builds never check for updates.
pub fn key_set(pubkey: Option<&str>) -> bool {
    pubkey.is_some_and(|key| !key.trim().is_empty())
}

/// Whether this copy of Redlines can update itself, or why not.
#[tauri::command]
pub fn update_availability(app: AppHandle) -> Availability {
    availability(&facts(&app))
}

fn facts(app: &AppHandle) -> Facts {
    let config = app.config();
    let pubkey = config
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|key| key.as_str());
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut facts = Facts {
        release: cfg!(redlines_release),
        key_set: key_set(pubkey),
        ..Facts::default()
    };
    #[cfg(target_os = "macos")]
    {
        use crate::install::macos::{running_bundle, translocated_original, writable};

        facts.supported = true;
        if let Some(bundle) = running_bundle() {
            let original = translocated_original(&bundle);
            facts.bundled = true;
            facts.on_image = crate::install::may_be_on_image(&bundle, original.as_deref());
            facts.writable = writable(&bundle) && bundle.parent().is_some_and(writable);
        }
    }
    facts
}

/// What the app is started with again: the program, then the files to open.
pub fn relaunch_args(
    current: &[OsString],
    files: impl IntoIterator<Item = PathBuf>,
) -> Vec<OsString> {
    current
        .iter()
        .take(1)
        .cloned()
        .chain(files.into_iter().map(PathBuf::into_os_string))
        .collect()
}

/// The arguments to start the app with again once it has quit, when `relaunch` asked for it.
#[derive(Default)]
pub struct Relaunch(Mutex<Option<Vec<OsString>>>);

impl Relaunch {
    fn slot(&self) -> std::sync::MutexGuard<'_, Option<Vec<OsString>>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Quits and starts the app again, opening `files`: once an update is installed, the new version
/// opens the documents that were open. The app admits a file it is started with for the window
/// (`offer` in `lib.rs`), so only the files the window may use already are passed on, those the
/// person opened or saved (`file_scope`), and the window can't widen what it may use by naming
/// others.
#[tauri::command]
pub fn relaunch(app: AppHandle, files: Vec<String>) {
    let given = app.fs_scope();
    let files = files
        .into_iter()
        .map(PathBuf::from)
        .filter(|file| crate::file_scope::allowed(&given, file))
        .collect::<Vec<_>>();
    *app.state::<Relaunch>().slot() = Some(relaunch_args(&app.env().args_os, files));
    app.exit(0);
}

/// Starts the app again as it exits, if `relaunch` asked for that.
pub fn relaunch_if_asked(app: &AppHandle) {
    let Some(args) = app.state::<Relaunch>().slot().take() else {
        return;
    };
    let mut env = app.env();
    env.args_os = args;
    app.cleanup_before_exit();
    // On a Mac it opens the app's bundle again, which holds the new version, through Launch
    // Services; it doesn't return.
    tauri::process::restart(&env);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A release build in an Applications folder, which updates itself.
    fn installed() -> Facts {
        Facts {
            supported: true,
            release: true,
            key_set: true,
            bundled: true,
            on_image: false,
            writable: true,
        }
    }

    #[test]
    fn an_installed_release_updates_itself() {
        assert_eq!(availability(&installed()), Availability::Available);
    }

    #[test]
    fn a_development_or_test_build_never_updates_itself() {
        let dev = Facts {
            release: false,
            ..installed()
        };
        assert_eq!(availability(&dev), Availability::Development);
        // `tauri dev` runs the binary outside a bundle: there is nothing to replace.
        let unbundled = Facts {
            bundled: false,
            ..installed()
        };
        assert_eq!(availability(&unbundled), Availability::Development);
    }

    #[test]
    fn a_build_without_the_public_key_never_checks() {
        let facts = Facts {
            key_set: false,
            ..installed()
        };
        assert_eq!(availability(&facts), Availability::NotSetUp);
    }

    #[test]
    fn the_copy_on_the_disk_image_leaves_updating_to_the_installed_copy() {
        let facts = Facts {
            on_image: true,
            writable: false,
            ..installed()
        };
        assert_eq!(availability(&facts), Availability::DiskImage);
    }

    #[test]
    fn a_copy_that_only_an_administrator_could_replace_stays_as_it_is() {
        let facts = Facts {
            writable: false,
            ..installed()
        };
        assert_eq!(availability(&facts), Availability::ReadOnly);
    }

    #[test]
    fn only_the_mac_has_releases_to_update_to() {
        let facts = Facts {
            supported: false,
            ..installed()
        };
        assert_eq!(availability(&facts), Availability::Unsupported);
    }

    #[test]
    fn availability_reaches_the_window_by_name() {
        // src/update-source.ts reads these names.
        let names = [
            Availability::Available,
            Availability::Development,
            Availability::NotSetUp,
            Availability::DiskImage,
            Availability::ReadOnly,
            Availability::Unsupported,
        ]
        .map(|availability| serde_json::to_value(availability).unwrap());
        assert_eq!(
            names,
            [
                "available",
                "development",
                "not-set-up",
                "disk-image",
                "read-only",
                "unsupported"
            ]
            .map(serde_json::Value::from)
        );
    }

    #[test]
    fn an_empty_key_is_no_key() {
        assert!(!key_set(None));
        assert!(!key_set(Some("")));
        assert!(!key_set(Some(" \n")));
        assert!(key_set(Some(MINISIGN_EXAMPLE)));
    }

    /// The example public key from minisign's documentation, base64-encoded as `tauri signer
    /// generate` writes a public key file.
    const MINISIGN_EXAMPLE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEU3NjIwRjE4NDJCNEU4MUYKUldRZjZMUkNHQTlpNTNtbFllY080SXpUNTFUR1Bwdld1Y05TQ2gxQ0JNMFFUYUxuNzNZN0dGTzMK";

    /// Whether `pubkey` is a public key as the updater reads it: a minisign public key file, in
    /// base64 (tauri-plugin-updater's `verify_signature`).
    fn is_public_key(pubkey: &str) -> bool {
        use base64::Engine;

        let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(pubkey.trim()) else {
            return false;
        };
        String::from_utf8(decoded)
            .is_ok_and(|file| minisign_verify::PublicKey::decode(&file).is_ok())
    }

    #[test]
    fn a_public_key_is_told_from_anything_else() {
        assert!(is_public_key(MINISIGN_EXAMPLE));
        assert!(!is_public_key("Set this to the updater's public key"));
        // The key alone, without the file around it, is not what the updater reads.
        assert!(!is_public_key(
            "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3"
        ));
        // A secret key, pasted by mistake, is not a public key.
        assert!(!is_public_key(
            "dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5Cg=="
        ));
    }

    /// The app's configuration, as the updater reads it.
    fn config() -> serde_json::Value {
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap()
    }

    #[test]
    fn the_updater_holds_the_public_key_of_the_release_signing_key() {
        let updater = &config()["plugins"]["updater"];
        let pubkey = updater["pubkey"].as_str().unwrap();
        assert!(
            is_public_key(pubkey),
            "plugins.updater.pubkey in tauri.conf.json must be the contents of the public key \
             file that `pnpm tauri signer generate` writes (docs/releasing.md)"
        );
        // Signatures name the version they were made for (the Tauri CLI writes it), so that an
        // old release can't be passed off as a new one.
        assert_eq!(updater["requireSignedVersion"], true);
    }

    #[test]
    fn the_updater_reads_the_latest_release_of_the_repository() {
        assert_eq!(
            config()["plugins"]["updater"]["endpoints"],
            serde_json::json!([
                "https://github.com/skadauke/redlines/releases/latest/download/latest.json"
            ])
        );
    }

    #[test]
    fn the_version_comes_from_cargo_toml_alone() {
        // tauri.conf.json without a version takes Cargo.toml's, which the build tag and the
        // release workflow read.
        assert!(config().get("version").is_none());
    }

    #[test]
    fn a_relaunch_starts_the_program_with_the_files_alone() {
        // The arguments it was started with, such as a handoff from its disk image, are left out.
        let current = [
            "/Applications/Redlines.app/Contents/MacOS/redlines-desktop",
            "--eject-image",
            "/Volumes/Redlines",
        ]
        .map(OsString::from);
        assert_eq!(
            relaunch_args(&current, [PathBuf::from("/Users/ada/plan.md")]),
            [
                "/Applications/Redlines.app/Contents/MacOS/redlines-desktop",
                "/Users/ada/plan.md"
            ]
            .map(OsString::from)
        );
        assert_eq!(
            relaunch_args(&current, []),
            [OsString::from(
                "/Applications/Redlines.app/Contents/MacOS/redlines-desktop"
            )]
        );
    }
}
