//! The running app's icon: a different mark of the icon family at every launch.
//!
//! The icon the app is installed with is the caret, and it never changes: the app's bundle is left
//! alone, since changing it would break its signature. While the app runs, its Dock icon shows one
//! of six marks instead (the window's icon, where there is no Dock): the next in a fixed order at
//! each launch, so that no launch looks like the one before. Turning off Redlines › Settings ›
//! Rotate the Dock Icon keeps the caret. About Redlines goes through the family by hand: it asks
//! which mark the icon shows (`app_icon_mark`) and shows another until the next launch
//! (`show_app_icon_mark`), which leaves what the app remembers alone.
//!
//! What the app remembers between launches, which mark came last and whether the icon rotates, is
//! in `icon.json` in its data folder. The marks are PNG files in the app's resources
//! (`icons/family`); one that can't be read leaves the icon as it is. `bundle.resources` in
//! `tauri.conf.json` is an object, not a list, so that the resources a platform's file such as
//! `tauri.macos.conf.json` would name are added to it: Tauri merges the files as a JSON Merge Patch,
//! which replaces a list whole.

use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Listener, Manager, RunEvent, Runtime};

/// The marks of the family, as the names of their files in `icons/family`, in the order the
/// launches show them. The first is the caret, the icon the app is installed with.
const MARKS: [&str; 6] = [
    "caret",
    "change-bar",
    "margin-bracket",
    "delete-mark",
    "redline",
    "caret-insertion",
];

/// The caret's place in `MARKS`: what the icon goes back to when the rotation is turned off.
const CARET: usize = 0;

/// The mark the icon shows now, as its place in `MARKS`: what About Redlines starts on, and goes on
/// from. Not what the app remembers: a mark shown for the length of a run (`show_app_icon_mark`) is
/// in it too.
struct Shown(AtomicUsize);

impl Shown {
    /// The caret, which the icon shows until one is shown.
    const fn new() -> Self {
        Self(AtomicUsize::new(CARET))
    }

    /// Notes the mark at `mark` in `MARKS` as shown. A place that is no mark is not one.
    fn set(&self, mark: usize) {
        if mark < MARKS.len() {
            self.0.store(mark, Ordering::SeqCst);
        }
    }

    /// The file name of the mark shown.
    fn name(&self) -> &'static str {
        MARKS[self.0.load(Ordering::SeqCst).min(MARKS.len() - 1)]
    }
}

static SHOWN: Shown = Shown::new();

fn set_shown(mark: usize) {
    SHOWN.set(mark);
}

/// The file name of the mark the icon shows now.
fn shown_mark() -> &'static str {
    SHOWN.name()
}

/// The place in `MARKS` of the mark with the file name `name`, if it is one.
fn mark_named(name: &str) -> Option<usize> {
    MARKS.iter().position(|mark| *mark == name)
}

/// What the window says when the person turns the rotation on or off: the event's payload is
/// `true` or `false`. `src/dock-icon.ts` sends it.
const ROTATION_EVENT: &str = "icon-rotation";

/// The file in the app's data folder that holds what it remembers.
const REMEMBERED_FILE: &str = "icon.json";

/// What the app remembers between launches.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
struct Remembered {
    /// The mark the last launch showed, as its place in `MARKS`.
    last: Option<usize>,
    /// Whether the icon rotates. The window's settings are where the person turns this off, and
    /// the window says so when it opens; the app keeps its own copy, so that it knows before
    /// there is a window to ask, and the icon doesn't change at every launch for someone who
    /// turned it off.
    rotate: bool,
}

impl Default for Remembered {
    fn default() -> Self {
        Self {
            last: None,
            rotate: true,
        }
    }
}

impl Remembered {
    /// A launch: the mark to show, if the icon rotates, which is remembered as the last.
    fn launch(&mut self) -> Option<usize> {
        if !self.rotate {
            return None;
        }
        let mark = next_mark(self.last);
        self.last = Some(mark);
        Some(mark)
    }

    /// The person turns the rotation on or off while the app runs: the mark to show now, if the
    /// icon should change. Off shows the caret, and on shows the next mark in the order. Neither
    /// loses the place in the order, and saying what is so already changes nothing.
    fn set_rotate(&mut self, rotate: bool) -> Option<usize> {
        if rotate == self.rotate {
            return None;
        }
        self.rotate = rotate;
        if rotate { self.launch() } else { Some(CARET) }
    }
}

/// The mark after the one at `last`, wrapping around after the final one. The first mark follows
/// no mark at all, and a place that isn't one of the marks, such as one a newer version of the app
/// with more marks left behind.
fn next_mark(last: Option<usize>) -> usize {
    match last {
        Some(last) if last < MARKS.len() => (last + 1) % MARKS.len(),
        _ => 0,
    }
}

/// What the file holds, or the defaults when it isn't there or can't be understood.
fn read_remembered(file: &Path) -> Remembered {
    std::fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_remembered(file: &Path, remembered: &Remembered) -> io::Result<()> {
    if let Some(folder) = file.parent() {
        std::fs::create_dir_all(folder)?;
    }
    std::fs::write(file, serde_json::to_vec(remembered)?)
}

/// What the window said about the rotation, from the payload of its event.
fn parse_rotation(payload: &str) -> Option<bool> {
    serde_json::from_str(payload).ok()
}

/// The plugin that keeps the app's icon, to register once with `.plugin(dock_icon::init())`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("dock-icon")
        .setup(|app, _| {
            let handle = app.clone();
            app.listen_any(ROTATION_EVENT, move |event| {
                let Some(rotate) = parse_rotation(event.payload()) else {
                    // What the window sent could be anything or long: only its length is said.
                    eprintln!(
                        "Redlines ignores an icon setting of {} bytes: it is not true or false",
                        event.payload().len()
                    );
                    return;
                };
                // Only the main thread may change the Dock icon.
                let app = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    update(&app, |remembered| remembered.set_rotate(rotate));
                });
            });
            Ok(())
        })
        // Once the app is ready, which in a `tauri dev` run comes after Tauri has set an icon of
        // its own, and after the window has opened, for the platforms where it holds the icon.
        .on_event(|app, event| {
            if matches!(event, RunEvent::Ready) {
                update(app, Remembered::launch);
            }
        })
        .build()
}

/// Changes what the app remembers by `change`, which says which mark to show, if the icon should
/// change; shows it, and keeps what is now remembered.
fn update<R: Runtime>(app: &AppHandle<R>, change: impl FnOnce(&mut Remembered) -> Option<usize>) {
    let Ok(folder) = app.path().app_data_dir() else {
        return;
    };
    let file = folder.join(REMEMBERED_FILE);
    let before = read_remembered(&file);
    let mut remembered = before.clone();
    if let Some(mark) = change(&mut remembered)
        && let Err(error) = show(app, mark)
    {
        eprintln!("Redlines can't change its icon: {error}");
    }
    if remembered != before
        && let Err(error) = write_remembered(&file, &remembered)
    {
        eprintln!(
            "Redlines can't remember its icon in {}: {error}",
            file.display()
        );
    }
}

/// Shows the mark at `mark` in `MARKS` as the app's icon.
fn show<R: Runtime>(app: &AppHandle<R>, mark: usize) -> Result<(), String> {
    let name = MARKS.get(mark).ok_or("there is no such mark")?;
    let path = app
        .path()
        .resolve(format!("icons/family/{name}.png"), BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    let png = std::fs::read(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    set_icon(app, &png)?;
    set_shown(mark);
    Ok(())
}

/// The mark the app's icon shows now, by its file name in `icons/family`: About Redlines starts on
/// it, and its icon goes on through the family from there.
#[tauri::command]
pub fn app_icon_mark() -> &'static str {
    shown_mark()
}

/// Shows the mark `name` as the app's icon until the next launch, as About Redlines does when its
/// icon is clicked through the family. What the app remembers, the order of the launches included,
/// is left alone, so that the next launch goes on as it would have. The page is told when the icon
/// could not be changed, and keeps its own as it was.
#[tauri::command]
pub async fn show_app_icon_mark(app: AppHandle, name: String) -> Result<(), String> {
    let mark = mark_named(&name).ok_or("there is no such mark")?;
    // Only the main thread may change the Dock icon, and this waits, off it, to hear how it went.
    let (sender, receiver) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(show(&handle, mark));
    })
    .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver.recv().map_err(|error| error.to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(target_os = "macos")]
fn set_icon<R: Runtime>(_app: &AppHandle<R>, png: &[u8]) -> Result<(), String> {
    macos::set_application_icon(png)
}

#[cfg(all(desktop, not(target_os = "macos")))]
fn set_icon<R: Runtime>(app: &AppHandle<R>, png: &[u8]) -> Result<(), String> {
    set_window_icons(app, png)
}

#[cfg(mobile)]
fn set_icon<R: Runtime>(_app: &AppHandle<R>, _png: &[u8]) -> Result<(), String> {
    Ok(())
}

/// Sets the icon of the app's windows, which is where the app's icon shows when there is no Dock:
/// in a window's title bar, in a task bar and in a window switcher. A Wayland desktop shows no
/// window icons, and this does nothing there. The tests build it on the Mac too, though the Dock
/// icon does this job there, so that building them on a Mac checks it.
#[cfg(all(desktop, any(test, not(target_os = "macos"))))]
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn set_window_icons<R: Runtime>(app: &AppHandle<R>, png: &[u8]) -> Result<(), String> {
    let icon = tauri::image::Image::from_bytes(png).map_err(|error| error.to_string())?;
    for window in app.webview_windows().values() {
        window
            .set_icon(icon.clone())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    /// An image of the bytes of a PNG file, as the Dock draws it.
    pub fn image_from_png(png: &[u8]) -> Result<objc2::rc::Retained<NSImage>, String> {
        NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(png))
            .ok_or_else(|| "it isn't an image the system can read".to_owned())
    }

    /// Makes the PNG the icon that the Dock shows for the running app. The bundle's own icon is
    /// not touched.
    pub fn set_application_icon(png: &[u8]) -> Result<(), String> {
        let main = MainThreadMarker::new().ok_or("it can only change on the main thread")?;
        let image = image_from_png(png)?;
        // SAFETY: the application's icon image is an `NSImage` or nil, and this is an `NSImage`.
        unsafe { NSApplication::sharedApplication(main).setApplicationIconImage(Some(&image)) };
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tauri::utils::config::{BundleResources, Config};
    use tauri::utils::platform::Target;
    use tauri::utils::resources::{ResourcePaths, ResourcePathsIter};

    use super::*;

    /// The launches of a person who never changes the setting: the marks they see, in order.
    fn launches(remembered: &mut Remembered, count: usize) -> Vec<usize> {
        (0..count)
            .map(|_| remembered.launch().expect("the icon rotates"))
            .collect()
    }

    #[test]
    fn the_marks_are_in_the_order_of_the_family_and_start_with_the_caret() {
        assert_eq!(
            MARKS,
            [
                "caret",
                "change-bar",
                "margin-bracket",
                "delete-mark",
                "redline",
                "caret-insertion"
            ]
        );
        assert_eq!(MARKS[CARET], "caret");
    }

    #[test]
    fn every_launch_shows_the_next_mark_and_the_order_starts_over_after_the_last() {
        let shown = launches(&mut Remembered::default(), 13);
        assert_eq!(shown, [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0]);
        // No launch looks like the one before it.
        assert!(shown.windows(2).all(|pair| pair[0] != pair[1]));
    }

    #[test]
    fn a_launch_goes_on_from_what_was_remembered() {
        let mut remembered = Remembered {
            last: Some(2),
            rotate: true,
        };
        assert_eq!(remembered.launch(), Some(3));
        assert_eq!(remembered.last, Some(3));
        assert_eq!(next_mark(Some(MARKS.len() - 1)), 0);
    }

    #[test]
    fn a_place_that_is_not_a_mark_starts_the_order_over() {
        for last in [None, Some(MARKS.len()), Some(99), Some(usize::MAX)] {
            assert_eq!(next_mark(last), 0, "{last:?}");
        }
    }

    #[test]
    fn a_person_who_keeps_the_caret_sees_no_change_and_keeps_their_place_in_the_order() {
        let mut remembered = Remembered::default();
        assert_eq!(launches(&mut remembered, 3), [0, 1, 2]);

        // Turning it off while the app runs shows the caret.
        assert_eq!(remembered.set_rotate(false), Some(CARET));
        // Off, a launch leaves the icon alone, and the place in the order is where it was.
        assert_eq!(remembered.launch(), None);
        assert_eq!(remembered.launch(), None);
        assert_eq!(remembered.last, Some(2));
        // Saying that it is off, once more, changes nothing.
        assert_eq!(remembered.set_rotate(false), None);

        // Turning it on shows the next mark, and the launches go on from there.
        assert_eq!(remembered.set_rotate(true), Some(3));
        assert_eq!(remembered.set_rotate(true), None);
        assert_eq!(remembered.launch(), Some(4));
    }

    #[test]
    fn the_window_telling_the_app_the_setting_it_has_already_changes_nothing() {
        // The window says what it has when it opens, and the app has that from its file already.
        let mut remembered = Remembered::default();
        assert_eq!(remembered.launch(), Some(0));
        assert_eq!(remembered.set_rotate(true), None);
        assert_eq!(remembered.last, Some(0));
    }

    #[test]
    fn a_mark_is_found_by_its_file_name_and_nothing_else_is_one() {
        for (place, name) in MARKS.iter().enumerate() {
            assert_eq!(mark_named(name), Some(place), "{name}");
        }
        for name in [
            "",
            "Caret",
            "caret.png",
            "../caret",
            "icon",
            " caret",
            "caret ",
        ] {
            assert_eq!(mark_named(name), None, "{name:?}");
        }
    }

    #[test]
    fn the_mark_the_icon_shows_is_the_caret_until_one_is_shown_and_then_the_last_shown() {
        let shown = Shown::new();
        assert_eq!(shown.name(), "caret");
        shown.set(3);
        assert_eq!(shown.name(), "delete-mark");
        // What is not a mark is not shown.
        shown.set(MARKS.len());
        assert_eq!(shown.name(), "delete-mark");
        shown.set(CARET);
        assert_eq!(shown.name(), "caret");
    }

    #[test]
    fn what_the_app_says_it_shows_is_what_it_was_last_told() {
        let _turn = take_turn();
        let before = SHOWN.0.load(Ordering::SeqCst);
        set_shown(2);
        assert_eq!(app_icon_mark(), "margin-bracket");
        set_shown(before);
    }

    #[test]
    fn about_asks_for_the_mark_and_for_another_by_these_names() {
        // src/about/main.ts reads the mark the icon shows, and shows the next ones as it is clicked,
        // naming the mark `name`, which is what `show_app_icon_mark` takes. A call that names
        // something else is refused when it is made, which the page only logs.
        let page = include_str!("../../src/about/main.ts");
        for call in [
            "invoke<string>('app_icon_mark')",
            "invoke('show_app_icon_mark', { name: mark })",
        ] {
            assert!(page.contains(call), "src/about/main.ts doesn't make {call}");
        }
    }

    #[test]
    fn the_window_sends_the_event_the_app_listens_for() {
        let window = include_str!("../../src/dock-icon.ts");
        assert!(
            window.contains(&format!("'{ROTATION_EVENT}'")),
            "src/dock-icon.ts doesn't send {ROTATION_EVENT:?}"
        );
    }

    #[test]
    fn the_window_says_true_or_false() {
        assert_eq!(parse_rotation("true"), Some(true));
        assert_eq!(parse_rotation("false"), Some(false));
        for payload in ["", "null", "1", "\"true\"", "{}", "tru"] {
            assert_eq!(parse_rotation(payload), None, "{payload:?}");
        }
    }

    /// The tests that touch the mark shown, which is the app's, take turns.
    fn take_turn() -> std::sync::MutexGuard<'static, ()> {
        static TURN: std::sync::Mutex<()> = std::sync::Mutex::new(());
        TURN.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A folder for one test, which the test removes.
    fn scratch(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("redlines-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        folder
    }

    #[test]
    fn what_is_remembered_comes_back_from_its_file_and_its_folder_is_made() {
        let folder = scratch("icon-remembered");
        let file = folder.join("data").join(REMEMBERED_FILE);
        assert_eq!(read_remembered(&file), Remembered::default());

        let remembered = Remembered {
            last: Some(4),
            rotate: false,
        };
        write_remembered(&file, &remembered).unwrap();
        assert_eq!(read_remembered(&file), remembered);
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            r#"{"last":4,"rotate":false}"#
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_file_that_is_not_understood_means_the_defaults_and_what_is_missing_takes_its_default() {
        let folder = scratch("icon-unreadable");
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join(REMEMBERED_FILE);
        let read = |contents: &str| {
            std::fs::write(&file, contents).unwrap();
            read_remembered(&file)
        };

        assert_eq!(read("not json"), Remembered::default());
        assert_eq!(read(""), Remembered::default());
        assert_eq!(read(r#"{"last":"two"}"#), Remembered::default());
        assert_eq!(read(r#"{"last":-1}"#), Remembered::default());
        assert_eq!(read("{}"), Remembered::default());
        // A value that is there is kept, whatever else is missing or is new.
        let off = Remembered {
            last: None,
            rotate: false,
        };
        assert_eq!(read(r#"{"rotate":false,"another":1}"#), off);
        let at_three = Remembered {
            last: Some(3),
            rotate: true,
        };
        assert_eq!(read(r#"{"last":3}"#), at_three);
        std::fs::remove_dir_all(&folder).unwrap();
    }

    /// The bytes of a mark's PNG file, from where the app is built.
    fn family_file(name: &str, extension: &str) -> Vec<u8> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("icons/family")
            .join(format!("{name}.{extension}"));
        std::fs::read(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
    }

    #[test]
    fn every_mark_has_its_png_and_its_master_and_the_family_has_no_other_file() {
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/family");
        // A file a system adds to a folder, such as macOS's .DS_Store, is none of the family's.
        let mut found: Vec<String> = std::fs::read_dir(&folder)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| !name.starts_with('.'))
            .collect();
        found.sort();
        let mut expected: Vec<String> = MARKS
            .iter()
            .flat_map(|name| [format!("{name}.png"), format!("{name}.svg")])
            .collect();
        expected.sort();
        assert_eq!(found, expected);
    }

    #[test]
    fn every_mark_is_a_1024_pixel_png_with_clear_corners_and_a_solid_tile() {
        for name in MARKS {
            let png = family_file(name, "png");
            let image = tauri::image::Image::from_bytes(&png).unwrap();
            assert_eq!((image.width(), image.height()), (1024, 1024), "{name}");
            let alpha = |x: usize, y: usize| image.rgba()[(y * 1024 + x) * 4 + 3];
            // Outside the tile, the Dock shows what is behind it: a white square here would show.
            for (x, y) in [(0, 0), (1023, 0), (0, 1023), (1023, 1023), (60, 60)] {
                assert_eq!(alpha(x, y), 0, "{name}: ({x}, {y}) is not clear");
            }
            assert_eq!(alpha(512, 300), 255, "{name}: the tile is not solid");
        }
    }

    /// Where the files that Tauri bundles as resources on `target` land in the resources folder.
    /// The configuration is read as Tauri reads it, the platform's file (`tauri.macos.conf.json`)
    /// merged over `tauri.conf.json` as a JSON Merge Patch, which replaces a list with whatever the
    /// platform's file says `resources` is; and each source or pattern is expanded as the bundler
    /// expands it, relative to the folder the tests run in, which is the app's.
    fn bundled_resources(target: Target) -> Vec<PathBuf> {
        let folder = Path::new(env!("CARGO_MANIFEST_DIR"));
        let (config, _) = tauri::utils::config::parse::read_from(target, folder).unwrap();
        let config: Config = serde_json::from_value(config).unwrap();
        let targets = |resources: ResourcePathsIter| -> Vec<PathBuf> {
            resources
                .map(|resource| resource.unwrap().target().to_path_buf())
                .collect()
        };
        match config.bundle.resources.expect("the app bundles resources") {
            BundleResources::List(patterns) => targets(ResourcePaths::new(&patterns, true).iter()),
            BundleResources::Map(patterns) => {
                targets(ResourcePaths::from_map(&patterns, true).iter())
            }
        }
    }

    #[test]
    fn every_mark_is_bundled_as_a_resource_on_every_platform_where_the_app_looks_for_it() {
        for target in [Target::MacOS, Target::Windows, Target::Linux] {
            let bundled = bundled_resources(target);
            for name in MARKS {
                let wanted = PathBuf::from(format!("icons/family/{name}.png"));
                assert!(
                    bundled.contains(&wanted),
                    "{target:?} doesn't bundle {wanted:?}, only {bundled:?}"
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_system_reads_every_mark() {
        for name in MARKS {
            let image = macos::image_from_png(&family_file(name, "png"));
            assert!(image.is_ok(), "{name}: {:?}", image.err());
        }
        assert!(macos::image_from_png(b"not a png").is_err());
    }
}
