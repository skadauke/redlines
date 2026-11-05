//! The `redlines` command line, installed from Preferences. The program ships inside the app
//! (next to the app's own executable); installing it links `~/.local/bin/redlines` to that copy, so
//! that it stays the copy of the app that is installed: an update replaces the app, and the link
//! follows. Nothing is copied, nothing needs an administrator, and nothing but this one link is
//! ever replaced: a real file, or a link to something else, is somebody else's.

use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

const PROGRAM: &str = "redlines";

/// What installing did, for Preferences: where the link is, and whether the folder it is in is
/// on the shell's `PATH`, so that typing `redlines` finds it. The window reads both by name.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Linked {
    pub linked: String,
    pub on_path: bool,
}

/// Links `<home>/.local/bin/redlines` to `program`. Linking again does nothing; a link left by
/// an earlier install, to a program of that name that is somewhere else or gone, is replaced.
/// `path` is the `PATH` that tells `on_path`.
pub fn install_in(home: &Path, program: &Path, path: &str) -> Result<Linked, String> {
    if !program.is_file() {
        return Err(format!(
            "The redlines program isn’t in this copy of Redlines ({} is missing).",
            program.display()
        ));
    }
    let folder = home.join(".local").join("bin");
    let link = folder.join(PROGRAM);
    std::fs::create_dir_all(&folder)
        .map_err(|error| format!("Couldn’t make {}: {error}", folder.display()))?;
    match std::fs::read_link(&link) {
        Ok(target) if target == program => {}
        Ok(target) if is_app_program(&target) => {
            std::fs::remove_file(&link)
                .and_then(|()| symlink(program, &link))
                .map_err(|error| format!("Couldn’t replace {}: {error}", link.display()))?;
        }
        Ok(_) => return Err(not_ours(&link, "a link to something else")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            symlink(program, &link)
                .map_err(|error| format!("Couldn’t link {}: {error}", link.display()))?;
        }
        // Not a link: a real file or folder is there.
        Err(_) => return Err(not_ours(&link, "a file")),
    }
    Ok(Linked {
        linked: link.to_string_lossy().into_owned(),
        on_path: on_path(&folder, path),
    })
}

/// Whether a link's target is the program of some copy of the app: `….app/Contents/MacOS/redlines`.
/// Only such a link is Redlines' own; a link to another `redlines` is a person's.
fn is_app_program(target: &Path) -> bool {
    let mut parts = target.components().rev();
    let name = parts.next().map(|part| part.as_os_str());
    let folder = parts.next().map(|part| part.as_os_str());
    let contents = parts.next().map(|part| part.as_os_str());
    let app = parts.next().map(|part| Path::new(part.as_os_str()));
    name == Some(OsStr::new(PROGRAM))
        && folder == Some(OsStr::new("MacOS"))
        && contents == Some(OsStr::new("Contents"))
        && app.is_some_and(|app| app.extension() == Some(OsStr::new("app")))
}

fn not_ours(link: &Path, what: &str) -> String {
    format!(
        "{} is {what} of its own, so Redlines left it.",
        link.display()
    )
}

#[cfg(unix)]
fn symlink(program: &Path, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(program, link)
}

#[cfg(not(unix))]
fn symlink(_program: &Path, _link: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "links are made on macOS and Linux only",
    ))
}

/// Whether `folder` is one of the folders of `path`.
fn on_path(folder: &Path, path: &str) -> bool {
    std::env::split_paths(path).any(|entry| entry == folder)
}

/// The program that ships in this copy of the app, next to the app's own executable.
fn shipped_program() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    Ok(exe.with_file_name(PROGRAM))
}

/// The `PATH` a login shell has. An app opened from Finder has a short one of its own, so the
/// shell is asked too; when it can't be, that one stands.
fn shell_path() -> String {
    let own = std::env::var("PATH").unwrap_or_default();
    let Ok(shell) = std::env::var("SHELL") else {
        return own;
    };
    match std::process::Command::new(shell)
        .args(["-l", "-c", "printf %s \"$PATH\""])
        .output()
    {
        Ok(output) if output.status.success() => {
            format!("{own}:{}", String::from_utf8_lossy(&output.stdout))
        }
        _ => own,
    }
}

/// Links the `redlines` command line into `~/.local/bin`. Until the program ships in the app, it
/// says so.
#[tauri::command(async)]
pub fn install_command_line() -> Result<Linked, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("Redlines can’t tell where your home folder is.")?;
    install_in(&home, &shipped_program()?, &shell_path())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    /// A temporary home with the app's program in it, and the program's path.
    fn home(name: &str) -> (PathBuf, PathBuf) {
        let home = std::env::temp_dir().join(format!("redlines-cli-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let app = home.join("Applications/Redlines.app/Contents/MacOS");
        std::fs::create_dir_all(&app).unwrap();
        let program = app.join(PROGRAM);
        std::fs::write(&program, "#!/bin/sh\n").unwrap();
        (home, program)
    }

    fn link_of(home: &Path) -> PathBuf {
        home.join(".local/bin").join(PROGRAM)
    }

    #[test]
    fn links_the_program_once() {
        let (home, program) = home("once");
        let linked = install_in(&home, &program, "/usr/bin").unwrap();
        assert_eq!(linked.linked, link_of(&home).to_string_lossy());
        assert_eq!(std::fs::read_link(link_of(&home)).unwrap(), program);
        // Again: the same link, nothing changes.
        assert_eq!(install_in(&home, &program, "/usr/bin").unwrap(), linked);
        assert_eq!(std::fs::read_link(link_of(&home)).unwrap(), program);
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn replaces_its_own_stale_link() {
        let (home, program) = home("stale");
        std::fs::create_dir_all(home.join(".local/bin")).unwrap();
        // An earlier install, from a copy of the app that has moved.
        symlink(
            "/Volumes/Redlines/Redlines.app/Contents/MacOS/redlines",
            link_of(&home),
        )
        .unwrap();
        install_in(&home, &program, "").unwrap();
        assert_eq!(std::fs::read_link(link_of(&home)).unwrap(), program);
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn refuses_to_replace_a_real_file_or_somebody_elses_link() {
        let (home, program) = home("refuse");
        std::fs::create_dir_all(home.join(".local/bin")).unwrap();
        std::fs::write(link_of(&home), "mine").unwrap();
        let error = install_in(&home, &program, "").unwrap_err();
        assert!(error.contains("left it"), "{error}");
        assert_eq!(std::fs::read_to_string(link_of(&home)).unwrap(), "mine");

        std::fs::remove_file(link_of(&home)).unwrap();
        symlink("/opt/node/bin/redlines-cli", link_of(&home)).unwrap();
        assert!(install_in(&home, &program, "").is_err());
        // Nor a link to another program that is also called redlines.
        std::fs::remove_file(link_of(&home)).unwrap();
        symlink("/opt/node/bin/redlines", link_of(&home)).unwrap();
        assert!(install_in(&home, &program, "").is_err());
        assert_eq!(
            std::fs::read_link(link_of(&home)).unwrap(),
            Path::new("/opt/node/bin/redlines")
        );
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn says_when_the_program_is_not_in_the_app() {
        let (home, program) = home("missing");
        std::fs::remove_file(&program).unwrap();
        let error = install_in(&home, &program, "").unwrap_err();
        assert!(error.contains("isn’t in this copy"), "{error}");
        assert!(!link_of(&home).exists());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn reports_whether_the_folder_is_on_the_path() {
        let (home, program) = home("path");
        let bin = home.join(".local/bin");
        let on = format!("/usr/bin:{}", bin.display());
        assert!(install_in(&home, &program, &on).unwrap().on_path);
        assert!(
            !install_in(&home, &program, "/usr/bin:/bin")
                .unwrap()
                .on_path
        );
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn reaches_the_window_by_name() {
        let linked = Linked {
            linked: "/h/.local/bin/redlines".to_owned(),
            on_path: true,
        };
        assert_eq!(
            serde_json::to_value(linked).unwrap(),
            serde_json::json!({ "linked": "/h/.local/bin/redlines", "onPath": true })
        );
    }
}
