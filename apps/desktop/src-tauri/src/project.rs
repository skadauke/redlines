//! The project around a document (v0.2 design: The file sidebar, and Scope): the folder an agent
//! may read, which the file sidebar shows. It is the repository root when the document is in a git
//! repository, and otherwise the document's own folder. Finding it, and listing it as git would,
//! with what `.gitignore` ignores left out, needs no git: the `ignore` crate reads the ignore files.

use std::path::{Path, PathBuf};

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
        too_broad: too_broad(folder, home),
    }
}

/// Whether a folder is too broad to be a project: the disk's root, by whatever name (such as
/// `/Volumes/Macintosh HD`), the home folder, or a folder above it, such as `/Users`. Folders are
/// compared as they really are, with every link followed.
fn too_broad(folder: &Path, home: Option<&Path>) -> bool {
    let real = |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let folder = real(folder);
    folder.parent().is_none() || home.is_some_and(|home| real(home).starts_with(&folder))
}

/// The entries of `folder`, which must be inside the project folder `root`, links followed: hidden
/// ones, and those that git ignores, left out. Only this one folder is read, so a large folder
/// further down costs nothing until it is opened.
pub fn list(root: &Path, folder: &Path) -> Result<Vec<FileEntry>, String> {
    list_with(root, folder, true)
}

/// `list`, with or without the excludes that the person's git config names for every repository.
fn list_with(root: &Path, folder: &Path, global_excludes: bool) -> Result<Vec<FileEntry>, String> {
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
        .git_global(global_excludes)
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

/// The extensions, lowercase, of the files Redlines opens in another app: images and PDFs, which
/// open in Preview (`viewer`). Anything else may be something the system runs when it is opened,
/// such as Terminal's settings files, links to files or web pages, or scripts.
const IMAGES_AND_PDFS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "bmp", "pdf",
];

/// The file at `path`, as it really is, if it may be opened in Preview: an image or a PDF by the
/// name of the file a link names, inside the project folder `root`, and neither a program, nor an
/// alias, nor set to open in an app of its own. Otherwise a line to show the person.
fn openable(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .map_or_else(|| path.to_string_lossy(), |name| name.to_string_lossy());
    let cannot = || format!("Couldn’t open “{name}”.");
    if !path.is_absolute() {
        return Err(cannot());
    }
    let real = std::fs::canonicalize(path).map_err(|_| cannot())?;
    let real_root = std::fs::canonicalize(root).map_err(|_| cannot())?;
    if !real.starts_with(&real_root) {
        return Err(format!(
            "“{name}” is outside this folder, so Redlines doesn’t open it."
        ));
    }
    let image_or_pdf = real.extension().is_some_and(|extension| {
        let extension = extension.to_string_lossy().to_lowercase();
        IMAGES_AND_PDFS.contains(&extension.as_str())
    });
    if !image_or_pdf {
        // Text files have no viewer yet.
        return Err("Redlines opens Markdown, images and PDFs.".to_owned());
    }
    let metadata = std::fs::metadata(&real).map_err(|_| cannot())?;
    if !metadata.is_file() {
        return Err(cannot());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 != 0 {
            return Err(format!(
                "“{name}” is a program, so Redlines doesn’t open it."
            ));
        }
    }
    #[cfg(target_os = "macos")]
    finder::check(&real).map_err(|refusal| match refusal {
        finder::Refusal::Alias => format!("“{name}” is an alias, so Redlines doesn’t open it."),
        finder::Refusal::OwnApp => {
            format!("“{name}” is set to open in another app, so Redlines doesn’t open it.")
        }
        finder::Refusal::Unreadable => cannot(),
    })?;
    Ok(real)
}

/// What the Finder keeps about a file beside its name, which `open` would follow: an alias, a
/// regular file that opens what it points to (even an app), whatever its name; and Get Info's
/// Open With, the app this one file opens in. Archives made with `tar` or Archive Utility keep
/// both, though git doesn't.
#[cfg(target_os = "macos")]
mod finder {
    use std::ffi::{CStr, CString};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    /// Why a file may not be opened.
    #[derive(Debug, PartialEq)]
    pub enum Refusal {
        Alias,
        OwnApp,
        /// Its attributes can't be read, so what it is can't be told.
        Unreadable,
    }

    /// The Finder's flag for an alias, in the flags of `com.apple.FinderInfo` (bytes 8 and 9, big
    /// endian).
    const IS_ALIAS: u16 = 0x8000;

    pub fn check(file: &Path) -> Result<(), Refusal> {
        let file = CString::new(file.as_os_str().as_bytes()).map_err(|_| Refusal::Unreadable)?;
        let mut info = [0u8; 32];
        let read = attribute(&file, c"com.apple.FinderInfo", Some(&mut info))?;
        if read.is_some_and(|read| read >= 10)
            && u16::from_be_bytes([info[8], info[9]]) & IS_ALIAS != 0
        {
            return Err(Refusal::Alias);
        }
        if attribute(&file, c"com.apple.LaunchServices.OpenWith", None)?.is_some() {
            return Err(Refusal::OwnApp);
        }
        Ok(())
    }

    /// Reads the extended attribute `name` into `value`, or only its size without one: None when
    /// the file has no such attribute, or its disk keeps none.
    fn attribute(
        file: &CStr,
        name: &CStr,
        value: Option<&mut [u8]>,
    ) -> Result<Option<usize>, Refusal> {
        let (buffer, size) = match value {
            Some(value) => (value.as_mut_ptr().cast(), value.len()),
            None => (std::ptr::null_mut(), 0),
        };
        // SAFETY: both names end in NUL, and the buffer is `size` bytes long, or null to ask for
        // the size alone.
        let read = unsafe { libc::getxattr(file.as_ptr(), name.as_ptr(), buffer, size, 0, 0) };
        if let Ok(read) = usize::try_from(read) {
            return Ok(Some(read));
        }
        match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ENOATTR | libc::ENOTSUP) => Ok(None),
            _ => Err(Refusal::Unreadable),
        }
    }
}

/// The command that opens an image or a PDF. On the Mac it names Preview, which opens images and
/// PDFs alone: not the app the file is set to open in, and not what an alias points to.
fn viewer(file: &Path) -> std::process::Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        command.args(["-a", "Preview"]).arg(file);
        command
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(file);
        command
    }
}

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

/// Opens an image or a PDF inside the project folder `root` in Preview, or on other systems in its
/// default app (`openable`, `viewer`). Fails with a line to show the person.
#[tauri::command(async)]
pub fn open_default(root: String, path: String) -> Result<(), String> {
    // The file as it really is, so that what opens is what was checked.
    let real = openable(Path::new(&root), Path::new(&path))?;
    let opened = viewer(&real).status().is_ok_and(|status| status.success());
    if opened {
        Ok(())
    } else {
        let name = real.file_name().unwrap_or_default().to_string_lossy();
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
    /// They leave out what this machine's global git excludes say, which differ from machine to
    /// machine.
    fn names(root: &Path, folder: &Path) -> Vec<String> {
        list_with(root, folder, false)
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
    fn a_folder_above_home_and_the_disks_root_by_another_name_are_too_broad() {
        // As /Users is above /Users/ada.
        let users = folder("users");
        make(&users, &["plan.md", "ada/notes/"]);
        assert_eq!(
            root_of(&users.join("plan.md"), Some(&users.join("ada"))),
            root(&users, false, true)
        );
        // Below home is fine.
        assert!(!root_of(&users.join("ada/notes/plan.md"), Some(&users.join("ada"))).too_broad);
        // The disk's root through a link, as /Volumes/Macintosh HD is.
        symlink("/", users.join("disk")).unwrap();
        assert_eq!(
            root_of(&users.join("disk/plan.md"), None),
            root(&users.join("disk"), false, true)
        );
        fs::remove_dir_all(&users).unwrap();
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
        make(&repo, &[".git/", "vendor/left-pad/index.js", "plan.md"]);
        assert_eq!(names(&repo, &repo), ["plan.md", "vendor/"]);
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
    fn opens_only_images_and_pdfs_inside_the_project_in_their_default_app() {
        let outside = folder("open");
        let repo = outside.join("repo");
        make(
            &outside,
            &[
                "elsewhere.png",
                "repo/.git/",
                "repo/logo.png",
                "repo/Scan.PDF",
                "repo/photo.heic",
                "repo/app.app/Contents/",
                "repo/build.png",
                "repo/evil.terminal",
                "repo/run.command",
                "repo/home.webloc",
                "repo/notes.txt",
                "repo/script.py",
            ],
        );
        let open = |name: &str| openable(&repo, &repo.join(name));
        assert_eq!(
            open("logo.png"),
            Ok(fs::canonicalize(repo.join("logo.png")).unwrap())
        );
        assert!(open("Scan.PDF").is_ok());
        assert!(open("photo.heic").is_ok());
        // Nothing else: not what the Mac would run, a link, a script, nor text, which has a viewer.
        for name in [
            "evil.terminal",
            "run.command",
            "home.webloc",
            "notes.txt",
            "script.py",
        ] {
            assert!(open(name).is_err(), "{name}");
        }
        // The file a link names decides, not the link's name.
        symlink("evil.terminal", repo.join("screenshot.png")).unwrap();
        assert!(open("screenshot.png").is_err());
        // An image outside the project, through a link inside it.
        symlink(outside.join("elsewhere.png"), repo.join("linked.png")).unwrap();
        assert!(open("linked.png").is_err());
        // An app is a folder, and a program would run whatever its name.
        assert!(open("app.app").is_err());
        fs::set_permissions(repo.join("build.png"), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(open("build.png").is_err());
        assert!(open("missing.png").is_err());
        assert!(openable(&repo, Path::new("logo.png")).is_err());
        fs::remove_dir_all(&outside).unwrap();
    }

    /// Sets an extended attribute, as Finder, `tar` and Archive Utility do.
    #[cfg(target_os = "macos")]
    fn set_attribute(path: &Path, name: &str, value: &[u8]) {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let file = CString::new(path.as_os_str().as_bytes()).unwrap();
        let name = CString::new(name).unwrap();
        // SAFETY: both strings end in NUL, and the value is `value.len()` bytes long.
        let set = unsafe {
            libc::setxattr(
                file.as_ptr(),
                name.as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
                0,
            )
        };
        assert_eq!(set, 0, "{}", std::io::Error::last_os_error());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn refuses_an_alias_and_a_file_set_to_open_in_another_app() {
        let repo = folder("finder");
        make(
            &repo,
            &[".git/", "alias-app.png", "bound.png", "labelled.png"],
        );
        // As a Finder alias carries it: type, creator, and the alias flag (0x8000) in the flags.
        let mut alias = [0u8; 32];
        alias[..8].copy_from_slice(b"alisMACS");
        alias[8] = 0x80;
        set_attribute(&repo.join("alias-app.png"), "com.apple.FinderInfo", &alias);
        // Get Info's Open With, for this file alone.
        set_attribute(
            &repo.join("bound.png"),
            "com.apple.LaunchServices.OpenWith",
            b"bplist00",
        );
        // A color label is Finder info too, and harmless.
        let mut labelled = [0u8; 32];
        labelled[9] = 0x0e;
        set_attribute(
            &repo.join("labelled.png"),
            "com.apple.FinderInfo",
            &labelled,
        );
        let open = |name: &str| openable(&repo, &repo.join(name));
        assert!(open("alias-app.png").is_err());
        assert!(open("bound.png").is_err());
        assert!(open("labelled.png").is_ok());
        // And through a link with a harmless name.
        symlink("alias-app.png", repo.join("pretty.png")).unwrap();
        assert!(open("pretty.png").is_err());
        fs::remove_dir_all(&repo).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn images_and_pdfs_open_in_preview_by_name() {
        // Not the app the file names for itself, nor what an alias points to.
        let command = viewer(Path::new("/repo/logo.png"));
        assert_eq!(command.get_program(), "open");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            ["-a", "Preview", "/repo/logo.png"]
        );
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
