//! `redlines mcp --relay <socket>`: an agent starts this as its MCP server, and it pipes the
//! agent's stdin to the app's socket and the socket to the agent's stdout, until either closes. Any
//! bytes, as they come, with no JavaScript: the app is the server.

use crate::{os_reason, print_error};
use std::io::{self, Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::thread;

/// The exit code when the app isn't there.
const UNREACHABLE: i32 = 1;

pub fn run(socket: &str) -> i32 {
    let connected = UnixStream::connect(socket).and_then(|app| Ok((app.try_clone()?, app)));
    let (from_app, to_app) = match connected {
        Ok(ends) => ends,
        Err(error) => {
            let reason = os_reason(&error);
            print_error(&format!(
                "redlines: can't reach the app at {socket}: {reason}"
            ));
            return UNREACHABLE;
        }
    };
    // When the agent closes stdin, the app is told and the program ends, with whatever the app
    // still has to say unread: the agent has gone. What it wrote last is in the socket by then.
    thread::spawn(move || {
        pipe(io::stdin().lock(), &to_app);
        let _ = to_app.shutdown(Shutdown::Write);
        std::process::exit(0);
    });
    pipe(&from_app, io::stdout().lock());
    0
}

/// Copies until the reader ends or the writer stops taking it. Each piece is passed on at once,
/// though it may not end a line, so stdout's buffer never holds an answer back.
fn pipe(mut from: impl Read, mut to: impl Write) {
    let mut piece = [0; 64 * 1024];
    loop {
        match from.read(&mut piece) {
            Ok(0) => return,
            Ok(n) => {
                if to.write_all(&piece[..n]).and_then(|()| to.flush()).is_err() {
                    return;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(_) => return,
        }
    }
}
