// What File › Rename…, Reveal in Finder and Print… need from the app: renaming a file in its folder
// without losing the window's permission to use it, showing it in the file manager, and printing the
// window. The window's page asks for these by name (`src/host.ts`).

use std::io;
use std::path::Path;

use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_fs::FsExt;

/// What the window gets back when the new name is taken, for it to say so (`host.ts`).
const EXISTS: &str = "exists";

/// Renames a file within its folder, and lets the window go on using it under the new name, as it
/// could under the old. The file's watch is the window's to move (`src/document.ts`).
///
/// Never replaces a file: a name that is taken is refused with "exists". Only a file the window may
/// already use can be renamed, and not to a hidden name, which the file scope keeps out of reach.
#[tauri::command(async)]
pub fn rename_file(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let scope = app.fs_scope();
    let (from, to) = (Path::new(&from), Path::new(&to));
    if !scope.is_allowed(from) {
        return Err(format!("{}: not a file this window may use", from.display()));
    }
    check_names(from, to)?;
    rename_without_replacing(from, to).map_err(|error| match error.kind() {
        io::ErrorKind::AlreadyExists => EXISTS.to_owned(),
        _ => format!("{}: {error}", from.display()),
    })?;
    // A file allowed by itself (one picked in a dialog, outside the home folder) is allowed by its
    // path, which has just changed.
    scope.allow_file(to).map_err(|error| error.to_string())
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
    if let (Ok(old), Ok(new)) = (std::fs::canonicalize(from), std::fs::canonicalize(to))
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

/// Shows a file in the file manager, selected.
#[tauri::command(async)]
pub fn reveal_in_finder(app: AppHandle, path: String) -> Result<(), String> {
    let file = Path::new(&path);
    if !app.fs_scope().is_allowed(file) {
        return Err(format!("{path}: not a file this window may use"));
    }
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
        Err(io::Error::other(format!("{command:?} exited with {status}")))
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
        let dir = std::env::temp_dir().join(format!("redlines-files-{name}-{}", std::process::id()));
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
    fn only_renames_within_a_folder_to_a_name_that_is_not_hidden() {
        let (from, folder) = (Path::new("/docs/plan.md"), Path::new("/docs"));
        assert!(check_names(from, &folder.join("outline.md")).is_ok());
        assert!(check_names(from, &folder.join(".zshenv")).is_err());
        assert!(check_names(from, Path::new("/etc/outline.md")).is_err());
        assert!(check_names(from, Path::new("/docs/")).is_err());
        assert!(check_names(from, Path::new("/docs/..")).is_err());
    }
}
