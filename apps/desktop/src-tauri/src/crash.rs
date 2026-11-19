//! Crashes (#692). Every way Redlines fails leaves a trace in a log, and the next moment a window
//! can say so, it offers to report it: a gray notification, never a dialog (`src/crash.ts`).
//!
//! What is caught, and who tells the app:
//! - an error in the page (`window.onerror`, an unhandled rejection, CodeMirror's exception sink):
//!   the page, through `crash_log_page`;
//! - the page's web content process ending: WebKit, through Tauri's hook (`terminated`), which also
//!   reloads the window;
//! - a Rust panic: a panic hook (`install_panic_hook`);
//! - a crash of the app itself: the crash report macOS wrote, found at the next launch
//!   (`previous_crashes`);
//! - a page that stops answering: it sends a heartbeat every second or two (`crash_heartbeat`), and
//!   a watchdog notes one that is missing for ten seconds in a window that has the focus (`watch`).
//!
//! Each failure is appended to `crash.log` in the app's log folder, which Reveal Log shows, and kept
//! in `pending.json` until a window takes it (`crash_pending`) and offers the report. The report
//! holds the build, the system, the trace and the document's shape, never its text: the page sends
//! the shape (sizes and counts) with each heartbeat, and the host never sees the document.
//! Slow work (the page's timers that ran late) goes to `slow.log`, a small file of its own.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewWindow};

/// The event that tells the windows there is something to take (`crash_pending`).
const EVENT: &str = "crash-pending";

/// How long a focused window's page may stay silent before it is noted as hung.
const HANG_AFTER: Duration = Duration::from_secs(10);

/// The most a log file holds before it starts over, keeping the old one beside it.
const LOG_LIMIT: u64 = 512 * 1024;

/// The most failures kept for a window that hasn't taken them.
const PENDING_LIMIT: usize = 20;

/// How often a window's page may be reloaded after its process ended, so that a page that dies as
/// it loads doesn't reload for ever.
const RELOADS: usize = 3;
const RELOAD_WINDOW: Duration = Duration::from_secs(60);

/// The kinds of failure, as the page and the report name them.
pub const PAGE_ERROR: &str = "page-error";
pub const WEB_PROCESS: &str = "web-process";
pub const PANIC: &str = "panic";
pub const APP_CRASH: &str = "app-crash";
pub const HANG: &str = "hang";

/// What a document's size and make-up are, never what it says.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Shape {
    pub bytes: u64,
    pub lines: u64,
    pub longest_line: u64,
    pub marks: u64,
    pub comments: u64,
    pub images: u64,
    pub tables: u64,
}

/// One failure.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Problem {
    pub id: String,
    pub kind: String,
    /// UTC, `2026-11-16T12:00:00Z`.
    pub at: String,
    /// The window it happened in, when it happened in one.
    pub window: Option<String>,
    pub message: String,
    pub trace: String,
    pub shape: Option<Shape>,
    /// What the page last said it was doing.
    pub doing: Option<String>,
    /// What the app used, in kilobytes, when it happened.
    pub memory_kb: Option<u64>,
    pub macos: String,
    pub build: String,
}

// ---- where things are kept ----

static FOLDER: OnceLock<PathBuf> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
static COUNTER: Mutex<u32> = Mutex::new(0);
/// Held while `pending.json` is read and written, which a panic, the watchdog and the windows all do.
static PENDING: Mutex<()> = Mutex::new(());

/// What the host knows of each window's page, from its heartbeats.
#[derive(Default)]
pub struct Crashes {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    beats: HashMap<String, Beat>,
    reloads: HashMap<String, Vec<Instant>>,
}

struct Beat {
    last: Instant,
    focused_since: Option<Instant>,
    shape: Option<Shape>,
    doing: Option<String>,
    hung: bool,
}

fn folder() -> Option<&'static Path> {
    FOLDER.get().map(PathBuf::as_path)
}

fn crash_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    Ok(logs.join("crash"))
}

// ---- the entry's text ----

/// Replaces the home folder in `text` with `~`, so that a report names no one.
pub fn scrub(text: &str, home: Option<&str>) -> String {
    let Some(home) = home.filter(|home| home.len() > 1) else {
        return text.to_owned();
    };
    // Only where the folder's name ends: /Users/ann is not /Users/annabel.
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(home) {
        let after = &rest[at + home.len()..];
        out.push_str(&rest[..at]);
        let goes_on = after
            .chars()
            .next()
            .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.');
        out.push_str(if goes_on { home } else { "~" });
        rest = after;
    }
    out.push_str(rest);
    out
}

pub(crate) fn cut(text: &str, most: usize) -> String {
    match text.char_indices().nth(most) {
        Some((end, _)) => format!("{}…", &text[..end]),
        None => text.to_owned(),
    }
}

/// `2026-11-16T12:00:00Z` for a number of seconds since 1970 (Howard Hinnant's civil-from-days).
pub fn iso(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let rest = seconds % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

pub(crate) fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn macos_version() -> &'static str {
    static VERSION: OnceLock<String> = OnceLock::new();
    VERSION.get_or_init(|| {
        let version = std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .map(|text| text.trim().to_owned())
            .filter(|text| !text.is_empty());
        match version {
            Some(version) => format!("macOS {version} ({})", std::env::consts::ARCH),
            None => format!("{} ({})", std::env::consts::OS, std::env::consts::ARCH),
        }
    })
}

/// What the app uses now, in kilobytes, as `ps` says.
fn memory_kb() -> Option<u64> {
    // A storm of errors asks for it again and again: the figure of the last few seconds will do.
    static LAST: Mutex<Option<(Instant, Option<u64>)>> = Mutex::new(None);
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, kb)) = *last
        && at.elapsed() < Duration::from_secs(5)
    {
        return kb;
    }
    let kb = memory_now();
    *last = Some((Instant::now(), kb));
    kb
}

fn memory_now() -> Option<u64> {
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    String::from_utf8(out.stdout).ok()?.trim().parse().ok()
}

/// A failure, with what every one carries.
pub fn problem(
    kind: &str,
    window: Option<&str>,
    message: &str,
    trace: &str,
    shape: Option<Shape>,
    doing: Option<String>,
) -> Problem {
    problem_with(kind, window, message, trace, shape, doing, true)
}

/// A failure; the panic hook's has no memory figure, which would start a program.
fn problem_with(
    kind: &str,
    window: Option<&str>,
    message: &str,
    trace: &str,
    shape: Option<Shape>,
    doing: Option<String>,
    with_memory: bool,
) -> Problem {
    let home = std::env::var("HOME").ok();
    let seconds = now_seconds();
    let count = {
        let mut count = COUNTER.lock().unwrap_or_else(|e| e.into_inner());
        *count += 1;
        *count
    };
    Problem {
        id: format!("{seconds}-{count}"),
        kind: kind.to_owned(),
        at: iso(seconds),
        window: window.map(str::to_owned),
        message: scrub(&cut(message, 300), home.as_deref()),
        trace: scrub(&cut(trace, 20_000), home.as_deref()),
        shape,
        doing: doing.map(|d| cut(&d, 300)),
        memory_kb: if with_memory { memory_kb() } else { None },
        macos: macos_version().to_owned(),
        build: format!("{} ({})", env!("REDLINES_VERSION"), env!("REDLINES_BUILD")),
    }
}

/// How an entry reads in `crash.log`.
pub fn entry_text(p: &Problem) -> String {
    let mut text = format!("=== {} {}", p.at, p.kind);
    if let Some(window) = &p.window {
        text.push_str(&format!(" (window {window})"));
    }
    text.push_str(" ===\n");
    text.push_str(&format!("build: {}\nsystem: {}\n", p.build, p.macos));
    if let Some(kb) = p.memory_kb {
        text.push_str(&format!("memory: {} MB\n", kb / 1024));
    }
    if let Some(shape) = &p.shape {
        text.push_str(&format!(
            "document: {} bytes, {} lines, longest line {}, {} marks, {} comments, {} images, {} tables\n",
            shape.bytes, shape.lines, shape.longest_line, shape.marks, shape.comments, shape.images, shape.tables
        ));
    }
    if let Some(doing) = &p.doing {
        text.push_str(&format!("last doing: {doing}\n"));
    }
    text.push_str(&format!("{}\n", p.message));
    if !p.trace.is_empty() {
        text.push_str(&p.trace);
        if !p.trace.ends_with('\n') {
            text.push('\n');
        }
    }
    text.push('\n');
    text
}

// ---- the files ----

/// Appends to a log, starting over (and keeping the old one as `<name>.old`) past its limit.
pub(crate) fn append(folder: &Path, name: &str, text: &str) -> std::io::Result<()> {
    fs::create_dir_all(folder)?;
    let path = folder.join(name);
    if fs::metadata(&path).is_ok_and(|m| m.len() > LOG_LIMIT) {
        let _ = fs::rename(&path, folder.join(format!("{name}.old")));
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(text.as_bytes())
}

/// Writes the file whole or not at all.
fn write_pending(folder: &Path, pending: &[Problem]) -> std::io::Result<()> {
    let temp = folder.join("pending.json.tmp");
    fs::write(&temp, serde_json::to_string(pending).unwrap_or_default())?;
    fs::rename(temp, folder.join("pending.json"))
}

fn read_pending(folder: &Path) -> Vec<Problem> {
    fs::read_to_string(folder.join("pending.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Logs a failure and keeps it for a window to offer.
pub fn record(folder: &Path, p: &Problem) -> std::io::Result<()> {
    append(folder, "crash.log", &entry_text(p))?;
    let _held = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    let mut pending = read_pending(folder);
    pending.push(p.clone());
    let from = pending.len().saturating_sub(PENDING_LIMIT);
    write_pending(folder, &pending[from..])
}

/// The failures for `window` (and those for no window), which are then no longer pending.
pub fn take_pending(folder: &Path, window: &str) -> Vec<Problem> {
    let _held = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    let all = read_pending(folder);
    let (mine, rest): (Vec<_>, Vec<_>) = all
        .into_iter()
        .partition(|p| p.window.as_deref().is_none_or(|w| w == window));
    if rest.is_empty() {
        let _ = fs::remove_file(folder.join("pending.json"));
    } else {
        let _ = write_pending(folder, &rest);
    }
    mine
}

fn record_and_tell(p: &Problem) {
    let Some(folder) = folder() else { return };
    if let Err(error) = record(folder, p) {
        eprintln!("Could not write the crash log: {error}");
    }
    if let Some(app) = APP.get() {
        // Not from where this is called, which may be a panic's hook or WebKit's callback.
        let app = app.clone();
        std::thread::spawn(move || {
            let _ = app.emit(EVENT, ());
        });
    }
}

// ---- panics ----

/// Writes every panic to the log, after the hook that was there.
fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        previous(info);
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "A panic".to_owned());
        let place = info
            .location()
            .map(|l| format!(" at {}:{}", l.file(), l.line()))
            .unwrap_or_default();
        let trace = std::backtrace::Backtrace::force_capture().to_string();
        record_and_tell(&problem_with(
            PANIC,
            None,
            &format!("{message}{place}"),
            &trace,
            None,
            None,
            false,
        ));
    }));
}

// ---- the last run's crash reports ----

/// What a macOS crash report (`.ips`) says: the exception and the crashed thread's frames.
pub fn summarize_report(text: &str) -> Option<(String, String)> {
    let (_, body) = text.split_once('\n')?;
    let body: serde_json::Value = serde_json::from_str(body).ok()?;
    let mut message = String::from("Redlines crashed");
    let exception = &body["exception"];
    if let Some(kind) = exception["type"].as_str() {
        message.push_str(&format!(": {kind}"));
        if let Some(signal) = exception["signal"].as_str() {
            message.push_str(&format!(" ({signal})"));
        }
    }
    if let Some(reason) = body["termination"]["indicator"].as_str() {
        message.push_str(&format!(", {reason}"));
    }
    let faulting = body["faultingThread"].as_u64().unwrap_or(0) as usize;
    let mut trace = String::new();
    let frames = body["threads"][faulting]["frames"].as_array()?;
    for (i, frame) in frames.iter().take(25).enumerate() {
        let image = frame["imageIndex"]
            .as_u64()
            .and_then(|n| body["usedImages"][n as usize]["name"].as_str())
            .unwrap_or("?");
        let place = match frame["symbol"].as_str() {
            Some(symbol) => format!(
                "{symbol} + {}",
                frame["symbolLocation"].as_u64().unwrap_or(0)
            ),
            None => format!("0x{:x}", frame["imageOffset"].as_u64().unwrap_or(0)),
        };
        trace.push_str(&format!("{i:>2}  {image}  {place}\n"));
    }
    Some((message, trace))
}

/// The crash reports macOS wrote for Redlines since `since`.
pub fn reports_since(folder: &Path, since: SystemTime) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut found: Vec<(SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            let ours = name.starts_with("redlines") && name.ends_with(".ips");
            let modified = entry.metadata().ok()?.modified().ok()?;
            (ours && modified > since).then(|| (modified, entry.path()))
        })
        .collect();
    found.sort();
    found.into_iter().map(|(_, path)| path).collect()
}

/// At launch: the crash reports written since the last launch become failures to offer. The first
/// launch has no "last", and reports nothing.
fn previous_crashes(app: &AppHandle, crash_folder: &Path) {
    let marker = crash_folder.join("launched");
    let since = fs::metadata(&marker).and_then(|m| m.modified()).ok();
    let _ = fs::create_dir_all(crash_folder);
    let _ = fs::write(&marker, iso(now_seconds()));
    let (Some(since), Ok(home)) = (since, app.path().home_dir()) else {
        return;
    };
    let reports = home.join("Library/Logs/DiagnosticReports");
    for path in reports_since(&reports, since) {
        let Some((message, trace)) = fs::read_to_string(&path)
            .ok()
            .and_then(|text| summarize_report(&text))
        else {
            continue;
        };
        let p = problem(APP_CRASH, None, &message, &trace, None, None);
        let _ = record(crash_folder, &p);
    }
}

// ---- hangs ----

/// The windows whose page has been silent for `limit` while they had the focus for as long, each
/// reported once until it beats again.
fn overdue(
    beats: &mut HashMap<String, Beat>,
    now: Instant,
    limit: Duration,
    focused: impl Fn(&str) -> bool,
) -> Vec<(String, Option<Shape>, Option<String>)> {
    let mut found = Vec::new();
    for (label, beat) in beats.iter_mut() {
        if focused(label) {
            beat.focused_since.get_or_insert(now);
        } else {
            beat.focused_since = None;
        }
        let silent = now.duration_since(beat.last) >= limit;
        let focused_long = beat
            .focused_since
            .is_some_and(|s| now.duration_since(s) >= limit);
        if silent && focused_long && !beat.hung {
            beat.hung = true;
            found.push((label.clone(), beat.shape.clone(), beat.doing.clone()));
        }
    }
    found
}

fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let state = app.state::<Crashes>();
            // Asking a window whether it has the focus waits for the main thread, which may be
            // waiting for the lock: never ask while holding it.
            let labels: Vec<String> = {
                let inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
                inner.beats.keys().cloned().collect()
            };
            let focused: HashMap<String, bool> = labels
                .into_iter()
                .map(|label| {
                    let has = app
                        .get_webview_window(&label)
                        .is_some_and(|w| w.is_focused().unwrap_or(false));
                    (label, has)
                })
                .collect();
            let found = {
                let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
                overdue(&mut inner.beats, Instant::now(), HANG_AFTER, |label| {
                    focused.get(label).copied().unwrap_or(false)
                })
            };
            for (label, shape, doing) in found {
                let message = format!("The page of window {label} didn't answer for 10 seconds.");
                record_and_tell(&problem(HANG, Some(&label), &message, "", shape, doing));
            }
        }
    });
}

// ---- the web content process ----

/// Whether a window's page may be reloaded again after its process ended.
fn may_reload(reloads: &mut Vec<Instant>, now: Instant) -> bool {
    reloads.retain(|at| now.duration_since(*at) < RELOAD_WINDOW);
    if reloads.len() >= RELOADS {
        return false;
    }
    reloads.push(now);
    true
}

/// The web content process of `webview` ended: log it, with what the page last said, and reload.
pub fn terminated<R: tauri::Runtime>(webview: &Webview<R>) {
    let label = webview.label().to_owned();
    let app = webview.app_handle().clone();
    let state = app.state::<Crashes>();
    let (shape, doing, reload) = {
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let beat = inner.beats.remove(&label);
        let reload = may_reload(
            inner.reloads.entry(label.clone()).or_default(),
            Instant::now(),
        );
        (
            beat.as_ref().and_then(|b| b.shape.clone()),
            beat.and_then(|b| b.doing),
            reload,
        )
    };
    let message = format!("The web content process of window {label} ended.");
    record_and_tell(&problem(
        WEB_PROCESS,
        Some(&label),
        &message,
        "",
        shape,
        doing,
    ));
    if reload {
        // Not from the callback, which WebKit makes on the main thread.
        let webview = webview.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            if let Err(error) = webview.reload() {
                eprintln!("Could not reload the window: {error}");
            }
        });
    }
}

// ---- the page's commands ----

#[tauri::command(async)]
pub fn crash_log_page(
    window: WebviewWindow,
    message: String,
    trace: String,
    shape: Option<Shape>,
    doing: Option<String>,
) -> Problem {
    let p = problem(
        PAGE_ERROR,
        Some(window.label()),
        &message,
        &trace,
        shape,
        doing,
    );
    if let Some(folder) = folder()
        && let Err(error) = append(folder, "crash.log", &entry_text(&p))
    {
        eprintln!("Could not write the crash log: {error}");
    }
    p
}

/// A timer of the page that ran late, for `slow.log`.
#[tauri::command(async)]
pub fn crash_slow(window: WebviewWindow, millis: u64, doing: Option<String>) {
    if let Some(folder) = folder() {
        let line = format!(
            "{} window {} late by {millis} ms, doing: {}\n",
            iso(now_seconds()),
            window.label(),
            cut(&doing.unwrap_or_default(), 200)
        );
        let _ = append(folder, "slow.log", &line);
    }
}

#[tauri::command(async)]
pub fn crash_heartbeat(
    window: WebviewWindow,
    state: tauri::State<'_, Crashes>,
    shape: Option<Shape>,
    doing: Option<String>,
) {
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let beat = inner
        .beats
        .entry(window.label().to_owned())
        .or_insert_with(|| Beat {
            last: Instant::now(),
            focused_since: None,
            shape: None,
            doing: None,
            hung: false,
        });
    beat.last = Instant::now();
    beat.hung = false;
    if shape.is_some() {
        beat.shape = shape;
    }
    if doing.is_some() {
        beat.doing = doing;
    }
}

/// What failed and wasn't offered yet, for this window.
#[tauri::command(async)]
pub fn crash_pending(window: WebviewWindow) -> Vec<Problem> {
    folder().map_or_else(Vec::new, |f| take_pending(f, window.label()))
}

/// The build and the system, for a report that follows no failure (Help > Report a Problem).
#[derive(Serialize)]
pub struct Environment {
    build: String,
    macos: String,
}

#[tauri::command]
pub fn crash_environment() -> Environment {
    Environment {
        build: format!("{} ({})", env!("REDLINES_VERSION"), env!("REDLINES_BUILD")),
        macos: macos_version().to_owned(),
    }
}

/// Shows `crash.log` in Finder.
#[tauri::command(async)]
pub fn crash_log_reveal(app: AppHandle) -> Result<(), String> {
    let folder = crash_folder(&app)?;
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let log = folder.join("crash.log");
    if !log.exists() {
        fs::write(&log, "").map_err(|e| e.to_string())?;
    }
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(&log)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Couldn’t show the log.".to_owned())
    }
}

/// Debug builds only: makes the failure `kind` happen, to see what it leaves (`panic` and
/// `terminate`; the page makes the others, `src/crash.ts`).
#[tauri::command]
pub fn crash_simulate(window: WebviewWindow, kind: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("Failures are simulated in debug builds only.".to_owned());
    }
    match kind.as_str() {
        "panic" => {
            std::thread::spawn(|| panic!("Simulated panic (crash_simulate)"));
        }
        "terminate" => {
            terminated(window.as_ref());
        }
        other => return Err(format!("Can't simulate {other} here.")),
    }
    Ok(())
}

/// A page starts loading, as after a reload: its silence until it beats is not a hang.
pub fn page_loaded(app: &AppHandle, label: &str) {
    let state = app.state::<Crashes>();
    state
        .inner
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .beats
        .remove(label);
}

/// Window closed: its page is gone, not hung.
pub fn window_closed(app: &AppHandle, label: &str) {
    let state = app.state::<Crashes>();
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.beats.remove(label);
    inner.reloads.remove(label);
}

/// At startup: the panic hook, the watchdog, and the last run's crash reports.
pub fn set_up(app: &AppHandle) {
    let Ok(folder) = crash_folder(app) else {
        return;
    };
    let _ = FOLDER.set(folder.clone());
    let _ = APP.set(app.clone());
    // Found now, not in a panic hook, which starts no program.
    let _ = macos_version();
    install_panic_hook();
    previous_crashes(app, &folder);
    watch(app.clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("redlines-crash-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn page_problem(kind: &str, window: Option<&str>) -> Problem {
        problem(
            kind,
            window,
            "TypeError: x is undefined",
            "at f (a.js:1:2)",
            None,
            Some("scrolling".into()),
        )
    }

    #[test]
    fn the_time_is_written_in_utc() {
        assert_eq!(iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso(1_794_830_400), "2026-11-16T12:00:00Z");
        assert_eq!(iso(951_782_400 + 86_399), "2000-02-29T23:59:59Z");
    }

    #[test]
    fn the_home_folder_is_not_in_a_trace() {
        assert_eq!(
            scrub("at /Users/ada/code/x.rs:1", Some("/Users/ada")),
            "at ~/code/x.rs:1"
        );
        assert_eq!(scrub("at /x.rs", Some("/")), "at /x.rs");
        assert_eq!(
            scrub("/Users/annabel/x /Users/ann/y", Some("/Users/ann")),
            "/Users/annabel/x ~/y"
        );
    }

    #[test]
    fn a_failure_is_logged_and_kept_until_its_window_takes_it() {
        let dir = temp("life");
        let one = page_problem(WEB_PROCESS, Some("main"));
        let two = page_problem(PANIC, None);
        let other = page_problem(HANG, Some("doc-1"));
        for p in [&one, &two, &other] {
            record(&dir, p).unwrap();
        }
        let log = fs::read_to_string(dir.join("crash.log")).unwrap();
        assert!(log.contains("web-process (window main)"));
        assert!(log.contains("panic ==="));
        assert!(log.contains("last doing: scrolling"));
        let taken = take_pending(&dir, "main");
        assert_eq!(
            taken.iter().map(|p| p.kind.as_str()).collect::<Vec<_>>(),
            [WEB_PROCESS, PANIC]
        );
        // doc-1's is still there; a second take of main's finds nothing.
        assert!(take_pending(&dir, "main").is_empty());
        assert_eq!(take_pending(&dir, "doc-1")[0].kind, HANG);
        assert!(!dir.join("pending.json").exists());
        // The log keeps everything.
        assert!(
            fs::read_to_string(dir.join("crash.log"))
                .unwrap()
                .contains("hang (window doc-1)")
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_log_starts_over_when_it_is_big() {
        let dir = temp("rotate");
        append(&dir, "crash.log", &"x".repeat(LOG_LIMIT as usize + 1)).unwrap();
        append(&dir, "crash.log", "new\n").unwrap();
        assert_eq!(fs::read_to_string(dir.join("crash.log")).unwrap(), "new\n");
        assert!(dir.join("crash.log.old").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_entry_holds_the_shape_and_no_text() {
        let mut p = page_problem(PAGE_ERROR, Some("main"));
        p.shape = Some(Shape {
            bytes: 4_700_000,
            lines: 90_000,
            longest_line: 800,
            marks: 12,
            comments: 3,
            images: 2,
            tables: 1,
        });
        let text = entry_text(&p);
        assert!(text.contains(
            "4700000 bytes, 90000 lines, longest line 800, 12 marks, 3 comments, 2 images, 1 tables"
        ));
        assert!(text.contains("TypeError: x is undefined"));
    }

    #[test]
    fn a_silent_focused_page_is_a_hang_reported_once() {
        let start = Instant::now();
        let mut beats = HashMap::new();
        beats.insert(
            "main".to_owned(),
            Beat {
                last: start,
                focused_since: None,
                shape: None,
                doing: Some("typing".into()),
                hung: false,
            },
        );
        beats.insert(
            "doc-1".to_owned(),
            Beat {
                last: start,
                focused_since: None,
                shape: None,
                doing: None,
                hung: false,
            },
        );
        let focused = |label: &str| label == "main";
        // Focus begins now: not yet.
        assert!(
            overdue(
                &mut beats,
                start + Duration::from_secs(2),
                HANG_AFTER,
                focused
            )
            .is_empty()
        );
        // Ten seconds of silence, but main has had the focus for eight: not yet.
        assert!(
            overdue(
                &mut beats,
                start + Duration::from_secs(10),
                HANG_AFTER,
                focused
            )
            .is_empty()
        );
        let found = overdue(
            &mut beats,
            start + Duration::from_secs(13),
            HANG_AFTER,
            focused,
        );
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].0, "main");
        assert_eq!(found[0].2.as_deref(), Some("typing"));
        // Once.
        assert!(
            overdue(
                &mut beats,
                start + Duration::from_secs(20),
                HANG_AFTER,
                focused
            )
            .is_empty()
        );
    }

    #[test]
    fn a_page_that_keeps_dying_is_not_reloaded_for_ever() {
        let mut reloads = Vec::new();
        let start = Instant::now();
        assert!(may_reload(&mut reloads, start));
        assert!(may_reload(&mut reloads, start));
        assert!(may_reload(&mut reloads, start));
        assert!(!may_reload(&mut reloads, start + Duration::from_secs(5)));
        assert!(may_reload(&mut reloads, start + Duration::from_secs(61)));
    }

    #[test]
    fn a_crash_report_of_the_last_run_is_summarized() {
        let report = r#"{"app_name":"Redlines"}
{"exception":{"type":"EXC_BAD_ACCESS","signal":"SIGSEGV"},"termination":{"indicator":"Segmentation fault: 11"},"faultingThread":1,
"threads":[{"frames":[]},{"frames":[{"imageIndex":0,"symbol":"redlines::crash","symbolLocation":12,"imageOffset":4},{"imageIndex":1,"imageOffset":255}]}],
"usedImages":[{"name":"Redlines"},{"name":"libsystem_c.dylib"}]}"#;
        let (message, trace) = summarize_report(report).unwrap();
        assert_eq!(
            message,
            "Redlines crashed: EXC_BAD_ACCESS (SIGSEGV), Segmentation fault: 11"
        );
        assert_eq!(
            trace,
            " 0  Redlines  redlines::crash + 12\n 1  libsystem_c.dylib  0xff\n"
        );
        assert!(summarize_report("not a report").is_none());
    }

    #[test]
    fn only_new_reports_of_redlines_are_found() {
        let dir = temp("reports");
        let before = SystemTime::now() - Duration::from_secs(60);
        fs::write(dir.join("Redlines-2026-11-16-120000.ips"), "{}\n{}").unwrap();
        fs::write(dir.join("Other-2026-11-16-120000.ips"), "{}\n{}").unwrap();
        fs::write(dir.join("Redlines-2026-11-16-120000.crash"), "").unwrap();
        let found = reports_since(&dir, before);
        assert_eq!(found.len(), 1);
        assert!(found[0].ends_with("Redlines-2026-11-16-120000.ips"));
        assert!(reports_since(&dir, SystemTime::now() + Duration::from_secs(60)).is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}
