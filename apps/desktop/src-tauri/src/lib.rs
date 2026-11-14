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

// The `redlines` command line, linked into /usr/local/bin from Preferences, or into ~/.local/bin.
mod command_line;

// The menu model's shortcuts, which the menu bar must be able to parse.
#[cfg(test)]
mod menu_accelerators;

// The documents the app's bundle declares, which Finder's Open With offers Redlines for.
#[cfg(test)]
mod document_types;

// The running app's icon: a different mark of the icon family at every launch.
mod dock_icon;

// The default app for Markdown files, which Preferences makes Redlines. Only macOS is asked;
// elsewhere the module refuses, and its decisions are built for their tests.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod default_app;

// Spell checking while typing, which WebKit on the Mac does only when the app's defaults say so.
mod spelling;

// Opening a link in the default browser, for a ⌘-click on a link in a document.
mod links;

// The appearance of every window, light, dark or the system's, which the app keeps a copy of.
mod appearance;

// Only macOS installs from a disk image; elsewhere the module is built for its tests alone.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod install;

// The project around a document: the folder the file sidebar shows and an agent may read.
mod project;

// The images the preview loads: those of the project folders the sidebars show.
mod images;

// Images added to a document: dropped on its window, chosen in a panel or pasted, saved beside it.
mod image_files;

// What a window may do with files: read and write those the person opened or saved.
mod file_scope;

// The app's updates, which no window owns: the checks, the download and the install, whether this
// copy can update itself, and starting the new version after an update.
mod updates;

// Renaming a file, showing it in Finder, and printing the window.
mod files;

// Dragging the window's file out of it, from the title bar's document icon.
mod drag;

// The Mac's settings pane for the Quick Look preview of Markdown files, which Preferences opens.
mod quick_look;

// One document per window: opening windows, which window a file goes to, and quitting.
mod windows;

// Undo and Redo in a text field, for the Edit menu's items.
mod edit_menu;

// The window zoom, which the app keeps and sets on every window.
mod zoom;

// Watching each window's document for changes made elsewhere, for the window.
mod watch;

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

/// Whether a file dropped on the window `label` goes on to the windows (`offer`): when the windows
/// take it (`Windows::dropped_on`), and it isn't the file this window's own icon dragged out,
/// which the person let go of on it (`drag.rs`).
fn drop_is_offered(windows: &windows::Windows, label: &str, dropped: &[PathBuf]) -> bool {
    !drag::ignores_drop(label, dropped) && windows.dropped_on(label, dropped)
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

/// What was dropped on a window that is there, by full paths: its files, and its folders too,
/// which Redlines doesn't open, and says so (`allow_if_document`).
fn dropped_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    paths
        .into_iter()
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

/// Lets the window use `file` by asking `allow`, if it is a document. Any other file is no file of
/// Redlines', nor is a folder, whatever its name: the window may never read it, and says so, in
/// the line it is refused with (`project::NOT_A_DOCUMENT`).
fn allow_if_document<E: Display>(
    file: &Path,
    allow: impl FnOnce(&Path) -> Result<(), E>,
) -> Result<(), String> {
    if file.is_dir() || !project::is_document(file) {
        return Err(project::NOT_A_DOCUMENT.to_owned());
    }
    allow(file).map_err(|error| error.to_string())
}

/// Keeps files for the windows and lets them read, write and have them watched wherever they are,
/// as the open dialog does for the file it picks: documents alone (`allow_if_document`). Each file
/// goes to one window, once there is one.
fn offer(app: &AppHandle, files: Vec<PathBuf>) {
    if files.is_empty() {
        return;
    }
    let scope = app.fs_scope();
    let admitted = admit(files, |file| {
        allow_if_document(file, |file| scope.allow_file(file))
    });
    app.state::<Opened>()
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .extend(admitted);
    windows::deliver(app);
}

/// The file a path really is, with every link in it followed. The `redlines` command line follows
/// links too, so it writes that file, in its folder and under its name, which is where the window
/// has to look for changes to a file it opened through a link. Only for a file the person opened or
/// saved, and what is inside a project folder a sidebar shows (`file_scope::known_real`).
#[tauri::command(async)]
fn real_path(app: AppHandle, path: String) -> Result<String, String> {
    let shown = app.state::<project::Projects>().folders();
    file_scope::known_real(&app.fs_scope(), &shown, Path::new(&path))
        .map(|real| real.to_string_lossy().into_owned())
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
    // It opens at the size the zoom gives it, so that it never resizes in view.
    let (width, height) = zoom::preferences_inner_size(&app);
    let window = tauri::WebviewWindowBuilder::from_config(&app, config)?
        .initialization_script(zoom::init_script(&app))
        .inner_size(width, height)
        .build()?;
    zoom::apply(&window);
    Ok(())
}

/// Opens the About Redlines window, or brings it forward: there is only ever one. It is a small
/// window of the app's own, as Preferences is, with the icon, the name, the version and build, and
/// the copyright; it is made hidden, and shows itself once its page is styled (`src/about/main.ts`).
/// It takes no zoom: like the install question, it is a fixed size. It runs off the main thread, as
/// a command that makes a window should, and one call at a time, so that a second click on About
/// finds the window the first is making.
#[tauri::command(async)]
fn open_about(app: AppHandle) -> tauri::Result<()> {
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());
    let _turn = ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(window) = app.get_webview_window(windows::ABOUT_WINDOW) {
        window.show()?;
        return window.set_focus();
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == windows::ABOUT_WINDOW)
        .ok_or(tauri::Error::WindowNotFound)?;
    tauri::WebviewWindowBuilder::from_config(&app, config)?.build()?;
    Ok(())
}

/// Starts the app. The desktop binary calls this from `main`; mobile builds start here directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Spelling is checked while typing: WebKit reads its switch once, before the first window.
    spelling::register_defaults();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Reads the clipboard's text for Paste as Plain Text (the menu is not a gesture in the page).
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(dock_icon::init())
        // The preview's images, at the URLs the page makes for them, which the app serves itself
        // from the project folders the sidebars show (images.rs).
        .plugin(images::init())
        .manage(Opened::default())
        .manage(install::InstallAnswer::default())
        .manage(updates::Relaunch::default())
        .manage(windows::Windows::default())
        .manage(zoom::Zoom::default())
        .manage(project::Projects::default())
        .manage(image_files::ImageSources::default())
        .manage(watch::Watches::default())
        .setup(|app| {
            // The appearance first, light, dark or the system's: every window opens in it.
            appearance::set_up(app.handle());
            // The zoom too, before a window opens: every window starts at it.
            zoom::set_up(app.handle());
            // The documents the windows held last are theirs again, for Open Recent.
            file_scope::set_up(app.handle());
            // The updates are the app's, there before any window asks of them.
            updates::set_up(app.handle());
            // The preview loads the images of the project folders the sidebars show, and no others.
            images::set_up(app.handle())?;
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
            files::folder_exists,
            files::choose_folder,
            drag::start_file_drag,
            about,
            appearance::set_appearance,
            edit_menu::beep,
            spelling::correct_word,
            spelling::spelling_suggestions,
            spelling::spelling_learn,
            edit_menu::undo_in_field,
            edit_menu::paste_in_field,
            open_preferences,
            open_about,
            dock_icon::app_icon_mark,
            dock_icon::show_app_icon_mark,
            zoom::set_zoom,
            zoom::zoom_level,
            command_line::install_command_line,
            command_line::install_command_line_at_home,
            default_app::default_app,
            default_app::make_default_app,
            quick_look::open_quick_look_settings,
            quick_look::quick_look_available,
            install::answer_install,
            project::project_root,
            project::list_folder,
            project::open_default,
            links::open_link,
            project::show_images,
            project::allow_document,
            image_files::pick_images,
            image_files::add_images,
            image_files::add_pasted_image,
            file_scope::forget_documents,
            updates::update_state,
            updates::update_set_automatic,
            updates::update_check,
            updates::update_install,
            updates::update_dismiss,
            updates::relaunch,
            windows::opened_files,
            windows::open_window,
            windows::window_start,
            windows::window_document,
            windows::document_windows,
            windows::quit_all,
            windows::keep_running,
            watch::watch_document,
            watch::unwatch_document,
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
            agents::agent_home_reach,
            #[cfg(unix)]
            agents::agent_home_access,
            #[cfg(unix)]
            agents::open_files_and_folders_settings,
            #[cfg(unix)]
            agents::agent_update,
            #[cfg(unix)]
            agents::agent_sign_in,
            #[cfg(unix)]
            agents::agent_setup_stop,
            #[cfg(unix)]
            agents::agent_terminal_sign_in,
            #[cfg(unix)]
            agents::skill_status,
            #[cfg(unix)]
            agents::skill_install,
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
        .on_page_load(|webview, payload| {
            // A window's page that loads again, as a reload does, watches what it needs itself.
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                watch::page_loaded(webview.app_handle(), webview.label());
            }
        })
        .on_window_event(|window, event| {
            // A window opened for text can't be asked about it in its first moments: its close waits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                windows::close_requested(window.app_handle(), window.label(), api);
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                // A closed window's document is watched for nobody.
                watch::window_closed(window.app_handle(), window.label());
                // Its spell document, which the checker kept for the corrections of its Returns.
                spelling::window_closed(window.label());
                // The images dropped on it or chosen for it that it never took.
                image_files::window_closed(window.app_handle(), window.label());
                // A closed window's runs have nowhere left to report, and no document to act on.
                #[cfg(unix)]
                agents::window_closed(window.app_handle(), window.label());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Redlines")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent { label, event, .. } = &event {
                windows::on_window_event(app, label, event);
            }
            // A file dropped on a document window opens as one from Finder does, with that window
            // in front: in it while it is untouched, and otherwise in a window of its own. Image
            // files alone, though, are the window's to add to its document, wherever they landed
            // (image_files.rs), and open nothing.
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }),
                ..
            } = &event
            {
                let dropped = dropped_paths(paths.iter().cloned());
                if drop_is_offered(&app.state::<windows::Windows>(), label, &dropped)
                    && !image_files::dropped(app, label, &dropped, *position)
                {
                    offer(app, dropped);
                }
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
    fn the_file_a_window_dragged_out_is_not_offered_when_it_is_dropped_back_on_it() {
        let _turn = drag::take_turn();
        let dir = std::env::temp_dir().join(format!("redlines-drop-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("plan.md");
        std::fs::write(&file, "mine").unwrap();
        let windows = windows::Windows::with_document("doc-1", file.to_str().unwrap());
        let dropped = vec![file.clone()];
        drag::forget();
        // The file dropped on the window, with no drag of it going, is a drop like Finder's.
        assert!(drop_is_offered(&windows, "doc-1", &dropped));
        // While the window's own icon drags it, and just after, it is not.
        drag::remember("doc-1", &file);
        assert!(!drop_is_offered(&windows, "doc-1", &dropped));
        // Another window's drop of it is.
        let other = windows::Windows::with_document("doc-2", file.to_str().unwrap());
        assert!(drop_is_offered(&other, "doc-2", &dropped));
        drag::forget();
        assert!(drop_is_offered(&windows, "doc-1", &dropped));
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
    fn a_file_given_to_the_app_is_let_in_only_when_it_is_a_document() {
        let asked = std::cell::RefCell::new(Vec::<PathBuf>::new());
        let files = [
            "/docs/plan.md",
            "/docs/notes.TXT",
            "/docs/logo.png",
            "/docs/main.ts",
            "/docs/Makefile",
        ]
        .map(PathBuf::from)
        .to_vec();
        let admitted = admit(files, |file| {
            allow_if_document(file, |file| {
                asked.borrow_mut().push(file.to_path_buf());
                Ok::<(), String>(())
            })
        });
        let not_a_document = Some("Redlines opens Markdown and text files.".to_owned());
        assert_eq!(
            admitted
                .into_iter()
                .map(|file| file.error)
                .collect::<Vec<_>>(),
            [
                None,
                None,
                not_a_document.clone(),
                not_a_document.clone(),
                not_a_document
            ]
        );
        // The others are never let in: the window may not read them.
        assert_eq!(
            asked.into_inner(),
            [
                PathBuf::from("/docs/plan.md"),
                PathBuf::from("/docs/notes.TXT")
            ]
        );
    }

    #[test]
    fn a_dropped_folder_is_refused_as_a_file_that_isnt_a_document_is() {
        let folder = std::env::temp_dir().join(format!("redlines-dropped-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        for name in ["notes.md", "Archive"] {
            std::fs::create_dir_all(folder.join(name)).unwrap();
        }
        std::fs::write(folder.join("plan.md"), "# Plan\n").unwrap();
        std::fs::write(folder.join("logo.png"), "").unwrap();
        let real = |name: &str| std::fs::canonicalize(folder.join(name)).unwrap();
        let dropped = dropped_paths(
            ["plan.md", "notes.md", "Archive", "logo.png", "gone.md"].map(|name| folder.join(name)),
        );
        // What is there, by its full path, files and folders alike.
        assert_eq!(
            dropped,
            ["plan.md", "notes.md", "Archive", "logo.png"].map(real)
        );
        let admitted = admit(dropped, |file| {
            allow_if_document(file, |_| Ok::<(), String>(()))
        });
        let not_a_document = Some("Redlines opens Markdown and text files.".to_owned());
        // A folder is no document, whatever its name.
        assert_eq!(
            admitted
                .into_iter()
                .map(|file| file.error)
                .collect::<Vec<_>>(),
            [
                None,
                not_a_document.clone(),
                not_a_document.clone(),
                not_a_document
            ]
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_document_the_window_may_not_use_says_why() {
        let refused = allow_if_document(Path::new("/docs/plan.md"), |_| {
            Err("the path can't be allowed")
        });
        assert_eq!(refused, Err("the path can't be allowed".to_owned()));
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
