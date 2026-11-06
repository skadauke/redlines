use std::fmt::Display;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

// Agents' own programs, and the private line between a running agent and the open document. Only
// a system with process groups and Unix sockets has them.
#[cfg(unix)]
mod agents;

// Which build this is, for About Redlines. `build.rs` makes the tag; the app only reads it.
#[cfg(test)]
mod build_tag;

// The `redlines` command line, linked into ~/.local/bin from Preferences.
mod command_line;

// The menu model's shortcuts, which the menu bar must be able to parse.
#[cfg(test)]
mod menu_accelerators;

// The running app's icon: a different mark of the icon family at every launch.
mod dock_icon;

// Only macOS installs from a disk image; elsewhere the module is built for its tests alone.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod install;

// The project around a document: the folder the file sidebar shows and an agent may read.
mod project;

// What a window may do with files: read and write those the person opened or saved.
mod file_scope;

// Whether this copy can update itself, and starting the new version after an update.
mod updates;

// Renaming a file, showing it in Finder, and printing the window.
mod files;

// One document per window: opening windows, which window a file goes to, and quitting.
mod windows;

/// What About Redlines shows: the app's name, and its build tag in two parts, the version and the
/// build (`build_tag.rs`). The window reads the fields by name.
#[derive(Debug, Serialize)]
struct About {
    name: String,
    version: &'static str,
    build: &'static str,
}

#[tauri::command]
fn about(app: AppHandle) -> About {
    About {
        name: app.package_info().name.clone(),
        version: env!("REDLINES_VERSION"),
        build: env!("REDLINES_BUILD"),
    }
}

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

/// A file the app was asked to open: where it is, and why the window may not use it, when it may
/// not. The window reads both fields by name.
#[derive(Debug, PartialEq, Serialize)]
struct OpenedFile {
    path: String,
    error: Option<String>,
}

/// Files the app was asked to open, on its command line or by the system (`open -a Redlines
/// plan.md`), until there is a window to give them to (`windows::deliver`).
#[derive(Default)]
struct Opened(Mutex<Vec<OpenedFile>>);

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

/// Lets the window use each file by asking `allow`, and says what became of each. A file that
/// `allow` refuses is not dropped: the reason goes to stderr, and with the file to the window,
/// which tells the person.
fn admit<E: Display>(
    files: Vec<PathBuf>,
    mut allow: impl FnMut(&Path) -> Result<(), E>,
) -> Vec<OpenedFile> {
    files
        .into_iter()
        .map(|file| {
            let error = allow(&file).err().map(|error| {
                eprintln!("Redlines can't use {}: {error}", file.display());
                error.to_string()
            });
            OpenedFile {
                path: file.to_string_lossy().into_owned(),
                error,
            }
        })
        .collect()
}

/// Keeps files for the windows and lets them read, write and watch them wherever they are, as the
/// open dialog does for the file it picks. Each file goes to one window, once there is one.
fn offer(app: &AppHandle, files: Vec<PathBuf>) {
    if files.is_empty() {
        return;
    }
    let scope = app.fs_scope();
    let admitted = admit(files, |file| scope.allow_file(file));
    app.state::<Opened>()
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .extend(admitted);
    windows::deliver(app);
}

/// The file a path really is, with every link in it followed. The `redlines` command line follows
/// links too, so it writes that file, in its folder and under its name, which is where the window
/// has to look for changes to a file it opened through a link.
#[tauri::command(async)]
fn real_path(path: String) -> Result<String, String> {
    std::fs::canonicalize(&path)
        .map(|real| real.to_string_lossy().into_owned())
        .map_err(|error| format!("{path}: {error}"))
}

/// Opens the Preferences window, or brings it forward: there is only ever one. It is made hidden,
/// and shows itself once its page is styled (`src/preferences/main.ts`).
#[tauri::command]
fn open_preferences(app: AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("preferences") {
        window.show()?;
        return window.set_focus();
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "preferences")
        .ok_or(tauri::Error::WindowNotFound)?;
    tauri::WebviewWindowBuilder::from_config(&app, config)?.build()?;
    Ok(())
}

/// Starts the app. The desktop binary calls this from `main`; mobile builds start here directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Reads the clipboard's text for Paste as Plain Text (the menu is not a gesture in the page).
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(dock_icon::init())
        .manage(Opened::default())
        .manage(install::InstallAnswer::default())
        .manage(updates::Relaunch::default())
        .manage(windows::Windows::default())
        .manage(project::Projects::default())
        .setup(|app| {
            // The documents the windows held last are theirs again, for Open Recent.
            file_scope::set_up(app.handle());
            // The preview loads the images of the project folders the sidebars show, and no others.
            let handle = app.handle().clone();
            app.state::<project::Projects>()
                .on_new_folder(move |folder, whole| {
                    let scope = handle.asset_protocol_scope();
                    // The folder as named, and as it really is, which a link to it hides.
                    let real = std::fs::canonicalize(folder).ok();
                    for path in std::iter::once(folder).chain(real.as_deref()) {
                        if let Err(error) = scope.allow_directory(path, whole) {
                            eprintln!("Redlines can't show images in {}: {error}", path.display());
                        }
                    }
                });
            #[cfg(unix)]
            agents::set_up(app.handle());
            // Quitting from the Dock, or logging out, asks about unsaved edits too.
            #[cfg(target_os = "macos")]
            windows::macos::answer_should_terminate(app.handle());
            // An install that crashed leaves a hidden folder in an Applications folder.
            #[cfg(target_os = "macos")]
            install::macos::clean_up_after_crashed_install(app.handle());
            // A copy that has just installed itself from a disk image ejects the image once the
            // copy on the image has quit; the rest of its arguments are files, as usual.
            #[cfg(target_os = "macos")]
            let args =
                install::macos::eject_after_handoff(app.handle(), std::env::args_os().skip(1));
            #[cfg(not(target_os = "macos"))]
            let args = std::env::args_os().skip(1);
            offer(app.handle(), files_in(args));
            // Started from a disk image, the app asks to install itself first, and opens the
            // window after the answer if it keeps running.
            #[cfg(target_os = "macos")]
            if install::macos::offer_install(app.handle()) {
                return Ok(());
            }
            windows::open_main_window(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            identity,
            real_path,
            files::rename_file,
            files::reveal_in_finder,
            files::print_window,
            about,
            open_preferences,
            command_line::install_command_line,
            install::answer_install,
            project::project_root,
            project::list_folder,
            project::open_default,
            project::show_images,
            project::allow_document,
            project::read_project_file,
            file_scope::forget_documents,
            updates::update_availability,
            updates::relaunch,
            windows::opened_files,
            windows::open_window,
            windows::window_start,
            windows::window_document,
            windows::document_windows,
            windows::quit_all,
            windows::keep_running,
            #[cfg(unix)]
            agents::agent_which,
            #[cfg(unix)]
            agents::agent_exec,
            #[cfg(unix)]
            agents::agent_start,
            #[cfg(unix)]
            agents::agent_stop,
            #[cfg(unix)]
            agents::agent_logs_open,
            #[cfg(unix)]
            agents::acp_agents,
            #[cfg(unix)]
            agents::acp_agent_add,
            #[cfg(unix)]
            agents::acp_agent_remove,
            #[cfg(unix)]
            agents::acp_start,
            #[cfg(unix)]
            agents::acp_send,
            #[cfg(unix)]
            agents::relay::relay_open,
            #[cfg(unix)]
            agents::relay::relay_answer,
            #[cfg(unix)]
            agents::relay::relay_close
        ])
        .on_window_event(|window, event| {
            // A closed window's runs have nowhere left to report, and no document to act on.
            #[cfg(unix)]
            if matches!(event, tauri::WindowEvent::Destroyed) {
                agents::window_closed(window.app_handle(), window.label());
            }
            #[cfg(not(unix))]
            let _ = (window, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building Redlines")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent { label, event, .. } = &event {
                windows::on_window_event(app, label, event);
            }
            // Quitting while the app asks whether to install takes the question away with it.
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Exit) {
                install::macos::dismiss_alert();
            }
            // Nothing an agent started outlives the app. Every way of quitting ends here: the menu's
            // Quit through `quit_all`, and the Dock or a logout once AppKit has its answer.
            #[cfg(unix)]
            if matches!(event, tauri::RunEvent::Exit) {
                agents::quitting(app);
            }
            // After an update is installed, the new version starts as this one quits.
            if matches!(event, tauri::RunEvent::Exit) {
                updates::relaunch_if_asked(app);
            }
            // Closing the install question's window, its only window then, doesn't quit the app:
            // the app's own window opens next. (Quitting asks with a code, or not at all.)
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = &event
                && install::macos::asking()
            {
                api.prevent_exit();
            }
            // Finder, the Dock and `open -a Redlines plan.md` hand files to a running app.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                offer(
                    app,
                    files_in(urls.iter().filter_map(|url| url.to_file_path().ok())),
                );
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_is_built_with_its_build_tag() {
        // The version from Cargo.toml, and the commit; a build that isn't a release (as the tests
        // usually are) adds -dev and the time it was built.
        let (version, build) = (env!("REDLINES_VERSION"), env!("REDLINES_BUILD"));
        let shaped = |text: &str, length: usize, digit: fn(&u8) -> bool| {
            text.len() == length && text.as_bytes().iter().all(digit)
        };
        let (commit, time) = if cfg!(redlines_release) {
            assert_eq!(version, env!("CARGO_PKG_VERSION"));
            (build, None)
        } else {
            assert_eq!(version, format!("{}-dev", env!("CARGO_PKG_VERSION")));
            let (commit, time) = build.split_once('-').unwrap();
            (commit, Some(time))
        };
        assert!(
            commit == "unknown" || shaped(commit, 7, u8::is_ascii_hexdigit),
            "{build}"
        );
        if let Some(time) = time {
            let (date, minutes) = time.split_once('.').unwrap();
            assert!(
                shaped(date, 8, u8::is_ascii_digit) && shaped(minutes, 4, u8::is_ascii_digit),
                "{build}"
            );
        }
    }

    #[test]
    fn about_reaches_the_window_by_name() {
        // src/about.ts reads these fields.
        let about = About {
            name: "Redlines".to_owned(),
            version: "0.1.0",
            build: "1a2b3c4",
        };
        assert_eq!(
            serde_json::to_value(about).unwrap(),
            serde_json::json!({ "name": "Redlines", "version": "0.1.0", "build": "1a2b3c4" })
        );
    }

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

    #[cfg(unix)]
    #[test]
    fn real_path_follows_a_link_to_the_file_it_names() {
        use std::os::unix::fs::symlink;

        let folder =
            std::env::temp_dir().join(format!("redlines-real-path-{}", std::process::id()));
        let (notes, work) = (folder.join("notes"), folder.join("work"));
        std::fs::create_dir_all(&notes).unwrap();
        std::fs::create_dir_all(&work).unwrap();
        let real = work.join("real-2026.md");
        std::fs::write(&real, "# Plan\n").unwrap();
        let real = std::fs::canonicalize(&real).unwrap();
        // Links as `ln -s` makes them: one to a file in another folder, one by a relative path.
        symlink(&real, notes.join("plan.md")).unwrap();
        symlink("../work/real-2026.md", notes.join("relative.md")).unwrap();

        let real_of = |path: PathBuf| real_path(path.to_string_lossy().into_owned());
        let expected = Ok(real.to_string_lossy().into_owned());
        assert_eq!(real_of(notes.join("plan.md")), expected);
        assert_eq!(real_of(notes.join("relative.md")), expected);
        // A file that is not a link is itself, as it really is.
        assert_eq!(real_of(real.clone()), expected);
        // What isn't there is an error, not the path again.
        assert!(real_of(notes.join("missing.md")).is_err());
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn admit_tells_the_window_of_a_file_it_could_not_allow_and_keeps_the_rest() {
        let (plan, notes) = (
            PathBuf::from("/docs/plan.md"),
            PathBuf::from("/docs/notes.md"),
        );
        let admitted = admit(vec![plan, notes.clone()], |file| {
            if file == notes {
                Err("the path can't be allowed")
            } else {
                Ok(())
            }
        });
        assert_eq!(
            admitted,
            vec![
                OpenedFile {
                    path: "/docs/plan.md".to_owned(),
                    error: None
                },
                OpenedFile {
                    path: "/docs/notes.md".to_owned(),
                    error: Some("the path can't be allowed".to_owned())
                },
            ]
        );
    }

    #[test]
    fn an_opened_file_reaches_the_window_as_a_path_and_an_error_or_null() {
        // The window reads these fields by name (host.ts).
        let allowed = OpenedFile {
            path: "/docs/plan.md".to_owned(),
            error: None,
        };
        let refused = OpenedFile {
            path: "/docs/notes.md".to_owned(),
            error: Some("no".to_owned()),
        };
        assert_eq!(
            serde_json::to_value([allowed, refused]).unwrap(),
            serde_json::json!([
                { "path": "/docs/plan.md", "error": null },
                { "path": "/docs/notes.md", "error": "no" },
            ])
        );
    }
}
