//! Watching a window's document for changes made elsewhere (#26), such as an agent's edits through
//! the `redlines` command line. The app watches, not the page: a document window may watch nothing
//! itself (`capabilities/default.json`). It asks the app to watch its document (`watch_document`),
//! which must be a file it may use (`file_scope`), and hears when that file changes, is replaced or
//! is removed, and nothing of the other files beside it.
//!
//! A document is watched through its folder, and its events are picked out by its name. A watch on
//! the file itself stays with the file it found, and an editor or the command line replaces a file
//! by writing a new one beside it and renaming that over it: on Linux (inotify) the first rename
//! would end such a watch. Every document is watched this way, wherever it is: in the home folder
//! or not, in a hidden folder or not.
//!
//! A link is followed by the command line, which writes the file the link names, in that file's
//! folder and under that file's name, where the link's own folder sees nothing. So both are
//! watched: the link, for when it is replaced, and the file it names. The link is followed once, as
//! the watch starts: replaced by a link to another file, it is reported, and the window reads that
//! file, but hears of that file's own changes only once it watches again. Names are compared as macOS
//! compares them, in any case and Unicode form (`same_name`): the window, the disk and a writer may
//! each spell the document's name another way.
//!
//! A folder that can't be watched, such as one the person may not list, leaves the file itself to
//! watch, which sees what a watch on a file sees. A document whose folder is gone can't be watched
//! at all, and the window says so.
//!
//! What a window may have watched is any file it may use, and the windows share those
//! (`file_scope`): one window can have another's document watched. It learns only when a file it
//! could read anyway changes, as the file system plugin's watch let it before. A window may have
//! `MOST_PER_WINDOW` watches at once, far more than its one document needs: each costs a thread,
//! and a watcher for each folder, which on Linux is an inotify instance, of which a user may have
//! only so many (often 128).
//!
//! The events of a change are gathered for `DELAY` and reported once. A window's watches end when
//! it stops them (another document, a rename, Save As), when its page loads again (a reload), or
//! when it closes; a watch that was still starting then is stopped as soon as it has started.

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_fs::FsExt;

use crate::file_scope;
use crate::windows::Windows;

/// How many watches a window may have at once: far more than the one document it holds needs, and
/// the watch of the next one while it opens.
const MOST_PER_WINDOW: usize = 16;

/// How long the events of one change are gathered before it is reported: a change shows as several
/// events, the file's own and those of a file renamed over it.
pub const DELAY: Duration = Duration::from_millis(200);

/// One document's watch. Dropping it stops it, and nothing is reported after.
pub struct Watch {
    /// Set once the watch stops, so that a change being gathered then isn't reported.
    stopped: Arc<AtomicBool>,
    /// What is watched, a folder or the file itself, and the watcher of each.
    watchers: Vec<(PathBuf, RecommendedWatcher)>,
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.watchers.clear();
    }
}

impl Watch {
    /// Watches the document at `path`, and calls `changed` a `delay` after the first event of each
    /// change to it. Fails only when nothing at all can be watched for it.
    pub fn start(
        path: &Path,
        delay: Duration,
        changed: impl Fn() + Send + 'static,
    ) -> Result<Self, String> {
        let stopped = Arc::new(AtomicBool::new(false));
        let wait = move || std::thread::sleep(delay);
        let report = gather(wait, Arc::clone(&stopped), changed)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        let mut watchers = Vec::new();
        let mut failures = Vec::new();
        for (folder, names) in places(path) {
            match watch_folder(&folder, names.clone(), report.clone()) {
                Ok(watcher) => {
                    watchers.push((folder, watcher));
                    continue;
                }
                Err(error) => failures.push(format!("{}: {error}", folder.display())),
            }
            for name in names {
                let file = folder.join(name);
                match watch_file(&file, report.clone()) {
                    Ok(watcher) => watchers.push((file, watcher)),
                    Err(error) => failures.push(format!("{}: {error}", file.display())),
                }
            }
        }
        // What can be watched is enough: the other name the file goes by is only one more way to
        // hear of a change.
        if watchers.is_empty() {
            return Err(format!(
                "Redlines can't watch {}: {}",
                path.display(),
                failures.join("; ")
            ));
        }
        for failure in failures {
            eprintln!("Redlines can't watch {failure}");
        }
        Ok(Self { stopped, watchers })
    }

    /// A watch of nothing, and what says whether it has stopped, for tests of what keeps watches.
    #[cfg(test)]
    fn idle() -> (Self, Arc<AtomicBool>) {
        let stopped = Arc::new(AtomicBool::new(false));
        let watch = Self {
            stopped: Arc::clone(&stopped),
            watchers: Vec::new(),
        };
        (watch, stopped)
    }

    /// What is watched: folders, or files where their folders can't be watched.
    #[cfg(test)]
    fn watching(&self) -> Vec<&Path> {
        self.watchers
            .iter()
            .map(|(path, _)| path.as_path())
            .collect()
    }
}

/// Where the document at `path` is watched: each folder, as it really is, with the names to pick out
/// of its events. The path's own folder for the path's name, and the folder of the file it really is
/// for that file's name, which is one folder when the path leads through no link.
fn places(path: &Path) -> Vec<(PathBuf, Vec<OsString>)> {
    let mut places: Vec<(PathBuf, Vec<OsString>)> = Vec::new();
    for file in [path.to_path_buf(), file_scope::real(path)] {
        let (Some(folder), Some(name)) = (file.parent(), file.file_name()) else {
            continue;
        };
        let folder = file_scope::real(folder);
        match places.iter_mut().find(|(place, _)| *place == folder) {
            Some((_, names)) if names.iter().any(|known| known == name) => {}
            Some((_, names)) => names.push(name.to_owned()),
            None => places.push((folder, vec![name.to_owned()])),
        }
    }
    places
}

/// Watches `folder` for changes to the files `names` in it, and tells `report` of each event.
fn watch_folder(
    folder: &Path,
    names: Vec<OsString>,
    report: Sender<()>,
) -> notify::Result<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        // An error may have cost events, which may have been about the file.
        if event.is_err() || event.is_ok_and(|event| is_about(&event, &names)) {
            let _ = report.send(());
        }
    })?;
    watcher.watch(folder, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

/// Watches the file itself, and tells `report` of each event but reads. Every event is about the
/// file, whatever name it carries: watching a link, the system reports the file the link names.
fn watch_file(file: &Path, report: Sender<()>) -> notify::Result<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        if !event.is_ok_and(|event| matches!(event.kind, EventKind::Access(_))) {
            let _ = report.send(());
        }
    })?;
    watcher.watch(file, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

/// Whether an event from watching a folder is about one of the files `names` in it: a change to it,
/// or to a file renamed over it or away from it. Other files in the folder, and reads of the file,
/// are not. An event that says events were lost may be about it, and is.
fn is_about(event: &Event, names: &[OsString]) -> bool {
    // Reads show up as access events on some systems; reporting them would loop, for the window
    // reads the file it hears about.
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    if event.need_rescan() || event.paths.is_empty() {
        return true;
    }
    event.paths.iter().any(|path| {
        path.file_name()
            .is_some_and(|name| names.iter().any(|wanted| same_name(name, wanted)))
    })
}

/// Whether a name in an event is `wanted`. macOS finds a file by its name in any case and with its
/// accents composed or not, and a file renamed over the document under another spelling of its name
/// replaces it there, and is reported by that spelling. A name that is only alike, on a disk that
/// tells them apart, costs a look at the document, which finds nothing new.
fn same_name(name: &OsStr, wanted: &OsStr) -> bool {
    name == wanted || comparable(name) == comparable(wanted)
}

/// A file name as macOS compares it: accents composed (NFC), and in lower case.
fn comparable(name: &OsStr) -> String {
    icu_normalizer::ComposingNormalizerBorrowed::new_nfc()
        .normalize(&name.to_string_lossy())
        .to_lowercase()
}

/// Starts the thread that turns the events of a change into one call of `changed`: after the first,
/// it lets `wait` pass (`DELAY`) for the rest, unless the watch has stopped by then. The thread ends
/// with the watch, once nothing is left to tell it of events.
fn gather(
    wait: impl Fn() + Send + 'static,
    stopped: Arc<AtomicBool>,
    changed: impl Fn() + Send + 'static,
) -> std::io::Result<Sender<()>> {
    let (report, reports) = mpsc::channel::<()>();
    std::thread::Builder::new()
        .name("redlines-watch".to_owned())
        .spawn(move || {
            while reports.recv().is_ok() {
                wait();
                while reports.try_recv().is_ok() {}
                if stopped.load(Ordering::SeqCst) {
                    return;
                }
                changed();
            }
        })?;
    Ok(report)
}

/// The watches of every window, by number, and what they need to know of the windows.
#[derive(Default)]
pub struct Watches {
    last_id: AtomicU32,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    /// The watches, each with the window it is for.
    open: HashMap<u32, (String, Watch)>,
    /// How many times each window's page has loaded again since its first.
    pages: HashMap<String, u64>,
    /// The windows that have closed. None comes back: no label is given twice (`windows.rs`).
    closed: HashSet<String>,
}

impl State {
    /// Takes away every watch of the window `window`, for it to stop.
    fn take_all_of(&mut self, window: &str) -> Vec<(String, Watch)> {
        let theirs: Vec<u32> = (self.open.iter())
            .filter(|(_, (owner, _))| owner == window)
            .map(|(id, _)| *id)
            .collect();
        theirs
            .iter()
            .filter_map(|id| self.open.remove(id))
            .collect()
    }
}

impl Watches {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The page the window `window` shows now, counted.
    fn page(&self, window: &str) -> u64 {
        self.lock().pages.get(window).copied().unwrap_or(0)
    }

    /// Keeps the watch that the page `page` of the window `window` asked for, and says its number.
    /// Stops it instead when that page is gone, for the window closed or loaded its page again while
    /// the watch started, which nothing would stop afterwards, or when the window has as many
    /// watches as it may.
    fn add(&self, window: &str, page: u64, watch: Watch) -> Result<u32, String> {
        let mut state = self.lock();
        let current = state.pages.get(window).copied().unwrap_or(0);
        let refused = if state.closed.contains(window) || current != page {
            Some(format!("{window} has closed or loaded its page again"))
        } else if state
            .open
            .values()
            .filter(|(owner, _)| owner == window)
            .count()
            >= MOST_PER_WINDOW
        {
            Some(format!("{window} has {MOST_PER_WINDOW} watches already"))
        } else {
            None
        };
        if let Some(refused) = refused {
            drop(state);
            // Stopped outside the lock: a watcher can take a moment to stop.
            drop(watch);
            return Err(refused);
        }
        let id = self.last_id.fetch_add(1, Ordering::SeqCst) + 1;
        state.open.insert(id, (window.to_owned(), watch));
        Ok(id)
    }

    /// Stops the watch `id`, if it is the window's own. Says whether it was.
    fn stop(&self, window: &str, id: u32) -> bool {
        let stopped = {
            let mut state = self.lock();
            match state.open.get(&id) {
                Some((owner, _)) if owner == window => state.open.remove(&id),
                _ => None,
            }
        };
        stopped.is_some()
    }

    /// The window `window` has loaded its page again, as a reload does: the page before is gone,
    /// and its watches stop. The new page watches what it needs itself.
    pub fn page_loaded(&self, window: &str) {
        let stopped = {
            let mut state = self.lock();
            *state.pages.entry(window.to_owned()).or_insert(0) += 1;
            state.take_all_of(window)
        };
        drop(stopped);
    }

    /// The window `window` has closed: its watches stop, and none it asked for is kept.
    pub fn closed(&self, window: &str) {
        let stopped = {
            let mut state = self.lock();
            state.pages.remove(window);
            state.closed.insert(window.to_owned());
            state.take_all_of(window)
        };
        drop(stopped);
    }
}

/// Whether a window may have the file at `path` watched: a document window, and a file it may use,
/// by its full path.
fn check(document_window: bool, scope: &tauri::fs::Scope, path: &Path) -> Result<(), String> {
    if document_window && path.is_absolute() && file_scope::allowed(scope, path) {
        Ok(())
    } else {
        Err(format!(
            "{}: not a file this window may use",
            path.display()
        ))
    }
}

/// Watches a document for this window, a file it may use, and sends `on_change` a message a moment
/// after each change to it. Says the watch's number, for `unwatch_document`.
#[tauri::command(async)]
pub fn watch_document(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
    on_change: Channel<()>,
) -> Result<u32, String> {
    let path = Path::new(&path);
    let label = window.label();
    let watches = app.state::<Watches>();
    // The page that asks, which the watch is kept for. A request the page before a reload made in
    // the moment of the reload may be counted for the new page, which keeps it until it closes.
    let page = watches.page(label);
    let document_window = app.state::<Windows>().is_document_window(label);
    check(document_window, &app.fs_scope(), path)?;
    let watch = Watch::start(path, DELAY, move || {
        // A window that is going hears nothing more.
        let _ = on_change.send(());
    })?;
    watches.add(label, page, watch)
}

/// Stops one of this window's watches.
#[tauri::command(async)]
pub fn unwatch_document(app: AppHandle, window: WebviewWindow, id: u32) {
    app.state::<Watches>().stop(window.label(), id);
}

/// A window has loaded its page again: the page before's watches stop.
pub fn page_loaded(app: &AppHandle, window: &str) {
    app.state::<Watches>().page_loaded(window);
}

/// A window has closed: its watches stop.
pub fn window_closed(app: &AppHandle, window: &str) {
    app.state::<Watches>().closed(window);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::Receiver;

    /// A new empty folder for one test, as it really is: on macOS the temporary folder is below
    /// /var, which is a link to /private/var.
    fn folder(name: &str) -> PathBuf {
        let folder =
            std::env::temp_dir().join(format!("redlines-watch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::canonicalize(folder).unwrap()
    }

    /// Watches the document at `path`; each report arrives on the receiver.
    fn watch(path: &Path) -> (Watch, Receiver<()>) {
        let (report, reports) = mpsc::channel();
        let watch = Watch::start(path, DELAY, move || {
            let _ = report.send(());
        })
        .unwrap();
        settle(&reports);
        (watch, reports)
    }

    /// Whether a change is reported, waiting as long as a busy machine could take.
    fn reported(reports: &Receiver<()>) -> bool {
        reports.recv_timeout(Duration::from_secs(10)).is_ok()
    }

    /// Whether nothing is reported for a while, long enough for a report on its way to arrive. On a
    /// machine too busy to report in time, this passes when it shouldn't, never the other way.
    fn quiet(reports: &Receiver<()>) -> bool {
        reports.recv_timeout(Duration::from_secs(1)).is_err()
    }

    /// Waits for the reports of earlier changes, if any are on their way, to be over, so that the
    /// next report is the next change's. Gives up after a while: a change reported again and again
    /// would show in the test that follows.
    fn settle(reports: &Receiver<()>) {
        for _ in 0..10 {
            if reports.recv_timeout(Duration::from_secs(1)).is_err() {
                return;
            }
        }
    }

    /// Replaces the file at `path` as the command line does: writes a new file beside it, and
    /// renames that over it.
    fn replace(path: &Path, text: &str) {
        let name = path.file_name().unwrap().to_string_lossy();
        let temporary = path.with_file_name(format!(".{name}.1a2b3c4d.tmp"));
        std::fs::write(&temporary, text).unwrap();
        std::fs::rename(&temporary, path).unwrap();
    }

    #[test]
    fn reports_a_document_changed_in_place() {
        let folder = folder("in-place");
        let plan = folder.join("plan.md");
        std::fs::write(&plan, "One\n").unwrap();
        let (watch, reports) = watch(&plan);
        assert_eq!(watch.watching(), [folder.as_path()]);

        std::fs::write(&plan, "Two\n").unwrap();
        assert!(reported(&reports));
        settle(&reports);
        std::fs::write(&plan, "Three\n").unwrap();
        assert!(reported(&reports));
        drop(watch);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn reports_each_replacement_of_the_document_by_a_rename() {
        let folder = folder("renames");
        let plan = folder.join("plan.md");
        std::fs::write(&plan, "One\n").unwrap();
        let (watch, reports) = watch(&plan);
        // A watch on the file itself would end with the first rename on Linux.
        for round in 0..5 {
            replace(&plan, &format!("Round {round}\n"));
            assert!(reported(&reports), "round {round}");
            settle(&reports);
        }
        drop(watch);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn reports_the_document_removed_and_put_back() {
        let folder = folder("removed");
        let plan = folder.join("plan.md");
        std::fs::write(&plan, "One\n").unwrap();
        let (watch, reports) = watch(&plan);
        std::fs::remove_file(&plan).unwrap();
        assert!(reported(&reports));
        settle(&reports);
        std::fs::write(&plan, "Back\n").unwrap();
        assert!(reported(&reports));
        drop(watch);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn reports_nothing_of_the_other_files_in_the_folder() {
        let folder = folder("siblings");
        let (plan, other) = (folder.join("plan.md"), folder.join("other.md"));
        std::fs::write(&plan, "One\n").unwrap();
        std::fs::write(&other, "One\n").unwrap();
        let (watch, reports) = watch(&plan);

        std::fs::write(&other, "Two\n").unwrap();
        replace(&other, "Three\n");
        std::fs::write(folder.join("new.md"), "New\n").unwrap();
        std::fs::remove_file(folder.join("new.md")).unwrap();
        // Named after the document, but another file.
        std::fs::write(folder.join("plan.md.bak"), "Old\n").unwrap();
        assert!(quiet(&reports));
        // The document itself still is.
        replace(&plan, "Two\n");
        assert!(reported(&reports));
        drop(watch);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_stopped_watch_lets_go_of_everything_even_with_a_change_on_its_way() {
        // Its watchers and its gathering thread end, and with them what it would report to, which
        // the receiver sees as the sender gone. Whether the change is reported first, the test
        // can't tell from here: gathering one is tested apart from the disk, below.
        let folder = folder("stopped");
        let plan = folder.join("plan.md");
        std::fs::write(&plan, "One\n").unwrap();
        let (watch, reports) = watch(&plan);
        replace(&plan, "Two\n");
        drop(watch);
        let gone = loop {
            match reports.recv_timeout(Duration::from_secs(10)) {
                Ok(()) => continue,
                Err(error) => break error,
            }
        };
        assert_eq!(gone, mpsc::RecvTimeoutError::Disconnected);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    /// A gathering thread whose wait the test ends: each wait says on `waiting` that it has begun,
    /// and lasts until the test sends on `end`. Its calls arrive on `calls`.
    struct Gathering {
        report: Sender<()>,
        waiting: Receiver<()>,
        end: Sender<()>,
        calls: Receiver<()>,
    }

    fn gathering(stopped: &Arc<AtomicBool>) -> Gathering {
        let (began, waiting) = mpsc::channel();
        let (end, ends) = mpsc::channel::<()>();
        let (call, calls) = mpsc::channel();
        let wait = move || {
            let _ = began.send(());
            let _ = ends.recv();
        };
        let report = gather(wait, Arc::clone(stopped), move || {
            let _ = call.send(());
        })
        .unwrap();
        Gathering {
            report,
            waiting,
            end,
            calls,
        }
    }

    /// Long enough for any thread, on any machine, to get to what it was told to do.
    const AT_ALL: Duration = Duration::from_secs(10);

    #[test]
    fn the_events_of_a_change_are_reported_once_and_the_next_change_again() {
        let stopped = Arc::new(AtomicBool::new(false));
        let gathering = gathering(&stopped);
        // The first event of a change; the rest come while the thread waits for them.
        gathering.report.send(()).unwrap();
        gathering.waiting.recv_timeout(AT_ALL).unwrap();
        for _ in 0..4 {
            gathering.report.send(()).unwrap();
        }
        gathering.end.send(()).unwrap();
        gathering.calls.recv_timeout(AT_ALL).unwrap();
        // The next change.
        gathering.report.send(()).unwrap();
        gathering.waiting.recv_timeout(AT_ALL).unwrap();
        gathering.end.send(()).unwrap();
        gathering.calls.recv_timeout(AT_ALL).unwrap();
        // Nothing more: with every sender gone, the thread ends, and any call it had left to make
        // arrives before the end does.
        let Gathering {
            report, end, calls, ..
        } = gathering;
        drop((report, end));
        assert_eq!(
            calls.recv_timeout(AT_ALL),
            Err(mpsc::RecvTimeoutError::Disconnected)
        );
    }

    #[test]
    fn a_change_being_gathered_when_the_watch_stops_is_not_reported() {
        let stopped = Arc::new(AtomicBool::new(false));
        let gathering = gathering(&stopped);
        gathering.report.send(()).unwrap();
        gathering.waiting.recv_timeout(AT_ALL).unwrap();
        // As dropping the watch does, while the thread waits for the rest of the change.
        stopped.store(true, Ordering::SeqCst);
        gathering.end.send(()).unwrap();
        assert_eq!(
            gathering.calls.recv_timeout(AT_ALL),
            Err(mpsc::RecvTimeoutError::Disconnected)
        );
    }

    #[test]
    fn watches_a_document_in_a_hidden_folder_the_same_way() {
        // Such as a plan of Claude Code's, ~/.claude/plans/x.md.
        let folder = folder("hidden");
        let plans = folder.join(".claude/plans");
        std::fs::create_dir_all(&plans).unwrap();
        let plan = plans.join("x.md");
        std::fs::write(&plan, "One\n").unwrap();
        let (watch, reports) = watch(&plan);
        assert_eq!(watch.watching(), [plans.as_path()]);
        for round in 0..3 {
            replace(&plan, &format!("Round {round}\n"));
            assert!(reported(&reports), "round {round}");
            settle(&reports);
        }
        drop(watch);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn watches_a_link_and_the_file_it_names_in_another_folder() {
        use std::os::unix::fs::symlink;

        let folder = folder("link-elsewhere");
        let (notes, work) = (folder.join("notes"), folder.join("work"));
        std::fs::create_dir_all(&notes).unwrap();
        std::fs::create_dir_all(&work).unwrap();
        std::fs::write(work.join("plan.md"), "One\n").unwrap();
        std::fs::write(notes.join("other.md"), "One\n").unwrap();
        // A relative link, as `ln -s` makes it.
        symlink("../work/plan.md", notes.join("plan.md")).unwrap();
        let (watch, reports) = watch(&notes.join("plan.md"));
        assert_eq!(watch.watching(), [notes.as_path(), work.as_path()]);

        // The command line writes the file the link names, which the link's folder doesn't see.
        for round in 0..3 {
            replace(&work.join("plan.md"), &format!("Round {round}\n"));
            assert!(reported(&reports), "round {round}");
            settle(&reports);
        }
        // The other files of either folder are no business of the document's.
        std::fs::write(notes.join("other.md"), "Two\n").unwrap();
        std::fs::write(work.join("other.md"), "One\n").unwrap();
        assert!(quiet(&reports));
        // The link itself, replaced by one to another file. The window hears of it, and reads the
        // other file through the link; that file's own changes it hears of only once it watches
        // again (a known limit, as with the page's watch before).
        std::fs::write(work.join("next.md"), "Next\n").unwrap();
        symlink("../work/next.md", notes.join(".plan.md.tmp")).unwrap();
        std::fs::rename(notes.join(".plan.md.tmp"), notes.join("plan.md")).unwrap();
        assert!(reported(&reports));
        drop(watch);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn watches_a_link_to_a_file_of_another_name_in_the_same_folder() {
        use std::os::unix::fs::symlink;

        let folder = folder("link-here");
        std::fs::write(folder.join("real-2026.md"), "One\n").unwrap();
        std::fs::write(folder.join("other.md"), "One\n").unwrap();
        symlink("real-2026.md", folder.join("plan.md")).unwrap();
        let (watch, reports) = watch(&folder.join("plan.md"));
        // One folder, watched once, for both names.
        assert_eq!(watch.watching(), [folder.as_path()]);

        replace(&folder.join("real-2026.md"), "Two\n");
        assert!(reported(&reports));
        settle(&reports);
        std::fs::write(folder.join("other.md"), "Two\n").unwrap();
        assert!(quiet(&reports));
        drop(watch);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn watches_a_folder_reached_through_a_link_as_the_folder_it_is() {
        let folder = folder("folder-link");
        let plan = folder.join("plan.md");
        std::fs::write(&plan, "One\n").unwrap();
        // The temporary folder by the path the system gives, through /var on macOS, which is a
        // link to /private/var.
        let named = std::env::temp_dir().join(folder.file_name().unwrap());
        let (watch, reports) = watch(&named.join("plan.md"));
        assert_eq!(watch.watching(), [folder.as_path()]);
        replace(&plan, "Two\n");
        assert!(reported(&reports));
        drop(watch);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn watches_a_document_by_the_name_the_disk_keeps_whatever_the_window_calls_it() {
        // macOS finds a file by its name in any case and Unicode form, but reports the name it
        // keeps: the case it was made with, and accents decomposed.
        let folder = folder("spelling");
        let kept = ["Plan.md", "cafe\u{301}.md"];
        let called = ["plan.md", "caf\u{e9}.md"];
        for (kept, called) in kept.into_iter().zip(called) {
            std::fs::write(folder.join(kept), "One\n").unwrap();
            if !folder.join(called).exists() {
                // A disk that tells them apart, which the person has to ask for.
                continue;
            }
            let (watch, reports) = watch(&folder.join(called));
            replace(&folder.join(kept), "Two\n");
            assert!(reported(&reports), "{kept}");
            drop(watch);
        }
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reports_a_document_written_under_another_spelling_of_its_name_every_time() {
        // A writer that doesn't ask the disk for the name renames its file over the name as it was
        // given it, which macOS then reports: accents composed for a name kept decomposed, as
        // Finder makes them, and the other way round, or in another case.
        let spellings = [
            ("cafe\u{301}.md", "caf\u{e9}.md"),
            ("caf\u{e9}.md", "cafe\u{301}.md"),
            ("plan.md", "PLAN.md"),
        ];
        for (kept, written) in spellings {
            let folder = folder("written");
            std::fs::write(folder.join(kept), "One\n").unwrap();
            if !folder.join(written).exists() {
                // A disk that tells them apart, which the person has to ask for.
                continue;
            }
            let (watch, reports) = watch(&folder.join(kept));
            for round in 0..3 {
                replace(&folder.join(written), &format!("Round {round}\n"));
                assert!(reported(&reports), "{written} for {kept}, round {round}");
                settle(&reports);
            }
            drop(watch);
            std::fs::remove_dir_all(&folder).unwrap();
        }
    }

    #[test]
    fn cannot_watch_a_document_whose_folder_is_gone() {
        let folder = folder("gone");
        let plan = folder.join("plan.md");
        std::fs::remove_dir_all(&folder).unwrap();
        // The window says it can't watch the file, as it did before.
        assert!(Watch::start(&plan, DELAY, || {}).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn watches_the_file_itself_when_its_folder_cannot_be_listed() {
        use std::os::unix::fs::PermissionsExt;

        // Permissions don't hold back the superuser.
        // SAFETY: geteuid has no preconditions and can't fail.
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let folder = folder("unlisted");
        let shut = folder.join("shut");
        std::fs::create_dir_all(&shut).unwrap();
        let plan = shut.join("plan.md");
        std::fs::write(&plan, "One\n").unwrap();
        // The file can be reached and written, but the folder not listed, which inotify needs.
        std::fs::set_permissions(&shut, std::fs::Permissions::from_mode(0o300)).unwrap();
        let (watch, reports) = watch(&plan);
        assert_eq!(watch.watching(), [plan.as_path()]);
        std::fs::write(&plan, "Two\n").unwrap();
        assert!(reported(&reports));
        drop(watch);
        std::fs::set_permissions(&shut, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn picks_the_document_out_of_the_folder_by_its_names() {
        use notify::event::{
            AccessKind, CreateKind, DataChange, ModifyKind, RemoveKind, RenameMode,
        };

        let names = [OsString::from("plan.md"), OsString::from("real-2026.md")];
        let event = |kind: EventKind, paths: &[&str]| {
            paths.iter().fold(Event::new(kind), |event, path| {
                event.add_path(PathBuf::from(path))
            })
        };
        let modified = EventKind::Modify(ModifyKind::Data(DataChange::Content));
        let renamed = EventKind::Modify(ModifyKind::Name(RenameMode::Both));
        let about = |kind, paths: &[&str]| is_about(&event(kind, paths), &names);

        assert!(about(modified, &["/docs/plan.md"]));
        assert!(about(modified, &["/docs/real-2026.md"]));
        assert!(about(
            EventKind::Create(CreateKind::File),
            &["/docs/plan.md"]
        ));
        assert!(about(
            EventKind::Remove(RemoveKind::File),
            &["/docs/plan.md"]
        ));
        // A temporary file renamed over it, as the command line writes.
        assert!(about(
            renamed,
            &["/docs/.plan.md.1a2b3c4d.tmp", "/docs/plan.md"]
        ));
        // Renamed away: the file is gone.
        assert!(about(renamed, &["/docs/plan.md", "/docs/old.md"]));
        for other in [
            "/docs/other.md",
            "/docs/.plan.md.1a2b3c4d.tmp",
            "/docs/plan.md.bak",
            "/docs/old-plan.md",
            "/docs/.DS_Store",
        ] {
            assert!(!about(modified, &[other]), "{other}");
            assert!(!about(renamed, &[other]), "{other}");
        }
        // Reads, which reloading would only make again.
        assert!(!about(
            EventKind::Access(AccessKind::Read),
            &["/docs/plan.md"]
        ));
        assert!(!about(EventKind::Access(AccessKind::Any), &[]));
        // Events were lost, so the file may have changed.
        assert!(about(EventKind::Other, &[]));
        assert!(about(EventKind::Any, &[]));
        assert!(is_about(
            &event(EventKind::Other, &["/docs"]).set_flag(notify::event::Flag::Rescan),
            &names
        ));
    }

    #[test]
    fn a_name_in_another_case_is_the_same_name() {
        let same = |name: &str, wanted: &str| same_name(OsStr::new(name), OsStr::new(wanted));
        assert!(same("plan.md", "plan.md"));
        assert!(same("Plan.MD", "plan.md"));
        assert!(!same("plan.md.bak", "plan.md"));
    }

    #[test]
    fn a_name_in_another_unicode_form_is_the_same_name() {
        // Accents composed or decomposed, both ways, and in another case as well.
        let same = |name: &str, wanted: &str| same_name(OsStr::new(name), OsStr::new(wanted));
        assert!(same("cafe\u{301}.md", "caf\u{e9}.md"));
        assert!(same("caf\u{e9}.md", "cafe\u{301}.md"));
        assert!(same("CAFE\u{301}.md", "caf\u{e9}.md"));
        assert!(!same("cafe.md", "caf\u{e9}.md"));
        assert!(!same("plan", "plan.md"));
    }

    #[cfg(unix)]
    #[test]
    fn finds_the_places_to_watch_by_the_path_and_the_file_it_really_is() {
        use std::os::unix::fs::symlink;

        let folder = folder("places");
        let (notes, work) = (folder.join("notes"), folder.join("work"));
        std::fs::create_dir_all(&notes).unwrap();
        std::fs::create_dir_all(&work).unwrap();
        std::fs::write(work.join("plan.md"), "").unwrap();
        symlink(work.join("plan.md"), notes.join("plan.md")).unwrap();
        symlink("plan.md", work.join("alias.md")).unwrap();
        let names = |names: &[&str]| names.iter().map(OsString::from).collect::<Vec<_>>();

        assert_eq!(
            places(&work.join("plan.md")),
            [(work.clone(), names(&["plan.md"]))]
        );
        assert_eq!(
            places(&notes.join("plan.md")),
            [
                (notes.clone(), names(&["plan.md"])),
                (work.clone(), names(&["plan.md"]))
            ]
        );
        assert_eq!(
            places(&work.join("alias.md")),
            [(work.clone(), names(&["alias.md", "plan.md"]))]
        );
        // A file that isn't there yet is watched by its path, for when it comes.
        assert_eq!(
            places(&work.join("new.md")),
            [(work.clone(), names(&["new.md"]))]
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }

    /// The file system plugin's own scope, as the app starts with it: empty.
    fn scope() -> tauri::fs::Scope {
        let app = tauri::test::mock_app();
        tauri::fs::Scope::new(
            &app,
            &tauri::utils::config::FsScope::AllowedPaths(Vec::new()),
        )
        .unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn a_window_has_only_a_file_it_may_use_watched() {
        use std::os::unix::fs::symlink;

        let folder = folder("check");
        let (plan, other) = (folder.join("plan.md"), folder.join("other.md"));
        std::fs::write(&plan, "").unwrap();
        std::fs::write(&other, "").unwrap();
        symlink(&plan, folder.join("link.md")).unwrap();
        let scope = scope();
        // Nothing yet: the window was given no file.
        assert!(check(true, &scope, &plan).is_err());
        scope.allow_file(&plan).unwrap();
        assert!(check(true, &scope, &plan).is_ok());
        // A link to it, which leads to the same file.
        assert!(check(true, &scope, &folder.join("link.md")).is_ok());
        // Not the other files of its folder, nor the folder.
        assert!(check(true, &scope, &other).is_err());
        assert!(check(true, &scope, &folder).is_err());
        // Not by a path the app can't place.
        assert!(check(true, &scope, Path::new("plan.md")).is_err());
        // Not for a window that holds no document, such as Preferences.
        assert!(check(false, &scope, &plan).is_err());
        std::fs::remove_dir_all(&folder).unwrap();
    }

    /// Whether the watch whose flag this is has stopped.
    fn has_stopped(stopped: &AtomicBool) -> bool {
        stopped.load(Ordering::SeqCst)
    }

    #[test]
    fn a_window_stops_only_its_own_watches_and_all_of_them_when_it_closes() {
        let watches = Watches::default();
        let (first, first_stopped) = Watch::idle();
        let (second, second_stopped) = Watch::idle();
        let (theirs, theirs_stopped) = Watch::idle();
        let first = watches.add("doc-1", 0, first).unwrap();
        watches.add("doc-1", 0, second).unwrap();
        let theirs = watches.add("doc-2", 0, theirs).unwrap();
        // Another window's watch is not this window's to stop.
        assert!(!watches.stop("doc-1", theirs));
        assert!(!has_stopped(&theirs_stopped));
        assert!(watches.stop("doc-1", first));
        assert!(has_stopped(&first_stopped));
        assert!(!watches.stop("doc-1", first));
        assert!(!has_stopped(&second_stopped));
        watches.closed("doc-1");
        assert!(has_stopped(&second_stopped));
        assert!(!has_stopped(&theirs_stopped));
        assert_eq!(
            watches.lock().open.keys().copied().collect::<Vec<_>>(),
            [theirs]
        );
    }

    #[test]
    fn a_window_has_no_more_than_so_many_watches() {
        let watches = Watches::default();
        let mut mine = Vec::new();
        for _ in 0..MOST_PER_WINDOW {
            let (watch, _) = Watch::idle();
            mine.push(watches.add("doc-1", 0, watch).unwrap());
        }
        let (one_more, stopped) = Watch::idle();
        assert!(watches.add("doc-1", 0, one_more).is_err());
        assert!(has_stopped(&stopped));
        // Each window has its own.
        let (theirs, _) = Watch::idle();
        assert!(watches.add("doc-2", 0, theirs).is_ok());
        // One stopped makes room for another.
        assert!(watches.stop("doc-1", mine[0]));
        let (another, _) = Watch::idle();
        assert!(watches.add("doc-1", 0, another).is_ok());
    }

    #[test]
    fn a_watch_a_closed_window_asked_for_is_stopped_once_it_has_started() {
        // The window closed while its watch was starting: nothing would ever stop it.
        let watches = Watches::default();
        let page = watches.page("doc-1");
        watches.closed("doc-1");
        let (watch, stopped) = Watch::idle();
        assert!(watches.add("doc-1", page, watch).is_err());
        assert!(has_stopped(&stopped));
        assert!(watches.lock().open.is_empty());
    }

    #[test]
    fn a_page_that_loads_again_stops_the_watches_of_the_page_before() {
        let watches = Watches::default();
        let before = watches.page("doc-1");
        let (old, old_stopped) = Watch::idle();
        let (theirs, theirs_stopped) = Watch::idle();
        watches.add("doc-1", before, old).unwrap();
        watches.add("doc-2", watches.page("doc-2"), theirs).unwrap();
        watches.page_loaded("doc-1");
        assert!(has_stopped(&old_stopped));
        // Another window's page is another page.
        assert!(!has_stopped(&theirs_stopped));
        // The page before asked for one more, which started only after the reload.
        let (late, late_stopped) = Watch::idle();
        assert!(watches.add("doc-1", before, late).is_err());
        assert!(has_stopped(&late_stopped));
        // The new page's own.
        let (new, new_stopped) = Watch::idle();
        let now = watches.page("doc-1");
        assert_ne!(now, before);
        watches.add("doc-1", now, new).unwrap();
        assert!(!has_stopped(&new_stopped));
        assert_eq!(watches.lock().open.len(), 2);
    }

    #[test]
    fn only_document_windows_are_document_windows() {
        let windows = Windows::with_document("doc-1", "/docs/plan.md");
        assert!(windows.is_document_window("doc-1"));
        assert!(!windows.is_document_window("preferences"));
        assert!(!windows.is_document_window("install"));
    }
}
