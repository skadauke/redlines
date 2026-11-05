//! The project around a document (v0.2 design: The file sidebar, and Scope): the folder an agent
//! may read, which the file sidebar shows. It is the repository root when the document is in a git
//! repository, and otherwise the document's own folder. Finding it, and listing it as git would,
//! with what `.gitignore` ignores left out, needs no git: the `ignore` crate reads the ignore files.

use std::path::Path;

use serde::Serialize;

/// The folder an agent may read for a document. The window reads the fields by name.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRoot {
    folder: String,
    is_repo: bool,
    /// The home folder or the disk's root: an agent gets only the document, and the sidebar lists
    /// the document's own folder.
    too_broad: bool,
}

/// A file or folder in the sidebar. The window reads the fields by name.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// The project folder of the file at `document`, given the home folder: the nearest folder above
/// it holding a `.git`, which is a file in a worktree, or else the document's own folder. The folder
/// is one of the document's path as given, so that the sidebar can find the document in it.
pub fn root_of(document: &Path, home: Option<&Path>) -> ProjectRoot {
    let own = document.parent().unwrap_or(document);
    let repo = own
        .ancestors()
        .find(|folder| folder.join(".git").symlink_metadata().is_ok());
    let folder = repo.unwrap_or(own);
    ProjectRoot {
        folder: folder.to_string_lossy().into_owned(),
        is_repo: repo.is_some(),
        too_broad: folder.parent().is_none() || home.is_some_and(|home| same(folder, home)),
    }
}

/// Whether two paths are the same folder, whatever links either goes through.
fn same(one: &Path, other: &Path) -> bool {
    one == other
        || matches!(
            (std::fs::canonicalize(one), std::fs::canonicalize(other)),
            (Ok(one), Ok(other)) if one == other
        )
}

/// The entries of `folder`, which must be inside the project folder `root`, links followed: hidden
/// ones, and those that git ignores, left out. Only this one folder is read, so a large folder
/// further down costs nothing until it is opened.
pub fn list(root: &Path, folder: &Path) -> Result<Vec<FileEntry>, String> {
    let cannot = |error: std::io::Error| format!("Can’t read {}: {error}", folder.display());
    let real_root = std::fs::canonicalize(root).map_err(cannot)?;
    let real_folder = std::fs::canonicalize(folder).map_err(cannot)?;
    if !real_folder.starts_with(&real_root) {
        return Err(format!(
            "{} isn’t inside {}",
            folder.display(),
            root.display()
        ));
    }
    // Errors reading the folder itself say so; the walk below would only leave its entries out.
    std::fs::read_dir(&real_folder).map_err(cannot)?;
    let mut entries: Vec<FileEntry> = ignore::WalkBuilder::new(folder)
        .max_depth(Some(1))
        // Only git's own ignore files, not the `.ignore` files of other tools.
        .ignore(false)
        .build()
        // An entry that can't be read, or an ignore file with a bad line, leaves out only itself.
        .filter_map(Result::ok)
        .filter(|entry| entry.depth() == 1)
        .map(|entry| FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            // Through a link, as the folder it names; a link that goes nowhere is only a name.
            is_dir: std::fs::metadata(entry.path()).is_ok_and(|metadata| metadata.is_dir()),
        })
        .collect();
    entries.sort_by(|one, other| one.name.cmp(&other.name));
    Ok(entries)
}

/// The extensions, lowercase, of files that the Mac runs when they are opened rather than showing
/// them, whatever their permissions: shell scripts for Terminal, Terminal's own settings, which can
/// hold a command, Java programs, and links to a file, which may be a program.
const RUN_WHEN_OPENED: &[&str] = &["command", "tool", "terminal", "jar", "fileloc"];

/// Whether the file at `path` may be opened in its default app: a file, and not a program, which
/// opening would run. An app is a folder.
fn openable(path: &Path) -> Result<(), String> {
    let name = path
        .file_name()
        .map_or_else(|| path.to_string_lossy(), |name| name.to_string_lossy());
    let metadata = std::fs::metadata(path)
        .ok()
        .filter(|_| path.is_absolute())
        .filter(std::fs::Metadata::is_file)
        .ok_or_else(|| format!("Couldn’t open “{name}”."))?;
    #[cfg(unix)]
    let executable = {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    };
    #[cfg(not(unix))]
    let executable = {
        let _ = metadata;
        false
    };
    let runs = path.extension().is_some_and(|extension| {
        let extension = extension.to_string_lossy().to_lowercase();
        RUN_WHEN_OPENED.contains(&extension.as_str())
    });
    if executable || runs {
        return Err(format!(
            "“{name}” is a program, so Redlines doesn’t open it."
        ));
    }
    Ok(())
}

/// The program that opens a file in its default app.
#[cfg(target_os = "macos")]
const OPENER: &str = "open";
#[cfg(not(target_os = "macos"))]
const OPENER: &str = "xdg-open";

/// The project folder of the document at `path` (`root_of`).
#[tauri::command(async)]
pub fn project_root(path: String) -> ProjectRoot {
    root_of(Path::new(&path), std::env::home_dir().as_deref())
}

/// The entries of a folder inside the project folder `root` (`list`).
#[tauri::command(async)]
pub fn list_folder(root: String, folder: String) -> Result<Vec<FileEntry>, String> {
    list(Path::new(&root), Path::new(&folder))
}

/// Opens a file in the app the system opens it with, such as an image or a PDF. Fails with a line
/// to show the person.
#[tauri::command(async)]
pub fn open_default(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    openable(path)?;
    let opened = std::process::Command::new(OPENER)
        .arg(path)
        .status()
        .is_ok_and(|status| status.success());
    if opened {
        Ok(())
    } else {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        Err(format!("Couldn’t open “{name}”."))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::{PermissionsExt, symlink};
    use std::path::PathBuf;

    /// A new empty folder for one test.
    fn folder(name: &str) -> PathBuf {
        let folder =
            std::env::temp_dir().join(format!("redlines-project-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    /// Writes each file, making its folders; a name ending in `/` is an empty folder.
    fn make(at: &Path, files: &[&str]) {
        for file in files {
            let path = at.join(file);
            if file.ends_with('/') {
                fs::create_dir_all(&path).unwrap();
            } else {
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(&path, "").unwrap();
            }
        }
    }

    fn root(folder: &Path, is_repo: bool, too_broad: bool) -> ProjectRoot {
        ProjectRoot {
            folder: folder.to_string_lossy().into_owned(),
            is_repo,
            too_broad,
        }
    }

    /// The names `list` gives, each folder's with a `/` after it.
    fn names(root: &Path, folder: &Path) -> Vec<String> {
        list(root, folder)
            .unwrap()
            .into_iter()
            .map(|entry| {
                assert_eq!(Path::new(&entry.path), folder.join(&entry.name));
                if entry.is_dir {
                    format!("{}/", entry.name)
                } else {
                    entry.name
                }
            })
            .collect()
    }

    #[test]
    fn the_root_of_a_document_in_a_repository_is_the_repository() {
        let repo = folder("repo");
        make(&repo, &[".git/", "docs/notes/plan.md"]);
        let home = repo.parent().unwrap();
        assert_eq!(
            root_of(&repo.join("docs/notes/plan.md"), Some(home)),
            root(&repo, true, false)
        );
        // The root is found from the path as given, which the sidebar compares with the document's.
        assert_eq!(
            root_of(&repo.join("plan.md"), Some(home)).folder,
            repo.to_string_lossy()
        );
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn a_git_file_marks_a_repository_too_as_in_a_worktree() {
        let worktree = folder("worktree");
        fs::write(
            worktree.join(".git"),
            "gitdir: /elsewhere/.git/worktrees/w\n",
        )
        .unwrap();
        make(&worktree, &["docs/design.md"]);
        assert_eq!(
            root_of(&worktree.join("docs/design.md"), None),
            root(&worktree, true, false)
        );
        fs::remove_dir_all(&worktree).unwrap();
    }

    #[test]
    fn outside_a_repository_the_root_is_the_documents_own_folder() {
        let notes = folder("notes");
        make(&notes, &["trip/plan.md"]);
        assert_eq!(
            root_of(&notes.join("trip/plan.md"), None),
            root(&notes.join("trip"), false, false)
        );
        fs::remove_dir_all(&notes).unwrap();
    }

    #[test]
    fn the_home_folder_and_the_disks_root_are_too_broad() {
        let home = folder("home");
        make(&home, &["plan.md", "notes/plan.md"]);
        assert_eq!(
            root_of(&home.join("plan.md"), Some(&home)),
            root(&home, false, true)
        );
        // A repository at home, as some keep their settings in, is too broad as well.
        make(&home, &[".git/"]);
        assert_eq!(
            root_of(&home.join("notes/plan.md"), Some(&home)),
            root(&home, true, true)
        );
        // The same folder by another path, here through a link, is still home.
        let link = folder("home-link").join("home");
        symlink(&home, &link).unwrap();
        assert!(root_of(&home.join("plan.md"), Some(&link)).too_broad);
        assert_eq!(
            root_of(Path::new("/plan.md"), None),
            root(Path::new("/"), false, true)
        );
        fs::remove_dir_all(&home).unwrap();
        fs::remove_dir_all(link.parent().unwrap()).unwrap();
    }

    #[test]
    fn list_leaves_out_hidden_files_and_what_git_ignores() {
        let repo = folder("list");
        make(
            &repo,
            &[
                ".git/",
                ".env",
                ".github/ci.yml",
                "README.md",
                "package.json",
                "docs/design.md",
                "docs/notes.log",
                "docs/node_modules/left-pad/index.js",
                "node_modules/left-pad/index.js",
                "dist/app.js",
                "src/target/",
            ],
        );
        fs::write(repo.join(".gitignore"), "node_modules/\n/dist\n").unwrap();
        fs::write(repo.join("docs/.gitignore"), "*.log\n").unwrap();
        assert_eq!(
            names(&repo, &repo),
            ["README.md", "docs/", "package.json", "src/"]
        );
        // The ignore files of the folders above count, up to the repository's root.
        assert_eq!(names(&repo, &repo.join("docs")), ["design.md"]);
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn list_shows_what_nothing_ignores() {
        let repo = folder("unignored");
        make(
            &repo,
            &[".git/", "node_modules/left-pad/index.js", "plan.md"],
        );
        assert_eq!(names(&repo, &repo), ["node_modules/", "plan.md"]);
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn list_refuses_a_folder_outside_the_root() {
        let outside = folder("outside");
        make(&outside, &["secret.md", "repo/.git/", "repo/docs/plan.md"]);
        let repo = outside.join("repo");
        assert!(list(&repo, &repo.join("docs/../..")).is_err());
        assert!(list(&repo, &outside).is_err());
        // A link inside the root to a folder outside it.
        symlink(&outside, repo.join("out")).unwrap();
        assert!(list(&repo, &repo.join("out")).is_err());
        // A link to a folder inside the root is listed.
        symlink(repo.join("docs"), repo.join("in")).unwrap();
        assert_eq!(names(&repo, &repo.join("in")), ["plan.md"]);
        // And a folder that isn't there can't be.
        assert!(list(&repo, &repo.join("missing")).is_err());
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn a_link_loop_lists_without_hanging() {
        let repo = folder("loop");
        make(&repo, &[".git/", "plan.md"]);
        symlink(".", repo.join("again")).unwrap();
        symlink("b", repo.join("a")).unwrap();
        symlink("a", repo.join("b")).unwrap();
        // A link to a folder is a folder; links that go round and round are names, and no more.
        assert_eq!(names(&repo, &repo), ["a", "again/", "b", "plan.md"]);
        assert_eq!(
            names(&repo, &repo.join("again")),
            ["a", "again/", "b", "plan.md"]
        );
        assert!(list(&repo, &repo.join("a")).is_err());
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn opens_files_in_their_default_app_but_not_programs_or_folders() {
        let repo = folder("open");
        make(&repo, &["logo.png", "app.app/Contents/", "build"]);
        assert_eq!(openable(&repo.join("logo.png")), Ok(()));
        // An app is a folder, and a program would run.
        assert!(openable(&repo.join("app.app")).is_err());
        fs::set_permissions(repo.join("build"), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(openable(&repo.join("build")).is_err());
        // Files that the system runs when they are opened, whatever their permissions.
        for name in ["run.command", "shell.terminal", "tool.jar", "Setup.FILELOC"] {
            make(&repo, &[name]);
            assert!(openable(&repo.join(name)).is_err(), "{name}");
        }
        assert!(openable(&repo.join("missing.png")).is_err());
        assert!(openable(Path::new("logo.png")).is_err());
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn a_root_and_an_entry_reach_the_window_by_name() {
        // src/host.ts reads these fields, as @redlines/plugin-api's ProjectRoot and FileEntry.
        assert_eq!(
            serde_json::to_value(root(Path::new("/repo"), true, false)).unwrap(),
            serde_json::json!({ "folder": "/repo", "isRepo": true, "tooBroad": false })
        );
        let entry = FileEntry {
            name: "docs".to_owned(),
            path: "/repo/docs".to_owned(),
            is_dir: true,
        };
        assert_eq!(
            serde_json::to_value(entry).unwrap(),
            serde_json::json!({ "name": "docs", "path": "/repo/docs", "isDir": true })
        );
    }
}
