//! Updating and signing in Claude and Codex from Preferences ▸ Agents, each with the agent's own
//! command.
//!
//! The page says which agent, `claude` or `codex`, and nothing else: no program, no argument, no
//! word of a document. The line is made here, from where `which` found the program and the way it
//! was installed, which its path says: a program in a Homebrew Caskroom or Cellar is updated by
//! `brew upgrade`, one in a global npm install by `npm install -g`, and any other by its own
//! `update`. The name that goes to `brew` is one of a short list per agent, never a piece of the
//! path. A login is always the agent's own (`claude auth login`, `codex login`): it opens the
//! browser, and what it stores is the agent's. Redlines never reads or passes a credential, and
//! what it shows of a command's output is its last line, with anything that looks like a secret
//! left out.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::allowed::Agent;
use super::process::{STOP_GRACE, command_for, group_is_alive, group_of, signal_group};
use super::which::Programs;

/// How a program was installed, as its path says.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Install {
    /// Homebrew's: a cask (`brew upgrade --cask <name>`) or a formula (`brew upgrade <name>`).
    Homebrew { name: &'static str, cask: bool },
    /// A global npm install of the agent's package, in the global folder `prefix` names: the one
    /// npm updates is the prefix of the `node` that runs it, which may not be the copy's.
    Npm {
        package: &'static str,
        prefix: String,
    },
    /// Anything else, which the agent's own `update` knows how to update.
    Own,
}

impl Agent {
    /// The agent's package on npm.
    fn npm_package(self) -> &'static str {
        match self {
            Agent::Claude => "@anthropic-ai/claude-code",
            Agent::Codex => "@openai/codex",
        }
    }

    /// The names the agent has in Homebrew, as casks and as formulae: the only names that are ever
    /// given to `brew`.
    fn brew_names(self, cask: bool) -> &'static [&'static str] {
        match (self, cask) {
            (Agent::Claude, true) => &["claude-code", "claude-code@latest"],
            (Agent::Codex, true | false) => &["codex"],
            (Agent::Claude, false) => &[],
        }
    }
}

/// Folders that hold a global package of another package manager than npm, where `npm install -g`
/// would put a second copy elsewhere instead of updating this one.
const OTHER_MANAGERS: [&str; 7] = [".pnpm", "pnpm", ".bun", ".yarn", "yarn", ".volta", ".nvs"];

/// How a program was installed, from the path it really is (every link followed).
pub fn classify(agent: Agent, real: &Path) -> Install {
    let parts: Vec<&str> = real
        .components()
        .filter_map(|part| part.as_os_str().to_str())
        .collect();
    for (at, part) in parts.iter().enumerate() {
        let cask = match *part {
            "Caskroom" => true,
            "Cellar" => false,
            _ => continue,
        };
        let named = parts.get(at + 1).and_then(|token| {
            agent
                .brew_names(cask)
                .iter()
                .find(|name| *name == token)
                .copied()
        });
        if let Some(name) = named {
            return Install::Homebrew { name, cask };
        }
    }
    // A global install of npm's own: `<prefix>/lib/node_modules/<scope>/<name>`. A package in a
    // project's `node_modules` is no global install, and the folder before `lib` is the prefix.
    let package = agent.npm_package();
    let (scope, name) = package.split_once('/').unwrap_or_default();
    let at = parts
        .windows(4)
        .position(|window| window == ["lib", "node_modules", scope, name]);
    if let Some(at) = at
        && !parts.iter().any(|part| OTHER_MANAGERS.contains(part))
    {
        let prefix = real.components().take(at).collect::<PathBuf>();
        if let Some(prefix) = prefix.to_str().filter(|prefix| !prefix.is_empty()) {
            return Install::Npm {
                package,
                prefix: prefix.to_owned(),
            };
        }
    }
    Install::Own
}

/// A program and its arguments: what is run, and what the person is told was run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Line {
    pub program: String,
    pub args: Vec<String>,
}

impl Line {
    fn new(program: &str, args: &[&str]) -> Self {
        Line {
            program: program.to_owned(),
            args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        }
    }

    /// As a person would type it: the program by its name, then its arguments.
    pub fn shown(&self) -> String {
        let name = Path::new(&self.program)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&self.program);
        std::iter::once(name)
            .chain(self.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// The package managers a line may need, where this machine has them.
pub struct Tools<'a> {
    pub brew: Option<&'a str>,
    pub npm: Option<&'a str>,
}

/// The agent's own updater for the way it was installed.
pub fn update_line(
    agent: Agent,
    program: &str,
    install: &Install,
    tools: &Tools,
) -> Result<Line, String> {
    match *install {
        Install::Own => Ok(Line::new(program, &["update"])),
        Install::Homebrew { name, cask } => {
            let by_hand = if cask {
                format!("brew upgrade --cask {name}")
            } else {
                format!("brew upgrade {name}")
            };
            let brew = tools.brew.ok_or_else(|| {
                format!(
                    "Redlines can't find Homebrew, which installed {}. Update it in Terminal: {by_hand}",
                    agent.title()
                )
            })?;
            Ok(if cask {
                Line::new(brew, &["upgrade", "--cask", name])
            } else {
                Line::new(brew, &["upgrade", name])
            })
        }
        Install::Npm {
            package,
            ref prefix,
        } => {
            let npm = tools.npm.ok_or_else(|| {
                format!(
                    "Redlines can't find npm, which installed {}. Update it in Terminal: npm install -g {package}@latest",
                    agent.title()
                )
            })?;
            let latest = format!("{package}@latest");
            Ok(Line::new(
                npm,
                &["install", "-g", "--prefix", prefix, &latest],
            ))
        }
    }
}

/// The agent's own login, which opens the browser.
pub fn sign_in_line(agent: Agent, program: &str) -> Line {
    match agent {
        Agent::Claude => Line::new(program, &["auth", "login"]),
        Agent::Codex => Line::new(program, &["login"]),
    }
}

/// The update line for the program `which` found, with the package managers this machine has.
pub fn update_line_for(programs: &Programs, agent: Agent, program: &str) -> Result<Line, String> {
    let real = fs::canonicalize(program).unwrap_or_else(|_| PathBuf::from(program));
    let install = classify(agent, &real);
    let brew = matches!(install, Install::Homebrew { .. })
        .then(|| programs.find_program("brew"))
        .flatten();
    // npm beside the agent first: a Node of nvm or Volta has its own global folder, and the
    // `npm` next to the program is the one that put it there.
    let npm = matches!(install, Install::Npm { .. })
        .then(|| {
            let beside = Path::new(program).parent().map(|folder| folder.join("npm"));
            beside
                .filter(|path| path.is_file())
                .and_then(|path| path.to_str().map(str::to_owned))
                .or_else(|| programs.find_program("npm"))
        })
        .flatten();
    update_line(
        agent,
        program,
        &install,
        &Tools {
            brew: brew.as_deref(),
            npm: npm.as_deref(),
        },
    )
}

/// How an update or a login ended. The window reads these by name (`src/agent-preferences.ts`).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Outcome {
    /// What was run, as typed: `brew upgrade --cask codex`.
    pub ran: String,
    pub ok: bool,
    pub code: Option<i32>,
    /// The last thing it printed, with escape codes and anything like a secret left out.
    pub last_line: String,
    /// It was still going when its time was up, and was stopped.
    pub timed_out: bool,
    /// The person asked for it to stop, or the window that asked for it closed.
    pub stopped: bool,
    /// It failed at once, as a login that wants a terminal does.
    pub quick: bool,
}

/// How long a failure can take to count as at once.
const QUICK: Duration = Duration::from_secs(10);

/// The waits of a run: how long a stop gives a command to put down what it is doing, between its
/// signals, and how soon a failure counts as at once. Tests make both short.
#[derive(Clone, Copy)]
struct Timing {
    grace: Duration,
    quick: Duration,
}

const TIMING: Timing = Timing {
    grace: STOP_GRACE,
    quick: QUICK,
};

/// How long what a command left behind gets to close its pipes once the command has ended.
const LEFTOVER_GRACE: Duration = Duration::from_millis(500);

/// How much of what a command prints is kept, from the end.
const KEPT: usize = 16 * 1024;

/// The updates and logins running, at most one for each agent, and the app quitting.
#[derive(Default)]
pub struct Setups {
    /// The process group of each agent's command.
    running: Mutex<HashMap<Agent, i32>>,
    /// The agents whose command was asked to stop, until it has ended.
    stopping: Mutex<HashSet<Agent>>,
    closing: AtomicBool,
}

impl Setups {
    fn running(&self) -> MutexGuard<'_, HashMap<Agent, i32>> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Runs `line` for `agent` to its end, in its own group with stdin closed, and gives back how
    /// it ended. A command still going after `timeout`, or when the app quits, is stopped as a run
    /// is: SIGINT, then SIGTERM, then SIGKILL, a grace apart, so that a package manager can put
    /// down what it was doing.
    pub fn run(
        &self,
        agent: Agent,
        line: &Line,
        environment: &[(OsString, OsString)],
        timeout: Duration,
    ) -> Result<Outcome, String> {
        self.run_timed(agent, line, environment, timeout, TIMING)
    }

    fn run_timed(
        &self,
        agent: Agent,
        line: &Line,
        environment: &[(OsString, OsString)],
        timeout: Duration,
        Timing { grace, quick }: Timing,
    ) -> Result<Outcome, String> {
        if self.closing.load(Ordering::SeqCst) {
            return Err("Redlines is quitting.".to_owned());
        }
        let started = Instant::now();
        let mut child = {
            let mut running = self.running();
            if running.contains_key(&agent) {
                return Err(format!("{} is already being set up.", agent.title()));
            }
            let child = command_for(&line.program, &line.args, environment)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|error| format!("Couldn't run {}: {error}", line.shown()))?;
            running.insert(agent, group_of(&child));
            child
        };
        let group = group_of(&child);
        self.stopping().remove(&agent);
        // `stop_all` says it's closing before it looks, so it can't miss this and this not see that.
        if self.closing.load(Ordering::SeqCst) {
            signal_group(group, libc::SIGKILL);
        }

        // The readers each hold a sender, which drops as the reader ends: when both have, this
        // hears so, and no sooner than the pipes close.
        let printed: Arc<Mutex<Vec<u8>>> = Arc::default();
        let (reader_ended, readers) = mpsc::channel::<()>();
        for pipe in [
            child
                .stdout
                .take()
                .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
            child
                .stderr
                .take()
                .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
        ]
        .into_iter()
        .flatten()
        {
            keep_reading(pipe, &printed, reader_ended.clone());
        }
        drop(reader_ended);

        let deadline = started + timeout;
        let mut timed_out = false;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if self.closing.load(Ordering::SeqCst) => {
                    stop_group(group, grace);
                    break child.wait().ok();
                }
                Ok(None) if Instant::now() >= deadline => {
                    timed_out = true;
                    stop_group(group, grace);
                    break child.wait().ok();
                }
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(_) => break None,
            }
        };
        // What it left behind goes too, and so ends what holds its pipes open.
        if group_is_alive(group) {
            signal_group(group, libc::SIGTERM);
            thread::sleep(Duration::from_millis(100));
            if group_is_alive(group) {
                signal_group(group, libc::SIGKILL);
            }
        }
        // The agent is free to be set up again the moment its command has ended, whatever still
        // holds its pipes.
        self.running().remove(&agent);
        let stopped = self.stopping().remove(&agent);
        // Something that has left the group can hold the pipes open forever, and what was printed
        // by then still counts: this is as long as that can hold the end back.
        let _ = readers.recv_timeout(LEFTOVER_GRACE);

        let code = status.and_then(|status| status.code());
        let ok = !timed_out && !stopped && code == Some(0);
        let last_line = last_line_of(&printed.lock().unwrap_or_else(PoisonError::into_inner));
        Ok(Outcome {
            ran: line.shown(),
            ok,
            code,
            last_line,
            timed_out,
            stopped,
            quick: !ok && !timed_out && !stopped && started.elapsed() < quick,
        })
    }

    fn stopping(&self) -> MutexGuard<'_, HashSet<Agent>> {
        self.stopping.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Asks the agent's update or sign-in to stop, and returns at once: SIGINT, then SIGTERM, then
    /// SIGKILL, a grace apart, as the app quitting does. What ends is reported as stopped.
    pub fn stop(&self, agent: Agent) {
        let Some(group) = self.running().get(&agent).copied() else {
            return;
        };
        if self.stopping().insert(agent) {
            thread::spawn(move || stop_group(group, STOP_GRACE));
        }
    }

    /// Stops whatever is running, for when the window that asked for it closes: it has nowhere to
    /// report to. Unlike `stop_all`, it leaves the app free to run the next.
    pub fn stop_running(&self) {
        let agents: Vec<Agent> = self.running().keys().copied().collect();
        for agent in agents {
            self.stop(agent);
        }
    }

    /// Stops what is running, and runs nothing more, for when the app quits. Waits for it to end,
    /// as long as stopping takes.
    pub fn stop_all(&self) {
        self.closing.store(true, Ordering::SeqCst);
        let patience = STOP_GRACE * 2 + Duration::from_secs(2);
        let deadline = Instant::now() + patience;
        while !self.running().is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(25));
        }
        for group in self.running().values() {
            signal_group(*group, libc::SIGKILL);
        }
    }
}

/// SIGINT, then SIGTERM, then SIGKILL to a group, `grace` apart: each stops early if it is empty.
fn stop_group(group: i32, grace: Duration) {
    for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGKILL] {
        signal_group(group, signal);
        let deadline = Instant::now() + grace;
        while group_is_alive(group) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        if !group_is_alive(group) {
            return;
        }
    }
}

/// Reads a pipe to its end into `printed`, keeping the last `KEPT` bytes of everything read, on a
/// thread of its own. `ended` drops with the thread, so that whoever waits can tell.
fn keep_reading(
    mut pipe: impl Read + Send + 'static,
    printed: &Arc<Mutex<Vec<u8>>>,
    ended: mpsc::Sender<()>,
) {
    let printed = Arc::clone(printed);
    thread::spawn(move || {
        let _ended = ended;
        let mut piece = [0; 4096];
        loop {
            match pipe.read(&mut piece) {
                Ok(0) => return,
                Ok(count) => {
                    let mut kept = printed.lock().unwrap_or_else(PoisonError::into_inner);
                    kept.extend_from_slice(&piece[..count]);
                    if kept.len() > KEPT * 2 {
                        let excess = kept.len() - KEPT;
                        kept.drain(..excess);
                    }
                }
                // A signal that came while it read: read on, or a chatty command would fill the
                // pipe and wait for a reader that has gone.
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return,
            }
        }
    });
}

/// The text of a command's output with its terminal escapes taken out: color, cursor movement and
/// window titles.
fn strip_escapes(text: &str) -> String {
    let mut plain = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            plain.push(c);
            continue;
        }
        match chars.next() {
            // A control sequence ends at a byte of `@` to `~`.
            Some('[') => {
                for next in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&next) {
                        break;
                    }
                }
            }
            // An operating system command ends at a bell or at ESC and a backslash.
            Some(']') => {
                while let Some(next) = chars.next() {
                    if next == '\u{7}' {
                        break;
                    }
                    if next == '\u{1b}' {
                        chars.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    plain
}

/// How a credential may begin: the common kinds.
const SECRET_STARTS: [&str; 9] = [
    "sk-",
    "sk_",
    "eyJ",
    "ghp_",
    "gho_",
    "ghs_",
    "github_pat_",
    "xox",
    "AKIA",
];

/// Whether a run of what tokens are made of could be a credential: at least 32 characters, mixing
/// upper case, lower case and digits (a base64 or base62 token), or all hex (a key, a hash).
/// `slash` lets a `/` be part of the token, as base64 has it; a path's pieces are told apart by
/// their own names instead.
fn secret_run(run: &str, slash: bool) -> bool {
    let tokenish =
        |c: char| c.is_ascii_alphanumeric() || "_-+=.".contains(c) || (slash && c == '/');
    if run.len() < 32 || !run.chars().all(tokenish) {
        return false;
    }
    let has = |test: fn(&char) -> bool| run.chars().any(|c| test(&c));
    let mixed =
        has(char::is_ascii_uppercase) && has(char::is_ascii_lowercase) && has(char::is_ascii_digit);
    let hex = run.chars().all(|c| c.is_ascii_hexdigit());
    mixed || hex
}

/// Whether a piece of output could be a credential: one that starts as the common kinds do, or a
/// long run of what tokens are made of. A piece that starts with a `/` is a path, whose parts are
/// looked at one by one (`mask_path`).
fn looks_secret(piece: &str) -> bool {
    (piece.len() >= 12 && SECRET_STARTS.iter().any(|start| piece.starts_with(start)))
        || (!piece.starts_with('/') && secret_run(piece, true))
}

/// A path with each part that could be a credential left out, so that a long path stays one.
fn mask_path(path: &str) -> String {
    path.split('/')
        .map(|part| {
            let starts =
                part.len() >= 12 && SECRET_STARTS.iter().any(|start| part.starts_with(start));
            if starts || secret_run(part, false) {
                "…"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// A name that says what follows it is a secret: `token`, `OPENAI_API_KEY`, `password`.
fn names_a_secret(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "passwd",
        "credential",
        "apikey",
    ]
    .iter()
    .any(|secret| name.contains(secret))
        || name.ends_with("key")
}

/// Words after which comes a credential: `Bearer abc`, `Basic abc`.
const SCHEMES: [&str; 3] = ["bearer", "basic", "token"];

/// What stands between the parts of a word: the punctuation of JSON, queries and assignments.
fn separates(c: char) -> bool {
    matches!(
        c,
        '"' | '\''
            | '`'
            | ','
            | ';'
            | ':'
            | '='
            | '{'
            | '}'
            | '['
            | ']'
            | '('
            | ')'
            | '<'
            | '>'
            | '&'
    )
}

/// A link with what could be a secret in it left out: the user and password before an `@`, the
/// query and the fragment. What isn't a link is returned as it is.
fn without_link_secrets(word: &str) -> String {
    let Some(at) = word.find("://") else {
        return word.to_owned();
    };
    let (scheme, rest) = word.split_at(at + 3);
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    let (authority, path) = rest
        .split_once('/')
        .map_or((rest, None), |(authority, path)| (authority, Some(path)));
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    match path {
        Some(path) => format!("{scheme}{host}/{path}"),
        None => format!("{scheme}{host}"),
    }
}

/// A word of output with what could be a secret in it left out: a link's user, password, query and
/// fragment; the value after a name that says it is a secret (`token=`, `"access_token":`,
/// `OPENAI_API_KEY=`); and any part that looks like a credential. `after_name` carries from one
/// word to the next whether the last part was such a name.
fn plain_word(word: &str, after_name: &mut bool) -> String {
    let word = without_link_secrets(word);
    let mut plain = String::with_capacity(word.len());
    let mut part = String::new();
    let flush = |part: &mut String, plain: &mut String, after_name: &mut bool| {
        if part.is_empty() {
            return;
        }
        if *after_name || looks_secret(part) {
            plain.push('…');
            *after_name = false;
        } else if part.starts_with('/') {
            *after_name = false;
            plain.push_str(&mask_path(part));
        } else {
            *after_name = names_a_secret(part);
            plain.push_str(part);
        }
        part.clear();
    };
    for c in word.chars() {
        if separates(c) {
            flush(&mut part, &mut plain, after_name);
            plain.push(c);
        } else {
            part.push(c);
        }
    }
    flush(&mut part, &mut plain, after_name);
    plain
}

/// How much of a last line is kept.
const LINE_SHOWN: usize = 200;

/// The last line of what a command printed, as plain words: escapes out, lines split at a line
/// break or at a carriage return (a progress bar's), control characters out, anything that looks
/// like a secret left out, and cut to a length a line can show.
pub fn last_line_of(output: &[u8]) -> String {
    let text = String::from_utf8_lossy(output);
    let plain = strip_escapes(&text);
    let line = plain
        .split(['\n', '\r'])
        .map(|line| {
            let mut after_scheme = false;
            let mut after_name = false;
            line.split_whitespace()
                .map(|word| {
                    let word: String = word.chars().filter(|c| !c.is_control()).collect();
                    if std::mem::take(&mut after_scheme) {
                        return "…".to_owned();
                    }
                    after_scheme =
                        SCHEMES.contains(&word.trim_end_matches(':').to_lowercase().as_str());
                    plain_word(&word, &mut after_name)
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .rfind(|line| !line.is_empty())
        .unwrap_or_default();
    if line.chars().count() <= LINE_SHOWN {
        line
    } else {
        let cut: String = line.chars().take(LINE_SHOWN - 1).collect();
        format!("{}…", cut.trim_end())
    }
}

/// A word as a shell takes it, whatever is in it.
fn shell_quote(word: &str) -> String {
    format!("'{}'", word.replace('\'', r"'\''"))
}

/// What Terminal runs to sign in: the agent's own command and nothing else, from a file that
/// removes itself as it starts. `title` is the agent's name, for the words it prints first.
pub fn terminal_script(line: &Line, title: &str) -> String {
    let command = std::iter::once(&line.program)
        .chain(&line.args)
        .map(|word| shell_quote(word))
        .collect::<Vec<_>>()
        .join(" ");
    let said = format!("  {}", line.shown());
    [
        "#!/bin/zsh -l".to_owned(),
        r#"/bin/rm -f -- "$0""#.to_owned(),
        format!(
            "echo {}",
            shell_quote(&format!(
                "Redlines is running this so that you can sign in to {title}:"
            ))
        ),
        format!("echo {}", shell_quote(&said)),
        "echo".to_owned(),
        command,
        "echo".to_owned(),
        "echo 'Back in Redlines, choose Check Again. You can close this window.'".to_owned(),
        String::new(),
    ]
    .join("\n")
}

/// Writes a script for Terminal into `folder`, which only the person can open, runnable by them
/// alone, under a name no other has.
pub fn write_terminal_script(folder: &Path, agent: Agent, script: &str) -> io::Result<PathBuf> {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(folder)?;
    loop {
        let unique = NEXT.fetch_add(1, Ordering::Relaxed);
        let name = format!(
            "sign-in-{}-{}-{unique}.command",
            agent.name(),
            std::process::id()
        );
        let path = folder.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o700)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(script.as_bytes())?;
                return Ok(path);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
}

/// Opens a script in Terminal, which runs it in a window of its own.
pub fn open_in_terminal(script: &Path) -> Result<(), String> {
    let status = Command::new("open")
        .args(["-a", "Terminal"])
        .arg(script)
        .status()
        .map_err(|error| format!("Couldn't open Terminal: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Couldn't open Terminal.".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{PermissionsExt, symlink};

    use super::*;
    use crate::agents::test_support::TempFolder;

    fn real(path: &str) -> PathBuf {
        PathBuf::from(path)
    }

    #[test]
    fn a_program_of_the_agents_own_install_is_updated_by_its_own_update() {
        for (agent, path) in [
            (
                Agent::Claude,
                "/Users/ada/.local/share/claude/versions/2.1.318",
            ),
            (
                Agent::Claude,
                "/Users/ada/.claude/local/node_modules/.bin/claude",
            ),
            (Agent::Codex, "/Users/ada/.codex/bin/codex"),
            (Agent::Codex, "/usr/local/bin/codex"),
        ] {
            assert_eq!(classify(agent, &real(path)), Install::Own, "{path}");
        }
    }

    #[test]
    fn a_program_in_a_homebrew_cask_or_formula_is_updated_by_brew() {
        let cask = |name| Install::Homebrew { name, cask: true };
        assert_eq!(
            classify(
                Agent::Codex,
                &real("/opt/homebrew/Caskroom/codex/0.166.0/bin/codex")
            ),
            cask("codex")
        );
        assert_eq!(
            classify(
                Agent::Claude,
                &real("/opt/homebrew/Caskroom/claude-code/2.1.318/claude")
            ),
            cask("claude-code")
        );
        assert_eq!(
            classify(
                Agent::Claude,
                &real("/usr/local/Caskroom/claude-code@latest/2.1.318/claude")
            ),
            cask("claude-code@latest")
        );
        assert_eq!(
            classify(
                Agent::Codex,
                &real("/opt/homebrew/Cellar/codex/0.166.0/bin/codex")
            ),
            Install::Homebrew {
                name: "codex",
                cask: false
            }
        );
    }

    #[test]
    fn a_name_that_is_not_the_agents_own_never_reaches_brew() {
        // Another cask's folder, or the other agent's, is not the agent's to update with brew.
        for (agent, path) in [
            (
                Agent::Codex,
                "/opt/homebrew/Caskroom/other-tool/1/bin/codex",
            ),
            (Agent::Claude, "/opt/homebrew/Caskroom/codex/0.166.0/claude"),
            (Agent::Codex, "/opt/homebrew/Caskroom/codex-evil/1/codex"),
            (
                Agent::Claude,
                "/opt/homebrew/Cellar/claude-code/1/bin/claude",
            ),
            (Agent::Codex, "/opt/homebrew/Caskroom/--greedy/1/codex"),
        ] {
            assert_eq!(classify(agent, &real(path)), Install::Own, "{path}");
        }
    }

    #[test]
    fn a_program_in_a_global_npm_install_is_updated_by_npm_in_the_prefix_it_is_in() {
        assert_eq!(
            classify(
                Agent::Claude,
                &real(
                    "/Users/ada/.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js"
                )
            ),
            Install::Npm {
                package: "@anthropic-ai/claude-code",
                prefix: "/Users/ada/.nvm/versions/node/v22.14.0".to_owned()
            }
        );
        assert_eq!(
            classify(
                Agent::Codex,
                &real("/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js")
            ),
            Install::Npm {
                package: "@openai/codex",
                prefix: "/opt/homebrew".to_owned()
            }
        );
        // Not the other agent's package.
        assert_eq!(
            classify(
                Agent::Codex,
                &real("/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js")
            ),
            Install::Own
        );
    }

    #[test]
    fn a_package_that_is_no_global_npm_install_is_left_to_the_agents_own_update() {
        // A project's own copy, or one an `npx` cache holds, is no global install: `npm install -g`
        // would put a second copy elsewhere.
        for path in [
            "/Users/ada/code/app/node_modules/@openai/codex/bin/codex.js",
            "/Users/ada/.npm/_npx/4e0d/node_modules/@openai/codex/bin/codex.js",
            "/Users/ada/.config/yarn/global/node_modules/@anthropic-ai/claude-code/cli.js",
        ] {
            assert_eq!(classify(Agent::Codex, &real(path)), Install::Own, "{path}");
            assert_eq!(classify(Agent::Claude, &real(path)), Install::Own, "{path}");
        }
    }

    #[test]
    fn a_global_install_of_another_package_manager_is_left_to_the_agents_own_update() {
        // `npm install -g` would put a second copy elsewhere.
        for path in [
            "/Users/ada/Library/pnpm/global/5/node_modules/@openai/codex/bin/codex.js",
            "/Users/ada/Library/pnpm/global/5/.pnpm/@openai+codex@1/node_modules/@openai/codex/bin/codex.js",
            "/Users/ada/.bun/install/global/node_modules/@openai/codex/bin/codex.js",
            "/Users/ada/.volta/tools/image/packages/@openai/codex/lib/node_modules/@openai/codex/bin/codex.js",
        ] {
            assert_eq!(classify(Agent::Codex, &real(path)), Install::Own, "{path}");
        }
    }

    fn tools<'a>(brew: Option<&'a str>, npm: Option<&'a str>) -> Tools<'a> {
        Tools { brew, npm }
    }

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| (*arg).to_owned()).collect()
    }

    #[test]
    fn the_update_is_the_agents_own_for_the_way_it_was_installed() {
        let own = update_line(
            Agent::Claude,
            "/Users/ada/.local/bin/claude",
            &Install::Own,
            &tools(None, None),
        )
        .unwrap();
        assert_eq!(own.program, "/Users/ada/.local/bin/claude");
        assert_eq!(own.args, strings(&["update"]));
        assert_eq!(own.shown(), "claude update");

        let cask = update_line(
            Agent::Codex,
            "/opt/homebrew/bin/codex",
            &Install::Homebrew {
                name: "codex",
                cask: true,
            },
            &tools(Some("/opt/homebrew/bin/brew"), None),
        )
        .unwrap();
        assert_eq!(cask.program, "/opt/homebrew/bin/brew");
        assert_eq!(cask.args, strings(&["upgrade", "--cask", "codex"]));
        assert_eq!(cask.shown(), "brew upgrade --cask codex");

        let formula = update_line(
            Agent::Codex,
            "/opt/homebrew/bin/codex",
            &Install::Homebrew {
                name: "codex",
                cask: false,
            },
            &tools(Some("/opt/homebrew/bin/brew"), None),
        )
        .unwrap();
        assert_eq!(formula.args, strings(&["upgrade", "codex"]));

        let npm = update_line(
            Agent::Claude,
            "/Users/ada/.nvm/versions/node/v22/bin/claude",
            &Install::Npm {
                package: "@anthropic-ai/claude-code",
                prefix: "/Users/ada/.nvm/versions/node/v22".to_owned(),
            },
            &tools(None, Some("/Users/ada/.nvm/versions/node/v22/bin/npm")),
        )
        .unwrap();
        assert_eq!(npm.program, "/Users/ada/.nvm/versions/node/v22/bin/npm");
        // Into the prefix the copy is in, not the one the `node` that runs npm has.
        assert_eq!(
            npm.args,
            strings(&[
                "install",
                "-g",
                "--prefix",
                "/Users/ada/.nvm/versions/node/v22",
                "@anthropic-ai/claude-code@latest"
            ])
        );
    }

    #[test]
    fn a_missing_package_manager_says_what_to_type_instead() {
        let brew = update_line(
            Agent::Codex,
            "/opt/homebrew/bin/codex",
            &Install::Homebrew {
                name: "codex",
                cask: true,
            },
            &tools(None, None),
        )
        .unwrap_err();
        assert!(brew.contains("brew upgrade --cask codex"), "{brew}");
        let npm = update_line(
            Agent::Codex,
            "/x/bin/codex",
            &Install::Npm {
                package: "@openai/codex",
                prefix: "/x".to_owned(),
            },
            &tools(None, None),
        )
        .unwrap_err();
        assert!(npm.contains("npm install -g @openai/codex@latest"), "{npm}");
    }

    #[test]
    fn the_login_is_the_agents_own() {
        let claude = sign_in_line(Agent::Claude, "/Users/ada/.local/bin/claude");
        assert_eq!(claude.args, strings(&["auth", "login"]));
        assert_eq!(claude.shown(), "claude auth login");
        let codex = sign_in_line(Agent::Codex, "/opt/homebrew/bin/codex");
        assert_eq!(codex.args, strings(&["login"]));
        assert_eq!(codex.shown(), "codex login");
    }

    fn sh(script: &str) -> Line {
        Line::new("/bin/sh", &["-c", script])
    }

    fn environment() -> Vec<(OsString, OsString)> {
        vec![(OsString::from("PATH"), OsString::from("/usr/bin:/bin"))]
    }

    const A_WHILE: Duration = Duration::from_secs(30);
    const SHORT: Timing = Timing {
        grace: Duration::from_millis(200),
        quick: QUICK,
    };

    fn run(line: &Line, timeout: Duration) -> Outcome {
        run_timed(line, timeout, SHORT)
    }

    fn run_timed(line: &Line, timeout: Duration, timing: Timing) -> Outcome {
        Setups::default()
            .run_timed(Agent::Codex, line, &environment(), timeout, timing)
            .unwrap()
    }

    #[test]
    fn a_command_that_ends_well_is_ok() {
        let outcome = run(&sh("echo 'Updated to 0.169.0'"), A_WHILE);
        assert!(outcome.ok);
        assert_eq!(outcome.code, Some(0));
        assert_eq!(outcome.last_line, "Updated to 0.169.0");
        assert!(!outcome.timed_out);
        // A success is never at once; that is for a failure.
        assert!(!outcome.quick);
        assert_eq!(outcome.ran, "sh -c echo 'Updated to 0.169.0'");
    }

    #[test]
    fn a_command_that_fails_says_its_last_line_and_its_code() {
        let outcome = run(
            &sh(
                "echo 'npm error code EACCES' >&2; echo 'npm error path /usr/local/lib' >&2; exit 243",
            ),
            A_WHILE,
        );
        assert!(!outcome.ok);
        assert_eq!(outcome.code, Some(243));
        assert_eq!(outcome.last_line, "npm error path /usr/local/lib");
        assert!(outcome.quick, "it failed at once");
    }

    #[test]
    fn a_command_that_takes_its_time_to_fail_is_not_at_once() {
        let slow = sh("sleep 0.4; exit 1");
        let eager = Timing {
            quick: Duration::from_millis(100),
            ..SHORT
        };
        let outcome = run_timed(&slow, A_WHILE, eager);
        assert!(!outcome.ok);
        assert!(!outcome.timed_out);
        assert!(
            !outcome.quick,
            "after its time, a failure is the person's to read"
        );
        assert!(
            run_timed(&slow, A_WHILE, SHORT).quick,
            "within it, it is at once"
        );
    }

    #[test]
    fn a_command_still_going_when_its_time_is_up_is_stopped() {
        let started = Instant::now();
        let outcome = run(
            &sh("echo waiting; exec sleep 30"),
            Duration::from_millis(300),
        );
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(outcome.timed_out);
        assert!(!outcome.ok);
        assert!(!outcome.quick);
        assert_eq!(outcome.last_line, "waiting");
    }

    #[test]
    fn what_it_leaves_behind_is_stopped_too() {
        // A child in the group that outlives the shell must not hold the end back.
        let started = Instant::now();
        let outcome = run(&sh("sleep 30 & echo started"), A_WHILE);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(outcome.ok);
        assert_eq!(outcome.last_line, "started");
    }

    #[test]
    fn a_helper_that_left_the_group_and_holds_the_pipes_does_not_hold_the_end_back() {
        // Something that calls `setsid` is out of reach of the group's signals, and holds the
        // command's output until it ends; the command's own end can't wait for that.
        if Command::new("perl").arg("-v").output().is_err() {
            return;
        }
        let started = Instant::now();
        let outcome = run(
            &sh("perl -MPOSIX -e 'POSIX::setsid(); sleep 4' & sleep 0.2; echo started"),
            A_WHILE,
        );
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "{:?}",
            started.elapsed()
        );
        assert!(outcome.ok);
        assert_eq!(outcome.last_line, "started");
    }

    #[test]
    fn an_agent_is_free_to_be_set_up_again_once_its_command_has_ended() {
        // Even with a helper still holding the pipes.
        if Command::new("perl").arg("-v").output().is_err() {
            return;
        }
        let setups = Setups::default();
        let line = sh("perl -MPOSIX -e 'POSIX::setsid(); sleep 3' & echo up");
        let first = setups
            .run_timed(Agent::Codex, &line, &environment(), A_WHILE, SHORT)
            .unwrap();
        assert!(first.ok);
        let again = setups
            .run_timed(
                Agent::Codex,
                &sh("echo again"),
                &environment(),
                A_WHILE,
                SHORT,
            )
            .unwrap();
        assert!(again.ok);
    }

    #[test]
    fn a_command_asked_to_stop_ends_as_stopped_and_the_next_is_free_to_start() {
        let setups = Arc::new(Setups::default());
        let running = {
            let setups = Arc::clone(&setups);
            thread::spawn(move || {
                setups.run_timed(
                    Agent::Codex,
                    &sh("echo waiting; exec sleep 30"),
                    &environment(),
                    A_WHILE,
                    SHORT,
                )
            })
        };
        while setups.running().is_empty() {
            thread::sleep(Duration::from_millis(5));
        }
        let started = Instant::now();
        setups.stop(Agent::Codex);
        let outcome = running.join().unwrap().unwrap();
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(outcome.stopped);
        assert!(!outcome.ok);
        assert!(!outcome.timed_out);
        // Stopped by the person isn't a failure at once, which would open Terminal.
        assert!(!outcome.quick);
        // Asking again for what isn't running does nothing, and the app isn't closed by it.
        setups.stop(Agent::Codex);
        setups.stop_running();
        let next = setups
            .run_timed(Agent::Codex, &sh("echo hi"), &environment(), A_WHILE, SHORT)
            .unwrap();
        assert!(next.ok);
        assert!(!next.stopped);
    }

    #[test]
    fn stopping_what_runs_stops_each_agent_and_nothing_more() {
        let setups = Arc::new(Setups::default());
        let both: Vec<_> = [Agent::Claude, Agent::Codex]
            .into_iter()
            .map(|agent| {
                let setups = Arc::clone(&setups);
                thread::spawn(move || {
                    setups.run_timed(agent, &sh("exec sleep 30"), &environment(), A_WHILE, SHORT)
                })
            })
            .collect();
        while setups.running().len() < 2 {
            thread::sleep(Duration::from_millis(5));
        }
        setups.stop_running();
        for run in both {
            assert!(run.join().unwrap().unwrap().stopped);
        }
    }

    #[test]
    fn the_program_found_through_a_link_is_updated_the_way_its_real_path_says() {
        let make = |path: &Path| {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "#!/bin/sh\n").unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        };
        let programs = |known: PathBuf| {
            Programs::new(
                vec![known],
                PathBuf::from("/bin/sh"),
                environment(),
                PathBuf::from("/x/redlines"),
            )
        };

        // A Homebrew cask: /bin/codex is a link into the Caskroom, as on a Mac.
        let temp = TempFolder::new("setup-brew-link");
        let root = fs::canonicalize(temp.path()).unwrap();
        make(&root.join("Caskroom/codex/0.166.0/bin/codex"));
        make(&root.join("bin/brew"));
        symlink(
            "../Caskroom/codex/0.166.0/bin/codex",
            root.join("bin/codex"),
        )
        .unwrap();
        let line = update_line_for(
            &programs(root.join("bin")),
            Agent::Codex,
            root.join("bin/codex").to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(line.program, root.join("bin/brew").to_str().unwrap());
        assert_eq!(line.args, strings(&["upgrade", "--cask", "codex"]));

        // A global npm install: /bin/codex is a link into lib/node_modules, with npm beside it.
        let temp = TempFolder::new("setup-npm-link");
        let root = fs::canonicalize(temp.path()).unwrap();
        let node = root.join("node/v22");
        make(&node.join("lib/node_modules/@openai/codex/bin/codex.js"));
        make(&node.join("bin/npm"));
        symlink(
            "../lib/node_modules/@openai/codex/bin/codex.js",
            node.join("bin/codex"),
        )
        .unwrap();
        let line = update_line_for(
            &programs(root.join("elsewhere")),
            Agent::Codex,
            node.join("bin/codex").to_str().unwrap(),
        )
        .unwrap();
        // The npm beside the program, and the prefix of the copy it updates.
        assert_eq!(line.program, node.join("bin/npm").to_str().unwrap());
        assert_eq!(
            line.args,
            strings(&[
                "install",
                "-g",
                "--prefix",
                node.to_str().unwrap(),
                "@openai/codex@latest"
            ])
        );

        // Any other: the agent's own update, on the program as found.
        let temp = TempFolder::new("setup-own");
        let root = fs::canonicalize(temp.path()).unwrap();
        make(&root.join("share/claude/versions/2.1.318"));
        fs::create_dir_all(root.join("bin")).unwrap();
        let found = root.join("bin/claude");
        symlink("../share/claude/versions/2.1.318", &found).unwrap();
        let line = update_line_for(
            &programs(root.join("bin")),
            Agent::Claude,
            found.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(line.program, found.to_str().unwrap());
        assert_eq!(line.args, strings(&["update"]));
    }

    #[test]
    fn a_program_that_cannot_start_says_so() {
        let line = Line::new("/nonexistent/claude", &["update"]);
        let refused = Setups::default()
            .run(Agent::Claude, &line, &environment(), A_WHILE)
            .unwrap_err();
        assert!(
            refused.starts_with("Couldn't run claude update"),
            "{refused}"
        );
    }

    #[test]
    fn an_agent_is_set_up_once_at_a_time() {
        let setups = Arc::new(Setups::default());
        let first = {
            let setups = Arc::clone(&setups);
            thread::spawn(move || {
                setups.run_timed(
                    Agent::Codex,
                    &sh("exec sleep 30"),
                    &environment(),
                    Duration::from_secs(2),
                    SHORT,
                )
            })
        };
        // Until the first is listed, as it is the moment it has started.
        while setups.running().is_empty() {
            thread::sleep(Duration::from_millis(5));
        }
        let second = setups.run(Agent::Codex, &sh("echo hi"), &environment(), A_WHILE);
        assert_eq!(second.unwrap_err(), "Codex is already being set up.");
        // The other agent is its own.
        let other = setups
            .run(Agent::Claude, &sh("echo hi"), &environment(), A_WHILE)
            .unwrap();
        assert!(other.ok);
        assert!(first.join().unwrap().unwrap().timed_out);
        assert!(setups.running().is_empty());
    }

    #[test]
    fn quitting_stops_what_runs_and_starts_nothing_more() {
        let setups = Arc::new(Setups::default());
        let running = {
            let setups = Arc::clone(&setups);
            thread::spawn(move || {
                setups.run_timed(
                    Agent::Codex,
                    &sh("exec sleep 30"),
                    &environment(),
                    A_WHILE,
                    SHORT,
                )
            })
        };
        while setups.running().is_empty() {
            thread::sleep(Duration::from_millis(5));
        }
        let started = Instant::now();
        setups.stop_all();
        assert!(started.elapsed() < Duration::from_secs(15));
        let outcome = running.join().unwrap().unwrap();
        assert!(!outcome.ok);
        assert_eq!(outcome.code, None, "ended by a signal");
        assert_eq!(
            setups
                .run(Agent::Claude, &sh("echo hi"), &environment(), A_WHILE)
                .unwrap_err(),
            "Redlines is quitting."
        );
    }

    #[test]
    fn the_last_line_is_plain_words() {
        let line = |text: &str| last_line_of(text.as_bytes());
        assert_eq!(line(""), "");
        assert_eq!(line("one\ntwo\n\n"), "two");
        // A progress bar redraws one line with carriage returns.
        assert_eq!(
            line("Downloading 10%\rDownloading 55%\rDownloading 100%\n"),
            "Downloading 100%"
        );
        // Color, cursor movement and window titles are no words.
        assert_eq!(
            line("\u{1b}[1;32m==> \u{1b}[0mUpgrading codex\u{1b}[K\n"),
            "==> Upgrading codex"
        );
        assert_eq!(line("\u{1b}]0;a title\u{7}Done\n"), "Done");
        assert_eq!(line("\u{1b}]0;a title\u{1b}\\Done\n"), "Done");
        // Other control characters, and runs of spaces, go.
        assert_eq!(line("a\u{0}\u{8}b   c\td\n"), "ab c d");
        // Not valid text, still a line.
        assert_eq!(last_line_of(b"bad \xff byte\n"), "bad \u{fffd} byte");
        // Cut to what a line can show.
        let long = line(&format!("{}\n", "word ".repeat(100)));
        assert!(long.chars().count() <= 200, "{long}");
        assert!(long.ends_with('…'));
    }

    #[test]
    fn a_line_never_shows_what_could_be_a_secret() {
        let line = |text: &str| last_line_of(text.as_bytes());
        // A link keeps its place, not its query, its fragment, its user or its password.
        assert_eq!(
            line(
                "Visit https://claude.ai/oauth/authorize?client_id=x&state=abc123&code_challenge=zzz to sign in"
            ),
            "Visit https://claude.ai/oauth/authorize to sign in"
        );
        assert_eq!(
            line("see https://example.com/a#frag"),
            "see https://example.com/a"
        );
        assert_eq!(
            line("git clone https://ada:hunter2@example.com/a/b.git"),
            "git clone https://example.com/a/b.git"
        );
        assert_eq!(
            line("fetch https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/a/b"),
            "fetch https://github.com/a/b"
        );
        // A value that is named as a secret is, whatever it looks like or how it is written.
        assert_eq!(line("export OPENAI_API_KEY=abc"), "export OPENAI_API_KEY=…");
        assert_eq!(line("token=short"), "token=…");
        assert_eq!(line("access_token:abc123"), "access_token:…");
        assert_eq!(
            line(r#"{"access_token":"abc","token_type":"bearer"}"#),
            r#"{"access_token":"…","token_type":"…"}"#
        );
        assert_eq!(
            line("Authorization: Bearer abc123def456"),
            "Authorization: Bearer …"
        );
        assert_eq!(
            line("Authorization: Basic YWRhOnB3"),
            "Authorization: Basic …"
        );
        // A word that looks like a credential, in quotes or not.
        assert_eq!(
            line(&format!("failed with {}", "a1B2".repeat(10))),
            "failed with …"
        );
        assert_eq!(line("key sk-ant-api03-abcdef"), "key …");
        assert_eq!(line(r#"key "sk-proj-abcdef123456""#), r#"key "…""#);
        assert_eq!(line("jwt eyJhbGciOiJIUzI1NiJ9"), "jwt …");
        // Base64 holds a `/` and a `+`: most random tokens of it do.
        assert_eq!(
            line("secret aB3/dE5+fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA"),
            "secret …"
        );
        assert_eq!(
            line("got aB3/dE5+fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA ok"),
            "got … ok"
        );
        // A token in a link's path is no less one.
        assert_eq!(
            line("GET https://example.com/dl/Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz3/file"),
            "GET https://example.com/dl/…/file"
        );
        // But a path, a version and a package name are no secrets, with capitals and digits.
        assert_eq!(
            line(
                "EACCES: mkdir '/Users/ada/.nvm/versions/node/v22.14.0/lib/node_modules/@openai/codex'"
            ),
            "EACCES: mkdir '/Users/ada/.nvm/versions/node/v22.14.0/lib/node_modules/@openai/codex'"
        );
        assert_eq!(
            line(
                "downloaded /Users/Ada/Library/Caches/Homebrew/downloads/0a1b2c--codex-0.169.0.zip"
            ),
            "downloaded /Users/Ada/Library/Caches/Homebrew/downloads/0a1b2c--codex-0.169.0.zip"
        );
        assert_eq!(line("codex-cli 0.169.0"), "codex-cli 0.169.0");
        assert_eq!(line("exit_code=1"), "exit_code=1");
        assert_eq!(line("npm error code EACCES"), "npm error code EACCES");
    }

    #[test]
    fn terminal_runs_the_agents_own_command_and_nothing_else() {
        let line = sign_in_line(Agent::Claude, "/Users/ada/.local/bin/claude");
        let script = terminal_script(&line, "Claude");
        assert_eq!(
            script,
            "#!/bin/zsh -l\n\
             /bin/rm -f -- \"$0\"\n\
             echo 'Redlines is running this so that you can sign in to Claude:'\n\
             echo '  claude auth login'\n\
             echo\n\
             '/Users/ada/.local/bin/claude' 'auth' 'login'\n\
             echo\n\
             echo 'Back in Redlines, choose Check Again. You can close this window.'\n"
        );
    }

    #[test]
    fn a_path_with_quotes_and_spaces_stays_one_word_in_terminal() {
        let line = Line::new("/Users/o'neil/My Tools/codex", &["login"]);
        let script = terminal_script(&line, "Codex");
        assert!(
            script.contains("\n'/Users/o'\\''neil/My Tools/codex' 'login'\n"),
            "{script}"
        );
    }

    #[test]
    fn a_script_for_terminal_is_the_persons_alone_and_never_overwrites_another() {
        let temp = TempFolder::new("setup-terminal");
        let folder = temp.path().join("sign-in");
        let one = write_terminal_script(&folder, Agent::Codex, "one\n").unwrap();
        let two = write_terminal_script(&folder, Agent::Codex, "two\n").unwrap();
        assert_ne!(one, two);
        assert_eq!(fs::read_to_string(&one).unwrap(), "one\n");
        assert_eq!(fs::read_to_string(&two).unwrap(), "two\n");
        for path in [&one, &two] {
            let mode = fs::metadata(path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700, "{path:?}");
            assert_eq!(path.extension().and_then(|e| e.to_str()), Some("command"));
        }
        let mode = fs::metadata(&folder).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
    }
}
