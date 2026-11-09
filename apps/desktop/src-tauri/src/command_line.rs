//! The `redlines` command line, installed from Preferences. The program ships inside the app
//! (next to the app's own executable); installing it links `~/.local/bin/redlines` to that copy, so
//! that it stays the copy of the app that is installed: an update replaces the app, and the link
//! follows. Nothing is copied, nothing needs an administrator, and nothing but this one link is
//! ever replaced: a real file, or a link to something else, is somebody else's.

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
    link_in(&folder, program).map_err(|unlinked| match unlinked {
        Unlinked::NotOurs(what) => not_ours(&folder.join(PROGRAM), &what),
        Unlinked::Failed(why) => why,
    })?;
    Ok(Linked {
        linked: folder.join(PROGRAM).to_string_lossy().into_owned(),
        on_path: on_path(&folder, path),
    })
}

/// What is where the link goes, which decides what installing does there.
#[derive(Debug, PartialEq)]
enum Found {
    /// Nothing: the link is made.
    Nothing,
    /// A link to this very program: there is nothing to do.
    This,
    /// A link to the program of some copy of the app, left by an earlier install of a copy that
    /// has moved or gone: Redlines' own, and replaced.
    Stale,
    /// Somebody else's file, folder, or link to anything else, which is left as it is: what it is.
    NotOurs(String),
}

/// Tells what is at `link`, byte for byte as the privileged script does (`SCRIPT`).
fn found(link: &Path, program: &Path) -> io::Result<Found> {
    match std::fs::read_link(link) {
        Ok(target) if target.as_os_str() == program.as_os_str() => Ok(Found::This),
        Ok(target) if is_app_program(&target) => Ok(Found::Stale),
        Ok(target) => Ok(Found::NotOurs(format!("a link to {}", target.display()))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Found::Nothing),
        // Not a link: a real file or folder is there.
        Err(error) => match std::fs::symlink_metadata(link) {
            Ok(meta) if meta.is_dir() => Ok(Found::NotOurs("a folder of its own".to_owned())),
            Ok(_) => Ok(Found::NotOurs("a file of its own".to_owned())),
            Err(_) => Err(error),
        },
    }
}

/// Whether a link's target is the program of some copy of the app: it ends in
/// `/Contents/MacOS/redlines`, after a folder whose name is something followed by `.app`. Only such
/// a link is Redlines' own; a link to another `redlines` is a person's. The bytes decide, with no
/// path made tidy first, so that the privileged script tells it the same way.
fn is_app_program(target: &Path) -> bool {
    let target = target.as_os_str().as_encoded_bytes();
    let Some(app) = target.strip_suffix(b"/Contents/MacOS/redlines") else {
        return false;
    };
    let name = app.rsplit(|&byte| byte == b'/').next().unwrap_or_default();
    name.len() > b".app".len() && name.ends_with(b".app")
}

/// Why a link wasn't made.
#[derive(Debug, PartialEq)]
enum Unlinked {
    /// Somebody else's file, folder or link is there, which is left as it is: what it is.
    NotOurs(String),
    /// Making the folder or the link failed: the sentence that says so.
    Failed(String),
}

/// Links `<folder>/redlines` to `program`, making the folder if it isn't there. Only nothing, or
/// Redlines' own link, is ever replaced (`found`).
fn link_in(folder: &Path, program: &Path) -> Result<(), Unlinked> {
    let link = folder.join(PROGRAM);
    let failed = |doing: &str, path: &Path, error: io::Error| {
        Unlinked::Failed(format!("Couldn’t {doing} {}: {error}", path.display()))
    };
    std::fs::create_dir_all(folder).map_err(|error| failed("make", folder, error))?;
    match found(&link, program).map_err(|error| failed("read", &link, error))? {
        Found::This => Ok(()),
        Found::Stale => std::fs::remove_file(&link)
            .and_then(|()| symlink(program, &link))
            .map_err(|error| failed("replace", &link, error)),
        Found::NotOurs(what) => Err(Unlinked::NotOurs(what)),
        Found::Nothing => symlink(program, &link).map_err(|error| failed("link", &link, error)),
    }
}

fn not_ours(link: &Path, what: &str) -> String {
    format!("{} is {what}, so Redlines left it.", link.display())
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
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
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

    /// What a case puts where the link goes.
    enum There {
        Nothing,
        /// A link to the program that is installing.
        ThisProgram,
        /// A link to this target, byte for byte.
        LinkTo(&'static [u8]),
        File,
        Folder,
    }

    /// Everything that can be where the link goes, and whether installing links there (`true`) or
    /// leaves what is there as it is. Only nothing, or a link to the program of some copy of the
    /// app, is Redlines' own: a target that ends in `/Contents/MacOS/redlines` after a folder
    /// named `<something>.app`, exactly.
    const THERE: &[(&str, There, bool)] = &[
        ("nothing", There::Nothing, true),
        ("this program", There::ThisProgram, true),
        (
            "a copy of the app that has gone",
            There::LinkTo(b"/Volumes/Redlines/Redlines.app/Contents/MacOS/redlines"),
            true,
        ),
        (
            "a copy, linked relatively",
            There::LinkTo(b"../Redlines.app/Contents/MacOS/redlines"),
            true,
        ),
        (
            "a copy with a line break in its name",
            There::LinkTo(b"/Users/ada/Old\nRedlines.app/Contents/MacOS/redlines"),
            true,
        ),
        (
            "another program called redlines",
            There::LinkTo(b"/opt/node/bin/redlines"),
            false,
        ),
        (
            "another program",
            There::LinkTo(b"/opt/node/bin/redlines-cli"),
            false,
        ),
        (
            "a folder called only .app",
            There::LinkTo(b"/Users/ada/.app/Contents/MacOS/redlines"),
            false,
        ),
        (
            "no app at all",
            There::LinkTo(b"/Contents/MacOS/redlines"),
            false,
        ),
        (
            "a program whose name only starts with redlines",
            There::LinkTo(b"/Applications/Redlines.app/Contents/MacOS/redlines\n"),
            false,
        ),
        (
            "a doubled slash",
            There::LinkTo(b"/Applications/Redlines.app/Contents//MacOS/redlines"),
            false,
        ),
        (
            "a slash after it",
            There::LinkTo(b"/Applications/Redlines.app/Contents/MacOS/redlines/"),
            false,
        ),
        (
            "another kind of bundle",
            There::LinkTo(b"/Library/Redlines.bundle/Contents/MacOS/redlines"),
            false,
        ),
        ("a file", There::File, false),
        ("a folder", There::Folder, false),
    ];

    /// Puts `there` at `link`, in a folder of its own.
    fn put(there: &There, link: &Path, program: &Path) {
        let _ = std::fs::remove_dir_all(link.parent().unwrap());
        std::fs::create_dir_all(link.parent().unwrap()).unwrap();
        match there {
            There::Nothing => {}
            There::ThisProgram => symlink(program, link).unwrap(),
            There::LinkTo(target) => symlink(OsStr::from_bytes(target), link).unwrap(),
            There::File => std::fs::write(link, "mine").unwrap(),
            There::Folder => std::fs::create_dir(link).unwrap(),
        }
    }

    /// What is at `link`, to tell whether something changed it.
    fn state(link: &Path) -> String {
        match std::fs::symlink_metadata(link) {
            Err(_) => "nothing".to_owned(),
            Ok(meta) if meta.file_type().is_symlink() => {
                format!("a link to {:?}", std::fs::read_link(link).unwrap())
            }
            Ok(meta) if meta.is_dir() => "a folder".to_owned(),
            Ok(_) => format!("a file of {:?}", std::fs::read(link).unwrap()),
        }
    }

    #[test]
    fn links_over_nothing_or_its_own_link_and_leaves_anything_else() {
        let (home, program) = home("there");
        let link = link_of(&home);
        for (case, there, links) in THERE {
            put(there, &link, &program);
            let before = state(&link);
            match install_in(&home, &program, "") {
                Ok(_) => {
                    assert!(*links, "{case}: replaced {before}");
                    assert_eq!(std::fs::read_link(&link).unwrap(), program, "{case}");
                }
                Err(error) => {
                    assert!(!*links, "{case}: {error}");
                    assert!(error.ends_with(", so Redlines left it."), "{case}: {error}");
                    assert_eq!(state(&link), before, "{case}");
                }
            }
        }
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn replaces_its_own_link_to_a_folder_and_leaves_the_folder() {
        let (home, program) = home("folder-link");
        let old = home.join("Old.app/Contents/MacOS/redlines");
        std::fs::create_dir_all(old.join("inside")).unwrap();
        put(&There::Nothing, &link_of(&home), &program);
        symlink(&old, link_of(&home)).unwrap();
        install_in(&home, &program, "").unwrap();
        assert_eq!(std::fs::read_link(link_of(&home)).unwrap(), program);
        assert!(old.join("inside").is_dir());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn says_what_is_there_when_it_is_somebody_elses() {
        let (home, program) = home("words");
        let link = link_of(&home);
        let said = |there: There| {
            put(&there, &link, &program);
            install_in(&home, &program, "").unwrap_err()
        };
        let shown = link.display();
        assert_eq!(
            said(There::File),
            format!("{shown} is a file of its own, so Redlines left it.")
        );
        assert_eq!(
            said(There::Folder),
            format!("{shown} is a folder of its own, so Redlines left it.")
        );
        assert_eq!(
            said(There::LinkTo(b"/opt/node/bin/redlines")),
            format!("{shown} is a link to /opt/node/bin/redlines, so Redlines left it.")
        );
        std::fs::remove_dir_all(&home).unwrap();
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
