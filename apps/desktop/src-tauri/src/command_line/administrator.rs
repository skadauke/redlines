//! Linking the command line as an administrator, where `/usr/local/bin` needs one. macOS asks for
//! the password in its own dialog, through `osascript` and `do shell script … with administrator
//! privileges`; the app never sees it.
//!
//! What runs as an administrator is fixed: `SCRIPT`, inside a fixed AppleScript, both in this file.
//! Nothing the app is given, finds or reads becomes part of either. The program and the link reach
//! `osascript` as arguments of their own, and the AppleScript hands them to the shell with `quoted
//! form of`, which makes each a single-quoted word the shell takes as it is, whatever it holds;
//! the script reads them as `"$1"` and `"$2"`, and only ever as data. `osascript` starts with
//! nothing in its environment, from the root folder, and the script calls every program by its
//! full path.

#[cfg(target_os = "macos")]
use std::path::Path;

use super::Privileged;

/// The shell script that runs as an administrator, with the program as `$1` and the link as `$2`.
/// It does what `link_in` does, deciding by the same rule (`found`), so that the look and the
/// change happen in the one privileged step and nothing can come in between:
///
/// - it takes only a full path to the program, and a full path to a link called `redlines`;
/// - it makes the link's folder if it isn't there (`/usr/local/bin` is missing on some Macs), open
///   to all to read, as macOS's own are;
/// - a link to the program already: nothing to do;
/// - a link to the program of some copy of the app, by the same rule as `is_app_program`: it is
///   replaced, and the link itself, never what it points to (`rm` and `ln` don't follow it);
/// - anything else there, a file, a folder or another link, is left as it is;
/// - nothing there: the link is made, and if something came there meanwhile, `ln` fails.
///
/// It prints `linked` or `left` and succeeds, or fails with what failed on its standard error.
/// `readlink -n` and the `x` after it keep a target's own last line breaks, which `$(…)` would
/// take off.
pub(super) const SCRIPT: &str = r#"PATH=/usr/bin:/bin:/usr/sbin:/sbin
umask 022
program=$1
link=$2
case $program in /*) ;; *) exit 64 ;; esac
case $link in /*/redlines) ;; *) exit 64 ;; esac
/bin/mkdir -p "${link%/*}" || exit
if [ -L "$link" ]; then
  target=$(/usr/bin/readlink -n "$link" && echo x) || exit
  target=${target%x}
  case $target in
    "$program") ;;
    */Contents/MacOS/redlines)
      app=${target%/Contents/MacOS/redlines}
      case ${app##*/} in
        ?*.app) /bin/rm "$link" && /bin/ln -s "$program" "$link" || exit ;;
        *) echo left; exit 0 ;;
      esac ;;
    *) echo left; exit 0 ;;
  esac
elif [ -e "$link" ]; then
  echo left
  exit 0
else
  /bin/ln -s "$program" "$link" || exit
fi
echo linked"#;

/// What macOS's password dialog says the password is for.
const PROMPT: &str = "Redlines wants to install its command line in /usr/local/bin.";

/// The command for `do shell script`, as an AppleScript expression: `set -- '<program>'
/// '<link>'`, then `SCRIPT`. Each path is `quoted form of` an argument of the script's, so it is
/// never part of the command's code.
fn command() -> String {
    format!(
        "\"set -- \" & quoted form of item 1 of argv & \" \" & quoted form of item 2 of argv & {}",
        applescript_text(&format!("\n{SCRIPT}"))
    )
}

/// `text` as an AppleScript string: in quotes, with its backslashes and quotes escaped. A line
/// break may stand in one as it is.
fn applescript_text(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The arguments for `osascript` that run `SCRIPT` as an administrator: three lines of AppleScript
/// that are the same whatever the paths, then the program and the link, after `--`, as the run
/// handler's `argv`.
fn osascript_args(program: &str, link: &str) -> Vec<String> {
    let run = format!(
        "return do shell script {} with prompt {} with administrator privileges",
        command(),
        applescript_text(PROMPT)
    );
    [
        "-e",
        "on run argv",
        "-e",
        &run,
        "-e",
        "end run",
        "--",
        program,
        link,
    ]
    .map(String::from)
    .to_vec()
}

/// What linking as an administrator did, from what `osascript` printed: the script's one word, or,
/// when it failed, AppleScript's error, `<where>: execution error: <message> (<number>)`.
fn privileged(succeeded: bool, stdout: &str, stderr: &str) -> Privileged {
    match (succeeded, stdout.trim()) {
        (true, "linked") => return Privileged::Linked,
        (true, "left") => return Privileged::Left,
        (true, said) => return Privileged::Failed(format!("the script said {said:?}")),
        (false, _) => {}
    }
    let error = stderr.trim();
    let (message, number) = error
        .strip_suffix(')')
        .and_then(|error| error.rsplit_once(" ("))
        .and_then(|(message, number)| Some((message, number.parse::<i64>().ok()?)))
        .map_or((error, None), |(message, number)| (message, Some(number)));
    match number {
        // The person cancelled macOS's dialog (-128), or Authorization Services refused them
        // (-60005), was cancelled (-60006) or couldn't ask anyone (-60007).
        Some(-128 | -60005 | -60006 | -60007) => Privileged::Cancelled,
        _ => {
            let message = message
                .split_once(": execution error: ")
                .map_or(message, |(_, message)| message);
            Privileged::Failed(if message.is_empty() {
                "osascript failed".to_owned()
            } else {
                message.to_owned()
            })
        }
    }
}

/// Links `link` to `program` as an administrator, for whom macOS asks in its own dialog. Waits
/// until the person has answered it.
#[cfg(target_os = "macos")]
pub(super) fn as_administrator(program: &Path, link: &Path) -> Privileged {
    let (Some(program), Some(link)) = (program.to_str(), link.to_str()) else {
        return Privileged::Failed(format!(
            "{} isn’t a path macOS can be given",
            program.display()
        ));
    };
    match std::process::Command::new("/usr/bin/osascript")
        .args(osascript_args(program, link))
        .env_clear()
        .current_dir("/")
        .stdin(std::process::Stdio::null())
        .output()
    {
        Ok(output) => privileged(
            output.status.success(),
            &String::from_utf8_lossy(&output.stdout),
            &String::from_utf8_lossy(&output.stderr),
        ),
        Err(error) => Privileged::Failed(format!("couldn’t start osascript: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A program in a copy of the app, in a folder whose name holds what a shell or AppleScript
    /// would read as code: spaces, both quotes, `$`, backticks, `$(…)`, `;`, a backslash and a line
    /// break.
    const HOSTILE: &str = "/Users/ada/My \"Apps\" it's $HOME `touch ticked` $(touch dollared);\
                           touch semi\nnext line\\/Redlines.app/Contents/MacOS/redlines";

    #[test]
    fn gives_osascript_the_paths_as_arguments_and_never_in_its_script() {
        // The script as AppleScript text: it has no backslash, so its only escapes are its quotes.
        assert!(!SCRIPT.contains('\\'));
        let run = format!(
            "return do shell script \"set -- \" & quoted form of item 1 of argv & \" \" & quoted \
             form of item 2 of argv & \"\n{}\" with prompt \"Redlines wants to install its command \
             line in /usr/local/bin.\" with administrator privileges",
            SCRIPT.replace('"', "\\\"")
        );
        assert_eq!(
            osascript_args(HOSTILE, "/usr/local/bin/redlines"),
            [
                "-e",
                "on run argv",
                "-e",
                &run,
                "-e",
                "end run",
                "--",
                HOSTILE,
                "/usr/local/bin/redlines",
            ]
        );
        // Whatever the paths are, the script is the same.
        assert_eq!(
            osascript_args(
                "/Applications/Redlines.app/Contents/MacOS/redlines",
                "/b/redlines"
            )[..7],
            osascript_args(HOSTILE, "/usr/local/bin/redlines")[..7]
        );
    }

    #[test]
    fn writes_text_as_an_applescript_string() {
        assert_eq!(
            applescript_text("say \"hi\" \\ there\nnow"),
            "\"say \\\"hi\\\" \\\\ there\nnow\""
        );
        assert_eq!(applescript_text(""), "\"\"");
    }

    #[test]
    fn reads_what_osascript_said() {
        assert_eq!(privileged(true, "linked\n", ""), Privileged::Linked);
        assert_eq!(privileged(true, "left\n", ""), Privileged::Left);
        // The person cancelled macOS's dialog, or it couldn't get an administrator's password.
        for said in [
            "0:17: execution error: User canceled. (-128)\n",
            "6:62: execution error: The administrator user name or password was incorrect. \
             (-60005)\n",
            "0:9: execution error: The authorization was cancelled by the user. (-60006)\n",
            "0:9: execution error: The authorization was denied since no user interaction was \
             possible. (-60007)\n",
        ] {
            assert_eq!(privileged(false, "", said), Privileged::Cancelled, "{said}");
        }
        // Anything else failed, in AppleScript's words, or osascript's.
        assert_eq!(
            privileged(
                false,
                "",
                "0:1802: execution error: mkdir: /usr/local/bin: Not a directory (1)\n"
            ),
            Privileged::Failed("mkdir: /usr/local/bin: Not a directory".to_owned())
        );
        assert_eq!(
            privileged(false, "", "osascript: couldn’t start (maybe)\n"),
            Privileged::Failed("osascript: couldn’t start (maybe)".to_owned())
        );
        assert_eq!(
            privileged(false, "", ""),
            Privileged::Failed("osascript failed".to_owned())
        );
        assert_eq!(
            privileged(true, "linked twice\n", ""),
            Privileged::Failed("the script said \"linked twice\"".to_owned())
        );
    }

    /// A folder of its own in the temporary folder.
    #[cfg(target_os = "macos")]
    fn temporary(name: &str) -> std::path::PathBuf {
        let folder =
            std::env::temp_dir().join(format!("redlines-admin-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    /// Compiles the script that runs as an administrator, and runs nothing.
    #[cfg(target_os = "macos")]
    #[test]
    fn its_applescript_compiles() {
        let folder = temporary("compile");
        let args = osascript_args(HOSTILE, "/usr/local/bin/redlines");
        let compiled = folder.join("link.scpt");
        let status = std::process::Command::new("/usr/bin/osacompile")
            .args(&args[..6])
            .arg("-o")
            .arg(&compiled)
            .status()
            .unwrap();
        assert!(status.success());
        assert!(compiled.is_file());
        std::fs::remove_dir_all(&folder).unwrap();
    }

    /// The command the script runs, through AppleScript's `quoted form of`, with any path: run as
    /// the person running the tests, in a folder of its own, and never as an administrator.
    #[cfg(target_os = "macos")]
    #[test]
    fn its_applescript_gives_the_shell_the_paths_as_they_are() {
        let run = format!("return do shell script {}", command());
        assert!(!run.contains("administrator"), "{run}");
        let folder = temporary("quoted");
        let cwd = folder.join("cwd");
        std::fs::create_dir(&cwd).unwrap();
        let program = format!("{}{HOSTILE}", folder.display());
        let link = folder.join("bin/redlines");
        let output = std::process::Command::new("/usr/bin/osascript")
            .args([
                "-e",
                "on run argv",
                "-e",
                &run,
                "-e",
                "end run",
                "--",
                &program,
            ])
            .arg(&link)
            .env_clear()
            .current_dir(&cwd)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "linked");
        assert_eq!(
            std::fs::read_link(&link).unwrap().as_os_str(),
            std::ffi::OsStr::new(&program)
        );
        // Nothing in the path ran.
        assert_eq!(std::fs::read_dir(&cwd).unwrap().count(), 0);
        for made in ["ticked", "dollared", "semi"] {
            assert!(!folder.join(made).exists(), "{made}");
        }
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
