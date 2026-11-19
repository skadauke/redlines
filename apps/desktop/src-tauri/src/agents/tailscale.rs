//! Whether this Mac is on a Tailscale network, and which other computers it can see: the first
//! screen of connecting an OpenClaw agent on another computer (docs/research/openclaw-connection.md).
//!
//! This file only *looks*. It finds Tailscale's command, runs `status --json` (one fixed line, with
//! `TAILSCALE_BE_CLI=1` so that the app's own window doesn't open), and turns the answer into one
//! state and a list of computers. Changing Tailscale (installing it, restarting its app, starting
//! its sign-in) is `tailscale_setup.rs`, only from the OpenClaw setup window and only when the
//! person asks. The sign-in address Tailscale gives is passed on as it is, and nothing is kept.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// How long `status` may take. It answers in milliseconds when the app runs, and hangs when it
/// doesn't.
const STATUS_TIMEOUT: Duration = Duration::from_secs(5);

/// Where the standalone and App Store variants keep the command: in the app. Then the link the
/// standalone app makes when CLI integration is on, and Homebrew's. An app started from Finder has
/// no `PATH` of the shell's, so these places are all it looks in.
const PLACES: &[&str] = &[
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
];

/// The admin console's DNS page, where HTTPS certificates are switched on.
const HTTPS_PAGE: &str = "https://login.tailscale.com/admin/dns";

/// The app, for `open`. It is fixed: no page text reaches it.
const APP: &str = "/Applications/Tailscale.app";

/// The one thing this Mac's Tailscale is, for the screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    /// No app and no command: "Tailscale is not on this Mac".
    Missing,
    /// Installed, but not running, or stopped: "Tailscale is turned off".
    Off,
    /// Running, and asking for a sign-in (`auth_url`).
    SignedOut,
    /// Signed in, and waiting for the network's administrator to approve this computer.
    NeedsApproval,
    /// Starting up: asked again in a moment.
    Starting,
    /// Signed in, and sees no other computer.
    NoPeers,
    /// Signed in, and sees other computers.
    Ready,
}

/// A computer on the network, as `status` lists it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Peer {
    /// Its short name: `studio-mini`.
    pub name: String,
    /// Its full MagicDNS name, with no dot at the end: `studio-mini.yak-bebop.ts.net`.
    pub dns_name: String,
    /// `macOS`, `linux`, `windows`, `iOS`...
    pub os: String,
    pub online: bool,
    /// Shared in from another network, which Tailscale hides by default.
    pub shared_in: bool,
    /// When it was last seen, as Tailscale says, for a computer that is off.
    pub last_seen: Option<String>,
}

/// What the screen shows.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Status {
    pub state: State,
    /// Where the command was found, for the details; `None` when missing.
    pub program: Option<String>,
    /// The account's sign-in name and the network's name, when signed in.
    pub account: Option<String>,
    pub tailnet: Option<String>,
    /// This Mac's own name on the network, `ada-mbp.yak-bebop.ts.net`.
    pub this_mac: Option<String>,
    /// What to open to sign in, when Tailscale asked for it.
    pub auth_url: Option<String>,
    /// The other computers: those on now first, then by name.
    pub peers: Vec<Peer>,
    /// Running, and nothing answers: Tailscale itself says it can't reach its servers, and no
    /// computer is on. Said as "This network blocks Tailscale".
    pub blocked: bool,
    /// What Tailscale's health check said, for Details.
    pub health: Vec<String>,
    /// Where in System Settings macOS asks to allow Tailscale's network extension (this Mac's).
    pub allow_in: String,
    /// Whether HTTPS certificates are turned on for the network (`CertDomains` in `status --json`
    /// holds the names they would be for): Tailscale Serve, which gives a Gateway its `https://`
    /// address, needs them. `None` when Tailscale doesn't say (an older one, or not signed in).
    pub https: Option<bool>,
}

impl Status {
    fn bare(state: State, program: Option<String>) -> Self {
        Status {
            state,
            program,
            account: None,
            tailnet: None,
            this_mac: None,
            auth_url: None,
            peers: Vec::new(),
            blocked: false,
            health: Vec::new(),
            allow_in: String::new(),
            https: None,
        }
    }
}

// What `status --json` holds that this reads (ipn/ipnstate/ipnstate.go). Every field is optional:
// a field that goes away must not break the screen, and a missing one says "not known".
#[derive(Deserialize, Default)]
#[serde(default)]
struct Raw {
    #[serde(rename = "BackendState")]
    backend_state: String,
    #[serde(rename = "AuthURL")]
    auth_url: String,
    #[serde(rename = "Health")]
    health: Option<Vec<String>>,
    #[serde(rename = "Self")]
    this: Option<RawNode>,
    #[serde(rename = "Peer")]
    peers: Option<std::collections::HashMap<String, RawNode>>,
    #[serde(rename = "User")]
    users: Option<std::collections::HashMap<String, RawUser>>,
    #[serde(rename = "CurrentTailnet")]
    tailnet: Option<RawTailnet>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawNode {
    #[serde(rename = "HostName")]
    host_name: String,
    #[serde(rename = "DNSName")]
    dns_name: String,
    #[serde(rename = "OS")]
    os: String,
    #[serde(rename = "UserID")]
    user_id: i64,
    #[serde(rename = "Online")]
    online: bool,
    #[serde(rename = "ShareeNode")]
    sharee: bool,
    #[serde(rename = "LastSeen")]
    last_seen: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawUser {
    #[serde(rename = "LoginName")]
    login_name: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawTailnet {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "MagicDNSSuffix")]
    suffix: String,
}

fn non_empty(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn without_dot(name: &str) -> String {
    name.trim().trim_end_matches('.').to_string()
}

/// Whether a health line says the network can't reach Tailscale's servers. The lines are
/// Tailscale's own words, which change; this looks for what they say, not their exact text, and
/// the first live test is to see what they say on a network that blocks it.
fn says_unreachable(line: &str) -> bool {
    let line = line.to_lowercase();
    [
        "can't reach",
        "cannot reach",
        "unable to connect",
        "no derp",
        "unreachable",
    ]
    .iter()
    .any(|phrase| line.contains(phrase))
}

/// Whether an address is a secure page of Tailscale's own, the only kind a sign-in button opens.
pub(super) fn is_tailscale_address(url: &str) -> bool {
    url.strip_prefix("https://")
        .and_then(|rest| rest.split(['/', '?', '#']).next())
        .is_some_and(|host| host == "tailscale.com" || host.ends_with(".tailscale.com"))
}

/// Whether the network has HTTPS certificates, from `CertDomains`: a list of names when it does,
/// and `null` or empty when it doesn't (Go writes a missing list as `null`). A status with no such
/// field says nothing.
fn https_of(json: &str) -> Option<bool> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    match value.get("CertDomains")? {
        serde_json::Value::Array(names) => Some(!names.is_empty()),
        serde_json::Value::Null => Some(false),
        _ => None,
    }
}

/// Reads what `status --json` printed. `None` when it isn't Tailscale's JSON.
pub fn parse_status(json: &str, program: Option<String>) -> Option<Status> {
    let raw: Raw = serde_json::from_str(json).ok()?;
    let state = match raw.backend_state.as_str() {
        "Running" => State::Ready,
        "NeedsLogin" => State::SignedOut,
        "NeedsMachineAuth" => State::NeedsApproval,
        "Starting" | "NoState" => State::Starting,
        "Stopped" => State::Off,
        _ => return None,
    };
    let health = raw.health.unwrap_or_default();
    let mut peers: Vec<Peer> = raw
        .peers
        .unwrap_or_default()
        .into_values()
        .filter(|node| !without_dot(&node.dns_name).is_empty() || !node.host_name.is_empty())
        .map(|node| {
            let dns_name = without_dot(&node.dns_name);
            let name = non_empty(&node.host_name)
                .or_else(|| dns_name.split('.').next().map(str::to_string))
                .unwrap_or_default();
            Peer {
                name,
                dns_name,
                os: node.os,
                online: node.online,
                shared_in: node.sharee,
                last_seen: non_empty(&node.last_seen).filter(|seen| !seen.starts_with("0001")),
            }
        })
        .collect();
    peers.sort_by(|a, b| {
        b.online
            .cmp(&a.online)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.dns_name.cmp(&b.dns_name))
    });
    let account = raw.this.as_ref().and_then(|me| {
        raw.users
            .as_ref()?
            .get(&me.user_id.to_string())
            .and_then(|user| non_empty(&user.login_name))
    });
    let signed_in = matches!(state, State::Ready);
    let state = if signed_in && peers.is_empty() {
        State::NoPeers
    } else {
        state
    };
    let blocked = signed_in
        && !peers.iter().any(|peer| peer.online)
        && health.iter().any(|line| says_unreachable(line));
    Some(Status {
        state,
        program,
        account,
        tailnet: raw
            .tailnet
            .as_ref()
            .and_then(|tailnet| non_empty(&tailnet.suffix).or_else(|| non_empty(&tailnet.name))),
        this_mac: raw
            .this
            .as_ref()
            .and_then(|me| non_empty(&without_dot(&me.dns_name))),
        auth_url: non_empty(&raw.auth_url).filter(|url| is_tailscale_address(url)),
        peers,
        blocked,
        health,
        allow_in: String::new(),
        https: https_of(json),
    })
}

/// What a run of the command came to.
pub enum Ran {
    Printed(String),
    /// It couldn't connect, ended badly or took too long: the app isn't running.
    Failed,
}

/// The first of `places` that is a program.
pub fn find(places: &[PathBuf]) -> Option<PathBuf> {
    places.iter().find(|path| is_program(path)).cloned()
}

fn is_program(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// Whether Tailscale's app is installed, which the command alone doesn't say (the command may be
/// Homebrew's, with no app).
fn app_installed(app: &Path) -> bool {
    app.is_dir()
}

/// The state of this Mac's Tailscale: finds it, asks it with `run`, and reads the answer. `run` is
/// given the program and returns what `status --json` printed.
pub fn check(places: &[PathBuf], app: &Path, run: impl Fn(&Path) -> Ran) -> Status {
    let Some(program) = find(places) else {
        // An app with no command inside (a different layout) is still Tailscale, turned off from
        // here: nothing can be asked of it.
        return Status::bare(
            if app_installed(app) {
                State::Off
            } else {
                State::Missing
            },
            None,
        );
    };
    let shown = Some(program.display().to_string());
    match run(&program) {
        Ran::Failed => Status::bare(State::Off, shown),
        // An answer that isn't understood is not "turned off": asked again in a moment.
        Ran::Printed(json) => parse_status(&json, shown.clone())
            .unwrap_or_else(|| Status::bare(State::Starting, shown)),
    }
}

/// Runs `<program> status --json` and reads what it printed, within `timeout`.
fn run_status(program: &Path, timeout: Duration) -> Ran {
    let Ok(mut child) = Command::new(program)
        .args(["status", "--json"])
        .env("TAILSCALE_BE_CLI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return Ran::Failed;
    };
    // `status --json` is small, but a pipe that fills would stop the command: read as it runs.
    let mut stdout = child.stdout.take();
    let (sender, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(out) = stdout.as_mut() {
            let _ = out.take(4 * 1024 * 1024).read_to_string(&mut text);
        }
        let _ = sender.send(text);
    });
    let started = Instant::now();
    let ok = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    // A helper that the command left running may hold the pipe open: wait for the text only a
    // moment, and leave the reading thread to end by itself.
    match received.recv_timeout(Duration::from_secs(1)) {
        Ok(text) if ok => Ran::Printed(text),
        _ => Ran::Failed,
    }
}

pub(super) fn places() -> Vec<PathBuf> {
    let mut places: Vec<PathBuf> = PLACES.iter().map(PathBuf::from).collect();
    if let Some(home) = std::env::var_os("HOME") {
        places.insert(
            1,
            Path::new(&home).join("Applications/Tailscale.app/Contents/MacOS/Tailscale"),
        );
    }
    places
}

/// Where Tailscale's app may be: in Applications, or in the person's own.
pub(super) fn app_places() -> Vec<PathBuf> {
    let mut apps = vec![PathBuf::from(APP)];
    if let Some(home) = std::env::var_os("HOME") {
        apps.push(Path::new(&home).join("Applications/Tailscale.app"));
    }
    apps
}

/// Whether Tailscale's app is installed in either place.
pub(super) fn app_installed_here() -> bool {
    app_places().iter().any(|app| app.is_dir())
}

/// Where, in System Settings, macOS asks the person to allow Tailscale's network extension: the
/// pane moved in macOS 15.
pub fn allow_location(major: u32) -> &'static str {
    if major >= 15 {
        "System Settings › General › Login Items & Extensions › Network Extensions"
    } else {
        "System Settings › Privacy & Security, where it says Tailscale was blocked"
    }
}

fn macos_major() -> u32 {
    Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .and_then(|out| {
            String::from_utf8_lossy(&out.stdout)
                .trim()
                .split('.')
                .next()
                .and_then(|major| major.parse().ok())
        })
        .unwrap_or(15)
}

/// What this Mac's Tailscale is, for the screen. Changes nothing.
#[tauri::command(async)]
pub fn tailscale_status() -> Status {
    let mut status = check(&places(), Path::new(APP), |program| {
        run_status(program, STATUS_TIMEOUT)
    });
    status.allow_in = allow_location(macos_major()).to_string();
    status
}

/// Opens the page of Tailscale's admin console where HTTPS certificates are turned on (DNS). The
/// address is fixed: no page text reaches it.
#[tauri::command(async)]
pub fn tailscale_open_https_settings() -> Result<(), String> {
    let status = Command::new("open")
        .arg(HTTPS_PAGE)
        .status()
        .map_err(|error| format!("Couldn’t open the page: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Couldn’t open the page. Go to login.tailscale.com/admin/dns.".to_string())
    }
}

/// Opens Tailscale's app, so that it can start, or the person can turn it on.
#[tauri::command(async)]
pub fn tailscale_open_app() -> Result<(), String> {
    let status = Command::new("open")
        .args(["-a", APP])
        .status()
        .map_err(|error| format!("Couldn’t open Tailscale: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Couldn’t open Tailscale. Open it from Applications.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    const RUNNING: &str = r#"{
      "Version": "1.80.0",
      "BackendState": "Running",
      "AuthURL": "",
      "Self": {"HostName": "ada-mbp", "DNSName": "ada-mbp.yak-bebop.ts.net.", "OS": "macOS",
               "UserID": 42, "Online": true},
      "Health": [],
      "MagicDNSSuffix": "yak-bebop.ts.net",
      "CurrentTailnet": {"Name": "ada@example.com", "MagicDNSSuffix": "yak-bebop.ts.net"},
      "Peer": {
        "nodekey:aaa": {"HostName": "old-laptop", "DNSName": "old-laptop.yak-bebop.ts.net.",
          "OS": "windows", "UserID": 42, "Online": false, "LastSeen": "2026-10-25T10:00:00Z"},
        "nodekey:bbb": {"HostName": "studio-mini", "DNSName": "studio-mini.yak-bebop.ts.net.",
          "OS": "macOS", "UserID": 42, "Online": true, "LastSeen": "0001-01-01T00:00:00Z"},
        "nodekey:ccc": {"HostName": "Home-Server", "DNSName": "home-server.yak-bebop.ts.net.",
          "OS": "linux", "UserID": 42, "Online": true, "ShareeNode": true}
      },
      "User": {"42": {"ID": 42, "LoginName": "ada@example.com", "DisplayName": "Ada"}}
    }"#;

    fn status(json: &str) -> Status {
        parse_status(json, Some("tailscale".into())).expect("tailscale's json")
    }

    #[test]
    fn running_with_other_computers_is_ready_and_lists_them_on_now_first() {
        let found = status(RUNNING);
        assert_eq!(found.state, State::Ready);
        assert_eq!(found.account.as_deref(), Some("ada@example.com"));
        assert_eq!(found.tailnet.as_deref(), Some("yak-bebop.ts.net"));
        assert_eq!(found.this_mac.as_deref(), Some("ada-mbp.yak-bebop.ts.net"));
        let names: Vec<_> = found.peers.iter().map(|peer| peer.name.as_str()).collect();
        assert_eq!(names, ["Home-Server", "studio-mini", "old-laptop"]);
        assert_eq!(found.peers[1].dns_name, "studio-mini.yak-bebop.ts.net");
        assert!(found.peers[0].shared_in);
        // A time that Tailscale writes for "never" is not shown.
        assert_eq!(found.peers[1].last_seen, None);
        assert_eq!(
            found.peers[2].last_seen.as_deref(),
            Some("2026-10-25T10:00:00Z")
        );
        assert!(!found.blocked);
    }

    #[test]
    fn https_certificates_are_on_when_the_network_has_names_for_them_and_off_when_it_has_none() {
        let with = |field: &str| {
            status(&format!(
                r#"{{"BackendState":"Running","Self":{{"DNSName":"a.t.ts.net."}}{field}}}"#
            ))
            .https
        };
        assert_eq!(with(r#","CertDomains":["a.t.ts.net"]"#), Some(true));
        assert_eq!(with(r#","CertDomains":[]"#), Some(false));
        // Go writes a list that was never made as null.
        assert_eq!(with(r#","CertDomains":null"#), Some(false));
        // A Tailscale that says nothing about it says nothing.
        assert_eq!(with(""), None);
    }

    #[test]
    fn running_with_no_other_computer_is_no_peers() {
        let json = r#"{"BackendState":"Running","Self":{"HostName":"a","DNSName":"a.t.ts.net."},
            "Peer":null,"Health":null}"#;
        assert_eq!(status(json).state, State::NoPeers);
    }

    #[test]
    fn every_backend_state_is_one_state() {
        let of = |backend: &str| {
            status(&format!(
                r#"{{"BackendState":"{backend}","AuthURL":"https://login.tailscale.com/a/1"}}"#
            ))
        };
        assert_eq!(of("NeedsLogin").state, State::SignedOut);
        assert_eq!(
            of("NeedsLogin").auth_url.as_deref(),
            Some("https://login.tailscale.com/a/1")
        );
        assert_eq!(of("NeedsMachineAuth").state, State::NeedsApproval);
        assert_eq!(of("Stopped").state, State::Off);
        assert_eq!(of("Starting").state, State::Starting);
        assert_eq!(of("NoState").state, State::Starting);
    }

    #[test]
    fn a_state_it_doesnt_know_is_not_guessed() {
        assert!(parse_status(r#"{"BackendState":"Hibernating"}"#, None).is_none());
        assert!(parse_status("not json", None).is_none());
        assert!(parse_status("", None).is_none());
    }

    #[test]
    fn only_a_secure_sign_in_address_is_passed_on() {
        let json = r#"{"BackendState":"NeedsLogin","AuthURL":"javascript:alert(1)"}"#;
        assert_eq!(status(json).auth_url, None);
        let json = r#"{"BackendState":"NeedsLogin","AuthURL":"http://login.tailscale.com/a"}"#;
        assert_eq!(status(json).auth_url, None);
        let json = r#"{"BackendState":"NeedsLogin","AuthURL":"https://login.tailscale.com.evil.example/a"}"#;
        assert_eq!(status(json).auth_url, None);
        let json =
            r#"{"BackendState":"NeedsLogin","AuthURL":"https://evil.example/login.tailscale.com"}"#;
        assert_eq!(status(json).auth_url, None);
    }

    #[test]
    fn a_network_that_blocks_tailscale_is_told_by_its_health_and_by_nobody_answering() {
        let blocked = r#"{"BackendState":"Running","Health":["Tailscale can't reach the control server"],
            "Peer":{"k":{"HostName":"mini","DNSName":"mini.t.ts.net.","Online":false}}}"#;
        assert!(status(blocked).blocked);
        // The same words, with a computer that is on, are not a block.
        let fine = r#"{"BackendState":"Running","Health":["Tailscale can't reach the control server"],
            "Peer":{"k":{"HostName":"mini","DNSName":"mini.t.ts.net.","Online":true}}}"#;
        assert!(!status(fine).blocked);
        let quiet = r#"{"BackendState":"Running","Health":[],
            "Peer":{"k":{"HostName":"mini","DNSName":"mini.t.ts.net.","Online":false}}}"#;
        assert!(!status(quiet).blocked);
    }

    fn program(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("redlines-ts-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn nothing_found_is_missing() {
        let dir = scratch("missing");
        let places = [dir.join("tailscale")];
        let found = check(&places, &dir.join("Tailscale.app"), |_| Ran::Failed);
        assert_eq!(found.state, State::Missing);
        assert_eq!(found.program, None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_app_without_a_command_is_installed_but_off() {
        let dir = scratch("app-only");
        fs::create_dir_all(dir.join("Tailscale.app")).unwrap();
        let found = check(&[dir.join("none")], &dir.join("Tailscale.app"), |_| {
            Ran::Failed
        });
        assert_eq!(found.state, State::Off);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_command_that_cant_connect_is_off() {
        let dir = scratch("off");
        let command = program(&dir, "tailscale");
        let found = check(std::slice::from_ref(&command), &dir.join("none"), |_| {
            Ran::Failed
        });
        assert_eq!(found.state, State::Off);
        assert_eq!(found.program, Some(command.display().to_string()));
        // What it printed isn't understood: not "off", which would send the person to the app.
        let garbage = check(&[command], &dir.join("none"), |_| {
            Ran::Printed("oops".into())
        });
        assert_eq!(garbage.state, State::Starting);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_first_program_found_is_asked_and_a_file_that_cant_run_is_skipped() {
        let dir = scratch("first");
        let plain = dir.join("plain");
        fs::write(&plain, "x").unwrap();
        let command = program(&dir, "tailscale");
        let found = check(&[plain, command.clone()], &dir.join("none"), |asked| {
            assert_eq!(asked, command);
            Ran::Printed(RUNNING.to_string())
        });
        assert_eq!(found.state, State::Ready);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_real_command_is_run_with_status_json_and_the_cli_variable_and_a_slow_one_is_killed() {
        let dir = scratch("run");
        let ok = dir.join("ok");
        fs::write(
            &ok,
            "#!/bin/sh\n[ \"$1 $2\" = \"status --json\" ] && [ \"$TAILSCALE_BE_CLI\" = 1 ] && \
             echo '{\"BackendState\":\"Stopped\"}'\n",
        )
        .unwrap();
        fs::set_permissions(&ok, fs::Permissions::from_mode(0o755)).unwrap();
        match run_status(&ok, Duration::from_secs(5)) {
            Ran::Printed(text) => assert!(text.contains("Stopped")),
            Ran::Failed => panic!("the command should have printed"),
        }
        let slow = dir.join("slow");
        fs::write(&slow, "#!/bin/sh\nexec sleep 30\n").unwrap();
        fs::set_permissions(&slow, fs::Permissions::from_mode(0o755)).unwrap();
        let started = Instant::now();
        assert!(matches!(
            run_status(&slow, Duration::from_millis(200)),
            Ran::Failed
        ));
        assert!(started.elapsed() < Duration::from_secs(5));
        // A helper left running, which keeps the pipe open, doesn't hold the answer up.
        let helper = dir.join("helper");
        fs::write(&helper, "#!/bin/sh\nsleep 30 &\nexit 1\n").unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o755)).unwrap();
        let started = Instant::now();
        assert!(matches!(
            run_status(&helper, Duration::from_secs(5)),
            Ran::Failed
        ));
        assert!(started.elapsed() < Duration::from_secs(5));
        let failing = dir.join("failing");
        fs::write(
            &failing,
            "#!/bin/sh\necho 'failed to connect' >&2\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(&failing, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(
            run_status(&failing, Duration::from_secs(5)),
            Ran::Failed
        ));
        fs::remove_dir_all(dir).unwrap();
    }
}
