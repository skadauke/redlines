//! The window zoom (design §5.1): one level for every window, kept across launches, from 80% to
//! 200%. The app is the only writer of WebKit's page zoom, which on the Mac has no getter, so it
//! keeps the level itself.
//!
//! A level is one of the ladder's rungs (`ZOOM_LADDER` in `src/text-size.ts`; the text's own ladder
//! goes further, to 400%, and is the page's alone). The app keeps it in
//! `zoom.json` in its data folder, read at the start, and none while the file is missing, can't be
//! read or holds something else. A new document window or Preferences is built with an
//! initialization script that hands its page the level (`window.__REDLINES_ZOOM__`), and the app
//! sets the page zoom right after it builds the window, before the page loads. A window asks for a
//! level with `set_zoom`; the app keeps it and tells each document window and Preferences, with the
//! `zoom` event and then the page zoom, in that order (`src/zoom.ts` follows the two). The install
//! window and About are never zoomed. Each page, once loaded, asks `zoom_level` for the app's level, reporting
//! the one in its settings: the app takes the report only when it has no level yet, and only the
//! first.
//!
//! Preferences can't be resized by hand, so it grows with the zoom: 560 by 440 points times the
//! zoom, keeping its top edge and its middle, within the visible area of the screen.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewWindow};

use crate::windows::{PREFERENCES_WINDOW, is_document_window};

/// What the app tells a window with the level, just before it sets the window's page zoom.
pub const ZOOM_EVENT: &str = "zoom";

/// The file in the app's data folder that holds the level.
const REMEMBERED_FILE: &str = "zoom.json";

/// The zooms a person can have: the window zoom's ladder of `src/text-size.ts`, `ZOOM_LADDER`.
const LADDER: [f64; 8] = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

/// Preferences' size in points at 100%, which is its size in `tauri.conf.json`.
const PREFERENCES_SIZE: (f64, f64) = (560.0, 440.0);

/// The app's level, once it has one.
#[derive(Default)]
pub struct Zoom(Mutex<Option<f64>>);

impl Zoom {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<f64>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// A rectangle on a screen, in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn is_rung(level: f64) -> bool {
    LADDER.contains(&level)
}

/// The level in `file`, if there is one and it is a rung.
fn read_remembered(file: &Path) -> Option<f64> {
    let bytes = std::fs::read(file).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value.get("zoom")?.as_f64().filter(|level| is_rung(*level))
}

/// Writes `level` to `file`, making its folder.
fn keep(file: &Path, level: f64) -> io::Result<()> {
    if let Some(folder) = file.parent() {
        std::fs::create_dir_all(folder)?;
    }
    std::fs::write(
        file,
        serde_json::to_vec(&serde_json::json!({ "zoom": level }))?,
    )
}

fn remembered_file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join(REMEMBERED_FILE))
}

fn remember(app: &AppHandle, level: f64) {
    if let Some(file) = remembered_file(app)
        && let Err(error) = keep(&file, level)
    {
        eprintln!(
            "Redlines can't keep its zoom in {}: {error}",
            file.display()
        );
    }
}

/// The answer to a page's report of the level in its settings, and whether the report was taken:
/// only the first, and only while the app has no level, and only a rung.
fn answer(level: &mut Option<f64>, reported: f64) -> (f64, bool) {
    if let Some(level) = *level {
        return (level, false);
    }
    if is_rung(reported) {
        *level = Some(reported);
        return (reported, true);
    }
    (1.0, false)
}

/// Only a document window or Preferences may zoom; the install window and About keep the system's
/// size.
fn may_zoom(label: &str) -> Result<(), String> {
    if is_document_window(label) || label == PREFERENCES_WINDOW {
        Ok(())
    } else {
        Err(format!("the window {label} is not zoomed"))
    }
}

/// The initialization script's text: the level, or `null` while the app has none. With a level it
/// also sets `--rl-zoom` on the page's root as soon as the root exists, which is before the first
/// paint and before the page's own scripts, so that a window built at 150% never draws a frame in
/// the frame's units for 100% (`src/zoom.css`; the page sets the same value again).
fn script(level: Option<f64>) -> String {
    match level {
        Some(level) => format!(
            "window.__REDLINES_ZOOM__ = {level};\n\
             (function () {{\n\
             var set = function () {{\n\
             if (!document.documentElement) return false;\n\
             document.documentElement.style.setProperty('--rl-zoom', '{level}');\n\
             return true;\n\
             }};\n\
             if (set()) return;\n\
             var watch = new MutationObserver(function () {{ if (set()) watch.disconnect(); }});\n\
             watch.observe(document, {{ childList: true }});\n\
             }})();"
        ),
        None => "window.__REDLINES_ZOOM__ = null;".to_owned(),
    }
}

/// Preferences' size at `zoom`: 560 by 440 points times it, within `area` when that is known.
fn zoomed_size(zoom: f64, area: Option<(f64, f64)>) -> (f64, f64) {
    // Whole points, so that 110% is 616 by 440 and not a hair off.
    let (width, height) = (
        (PREFERENCES_SIZE.0 * zoom).round(),
        (PREFERENCES_SIZE.1 * zoom).round(),
    );
    match area {
        Some((area_width, area_height)) => (width.min(area_width), height.min(area_height)),
        None => (width, height),
    }
}

/// Preferences' frame at `zoom`: its size times the zoom, within the work area `area`, keeping the
/// top edge and the middle of `current`, then moved the least distance that keeps it inside.
pub fn preferences_frame(zoom: f64, current: Frame, area: Frame) -> Frame {
    let (width, height) = zoomed_size(zoom, Some((area.width, area.height)));
    let x = current.x + current.width / 2.0 - width / 2.0;
    Frame {
        x: x.clamp(area.x, area.x + area.width - width),
        y: current.y.clamp(area.y, area.y + area.height - height),
        width,
        height,
    }
}

/// Reads the level the app kept, before any window opens.
pub fn set_up(app: &AppHandle) {
    let level = remembered_file(app).and_then(|file| read_remembered(&file));
    *app.state::<Zoom>().lock() = level;
}

/// The script for a window about to be built, which hands its page the app's level.
pub fn init_script(app: &AppHandle) -> String {
    script(*app.state::<Zoom>().lock())
}

/// Sets the page zoom of a window just built, when the app has a level.
pub fn apply(window: &WebviewWindow) {
    let level = *window.app_handle().state::<Zoom>().lock();
    if let Some(level) = level
        && let Err(error) = window.set_zoom(level)
    {
        eprintln!("Redlines can't zoom {}: {error}", window.label());
    }
}

/// The visible area of the window's screen, in logical pixels.
fn work_area(window: &WebviewWindow) -> Option<Frame> {
    let monitor = window.current_monitor().ok()??;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (position, size) = (
        area.position.to_logical::<f64>(scale),
        area.size.to_logical::<f64>(scale),
    );
    Some(Frame {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// What a built Preferences window should be: its size at the app's zoom, within the primary
/// screen's visible area when that is known.
pub fn preferences_inner_size(app: &AppHandle) -> (f64, f64) {
    let zoom = (*app.state::<Zoom>().lock()).unwrap_or(1.0);
    let area = app.primary_monitor().ok().flatten().map(|monitor| {
        let size = monitor
            .work_area()
            .size
            .to_logical::<f64>(monitor.scale_factor());
        (size.width, size.height)
    });
    zoomed_size(zoom, area)
}

/// Grows or shrinks Preferences to its size at `level`, from its top and middle.
fn resize_preferences(window: &WebviewWindow, level: f64) {
    let (Ok(scale), Ok(position), Ok(size), Some(area)) = (
        window.scale_factor(),
        window.outer_position(),
        window.inner_size(),
        work_area(window),
    ) else {
        return;
    };
    let (position, size): (LogicalPosition<f64>, LogicalSize<f64>) =
        (position.to_logical(scale), size.to_logical(scale));
    let current = Frame {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let frame = preferences_frame(level, current, area);
    let _ = window.set_size(LogicalSize::new(frame.width, frame.height));
    let _ = window.set_position(LogicalPosition::new(frame.x, frame.y));
}

/// Tells every document window and Preferences the level, and then sets their page zoom, in that
/// order: the page takes its reading place on the event, while its layout is still the old one.
/// The level is the app's now, read here and not taken from the caller, so that two changes in
/// quick succession leave every window at the one the app ended with.
fn broadcast(app: &AppHandle) {
    let Some(level) = *app.state::<Zoom>().lock() else {
        return;
    };
    for (label, window) in app.webview_windows() {
        if may_zoom(&label).is_err() {
            continue;
        }
        if let Err(error) = app.emit_to(label.as_str(), ZOOM_EVENT, level) {
            eprintln!("Redlines can't tell {label} of the zoom: {error}");
        }
        if let Err(error) = window.set_zoom(level) {
            eprintln!("Redlines can't zoom {label}: {error}");
        }
        if label == PREFERENCES_WINDOW {
            resize_preferences(&window, level);
        }
    }
}

/// A window asks for a level. Only a rung is taken, and only from a document window or
/// Preferences; the level the app has already changes nothing.
#[tauri::command]
pub fn set_zoom(app: AppHandle, window: WebviewWindow, level: f64) -> Result<(), String> {
    may_zoom(window.label())?;
    if !is_rung(level) {
        return Err(format!("{level} is not a zoom"));
    }
    {
        let state = app.state::<Zoom>();
        let mut kept = state.lock();
        if *kept == Some(level) {
            return Ok(());
        }
        *kept = Some(level);
    }
    remember(&app, level);
    broadcast(&app);
    Ok(())
}

/// A page's report of the level in its settings, answered with the app's level. The first report
/// gives the app its level when it has none, which then reaches every window unless it is 100%.
#[tauri::command]
pub fn zoom_level(app: AppHandle, window: WebviewWindow, reported: f64) -> Result<f64, String> {
    may_zoom(window.label())?;
    let (level, taken) = answer(&mut app.state::<Zoom>().lock(), reported);
    if taken {
        remember(&app, level);
        if level != 1.0 {
            broadcast(&app);
        }
    }
    Ok(level)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder for one test, which the test removes.
    fn scratch(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("redlines-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        folder
    }

    #[test]
    fn the_ladder_is_the_pages() {
        let page = include_str!("../../src/text-size.ts");
        assert!(page.contains("[0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]"));
        assert!(is_rung(1.25));
        for not in [1.3, 0.0, 2.5, f64::NAN] {
            assert!(!is_rung(not), "{not}");
        }
    }

    #[test]
    fn what_is_remembered_comes_back_from_its_file() {
        let folder = scratch("zoom-keep");
        let file = folder.join("data").join(REMEMBERED_FILE);
        keep(&file, 1.5).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{\"zoom\":1.5}");
        assert_eq!(read_remembered(&file), Some(1.5));
        for (name, text) in [
            ("garbage", "not json"),
            ("off", "{\"zoom\":1.3}"),
            ("string", "{\"zoom\":\"1.5\"}"),
            ("empty", "{}"),
        ] {
            let other = folder.join(name);
            std::fs::write(&other, text).unwrap();
            assert_eq!(read_remembered(&other), None, "{text}");
        }
        assert_eq!(read_remembered(&folder.join("missing")), None);
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn the_first_report_gives_the_app_its_level_and_no_later_one_does() {
        let mut level = None;
        assert_eq!(answer(&mut level, 1.5), (1.5, true));
        assert_eq!(level, Some(1.5));
        assert_eq!(answer(&mut level, 2.0), (1.5, false));
        let mut had = Some(1.25);
        assert_eq!(answer(&mut had, 2.0), (1.25, false));
        let mut none = None;
        assert_eq!(answer(&mut none, 1.3), (1.0, false));
        assert_eq!(none, None);
    }

    #[test]
    fn only_a_document_window_or_preferences_may_zoom() {
        for label in ["main", "doc-3", "preferences"] {
            assert!(may_zoom(label).is_ok(), "{label}");
        }
        for label in [
            crate::install::QUESTION_WINDOW,
            crate::windows::ABOUT_WINDOW,
            "",
        ] {
            assert!(may_zoom(label).is_err(), "{label}");
        }
    }

    #[test]
    fn the_script_hands_the_page_the_level() {
        assert_eq!(script(None), "window.__REDLINES_ZOOM__ = null;");
        assert!(script(Some(1.25)).starts_with("window.__REDLINES_ZOOM__ = 1.25;"));
        assert!(script(Some(1.0)).starts_with("window.__REDLINES_ZOOM__ = 1;"));
    }

    #[test]
    fn the_script_sets_the_root_property_before_the_first_paint() {
        let text = script(Some(1.5));
        // At once if the root is there, else as soon as the document gets one.
        assert!(text.contains("setProperty('--rl-zoom', '1.5')"));
        assert!(text.contains("MutationObserver"));
        assert!(!script(None).contains("setProperty"));
    }

    #[test]
    fn the_window_hears_the_event_the_app_sends() {
        let page = include_str!("../../src/zoom.ts");
        assert!(page.contains(&format!("'{ZOOM_EVENT}'")));
        assert!(page.contains("__REDLINES_ZOOM__"));
    }

    #[test]
    fn preferences_grows_from_its_top_and_middle_and_stays_on_the_screen() {
        let frame = |x, y, width, height| Frame {
            x,
            y,
            width,
            height,
        };
        let area = frame(0.0, 25.0, 1440.0, 875.0);
        let current = frame(440.0, 200.0, 560.0, 440.0);
        assert_eq!(
            preferences_frame(1.25, current, area),
            frame(370.0, 200.0, 700.0, 550.0)
        );
        // Taller than the screen's visible area, which it fills.
        assert_eq!(
            preferences_frame(2.0, current, area),
            frame(160.0, 25.0, 1120.0, 875.0)
        );
        let low = frame(440.0, 600.0, 560.0, 440.0);
        let grown = preferences_frame(1.1, low, area);
        assert_eq!((grown.x, grown.y, grown.height), (412.0, 416.0, 484.0));
        assert_eq!(grown.width, 616.0);
        let small = frame(0.0, 25.0, 1024.0, 743.0);
        assert_eq!(preferences_frame(2.0, current, small), small);
        assert_eq!(zoomed_size(2.0, Some((1024.0, 743.0))), (1024.0, 743.0));
        assert_eq!(zoomed_size(1.5, None), (840.0, 660.0));
    }
}
