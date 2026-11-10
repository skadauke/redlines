//! One document per window (design §5.1, #14). The first window is `main`; the others are
//! `doc-<n>`, made from `main`'s entry in `tauri.conf.json`. Each window has its own page, so what
//! they share is kept here: which windows there are, the frontmost first, and what each holds, as
//! each says (`window_document`).
//!
//! Files the system hands to the app go to one window: the frontmost when it is empty and clean,
//! and otherwise a new one of their own. Files dropped on a window go the same way, with that
//! window in front.
//!
//! Quitting asks about unsaved edits, window by window. The windows do the asking among themselves
//! (`src/windows.ts`), and end by calling `quit_all` or `keep_running`. The menu starts them
//! itself. The Dock and a logout go straight to AppKit's `terminate:`, of which Tauri hears nothing
//! until the app is already going (no `RunEvent::ExitRequested`, only `RunEvent::Exit`), so `macos`
//! below stops that and starts them, and answers once every window has answered.

use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent,
    utils::config::WindowConfig,
};

use crate::{Opened, OpenedFile};

/// The label of the window that opens with the app, whose entry in `tauri.conf.json` every
/// document window is made from.
pub(crate) const MAIN_WINDOW: &str = "main";

/// The label of the Preferences window, which holds no document.
pub(crate) const PREFERENCES_WINDOW: &str = "preferences";

/// How the labels of the document windows opened after the main one begin: `doc-1`, `doc-2` and
/// on (`Registry::next_label`).
const DOCUMENT_LABEL: &str = "doc-";

/// Whether `label` is a document window: the main one, or one opened after it. Preferences and the
/// install question are not.
pub(crate) fn is_document_window(label: &str) -> bool {
    label == MAIN_WINDOW || label.starts_with(DOCUMENT_LABEL)
}

/// How far down and right of the window in front a new one opens.
const CASCADE_STEP: f64 = 26.0;

/// What a window was opened for: a file, and a line in it. The window reads the fields by name.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct WindowStart {
    path: Option<String>,
    line: Option<u32>,
}

/// A window, as the others ask about it. The window reads the fields by name.
#[derive(Debug, PartialEq, Serialize)]
pub struct DocumentWindow {
    label: String,
    path: Option<String>,
    dirty: bool,
}

/// One open window.
#[derive(Debug)]
struct Entry {
    label: String,
    start: WindowStart,
    /// The document's file, as the window last said, or the file it has just been given.
    path: Option<String>,
    /// Whether the document has unsaved edits, as the window last said.
    dirty: bool,
    /// The files given to this window that it hasn't taken yet.
    files: Vec<OpenedFile>,
}

impl Entry {
    /// An Untitled document with nothing in it, which a file may take the place of.
    fn untouched(&self) -> bool {
        self.path.is_none() && !self.dirty
    }
}

/// What to do about files that `Registry::route` has given out.
#[derive(Debug, Default)]
pub struct Routed {
    /// The windows that now have files to take.
    to_tell: Vec<String>,
    /// The files that open in a window of their own.
    to_open: Vec<String>,
}

/// The document windows, and what the app knows of them.
#[derive(Debug, Default)]
pub struct Registry {
    /// The number of the last `doc-<n>` label given.
    last_label: u32,
    /// The open windows, the one that last had the focus first.
    entries: Vec<Entry>,
    /// The window asking the others while macOS waits to hear whether the app may terminate.
    asking: Option<String>,
}

impl Registry {
    /// A label for a new window. None comes twice: a window that has just closed may not be gone
    /// yet, and a new window can't have its label.
    pub(crate) fn next_label(&mut self) -> String {
        self.last_label += 1;
        format!("{DOCUMENT_LABEL}{}", self.last_label)
    }

    /// Adds a window as the frontmost, which a new window is about to be.
    fn add(&mut self, label: &str, start: WindowStart) {
        self.entries.insert(
            0,
            Entry {
                label: label.to_owned(),
                path: start.path.clone(),
                start,
                dirty: false,
                files: Vec::new(),
            },
        );
    }

    /// Takes a window away. Says whether it was the one asking the others, which leaves macOS
    /// without an answer.
    fn remove(&mut self, label: &str) -> bool {
        self.entries.retain(|entry| entry.label != label);
        let was_asking = self.asking.as_deref() == Some(label);
        if was_asking {
            self.asking = None;
        }
        was_asking
    }

    /// Notes that a window has the focus. The window keeps its place when another app takes the
    /// focus, so the frontmost window is still known when a file comes in from Finder.
    fn focus(&mut self, label: &str) {
        if let Some(place) = self.entries.iter().position(|entry| entry.label == label) {
            let entry = self.entries.remove(place);
            self.entries.insert(0, entry);
        }
    }

    fn frontmost(&self) -> Option<String> {
        self.entries.first().map(|entry| entry.label.clone())
    }

    fn entry_mut(&mut self, label: &str) -> Option<&mut Entry> {
        self.entries.iter_mut().find(|entry| entry.label == label)
    }

    /// Notes what a window holds.
    fn report(&mut self, label: &str, path: Option<String>, dirty: bool) {
        if let Some(entry) = self.entry_mut(label) {
            entry.path = path;
            entry.dirty = dirty;
        }
    }

    /// Whether the window's document is the file at `path`, as the window last said.
    fn holds(&self, label: &str, path: &str) -> bool {
        self.entries
            .iter()
            .any(|entry| entry.label == label && entry.path.as_deref() == Some(path))
    }

    /// Gives a window's document another file, as the window will say itself a moment later: a
    /// second rename must not find the first one's old path held.
    fn set_path(&mut self, label: &str, path: String) {
        if let Some(entry) = self.entry_mut(label) {
            entry.path = Some(path);
        }
    }

    /// What a window was opened for.
    fn start(&self, label: &str) -> WindowStart {
        self.entries
            .iter()
            .find(|entry| entry.label == label)
            .map(|entry| entry.start.clone())
            .unwrap_or_default()
    }

    /// The windows, the frontmost first.
    fn list(&self) -> Vec<DocumentWindow> {
        self.entries
            .iter()
            .map(|entry| DocumentWindow {
                label: entry.label.clone(),
                path: entry.path.clone(),
                dirty: entry.dirty,
            })
            .collect()
    }

    /// Gives out files, when there is a window to give them to: the frontmost window takes the
    /// first it can, if it is untouched, and each of the others opens a window of its own. A file
    /// the window may not use opens nothing: the frontmost window tells the person.
    fn route(&mut self, files: Vec<OpenedFile>) -> Routed {
        let mut routed = Routed::default();
        let Some(front) = self.entries.first_mut() else {
            return routed;
        };
        for file in files {
            if file.error.is_none() {
                if !front.untouched() {
                    routed.to_open.push(file.path);
                    continue;
                }
                // Until the window says otherwise, so that the next file doesn't take its place.
                front.path = Some(file.path.clone());
            }
            front.files.push(file);
            if routed.to_tell.is_empty() {
                routed.to_tell.push(front.label.clone());
            }
        }
        routed
    }

    /// The files given to a window since it last asked, oldest first.
    fn take_files(&mut self, label: &str) -> Vec<OpenedFile> {
        self.entry_mut(label)
            .map(|entry| std::mem::take(&mut entry.files))
            .unwrap_or_default()
    }

    /// macOS asks whether the app may terminate. The window that is to ask the others, if there are
    /// unsaved edits to ask about. It is one with edits, so its page is sure to be listening.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn begin_terminating(&mut self) -> Option<String> {
        let asking = self
            .entries
            .iter()
            .find(|entry| entry.dirty)
            .map(|entry| entry.label.clone());
        self.asking.clone_from(&asking);
        asking
    }

    /// The windows have answered. Says whether macOS is waiting to hear the outcome.
    fn finish_asking(&mut self) -> bool {
        self.asking.take().is_some()
    }
}

/// The app's `Registry`.
#[derive(Default)]
pub struct Windows(Mutex<Registry>);

impl Windows {
    /// Never held while a window is made or told something, which can wait on the main thread.
    fn lock(&self) -> MutexGuard<'_, Registry> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Whether the document of the window `label` is the file at `path`, as that window said.
    pub fn holds(&self, label: &str, path: &str) -> bool {
        self.lock().holds(label, path)
    }

    /// `dropped`, the paths of a drop that are there, landed on the window `label`: they go to it
    /// as they go to the window in front (`Registry::route`), which it now is. Says whether they
    /// are to be offered: not when there are none, nor when it isn't a document window, and then
    /// no window moves.
    pub fn dropped_on(&self, label: &str, dropped: &[std::path::PathBuf]) -> bool {
        if dropped.is_empty() {
            return false;
        }
        let mut registry = self.lock();
        let known = registry.entries.iter().any(|entry| entry.label == label);
        if known {
            registry.focus(label);
        }
        known
    }

    /// The windows' documents, as each last said or was opened for.
    pub fn documents(&self) -> Vec<String> {
        self.lock()
            .entries
            .iter()
            .filter_map(|entry| entry.path.clone())
            .collect()
    }

    /// A registry with one window holding `path`, for other modules' tests.
    #[cfg(test)]
    pub fn with_document(label: &str, path: &str) -> Self {
        let windows = Self::default();
        windows.lock().add(label, WindowStart::default());
        windows.lock().report(label, Some(path.to_owned()), false);
        windows
    }

    /// Notes that the window's document was renamed to `path`.
    pub fn renamed(&self, label: &str, path: &str) {
        self.lock().set_path(label, path.to_owned());
    }
}

/// A rectangle on the screens, in logical pixels.
#[derive(Debug, PartialEq)]
struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Where a window of `size` opens, given where the window in front of it is: a step down and right,
/// or back at the screen's corner when that would run off the screen.
fn cascaded(from: (f64, f64), size: (f64, f64), screen: Option<&Area>) -> (f64, f64) {
    let (x, y) = (from.0 + CASCADE_STEP, from.1 + CASCADE_STEP);
    match screen {
        Some(screen)
            if x + size.0 > screen.x + screen.width || y + size.1 > screen.y + screen.height =>
        {
            (screen.x, screen.y)
        }
        _ => (x, y),
    }
}

/// Where a new window opens, given the window in front of it. Nothing when that can't be told.
fn cascade_from(window: &WebviewWindow, config: &WindowConfig) -> Option<(f64, f64)> {
    let scale = window.scale_factor().ok()?;
    let from: LogicalPosition<f64> = window.outer_position().ok()?.to_logical(scale);
    let screen = window.current_monitor().ok().flatten().map(|monitor| {
        let area = monitor.work_area();
        let (position, size) = (
            area.position.to_logical::<f64>(scale),
            area.size.to_logical::<f64>(scale),
        );
        Area {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }
    });
    Some(cascaded(
        (from.x, from.y),
        (config.width, config.height),
        screen.as_ref(),
    ))
}

fn main_config(app: &AppHandle) -> tauri::Result<&WindowConfig> {
    app.config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .ok_or(tauri::Error::WindowNotFound)
}

/// Opens a window from `config`, which the app knows of before its page can ask anything.
fn build_window(
    app: &AppHandle,
    config: &WindowConfig,
    start: WindowStart,
    position: Option<(f64, f64)>,
) -> tauri::Result<WebviewWindow> {
    let windows = app.state::<Windows>();
    windows.lock().add(&config.label, start);
    let built = WebviewWindowBuilder::from_config(app, config).and_then(|builder| {
        match position {
            Some((x, y)) => builder.position(x, y),
            None => builder,
        }
        // The page starts at the app's zoom, which is set on the window right after it is built.
        .initialization_script(crate::zoom::init_script(app))
        .build()
    });
    match &built {
        Ok(window) => crate::zoom::apply(window),
        Err(_) => {
            windows.lock().remove(&config.label);
        }
    }
    built
}

/// Opens the main window as `tauri.conf.json` describes it, and hands it the files that have been
/// waiting for a window. The app opens it itself, rather than Tauri at startup, so that on a Mac it
/// can first offer to install itself from a disk image.
pub fn open_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = build_window(app, main_config(app)?, WindowStart::default(), None)?;
    deliver(app);
    Ok(window)
}

/// Opens a new document window, a step down and right of the one in front.
fn open_document_window(app: &AppHandle, start: WindowStart) -> tauri::Result<WebviewWindow> {
    let windows = app.state::<Windows>();
    let (label, in_front) = {
        let mut registry = windows.lock();
        (registry.next_label(), registry.frontmost())
    };
    let config = WindowConfig {
        label,
        ..main_config(app)?.clone()
    };
    let position = in_front
        .and_then(|label| app.get_webview_window(&label))
        .and_then(|window| cascade_from(&window, &config));
    build_window(app, &config, start, position)
}

/// Gives the files the app has been handed to the windows, once there is a window. Until then they
/// wait: the main window takes them when it opens, and if the app installs itself from a disk image
/// instead, the installed copy does.
pub fn deliver(app: &AppHandle) {
    let windows = app.state::<Windows>();
    let routed = {
        let mut registry = windows.lock();
        if registry.frontmost().is_none() {
            return;
        }
        let opened = app.state::<Opened>();
        let mut waiting = opened
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        registry.route(std::mem::take(&mut *waiting))
    };
    for label in routed.to_tell {
        tell_of_files(app, &label);
    }
    for path in routed.to_open {
        let start = WindowStart {
            path: Some(path.clone()),
            line: None,
        };
        if let Err(error) = open_document_window(app, start) {
            // The file isn't dropped: the frontmost window says so, in one line.
            eprintln!("Redlines can't open another window: {error}");
            let refused = OpenedFile {
                path,
                error: Some(error.to_string()),
            };
            let routed = windows.lock().route(vec![refused]);
            for label in routed.to_tell {
                tell_of_files(app, &label);
            }
        }
    }
}

/// Brings a window forward, minimized or not, and tells it it has files to take. The window asks
/// for its files when it starts, so an event it misses loses nothing. The event goes to this window
/// alone: the others have nothing to open.
fn tell_of_files(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        // Focus does nothing for a minimized window.
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit_to(label, "opened", ());
}

/// The files given to this window since it last asked, oldest first, each with the reason the
/// window may not use it, if there is one.
#[tauri::command]
pub fn opened_files(window: WebviewWindow, windows: tauri::State<'_, Windows>) -> Vec<OpenedFile> {
    windows.lock().take_files(window.label())
}

/// Opens a new window, for a file and a line in it if it is given them, and says its label. It lets
/// the window use nothing new: a file it may not use says so in the window, as any other does.
#[tauri::command(async)]
pub fn open_window(
    app: AppHandle,
    path: Option<String>,
    line: Option<u32>,
) -> Result<String, String> {
    open_document_window(&app, WindowStart { path, line })
        .map(|window| window.label().to_owned())
        .map_err(|error| format!("Can't open another window: {error}"))
}

/// What this window was opened for.
#[tauri::command]
pub fn window_start(window: WebviewWindow, windows: tauri::State<'_, Windows>) -> WindowStart {
    windows.lock().start(window.label())
}

/// This window says what it holds: its document's file, and whether it has unsaved edits. A file
/// the window may use is its document, and the app remembers it for the next launch
/// (`file_scope::held`); any other is no document of the window's.
#[tauri::command]
pub fn window_document(
    window: WebviewWindow,
    windows: tauri::State<'_, Windows>,
    path: Option<String>,
    dirty: bool,
) {
    let app = window.app_handle();
    report_held(&windows, window.label(), path, dirty, |path| {
        crate::file_scope::held(app, path)
    });
}

/// Notes what a window says it holds: the file as its document only when `held` says the window
/// may hold it. The page names the file, and the app believes it only for a file the window was
/// given.
fn report_held(
    windows: &Windows,
    label: &str,
    path: Option<String>,
    dirty: bool,
    held: impl FnOnce(&str) -> bool,
) {
    let path = path.filter(|path| held(path));
    windows.lock().report(label, path, dirty);
}

/// The windows, the frontmost first.
#[tauri::command]
pub fn document_windows(windows: tauri::State<'_, Windows>) -> Vec<DocumentWindow> {
    windows.lock().list()
}

/// Every window has answered, and none said Cancel: the app quits. When macOS is waiting to hear,
/// by telling it; the app is then terminated as it would be from the Dock.
#[tauri::command]
pub fn quit_all(app: AppHandle) {
    if app.state::<Windows>().lock().finish_asking() {
        #[cfg(target_os = "macos")]
        macos::answer(true);
    } else {
        app.exit(0);
    }
}

/// A window said Cancel, or couldn't ask: the app keeps running, and macOS, if it asked, hears so.
#[tauri::command]
pub fn keep_running(windows: tauri::State<'_, Windows>) {
    if windows.lock().finish_asking() {
        #[cfg(target_os = "macos")]
        macos::answer(false);
    }
}

/// Keeps up with the windows: which has the focus, and which are gone. A closed window leaves the
/// menu bar showing its own menu, whose items can no longer do anything, and if no window takes the
/// focus next, as when the others are minimized, none would take the menu bar back.
pub fn on_window_event(app: &AppHandle, label: &str, event: &WindowEvent) {
    let windows = app.state::<Windows>();
    match event {
        WindowEvent::Focused(true) => windows.lock().focus(label),
        WindowEvent::Destroyed => {
            let (was_asking, front) = {
                let mut registry = windows.lock();
                (registry.remove(label), registry.frontmost())
            };
            // Its own close question ended it, with the quit still on.
            if was_asking {
                #[cfg(target_os = "macos")]
                macos::go_on_terminating(app);
            }
            match front {
                Some(front) => {
                    let _ = app.emit_to(front.as_str(), "frontmost", ());
                }
                // The last document window has closed, which quits, as long as Preferences don't
                // stay behind it with a menu bar that can do nothing.
                None if label != PREFERENCES_WINDOW => {
                    if let Some(preferences) = app.get_webview_window(PREFERENCES_WINDOW) {
                        let _ = preferences.close();
                    }
                }
                None => {}
            }
        }
        _ => {}
    }
}

#[cfg(target_os = "macos")]
pub mod macos {
    //! Answering AppKit's question whether the app may terminate. It is asked of the app's delegate,
    //! which is Tauri's window library's, and which doesn't answer: the Dock's Quit and a logout then
    //! end the app with no chance to save.

    use std::sync::OnceLock;

    use dispatch2::DispatchQueue;
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{MainThreadMarker, sel};
    use objc2_app_kit::{NSApplication, NSApplicationTerminateReply};
    use tauri::{AppHandle, Emitter, Manager};

    use super::Windows;

    /// The app, for AppKit's question, which comes with nothing else.
    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// AppKit's `applicationShouldTerminate:`.
    extern "C-unwind" fn should_terminate(
        _delegate: &AnyObject,
        _selector: Sel,
        _application: &AnyObject,
    ) -> NSApplicationTerminateReply {
        match APP.get() {
            Some(app) => ask_windows(app),
            None => NSApplicationTerminateReply::TerminateNow,
        }
    }

    /// The window that was asking the others has closed: the next with unsaved edits asks in its
    /// place, and with none left, the app may go.
    pub fn go_on_terminating(app: &AppHandle) {
        match ask_windows(app) {
            NSApplicationTerminateReply::TerminateLater => {}
            reply => answer(reply == NSApplicationTerminateReply::TerminateNow),
        }
    }

    /// Without unsaved edits, the app may go. With them, the answer comes later: AppKit keeps the app
    /// running, and sheets working, until then.
    fn ask_windows(app: &AppHandle) -> NSApplicationTerminateReply {
        let asking = app.state::<Windows>().lock().begin_terminating();
        let Some(asking) = asking else {
            return NSApplicationTerminateReply::TerminateNow;
        };
        if let Err(error) = app.emit_to(asking.as_str(), "quit-requested", ()) {
            // No window can ask, so the edits stay, and the app with them.
            eprintln!("Redlines can't ask about unsaved edits: {error}");
            app.state::<Windows>().lock().finish_asking();
            return NSApplicationTerminateReply::TerminateCancel;
        }
        NSApplicationTerminateReply::TerminateLater
    }

    /// Gives the app's delegate the method AppKit asks. It goes on the delegate's class, the only
    /// way into an object made by the window library, before the first time AppKit could ask. It
    /// replaces any the library has by then, so that a later version adding one of its own can't
    /// make the Dock stop asking.
    pub fn answer_should_terminate(app: &AppHandle) {
        let _ = APP.set(app.clone());
        let delegate = MainThreadMarker::new()
            .and_then(|main| NSApplication::sharedApplication(main).delegate());
        let Some(delegate) = delegate else {
            eprintln!("Redlines has no app delegate, and quitting won't ask about unsaved edits");
            return;
        };
        let delegate: &AnyObject = (*delegate).as_ref();
        let class: *const AnyClass = delegate.class();
        // SAFETY: The function has the signature of `applicationShouldTerminate:`, as the types say
        // (`Q` is the reply, an NSUInteger, then self, the selector and the application), and it
        // lasts as long as the program. This is the main thread, before the app has started.
        unsafe {
            let imp = std::mem::transmute::<
                extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> NSApplicationTerminateReply,
                Imp,
            >(should_terminate);
            objc2::ffi::class_replaceMethod(
                class.cast_mut(),
                sel!(applicationShouldTerminate:),
                imp,
                c"Q@:@".as_ptr(),
            );
        }
    }

    /// Tells AppKit whether the app may terminate. Saying yes runs the delegate's
    /// `applicationWillTerminate:` at once, which the window library's event loop can't take from
    /// inside one of its own callbacks, where `run_on_main_thread` would put it: it would wait for
    /// itself. So it goes through the main queue, whose work runs between callbacks.
    pub fn answer(terminate: bool) {
        DispatchQueue::main().exec_async(move || {
            let main = MainThreadMarker::new().expect("the main queue runs on the main thread");
            NSApplication::sharedApplication(main).replyToApplicationShouldTerminate(terminate);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A registry with these windows, the first the frontmost, all of them empty and clean.
    fn registry_of(labels: &[&str]) -> Registry {
        let mut registry = Registry::default();
        for label in labels.iter().rev() {
            registry.add(label, WindowStart::default());
        }
        registry
    }

    fn allowed(path: &str) -> OpenedFile {
        OpenedFile {
            path: path.to_owned(),
            error: None,
        }
    }

    fn refused(path: &str) -> OpenedFile {
        OpenedFile {
            path: path.to_owned(),
            error: Some("no".to_owned()),
        }
    }

    #[test]
    fn a_window_reporting_a_file_outside_the_scope_holds_no_document() {
        let windows = Windows::with_document("doc-1", "/docs/plan.md");
        // A file the window was never given, which it names to be allowed what it holds.
        report_held(
            &windows,
            "doc-1",
            Some("/Users/ada/.ssh/id_ed25519".to_owned()),
            true,
            |_| false,
        );
        assert_eq!(windows.documents(), Vec::<String>::new());
        assert!(!windows.holds("doc-1", "/Users/ada/.ssh/id_ed25519"));
        // Its edits still count, so that quitting asks about them.
        assert_eq!(windows.lock().begin_terminating().as_deref(), Some("doc-1"));
        report_held(
            &windows,
            "doc-1",
            Some("/docs/plan.md".to_owned()),
            false,
            |path| path == "/docs/plan.md",
        );
        assert_eq!(windows.documents(), ["/docs/plan.md"]);
    }

    #[test]
    fn next_label_counts_up_and_never_gives_a_label_again() {
        let mut registry = Registry::default();
        assert_eq!(registry.next_label(), "doc-1");
        assert_eq!(registry.next_label(), "doc-2");
        registry.add("doc-2", WindowStart::default());
        registry.remove("doc-2");
        // A window that has just closed may still be going, and its label with it.
        assert_eq!(registry.next_label(), "doc-3");
    }

    #[test]
    fn the_labels_the_registry_gives_are_the_ones_the_document_capability_names() {
        // The capability that grants a document window its commands names windows by label
        // (`capabilities/default.json`), and a label it doesn't match gets no command at all. Only
        // the document windows' labels match, and Preferences' and the install question's don't.
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let patterns: Vec<&str> = capability["windows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|pattern| pattern.as_str().unwrap())
            .collect();
        let granted = |label: &str| {
            patterns
                .iter()
                .any(|pattern| match pattern.strip_suffix('*') {
                    Some(prefix) => label.starts_with(prefix),
                    None => label == *pattern,
                })
        };
        let mut registry = Registry::default();
        for _ in 0..3 {
            let label = registry.next_label();
            assert!(granted(&label), "{label}");
        }
        assert!(granted(MAIN_WINDOW));
        let question = crate::install::QUESTION_WINDOW;
        for label in [PREFERENCES_WINDOW, question, "", "doc", "doc1", "main-2"] {
            assert!(!granted(label), "{label}");
        }
    }

    #[test]
    fn a_file_goes_to_the_focused_window_when_it_is_empty_and_clean() {
        let mut registry = registry_of(&["main"]);
        let routed = registry.route(vec![allowed("/docs/plan.md")]);
        assert_eq!(routed.to_tell, ["main"]);
        assert!(routed.to_open.is_empty());
        assert_eq!(registry.take_files("main"), [allowed("/docs/plan.md")]);
    }

    #[test]
    fn a_file_opens_a_new_window_when_the_focused_window_holds_a_document() {
        let mut registry = registry_of(&["main"]);
        registry.report("main", Some("/docs/old.md".to_owned()), false);
        let routed = registry.route(vec![allowed("/docs/plan.md")]);
        assert!(routed.to_tell.is_empty());
        assert_eq!(routed.to_open, ["/docs/plan.md"]);
        assert!(registry.take_files("main").is_empty());
    }

    #[test]
    fn a_file_opens_a_new_window_when_the_focused_window_has_unsaved_edits() {
        let mut registry = registry_of(&["main"]);
        registry.report("main", None, true);
        let routed = registry.route(vec![allowed("/docs/plan.md")]);
        assert!(routed.to_tell.is_empty());
        assert_eq!(routed.to_open, ["/docs/plan.md"]);
    }

    #[test]
    fn a_file_is_sent_to_one_window_only_and_never_to_an_empty_one_behind() {
        let mut registry = registry_of(&["main", "doc-1"]);
        registry.report("main", Some("/docs/old.md".to_owned()), false);
        let routed = registry.route(vec![allowed("/docs/plan.md")]);
        assert!(routed.to_tell.is_empty());
        assert_eq!(routed.to_open, ["/docs/plan.md"]);
        assert!(registry.take_files("doc-1").is_empty());
    }

    #[test]
    fn the_focused_window_is_the_one_that_last_had_the_focus() {
        let mut registry = registry_of(&["main", "doc-1"]);
        registry.report("main", Some("/docs/old.md".to_owned()), false);
        registry.focus("doc-1");
        // The app needn't be active: the window keeps its place when another app takes the focus.
        let routed = registry.route(vec![allowed("/docs/plan.md")]);
        assert_eq!(routed.to_tell, ["doc-1"]);
    }

    #[test]
    fn of_several_files_the_first_takes_the_empty_window_and_the_rest_open_their_own() {
        let mut registry = registry_of(&["main"]);
        let routed = registry.route(vec![
            allowed("/docs/a.md"),
            allowed("/docs/b.md"),
            allowed("/docs/c.md"),
        ]);
        assert_eq!(routed.to_tell, ["main"]);
        assert_eq!(routed.to_open, ["/docs/b.md", "/docs/c.md"]);
        assert_eq!(registry.take_files("main"), [allowed("/docs/a.md")]);
    }

    #[test]
    fn a_window_that_was_given_a_file_isnt_given_another_before_it_says_what_it_holds() {
        let mut registry = registry_of(&["main"]);
        registry.route(vec![allowed("/docs/a.md")]);
        // The window hasn't opened the first yet.
        let routed = registry.route(vec![allowed("/docs/b.md")]);
        assert!(routed.to_tell.is_empty());
        assert_eq!(routed.to_open, ["/docs/b.md"]);

        // It couldn't open it, and stays empty: the next may have it.
        registry.report("main", None, false);
        let routed = registry.route(vec![allowed("/docs/c.md")]);
        assert_eq!(routed.to_tell, ["main"]);
    }

    #[test]
    fn a_file_the_window_may_not_use_is_told_to_the_focused_window_and_opens_nothing() {
        let mut registry = registry_of(&["main"]);
        registry.report("main", Some("/docs/old.md".to_owned()), false);
        let routed = registry.route(vec![refused("/docs/secret.md")]);
        assert_eq!(routed.to_tell, ["main"]);
        assert!(routed.to_open.is_empty());
        assert_eq!(registry.take_files("main"), [refused("/docs/secret.md")]);

        // Nor does it use up an empty window.
        let mut registry = registry_of(&["main"]);
        let routed = registry.route(vec![refused("/docs/secret.md"), allowed("/docs/plan.md")]);
        assert_eq!(routed.to_tell, ["main"]);
        assert!(routed.to_open.is_empty());
    }

    #[test]
    fn files_dropped_on_a_window_go_to_it_as_they_go_to_the_window_in_front() {
        let windows = Windows::default();
        windows.lock().add("doc-1", WindowStart::default());
        windows.lock().add("main", WindowStart::default());
        windows
            .lock()
            .report("main", Some("/docs/old.md".to_owned()), false);
        let dropped = [std::path::PathBuf::from("/docs/plan.md")];
        // Dropped on the empty window behind: it takes the file, as it would in front.
        assert!(windows.dropped_on("doc-1", &dropped));
        let routed = windows.lock().route(vec![allowed("/docs/plan.md")]);
        assert_eq!(routed.to_tell, ["doc-1"]);
        assert!(routed.to_open.is_empty());
        // What is dropped on Preferences opens nothing, and moves no window to the front.
        assert!(!windows.dropped_on(PREFERENCES_WINDOW, &dropped));
        assert_eq!(windows.lock().frontmost().as_deref(), Some("doc-1"));
    }

    #[test]
    fn a_drop_of_nothing_there_moves_no_window_to_the_front() {
        let windows = Windows::default();
        windows.lock().add("doc-1", WindowStart::default());
        windows.lock().add("main", WindowStart::default());
        // Text dragged within the page, or files gone by the time they land: nothing to offer, and
        // the next file from Finder still goes by the window that has the focus.
        assert!(!windows.dropped_on("doc-1", &[]));
        assert_eq!(windows.lock().frontmost().as_deref(), Some("main"));
    }

    #[test]
    fn a_window_takes_its_files_once() {
        let mut registry = registry_of(&["main"]);
        registry.route(vec![allowed("/docs/a.md")]);
        assert_eq!(registry.take_files("main").len(), 1);
        assert!(registry.take_files("main").is_empty());
        assert!(registry.take_files("no such window").is_empty());
    }

    #[test]
    fn a_window_opened_for_a_file_is_not_empty() {
        let mut registry = Registry::default();
        registry.add(
            "doc-1",
            WindowStart {
                path: Some("/docs/a.md".to_owned()),
                line: Some(7),
            },
        );
        let routed = registry.route(vec![allowed("/docs/b.md")]);
        assert_eq!(routed.to_open, ["/docs/b.md"]);
        assert_eq!(
            registry.start("doc-1"),
            WindowStart {
                path: Some("/docs/a.md".to_owned()),
                line: Some(7),
            }
        );
        // A window the app doesn't know was opened for nothing.
        assert_eq!(registry.start("install"), WindowStart::default());
    }

    #[test]
    fn the_list_has_the_frontmost_window_first_and_what_each_holds() {
        let mut registry = registry_of(&["main", "doc-1"]);
        registry.report("doc-1", Some("/docs/a.md".to_owned()), true);
        registry.focus("doc-1");
        assert_eq!(
            registry.list(),
            [
                DocumentWindow {
                    label: "doc-1".to_owned(),
                    path: Some("/docs/a.md".to_owned()),
                    dirty: true
                },
                DocumentWindow {
                    label: "main".to_owned(),
                    path: None,
                    dirty: false
                },
            ]
        );
        // What the app knows nothing of doesn't join the list: the install question's window.
        registry.focus("install");
        registry.report("install", None, true);
        assert_eq!(registry.list().len(), 2);
        assert_eq!(registry.list()[0].label, "doc-1");
    }

    #[test]
    fn a_new_window_is_the_frontmost_and_a_closed_one_gives_way_to_the_one_behind() {
        let mut registry = registry_of(&["main"]);
        registry.add("doc-1", WindowStart::default());
        assert_eq!(registry.frontmost().as_deref(), Some("doc-1"));
        registry.remove("doc-1");
        assert_eq!(registry.frontmost().as_deref(), Some("main"));
        registry.remove("main");
        assert_eq!(registry.frontmost(), None);
    }

    #[test]
    fn terminating_needs_no_answer_when_nothing_is_unsaved() {
        let mut registry = registry_of(&["main", "doc-1"]);
        assert_eq!(registry.begin_terminating(), None);
        assert!(!registry.finish_asking());
    }

    #[test]
    fn terminating_waits_for_the_frontmost_window_with_unsaved_edits_to_ask() {
        // A window without edits may not have started, and could never answer.
        let mut registry = registry_of(&["main", "doc-1", "doc-2"]);
        registry.report("doc-1", None, true);
        registry.report("doc-2", None, true);
        assert_eq!(registry.begin_terminating().as_deref(), Some("doc-1"));
        // The app answers macOS once.
        assert!(registry.finish_asking());
        assert!(!registry.finish_asking());
    }

    #[test]
    fn when_the_window_asking_closes_the_next_with_edits_asks_in_its_place() {
        let mut registry = registry_of(&["main", "doc-1", "doc-2"]);
        registry.report("doc-1", None, true);
        registry.report("doc-2", None, true);
        assert_eq!(registry.begin_terminating().as_deref(), Some("doc-1"));
        assert!(!registry.remove("main"));
        assert!(registry.remove("doc-1"));
        assert_eq!(registry.begin_terminating().as_deref(), Some("doc-2"));
        // With no edits left, there is no one to ask, and nothing keeps the app.
        assert!(registry.remove("doc-2"));
        assert_eq!(registry.begin_terminating(), None);
        assert!(!registry.finish_asking());
    }

    const SCREEN: Area = Area {
        x: 0.0,
        y: 25.0,
        width: 1920.0,
        height: 1055.0,
    };

    #[test]
    fn a_new_window_opens_a_step_down_and_right_of_the_one_in_front() {
        let (x, y) = cascaded((100.0, 80.0), (1200.0, 820.0), Some(&SCREEN));
        assert_eq!((x, y), (100.0 + CASCADE_STEP, 80.0 + CASCADE_STEP));
    }

    #[test]
    fn a_window_that_would_run_off_the_screen_starts_again_at_its_corner() {
        assert_eq!(
            cascaded((800.0, 80.0), (1200.0, 820.0), Some(&SCREEN)),
            (0.0, 25.0)
        );
        assert_eq!(
            cascaded((100.0, 300.0), (1200.0, 820.0), Some(&SCREEN)),
            (0.0, 25.0)
        );
    }

    #[test]
    fn without_a_screen_to_measure_the_step_is_taken_anyway() {
        let (x, y) = cascaded((100.0, 80.0), (1200.0, 820.0), None);
        assert_eq!((x, y), (100.0 + CASCADE_STEP, 80.0 + CASCADE_STEP));
    }

    #[test]
    fn what_the_window_reads_reaches_it_by_name() {
        // src/host.ts and src/windows.ts read these fields.
        assert_eq!(
            serde_json::to_value(WindowStart {
                path: Some("/docs/a.md".to_owned()),
                line: Some(7),
            })
            .unwrap(),
            serde_json::json!({ "path": "/docs/a.md", "line": 7 })
        );
        assert_eq!(
            serde_json::to_value(WindowStart::default()).unwrap(),
            serde_json::json!({ "path": null, "line": null })
        );
        assert_eq!(
            serde_json::to_value(DocumentWindow {
                label: "doc-1".to_owned(),
                path: None,
                dirty: true,
            })
            .unwrap(),
            serde_json::json!({ "label": "doc-1", "path": null, "dirty": true })
        );
    }

    fn config() -> serde_json::Value {
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap()
    }

    #[test]
    fn every_document_window_has_the_capability_of_the_first() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert_eq!(
            capability["windows"],
            serde_json::json!([MAIN_WINDOW, "doc-*"])
        );
        // A window that has to ask comes to the front first (src/main.ts).
        let permissions = capability["permissions"].as_array().unwrap();
        for permission in [
            "core:window:allow-set-focus",
            "core:window:allow-unminimize",
        ] {
            assert!(
                permissions.iter().any(|given| given == permission),
                "{permission}"
            );
        }
    }

    #[test]
    fn the_windows_can_be_tabs_as_any_on_the_mac() {
        // Without a tabbing identifier, Tauri turns the Mac's window tabs off.
        let windows = config()["app"]["windows"].clone();
        let main = windows
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"] == MAIN_WINDOW)
            .unwrap()
            .clone();
        assert!(main["tabbingIdentifier"].is_string());
    }
}
