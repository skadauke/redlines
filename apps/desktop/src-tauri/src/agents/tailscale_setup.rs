//! Setting up Tailscale on this Mac, from the OpenClaw setup window: installing it, restarting its
//! app and starting its sign-in. The reference is the script of the build 21 Test Drive, which
//! worked on a real Mac.
//!
//! This is the one place where Redlines changes Tailscale, and only because the person asked: every
//! command here is a button of that window (a click starts it), none runs by itself, and none runs
//! from a document or from anything a page or a document says. What each does:
//!
//! - **Install** downloads the package from `pkgs.tailscale.com` (one fixed address; a redirect is
//!   followed only to another package of the same folder) into a folder only this user can use,
//!   checks that Tailscale Inc. signed it (Apple team `W5364U7YZB`) and that Apple notarized it,
//!   refuses with plain words if either fails, and installs it with macOS's own administrator
//!   prompt (`osascript`, `do shell script … with administrator privileges`). The checks as this user
//!   give the plain refusal before any prompt; but this user could swap the file afterwards, so the
//!   privileged step is one root shell that copies it into a root-only folder, makes the copy
//!   root's and private, checks the copy again (signature, status, team, notarization) and only then
//!   runs `/usr/sbin/installer -pkg <the copy> -target /`, every step chained with `&&`. Redlines
//!   never asks for a password: the prompt is the system's. A person who isn't an administrator is
//!   sent to the App Store page.
//! - **Restart** quits Tailscale's app (a plain request to end, to this user's own process) and
//!   opens it again. A fresh install can start the app before its network extension runs, and then
//!   it never connects to it: Log in does nothing, and its log says `backendManager does not exist`,
//!   until the app is restarted.
//! - **Sign in** opens the page Tailscale gave for signing in, or asks Tailscale to start one
//!   (`tailscale login`) and opens that. It never sees a password: the page is Tailscale's.
//!
//! Everything the machine does is behind [`Host`] and [`Apps`], so that the tests run the whole of
//! it with a fake installer and fake commands and install nothing.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::tailscale;

/// The package of the newest release, which Tailscale redirects to one with its version in the name.
const PACKAGE_LATEST: &str = "https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg";
const PACKAGE_HOST_PREFIX: &str = "https://pkgs.tailscale.com";
/// The Apple team ID of Tailscale Inc.: the package must be signed with it.
const TEAM: &str = "W5364U7YZB";
/// Tailscale's page in the App Store, for a person who can't install a package.
const APP_STORE: &str = "macappstore://apps.apple.com/app/id1475387142";

/// What the installer is doing, for the window to say.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    /// Nothing asked yet (or the last result was taken).
    Idle,
    Working,
    /// Installed: Tailscale is where the app looks for it.
    Done,
    /// The person isn't an administrator: the App Store page is open, and the window waits.
    AppStore,
    Failed,
}

/// The install as the window shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct InstallState {
    pub phase: Phase,
    /// What is happening or what happened, in plain words.
    pub step: String,
}

impl InstallState {
    fn new(phase: Phase, step: impl Into<String>) -> Self {
        InstallState {
            phase,
            step: step.into(),
        }
    }
}

/// The package that is to be downloaded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Package {
    pub url: String,
    pub version: Option<String>,
    pub bytes: Option<u64>,
}

/// Why the installer stopped.
#[derive(Debug, PartialEq, Eq)]
pub enum InstallStop {
    /// The person closed the administrator prompt.
    Cancelled,
    Failed(String),
}

/// What the machine does for the install; the real one runs the system's own programs.
pub trait Host {
    /// Whether the person using this Mac is one of its administrators.
    fn is_admin(&self) -> bool;
    /// Where the newest package is, and what is known of it.
    fn package(&self) -> Package;
    /// A folder only this user can use, for the download.
    fn work_dir(&self) -> Result<PathBuf, String>;
    fn download(&self, url: &str, to: &Path) -> Result<(), String>;
    /// What `pkgutil --check-signature` says of the file, and whether it succeeded.
    fn signature(&self, pkg: &Path) -> Checked;
    /// What `spctl --assess --type install -vv` says of the file, and whether it succeeded.
    fn assessment(&self, pkg: &Path) -> Checked;
    /// Installs the file as the system's administrator prompt allows. The privileged step makes its
    /// own root-owned copy and checks the copy again, so that what is installed is what was checked.
    fn install(&self, pkg: &Path) -> Result<(), InstallStop>;
    /// Opens an address or an app with the system's `open`.
    fn open(&self, target: &str) -> Result<(), String>;
    /// Whether Tailscale is where Redlines looks for it.
    fn tailscale_found(&self) -> bool;
    fn remove_dir(&self, dir: &Path);
}

/// What a checking program printed (its output and its errors), and whether it exited with 0.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Checked {
    pub ok: bool,
    pub text: String,
}

/// Whether `line` is `<number>. Developer ID Installer: <name> (<team>)`, with nothing else: the
/// certificate of the package's signer, which is the first of its chain (the leaf).
fn is_installer_leaf(line: &str) -> bool {
    let Some(rest) = line.trim().strip_prefix("1.") else {
        return false;
    };
    is_installer_name(rest.trim_start())
}

/// `Developer ID Installer: <name> (W5364U7YZB)`, as the whole of the text.
fn is_installer_name(text: &str) -> bool {
    let suffix = format!(" ({TEAM})");
    text.strip_prefix("Developer ID Installer: ")
        .and_then(|name| name.strip_suffix(suffix.as_str()))
        .is_some_and(|name| !name.trim().is_empty() && !name.contains(['(', ')', ':']))
}

/// Whether what `pkgutil --check-signature` printed (and exited with 0 for) is a package that
/// Tailscale Inc. signed: the status line says it is signed with a certificate Apple issued for
/// distribution (not untrusted, revoked or expired), and the leaf of the chain is an installer
/// certificate of Tailscale's team, as a line of its own.
pub fn signed_by_tailscale(checked: &Checked) -> bool {
    checked.ok
        && checked.text.lines().any(|line| {
            line.trim()
                == "Status: signed by a developer certificate issued by Apple for distribution"
        })
        && checked.text.lines().any(is_installer_leaf)
}

/// Whether what `spctl --assess --type install -vv` printed (and exited with 0 for) accepts `pkg`
/// as notarized by Apple and Tailscale's: the verdict line for that very file, the source line,
/// and the origin line, each a line of its own.
pub fn notarized(checked: &Checked, pkg: &Path) -> bool {
    let verdict = format!("{}: accepted", pkg.display());
    checked.ok
        && checked.text.lines().any(|line| line.trim_end() == verdict)
        && checked
            .text
            .lines()
            .any(|line| line.trim() == "source=Notarized Developer ID")
        && checked.text.lines().any(|line| {
            line.trim()
                .strip_prefix("origin=")
                .is_some_and(is_installer_name)
        })
}

/// The address of a package, from what the server's `Location` said (or nothing): only a package of
/// Tailscale's own folder, with a plain name, is followed. Anything else is the newest release.
pub fn package_url(location: Option<&str>) -> String {
    let Some(location) = location.map(str::trim) else {
        return PACKAGE_LATEST.to_string();
    };
    let full = if location.starts_with("/stable/") {
        format!("{PACKAGE_HOST_PREFIX}{location}")
    } else {
        location.to_string()
    };
    let name = full.strip_prefix(&format!("{PACKAGE_HOST_PREFIX}/stable/Tailscale-"));
    match name.and_then(|name| name.strip_suffix("-macos.pkg")) {
        Some(version)
            if !version.is_empty()
                && version
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') =>
        {
            full
        }
        _ => PACKAGE_LATEST.to_string(),
    }
}

/// The version in a package's address: `1.80.2` of `…/Tailscale-1.80.2-macos.pkg`.
pub fn version_of(url: &str) -> Option<String> {
    url.rsplit('/')
        .next()?
        .strip_prefix("Tailscale-")?
        .strip_suffix("-macos.pkg")
        .map(str::to_string)
}

/// The AppleScript that installs the package with the system's administrator prompt, as one shell
/// that runs as root. The file was checked as this user, who could swap it afterwards: so the
/// privileged shell copies it into a folder only root can use, makes the copy root's and private,
/// checks the copy (signature, status, team, notarization), and only then installs **the copy**,
/// every step chained with `&&`, the folder removed at the end. The path of the file is the app's
/// own (in a folder it made) and reaches the shell as AppleScript's `quoted form of`.
pub fn admin_script(pkg: &Path) -> String {
    let escape = |text: &str| text.replace('\\', "\\\\").replace('"', "\\\"");
    let head = r#"D=$(/usr/bin/mktemp -d /private/var/tmp/redlines-tailscale.XXXXXX) || exit 1; trap '/bin/rm -rf "$D"' EXIT; P="$D/Tailscale.pkg"; /bin/cp "#;
    let tail = format!(
        r#" "$P" && /usr/sbin/chown root:wheel "$P" && /bin/chmod 600 "$P" && /usr/sbin/pkgutil --check-signature "$P" > "$D/signature" && /usr/bin/grep -Eq '^ +Status: signed by a developer certificate issued by Apple for distribution$' "$D/signature" && /usr/bin/grep -Eq '^ +1\. +Developer ID Installer: .+ \({TEAM}\)$' "$D/signature" && /usr/sbin/spctl --assess --type install -vv "$P" > "$D/assessment" 2>&1 && /usr/bin/grep -Fxq "$P: accepted" "$D/assessment" && /usr/bin/grep -Fxq 'source=Notarized Developer ID' "$D/assessment" && /usr/bin/grep -Eq '^origin=Developer ID Installer: .+ \({TEAM}\)$' "$D/assessment" && /usr/sbin/installer -pkg "$P" -target /"#
    );
    format!(
        "do shell script \"{}\" & quoted form of \"{}\" & \"{}\" with administrator privileges",
        escape(head),
        escape(&pkg.display().to_string()),
        escape(&tail),
    )
}

/// The install, step by step, told to `report` as it goes. Never installs what it hasn't verified.
pub fn run_install(host: &dyn Host, report: &dyn Fn(InstallState)) -> InstallState {
    let say = |phase: Phase, step: &str| {
        let state = InstallState::new(phase, step);
        report(state.clone());
        state
    };
    if host.tailscale_found() {
        return say(Phase::Done, "Tailscale is already installed.");
    }
    if !host.is_admin() {
        return match host.open(APP_STORE) {
            Ok(()) => say(
                Phase::AppStore,
                "You aren’t an administrator of this Mac, so Redlines can’t install Tailscale’s \
                 package. The App Store is open on Tailscale: install it there, and Redlines notices.",
            ),
            Err(_) => say(
                Phase::Failed,
                "You aren’t an administrator of this Mac. Install Tailscale from the App Store, \
                 or ask an administrator.",
            ),
        };
    }
    let package = host.package();
    let version = package
        .version
        .as_deref()
        .map(|v| format!(" {v}"))
        .unwrap_or_default();
    let size = package
        .bytes
        .map(|bytes| format!(" (about {} MB)", bytes.div_ceil(1_048_576)))
        .unwrap_or_default();
    report(InstallState::new(
        Phase::Working,
        format!("Downloading Tailscale{version}{size} from pkgs.tailscale.com…"),
    ));
    let dir = match host.work_dir() {
        Ok(dir) => dir,
        Err(error) => {
            return say(
                Phase::Failed,
                &format!(
                    "Redlines couldn’t make a folder for the download, and nothing was installed. {error}"
                ),
            );
        }
    };
    // The folder with the download goes however this ends, a panic included.
    struct Cleanup<'a>(&'a dyn Host, &'a Path);
    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            self.0.remove_dir(self.1);
        }
    }
    let _cleanup = Cleanup(host, &dir);
    let finish = |state: InstallState| {
        report(state.clone());
        state
    };
    let pkg = dir.join("Tailscale.pkg");
    if host.download(&package.url, &pkg).is_err() {
        return finish(InstallState::new(
            Phase::Failed,
            "The download didn’t finish, and nothing was installed. Check the connection and try again.",
        ));
    }
    report(InstallState::new(
        Phase::Working,
        "Checking that Tailscale signed it and Apple notarized it…",
    ));
    if !signed_by_tailscale(&host.signature(&pkg)) {
        return finish(InstallState::new(
            Phase::Failed,
            "The download isn’t signed by Tailscale, so it wasn’t installed.",
        ));
    }
    if !notarized(&host.assessment(&pkg), &pkg) {
        return finish(InstallState::new(
            Phase::Failed,
            "macOS didn’t accept the download as notarized by Apple, so it wasn’t installed.",
        ));
    }
    report(InstallState::new(
        Phase::Working,
        "Signed by Tailscale Inc. and notarized by Apple. macOS asks for your password to install it…",
    ));
    match host.install(&pkg) {
        Ok(()) => {}
        Err(InstallStop::Cancelled) => {
            return finish(InstallState::new(
                Phase::Failed,
                "The password question was closed, so nothing was installed.",
            ));
        }
        Err(InstallStop::Failed(_)) => {
            return finish(InstallState::new(
                Phase::Failed,
                "The installer stopped, and nothing else was changed.",
            ));
        }
    }
    if !host.tailscale_found() {
        return finish(InstallState::new(
            Phase::Failed,
            "The installer finished, but Tailscale isn’t in Applications.",
        ));
    }
    finish(InstallState::new(
        Phase::Done,
        "Tailscale is installed. It opens by itself; Redlines waits for it.",
    ))
}

/// Tailscale's app, as the restart sees it.
pub trait Apps {
    /// The processes of Tailscale's app that belong to this user.
    fn pids(&self) -> Vec<i32>;
    /// Asks one to end, as a quit does.
    fn quit(&self, pid: i32);
    fn open_app(&self) -> Result<(), String>;
    fn wait(&self, how_long: Duration);
}

/// Quits Tailscale's app, waits for it to be gone, and opens it again.
pub fn restart(apps: &dyn Apps) -> Result<(), String> {
    for pid in apps.pids() {
        apps.quit(pid);
    }
    // Up to eight seconds, in steps of a fifth.
    for step in 0..=40 {
        if apps.pids().is_empty() {
            break;
        }
        if step == 40 {
            return Err(
                "Tailscale didn’t quit. Quit it from its icon in the menu bar, then open it again."
                    .into(),
            );
        }
        apps.wait(Duration::from_millis(200));
    }
    // A moment for what the app left to settle, as the script waits.
    apps.wait(Duration::from_secs(1));
    apps.open_app()
        .map_err(|_| "Couldn’t open Tailscale. Open it from Applications.".to_string())
}

// ---- the machine

struct Mac;

fn output_of(program: &str, args: &[&str]) -> String {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map(|out| {
            format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            )
        })
        .unwrap_or_default()
}

/// Runs a checking program: what it printed and whether it exited with 0.
fn checked_output(program: &str, args: &[&str]) -> Checked {
    match Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
    {
        Ok(out) => Checked {
            ok: out.status.success(),
            text: format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            ),
        },
        Err(_) => Checked {
            ok: false,
            text: String::new(),
        },
    }
}

/// `text` as a regular expression that matches it and nothing else.
fn regex_escaped(text: &str) -> String {
    let mut escaped = String::new();
    for c in text.chars() {
        if "\\.^$*+?()[]{}|".contains(c) {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

fn header(headers: &str, name: &str) -> Option<String> {
    headers
        .lines()
        .rev()
        .filter_map(|line| line.split_once(':'))
        .find(|(key, _)| key.trim().eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim().to_string())
}

impl Host for Mac {
    fn is_admin(&self) -> bool {
        let user = output_of("/usr/bin/id", &["-un"]);
        let user = user.trim();
        !user.is_empty()
            && Command::new("/usr/sbin/dseditgroup")
                .args(["-o", "checkmember", "-m", user, "admin"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
    }

    fn package(&self) -> Package {
        let head = |url: &str| {
            output_of(
                "/usr/bin/curl",
                &[
                    "-sSI",
                    "--proto",
                    "=https",
                    "--max-redirs",
                    "0",
                    "--max-time",
                    "10",
                    url,
                ],
            )
        };
        let url = package_url(header(&head(PACKAGE_LATEST), "location").as_deref());
        let bytes = header(&head(&url), "content-length").and_then(|n| n.parse().ok());
        Package {
            version: version_of(&url),
            url,
            bytes,
        }
    }

    fn work_dir(&self) -> Result<PathBuf, String> {
        use std::os::unix::fs::DirBuilderExt;
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let dir =
            std::env::temp_dir().join(format!("redlines-tailscale-{}-{nanos}", std::process::id()));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&dir)
            .map_err(|error| error.to_string())?;
        Ok(dir)
    }

    fn download(&self, url: &str, to: &Path) -> Result<(), String> {
        let status = Command::new("/usr/bin/curl")
            .args([
                // The versioned address on pkgs.tailscale.com, fetched as it is: a redirect (to
                // another host, or any) is not followed, and fails.
                "-fsS",
                "--proto",
                "=https",
                "--max-redirs",
                "0",
                "--max-filesize",
                "209715200",
                "--max-time",
                "900",
                "-o",
            ])
            .arg(to)
            .arg(url)
            .stdin(Stdio::null())
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("curl failed".into())
        }
    }

    fn signature(&self, pkg: &Path) -> Checked {
        checked_output(
            "/usr/sbin/pkgutil",
            &["--check-signature", &pkg.display().to_string()],
        )
    }

    fn assessment(&self, pkg: &Path) -> Checked {
        checked_output(
            "/usr/sbin/spctl",
            &[
                "--assess",
                "--type",
                "install",
                "-vv",
                &pkg.display().to_string(),
            ],
        )
    }

    fn install(&self, pkg: &Path) -> Result<(), InstallStop> {
        let out = Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(admin_script(pkg))
            .stdin(Stdio::null())
            .output()
            .map_err(|error| InstallStop::Failed(error.to_string()))?;
        if out.status.success() {
            return Ok(());
        }
        let said = String::from_utf8_lossy(&out.stderr).to_string();
        // AppleScript's error -128 is the person pressing Cancel in the system's prompt.
        if said.contains("(-128)") || said.contains("User canceled") {
            Err(InstallStop::Cancelled)
        } else {
            Err(InstallStop::Failed(said))
        }
    }

    fn open(&self, target: &str) -> Result<(), String> {
        let status = Command::new("/usr/bin/open")
            .arg(target)
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("open failed".into())
        }
    }

    fn tailscale_found(&self) -> bool {
        tailscale::find(&tailscale::places()).is_some() || tailscale::app_installed_here()
    }

    fn remove_dir(&self, dir: &Path) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

impl Apps for Mac {
    fn pids(&self) -> Vec<i32> {
        // SAFETY: `geteuid` takes nothing and can't fail.
        let uid = unsafe { libc::geteuid() };
        let mut pids = Vec::new();
        for app in tailscale::app_places() {
            let pattern = format!(
                "^{}/Contents/MacOS/Tailscale$",
                regex_escaped(&app.display().to_string())
            );
            let found = output_of("/usr/bin/pgrep", &["-U", &uid.to_string(), "-f", &pattern]);
            pids.extend(
                found
                    .lines()
                    .filter_map(|line| line.trim().parse::<i32>().ok()),
            );
        }
        pids
    }

    fn quit(&self, pid: i32) {
        if pid > 1 {
            // SAFETY: a plain request to end, to a process of this user's own that `pgrep` named.
            unsafe { libc::kill(pid, libc::SIGTERM) };
        }
    }

    fn open_app(&self) -> Result<(), String> {
        let app = tailscale::app_places()
            .into_iter()
            .find(|app| app.is_dir())
            .ok_or_else(|| "no app".to_string())?;
        Host::open(self, &app.display().to_string())
    }

    fn wait(&self, how_long: Duration) {
        std::thread::sleep(how_long);
    }
}

// ---- signing in

/// The sign-in address in a line `tailscale login` printed, if it holds one: a secure page of
/// Tailscale's own, and nothing else.
pub fn login_url_in(line: &str) -> Option<String> {
    line.split_whitespace()
        .find(|word| word.starts_with("https://"))
        .map(|word| word.trim_end_matches(['.', ',', ')']).to_string())
        .filter(|url| tailscale::is_tailscale_address(url))
}

/// Starts `tailscale login` and waits up to `limit` for the address it prints. The command goes on
/// (it ends when the person has signed in), and is ended after `keep` if it hasn't.
pub fn start_login(program: &Path, limit: Duration, keep: Duration) -> Option<String> {
    let mut child = Command::new(program)
        .arg("login")
        .env("TAILSCALE_BE_CLI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let (sender, lines) = mpsc::channel();
    let readers: [Option<Box<dyn Read + Send>>; 2] = [
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    ];
    for reader in readers.into_iter().flatten() {
        let sender = sender.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(reader.take(64 * 1024))
                .lines()
                .map_while(Result::ok)
            {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
    }
    drop(sender);
    let started = Instant::now();
    let mut found = None;
    while let Some(left) = limit.checked_sub(started.elapsed()) {
        match lines.recv_timeout(left) {
            Ok(line) => {
                if let Some(url) = login_url_in(&line) {
                    found = Some(url);
                    break;
                }
            }
            Err(_) => break,
        }
    }
    // The command waits for the sign-in; it is ended when it has waited long enough, or at once
    // when it gave no address.
    if found.is_some() {
        std::thread::spawn(move || {
            let started = Instant::now();
            while started.elapsed() < keep {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            let _ = child.kill();
            let _ = child.wait();
        });
    } else {
        let _ = child.kill();
        let _ = child.wait();
    }
    found
}

// ---- the commands

static STATE: Mutex<Option<InstallState>> = Mutex::new(None);

fn set_state(state: InstallState) {
    *STATE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(state);
}

/// The install, with a panic in it turned into a failure the window can show (it must not leave
/// the window waiting for ever); the download's folder is removed on the way out of the panic.
pub fn run_guarded(host: &dyn Host, report: &dyn Fn(InstallState)) -> InstallState {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_install(host, report)))
        .unwrap_or_else(|_| {
            InstallState::new(
                Phase::Failed,
                "Something went wrong while installing Tailscale, and nothing else was changed.",
            )
        })
}

/// Starts the install, which runs on a thread of its own: the window asks `tailscale_install_state`
/// for how it goes. Asked again while it runs, it does nothing more.
#[tauri::command]
pub fn tailscale_install() {
    {
        let mut state = STATE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.as_ref().is_some_and(|s| s.phase == Phase::Working) {
            return;
        }
        *state = Some(InstallState::new(Phase::Working, "Looking at this Mac…"));
    }
    std::thread::spawn(|| {
        set_state(run_guarded(&Mac, &set_state));
    });
}

/// How the install goes: `idle` before one was asked for.
#[tauri::command]
pub fn tailscale_install_state() -> InstallState {
    STATE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
        .unwrap_or_else(|| InstallState::new(Phase::Idle, ""))
}

/// Opens Tailscale's page in the App Store.
#[tauri::command(async)]
pub fn tailscale_open_app_store() -> Result<(), String> {
    Host::open(&Mac, APP_STORE).map_err(|_| "Couldn’t open the App Store.".to_string())
}

/// Quits Tailscale's app and opens it again, for a sign-in that hangs.
#[tauri::command(async)]
pub fn tailscale_restart_app() -> Result<(), String> {
    restart(&Mac)
}

/// Opens the page for signing in to Tailscale: the one Tailscale already gave (`url`), else the one
/// `tailscale login` prints.
#[tauri::command(async)]
pub fn tailscale_sign_in(url: Option<String>) -> Result<(), String> {
    let wrong = "Tailscale didn’t start the sign-in. Restart Tailscale and try again.";
    let page = match url.filter(|url| tailscale::is_tailscale_address(url)) {
        Some(url) => url,
        None => {
            let program = tailscale::find(&tailscale::places()).ok_or_else(|| wrong.to_string())?;
            start_login(&program, Duration::from_secs(15), Duration::from_secs(600))
                .ok_or_else(|| wrong.to_string())?
        }
    };
    Host::open(&Mac, &page).map_err(|_| "Couldn’t open the sign-in page.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::os::unix::fs::PermissionsExt;

    const GOOD_SIGNATURE: &str = "Package \"Tailscale.pkg\":\n   Status: signed by a developer certificate issued by Apple for distribution\n   Notarization: trusted by the Apple notary service\n   Signed with a trusted timestamp on: 2026-10-01 10:00:00 +0000\n   Certificate Chain:\n    1. Developer ID Installer: Tailscale Inc. (W5364U7YZB)\n       Expires: 2030-01-01 00:00:00 +0000\n    2. Developer ID Certification Authority\n    3. Apple Root CA\n";
    const GOOD_ASSESSMENT: &str = "/fake/work/Tailscale.pkg: accepted\nsource=Notarized Developer ID\norigin=Developer ID Installer: Tailscale Inc. (W5364U7YZB)\n";

    fn said(text: &str) -> Checked {
        Checked {
            ok: true,
            text: text.into(),
        }
    }

    /// A machine that records what was asked of it and installs nothing.
    struct Fake {
        admin: bool,
        found: RefCell<bool>,
        found_after_install: bool,
        signature: Checked,
        assessment: Checked,
        download_ok: bool,
        install: RefCell<Option<Result<(), InstallStop>>>,
        calls: RefCell<Vec<String>>,
    }

    impl Fake {
        fn good() -> Self {
            Fake {
                admin: true,
                found: RefCell::new(false),
                found_after_install: true,
                signature: said(GOOD_SIGNATURE),
                assessment: said(GOOD_ASSESSMENT),
                download_ok: true,
                install: RefCell::new(Some(Ok(()))),
                calls: RefCell::new(Vec::new()),
            }
        }
        fn called(&self, what: &str) -> bool {
            self.calls
                .borrow()
                .iter()
                .any(|call| call.starts_with(what))
        }
    }

    impl Host for Fake {
        fn is_admin(&self) -> bool {
            self.admin
        }
        fn package(&self) -> Package {
            Package {
                url: "https://pkgs.tailscale.com/stable/Tailscale-1.80.2-macos.pkg".into(),
                version: Some("1.80.2".into()),
                bytes: Some(30_000_000),
            }
        }
        fn work_dir(&self) -> Result<PathBuf, String> {
            Ok(PathBuf::from("/fake/work"))
        }
        fn download(&self, url: &str, to: &Path) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(format!("download {url} {}", to.display()));
            if self.download_ok {
                Ok(())
            } else {
                Err("no".into())
            }
        }
        fn signature(&self, _: &Path) -> Checked {
            self.signature.clone()
        }
        fn assessment(&self, _: &Path) -> Checked {
            self.assessment.clone()
        }
        fn install(&self, pkg: &Path) -> Result<(), InstallStop> {
            self.calls
                .borrow_mut()
                .push(format!("install {}", pkg.display()));
            let result = self.install.borrow_mut().take().expect("installed once");
            if result.is_ok() {
                *self.found.borrow_mut() = self.found_after_install;
            }
            result
        }
        fn open(&self, target: &str) -> Result<(), String> {
            self.calls.borrow_mut().push(format!("open {target}"));
            Ok(())
        }
        fn tailscale_found(&self) -> bool {
            *self.found.borrow()
        }
        fn remove_dir(&self, dir: &Path) {
            self.calls
                .borrow_mut()
                .push(format!("remove {}", dir.display()));
        }
    }

    fn run(host: &Fake) -> (InstallState, Vec<InstallState>) {
        let told = RefCell::new(Vec::new());
        let last = run_install(host, &|state| told.borrow_mut().push(state));
        (last, told.into_inner())
    }

    #[test]
    fn a_verified_package_is_installed_through_the_administrator_prompt_and_nothing_is_left() {
        let host = Fake::good();
        let (last, told) = run(&host);
        assert_eq!(last.phase, Phase::Done);
        assert!(host.called("download https://pkgs.tailscale.com/stable/Tailscale-1.80.2-macos.pkg /fake/work/Tailscale.pkg"));
        // The file that was checked is the file that is installed.
        assert!(host.called("install /fake/work/Tailscale.pkg"));
        assert!(host.called("remove /fake/work"));
        // The window is told of each step, in order, with the size and version.
        assert!(
            told[0].step.contains("1.80.2") && told[0].step.contains("29 MB"),
            "{told:?}"
        );
        assert!(told.iter().any(|s| s.step.contains("password")));
    }

    #[test]
    fn a_package_not_signed_by_tailscale_is_refused_before_it_is_installed() {
        let good = GOOD_SIGNATURE;
        let wrong: Vec<(&str, Checked)> = vec![
            ("no signature", said("Package \"Tailscale.pkg\":\n   Status: no signature\n")),
            (
                "another team",
                said(&good.replace("W5364U7YZB", "ABCDE12345")),
            ),
            (
                "the right team on an application certificate",
                said(&good.replace("Developer ID Installer", "Developer ID Application")),
            ),
            (
                "the team text in the wrong place: not the leaf of the chain",
                said(&good.replace(
                    "    1. Developer ID Installer: Tailscale Inc. (W5364U7YZB)\n",
                    "    1. Developer ID Installer: Someone Else (ABCDE12345)\n    2. Developer ID Installer: Tailscale Inc. (W5364U7YZB)\n",
                )),
            ),
            (
                "the team text inside another line",
                said(&good.replace(
                    "    1. Developer ID Installer: Tailscale Inc. (W5364U7YZB)\n",
                    "    1. Developer ID Installer: Evil Ltd. (ABCDE12345) not Developer ID Installer: Tailscale Inc. (W5364U7YZB)\n",
                )),
            ),
            (
                "an untrusted signature",
                said(&good.replace(
                    "signed by a developer certificate issued by Apple for distribution",
                    "signed by a certificate that is not trusted",
                )),
            ),
            (
                "a revoked one",
                said(&good.replace(
                    "signed by a developer certificate issued by Apple for distribution",
                    "signed by a developer certificate issued by Apple for distribution (revoked)",
                )),
            ),
            (
                "good-looking text and a failing exit",
                Checked {
                    ok: false,
                    text: good.into(),
                },
            ),
            ("nothing", said("")),
        ];
        for (why, signature) in wrong {
            let host = Fake {
                signature,
                ..Fake::good()
            };
            let (last, _) = run(&host);
            assert_eq!(last.phase, Phase::Failed, "{why}");
            assert!(
                last.step.contains("isn’t signed by Tailscale"),
                "{why}: {}",
                last.step
            );
            assert!(!host.called("install"), "installed anyway: {why}");
            assert!(host.called("remove"), "left the download: {why}");
        }
    }

    #[test]
    fn a_package_apple_did_not_notarize_is_refused_before_it_is_installed() {
        let pkg = "/fake/work/Tailscale.pkg";
        let good = GOOD_ASSESSMENT;
        let wrong: Vec<(&str, Checked)> = vec![
            (
                "rejected",
                said(&format!(
                    "{pkg}: rejected\nsource=Unnotarized Developer ID\n"
                )),
            ),
            (
                "not notarized",
                said(&good.replace("Notarized Developer ID", "Developer ID")),
            ),
            (
                "a verdict for another file",
                said(&good.replace(pkg, "/fake/other/Tailscale.pkg")),
            ),
            (
                "a path that contains accepted, and a rejection",
                said(&format!(
                    "{pkg}: rejected\n/x/{pkg}: accepted\nsource=Notarized Developer ID\norigin=Developer ID Installer: Tailscale Inc. (W5364U7YZB)\n"
                )),
            ),
            (
                "an origin line of another team",
                said(&good.replace("W5364U7YZB", "ABCDE12345")),
            ),
            (
                "no origin line",
                said(&format!("{pkg}: accepted\nsource=Notarized Developer ID\n")),
            ),
            (
                "the source inside another line",
                said(&good.replace(
                    "source=Notarized Developer ID",
                    "note: source=Notarized Developer ID",
                )),
            ),
            (
                "good-looking text and a failing exit",
                Checked {
                    ok: false,
                    text: good.into(),
                },
            ),
            ("nothing", said("")),
        ];
        for (why, assessment) in wrong {
            let host = Fake {
                assessment,
                ..Fake::good()
            };
            let (last, _) = run(&host);
            assert_eq!(last.phase, Phase::Failed, "{why}");
            assert!(last.step.contains("notarized"), "{why}: {}", last.step);
            assert!(!host.called("install"), "installed anyway: {why}");
        }
    }

    #[test]
    fn a_person_who_is_not_an_administrator_is_sent_to_the_app_store_and_nothing_is_downloaded() {
        let host = Fake {
            admin: false,
            ..Fake::good()
        };
        let (last, _) = run(&host);
        assert_eq!(last.phase, Phase::AppStore);
        assert!(host.called("open macappstore://apps.apple.com/app/id1475387142"));
        assert!(!host.called("download") && !host.called("install"));
    }

    #[test]
    fn a_failed_download_a_closed_prompt_and_a_failed_installer_each_say_what_happened() {
        let host = Fake {
            download_ok: false,
            ..Fake::good()
        };
        let (last, _) = run(&host);
        assert_eq!(last.phase, Phase::Failed);
        assert!(
            last.step.contains("download didn’t finish")
                && last.step.contains("nothing was installed")
        );
        assert!(!host.called("install"));

        let host = Fake {
            install: RefCell::new(Some(Err(InstallStop::Cancelled))),
            ..Fake::good()
        };
        let (last, _) = run(&host);
        assert!(
            last.step.contains("password question was closed"),
            "{}",
            last.step
        );
        assert!(host.called("remove"));

        let host = Fake {
            install: RefCell::new(Some(Err(InstallStop::Failed("boom".into())))),
            ..Fake::good()
        };
        let (last, _) = run(&host);
        assert!(last.step.contains("installer stopped"), "{}", last.step);
        assert!(!last.step.contains("boom"));

        let host = Fake {
            found_after_install: false,
            ..Fake::good()
        };
        let (last, _) = run(&host);
        assert!(last.step.contains("isn’t in Applications"), "{}", last.step);
    }

    #[test]
    fn a_panic_in_the_install_is_a_failure_and_the_download_is_removed() {
        struct Panics(Fake);
        impl Host for Panics {
            fn is_admin(&self) -> bool {
                self.0.is_admin()
            }
            fn package(&self) -> Package {
                self.0.package()
            }
            fn work_dir(&self) -> Result<PathBuf, String> {
                self.0.work_dir()
            }
            fn download(&self, url: &str, to: &Path) -> Result<(), String> {
                self.0.download(url, to)
            }
            fn signature(&self, pkg: &Path) -> Checked {
                self.0.signature(pkg)
            }
            fn assessment(&self, _: &Path) -> Checked {
                panic!("the program could not be run");
            }
            fn install(&self, pkg: &Path) -> Result<(), InstallStop> {
                self.0.install(pkg)
            }
            fn open(&self, target: &str) -> Result<(), String> {
                self.0.open(target)
            }
            fn tailscale_found(&self) -> bool {
                self.0.tailscale_found()
            }
            fn remove_dir(&self, dir: &Path) {
                self.0.remove_dir(dir)
            }
        }
        let host = Panics(Fake::good());
        let last = run_guarded(&host, &|_| {});
        assert_eq!(last.phase, Phase::Failed);
        assert!(
            last.step.contains("nothing else was changed"),
            "{}",
            last.step
        );
        assert!(host.0.called("download"));
        assert!(host.0.called("remove /fake/work"), "the download was left");
        assert!(!host.0.called("install"));
    }

    #[test]
    fn with_tailscale_already_there_nothing_is_done() {
        let host = Fake::good();
        *host.found.borrow_mut() = true;
        let (last, _) = run(&host);
        assert_eq!(last.phase, Phase::Done);
        assert!(host.calls.borrow().is_empty());
    }

    #[test]
    fn only_a_package_of_tailscales_own_folder_is_followed() {
        let ok = "https://pkgs.tailscale.com/stable/Tailscale-1.80.2-macos.pkg";
        assert_eq!(package_url(Some("/stable/Tailscale-1.80.2-macos.pkg")), ok);
        assert_eq!(package_url(Some(&format!(" {ok}\r"))), ok);
        for wrong in [
            "https://evil.example/stable/Tailscale-1.80.2-macos.pkg",
            "https://pkgs.tailscale.com.evil.example/stable/Tailscale-1-macos.pkg",
            "https://pkgs.tailscale.com/stable/Tailscale-1.0/../x-macos.pkg",
            "https://pkgs.tailscale.com/stable/Tailscale--macos.pkg",
            "http://pkgs.tailscale.com/stable/Tailscale-1.80.2-macos.pkg",
            "https://pkgs.tailscale.com/stable/other.pkg",
            "",
        ] {
            assert_eq!(package_url(Some(wrong)), PACKAGE_LATEST, "{wrong}");
        }
        assert_eq!(package_url(None), PACKAGE_LATEST);
        assert_eq!(version_of(ok).as_deref(), Some("1.80.2"));
        assert_eq!(version_of(PACKAGE_LATEST).as_deref(), Some("latest"));
    }

    #[test]
    fn the_administrator_script_checks_and_installs_a_root_owned_copy_in_one_chain() {
        let script = admin_script(Path::new("/tmp/redlines-tailscale-1/Tailscale.pkg"));
        // The path reaches the shell as AppleScript's quoted form, once, and nothing else of the
        // user's is in the script.
        assert_eq!(script.matches("quoted form of").count(), 1);
        assert!(script.contains("quoted form of \"/tmp/redlines-tailscale-1/Tailscale.pkg\""));
        assert!(script.ends_with("with administrator privileges"));
        assert_eq!(script.matches("/tmp/redlines-tailscale-1").count(), 1);
        // In this order, each step after the one before it with `&&`: a root-only folder, the copy,
        // its owner and mode, the signature, the status, the team, the verdict, the source, the
        // origin, and then the installer on the copy and not on the file the user could change.
        let in_order = [
            "/usr/bin/mktemp -d /private/var/tmp/redlines-tailscale.",
            "/bin/cp ",
            "&& /usr/sbin/chown root:wheel",
            "&& /bin/chmod 600",
            "&& /usr/sbin/pkgutil --check-signature",
            "Status: signed by a developer certificate issued by Apple for distribution",
            "Developer ID Installer: .+ \\\\(W5364U7YZB\\\\)",
            "&& /usr/sbin/spctl --assess --type install -vv",
            "accepted",
            "source=Notarized Developer ID",
            "origin=Developer ID Installer",
            "&& /usr/sbin/installer -pkg \\\"$P\\\" -target /",
        ];
        let mut from = 0;
        for piece in in_order {
            let at = script[from..]
                .find(piece)
                .unwrap_or_else(|| panic!("{piece} is missing or out of order in {script}"));
            from += at + piece.len();
        }
        // The installer is the last thing, and the folder is removed however it ends.
        assert!(script.contains("trap '/bin/rm -rf"));
        assert!(!script.contains("-pkg \\\"/tmp"));
        // A path with quotes and backslashes is escaped as an AppleScript string.
        let odd = admin_script(Path::new("/tmp/a\"b\\c/Tailscale.pkg"));
        assert!(
            odd.contains("quoted form of \"/tmp/a\\\"b\\\\c/Tailscale.pkg\""),
            "{odd}"
        );
    }

    #[test]
    fn the_app_path_in_the_process_pattern_matches_itself_only() {
        assert_eq!(
            regex_escaped("/Users/a.b/App (x)/Tailscale.app"),
            "/Users/a\\.b/App \\(x\\)/Tailscale\\.app"
        );
    }

    struct FakeApps {
        running: RefCell<Vec<i32>>,
        stubborn: bool,
        quits: RefCell<Vec<i32>>,
        opened: RefCell<u32>,
        waited: RefCell<Duration>,
    }

    impl Apps for FakeApps {
        fn pids(&self) -> Vec<i32> {
            self.running.borrow().clone()
        }
        fn quit(&self, pid: i32) {
            self.quits.borrow_mut().push(pid);
            if !self.stubborn {
                self.running.borrow_mut().retain(|p| *p != pid);
            }
        }
        fn open_app(&self) -> Result<(), String> {
            *self.opened.borrow_mut() += 1;
            Ok(())
        }
        fn wait(&self, how_long: Duration) {
            *self.waited.borrow_mut() += how_long;
        }
    }

    fn apps(running: &[i32], stubborn: bool) -> FakeApps {
        FakeApps {
            running: RefCell::new(running.to_vec()),
            stubborn,
            quits: RefCell::new(Vec::new()),
            opened: RefCell::new(0),
            waited: RefCell::new(Duration::ZERO),
        }
    }

    #[test]
    fn a_restart_quits_the_app_waits_for_it_and_opens_it_again() {
        let fake = apps(&[4242], false);
        assert_eq!(restart(&fake), Ok(()));
        assert_eq!(*fake.quits.borrow(), [4242]);
        assert_eq!(*fake.opened.borrow(), 1);
        // And when it wasn't running (the app that never started), it is just opened.
        let none = apps(&[], false);
        assert_eq!(restart(&none), Ok(()));
        assert!(none.quits.borrow().is_empty());
        assert_eq!(*none.opened.borrow(), 1);
    }

    #[test]
    fn an_app_that_does_not_quit_is_not_opened_over() {
        let fake = apps(&[7], true);
        let error = restart(&fake).unwrap_err();
        assert!(error.contains("didn’t quit"), "{error}");
        assert_eq!(*fake.opened.borrow(), 0);
    }

    #[test]
    fn the_sign_in_address_is_a_page_of_tailscales_own_and_nothing_else() {
        assert_eq!(
            login_url_in("\tAuthenticating at https://login.tailscale.com/a/1234abcd."),
            Some("https://login.tailscale.com/a/1234abcd".into())
        );
        assert_eq!(login_url_in("To authenticate, visit:"), None);
        assert_eq!(
            login_url_in("visit https://evil.example/login.tailscale.com"),
            None
        );
        assert_eq!(login_url_in("visit http://login.tailscale.com/a/1"), None);
    }

    fn fake_tailscale(body: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "redlines-fake-tailscale-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let program = dir.join("tailscale");
        std::fs::write(&program, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        (dir, program)
    }

    #[test]
    fn login_reads_the_address_a_fake_tailscale_prints_and_runs_it_as_the_command_line() {
        let (dir, program) = fake_tailscale(
            "[ \"$1\" = login ] && [ \"$TAILSCALE_BE_CLI\" = 1 ] || exit 3\n\
             echo 'To authenticate, visit:' >&2\n\
             echo '  https://login.tailscale.com/a/9f8e7d' >&2\n\
             sleep 30",
        );
        let started = Instant::now();
        let url = start_login(&program, Duration::from_secs(5), Duration::from_millis(200));
        assert_eq!(url.as_deref(), Some("https://login.tailscale.com/a/9f8e7d"));
        assert!(started.elapsed() < Duration::from_secs(4));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn login_gives_nothing_when_tailscale_prints_no_address_or_none_of_its_own() {
        let (dir, program) = fake_tailscale("echo 'backendManager does not exist' >&2");
        assert_eq!(
            start_login(&program, Duration::from_secs(2), Duration::from_secs(1)),
            None
        );
        std::fs::remove_dir_all(dir).unwrap();
        let (dir, program) = fake_tailscale("echo 'visit https://evil.example/a'");
        assert_eq!(
            start_login(&program, Duration::from_secs(2), Duration::from_secs(1)),
            None
        );
        std::fs::remove_dir_all(dir).unwrap();
        // One that says nothing and doesn't end is waited for only as long as asked.
        let (dir, program) = fake_tailscale("sleep 30");
        let started = Instant::now();
        assert_eq!(
            start_login(&program, Duration::from_millis(300), Duration::from_secs(1)),
            None
        );
        assert!(started.elapsed() < Duration::from_secs(3));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
