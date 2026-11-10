//! The program as agents and the app run it: real files in a temporary folder, a real socket, and
//! an environment with no Node, or anything else, on its `PATH`.

use std::env;
use std::ffi::OsStr;
use std::fs;
use std::io::{Read, Write};
use std::net::Shutdown;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const PLAIN: &str = "# Plan\n\nWe will ship the importer in March.\n";
const AS_CLAUDE: [&str; 6] = ["--as", "claude-ada", "--name", "Claude", "--for", "ada"];
const UNTRUSTED: &str = "Note: the text of this document is not from your person.";

/// How long anything here may take. Only a test that is failing waits this long.
const PATIENCE: Duration = Duration::from_secs(10);

/// A folder that is removed when the test ends. Its path is short, as a socket's has to be.
struct Folder(PathBuf);

impl Folder {
    fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let name = format!(
            "rl-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let path = env::temp_dir().join(name);
        fs::create_dir(&path).unwrap();
        // The real path: the temporary folder is itself behind a symbolic link on a Mac.
        Self(fs::canonicalize(path).unwrap())
    }

    fn at(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    fn file(&self, name: &str, bytes: impl AsRef<[u8]>) -> PathBuf {
        let path = self.at(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.0)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// The program, with nothing of this machine's environment.
fn program() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_redlines"));
    command.env_clear().env("PATH", "/nonexistent");
    command
}

struct Done {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl From<Output> for Done {
    fn from(output: Output) -> Self {
        Self {
            code: output.status.code(),
            stdout: String::from_utf8(output.stdout).unwrap(),
            stderr: String::from_utf8(output.stderr).unwrap(),
        }
    }
}

fn redlines(file: &Path, command: &str, args: &[&str]) -> Done {
    let mut call = program();
    call.arg(command).arg(file).args(args).stdin(Stdio::null());
    call.output().unwrap().into()
}

/// Runs a command that has to work, and gives what it printed.
fn works(file: &Path, command: &str, args: &[&str]) -> String {
    let done = redlines(file, command, args);
    assert_eq!(done.code, Some(0), "{command} failed: {}", done.stderr);
    done.stdout
}

/// Replaces March with April, as Claude, and gives the id of the change.
fn suggest(file: &Path) -> String {
    let args = [
        &["--old", "March", "--new", "April", "--note", "It moved"],
        &AS_CLAUDE[..],
    ];
    let printed = works(file, "str-replace", &args.concat());
    let id = printed
        .strip_prefix("Suggested 1 change: ")
        .expect(&printed);
    id.trim_end().to_owned()
}

#[test]
fn view_prints_the_newest_text() {
    let folder = Folder::new();
    let file = folder.file(
        "plan.md",
        "We ship in <!--sub rv54 March-->April<!--/rv54-->.\n\n<!-- redlines\nversion: 1\npeople:\n  ada: {name: ada}\nmarks:\n  rv54: {by: ada, at: 2026-11-05T17:38Z}\n-->\n",
    );
    let done = redlines(&file, "view", &[]);
    assert_eq!(done.code, Some(0));
    assert_eq!(done.stdout, "We ship in April.\n");
    assert!(done.stderr.starts_with(UNTRUSTED), "{}", done.stderr);
    assert_eq!(works(&file, "view", &["--original"]), "We ship in March.\n");
    assert!(works(&file, "view", &["--review"]).contains("{~~March~>April~~}[rv54 ada]"));
}

#[test]
fn str_replace_writes_a_tracked_change_and_reject_restores_the_exact_bytes() {
    let folder = Folder::new();
    let file = folder.file("plan.md", PLAIN);
    let id = suggest(&file);
    let text = fs::read_to_string(&file).unwrap();
    assert!(
        text.contains(&format!("in <!--sub {id} March-->April<!--/{id}-->.")),
        "{text}"
    );
    assert!(
        text.contains("claude-ada: {name: Claude, agent: true, for: ada}"),
        "{text}"
    );
    assert!(text.contains("note: It moved"), "{text}");
    assert_eq!(
        folder.names(),
        ["plan.md"],
        "a temporary file was left behind"
    );

    assert_eq!(works(&file, "reject", &[&id]), format!("Rejected {id}\n"));
    assert_eq!(fs::read(&file).unwrap(), PLAIN.as_bytes());
}

#[test]
fn str_replace_of_a_rewritten_paragraph_prints_one_change() {
    let old = "The importer reads every file in the folder and writes one record for each line it finds there.";
    let new = "The importer reads each file once and writes a record per line.";
    let folder = Folder::new();
    let file = folder.file("plan.md", format!("{old}\n"));
    let args = [
        &["--old", old, "--new", new, "--note", "Shorter"],
        &AS_CLAUDE[..],
    ]
    .concat();
    let printed = works(&file, "str-replace", &args);
    let id = printed
        .strip_prefix("Suggested 1 change: ")
        .expect(&printed)
        .trim_end();
    assert!(!id.contains(','), "{printed}");
    let text = fs::read_to_string(&file).unwrap();
    assert_eq!(text.matches("<!--sub ").count(), 1, "{text}");
    assert!(
        text.starts_with(&format!("<!--sub {id} {old}-->\n\n{new}<!--/{id}-->")),
        "{text}"
    );
    assert!(
        works(&file, "view", &["--review"])
            .contains(&format!("{{~~{old}~>{new}~~}}[{id} claude-ada]"))
    );
    assert_eq!(works(&file, "reject", &[id]), format!("Rejected {id}\n"));
    assert_eq!(fs::read_to_string(&file).unwrap(), format!("{old}\n"));
}

#[test]
fn comment_reply_accept_work_end_to_end() {
    let folder = Folder::new();
    let file = folder.file("plan.md", PLAIN);
    let change = suggest(&file);

    let args = [
        &["--quote", "importer", "--text", "Which one?"],
        &AS_CLAUDE[..],
    ]
    .concat();
    let printed = works(&file, "comment", &args);
    let thread = printed
        .strip_prefix("Added comment ")
        .expect(&printed)
        .trim_end();

    let args = [thread, "--text", "The new one.", "--as", "ada"];
    assert_eq!(
        works(&file, "reply", &args),
        format!("Replied to {thread}\n")
    );
    let review = works(&file, "view", &["--review"]);
    assert!(review.contains("Which one?"), "{review}");
    assert!(review.contains("The new one."), "{review}");

    assert_eq!(
        works(&file, "accept", &[&change]),
        format!("Accepted {change}\n")
    );
    assert_eq!(
        works(&file, "view", &[]),
        "# Plan\n\nWe will ship the importer in April.\n"
    );
}

#[test]
fn a_crlf_file_stays_crlf() {
    let folder = Folder::new();
    let crlf = "# Plan\r\n\r\nWe will ship the importer in March.\r\n";
    let file = folder.file("plan.md", crlf);
    let id = suggest(&file);
    let text = fs::read_to_string(&file).unwrap();
    assert!(text.contains("<!-- redlines"), "{text}");
    assert_eq!(
        text.matches('\n').count(),
        text.matches("\r\n").count(),
        "{text:?}"
    );
    works(&file, "reject", &[&id]);
    assert_eq!(fs::read(&file).unwrap(), crlf.as_bytes());
}

#[test]
fn the_first_word_right_under_front_matter_takes_a_comment_and_a_change() {
    // #141: a Jekyll or Hugo post often starts right under the closing line of its front matter.
    let folder = Folder::new();
    let post = "---\ntitle: Notes\n---\nFirst words of the text.\n";
    let file = folder.file("post.md", post);
    let ada = ["--as", "ada", "--name", "Ada"];

    let args = [&["--quote", "First", "--text", "Why?"], &ada[..]].concat();
    let printed = works(&file, "comment", &args);
    let thread = printed
        .strip_prefix("Added comment ")
        .expect(&printed)
        .trim_end()
        .to_owned();
    let commented = fs::read_to_string(&file).unwrap();
    let args = [&["--old", "First", "--new", "The first"], &ada[..]].concat();
    let printed = works(&file, "str-replace", &args);
    let id = printed
        .strip_prefix("Suggested 1 change: ")
        .expect(&printed)
        .trim_end()
        .to_owned();

    // The front matter keeps its closing line as it was: each opener is on a line of its own
    // between it and the paragraph.
    let text = fs::read_to_string(&file).unwrap();
    let body = format!(
        "---\ntitle: Notes\n---\n<!--cmt {thread}-->\n\n<!--sub {id} First-->\n\nThe first<!--/{id}--><!--/{thread}--> words of the text.\n\n<!-- redlines\n"
    );
    assert!(text.starts_with(&body), "{text}");
    assert_eq!(
        works(&file, "view", &[]),
        "---\ntitle: Notes\n---\nThe first words of the text.\n"
    );
    assert_eq!(works(&file, "view", &["--original"]), post);

    // Rejecting the change gives back the bytes the comment left.
    assert_eq!(works(&file, "reject", &[&id]), format!("Rejected {id}\n"));
    assert_eq!(fs::read_to_string(&file).unwrap(), commented);
}

#[test]
fn a_file_ends_as_it_did_once_its_change_is_decided() {
    // #56: a file with no final line break had one after its change was rejected, and one whose
    // last line break was another than the rest had it changed.
    let folder = Folder::new();
    let as_ada = ["--as", "ada", "--name", "Ada"];
    for (original, accepted) in [
        (
            "Hello world.\n\nSecond line here.",
            "Hello there.\n\nSecond line here.",
        ),
        (
            "Hello world.\r\n\r\nSecond line here.\n",
            "Hello there.\r\n\r\nSecond line here.\n",
        ),
        (
            "Hello world.\n\nSecond line here.\r",
            "Hello there.\n\nSecond line here.\r",
        ),
    ] {
        for (decision, wanted) in [("reject", original), ("accept", accepted)] {
            let file = folder.file("a.md", original);
            let args = [&["--old", "world", "--new", "there"], &as_ada[..]].concat();
            let printed = works(&file, "str-replace", &args);
            let id = printed
                .strip_prefix("Suggested 1 change: ")
                .expect(&printed)
                .trim_end();
            let text = fs::read_to_string(&file).unwrap();
            assert!(text.contains("<!-- redlines"), "{text:?}");
            works(&file, decision, &[id]);
            assert_eq!(
                fs::read_to_string(&file).unwrap(),
                wanted,
                "{decision} in {original:?}"
            );
        }
    }
}

#[test]
fn a_ledger_with_crs_alone_for_line_breaks_is_left_alone() {
    // #56: what the editor wrote before for a change in a file whose first line break is a CR
    // alone. The program can't read that ledger, and writes no second one beside it.
    let folder = Folder::new();
    let ledger = [
        "<!-- redlines",
        "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.",
        "version: 1",
        "people:",
        "  ada: {name: Ada Lovelace}",
        "marks:",
        "  k3x9: {by: ada, at: 2026-11-05T10:00Z}",
        "-->",
    ]
    .join("\r");
    let old =
        format!("Hello <!--sub k3x9 world-->there<!--/k3x9-->.\r\rSecond line here.\r\r{ledger}\r");
    let file = folder.file("a.md", &old);
    let change = [&["--old", "Second", "--new", "Third"], &AS_CLAUDE[..]].concat();
    let comment = [&["--quote", "Second", "--text", "Why?"], &AS_CLAUDE[..]].concat();
    for (command, args) in [
        ("str-replace", change),
        ("comment", comment),
        ("reject", vec!["k3x9"]),
        ("accept", vec!["k3x9"]),
    ] {
        let done = redlines(&file, command, &args);
        assert_eq!(done.code, Some(1), "{command}: {}", done.stdout);
        assert!(
            done.stderr
                .contains("The ledger at the end of this file can't be read"),
            "{command}: {}",
            done.stderr
        );
        assert_eq!(fs::read_to_string(&file).unwrap(), old, "{command}");
    }
    assert_eq!(
        works(&file, "view", &[]),
        "Hello there.\r\rSecond line here.\r"
    );
}

#[test]
fn exit_codes_are_0_1_and_2() {
    let folder = Folder::new();
    let file = folder.file("plan.md", PLAIN);

    let help = program().arg("--help").output().unwrap();
    assert_eq!(help.status.code(), Some(0));
    assert!(
        String::from_utf8(help.stdout)
            .unwrap()
            .starts_with("Usage: redlines <command>")
    );

    // Refused: nothing matches, the file isn't there.
    let args = [&["--old", "July", "--new", "August"], &AS_CLAUDE[..]].concat();
    let done = redlines(&file, "str-replace", &args);
    assert_eq!(done.code, Some(1));
    assert_eq!(
        done.stderr,
        "No match found for replacement. Please check your text and try again.\n"
    );
    assert_eq!(fs::read(&file).unwrap(), PLAIN.as_bytes());
    let missing = folder.at("missing.md");
    let done = redlines(&missing, "view", &[]);
    assert_eq!(done.code, Some(1));
    assert_eq!(
        done.stderr,
        format!(
            "Cannot read {}: No such file or directory\n",
            missing.display()
        )
    );

    // The command line is wrong.
    let done = redlines(&file, "nonsense", &[]);
    assert_eq!(done.code, Some(2));
    assert!(
        done.stderr.starts_with("Unknown command: nonsense\n"),
        "{}",
        done.stderr
    );
    assert_eq!(redlines(&file, "view", &["--nonsense"]).code, Some(2));
    assert_eq!(program().output().unwrap().status.code(), Some(2));
    let relay_without_socket = program().args(["mcp", "--relay"]).output().unwrap();
    assert_eq!(relay_without_socket.status.code(), Some(2));
    let not_text = program()
        .arg("view")
        .arg(OsStr::from_bytes(b"caf\xe9.md"))
        .output()
        .unwrap();
    assert_eq!(not_text.status.code(), Some(2));
    assert_eq!(
        not_text.stderr,
        b"redlines: an argument isn't UTF-8 text.\n"
    );
}

#[test]
fn a_file_that_isnt_utf8_is_refused_and_left_alone() {
    let folder = Folder::new();
    let latin1 = b"We ship the caf\xe9 in March.\n";
    let file = folder.file("plan.md", latin1);
    let refusal = format!(
        "{} isn't UTF-8 text, so redlines can't change it without damaging it.\n",
        file.display()
    );

    let done = redlines(&file, "view", &[]);
    assert_eq!(
        (done.code, done.stderr.as_str()),
        (Some(1), refusal.as_str())
    );
    let args = [&["--old", "March", "--new", "April"], &AS_CLAUDE[..]].concat();
    let done = redlines(&file, "str-replace", &args);
    assert_eq!(
        (done.code, done.stderr.as_str()),
        (Some(1), refusal.as_str())
    );

    assert_eq!(fs::read(&file).unwrap(), latin1);
    assert_eq!(folder.names(), ["plan.md"]);
}

#[test]
fn it_writes_through_a_symlink_to_the_real_file() {
    let folder = Folder::new();
    let real = folder.file("real.md", PLAIN);
    fs::set_permissions(&real, fs::Permissions::from_mode(0o640)).unwrap();
    let link = folder.at("link.md");
    symlink("real.md", &link).unwrap();

    suggest(&link);

    assert!(
        fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert!(fs::read_to_string(&real).unwrap().contains("<!-- redlines"));
    assert_eq!(
        fs::metadata(&real).unwrap().permissions().mode() & 0o7777,
        0o640
    );
    assert_eq!(folder.names(), ["link.md", "real.md"]);
}

#[test]
fn ids_are_not_repeated_across_runs() {
    let folder = Folder::new();
    // A file of its own for each run, so that the ids can't be told apart by the file's own.
    let mut ids: Vec<String> = (0..8)
        .map(|run| suggest(&folder.file(&format!("{run}.md"), PLAIN)))
        .collect();
    ids.sort();
    ids.dedup();
    // Each id is drawn from 373,977, so two of eight runs share one about once in 13,000 times
    // (it happened on CI); three sharing, or two pairs, is about once in 400 million. A source
    // that repeats itself gives one id for all eight.
    assert!(ids.len() >= 7, "{ids:?}");
}

#[test]
fn every_character_keeps_its_bytes() {
    let folder = Folder::new();
    // A byte order mark, a NUL, and what UTF-16 holds as two units.
    let text =
        "\u{feff}# Pl\u{e4}n \u{1f600}\0\n\nWe will ship the importer in March.\n\n\u{10348}\n";
    let file = folder.file("plan.md", text);
    let id = suggest(&file);
    assert!(
        fs::read_to_string(&file)
            .unwrap()
            .starts_with("\u{feff}# Pl\u{e4}n \u{1f600}\0\n")
    );
    works(&file, "reject", &[&id]);
    assert_eq!(fs::read(&file).unwrap(), text.as_bytes());
}

#[test]
fn a_change_between_two_characters_of_two_units_is_kept_whole() {
    let folder = Folder::new();
    let file = folder.file("plan.md", "Smile \u{1f600} now.\n");
    let args = ["--old", "\u{1f600}", "--new", "\u{1f601}", "--as", "ada"];
    works(&file, "str-replace", &args);
    assert_eq!(works(&file, "view", &[]), "Smile \u{1f601} now.\n");
    assert_eq!(
        works(&file, "view", &["--original"]),
        "Smile \u{1f600} now.\n"
    );
}

#[test]
fn a_read_only_file_is_refused() {
    let folder = Folder::new();
    let file = folder.file("plan.md", PLAIN);
    fs::set_permissions(&file, fs::Permissions::from_mode(0o444)).unwrap();
    let args = [&["--old", "March", "--new", "April"], &AS_CLAUDE[..]].concat();
    let done = redlines(&file, "str-replace", &args);
    assert_eq!(done.code, Some(1));
    assert_eq!(
        done.stderr,
        format!(
            "{} is read-only, so redlines won't change it.\n",
            file.display()
        )
    );
    assert_eq!(fs::read(&file).unwrap(), PLAIN.as_bytes());
    assert_eq!(folder.names(), ["plan.md"]);
}

#[test]
fn a_text_can_come_from_standard_input() {
    let folder = Folder::new();
    let file = folder.file("plan.md", PLAIN);
    let mut child = program()
        .arg("str-replace")
        .arg(&file)
        .args(["--old", "March", "--new-file", "-"])
        .args(AS_CLAUDE)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all("Apr\u{ee}l\n".as_bytes())
        .unwrap();
    let done = Done::from(child.wait_with_output().unwrap());
    assert_eq!(done.code, Some(0), "{}", done.stderr);
    assert_eq!(
        works(&file, "view", &[]),
        "# Plan\n\nWe will ship the importer in Apr\u{ee}l.\n"
    );

    // Bytes on standard input that aren't text are refused as a file's are.
    let mut child = program()
        .arg("str-replace")
        .arg(&file)
        .args(["--old", "importer", "--new-file", "-"])
        .args(AS_CLAUDE)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"caf\xe9").unwrap();
    let done = Done::from(child.wait_with_output().unwrap());
    assert_eq!(done.code, Some(1));
    assert!(
        done.stderr.starts_with("Standard input isn't UTF-8 text"),
        "{}",
        done.stderr
    );
}

#[test]
fn it_ends_quietly_when_the_reader_stops_reading() {
    let folder = Folder::new();
    // More than a pipe holds, so that the program is still writing when nobody is reading.
    let file = folder.file("long.md", "A line of the document.\n".repeat(20_000));
    let mut child = program()
        .arg("view")
        .arg(&file)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    drop(child.stdout.take());
    let done = Done::from(child.wait_with_output().unwrap());
    assert_eq!(done.code, Some(0), "{}", done.stderr);
    assert!(done.stderr.starts_with(UNTRUSTED), "{}", done.stderr);
    assert_eq!(done.stderr.lines().count(), 1, "{}", done.stderr);
}

/// A failure that is nobody's refusal, such as a full disk under the output, is the program's own.
#[cfg(target_os = "linux")]
#[test]
fn a_failure_of_the_program_itself_says_why_and_exits_70() {
    let folder = Folder::new();
    let file = folder.file("plan.md", PLAIN);
    let full = fs::File::options().write(true).open("/dev/full").unwrap();
    let done = program()
        .arg("view")
        .arg(&file)
        .stdout(full)
        .stderr(Stdio::piped())
        .output();
    let done = Done::from(done.unwrap());
    assert_eq!(done.code, Some(70));
    assert!(
        done.stderr.ends_with("redlines: No space left on device\n"),
        "{}",
        done.stderr
    );
}

// The relay.

/// The app's end of the relay, and the program that has connected to it.
struct Relay {
    _folder: Folder,
    app: UnixStream,
    child: Child,
    /// What the program writes to its stdout, as it comes.
    from_stdout: mpsc::Receiver<Vec<u8>>,
}

impl Relay {
    fn start() -> Self {
        let folder = Folder::new();
        let socket = folder.at("s");
        let listener = UnixListener::bind(&socket).unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut child = program()
            .args(["mcp", "--relay"])
            .arg(&socket)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();

        let started = Instant::now();
        let app = loop {
            match listener.accept() {
                Ok((app, _)) => break app,
                Err(_) if started.elapsed() < PATIENCE => {
                    if let Some(status) = child.try_wait().unwrap() {
                        panic!("the program ended without connecting: {status}");
                    }
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("the program didn't connect: {error}"),
            }
        };
        app.set_nonblocking(false).unwrap();
        app.set_read_timeout(Some(PATIENCE)).unwrap();

        let mut stdout = child.stdout.take().unwrap();
        let (send, from_stdout) = mpsc::channel();
        thread::spawn(move || {
            let mut buffer = [0; 65536];
            while let Ok(n @ 1..) = stdout.read(&mut buffer) {
                if send.send(buffer[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        Self {
            _folder: folder,
            app,
            child,
            from_stdout,
        }
    }

    fn write_stdin(&mut self, bytes: &[u8]) {
        let stdin = self.child.stdin.as_mut().unwrap();
        stdin.write_all(bytes).unwrap();
        stdin.flush().unwrap();
    }

    /// Takes `n` bytes from the program's stdout, without waiting for anything to end.
    fn read_stdout(&self, n: usize) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(n);
        while bytes.len() < n {
            bytes.extend(
                self.from_stdout
                    .recv_timeout(PATIENCE)
                    .expect("nothing on stdout"),
            );
        }
        bytes
    }

    /// The exit code, once the program has ended by itself.
    fn ended(mut self) -> Option<i32> {
        let started = Instant::now();
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status.code();
            }
            if started.elapsed() > PATIENCE {
                self.child.kill().unwrap();
                panic!("the program didn't end");
            }
            thread::sleep(Duration::from_millis(5));
        }
    }
}

#[test]
fn relay_pipes_both_ways_and_ends_when_the_socket_closes() {
    let mut relay = Relay::start();

    // A request and its answer pass while both ends stay open.
    relay.write_stdin(b"{\"id\":0}\n");
    let mut request = [0; 9];
    relay.app.read_exact(&mut request).unwrap();
    assert_eq!(&request, b"{\"id\":0}\n");
    relay.app.write_all(b"{\"result\":1}\n").unwrap();
    assert_eq!(relay.read_stdout(13), b"{\"result\":1}\n");

    // Part of a line isn't held back for the rest of it.
    relay.app.write_all(b"{\"par").unwrap();
    assert_eq!(relay.read_stdout(5), b"{\"par");
    relay.write_stdin(b"{\"pa");
    let mut part = [0; 4];
    relay.app.read_exact(&mut part).unwrap();
    assert_eq!(&part, b"{\"pa");

    // Stdin stays open, and the program ends anyway.
    relay.app.shutdown(Shutdown::Both).unwrap();
    assert_eq!(relay.ended(), Some(0));
}

#[test]
fn relay_tells_the_app_and_ends_when_stdin_closes() {
    let mut relay = Relay::start();
    relay.write_stdin(b"the last line\n");
    drop(relay.child.stdin.take());
    let mut rest = Vec::new();
    relay.app.read_to_end(&mut rest).unwrap();
    assert_eq!(rest, b"the last line\n");
    assert_eq!(relay.ended(), Some(0));
}

#[test]
fn relay_carries_any_bytes_of_any_length_both_ways_at_once() {
    let mut relay = Relay::start();
    let bytes: Vec<u8> = (0..=255).cycle().take(1 << 20).collect();

    // More than a socket or a pipe holds, in both directions at the same time, so a relay that
    // handled one direction at a time would stick. Stdin stays open, as closing it ends the relay.
    let mut stdin = relay.child.stdin.take().unwrap();
    let to_stdin = bytes.clone();
    let writer = thread::spawn(move || {
        stdin.write_all(&to_stdin).unwrap();
        stdin
    });
    let mut app = relay.app.try_clone().unwrap();
    let to_app = bytes.clone();
    let answers = thread::spawn(move || app.write_all(&to_app).unwrap());

    let mut got = vec![0; bytes.len()];
    relay.app.read_exact(&mut got).unwrap();
    assert!(got == bytes, "the bytes from stdin changed on the way");
    let got = relay.read_stdout(bytes.len());
    assert!(got == bytes, "the bytes from the socket changed on the way");
    answers.join().unwrap();
    drop(writer.join().unwrap());
    assert_eq!(relay.ended(), Some(0));
}

#[test]
fn relay_says_when_it_cant_reach_the_app() {
    let folder = Folder::new();
    let socket = folder.at("gone");
    let output = program()
        .args(["mcp", "--relay"])
        .arg(&socket)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let said = String::from_utf8(output.stderr).unwrap();
    assert_eq!(
        said,
        format!(
            "redlines: can't reach the app at {}: No such file or directory\n",
            socket.display()
        )
    );
}
