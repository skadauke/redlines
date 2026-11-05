// What File › Rename…, Reveal in Finder and Print… need from the app: renaming a file in its folder
// without losing the window's permission to use it, showing it in the file manager, and printing the
// window. The window's page asks for these by name (`src/host.ts`).

use std::io;
use std::path::Path;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_fs::FsExt;

use crate::file_scope::{self, Remembered};
use crate::windows::Windows;

/// What the window gets back when the new name is taken, for it to say so (`host.ts`).
const EXISTS: &str = "exists";

/// Renames the window's own document within its folder, and lets the window go on using it under
/// the new name, as it could under the old. The file's watch is the window's to move
/// (`src/document.ts`).
///
/// Only the file the window holds (`window_document`), and only a plain file: the page has no
/// business renaming anything else. Never replaces a file: a name that is taken is refused with
/// "exists". Not to a hidden name, which could be another program's settings.
#[tauri::command(async)]
pub fn rename_file(
    app: AppHandle,
    window: WebviewWindow,
    from: String,
    to: String,
) -> Result<(), String> {
    let scope = app.fs_scope();
    let windows = app.state::<Windows>();
    let (from, to) = (Path::new(&from), Path::new(&to));
    let may_use = |path: &Path| file_scope::allowed(&scope, path);
    check_own_file(&windows, window.label(), from, true, may_use)?;
    check_names(from, to)?;
    // As the next launch would allow it again, while it is there to look at.
    let remembered_as = file_scope::real(from);
    rename_without_replacing(from, to).map_err(|error| match error.kind() {
        io::ErrorKind::AlreadyExists => EXISTS.to_owned(),
        _ => format!("{}: {error}", from.display()),
    })?;
    // The window may use its document by the document's path (`file_scope`), which has just
    // changed. The old name is no file of the person's any more, and isn't allowed at the next
    // launch.
    scope.allow_file(to).map_err(|error| error.to_string())?;
    windows.renamed(window.label(), &to.to_string_lossy());
    app.state::<Remembered>()
        .forget(&remembered_as.to_string_lossy());
    Ok(())
}

/// Whether `path` is the document of the window `label`, a file the window `may_use`, and, for
/// `plain`, a plain file: not a folder, and not a link, whose own name a rename would change and not
/// the file's. A window's document is what it says it is (`window_document`), or the file it was
/// opened for (`open_window`), which the page names too: only the scope says what it may use.
fn check_own_file(
    windows: &Windows,
    label: &str,
    path: &Path,
    plain: bool,
    may_use: impl Fn(&Path) -> bool,
) -> Result<(), String> {
    let refused = || format!("{}: not this window's file", path.display());
    let held = path.to_str().is_some_and(|path| windows.holds(label, path));
    if !held || !may_use(path) {
        return Err(refused());
    }
    if plain && !std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file()) {
        return Err(refused());
    }
    Ok(())
}

/// Whether `to` is another name for the file at `from`, in its folder.
fn check_names(from: &Path, to: &Path) -> Result<(), String> {
    let name = to.file_name().and_then(|name| name.to_str());
    match name {
        None => return Err("the new name is not a file name".to_owned()),
        Some(name) if name.starts_with('.') => {
            return Err("a file can't be renamed to a hidden name".to_owned());
        }
        Some(_) => {}
    }
    if from.parent() != to.parent() {
        return Err("a file is renamed within its folder".to_owned());
    }
    Ok(())
}

/// Renames `from` to `to`, failing with `AlreadyExists` where a file would be replaced. A name that
/// differs from the old one only in case (on a file system that doesn't tell them apart) is the same
/// file, and is allowed.
fn rename_without_replacing(from: &Path, to: &Path) -> io::Result<()> {
    // The same file when `to` is no link and leads to `from`: a link to it is another file, which a
    // rename would replace.
    let to_is_link = std::fs::symlink_metadata(to).is_ok_and(|meta| meta.is_symlink());
    if !to_is_link
        && let (Ok(old), Ok(new)) = (std::fs::canonicalize(from), std::fs::canonicalize(to))
        && old == new
    {
        return std::fs::rename(from, to);
    }
    exclusive_rename(from, to)
}

/// The rename the system itself refuses to let replace a file, so that nothing can take the name
/// between looking and renaming.
#[cfg(target_os = "macos")]
fn exclusive_rename(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let c_path = |path: &Path| {
        CString::new(path.as_os_str().as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "a path with a NUL"))
    };
    let (from, to) = (c_path(from)?, c_path(to)?);
    // SAFETY: both are NUL-terminated strings that live through the call.
    let status = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    if status == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn exclusive_rename(from: &Path, to: &Path) -> io::Result<()> {
    // `hard_link` refuses a name that is taken, and is as atomic as a rename.
    std::fs::hard_link(from, to)?;
    std::fs::remove_file(from)
}

/// Shows the window's own document in the file manager, selected.
#[tauri::command(async)]
pub fn reveal_in_finder(app: AppHandle, window: WebviewWindow, path: String) -> Result<(), String> {
    let file = Path::new(&path);
    let scope = app.fs_scope();
    let may_use = |path: &Path| file_scope::allowed(&scope, path);
    check_own_file(
        &app.state::<Windows>(),
        window.label(),
        file,
        false,
        may_use,
    )?;
    reveal(file).map_err(|error| format!("{path}: {error}"))
}

#[cfg(target_os = "macos")]
fn reveal(file: &Path) -> io::Result<()> {
    run(std::process::Command::new("open").arg("-R").arg(file))
}

#[cfg(windows)]
fn reveal(file: &Path) -> io::Result<()> {
    let mut select = std::ffi::OsString::from("/select,");
    select.push(file);
    // Explorer exits with 1 even when it worked.
    std::process::Command::new("explorer")
        .arg(select)
        .status()
        .map(drop)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn reveal(file: &Path) -> io::Result<()> {
    run(std::process::Command::new("xdg-open").arg(file.parent().unwrap_or(file)))
}

#[cfg(not(windows))]
fn run(command: &mut std::process::Command) -> io::Result<()> {
    let status = command.status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "{command:?} exited with {status}"
        )))
    }
}

/// Opens the print dialog for the window's page. The page makes itself ready first (`src/print.ts`).
#[tauri::command]
pub fn print_window(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("redlines-files-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn renames_a_file_and_keeps_its_bytes() {
        let dir = folder("renames");
        std::fs::write(dir.join("plan.md"), b"One\r\n").unwrap();
        rename_without_replacing(&dir.join("plan.md"), &dir.join("outline.md")).unwrap();
        assert!(!dir.join("plan.md").exists());
        assert_eq!(std::fs::read(dir.join("outline.md")).unwrap(), b"One\r\n");
    }

    #[test]
    fn refuses_to_replace_a_file() {
        let dir = folder("refuses");
        std::fs::write(dir.join("plan.md"), "mine").unwrap();
        std::fs::write(dir.join("other.md"), "theirs").unwrap();
        let error = rename_without_replacing(&dir.join("plan.md"), &dir.join("other.md"));
        assert_eq!(error.unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(dir.join("other.md")).unwrap(), b"theirs");
        assert_eq!(std::fs::read(dir.join("plan.md")).unwrap(), b"mine");
    }

    #[test]
    fn allows_a_change_of_case_alone() {
        let dir = folder("case");
        std::fs::write(dir.join("plan.md"), "mine").unwrap();
        rename_without_replacing(&dir.join("plan.md"), &dir.join("Plan.md")).unwrap();
        let names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["Plan.md"]);
    }

    #[test]
    #[cfg(unix)]
    fn a_link_to_the_file_is_another_file_and_is_not_replaced() {
        let dir = folder("link");
        std::fs::write(dir.join("plan.md"), "mine").unwrap();
        std::os::unix::fs::symlink(dir.join("plan.md"), dir.join("alias.md")).unwrap();
        let error = rename_without_replacing(&dir.join("plan.md"), &dir.join("alias.md"));
        assert_eq!(error.unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        assert!(
            dir.join("alias.md")
                .symlink_metadata()
                .unwrap()
                .is_symlink()
        );
        assert_eq!(std::fs::read(dir.join("plan.md")).unwrap(), b"mine");
    }

    #[test]
    fn acts_only_on_the_file_the_window_holds() {
        let dir = folder("own");
        let (mine, other) = (dir.join("plan.md"), dir.join("other.md"));
        std::fs::write(&mine, "mine").unwrap();
        std::fs::write(&other, "other").unwrap();
        let windows = Windows::with_document("doc-1", mine.to_str().unwrap());
        assert!(check_own_file(&windows, "doc-1", &mine, true, |_| true).is_ok());
        // Another file of the folder, another window's file, a folder: refused.
        assert!(check_own_file(&windows, "doc-1", &other, true, |_| true).is_err());
        assert!(check_own_file(&windows, "doc-2", &mine, true, |_| true).is_err());
        assert!(check_own_file(&windows, "doc-1", &dir, false, |_| true).is_err());
        // A file the window may not use, though the page says the window holds it.
        assert!(check_own_file(&windows, "doc-1", &mine, true, |_| false).is_err());
        assert!(check_own_file(&windows, "doc-1", &mine, false, |_| false).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn will_not_rename_a_folder_or_a_link_the_window_holds() {
        let dir = folder("plain");
        let (file, link) = (dir.join("plan.md"), dir.join("link.md"));
        std::fs::write(&file, "mine").unwrap();
        std::os::unix::fs::symlink(&file, &link).unwrap();
        let windows = Windows::with_document("doc-1", link.to_str().unwrap());
        assert!(check_own_file(&windows, "doc-1", &link, true, |_| true).is_err());
        // Showing it in the file manager is no change to it.
        assert!(check_own_file(&windows, "doc-1", &link, false, |_| true).is_ok());
        let windows = Windows::with_document("doc-1", dir.to_str().unwrap());
        assert!(check_own_file(&windows, "doc-1", &dir, true, |_| true).is_err());
    }

    #[test]
    fn a_rename_is_noted_for_the_next() {
        let windows = Windows::with_document("doc-1", "/docs/plan.md");
        windows.renamed("doc-1", "/docs/outline.md");
        assert!(windows.holds("doc-1", "/docs/outline.md"));
        assert!(!windows.holds("doc-1", "/docs/plan.md"));
    }

    #[test]
    fn only_renames_within_a_folder_to_a_name_that_is_not_hidden() {
        let (from, folder) = (Path::new("/docs/plan.md"), Path::new("/docs"));
        assert!(check_names(from, &folder.join("outline.md")).is_ok());
        assert!(check_names(from, &folder.join(".zshenv")).is_err());
        assert!(check_names(from, Path::new("/etc/outline.md")).is_err());
        assert!(check_names(from, Path::new("/docs/")).is_err());
        assert!(check_names(from, Path::new("/docs/..")).is_err());
    }
}
