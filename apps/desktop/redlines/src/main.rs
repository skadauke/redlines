//! The `redlines` program, which goes inside the app so that nobody needs Node:
//!
//! - `redlines view|str-replace|comment|reply|accept|reject <file> …` act on the file on disk. The
//!   logic is the TypeScript of `packages/cli`, bundled and run in QuickJS (`engine.rs`). Exit
//!   codes: 0 it worked, 1 refused, 2 the command line was wrong, 70 the program itself failed.
//! - `redlines mcp --relay <socket>` is the pipe from an agent to the app (`relay.rs`).
//!
//! It runs on the Mac and on Linux, which CI builds on.

mod engine;
mod relay;

use std::io::Write;

/// The exit code of a command line that was wrong.
const USAGE: i32 = 2;

fn main() {
    let code = match arguments() {
        Some(args) => dispatch(&args),
        None => {
            print_error("redlines: an argument isn't UTF-8 text.");
            USAGE
        }
    };
    std::process::exit(code);
}

fn dispatch(args: &[String]) -> i32 {
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    match words.as_slice() {
        ["mcp", "--relay", socket] => relay::run(socket),
        ["mcp", ..] => {
            print_error("Usage: redlines mcp --relay <socket>");
            USAGE
        }
        _ => engine::run(args),
    }
}

/// The arguments after the program's name. The logic deals in text, which a path that isn't UTF-8
/// can't be written as.
fn arguments() -> Option<Vec<String>> {
    std::env::args_os()
        .skip(1)
        .map(|arg| arg.into_string().ok())
        .collect()
}

/// A line on stderr. There is nothing to do about one that can't be written.
fn print_error(line: &str) {
    let _ = writeln!(std::io::stderr(), "{line}");
}

/// What the system says about a failure, without the number that Rust adds to it.
fn os_reason(error: &std::io::Error) -> String {
    let message = error.to_string();
    match message.split_once(" (os error ") {
        Some((reason, _)) => reason.to_owned(),
        None => message,
    }
}
