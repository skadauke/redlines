//! What a document window may do with files (#26): read and write the files the person opened or
//! saved, and no others. A file becomes the windows' when the person picks it in an open or save
//! dialog (the dialog plugin allows it), the system hands it to the app (`offer` in `lib.rs`), the
//! sidebar opens it (`project::allow_document`), or the window's document is renamed
//! (`files::rename_file`). By itself, the windows' capability (`capabilities/default.json`) lets
//! them read or write no file at all, and watch none: the app watches a window's document for it,
//! through the document's folder, and only a file the window may use (`watch`).
//!
//! A window says which document it holds (`windows::window_document`), and the app believes it only
//! for a file the window may use: everything else that trusts a window's document, Rename, Reveal
//! in Finder and the sidebar's projects (`project::Projects`), relies on that.
//!
//! The app remembers the documents its windows held last, by the files they really are, and allows
//! them again at its next launch, so that Open Recent and reopening the last document find them.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

use crate::project::Projects;
use crate::windows::Windows;

/// How many documents the app remembers: more than Open Recent's ten (`src/recent.ts`), for the
/// windows that report their documents in another order than the menu lists them.
const REMEMBERED: usize = 50;

/// The file in the app's data folder that holds the remembered documents.
const REMEMBERED_FILE: &str = "documents.json";

/// The documents the windows held last, newest first, and the file they are kept in, if there is
/// a data folder to keep it in.
#[derive(Default)]
pub struct Remembered {
    file: Option<PathBuf>,
    paths: Mutex<Vec<String>>,
}

impl Remembered {
    /// The documents kept in `file`.
    fn load(file: PathBuf) -> Self {
        Self {
            paths: Mutex::new(read_list(&file)),
            file: Some(file),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Vec<String>> {
        self.paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Notes that a window holds the document at `path`.
    fn note(&self, path: &str) {
        let mut paths = self.lock();
        if put_first(&mut paths, path) {
            self.keep(&paths);
        }
    }

    /// Forgets the document at `path`, which is no longer there, such as one renamed away.
    pub fn forget(&self, path: &str) {
        self.forget_all_but(|kept| kept != path);
    }

    /// Forgets every document but those `keep` keeps. It never remembers one more.
    fn forget_all_but(&self, keep: impl Fn(&str) -> bool) {
        let mut paths = self.lock();
        let before = paths.len();
        paths.retain(|kept| keep(kept));
        if paths.len() != before {
            self.keep(&paths);
        }
    }

    /// Keeps the documents for the next launch. Should that fail, the next launch finds fewer of
    /// them, and Open Recent leaves out those it can't open.
    fn keep(&self, paths: &[String]) {
        if let Some(file) = &self.file
            && let Err(error) = write_list(file, paths)
        {
            eprintln!(
                "Redlines can't remember its documents in {}: {error}",
                file.display()
            );
        }
    }
}

/// Puts `path` first in `list`, once, keeping no more than `REMEMBERED`. Says whether the list
/// changed.
fn put_first(list: &mut Vec<String>, path: &str) -> bool {
    if list.first().is_some_and(|first| first == path) {
        return false;
    }
    list.retain(|kept| kept != path);
    list.insert(0, path.to_owned());
    list.truncate(REMEMBERED);
    true
}

/// The documents kept in `file`: none when there is no such file, or it can't be read. Only full
/// paths, which are all a window holds.
fn read_list(file: &Path) -> Vec<String> {
    let Some(serde_json::Value::Array(values)) = std::fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    else {
        return Vec::new();
    };
    values
        .into_iter()
        .filter_map(|value| match value {
            serde_json::Value::String(path) if Path::new(&path).is_absolute() => Some(path),
            _ => None,
        })
        .take(REMEMBERED)
        .collect()
}

fn write_list(file: &Path, paths: &[String]) -> std::io::Result<()> {
    if let Some(folder) = file.parent() {
        std::fs::create_dir_all(folder)?;
    }
    std::fs::write(file, serde_json::to_vec(paths)?)
}

/// The file a path really is, with every link followed, or the path itself when it isn't there.
pub fn real(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Whether `scope` allows the file at `path`, as the file system plugin asks: by the file the path
/// really is.
pub fn allowed(scope: &tauri::fs::Scope, path: &Path) -> bool {
    scope.is_allowed(real(path))
}

/// Whenever a path is allowed, allows the file it really is as well, which is what the file system
/// plugin asks about: the open dialog gives the path the person went through, a link to a folder
/// such as `~/Dropbox` included. Tauri's scope adds that file itself today; this keeps it so.
fn follow_links(scope: &tauri::fs::Scope) {
    let allow = scope.clone();
    scope.listen(move |event| {
        if let tauri::scope::fs::Event::PathAllowed(path) = event
            && let Ok(real) = std::fs::canonicalize(path)
            // The file itself is allowed already, and allowing it again would be heard again.
            && real != *path
            && let Err(error) = allow.allow_file(&real)
        {
            eprintln!("Redlines can't allow {}: {error}", real.display());
        }
    });
}

/// Allows the documents the app remembers, before there is a window to use them, and the file a
/// link names whenever a link is allowed. Without a data folder, it remembers nothing.
pub fn set_up(app: &AppHandle) {
    let remembered = match app.path().app_data_dir() {
        Ok(folder) => Remembered::load(folder.join(REMEMBERED_FILE)),
        Err(error) => {
            eprintln!("Redlines can't remember its documents: {error}");
            Remembered::default()
        }
    };
    let scope = app.fs_scope();
    follow_links(&scope);
    for path in remembered.lock().iter() {
        if let Err(error) = scope.allow_file(path) {
            eprintln!("Redlines can't allow {path} again: {error}");
        }
    }
    app.manage(remembered);
}

/// A window says it holds the document at `path`. Says whether it may: then the app remembers the
/// document, and the sidebar may show its project (`hold`).
pub fn held(app: &AppHandle, path: &str) -> bool {
    hold(
        &app.fs_scope(),
        &app.state::<Remembered>(),
        &app.state::<Projects>(),
        path,
    )
}

/// `held`, with the app's parts: only a file the scope allows is held. It is remembered by the file
/// it really is, so that a link pointed elsewhere by the next launch allows nothing new.
fn hold(
    scope: &tauri::fs::Scope,
    remembered: &Remembered,
    projects: &Projects,
    path: &str,
) -> bool {
    let path = Path::new(path);
    if !allowed(scope, path) {
        return false;
    }
    remembered.note(&real(path).to_string_lossy());
    projects.show(path);
    true
}

/// File › Open Recent › Clear Menu: forgets the remembered documents, but those the windows hold
/// now, so that the next launch doesn't let the windows use them again. They stay allowed until the
/// app quits: taking a file away from the scope would refuse it even when the person opens it again.
#[tauri::command]
pub fn forget_documents(app: AppHandle) {
    let scope = app.fs_scope();
    let open: Vec<String> = app
        .state::<Windows>()
        .documents()
        .iter()
        .map(Path::new)
        .filter(|path| allowed(&scope, path))
        .map(|path| real(path).to_string_lossy().into_owned())
        .collect();
    app.state::<Remembered>()
        .forget_all_but(|kept| open.iter().any(|path| path == kept));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The capabilities of the app's windows, by file name.
    const CAPABILITIES: [(&str, &str); 3] = [
        ("default.json", include_str!("../capabilities/default.json")),
        ("install.json", include_str!("../capabilities/install.json")),
        (
            "preferences.json",
            include_str!("../capabilities/preferences.json"),
        ),
    ];

    /// The permissions of a capability, as `(identifier, the paths of its own scope)`. A permission
    /// written as a plain string has no scope of its own.
    fn permissions(capability: &str) -> Vec<(String, Vec<String>)> {
        let capability: serde_json::Value = serde_json::from_str(capability).unwrap();
        capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|permission| match permission.as_str() {
                Some(identifier) => (identifier.to_owned(), Vec::new()),
                None => (
                    permission["identifier"].as_str().unwrap().to_owned(),
                    permission["allow"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|entry| {
                            entry["path"]
                                .as_str()
                                .or(entry.as_str())
                                .unwrap()
                                .to_owned()
                        })
                        .collect(),
                ),
            })
            .collect()
    }

    /// Whether a permission lets a window change files: the file system plugin's commands that
    /// write, create, remove, rename or open files, and its sets of permissions that write.
    fn writes(identifier: &str) -> bool {
        let Some(name) = identifier.strip_prefix("fs:") else {
            return false;
        };
        name.contains("write")
            || [
                "default",
                "allow-create",
                "allow-open",
                "allow-copy-file",
                "allow-mkdir",
                "allow-remove",
                "allow-rename",
                "allow-truncate",
                "allow-ftruncate",
            ]
            .contains(&name)
    }

    #[test]
    fn a_window_writes_only_to_the_files_it_is_given() {
        for (name, capability) in CAPABILITIES {
            let permissions = permissions(capability);
            // The scope that every file command of the capability shares, writing too.
            let shared: Vec<String> = permissions
                .iter()
                .filter(|(identifier, _)| identifier == "fs:scope")
                .flat_map(|(_, paths)| paths.clone())
                .collect();
            for (identifier, own) in permissions.iter().filter(|(id, _)| writes(id)) {
                let paths: Vec<&String> = shared.iter().chain(own).collect();
                assert!(
                    !paths.iter().any(|path| path.starts_with("$HOME")),
                    "{name}: {identifier} may write to {paths:?}"
                );
                assert!(
                    paths.is_empty(),
                    "{name}: {identifier} may write to {paths:?} by itself"
                );
            }
        }
    }

    #[test]
    fn a_document_window_has_these_file_permissions_and_no_others() {
        let file_permissions = |capability: &str| -> Vec<(String, Vec<String>)> {
            permissions(capability)
                .into_iter()
                .filter(|(identifier, _)| identifier.starts_with("fs:"))
                .collect()
        };
        let none = Vec::<String>::new;
        let (_, default) = CAPABILITIES[0];
        assert_eq!(
            file_permissions(default),
            [
                // The file plugin's denials of the webview's own data.
                ("fs:deny-default".to_owned(), none()),
                // Reading, writing and asking whether a file is there: the files it is given.
                ("fs:allow-read-file".to_owned(), none()),
                ("fs:allow-write-text-file".to_owned(), none()),
                ("fs:allow-exists".to_owned(), none()),
                // No watching: the app watches the document for the window (`watch`), which would
                // otherwise have to be let watch the document's folder.
            ]
        );
        // The install question and Preferences use no files at all.
        for (name, capability) in &CAPABILITIES[1..] {
            assert_eq!(file_permissions(capability), [], "{name}");
        }
    }

    #[test]
    fn a_file_dropped_on_a_window_is_not_given_to_it() {
        // The file plugin otherwise allows whatever is dropped on a window, a folder with all it
        // holds, though the app opens nothing that is dropped.
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["plugins"]["fs"]["scopeDroppedPaths"], false);
    }

    /// A new empty folder for one test.
    fn folder(name: &str) -> PathBuf {
        let folder =
            std::env::temp_dir().join(format!("redlines-file-scope-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn remembers_the_latest_documents_first_and_only_so_many() {
        let mut list = Vec::new();
        assert!(put_first(&mut list, "/docs/a.md"));
        assert!(put_first(&mut list, "/docs/b.md"));
        assert_eq!(list, ["/docs/b.md", "/docs/a.md"]);
        // Already first: nothing changes, and there is nothing to keep.
        assert!(!put_first(&mut list, "/docs/b.md"));
        // Once, wherever it was.
        assert!(put_first(&mut list, "/docs/a.md"));
        assert_eq!(list, ["/docs/a.md", "/docs/b.md"]);
        for n in 0..REMEMBERED {
            put_first(&mut list, &format!("/docs/{n}.md"));
        }
        assert_eq!(list.len(), REMEMBERED);
        assert_eq!(list[0], format!("/docs/{}.md", REMEMBERED - 1));
        assert!(!list.iter().any(|path| path == "/docs/a.md"));
    }

    #[test]
    fn keeps_the_documents_for_the_next_launch() {
        let folder = folder("keeps");
        let file = folder.join("data").join(REMEMBERED_FILE);
        assert!(read_list(&file).is_empty());
        write_list(&file, &["/docs/b.md".to_owned(), "/docs/a.md".to_owned()]).unwrap();
        assert_eq!(read_list(&file), ["/docs/b.md", "/docs/a.md"]);
        std::fs::write(&file, "not json").unwrap();
        assert!(read_list(&file).is_empty());
        // A relative path, or anything but a path, is no document a window held.
        std::fs::write(&file, r#"["/docs/a.md", "plan.md", 7, ""]"#).unwrap();
        assert_eq!(read_list(&file), ["/docs/a.md"]);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn clearing_the_menu_keeps_only_the_documents_the_windows_hold() {
        let folder = folder("clear");
        let file = folder.join(REMEMBERED_FILE);
        let remembered = Remembered::load(file.clone());
        for path in ["/docs/a.md", "/docs/b.md", "/docs/c.md"] {
            remembered.note(path);
        }
        // An open document that isn't remembered stays so: forgetting never adds one.
        let open = ["/docs/b.md", "/docs/new.md"];
        remembered.forget_all_but(|kept| open.contains(&kept));
        assert_eq!(*remembered.lock(), ["/docs/b.md"]);
        assert_eq!(read_list(&file), ["/docs/b.md"]);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    /// The file system plugin's own scope, as the app starts with it: empty, and following links.
    fn scope() -> tauri::fs::Scope {
        let app = tauri::test::mock_app();
        let scope = tauri::fs::Scope::new(
            &app,
            &tauri::utils::config::FsScope::AllowedPaths(Vec::new()),
        )
        .unwrap();
        follow_links(&scope);
        scope
    }

    #[cfg(unix)]
    #[test]
    fn a_file_allowed_through_a_link_is_allowed_as_the_file_it_names() {
        use std::os::unix::fs::symlink;

        let folder = folder("links");
        let cloud = folder.join("CloudStorage/Dropbox");
        std::fs::create_dir_all(&cloud).unwrap();
        for name in ["plan.md", "other.md", "notes.md"] {
            std::fs::write(cloud.join(name), "").unwrap();
        }
        symlink(&cloud, folder.join("Dropbox")).unwrap();
        symlink(cloud.join("notes.md"), folder.join("notes-link.md")).unwrap();
        let scope = scope();
        // As the open dialog gives it: by the path through the link to the folder.
        scope.allow_file(folder.join("Dropbox/plan.md")).unwrap();
        // What the file system plugin asks (`resolve_path`): the file the path really is.
        assert!(scope.is_allowed(std::fs::canonicalize(cloud.join("plan.md")).unwrap()));
        assert!(allowed(&scope, &folder.join("Dropbox/plan.md")));
        assert!(!allowed(&scope, &folder.join("Dropbox/other.md")));
        // As the sidebar allows a link (`project::allow_document`): by the file it names, which
        // the window then reads and writes through the link.
        scope
            .allow_file(std::fs::canonicalize(folder.join("notes-link.md")).unwrap())
            .unwrap();
        assert!(allowed(&scope, &folder.join("notes-link.md")));
        assert!(scope.is_allowed(std::fs::canonicalize(cloud.join("notes.md")).unwrap()));
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_window_holds_only_a_file_the_scope_allows() {
        use std::os::unix::fs::symlink;

        let folder = folder("hold");
        let (notes, ssh) = (folder.join("notes"), folder.join(".ssh"));
        std::fs::create_dir_all(&notes).unwrap();
        std::fs::create_dir_all(&ssh).unwrap();
        std::fs::write(notes.join("plan.md"), "").unwrap();
        std::fs::write(ssh.join("id_ed25519"), "").unwrap();
        symlink(notes.join("plan.md"), folder.join("plan-link.md")).unwrap();
        let scope = scope();
        let remembered = Remembered::load(folder.join(REMEMBERED_FILE));
        let projects = Projects::default();
        let hold = |path: &Path| hold(&scope, &remembered, &projects, &path.to_string_lossy());

        // A file the window wasn't given: not held, not remembered, and no project it shows.
        let key = ssh.join("id_ed25519");
        assert!(!hold(&key));
        assert!(remembered.lock().is_empty());
        assert!(projects.folders().is_empty());
        // So nothing in that hidden folder, with no repository above it, can be read or allowed.
        assert!(crate::project::shown_in(&projects.folders(), &key, false).is_err());

        // A file it was given, through a link: remembered as the file it really is.
        scope.allow_file(notes.join("plan.md")).unwrap();
        assert!(hold(&folder.join("plan-link.md")));
        let real = std::fs::canonicalize(notes.join("plan.md")).unwrap();
        assert_eq!(*remembered.lock(), [real.to_string_lossy()]);
        // The sidebar shows the folder of the path the window holds.
        assert_eq!(projects.folders(), [folder.as_path()]);
        assert!(crate::project::shown_in(&projects.folders(), &key, false).is_err());
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn notes_and_forgets_documents_in_its_file() {
        let folder = folder("notes");
        let file = folder.join(REMEMBERED_FILE);
        let remembered = Remembered::load(file.clone());
        remembered.note("/docs/a.md");
        remembered.note("/docs/b.md");
        assert_eq!(read_list(&file), ["/docs/b.md", "/docs/a.md"]);
        // A file renamed away is no longer there to use.
        remembered.forget("/docs/b.md");
        assert_eq!(read_list(&file), ["/docs/a.md"]);
        remembered.forget("/docs/missing.md");
        // The next launch starts from what was kept.
        assert_eq!(*Remembered::load(file).lock(), ["/docs/a.md"]);
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
