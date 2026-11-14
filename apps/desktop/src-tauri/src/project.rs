//! The project around a document (v0.2 design: The file sidebar, and Scope): the folder an agent
//! may read, which the file sidebar shows. It is the repository root when the document is in a git
//! repository, and otherwise the document's own folder. Finding it, and listing it as git would,
//! with what `.gitignore` ignores left out, needs no git: the `ignore` crate reads the ignore files.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

use crate::file_scope;

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

impl ProjectRoot {
    /// Whether the project is the home folder or the disk's root, which shows its document's own
    /// folder alone (`sidebar_folder`).
    pub fn is_too_broad(&self) -> bool {
        self.too_broad
    }
}

/// A file or folder in the sidebar. The window reads the fields by name.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Whether `path` is one as a dialog gives it: absolute, and with no `..` in it. The search for a
/// `.git` follows the names a path holds, so one that leaves a repository on the way
/// (`repo/../elsewhere/x.md`) would find a repository the file is not in.
fn is_direct(path: &Path) -> bool {
    path.is_absolute()
        && !path
            .components()
            .any(|part| part == std::path::Component::ParentDir)
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

/// The entries of `folder`, if a sidebar shows it: `root` is the folder one of them shows (one of
/// `shown`, as given or as it really is), and `folder` is that folder or below it through folders
/// the sidebar lists, none hidden and none that git ignores (`shown_below`). The window names both,
/// so neither is taken as it comes: a window that names a folder as its own root lists nothing, and
/// no hidden or ignored folder is listed by name. The same line refuses every one of them, and says
/// nothing of whether the folder is there.
pub fn list_shown(shown: &[PathBuf], root: &Path, folder: &Path) -> Result<Vec<FileEntry>, String> {
    list_shown_with(shown, root, folder, true)
}

/// The folder `root` really is, if a sidebar shows it: `root` is one of `shown`, as given or as it
/// really is, which a project folder that is a link is both. The window names the root, so it is
/// not taken as it comes: a root that starts from wherever the app was started names no place the
/// window can tell, and a project folder that does isn't one a sidebar shows.
fn shown_root(shown: &[PathBuf], root: &Path) -> Option<PathBuf> {
    if !root.is_absolute() {
        return None;
    }
    let real_root = file_scope::real(root);
    shown
        .iter()
        .filter(|project| project.is_absolute())
        .any(|project| file_scope::real(project) == real_root)
        .then_some(real_root)
}

/// `list_shown`, with or without the excludes that the person's git config names for every
/// repository.
fn list_shown_with(
    shown: &[PathBuf],
    root: &Path,
    folder: &Path,
    global_excludes: bool,
) -> Result<Vec<FileEntry>, String> {
    let refused = || format!("Can’t read {}.", folder.display());
    let Some(real_root) = shown_root(shown, root) else {
        return Err(refused());
    };
    // As the window names them, or as they really are: a project folder may be a link.
    let real_folder = file_scope::real(folder);
    let tries = [(root, folder), (&real_root, &real_folder)];
    if !tries
        .into_iter()
        .any(|(root, folder)| shown_below(root, folder, global_excludes).is_ok())
    {
        return Err(refused());
    }
    list_with(root, folder, global_excludes)
}

/// The entries of `folder`, which must be inside the project folder `root`, links followed: hidden
/// ones, and those that git ignores, left out, and, with `global_excludes`, those that the excludes
/// the person's git config names for every repository leave out. Only this one folder is read, so a
/// large folder further down costs nothing until it is opened.
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

/// `openable`, if a sidebar shows the project folder `root` (one of `shown`, `shown_root`). The
/// window names both the folder and the file, so it is not for the window to say which folder
/// holds the file: a window that names a folder as its own root opens nothing, and the line that
/// refuses it is that of any file that isn't inside a project, which says nothing of whether the
/// file is there.
fn openable_in(shown: &[PathBuf], root: &Path, path: &Path) -> Result<PathBuf, String> {
    let real_root = shown_root(shown, root).ok_or_else(|| cannot_open(path))?;
    openable(&real_root, path)
}

/// The extensions, lowercase, of the files a link in a document opens in another app: images and
/// PDFs, which open in Preview (`viewer`). Anything else may be something the system runs when it
/// is opened, such as Terminal's settings files, links to files or web pages, or scripts.
const IMAGES_AND_PDFS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "bmp", "pdf",
];

/// The file at `path`, as it really is, if it may be opened in Preview: an image or a PDF by the
/// name of the file a link names, inside the project folder `root`, below no hidden name (as the
/// sidebar lists none), and neither a program, nor an alias, nor set to open in an app of its own.
/// Otherwise a line to show the person. The file is judged by what it really is, so a link in the
/// project that leads out of it is no more openable than the file it leads to; and a file that is
/// outside the folder, or hidden, gets the line of a file that isn't there, which says nothing of
/// whether it is: the window can't find out which files are on the disk.
fn openable(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .map_or_else(|| path.to_string_lossy(), |name| name.to_string_lossy());
    let cannot = || cannot_open(path);
    if !path.is_absolute() {
        return Err(cannot());
    }
    let real = std::fs::canonicalize(path).map_err(|_| cannot())?;
    let real_root = std::fs::canonicalize(root).map_err(|_| cannot())?;
    let known = real
        .strip_prefix(&real_root)
        .is_ok_and(|below| !file_scope::is_hidden_below(below));
    if !known {
        return Err(cannot());
    }
    let image_or_pdf = real.extension().is_some_and(|extension| {
        let extension = extension.to_string_lossy().to_lowercase();
        IMAGES_AND_PDFS.contains(&extension.as_str())
    });
    if !image_or_pdf {
        return Err(format!(
            "“{name}” isn’t an image or a PDF, so Redlines doesn’t open it."
        ));
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

/// The extensions, lowercase, of the documents Redlines opens and edits: Markdown, its R Markdown
/// and Quarto dialects, and plain text (format §9.1, and `DOCUMENT_EXTENSIONS` in `src/host.ts`).
/// The app's bundle declares the same, for Finder's Open With (`Info.plist`).
pub const DOCUMENTS: &[&str] = &["md", "markdown", "qmd", "rmd", "txt"];

/// The folder the sidebar of a window shows for its document: the project folder, or the
/// document's own folder when the project is too broad (`src/ui/sidebar.ts`).
fn sidebar_folder(document: &Path, home: Option<&Path>) -> PathBuf {
    let root = root_of(document, home);
    if root.too_broad {
        document.parent().unwrap_or(document).to_path_buf()
    } else {
        PathBuf::from(root.folder)
    }
}

/// What is done with a folder the first time it is shown, and whether its subfolders are shown
/// too (not when the project is too broad: then only the document's own folder).
type FolderShown = Box<dyn Fn(&Path, bool) + Send + Sync>;

/// The folders the sidebars show: that of each document a window showed that the person opened or
/// saved (`file_scope::held`, and the project a window asks for, `project_of`). The sidebar opens
/// documents in them, though the window names none: what it may use is decided by what the person
/// was shown. Kept until the app quits.
#[derive(Default)]
pub struct Projects {
    folders: Mutex<Vec<PathBuf>>,
    /// Told of each folder as it is first shown (`on_new_folder`).
    on_new: OnceLock<FolderShown>,
}

impl Projects {
    /// Calls `then` with each folder the first time it is shown, and whether all it holds is shown.
    /// The app uses it to let the preview load the images of a project and of no other folder
    /// (`images`). Only the first call counts.
    pub fn on_new_folder(&self, then: impl Fn(&Path, bool) + Send + Sync + 'static) {
        let _ = self.on_new.set(Box::new(then));
    }

    /// Notes that a window shows the file at `file`, which the person opened: the sidebar shows its
    /// project.
    pub fn show(&self, file: &Path) {
        self.show_with(file, std::env::home_dir().as_deref());
    }

    fn show_with(&self, file: &Path, home: Option<&Path>) {
        if !is_direct(file) {
            return;
        }
        let folder = sidebar_folder(file, home);
        // A document's own folder, where the project is too broad, shows its files alone.
        let whole = !root_of(file, home).too_broad;
        let mut folders = self
            .folders
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if folders.contains(&folder) {
            return;
        }
        folders.push(folder.clone());
        // Not under the lock, which the callback has no business holding.
        drop(folders);
        if let Some(then) = self.on_new.get() {
            then(&folder, whole);
        }
    }

    pub fn folders(&self) -> Vec<PathBuf> {
        self.folders
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

/// The line to show the person for a file that can't be opened.
fn cannot_open(path: &Path) -> String {
    let name = path
        .file_name()
        .map_or_else(|| path.to_string_lossy(), |name| name.to_string_lossy());
    format!("Couldn’t open “{name}”.")
}

/// Whether the sidebar showing the folder `root` lists `path`, which is `root` itself or below it:
/// each name on the way is one that the folder before it lists as the sidebar lists it
/// (`list_with`), so none is hidden, and none is ignored by git.
fn shown_below(root: &Path, path: &Path, global_excludes: bool) -> Result<(), ()> {
    let below = path.strip_prefix(root).map_err(|_| ())?;
    let mut folder = root.to_path_buf();
    for name in below.components() {
        let std::path::Component::Normal(name) = name else {
            return Err(());
        };
        let listed = list_with(root, &folder, global_excludes)
            .map_err(|_| ())?
            .into_iter()
            .any(|entry| entry.name == name.to_string_lossy());
        if !listed {
            return Err(());
        }
        folder.push(name);
    }
    Ok(())
}

/// The file at `path`, as it really is, if the sidebar showing the folder `root` lists it: below
/// the root through folders the sidebar lists, neither hidden nor ignored by git, and a plain file
/// inside the root, also when a link names it. Otherwise a line to show the person. Each folder on
/// the way is listed as the sidebar lists it (`shown_below`).
fn shown_file(root: &Path, path: &Path, global_excludes: bool) -> Result<PathBuf, String> {
    let cannot = || cannot_open(path);
    let below = path.strip_prefix(root).map_err(|_| cannot())?;
    if below.components().next().is_none() {
        return Err(cannot());
    }
    shown_below(root, path, global_excludes).map_err(|()| cannot())?;
    // A link the sidebar lists may name a file anywhere: what is read or written is that file.
    let real = std::fs::canonicalize(path).map_err(|_| cannot())?;
    let real_root = std::fs::canonicalize(root).map_err(|_| cannot())?;
    let inside = real.strip_prefix(&real_root).map_err(|_| cannot())?;
    let hidden = file_scope::is_hidden_below(inside);
    if hidden || !std::fs::metadata(&real).is_ok_and(|metadata| metadata.is_file()) {
        return Err(cannot());
    }
    Ok(real)
}

/// The file at `path`, as it really is, if the sidebar showing one of `folders` lists it
/// (`shown_file`), by the path as given or as it really is.
pub fn shown_in(
    folders: &[PathBuf],
    path: &Path,
    global_excludes: bool,
) -> Result<PathBuf, String> {
    let real_path = file_scope::real(path);
    for folder in folders {
        let real_folder = file_scope::real(folder);
        let tries = [(folder.as_path(), path), (&real_folder, &real_path)];
        for (folder, path) in tries {
            if path.starts_with(folder)
                && let Ok(real) = shown_file(folder, path, global_excludes)
            {
                return Ok(real);
            }
        }
    }
    Err(cannot_open(path))
}

/// What the window says of a file that isn't a document, which Redlines doesn't open, however it
/// is asked to (`NOT_A_DOCUMENT` in `src/host.ts`).
pub const NOT_A_DOCUMENT: &str = "Redlines opens Markdown and text files.";

/// Whether the file at `path` is a document, by its name (`DOCUMENTS`).
pub fn is_document(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        DOCUMENTS.contains(&extension.to_string_lossy().to_lowercase().as_str())
    })
}

/// `real`, the file at `path`, if it is a document by the name of the file a link names.
fn document(real: PathBuf, path: &Path) -> Result<PathBuf, String> {
    if is_document(&real) {
        Ok(real)
    } else {
        Err(cannot_open(path))
    }
}

/// `shown_file`, if it is a document.
#[cfg(test)]
fn document_file(root: &Path, path: &Path, global_excludes: bool) -> Result<PathBuf, String> {
    document(shown_file(root, path, global_excludes)?, path)
}

/// The project folder of the document at `path` (`root_of`), for a document the person opened or
/// saved and no other path (`project_of`). Asking for the project of such a document is what shows
/// it, so that the sidebar, which has the folder from this answer, can then list it
/// (`list_folder`) and the window can learn what is in it (`real_path`): no other call has to come
/// first.
#[tauri::command(async)]
pub fn project_root(app: AppHandle, path: String) -> Result<ProjectRoot, String> {
    project_of(
        &app.fs_scope(),
        &app.state::<Projects>(),
        &path,
        std::env::home_dir().as_deref(),
    )
}

/// `project_root`, with the app's parts: the project of the document at `path`, shown, if the scope
/// allows the document and the path is one as a dialog gives it (`is_direct`). The search for a
/// `.git` would tell a window which paths have a repository above them, and which folder holds it,
/// so for any other path one line refuses (`file_scope::refusal`), which says nothing of whether
/// the path is there (design, 6.5).
fn project_of(
    scope: &tauri::fs::Scope,
    projects: &Projects,
    path: &str,
    home: Option<&Path>,
) -> Result<ProjectRoot, String> {
    let file = Path::new(path);
    if is_direct(file) && file_scope::show(scope, projects, path) {
        Ok(root_of(file, home))
    } else {
        Err(file_scope::refusal(file))
    }
}

/// The entries of a folder that a sidebar shows, inside the project folder `root` that it shows
/// (`list_shown`).
#[tauri::command(async)]
pub fn list_folder(app: AppHandle, root: String, folder: String) -> Result<Vec<FileEntry>, String> {
    let shown = app.state::<Projects>().folders();
    list_shown(&shown, Path::new(&root), Path::new(&folder))
}

/// Lets the windows read and write a document that the sidebar of a project a window shows lists
/// (`shown_in`, `Projects`), as the open dialog does for a file the person picks there: the file it
/// really is, which is what the file system plugin asks about. Fails with a line to show the
/// person.
#[tauri::command(async)]
pub fn allow_document(app: AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    let folders = app.state::<Projects>().folders();
    let real = document(shown_in(&folders, path, true)?, path)?;
    app.fs_scope()
        .allow_file(&real)
        .map_err(|_| cannot_open(path))
}

/// A window asks to load the images of its document's project: it may when it may use the
/// document (`file_scope::held`), which shows the project and lets the page load them (`images`).
/// The page asks, and waits for the answer, so that the images it draws next can load.
#[tauri::command(async)]
pub fn show_images(app: AppHandle, path: String) -> bool {
    file_scope::held(&app, &path)
}

/// Opens an image or a PDF inside the project folder `root` in Preview, or on other systems in its
/// default app (`openable_in`, `viewer`), if a sidebar shows that folder (`Projects`). Fails with a
/// line to show the person.
#[tauri::command(async)]
pub fn open_default(app: AppHandle, root: String, path: String) -> Result<(), String> {
    let shown = app.state::<Projects>().folders();
    // The file as it really is, so that what opens is what was checked.
    let real = openable_in(&shown, Path::new(&root), Path::new(&path))?;
    let opened = viewer(&real).status().is_ok_and(|status| status.success());
    if opened {
        Ok(())
    } else {
        Err(cannot_open(&real))
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

    /// The file system plugin's scope, as the app starts with it: empty.
    fn scope() -> tauri::fs::Scope {
        let app = tauri::test::mock_app();
        tauri::fs::Scope::new(
            &app,
            &tauri::utils::config::FsScope::AllowedPaths(Vec::new()),
        )
        .unwrap()
    }

    /// The path to `path` from wherever the app was started: up to the disk's root, and down
    /// again. It is relative, and it reaches the same place.
    fn from_the_app(path: &Path) -> PathBuf {
        let up: PathBuf = std::env::current_dir()
            .unwrap()
            .components()
            .skip(1)
            .map(|_| "..")
            .collect();
        let relative = up.join(path.strip_prefix("/").unwrap());
        assert!(relative.is_relative());
        assert_eq!(
            fs::canonicalize(&relative).unwrap(),
            fs::canonicalize(path).unwrap()
        );
        relative
    }

    #[test]
    fn a_path_with_a_way_out_in_it_shows_no_project() {
        let disk = folder("show-way-out");
        make(
            &disk,
            &[
                "other-repo/.git/",
                "other-repo/payroll/salaries.csv",
                "desktop/x.md",
            ],
        );
        let projects = Projects::default();
        // The file is on the desktop, but the folders the path names on the way to it include a
        // repository that the person never opened, and the search for a `.git` follows the names.
        projects.show(&disk.join("other-repo/../desktop/x.md"));
        assert!(projects.folders().is_empty());
        // As the person's own dialogs give it, the same file shows the project it is in.
        projects.show(&disk.join("desktop/x.md"));
        assert_eq!(projects.folders(), [disk.join("desktop")]);
        // A path that leads from wherever the app was started shows nothing either.
        let other = Projects::default();
        other.show(Path::new("x.md"));
        other.show(Path::new("desktop/x.md"));
        assert!(other.folders().is_empty());
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn asking_for_the_project_of_a_document_the_person_opened_shows_it_and_no_other() {
        let disk = folder("project-of");
        make(
            &disk,
            &[
                "notes/.git/",
                "notes/plan.md",
                "other/.git/",
                "other/secret.md",
            ],
        );
        let (scope, projects) = (scope(), Projects::default());
        scope.allow_file(disk.join("notes/plan.md")).unwrap();
        let ask = |path: PathBuf| project_of(&scope, &projects, &path.to_string_lossy(), None);

        // A document the window wasn't given: refused, and nothing is shown.
        assert!(ask(disk.join("other/secret.md")).is_err());
        assert!(projects.folders().is_empty());
        // A document it was given, by a path that names another repository on the way and
        // leaves it: refused, and not the project of that repository.
        assert!(ask(disk.join("other/../notes/plan.md")).is_err());
        assert!(projects.folders().is_empty());
        // As the dialog gave it: the project is shown, which the sidebar, with the folder from this
        // answer, then lists, and no folder it doesn't show.
        let answer = ask(disk.join("notes/plan.md"));
        assert_eq!(answer, Ok(root(&disk.join("notes"), true, false)));
        let shown = projects.folders();
        assert_eq!(shown, [disk.join("notes")]);
        let notes = disk.join("notes");
        assert!(list_shown_with(&shown, &notes, &notes, false).is_ok());
        let other = disk.join("other");
        assert!(list_shown_with(&shown, &other, &other, false).is_err());
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn a_window_learns_of_no_repository_by_asking_for_the_project_of_a_path_it_was_not_given() {
        let disk = folder("project-of-probe");
        make(
            &disk,
            &[
                "probe/.git/",
                "probe/payroll/salaries.csv",
                "plain/notes/draft.md",
                "notes/plan.md",
            ],
        );
        let (scope, projects) = (scope(), Projects::default());
        scope.allow_file(disk.join("notes/plan.md")).unwrap();
        let ask = |path: &Path| project_of(&scope, &projects, &path.to_string_lossy(), None);

        // Files, folders and names that aren't there, whether or not a repository is above them:
        // the answer was where the repository is, or that there is none.
        for name in [
            "probe/payroll/salaries.csv",
            "probe/payroll",
            "probe",
            "probe/payroll/none.csv",
            "plain/notes/draft.md",
            "plain/notes",
            "plain/notes/missing.md",
            "notes",
        ] {
            assert!(ask(&disk.join(name)).is_err(), "{name}");
        }
        // A file it was given, by a path through folders it wasn't: the search for a repository
        // follows the names, so it would find the one on the way.
        assert!(ask(&disk.join("probe/payroll/../../notes/plan.md")).is_err());
        assert!(ask(&disk.join("plain/../notes/plan.md")).is_err());
        // A path that starts from wherever the app was started says nothing of where that is, and
        // an empty one names no place.
        assert!(ask(Path::new("notes/plan.md")).is_err());
        assert!(ask(Path::new("")).is_err());
        // Nothing of all that was shown.
        assert!(projects.folders().is_empty());
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn a_document_given_by_a_link_has_the_project_of_the_path_it_was_given_by() {
        let disk = folder("project-of-link");
        make(&disk, &["work/.git/", "work/real.md", "notes/.git/"]);
        symlink(disk.join("work/real.md"), disk.join("notes/plan.md")).unwrap();
        let (scope, projects) = (scope(), Projects::default());
        // As the open dialog gives it: the path the person went through.
        scope.allow_file(disk.join("notes/plan.md")).unwrap();
        let ask = |path: PathBuf| project_of(&scope, &projects, &path.to_string_lossy(), None);

        assert_eq!(
            ask(disk.join("notes/plan.md")),
            Ok(root(&disk.join("notes"), true, false))
        );
        assert_eq!(projects.folders(), [disk.join("notes")]);
        // The file it is a link to is the person's too, and has its own project.
        assert_eq!(
            ask(disk.join("work/real.md")),
            Ok(root(&disk.join("work"), true, false))
        );
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn what_is_refused_of_a_project_reads_alike_whatever_is_there() {
        let disk = folder("project-of-alike");
        make(
            &disk,
            &[
                "probe/.git/",
                "probe/payroll/salaries.csv",
                "plain/draft.md",
            ],
        );
        let (scope, projects) = (scope(), Projects::default());
        for path in [
            // A file and a folder in a repository, and what isn't there.
            disk.join("probe/payroll/salaries.csv"),
            disk.join("probe/payroll"),
            disk.join("probe/payroll/none.csv"),
            disk.join("probe"),
            // With no repository above, and by a way out through `..`.
            disk.join("plain/draft.md"),
            disk.join("plain/none.md"),
            disk.join("plain/../probe/payroll/salaries.csv"),
            disk.join("plain/../probe/payroll/none.csv"),
            // From nowhere: no place at all, a name, and the way from where the app was started to
            // a file that is there.
            PathBuf::new(),
            PathBuf::from("draft.md"),
            from_the_app(&disk.join("plain/draft.md")),
        ] {
            let line = project_of(&scope, &projects, &path.to_string_lossy(), None).unwrap_err();
            // One line, which has none of the file system's own words and none of what is there.
            assert_eq!(
                line,
                format!("Redlines doesn’t look at {}.", path.display())
            );
        }
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn a_path_from_wherever_the_app_was_started_to_a_document_the_person_opened_is_refused() {
        // The tests run from the crate's folder, where its manifest is: a file the scope allows,
        // which a path with no `..` in it reaches from there.
        let manifest = std::env::current_dir().unwrap().join("Cargo.toml");
        assert!(manifest.is_file(), "{manifest:?}");
        let (scope, projects) = (scope(), Projects::default());
        scope.allow_file(&manifest).unwrap();
        for path in ["Cargo.toml", "./Cargo.toml"] {
            assert!(project_of(&scope, &projects, path, None).is_err(), "{path}");
        }
        assert!(projects.folders().is_empty());
        // As the person's dialog gives it, the same file has its project.
        let absolute = manifest.to_string_lossy();
        assert!(project_of(&scope, &projects, &absolute, None).is_ok());
    }

    #[test]
    fn a_folder_is_told_of_once_when_first_shown() {
        let repo = folder("images");
        make(&repo, &[".git/", "docs/plan.md"]);
        let told = std::sync::Arc::new(Mutex::new(Vec::<(PathBuf, bool)>::new()));
        let projects = Projects::default();
        let log = told.clone();
        projects.on_new_folder(move |folder, whole| {
            log.lock().unwrap().push((folder.to_path_buf(), whole))
        });
        projects.show(&repo.join("docs/plan.md"));
        projects.show(&repo.join("docs/other.md"));
        assert_eq!(*told.lock().unwrap(), [(repo.clone(), true)]);
        assert_eq!(projects.folders(), std::slice::from_ref(&repo));
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn a_document_in_the_home_folder_shows_that_folder_alone() {
        let home = folder("images-home");
        let told = std::sync::Arc::new(Mutex::new(Vec::<(PathBuf, bool)>::new()));
        let projects = Projects::default();
        let log = told.clone();
        projects.on_new_folder(move |folder, whole| {
            log.lock().unwrap().push((folder.to_path_buf(), whole));
        });
        projects.show_with(&home.join("note.md"), Some(&home));
        assert_eq!(*told.lock().unwrap(), [(home.clone(), false)]);
        fs::remove_dir_all(&home).unwrap();
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
        assert!(list_with(&repo, &repo.join("docs/../.."), false).is_err());
        assert!(list_with(&repo, &outside, false).is_err());
        // A link inside the root to a folder outside it.
        symlink(&outside, repo.join("out")).unwrap();
        assert!(list_with(&repo, &repo.join("out"), false).is_err());
        // A link to a folder inside the root is listed.
        symlink(repo.join("docs"), repo.join("in")).unwrap();
        assert_eq!(names(&repo, &repo.join("in")), ["plan.md"]);
        // And a folder that isn't there can't be.
        assert!(list_with(&repo, &repo.join("missing"), false).is_err());
        fs::remove_dir_all(&outside).unwrap();
    }

    /// The names `list_shown_with` gives, as `names` gives them (a `/` after each folder).
    fn shown_names(shown: &[PathBuf], root: &Path, folder: &Path) -> Result<Vec<String>, String> {
        list_shown_with(shown, root, folder, false).map(|entries| {
            entries
                .into_iter()
                .map(|entry| {
                    if entry.is_dir {
                        format!("{}/", entry.name)
                    } else {
                        entry.name
                    }
                })
                .collect()
        })
    }

    #[test]
    fn a_folder_is_listed_only_below_a_folder_a_sidebar_shows() {
        let disk = folder("shown");
        make(
            &disk,
            &[
                "repo/.git/",
                "repo/README.md",
                "repo/docs/plan.md",
                "elsewhere/secret.md",
                "elsewhere/sub/more.md",
            ],
        );
        let (repo, elsewhere) = (disk.join("repo"), disk.join("elsewhere"));
        let shown = [repo.clone()];
        // The folder the sidebar shows, and a folder in it.
        assert_eq!(
            shown_names(&shown, &repo, &repo).unwrap(),
            ["README.md", "docs/"]
        );
        assert_eq!(
            shown_names(&shown, &repo, &repo.join("docs")).unwrap(),
            ["plan.md"]
        );
        // Named as its own root, any folder on the disk was listed.
        assert!(shown_names(&shown, &elsewhere, &elsewhere).is_err());
        assert!(shown_names(&shown, &elsewhere, &elsewhere.join("sub")).is_err());
        // The project's root doesn't reach the folders around it either.
        assert!(shown_names(&shown, &repo, &elsewhere).is_err());
        assert!(shown_names(&shown, &repo, &repo.join("../elsewhere")).is_err());
        // Nor is a folder of the project, or the folder above it, a root of its own.
        let docs = repo.join("docs");
        assert!(shown_names(&shown, &docs, &docs).is_err());
        assert!(shown_names(&shown, &disk, &repo).is_err());
        assert!(shown_names(&shown, &disk, &disk).is_err());
        // Where no sidebar shows anything, nothing is listed.
        assert!(shown_names(&[], &repo, &repo).is_err());
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn a_root_that_starts_from_wherever_the_app_was_started_lists_nothing() {
        let disk = folder("shown-relative");
        make(&disk, &["repo/.git/", "repo/docs/plan.md"]);
        let repo = disk.join("repo");
        let shown = [repo.clone()];
        assert_eq!(shown_names(&shown, &repo, &repo).unwrap(), ["docs/"]);
        // The project as a path from the app's own folder reaches it, and names no place the window
        // can tell: the folder it names as the root, or the one it lists, or both.
        let relative = from_the_app(&repo);
        assert!(shown_names(&shown, &relative, &relative).is_err());
        assert!(shown_names(&shown, &relative, &repo).is_err());
        assert!(shown_names(&shown, &relative, &repo.join("docs")).is_err());
        // Nor is a folder that is shown by such a path a project: no sidebar shows it so.
        assert!(shown_names(std::slice::from_ref(&relative), &repo, &repo).is_err());
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn a_sidebar_lists_no_folder_it_hides() {
        let repo = folder("shown-hidden");
        make(
            &repo,
            &[
                ".git/config",
                ".ssh/id_ed25519",
                ".github/ci.yml",
                "dist/app.js",
                "docs/plan.md",
                "docs/.private/key",
            ],
        );
        fs::write(repo.join(".gitignore"), "/dist\n").unwrap();
        let shown = [repo.clone()];
        // A hidden folder, and one git ignores, is no part of what the sidebar shows, so it isn't
        // listed by name either.
        for name in [".git", ".ssh", ".github", "dist", "docs/.private"] {
            assert!(
                shown_names(&shown, &repo, &repo.join(name)).is_err(),
                "{name}"
            );
        }
        assert_eq!(
            shown_names(&shown, &repo, &repo.join("docs")).unwrap(),
            ["plan.md"]
        );
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn a_sidebar_lists_a_folder_through_a_link_only_if_it_stays_in_the_project() {
        let disk = folder("shown-link");
        make(
            &disk,
            &[
                "repo/.git/",
                "repo/docs/plan.md",
                "repo/.hidden/docs/note.md",
                "elsewhere/secret.md",
            ],
        );
        let repo = disk.join("repo");
        symlink(disk.join("elsewhere"), repo.join("out")).unwrap();
        symlink(repo.join("docs"), repo.join("in")).unwrap();
        symlink(repo.join(".hidden/docs"), repo.join("hidden-in")).unwrap();
        let shown = [repo.clone()];
        assert!(shown_names(&shown, &repo, &repo.join("out")).is_err());
        assert_eq!(
            shown_names(&shown, &repo, &repo.join("in")).unwrap(),
            ["plan.md"]
        );
        // The sidebar lists a link, by the name it has, and what it leads to inside the project,
        // though not that folder by its own name.
        assert_eq!(
            shown_names(&shown, &repo, &repo.join("hidden-in")).unwrap(),
            ["note.md"]
        );
        assert!(shown_names(&shown, &repo, &repo.join(".hidden/docs")).is_err());
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn a_project_folder_that_is_a_link_is_a_root_as_it_is_given_or_as_it_really_is() {
        let disk = folder("shown-root-link");
        make(&disk, &["cloud/notes/.git/", "cloud/notes/docs/plan.md"]);
        let real = disk.join("cloud/notes");
        let link = disk.join("notes");
        symlink(&real, &link).unwrap();
        // The sidebar shows the folder by the path the window holds, which goes through the link.
        let shown = [link.clone()];
        for (root, below) in [
            (&link, link.join("docs")),
            (&real, real.join("docs")),
            // A root as the window holds it, and the folder as it really is.
            (&link, real.join("docs")),
        ] {
            assert_eq!(shown_names(&shown, root, &below).unwrap(), ["plan.md"]);
            assert!(shown_names(&shown, root, &disk).is_err());
        }
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn a_refusal_says_nothing_of_whether_the_folder_is_there() {
        let disk = folder("shown-alike");
        make(&disk, &["repo/.git/", "elsewhere/secret.md"]);
        let shown = [disk.join("repo")];
        let there = |name: &str| {
            let folder = disk.join(name);
            shown_names(&shown, &folder, &folder).unwrap_err()
        };
        // The same line for a folder that is there and one that isn't, but for the name.
        assert_eq!(
            there("elsewhere").replace("elsewhere", "X"),
            there("nowhere").replace("nowhere", "X")
        );
        fs::remove_dir_all(&disk).unwrap();
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
        assert!(list_with(&repo, &repo.join("a"), false).is_err());
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
        // Nothing else: not what the Mac would run, a link, a script, nor text, which Redlines opens
        // itself, if at all.
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

    #[test]
    fn opens_an_image_only_in_a_project_a_sidebar_shows() {
        let disk = folder("open-shown");
        make(
            &disk,
            &[
                "repo/.git/",
                "repo/logo.png",
                "repo/docs/figure.pdf",
                "elsewhere/photo.png",
                "elsewhere/sub/scan.pdf",
            ],
        );
        let (repo, elsewhere) = (disk.join("repo"), disk.join("elsewhere"));
        let shown = [repo.clone()];
        let open = |root: &Path, path: &Path| openable_in(&shown, root, path);
        // The folder the sidebar shows, and an image and a PDF in it.
        assert_eq!(
            open(&repo, &repo.join("logo.png")),
            Ok(fs::canonicalize(repo.join("logo.png")).unwrap())
        );
        assert!(open(&repo, &repo.join("docs/figure.pdf")).is_ok());
        // Named as its own root, any folder on the disk opened its images and PDFs.
        assert!(open(&elsewhere, &elsewhere.join("photo.png")).is_err());
        assert!(open(&elsewhere, &elsewhere.join("sub/scan.pdf")).is_err());
        // Nor does a folder above the project, or the disk's root, serve as the root.
        assert!(open(&disk, &elsewhere.join("photo.png")).is_err());
        assert!(open(&disk, &repo.join("logo.png")).is_err());
        assert!(open(Path::new("/"), &elsewhere.join("photo.png")).is_err());
        // The project's root doesn't reach the folders around it, by name or through `..`.
        assert!(open(&repo, &elsewhere.join("photo.png")).is_err());
        assert!(open(&repo, &repo.join("../elsewhere/photo.png")).is_err());
        // Nor is a folder of the project a root of its own.
        let docs = repo.join("docs");
        assert!(open(&docs, &docs.join("figure.pdf")).is_err());
        // Where no sidebar shows anything, nothing is opened.
        assert!(openable_in(&[], &repo, &repo.join("logo.png")).is_err());
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn a_root_that_starts_from_wherever_the_app_was_started_opens_nothing() {
        let disk = folder("open-relative");
        make(&disk, &["repo/.git/", "repo/logo.png"]);
        let repo = disk.join("repo");
        let shown = [repo.clone()];
        // The project as a path from the app's own folder reaches it.
        let relative = from_the_app(&repo);
        let logo = repo.join("logo.png");
        assert!(openable_in(&shown, &repo, &logo).is_ok());
        assert!(openable_in(&shown, &relative, &logo).is_err());
        // An empty root names no place.
        assert!(openable_in(&shown, Path::new(""), &logo).is_err());
        // Nor is a folder that is shown by such a path a project: no sidebar shows it so.
        assert!(openable_in(std::slice::from_ref(&relative), &repo, &logo).is_err());
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn a_project_folder_that_is_a_link_opens_its_images_as_given_or_as_they_really_are() {
        let disk = folder("open-root-link");
        make(
            &disk,
            &[
                "cloud/notes/.git/",
                "cloud/notes/logo.png",
                "cloud/other.png",
            ],
        );
        let (real, link) = (disk.join("cloud/notes"), disk.join("notes"));
        symlink(&real, &link).unwrap();
        // The sidebar shows the folder by the path the window holds: through the link.
        let shown = [link.clone()];
        for (root, path) in [
            (&link, link.join("logo.png")),
            (&real, real.join("logo.png")),
            (&link, real.join("logo.png")),
            (&real, link.join("logo.png")),
        ] {
            assert!(
                openable_in(&shown, root, &path).is_ok(),
                "{root:?}, {path:?}"
            );
        }
        // The folders around it are not the project.
        let cloud = disk.join("cloud");
        assert!(openable_in(&shown, &cloud, &cloud.join("other.png")).is_err());
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn a_window_opens_nothing_below_a_hidden_name_in_a_project() {
        let disk = folder("open-hidden");
        make(
            &disk,
            &[
                "repo/.git/",
                "repo/.github/logo.png",
                "repo/.hidden/pic.png",
                "repo/docs/.private/scan.pdf",
                "repo/docs/figure.png",
                ".notes/plan.png",
            ],
        );
        let repo = disk.join("repo");
        // A link the sidebar lists, to an image in a folder it doesn't.
        symlink(repo.join(".hidden/pic.png"), repo.join("pretty.png")).unwrap();
        let shown = [repo.clone()];
        let opens = |name: &str| openable_in(&shown, &repo, &repo.join(name)).is_ok();
        for name in [
            ".github/logo.png",
            ".hidden/pic.png",
            "docs/.private/scan.pdf",
            "pretty.png",
        ] {
            assert!(!opens(name), "{name}");
        }
        assert!(opens("docs/figure.png"));
        // A project that is hidden by its own name opens what is in it.
        let notes = disk.join(".notes");
        let shown = std::slice::from_ref(&notes);
        assert!(openable_in(shown, &notes, &notes.join("plan.png")).is_ok());
        fs::remove_dir_all(&disk).unwrap();
    }

    #[test]
    fn what_is_refused_to_open_reads_alike_whatever_is_there() {
        let disk = folder("open-alike");
        make(
            &disk,
            &[
                "repo/.git/",
                "repo/logo.png",
                "repo/.github/logo.png",
                "elsewhere/photo.png",
                "elsewhere/notes.txt",
            ],
        );
        let (repo, elsewhere) = (disk.join("repo"), disk.join("elsewhere"));
        // Links in the project that lead out of it: to an image, and to what isn't there.
        symlink(elsewhere.join("photo.png"), repo.join("out.png")).unwrap();
        symlink(elsewhere.join("none.png"), repo.join("dangling.png")).unwrap();
        let shown = [repo.clone()];
        for (root, path) in [
            // A root no sidebar shows, with the file there, and not.
            (&elsewhere, elsewhere.join("photo.png")),
            (&elsewhere, elsewhere.join("none.png")),
            // Outside the project: an image that is there, a file that isn't an image, what isn't
            // there, and the links that lead out.
            (&repo, elsewhere.join("photo.png")),
            (&repo, elsewhere.join("notes.txt")),
            (&repo, elsewhere.join("none.png")),
            (&repo, repo.join("out.png")),
            (&repo, repo.join("dangling.png")),
            // Below a hidden name, there or not.
            (&repo, repo.join(".github/logo.png")),
            (&repo, repo.join(".github/none.png")),
            // From nowhere.
            (&repo, PathBuf::from("logo.png")),
        ] {
            let line = openable_in(&shown, root, &path).unwrap_err();
            // One line, which has none of the file system's own words, and none of what is there:
            // only the name that was asked for.
            let name = path.file_name().unwrap().to_string_lossy();
            assert_eq!(line, format!("Couldn’t open “{name}”."), "{path:?}");
        }
        fs::remove_dir_all(&disk).unwrap();
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
    fn the_sidebar_shows_the_project_or_else_the_documents_own_folder() {
        let repo = folder("sidebar-folder");
        make(&repo, &[".git/", "docs/plan.md"]);
        let document = repo.join("docs/plan.md");
        assert_eq!(sidebar_folder(&document, repo.parent()), repo);
        // A repository at home is too broad.
        assert_eq!(sidebar_folder(&document, Some(&repo)), repo.join("docs"));
        assert_eq!(sidebar_folder(Path::new("/plan.md"), None), Path::new("/"));
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn a_window_showing_a_file_shows_its_project_once() {
        let repo = folder("projects");
        make(&repo, &[".git/", "docs/plan.md", "README.md"]);
        let projects = Projects::default();
        assert!(projects.folders().is_empty());
        projects.show(&repo.join("docs/plan.md"));
        projects.show(&repo.join("README.md"));
        assert_eq!(projects.folders(), [repo.as_path()]);
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn opens_only_files_in_a_project_a_window_shows() {
        let outside = folder("shown-in");
        make(
            &outside,
            &[
                "repo/.git/",
                "repo/docs/plan.md",
                "repo/vendor/lib/.git/",
                "repo/vendor/lib/notes.md",
                "other/notes.md",
            ],
        );
        let repo = outside.join("repo");
        let shown = |folders: &[PathBuf], path: &Path| shown_in(folders, path, false);
        // No window shows anything yet.
        assert!(shown(&[], &repo.join("docs/plan.md")).is_err());
        let folders = [repo.clone()];
        assert!(shown(&folders, &repo.join("docs/plan.md")).is_ok());
        // A repository inside the project, which the sidebar lists as one of its folders.
        assert!(shown(&folders, &repo.join("vendor/lib/notes.md")).is_ok());
        // By another path to the same folder.
        symlink(&repo, outside.join("link")).unwrap();
        assert!(shown(&folders, &outside.join("link/docs/plan.md")).is_ok());
        // Another project, and what is above this one.
        assert!(shown(&folders, &outside.join("other/notes.md")).is_err());
        assert!(shown(&folders, &repo.join("../other/notes.md")).is_err());
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn allows_a_document_the_sidebar_shows() {
        let repo = folder("allow");
        let names = [
            "README.md",
            "docs/plan.MD",
            "docs/talk.qmd",
            "docs/analysis.Rmd",
            "docs/deep/er/notes.markdown",
            "notes.txt",
            "docs/TODO.TXT",
        ];
        make(&repo, &[".git/"]);
        make(&repo, &names);
        for name in names {
            assert_eq!(
                document_file(&repo, &repo.join(name), false),
                Ok(fs::canonicalize(repo.join(name)).unwrap()),
                "{name}"
            );
        }
        // Through a link inside the project to a Markdown file inside it, as the file it names.
        symlink(repo.join("docs/plan.MD"), repo.join("plan-link.md")).unwrap();
        assert_eq!(
            document_file(&repo, &repo.join("plan-link.md"), false),
            Ok(fs::canonicalize(repo.join("docs/plan.MD")).unwrap())
        );
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn allow_document_refuses_a_path_outside_the_root() {
        let outside = folder("allow-outside");
        make(&outside, &["secret.md", "repo/.git/", "repo/docs/plan.md"]);
        let repo = outside.join("repo");
        let allow = |path: &Path| document_file(&repo, path, false);
        assert!(allow(&outside.join("secret.md")).is_err());
        assert!(allow(&repo.join("../secret.md")).is_err());
        assert!(allow(&repo.join("docs/../../secret.md")).is_err());
        // A link inside the project to a file outside it, and one to a folder outside it.
        symlink(outside.join("secret.md"), repo.join("linked.md")).unwrap();
        assert!(allow(&repo.join("linked.md")).is_err());
        symlink(&outside, repo.join("out")).unwrap();
        assert!(allow(&repo.join("out/secret.md")).is_err());
        // A path from nowhere, and the root itself.
        assert!(allow(Path::new("docs/plan.md")).is_err());
        assert!(allow(&repo).is_err());
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn allow_document_refuses_a_file_that_is_not_a_document() {
        let repo = folder("allow-kind");
        make(
            &repo,
            &[
                ".git/",
                "main.ts",
                "notes.text",
                "package.json",
                "folder.md/",
                "agent.plist",
            ],
        );
        for name in [
            "main.ts",
            "notes.text",
            "package.json",
            "folder.md",
            "agent.plist",
            "missing.md",
            "missing.txt",
        ] {
            assert!(
                document_file(&repo, &repo.join(name), false).is_err(),
                "{name}"
            );
        }
        // The file a link names decides, not the link's name.
        symlink("agent.plist", repo.join("readme.md")).unwrap();
        assert!(document_file(&repo, &repo.join("readme.md"), false).is_err());
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn allow_document_refuses_what_the_sidebar_hides() {
        let repo = folder("allow-hidden");
        let hidden = [
            ".notes.md",
            ".notes.txt",
            ".github/README.md",
            ".claude/commands/review.md",
            "dist/plan.md",
            "drafts/old.md",
            "drafts/old.txt",
        ];
        make(&repo, &[".git/", "plan.md", "notes.txt"]);
        make(&repo, &hidden);
        fs::write(repo.join(".gitignore"), "/dist\nold.md\nold.txt\n").unwrap();
        for name in hidden {
            assert!(
                document_file(&repo, &repo.join(name), false).is_err(),
                "{name}"
            );
        }
        assert!(document_file(&repo, &repo.join("plan.md"), false).is_ok());
        assert!(document_file(&repo, &repo.join("notes.txt"), false).is_ok());
        // A link that the sidebar shows, to a file it hides.
        symlink(".claude/commands/review.md", repo.join("review.md")).unwrap();
        assert!(document_file(&repo, &repo.join("review.md"), false).is_err());
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
