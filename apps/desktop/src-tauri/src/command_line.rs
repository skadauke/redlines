//! The `redlines` command line, installed from Preferences. The program ships inside the app
//! (next to the app's own executable); installing it links `/usr/local/bin/redlines` to that copy.
//! macOS puts that folder on every shell's `PATH` (`/etc/paths`), so `redlines` works in any new
//! Terminal window, and the link keeps to the copy of the app that is installed: an update replaces
//! the app, and the link follows. Nothing is copied, and nothing but this one link is ever
//! replaced: a real file, or a link to something else, is somebody else's.
//!
//! Where `/usr/local/bin` needs an administrator, macOS asks for the password in its own dialog
//! (`administrator.rs`), and the app never sees it. When there is none to be had, because the
//! person cancelled or isn't one, the link can go in `~/.local/bin` instead, which needs nobody,
//! and Preferences says when that folder isn't on the shell's `PATH`.

use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

// The one script that runs as an administrator, and how `osascript` is asked to run it. Only macOS
// asks; elsewhere it is built for its tests alone.
#[cfg(any(target_os = "macos", test))]
mod administrator;
#[cfg(target_os = "macos")]
use administrator::as_administrator;

const PROGRAM: &str = "redlines";

/// The folder macOS puts on every shell's `PATH` (`/etc/paths`), where the command line is linked.
const SHARED_FOLDER: &str = "/usr/local/bin";

/// Where a link is, and whether the folder it is in is on the shell's `PATH`, so that typing
/// `redlines` finds it. The window reads both by name.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Linked {
    pub linked: String,
    pub on_path: bool,
}

/// What installing in `/usr/local/bin` did, for Preferences, which tells it by `outcome`.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum Installed {
    /// The link is there: made, replaced, or found as it should be.
    Linked(Linked),
    /// Only an administrator could link there, and macOS didn't get one's password: the person
    /// cancelled its dialog, or couldn't give it.
    Cancelled,
    /// Linking there failed for another reason, which the sentence says.
    Failed { why: String },
}

/// What linking as an administrator did.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, PartialEq)]
pub enum Privileged {
    /// The link is there.
    Linked,
    /// Somebody else's file, folder or link is there, and the script left it.
    Left,
    /// macOS didn't get an administrator's password: the person cancelled, or couldn't give one.
    Cancelled,
    /// Something else failed: what macOS or the script said.
    Failed(String),
}

/// Links `<folder>/redlines` to `program`, where `folder` is one every shell's `PATH` has
/// (`/usr/local/bin`). It decides as `install_in` does, and links without asking anyone where it
/// may. Only where nothing, or Redlines' own link, is there and the folder needs an administrator
/// does `administrator` link it, deciding again as it does. `path` is the `PATH` that tells
/// `on_path`.
pub fn install_shared(
    folder: &Path,
    program: &Path,
    path: &str,
    administrator: impl FnOnce(&Path, &Path) -> Privileged,
) -> Result<Installed, String> {
    shipped(program)?;
    let link = folder.join(PROGRAM);
    let linked = || {
        Installed::Linked(Linked {
            linked: link.to_string_lossy().into_owned(),
            on_path: on_path(folder, path),
        })
    };
    match link_in(folder, program) {
        Ok(()) => Ok(linked()),
        Err(Unlinked::NotOurs(what)) => Err(not_ours(&link, &what)),
        Err(Unlinked::Failed { why, denied: false }) => Ok(Installed::Failed { why }),
        Err(Unlinked::Failed { denied: true, .. }) => match administrator(program, &link) {
            Privileged::Linked => Ok(linked()),
            Privileged::Left => {
                // Something came there between the look above and the administrator's.
                let what = match found(&link, program) {
                    Ok(Found::NotOurs(what)) => what,
                    _ => "something of its own".to_owned(),
                };
                Err(not_ours(&link, &what))
            }
            Privileged::Cancelled => Ok(Installed::Cancelled),
            Privileged::Failed(why) => Ok(Installed::Failed {
                why: format!("Couldn’t link {}: {why}", link.display()),
            }),
        },
    }
}

/// Links `<home>/.local/bin/redlines` to `program`, which needs no administrator. Linking again
/// does nothing; a link left by an earlier install, to a program of that name that is somewhere
/// else or gone, is replaced. `path` is the `PATH` that tells `on_path`.
pub fn install_in(home: &Path, program: &Path, path: &str) -> Result<Linked, String> {
    shipped(program)?;
    let folder = home.join(".local").join("bin");
    link_in(&folder, program).map_err(|unlinked| match unlinked {
        Unlinked::NotOurs(what) => not_ours(&folder.join(PROGRAM), &what),
        Unlinked::Failed { why, .. } => why,
    })?;
    Ok(Linked {
        linked: folder.join(PROGRAM).to_string_lossy().into_owned(),
        on_path: on_path(&folder, path),
    })
}

/// Says so when the program isn't in this copy of the app.
fn shipped(program: &Path) -> Result<(), String> {
    if program.is_file() {
        return Ok(());
    }
    Err(format!(
        "The redlines program isn’t in this copy of Redlines ({} is missing).",
        program.display()
    ))
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

/// Tells what is at `link`, byte for byte as the privileged script does
/// (`administrator::SCRIPT`).
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
    /// Making the folder or the link failed: the sentence that says so, and whether it was for
    /// want of an administrator.
    Failed { why: String, denied: bool },
}

/// Links `<folder>/redlines` to `program`, making the folder if it isn't there. Only nothing, or
/// Redlines' own link, is ever replaced (`found`).
fn link_in(folder: &Path, program: &Path) -> Result<(), Unlinked> {
    let link = folder.join(PROGRAM);
    let failed = |doing: &str, path: &Path, error: io::Error| Unlinked::Failed {
        why: format!("Couldn’t {doing} {}: {error}", path.display()),
        denied: error.kind() == io::ErrorKind::PermissionDenied,
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

/// Off macOS, Redlines asks for no administrator, and leaves a folder that needs one as it is.
#[cfg(not(target_os = "macos"))]
fn as_administrator(_program: &Path, _link: &Path) -> Privileged {
    Privileged::Failed("only an administrator can".to_owned())
}

/// Links the `redlines` command line in `/usr/local/bin`, asking macOS for an administrator where
/// that folder needs one.
#[tauri::command(async)]
pub fn install_command_line() -> Result<Installed, String> {
    install_shared(
        Path::new(SHARED_FOLDER),
        &shipped_program()?,
        &shell_path(),
        as_administrator,
    )
}

/// Links it in `~/.local/bin` instead, which needs no administrator: for when `/usr/local/bin`
/// couldn't be had.
#[tauri::command(async)]
pub fn install_command_line_at_home() -> Result<Linked, String> {
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
    use std::os::unix::fs::{PermissionsExt, symlink};

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
        let to_window = |installed: Installed| serde_json::to_value(installed).unwrap();
        assert_eq!(
            to_window(Installed::Linked(Linked {
                linked: "/usr/local/bin/redlines".to_owned(),
                on_path: true,
            })),
            serde_json::json!({
                "outcome": "linked",
                "linked": "/usr/local/bin/redlines",
                "onPath": true,
            })
        );
        assert_eq!(
            to_window(Installed::Cancelled),
            serde_json::json!({ "outcome": "cancelled" })
        );
        assert_eq!(
            to_window(Installed::Failed {
                why: "Couldn’t make /usr/local/bin: Not a directory".to_owned(),
            }),
            serde_json::json!({
                "outcome": "failed",
                "why": "Couldn’t make /usr/local/bin: Not a directory",
            })
        );
    }

    /// Runs the script that links as an administrator, as the person running the tests and never
    /// as an administrator, with nothing in its environment and `cwd` as its folder, as the app
    /// runs it. What it printed, and whether it succeeded.
    fn run_script(program: &Path, link: &Path, cwd: &Path) -> (String, bool) {
        let output = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(administrator::SCRIPT)
            .arg(PROGRAM)
            .arg(program)
            .arg(link)
            .env_clear()
            .current_dir(cwd)
            .output()
            .unwrap();
        (
            String::from_utf8(output.stdout).unwrap(),
            output.status.success(),
        )
    }

    #[test]
    fn the_administrators_script_decides_as_the_app_does() {
        let (home, program) = home("script");
        let link = home.join("usr/local/bin").join(PROGRAM);
        let cwd = home.join("cwd");
        std::fs::create_dir(&cwd).unwrap();
        for (case, there, links) in THERE {
            put(there, &link, &program);
            let before = state(&link);
            let (said, succeeded) = run_script(&program, &link, &cwd);
            assert!(succeeded, "{case}");
            if *links {
                assert_eq!(said, "linked\n", "{case}");
                assert_eq!(std::fs::read_link(&link).unwrap(), program, "{case}");
            } else {
                assert_eq!(said, "left\n", "{case}");
                assert_eq!(state(&link), before, "{case}");
            }
        }
        // Its own link to a folder: the link is replaced, and the folder is left.
        let old = home.join("Old.app/Contents/MacOS/redlines");
        std::fs::create_dir_all(old.join("inside")).unwrap();
        put(&There::Nothing, &link, &program);
        symlink(&old, &link).unwrap();
        assert_eq!(
            run_script(&program, &link, &cwd),
            ("linked\n".to_owned(), true)
        );
        assert_eq!(std::fs::read_link(&link).unwrap(), program);
        assert!(old.join("inside").is_dir());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn the_administrators_script_takes_any_path_as_it_is_and_runs_nothing_in_it() {
        let (home, _) = home("script-paths");
        let cwd = home.join("cwd");
        std::fs::create_dir(&cwd).unwrap();
        let program = home.join(
            "My \"Apps\" it's $HOME `touch ticked` $(touch dollared);touch semi\nnext line\\\
             /Redlines.app/Contents/MacOS/redlines",
        );
        // The folder isn't there yet: the script makes it, as an administrator would.
        let folder = home.join("usr/local/bin");
        let link = folder.join(PROGRAM);
        assert_eq!(
            run_script(&program, &link, &cwd),
            ("linked\n".to_owned(), true)
        );
        assert_eq!(
            std::fs::read_link(&link).unwrap().as_os_str().as_bytes(),
            program.as_os_str().as_bytes()
        );
        assert_eq!(
            std::fs::metadata(&folder).unwrap().permissions().mode() & 0o777,
            0o755
        );
        // Nothing in the path ran: no file was made, here or anywhere else in the home.
        assert_eq!(std::fs::read_dir(&cwd).unwrap().count(), 0);
        for made in ["ticked", "dollared", "semi"] {
            assert!(
                !cwd.join(made).exists() && !home.join(made).exists(),
                "{made}"
            );
        }
        // Linking again finds its own link.
        assert_eq!(
            run_script(&program, &link, &cwd),
            ("linked\n".to_owned(), true)
        );
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn the_administrators_script_links_only_a_redlines_from_a_path_that_is_whole() {
        let (home, program) = home("script-refuses");
        let cwd = home.join("cwd");
        std::fs::create_dir(&cwd).unwrap();
        let bin = home.join("bin");
        for (program, link) in [
            (
                Path::new("Redlines.app/Contents/MacOS/redlines"),
                bin.join(PROGRAM),
            ),
            (&program, PathBuf::from("bin/redlines")),
            (&program, bin.join("sudo")),
        ] {
            let (said, succeeded) = run_script(program, &link, &cwd);
            assert!(!succeeded && said.is_empty(), "{}", link.display());
        }
        assert!(!bin.exists());
        assert_eq!(std::fs::read_dir(&cwd).unwrap().count(), 0);
        // A folder it can't make: it fails, and says nothing.
        std::fs::write(home.join("file"), "").unwrap();
        let (said, succeeded) = run_script(&program, &home.join("file/bin/redlines"), &cwd);
        assert!(!succeeded && said.is_empty());
        std::fs::remove_dir_all(&home).unwrap();
    }

    /// Makes `folder` one only an administrator could write to, as `/usr/local/bin` is on most
    /// Macs. Returns false when the tests run as root, who writes anywhere.
    fn only_an_administrator_writes(folder: &Path) -> bool {
        std::fs::set_permissions(folder, std::fs::Permissions::from_mode(0o555)).unwrap();
        let probe = folder.join(".probe");
        if std::fs::write(&probe, "").is_ok() {
            std::fs::remove_file(probe).unwrap();
            return false;
        }
        true
    }

    fn writable(folder: &Path) {
        std::fs::set_permissions(folder, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// An administrator's step that must never be asked for.
    fn never(_: &Path, _: &Path) -> Privileged {
        panic!("asked for an administrator");
    }

    #[test]
    fn links_in_the_shared_folder_without_asking_where_it_may() {
        let (home, program) = home("shared");
        let folder = home.join("usr/local/bin");
        let link = folder.join(PROGRAM);
        // The same decisions as in the home folder, and never a question.
        for (case, there, links) in THERE {
            put(there, &link, &program);
            let before = state(&link);
            match install_shared(&folder, &program, "/usr/bin", never) {
                Ok(installed) => {
                    assert!(*links, "{case}: replaced {before}");
                    assert_eq!(
                        installed,
                        Installed::Linked(Linked {
                            linked: link.to_string_lossy().into_owned(),
                            on_path: false,
                        }),
                        "{case}"
                    );
                    assert_eq!(std::fs::read_link(&link).unwrap(), program, "{case}");
                }
                Err(error) => {
                    assert!(!*links, "{case}: {error}");
                    assert!(error.ends_with(", so Redlines left it."), "{case}: {error}");
                    assert_eq!(state(&link), before, "{case}");
                }
            }
        }
        // A folder that isn't there is made when its own folder may be written to.
        std::fs::remove_dir_all(&folder).unwrap();
        let on = format!("/usr/bin:{}", folder.display());
        assert_eq!(
            install_shared(&folder, &program, &on, never).unwrap(),
            Installed::Linked(Linked {
                linked: link.to_string_lossy().into_owned(),
                on_path: true,
            })
        );
        std::fs::remove_dir_all(&home).unwrap();
    }

    /// What installing in a folder only an administrator writes to does with what is there.
    enum Then {
        /// It asks for an administrator, with the program and the link, which here is cancelled.
        Asks,
        /// It finds its own link, and asks nothing.
        Linked,
        /// It leaves somebody else's, and asks nothing.
        Leaves,
    }

    #[test]
    fn asks_for_an_administrator_only_where_the_folder_needs_one() {
        let (home, program) = home("ask");
        let folder = home.join("usr/local/bin");
        let link = folder.join(PROGRAM);
        for (case, there, then) in [
            ("nothing", There::Nothing, Then::Asks),
            (
                "a copy of the app that has gone",
                There::LinkTo(b"/Volumes/Redlines/Redlines.app/Contents/MacOS/redlines"),
                Then::Asks,
            ),
            ("this program", There::ThisProgram, Then::Linked),
            ("a file", There::File, Then::Leaves),
            (
                "another program",
                There::LinkTo(b"/opt/node/bin/redlines"),
                Then::Leaves,
            ),
        ] {
            put(&there, &link, &program);
            if !only_an_administrator_writes(&folder) {
                writable(&folder);
                return std::fs::remove_dir_all(&home).unwrap();
            }
            let before = state(&link);
            let mut asked = None;
            let result = install_shared(&folder, &program, "", |program: &Path, link: &Path| {
                asked = Some((program.to_owned(), link.to_owned()));
                Privileged::Cancelled
            });
            match then {
                Then::Asks => {
                    assert_eq!(asked, Some((program.clone(), link.clone())), "{case}");
                    assert_eq!(result, Ok(Installed::Cancelled), "{case}");
                }
                Then::Linked => {
                    assert_eq!(asked, None, "{case}");
                    assert!(matches!(result, Ok(Installed::Linked(_))), "{case}");
                }
                Then::Leaves => {
                    assert_eq!(asked, None, "{case}");
                    assert!(
                        result
                            .as_ref()
                            .is_err_and(|error| error.ends_with("left it.")),
                        "{case}: {result:?}"
                    );
                }
            }
            // Cancelled, found or left, nothing changed.
            assert_eq!(state(&link), before, "{case}");
            writable(&folder);
        }
        // No folder, and its own folder needs an administrator too: the script makes it.
        std::fs::remove_dir_all(&folder).unwrap();
        let local = home.join("usr/local");
        if only_an_administrator_writes(&local) {
            let mut asked = false;
            let result = install_shared(&folder, &program, "", |_: &Path, _: &Path| {
                asked = true;
                Privileged::Cancelled
            });
            assert!(asked);
            assert_eq!(result, Ok(Installed::Cancelled));
        }
        writable(&local);
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn says_what_the_administrator_did() {
        let (home, program) = home("answer");
        let folder = home.join("usr/local/bin");
        let link = folder.join(PROGRAM);
        std::fs::create_dir_all(&folder).unwrap();
        if !only_an_administrator_writes(&folder) {
            writable(&folder);
            return std::fs::remove_dir_all(&home).unwrap();
        }
        let shared = |answer: Privileged, path: &str| {
            install_shared(&folder, &program, path, move |_: &Path, _: &Path| answer)
        };
        assert_eq!(
            shared(Privileged::Linked, &format!("/bin:{}", folder.display())),
            Ok(Installed::Linked(Linked {
                linked: link.to_string_lossy().into_owned(),
                on_path: true,
            }))
        );
        assert_eq!(shared(Privileged::Cancelled, ""), Ok(Installed::Cancelled));
        assert_eq!(
            shared(
                Privileged::Failed("mkdir: it: Not a directory".to_owned()),
                ""
            ),
            Ok(Installed::Failed {
                why: format!(
                    "Couldn’t link {}: mkdir: it: Not a directory",
                    link.display()
                ),
            })
        );
        // Something of somebody else's came between the app's look and the administrator's: the
        // script left it, and the app says what it is.
        let left = install_shared(&folder, &program, "", |_: &Path, link: &Path| {
            writable(&folder);
            std::fs::write(link, "mine").unwrap();
            Privileged::Left
        });
        assert_eq!(
            left,
            Err(format!(
                "{} is a file of its own, so Redlines left it.",
                link.display()
            ))
        );
        writable(&folder);
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn offers_the_home_folder_when_the_shared_one_cant_be_had() {
        let (home, program) = home("unusable");
        // A file where the folder should be: no administrator could link in it either.
        let folder = home.join("usr/local/bin");
        std::fs::create_dir_all(folder.parent().unwrap()).unwrap();
        std::fs::write(&folder, "").unwrap();
        let Ok(Installed::Failed { why }) = install_shared(&folder, &program, "", never) else {
            panic!("linked, or left nothing to offer");
        };
        assert!(
            why.starts_with(&format!("Couldn’t make {}: ", folder.display())),
            "{why}"
        );
        // The home folder still works.
        assert!(install_in(&home, &program, "").is_ok());
        // Without the program, nothing is asked or linked anywhere.
        std::fs::remove_file(&program).unwrap();
        std::fs::remove_file(&folder).unwrap();
        let error = install_shared(&folder, &program, "", never).unwrap_err();
        assert!(error.contains("isn’t in this copy"), "{error}");
        assert!(!folder.exists());
        std::fs::remove_dir_all(&home).unwrap();
    }
}
