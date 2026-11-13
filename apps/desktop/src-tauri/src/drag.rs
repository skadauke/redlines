//! Dragging the window's file out of it: the title bar's document icon (`src/ui/titlebar.ts`) hands
//! the file over to Finder, Mail, Terminal or any other app's window, as the proxy icon of a native
//! title bar does. The page starts it once the icon has been dragged a few pixels, and the system
//! takes the drag from there. The window's own title bar is drawn by the page (`titleBarStyle:
//! "Overlay"`), so the system has no proxy icon of its own to drag.
//!
//! The drag copies: a file the window has open is never moved out from under it, and the icon
//! never offers to. A file dropped on the window it came from is nothing to open: the person let
//! go too soon, and a second window for the same file would be the surprise.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_fs::FsExt;

use crate::file_scope;
use crate::files::check_own_file;
use crate::windows::Windows;

/// How long after a drag ends a drop of its file on its own window still counts as the drag's:
/// the window hears of a drop a moment after the drag's source hears that it ended.
const RETURN_GRACE: Duration = Duration::from_secs(2);

/// A drag of the window's own file: which window, which file, and when it ended.
#[derive(Debug)]
struct OwnDrag {
    window: String,
    file: PathBuf,
    ended: Option<Instant>,
}

impl OwnDrag {
    fn begun(window: &str, file: &Path) -> Self {
        Self {
            window: window.to_owned(),
            file: file.to_owned(),
            ended: None,
        }
    }

    /// Whether `dropped`, which landed on the window `window` at `now`, is this drag's file coming
    /// back to the window it left: that file alone, while the drag is going or just after.
    fn is_coming_back(&self, window: &str, dropped: &[PathBuf], now: Instant) -> bool {
        let recent = self
            .ended
            .is_none_or(|ended| now.saturating_duration_since(ended) <= RETURN_GRACE);
        let own = file_scope::real(&self.file);
        self.window == window
            && recent
            && matches!(dropped, [only] if file_scope::real(only) == own)
    }
}

/// The last drag of a window's file, whether it is over or not.
static LAST: Mutex<Option<OwnDrag>> = Mutex::new(None);

fn last() -> std::sync::MutexGuard<'static, Option<OwnDrag>> {
    LAST.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Whether a drop of `dropped` on the window `window` is the file of a drag that began in that
/// window coming back to it, which opens nothing (`lib.rs`).
pub(crate) fn ignores_drop(window: &str, dropped: &[PathBuf]) -> bool {
    last()
        .as_ref()
        .is_some_and(|drag| drag.is_coming_back(window, dropped, Instant::now()))
}

/// The drag is over, whether the file landed or not.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn ended() {
    if let Some(drag) = last().as_mut() {
        drag.ended = Some(Instant::now());
    }
}

/// Whether the file at `path` can be dragged out of the window `window`: the window's own document
/// (as the window said, `window_document`), a file it may use, that is there to be handed over.
/// A link is the file it leads to, as the drop will find it.
fn check_draggable(
    windows: &Windows,
    window: &str,
    path: &Path,
    may_use: impl Fn(&Path) -> bool,
) -> Result<(), String> {
    check_own_file(windows, window, path, false, may_use)?;
    if !path.is_file() {
        return Err(format!("{}: there is no such file to drag", path.display()));
    }
    Ok(())
}

/// Starts dragging the window's own document out of the window, for the title bar's document icon.
/// Says whether the system took the drag: not once the button is up, which happens when the
/// pointer is fast, and not off the Mac, where the page has no icon to drag.
///
/// Only the file the window holds: the page has no business handing over anything else.
#[tauri::command]
pub fn start_file_drag(
    app: AppHandle,
    window: WebviewWindow,
    path: String,
) -> Result<bool, String> {
    let scope = app.fs_scope();
    let file = Path::new(&path);
    check_draggable(&app.state::<Windows>(), window.label(), file, |path| {
        file_scope::allowed(&scope, path)
    })?;
    let began = platform::begin(&window, file)?;
    if began {
        *last() = Some(OwnDrag::begun(window.label(), file));
    }
    Ok(began)
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::path::Path;

    use tauri::WebviewWindow;

    /// Only the Mac has a title bar drawn by the page, and a system drag to hand a file to.
    pub fn begin(_window: &WebviewWindow, _file: &Path) -> Result<bool, String> {
        Ok(false)
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::cell::RefCell;
    use std::path::Path;

    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{AnyThread, MainThreadMarker, MainThreadOnly, define_class, msg_send};
    use objc2_app_kit::{
        NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
        NSDraggingSource, NSEvent, NSEventModifierFlags, NSEventType, NSWindow, NSWorkspace,
    };
    use objc2_foundation::{
        NSArray, NSObject, NSObjectProtocol, NSPoint, NSProcessInfo, NSRect, NSSize, NSString,
        NSURL,
    };
    use tauri::WebviewWindow;

    /// The size the file's icon is drawn at under the pointer.
    const ICON: f64 = 32.0;

    define_class!(
        /// What the drag asks of the app, its source: which operations it allows, and when it
        /// ends.
        // SAFETY:
        // - The superclass NSObject does not have any subclassing requirements.
        // - `FileDragSource` does not implement `Drop`.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "RedlinesFileDragSource"]
        struct FileDragSource;

        // SAFETY: `NSObjectProtocol` has no safety requirements.
        unsafe impl NSObjectProtocol for FileDragSource {}

        // SAFETY: `NSDraggingSource` has no safety requirements beyond the signatures.
        unsafe impl NSDraggingSource for FileDragSource {
            // A copy and nothing else. Finder makes an alias of a drag that offers one, and with
            // a move on offer it would take the file out from under the window, which follows no
            // file but by its path.
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn source_operation_mask(
                &self,
                _session: &NSDraggingSession,
                _context: NSDraggingContext,
            ) -> NSDragOperation {
                NSDragOperation::Copy
            }

            #[unsafe(method(draggingSession:endedAtPoint:operation:))]
            fn session_ended(
                &self,
                _session: &NSDraggingSession,
                _point: NSPoint,
                _operation: NSDragOperation,
            ) {
                super::ended();
            }
        }
    );

    impl FileDragSource {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(());
            // SAFETY: the signature of `NSObject`'s `init` is correct.
            unsafe { msg_send![super(this), init] }
        }
    }

    thread_local! {
        /// The source of the drag that is going, or went last: kept for as long as the session may
        /// ask it things. Only the main thread starts drags.
        static SOURCE: RefCell<Option<Retained<FileDragSource>>> = const { RefCell::new(None) };
    }

    /// Starts the system's drag of the file under the pointer, from the window. Called from the
    /// main thread, or handed to it.
    pub fn begin(window: &WebviewWindow, file: &Path) -> Result<bool, String> {
        if let Some(mtm) = MainThreadMarker::new() {
            return begin_on_main_thread(mtm, window, file);
        }
        // The commands that run on another thread are handed to the main one, which the drag needs.
        let (send, receive) = std::sync::mpsc::channel();
        let (target, path) = (window.clone(), file.to_owned());
        window
            .run_on_main_thread(move || {
                let began = match MainThreadMarker::new() {
                    Some(mtm) => begin_on_main_thread(mtm, &target, &path),
                    None => Err("the drag can only begin on the main thread".to_owned()),
                };
                let _ = send.send(began);
            })
            .map_err(|error| error.to_string())?;
        receive.recv().map_err(|error| error.to_string())?
    }

    fn begin_on_main_thread(
        mtm: MainThreadMarker,
        window: &WebviewWindow,
        file: &Path,
    ) -> Result<bool, String> {
        // A drag the person has let go of has nothing to carry: the page asks a moment after the
        // pointer moved, and the button can be up by then.
        if NSEvent::pressedMouseButtons() & 1 == 0 {
            return Ok(false);
        }
        let raw = window.ns_window().map_err(|error| error.to_string())?;
        // SAFETY: Tauri gives the `NSWindow` of a window that is open, and this is its main thread.
        let ns_window: &NSWindow = unsafe { &*raw.cast::<NSWindow>() };
        let Some(view) = ns_window.contentView() else {
            return Ok(false);
        };
        let path = file.to_str().ok_or("the file's name is not text")?;
        let (ns_path, url) = (
            NSString::from_str(path),
            NSURL::fileURLWithPath(&NSString::from_str(path)),
        );

        let event = drag_event(mtm, ns_window);
        let icon = NSWorkspace::sharedWorkspace().iconForFile(&ns_path);
        icon.setSize(NSSize::new(ICON, ICON));

        // The icon sits under the pointer, as the file's own icon does when it is dragged in Finder.
        let at = view.convertPoint_fromView(event.locationInWindow(), None);
        let frame = NSRect::new(
            NSPoint::new(at.x - ICON / 2.0, at.y - ICON / 2.0),
            NSSize::new(ICON, ICON),
        );
        let item = NSDraggingItem::initWithPasteboardWriter(
            NSDraggingItem::alloc(),
            ProtocolObject::from_ref(&*url),
        );
        // SAFETY: the contents of a dragging item are an image, and this is one.
        unsafe { item.setDraggingFrame_contents(frame, Some(&icon)) };

        let source = FileDragSource::new(mtm);
        let items = NSArray::from_retained_slice(&[item]);
        let _session = view.beginDraggingSessionWithItems_event_source(
            &items,
            &event,
            ProtocolObject::from_ref(&*source),
        );
        SOURCE.with(|kept| *kept.borrow_mut() = Some(source));
        Ok(true)
    }

    /// The mouse event the drag begins with. The one the app is handling, if it is the press or a
    /// move with the button down; otherwise, as when the page's message came after another kind of
    /// event woke the app, one made for the pointer where it is.
    fn drag_event(mtm: MainThreadMarker, window: &NSWindow) -> Retained<NSEvent> {
        let current = NSApplication::sharedApplication(mtm).currentEvent();
        if let Some(event) = current
            && matches!(
                event.r#type(),
                NSEventType::LeftMouseDown | NSEventType::LeftMouseDragged
            )
        {
            return event;
        }
        NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
            NSEventType::LeftMouseDragged,
            window.mouseLocationOutsideOfEventStream(),
            NSEventModifierFlags::empty(),
            NSProcessInfo::processInfo().systemUptime(),
            window.windowNumber(),
            None,
            0,
            1,
            1.0,
        )
        .expect("the system makes a mouse event from valid arguments")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("redlines-drag-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn at(seconds: f64, from: Instant) -> Instant {
        from + Duration::from_secs_f64(seconds)
    }

    #[test]
    fn only_the_windows_own_file_can_be_dragged_out() {
        let dir = folder("own");
        let (mine, other) = (dir.join("plan.md"), dir.join("other.md"));
        std::fs::write(&mine, "mine").unwrap();
        std::fs::write(&other, "other").unwrap();
        let windows = Windows::with_document("doc-1", mine.to_str().unwrap());
        assert!(check_draggable(&windows, "doc-1", &mine, |_| true).is_ok());
        // Another file of the folder, another window's file, a file the window may not use.
        assert!(check_draggable(&windows, "doc-1", &other, |_| true).is_err());
        assert!(check_draggable(&windows, "doc-2", &mine, |_| true).is_err());
        assert!(check_draggable(&windows, "doc-1", &mine, |_| false).is_err());
    }

    #[test]
    fn a_file_that_is_gone_or_a_folder_is_nothing_to_hand_over() {
        let dir = folder("gone");
        let gone = dir.join("gone.md");
        let windows = Windows::with_document("doc-1", gone.to_str().unwrap());
        // The document's file was deleted after it opened.
        let error = check_draggable(&windows, "doc-1", &gone, |_| true).unwrap_err();
        assert!(error.contains("no such file"), "{error}");
        let windows = Windows::with_document("doc-1", dir.to_str().unwrap());
        assert!(check_draggable(&windows, "doc-1", &dir, |_| true).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn a_link_is_dragged_as_the_file_it_leads_to() {
        let dir = folder("link");
        let (file, link) = (dir.join("plan.md"), dir.join("link.md"));
        std::fs::write(&file, "mine").unwrap();
        std::os::unix::fs::symlink(&file, &link).unwrap();
        let windows = Windows::with_document("doc-1", link.to_str().unwrap());
        assert!(check_draggable(&windows, "doc-1", &link, |_| true).is_ok());
        // A link to nothing is no file.
        let dangling = dir.join("dangling.md");
        std::os::unix::fs::symlink(dir.join("nothing.md"), &dangling).unwrap();
        let windows = Windows::with_document("doc-1", dangling.to_str().unwrap());
        assert!(check_draggable(&windows, "doc-1", &dangling, |_| true).is_err());
    }

    #[test]
    fn the_file_dropped_back_on_its_own_window_is_nothing_to_open() {
        let dir = folder("back");
        let file = dir.join("plan.md");
        std::fs::write(&file, "mine").unwrap();
        let drag = OwnDrag::begun("doc-1", &file);
        let now = Instant::now();
        // While the drag goes on.
        assert!(drag.is_coming_back("doc-1", std::slice::from_ref(&file), now));
        // Another window's drop of it is a drop like Finder's.
        assert!(!drag.is_coming_back("doc-2", std::slice::from_ref(&file), now));
        // Any other file, or several files, are the person's own drop.
        let other = dir.join("other.md");
        std::fs::write(&other, "other").unwrap();
        assert!(!drag.is_coming_back("doc-1", std::slice::from_ref(&other), now));
        assert!(!drag.is_coming_back("doc-1", &[file.clone(), other.clone()], now));
        assert!(!drag.is_coming_back("doc-1", &[], now));
    }

    #[test]
    fn the_drop_comes_a_moment_after_the_drag_ends_and_only_then() {
        let dir = folder("moment");
        let file = dir.join("plan.md");
        std::fs::write(&file, "mine").unwrap();
        let mut drag = OwnDrag::begun("doc-1", &file);
        let ended = Instant::now();
        drag.ended = Some(ended);
        let dropped = std::slice::from_ref(&file);
        assert!(drag.is_coming_back("doc-1", dropped, at(0.0, ended)));
        assert!(drag.is_coming_back("doc-1", dropped, at(1.9, ended)));
        // Later, the same file dragged from Finder onto the window is a drop like any other.
        assert!(!drag.is_coming_back("doc-1", dropped, at(2.1, ended)));
        assert!(!drag.is_coming_back("doc-1", dropped, at(60.0, ended)));
    }

    #[test]
    fn a_file_is_the_same_by_the_file_it_really_is() {
        let dir = folder("same");
        let (file, link) = (dir.join("plan.md"), dir.join("link.md"));
        std::fs::write(&file, "mine").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&file, &link).unwrap();
        #[cfg(unix)]
        {
            let drag = OwnDrag::begun("doc-1", &link);
            assert!(drag.is_coming_back("doc-1", std::slice::from_ref(&file), Instant::now()));
        }
        #[cfg(not(unix))]
        let _ = link;
    }

    #[test]
    fn the_last_drag_is_remembered_for_the_drop_and_ended_by_the_system() {
        let dir = folder("last");
        let file = dir.join("plan.md");
        std::fs::write(&file, "mine").unwrap();
        *last() = Some(OwnDrag::begun("doc-9", &file));
        assert!(ignores_drop("doc-9", std::slice::from_ref(&file)));
        assert!(!ignores_drop("doc-8", std::slice::from_ref(&file)));
        ended();
        // Just after, the drop is still the drag's.
        assert!(ignores_drop("doc-9", std::slice::from_ref(&file)));
        *last() = None;
        assert!(!ignores_drop("doc-9", std::slice::from_ref(&file)));
    }
}
