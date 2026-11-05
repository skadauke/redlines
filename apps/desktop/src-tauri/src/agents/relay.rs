//! The private line between a run and the open document. An agent's program talks MCP to
//! `redlines mcp --relay <socket>`, which pipes it here over a Unix socket, and the lines go on to
//! the tools in the window that opened the relay, which answers each through `relay_answer`.
//!
//! One listener for each run, and no TCP: the socket is `0600` in a new `0700` folder, and it takes
//! one connection, ever. A relay belongs to the window that opened it.

use std::collections::HashMap;
use std::fs::{self, DirBuilder};
use std::io::{self, Write};
use std::net::Shutdown;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Webview};

use super::process::for_each_line;

/// A socket's path has to be shorter than this on macOS, including on any system's long `$TMPDIR`.
const SOCKET_PATH_LIMIT: usize = 104;

/// The longest name `private_folder` gives a folder, with the socket's name, for that limit.
const LONGEST_NAME: &str = "rl-4294967295-4294967295/s";

/// How long an answer may wait for a program that has stopped reading. It fails then, out loud,
/// and the connection ends: a line stopped halfway can't be followed by another.
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);

/// How the program reaches a relay: `McpEndpoint` in `@redlines/plugin-api`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Endpoint {
    command: String,
    args: Vec<String>,
}

/// A relay that has opened. `src/agent-host.ts` reads these by name.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Opened {
    id: u32,
    endpoint: Endpoint,
}

/// What a window hears from its relay. `src/agent-host.ts` reads these by name.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RelayMessage {
    /// Something connected, which is how a run knows that its toolbox started.
    Connected,
    Line {
        line: String,
    },
}

/// The relays of every window.
pub struct Relays {
    next_id: AtomicU32,
    open: Mutex<HashMap<u32, Arc<Relay>>>,
    write_timeout: Duration,
}

impl Default for Relays {
    fn default() -> Self {
        Relays {
            next_id: AtomicU32::new(0),
            open: Mutex::default(),
            write_timeout: WRITE_TIMEOUT,
        }
    }
}

/// One open relay.
struct Relay {
    /// The label of the window that opened it.
    owner: String,
    socket: PathBuf,
    state: Mutex<RelayState>,
}

#[derive(Default)]
struct RelayState {
    closing: bool,
    connection: Option<Connection>,
}

/// The program's connection.
struct Connection {
    /// Locked only to write, which can take a while, so that closing doesn't have to wait for it.
    writer: Arc<Mutex<UnixStream>>,
    /// The same socket, for ending the connection.
    control: UnixStream,
}

impl Relay {
    fn state(&self) -> MutexGuard<'_, RelayState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Waits for the one connection, and then hands on every line until it ends.
    fn serve(&self, listener: UnixListener, write_timeout: Duration, send: impl Fn(RelayMessage)) {
        let Ok((stream, _)) = listener.accept() else {
            return;
        };
        // With nothing listening, any other connection is refused from now on.
        drop(listener);
        let (Ok(reader), Ok(control)) = (stream.try_clone(), stream.try_clone()) else {
            return;
        };
        let _ = stream.set_write_timeout(Some(write_timeout));
        {
            let mut state = self.state();
            if state.closing {
                return;
            }
            state.connection = Some(Connection {
                writer: Arc::new(Mutex::new(stream)),
                control,
            });
        }
        send(RelayMessage::Connected);
        for_each_line(reader, |line| send(RelayMessage::Line { line }));
    }

    fn answer(&self, line: &str) -> Result<(), String> {
        let writer = self
            .state()
            .connection
            .as_ref()
            .map(|connection| Arc::clone(&connection.writer))
            .ok_or("Nothing is connected to the relay.")?;
        let mut stream = writer.lock().unwrap_or_else(PoisonError::into_inner);
        let mut bytes = Vec::with_capacity(line.len() + 1);
        bytes.extend_from_slice(line.as_bytes());
        bytes.push(b'\n');
        stream.write_all(&bytes).map_err(|error| {
            let _ = stream.shutdown(Shutdown::Both);
            format!("Couldn't send to the agent's program: {error}")
        })
    }

    /// Ends the connection, or the wait for one, and removes the socket and its folder.
    fn close(&self) {
        let connection = {
            let mut state = self.state();
            state.closing = true;
            state.connection.take()
        };
        match connection {
            Some(connection) => {
                let _ = connection.control.shutdown(Shutdown::Both);
            }
            // Nothing else wakes a thread that's waiting in `accept`.
            None => drop(UnixStream::connect(&self.socket)),
        }
        let _ = fs::remove_file(&self.socket);
        if let Some(folder) = self.socket.parent() {
            let _ = fs::remove_dir(folder);
        }
    }
}

impl Relays {
    fn open_relays(&self) -> MutexGuard<'_, HashMap<u32, Arc<Relay>>> {
        self.open.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Opens a relay for the window `owner`, with its socket under `temp` and its program beside
    /// `exe`. `send` hears a connection, and then each line.
    pub fn open(
        &self,
        owner: &str,
        temp: &Path,
        exe: &Path,
        send: impl Fn(RelayMessage) + Send + 'static,
    ) -> Result<Opened, String> {
        let folder = private_folder(temp)
            .map_err(|error| format!("Couldn't make a folder for the relay: {error}"))?;
        let socket = folder.join("s");
        let listening = endpoint(exe, &socket).and_then(|endpoint| {
            let listener = listen_on(&socket)
                .map_err(|error| format!("Couldn't open the relay's socket: {error}"))?;
            Ok((endpoint, listener))
        });
        let (endpoint, listener) = match listening {
            Ok(listening) => listening,
            Err(error) => {
                let _ = fs::remove_dir_all(&folder);
                return Err(error);
            }
        };
        let relay = Arc::new(Relay {
            owner: owner.to_owned(),
            socket,
            state: Mutex::default(),
        });
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.open_relays().insert(id, Arc::clone(&relay));
        let write_timeout = self.write_timeout;
        thread::spawn(move || relay.serve(listener, write_timeout, send));
        Ok(Opened { id, endpoint })
    }

    /// Sends a line to the program.
    pub fn answer(&self, owner: &str, id: u32, line: &str) -> Result<(), String> {
        let relay = self.open_relays().get(&id).cloned();
        match relay {
            None => Err("That relay has closed.".to_owned()),
            Some(relay) if relay.owner != owner => {
                Err("That relay belongs to another window.".to_owned())
            }
            Some(relay) => relay.answer(line),
        }
    }

    /// Closes a relay and removes its socket. A relay that has closed is closed.
    pub fn close(&self, owner: &str, id: u32) -> Result<(), String> {
        let relay = {
            let mut open = self.open_relays();
            match open.get(&id) {
                None => return Ok(()),
                Some(relay) if relay.owner != owner => {
                    return Err("That relay belongs to another window.".to_owned());
                }
                Some(_) => open.remove(&id),
            }
        };
        if let Some(relay) = relay {
            relay.close();
        }
        Ok(())
    }

    /// Closes the relays of a window that has closed.
    pub fn close_owned_by(&self, owner: &str) {
        let mut closing = Vec::new();
        self.open_relays().retain(|_, relay| {
            let keep = relay.owner != owner;
            if !keep {
                closing.push(Arc::clone(relay));
            }
            keep
        });
        for relay in closing {
            relay.close();
        }
    }

    /// Closes every relay, for when the app quits.
    pub fn close_all(&self) {
        let closing: Vec<_> = self.open_relays().drain().map(|(_, relay)| relay).collect();
        for relay in closing {
            relay.close();
        }
    }
}

/// Makes a new `0700` folder under `temp`, or if a socket's path wouldn't fit under that, under
/// `/tmp`. Only this process can have made it, since making it fails if it's there.
fn private_folder(temp: &Path) -> io::Result<PathBuf> {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let fits = temp.join(LONGEST_NAME).as_os_str().len() < SOCKET_PATH_LIMIT;
    let parent = if fits { temp } else { Path::new("/tmp") };
    loop {
        let number = NEXT.fetch_add(1, Ordering::Relaxed);
        let folder = parent.join(format!("rl-{}-{number}", std::process::id()));
        match DirBuilder::new().mode(0o700).create(&folder) {
            Ok(()) => return Ok(folder),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
}

/// Listens on a new socket, `0600`. The folder keeps others out until it is.
fn listen_on(socket: &Path) -> io::Result<UnixListener> {
    let listener = UnixListener::bind(socket)?;
    fs::set_permissions(socket, fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// How the program is reached: beside the app's own binary, in the app as in a dev build, where
/// tauri-build copies it to `target/<profile>/`.
fn endpoint(exe: &Path, socket: &Path) -> Result<Endpoint, String> {
    let program = exe
        .parent()
        .ok_or_else(|| format!("{} has no folder", exe.display()))?
        .join("redlines");
    let text = |path: &Path| {
        path.to_str()
            .map(str::to_owned)
            .ok_or_else(|| format!("{} isn't UTF-8", path.display()))
    };
    Ok(Endpoint {
        command: text(&program)?,
        args: vec!["mcp".to_owned(), "--relay".to_owned(), text(socket)?],
    })
}

/// Opens a private line for the calling window. `on_line` hears what the program sends.
#[tauri::command(async)]
pub fn relay_open(
    app: AppHandle,
    webview: Webview,
    on_line: Channel<RelayMessage>,
) -> Result<Opened, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    app.state::<Relays>().open(
        webview.label(),
        &std::env::temp_dir(),
        &exe,
        move |message| {
            // The window may be gone, and it closes its relays when it goes.
            let _ = on_line.send(message);
        },
    )
}

/// Sends a line to the program.
#[tauri::command(async)]
pub fn relay_answer(app: AppHandle, webview: Webview, id: u32, line: String) -> Result<(), String> {
    app.state::<Relays>().answer(webview.label(), id, &line)
}

/// Closes a relay and removes its socket.
#[tauri::command]
pub fn relay_close(app: AppHandle, webview: Webview, id: u32) -> Result<(), String> {
    app.state::<Relays>().close(webview.label(), id)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::unix::fs::{FileTypeExt, PermissionsExt};
    use std::os::unix::net::UnixStream;
    use std::process::{Command, Stdio};
    use std::sync::mpsc::{self, Receiver};
    use std::time::Duration;

    use super::*;

    const WAIT: Duration = Duration::from_secs(20);

    fn exe() -> PathBuf {
        PathBuf::from("/Applications/Redlines.app/Contents/MacOS/redlines-desktop")
    }

    fn open_as(relays: &Relays, owner: &str, temp: &Path) -> (Opened, Receiver<RelayMessage>) {
        let (sender, receiver) = mpsc::channel();
        let opened = relays
            .open(owner, temp, &exe(), move |message| {
                let _ = sender.send(message);
            })
            .unwrap();
        (opened, receiver)
    }

    fn open(relays: &Relays) -> (Opened, Receiver<RelayMessage>) {
        open_as(relays, "main", &std::env::temp_dir())
    }

    fn socket_of(opened: &Opened) -> PathBuf {
        assert_eq!(opened.endpoint.args[..2], ["mcp", "--relay"]);
        PathBuf::from(&opened.endpoint.args[2])
    }

    /// Connects as the program does, and waits for the relay to have taken it.
    fn connect(opened: &Opened, receiver: &Receiver<RelayMessage>) -> UnixStream {
        let stream = UnixStream::connect(socket_of(opened)).unwrap();
        assert_eq!(receiver.recv_timeout(WAIT), Ok(RelayMessage::Connected));
        stream
    }

    fn next_line(receiver: &Receiver<RelayMessage>) -> String {
        match receiver.recv_timeout(WAIT).expect("a line") {
            RelayMessage::Line { line } => line,
            other => panic!("expected a line, got {other:?}"),
        }
    }

    fn mode(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn socket_is_0600_in_a_0700_folder() {
        let relays = Relays::default();
        let (opened, _receiver) = open(&relays);
        let socket = socket_of(&opened);
        assert!(fs::metadata(&socket).unwrap().file_type().is_socket());
        assert_eq!(mode(&socket), 0o600);
        let folder = socket.parent().unwrap();
        assert_eq!(mode(folder), 0o700);
        assert_eq!(folder.parent(), Some(std::env::temp_dir().as_path()));
        relays.close("main", opened.id).unwrap();
    }

    #[test]
    fn each_relay_gets_a_folder_of_its_own() {
        let relays = Relays::default();
        let (first, _first_lines) = open(&relays);
        let (second, _second_lines) = open(&relays);
        assert_ne!(first.id, second.id);
        assert_ne!(
            socket_of(&first).parent().unwrap(),
            socket_of(&second).parent().unwrap()
        );
        relays.close_all();
    }

    #[test]
    fn path_fits_the_104_byte_limit_with_a_long_tmpdir() {
        let relays = Relays::default();
        let long = Path::new("/private/var/folders/").join("a-very-long-name/".repeat(12));
        assert!(long.as_os_str().len() > 104);
        let (opened, receiver) = open_as(&relays, "main", &long);
        let socket = socket_of(&opened);
        assert!(socket.as_os_str().len() < 104, "{}", socket.display());
        assert_eq!(mode(socket.parent().unwrap()), 0o700);
        // And it really is a socket that works.
        let mut stream = connect(&opened, &receiver);
        stream.write_all(b"hello\n").unwrap();
        assert_eq!(next_line(&receiver), "hello");
        relays.close("main", opened.id).unwrap();
        assert!(!socket.parent().unwrap().exists());
    }

    #[test]
    fn a_tmpdir_with_room_is_used() {
        let relays = Relays::default();
        let temp = std::env::temp_dir();
        let (opened, _receiver) = open_as(&relays, "main", &temp);
        let socket = socket_of(&opened);
        assert!(socket.starts_with(&temp), "{}", socket.display());
        assert!(socket.as_os_str().len() < 104, "{}", socket.display());
        relays.close("main", opened.id).unwrap();

        // The limit holds for the longest name a folder can get, not just for this one.
        let just_too_long = "x".repeat(SOCKET_PATH_LIMIT - LONGEST_NAME.len());
        let parent = private_folder(Path::new(&format!("/{just_too_long}"))).unwrap();
        assert!(parent.starts_with("/tmp"), "{}", parent.display());
        fs::remove_dir(parent).unwrap();
    }

    #[test]
    fn a_second_connection_is_refused() {
        let relays = Relays::default();
        let (opened, receiver) = open(&relays);
        let mut first = connect(&opened, &receiver);
        assert!(UnixStream::connect(socket_of(&opened)).is_err());
        // The first goes on as if nothing happened.
        first.write_all(b"still here\n").unwrap();
        assert_eq!(next_line(&receiver), "still here");
        // Nor can another take its place when it has gone.
        drop(first);
        assert!(UnixStream::connect(socket_of(&opened)).is_err());
        relays.close("main", opened.id).unwrap();
    }

    #[test]
    fn lines_go_both_ways_in_order() {
        let relays = Relays::default();
        let (opened, receiver) = open(&relays);
        let stream = connect(&opened, &receiver);
        let mut writer = stream.try_clone().unwrap();
        let mut reader = BufReader::new(stream);

        // A very long line comes through whole, after and before all the others.
        let long = "x".repeat(1_048_576);
        let sending = long.clone();
        let wrote = std::thread::spawn(move || {
            for number in 0..100 {
                writer
                    .write_all(format!("{{\"id\":{number}}}\n").as_bytes())
                    .unwrap();
            }
            writer.write_all(sending.as_bytes()).unwrap();
            writer.write_all(b"\n").unwrap();
        });
        for number in 0..100 {
            assert_eq!(next_line(&receiver), format!("{{\"id\":{number}}}"));
        }
        assert_eq!(next_line(&receiver), long);
        wrote.join().unwrap();

        // The program reads as it can, and the relay's writes wait for it.
        let read = std::thread::spawn(move || {
            let mut lines = Vec::new();
            let mut line = String::new();
            for _ in 0..101 {
                line.clear();
                reader.read_line(&mut line).unwrap();
                lines.push(line.clone());
            }
            lines
        });
        for number in 0..100 {
            relays
                .answer("main", opened.id, &format!("{{\"answer\":{number}}}"))
                .unwrap();
        }
        relays.answer("main", opened.id, &long).unwrap();
        let lines = read.join().unwrap();
        for (number, line) in lines[..100].iter().enumerate() {
            assert_eq!(*line, format!("{{\"answer\":{number}}}\n"));
        }
        assert_eq!(lines[100].len(), long.len() + 1);
        relays.close("main", opened.id).unwrap();
    }

    #[test]
    fn a_program_that_stops_reading_fails_the_answer_and_loses_the_connection() {
        let relays = Relays {
            write_timeout: Duration::from_millis(100),
            ..Relays::default()
        };
        let (opened, receiver) = open(&relays);
        let mut stream = connect(&opened, &receiver);
        // More than the socket holds, which nothing reads.
        let long = "x".repeat(16 * 1_048_576);
        assert!(relays.answer("main", opened.id, &long).is_err());
        // A line that stopped halfway can't be followed by another, so the program sees the end.
        assert!(relays.answer("main", opened.id, "{}").is_err());
        let mut rest = Vec::new();
        stream.read_to_end(&mut rest).unwrap();
        assert!(!rest.ends_with(b"{}\n"));
        relays.close("main", opened.id).unwrap();
    }

    #[test]
    fn it_says_when_something_connects_and_not_before() {
        let relays = Relays::default();
        let (opened, receiver) = open(&relays);
        assert!(receiver.recv_timeout(Duration::from_millis(50)).is_err());
        let _stream = connect(&opened, &receiver);
        relays.close("main", opened.id).unwrap();
    }

    #[test]
    fn answering_with_nothing_connected_is_an_error() {
        let relays = Relays::default();
        let (opened, _receiver) = open(&relays);
        assert!(relays.answer("main", opened.id, "{}").is_err());
        relays.close("main", opened.id).unwrap();
        assert!(relays.answer("main", opened.id, "{}").is_err());
    }

    #[test]
    fn close_removes_the_socket() {
        let relays = Relays::default();
        let (opened, _receiver) = open(&relays);
        let socket = socket_of(&opened);
        assert!(socket.exists());
        relays.close("main", opened.id).unwrap();
        assert!(!socket.exists());
        assert!(!socket.parent().unwrap().exists(), "and its folder");
        assert!(UnixStream::connect(&socket).is_err());
        assert!(relays.close("main", opened.id).is_ok(), "closed is closed");
    }

    #[test]
    fn close_ends_a_connection() {
        let relays = Relays::default();
        let (opened, receiver) = open(&relays);
        let mut stream = connect(&opened, &receiver);
        let socket = socket_of(&opened);
        relays.close("main", opened.id).unwrap();
        assert!(!socket.exists());
        let mut rest = String::new();
        assert_eq!(
            stream.read_to_string(&mut rest).unwrap(),
            0,
            "the program sees the end"
        );
    }

    #[test]
    fn a_relay_belongs_to_the_window_that_opened_it() {
        let relays = Relays::default();
        let (opened, receiver) = open_as(&relays, "doc-2", &std::env::temp_dir());
        let _stream = connect(&opened, &receiver);
        assert!(relays.answer("main", opened.id, "{}").is_err());
        assert!(relays.close("main", opened.id).is_err());
        assert!(socket_of(&opened).exists());
        assert!(relays.answer("doc-2", opened.id, "{}").is_ok());
        relays.close("doc-2", opened.id).unwrap();
    }

    #[test]
    fn closing_a_window_closes_its_relays_and_no_others() {
        let relays = Relays::default();
        let temp = std::env::temp_dir();
        let (mine, _mine_lines) = open_as(&relays, "doc-2", &temp);
        let (other, _other_lines) = open_as(&relays, "main", &temp);
        relays.close_owned_by("doc-2");
        assert!(!socket_of(&mine).exists());
        assert!(socket_of(&other).exists());
        relays.close_all();
        assert!(!socket_of(&other).exists());
    }

    #[test]
    fn the_endpoint_names_the_bundled_program() {
        let found = endpoint(
            Path::new("/Applications/Redlines.app/Contents/MacOS/redlines-desktop"),
            Path::new("/tmp/rl-1-1/s"),
        )
        .unwrap();
        assert_eq!(
            found,
            Endpoint {
                command: "/Applications/Redlines.app/Contents/MacOS/redlines".to_owned(),
                args: vec![
                    "mcp".to_owned(),
                    "--relay".to_owned(),
                    "/tmp/rl-1-1/s".to_owned()
                ],
            }
        );
        // A dev build's program is beside its binary too.
        let dev = endpoint(
            Path::new("/w/target/debug/redlines-desktop"),
            Path::new("/s"),
        )
        .unwrap();
        assert_eq!(dev.command, "/w/target/debug/redlines");
    }

    #[test]
    fn what_the_window_reads_keeps_its_names() {
        // src/agent-host.ts reads these by name.
        assert_eq!(
            serde_json::to_value(RelayMessage::Connected).unwrap(),
            serde_json::json!({ "kind": "connected" })
        );
        assert_eq!(
            serde_json::to_value(RelayMessage::Line {
                line: "x".to_owned()
            })
            .unwrap(),
            serde_json::json!({ "kind": "line", "line": "x" })
        );
        assert_eq!(
            serde_json::to_value(Opened {
                id: 2,
                endpoint: Endpoint {
                    command: "/r".to_owned(),
                    args: vec!["mcp".to_owned()]
                }
            })
            .unwrap(),
            serde_json::json!({ "id": 2, "endpoint": { "command": "/r", "args": ["mcp"] } })
        );
    }

    /// The whole way through the real program. Once it's built:
    /// `REDLINES_PROGRAM=target/debug/redlines cargo test round_trip -- --ignored`
    #[test]
    #[ignore = "needs the redlines program, named by REDLINES_PROGRAM"]
    fn round_trip_through_the_program() {
        let program = std::env::var("REDLINES_PROGRAM").expect("REDLINES_PROGRAM");
        let relays = Relays::default();
        let (opened, receiver) = open(&relays);
        let mut child = Command::new(program)
            .args(&opened.endpoint.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        assert_eq!(receiver.recv_timeout(WAIT), Ok(RelayMessage::Connected));
        let mut stdin = child.stdin.take().unwrap();
        let mut stdout = BufReader::new(child.stdout.take().unwrap());

        let mut line = String::new();
        for number in 0..3 {
            let request = format!("{{\"jsonrpc\":\"2.0\",\"id\":{number},\"method\":\"ping\"}}");
            stdin.write_all(request.as_bytes()).unwrap();
            stdin.write_all(b"\n").unwrap();
            assert_eq!(next_line(&receiver), request);
            let answer = format!("{{\"jsonrpc\":\"2.0\",\"id\":{number},\"result\":{{}}}}");
            relays.answer("main", opened.id, &answer).unwrap();
            line.clear();
            stdout.read_line(&mut line).unwrap();
            assert_eq!(line, answer + "\n");
        }

        // When the agent goes, so does the program.
        drop(stdin);
        assert!(child.wait().unwrap().success());
        relays.close("main", opened.id).unwrap();
        assert!(!socket_of(&opened).exists());
    }
}
