//! Installing from a disk image on a Mac: finding out whether the app runs from one, asking,
//! copying the app with `ditto`, opening the copy with `open`, and ejecting the image with
//! `hdiutil`.

use std::ffi::{CStr, CString, OsStr, OsString, c_void};
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use core_foundation::base::{CFOptionFlags, CFType, TCFType, kCFAllocatorDefault};
use core_foundation::dictionary::CFDictionary;
use core_foundation::error::CFErrorRef;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::{CFURL, CFURLRef};
use core_foundation_sys::base::{CFRelease, CFTypeRef};
use core_foundation_sys::user_notification::{
    CFUserNotificationCancel, CFUserNotificationCreate, CFUserNotificationReceiveResponse,
    CFUserNotificationRef, kCFUserNotificationAlertHeaderKey, kCFUserNotificationAlertMessageKey,
    kCFUserNotificationAlternateButtonTitleKey, kCFUserNotificationDefaultButtonTitleKey,
    kCFUserNotificationDefaultResponse, kCFUserNotificationIconURLKey,
    kCFUserNotificationPlainAlertLevel,
};
use objc2::rc::{Retained, autoreleasepool};
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSView, NSWindowButton};
use objc2_foundation::NSString;
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use super::{
    Handoff, InstallAnswer, Installed, Notice, OnImage, QUESTION, QUESTION_WINDOW, QUIT_FIRST,
    QUIT_FIRST_EVENT, RunningApp, SYSTEM_APPLICATIONS, Target, bundle_icon, bundle_of, copy_error,
    copy_failed, eject, holds_app, image_mount_points, install_target, leftover_copies,
    may_be_on_image, on_image, open_failed, output_within, put_in_place, running_copies,
    still_open, take_handoff, wait_for_exit,
};

/// The Security framework, where App Translocation lives.
const SECURITY: &CStr = c"/System/Library/Frameworks/Security.framework/Security";

// Security/SecTranslocate.h, macOS 10.12 and later. Neither is in the public headers.
type IsTranslocated =
    unsafe extern "C" fn(path: CFURLRef, is_translocated: *mut bool, error: *mut CFErrorRef) -> u8;
type CreateOriginalPath =
    unsafe extern "C" fn(translocated_path: CFURLRef, error: *mut CFErrorRef) -> CFURLRef;

/// The two functions of App Translocation that the app uses, looked up when the app runs rather
/// than linked: they aren't public, so a macOS that lacks or renames one must not stop the app
/// from launching.
struct Translocation {
    is_translocated: IsTranslocated,
    create_original_path: CreateOriginalPath,
}

impl Translocation {
    /// Finds both functions with `symbol`, which looks a name up (`dlsym`) and gives a null pointer
    /// for one it doesn't find. None unless both are there.
    fn find(symbol: impl Fn(&CStr) -> *mut c_void) -> Option<Self> {
        let is_translocated = symbol(c"SecTranslocateIsTranslocatedURL");
        let create_original_path = symbol(c"SecTranslocateCreateOriginalPathForURL");
        if is_translocated.is_null() || create_original_path.is_null() {
            return None;
        }
        // SAFETY: the two symbols have these signatures in Security/SecTranslocate.h, and a
        // function pointer is the size of a data pointer on every Mac.
        unsafe {
            Some(Translocation {
                is_translocated: std::mem::transmute::<*mut c_void, IsTranslocated>(
                    is_translocated,
                ),
                create_original_path: std::mem::transmute::<*mut c_void, CreateOriginalPath>(
                    create_original_path,
                ),
            })
        }
    }

    /// Looks the functions up in the Security framework, once.
    fn in_security_framework() -> Option<&'static Translocation> {
        static FOUND: OnceLock<Option<Translocation>> = OnceLock::new();
        FOUND
            .get_or_init(|| {
                // SAFETY: a NUL-terminated path. The library stays loaded for good.
                let library = unsafe { libc::dlopen(SECURITY.as_ptr(), libc::RTLD_LAZY) };
                if library.is_null() {
                    return None;
                }
                // SAFETY: `library` is a handle from `dlopen`, and the name is NUL-terminated.
                Translocation::find(|name| unsafe { libc::dlsym(library, name.as_ptr()) })
            })
            .as_ref()
    }

    /// Where the app at `bundle` really is, if the system runs it translocated.
    fn original(&self, bundle: &Path) -> Option<PathBuf> {
        let url = CFURL::from_path(bundle, true)?;
        let mut translocated = false;
        // SAFETY: `url` is a valid CFURL for the call, the flag is a valid bool, and the error is
        // optional.
        let known = unsafe {
            (self.is_translocated)(
                url.as_concrete_TypeRef(),
                &mut translocated,
                std::ptr::null_mut(),
            )
        };
        if known == 0 || !translocated {
            return None;
        }
        // SAFETY: as above. The URL it returns, if any, is the caller's to release (the Create
        // rule).
        let original =
            unsafe { (self.create_original_path)(url.as_concrete_TypeRef(), std::ptr::null_mut()) };
        if original.is_null() {
            return None;
        }
        // SAFETY: `original` is a CFURL that this code owns, released when the wrapper drops.
        unsafe { CFURL::wrap_under_create_rule(original) }.to_path()
    }
}

/// Where a translocated app really is. macOS runs an app from a downloaded disk image from a
/// randomized read-only folder (App Translocation); this is `None` for an app it runs in place.
///
/// It is also `None` when this macOS lacks the functions that tell (see `Translocation`): the app
/// then takes itself for an app that isn't translocated. What that costs: no install offer for a
/// translocated app (its folder is not under `/Volumes`, so the app doesn't look for an image), and
/// the update facts (updates.rs) call it not writable instead of on a disk image. It launches in
/// any case.
pub(crate) fn translocated_original(bundle: &Path) -> Option<PathBuf> {
    Translocation::in_security_framework()?.original(bundle)
}

/// How long `hdiutil` may take to list the attached images before the app gives up on it, and
/// opens as if it weren't on one. It answers in milliseconds.
const HDIUTIL_TIMEOUT: Duration = Duration::from_secs(2);

/// The folders where the attached disk images are mounted, as `hdiutil` lists them; none if it
/// fails or stalls.
fn attached_image_mount_points() -> Vec<PathBuf> {
    let mut list = Command::new("/usr/bin/hdiutil");
    list.args(["info", "-plist"]);
    let listed = output_within(&mut list, HDIUTIL_TIMEOUT)
        .map_err(|error| error.to_string())
        .and_then(|printed| image_mount_points(&printed).map_err(|error| error.to_string()));
    listed.unwrap_or_else(|error| {
        eprintln!("Redlines can't list the attached disk images: {error}");
        Vec::new()
    })
}

/// The app bundle this process runs from, if it runs from one.
pub(crate) fn running_bundle() -> Option<PathBuf> {
    let executable = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .ok()?;
    bundle_of(&executable).map(Path::to_path_buf)
}

/// Whether this process may write `path`.
pub(crate) fn writable(path: &Path) -> bool {
    let Ok(path) = CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: `path` is a NUL-terminated string that outlives the call.
    unsafe { libc::access(path.as_ptr(), libc::W_OK) == 0 }
}

/// Which Applications folders have the app already, and whether the one in /Applications can be
/// replaced.
fn installed(home: &Path, bundle_name: &OsStr) -> Installed {
    let in_system = Path::new(SYSTEM_APPLICATIONS).join(bundle_name);
    Installed {
        in_home: home
            .join("Applications")
            .join(bundle_name)
            .symlink_metadata()
            .is_ok(),
        in_system: in_system.symlink_metadata().is_ok(),
        system_replaceable: writable(Path::new(SYSTEM_APPLICATIONS)) && writable(&in_system),
    }
}

/// What the app at `bundle` says in its `Info.plist`.
fn info_plist(bundle: &Path) -> Option<Vec<u8>> {
    std::fs::read(bundle.join("Contents/Info.plist")).ok()
}

/// The app's icon file, to show in the alerts.
fn icon_of(bundle: &Path) -> Option<PathBuf> {
    let icon = bundle
        .join("Contents/Resources")
        .join(bundle_icon(&info_plist(bundle)?)?);
    icon.is_file().then_some(icon)
}

/// An alert of the system's that is on screen.
struct Showing(CFUserNotificationRef);

// SAFETY: a CFUserNotification is a Core Foundation object, which any thread may use.
unsafe impl Send for Showing {}

/// The alert on screen, kept so that quitting can take it away: the system goes on showing an
/// alert after the app that asked has quit.
static SHOWING: Mutex<Option<Showing>> = Mutex::new(None);

fn showing() -> MutexGuard<'static, Option<Showing>> {
    SHOWING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Asks in an alert of the system's, with the app's icon. Unlike an alert of the app's, it needs no
/// window; it waits on the calling thread, which must not be the main thread, while the app runs
/// on. Says whether the person chose `default`; `alternate`, if given, is the other button. An
/// alert without a message is its title alone.
fn alert(
    icon: Option<&Path>,
    title: &str,
    message: Option<&str>,
    default: &str,
    alternate: Option<&str>,
) -> bool {
    // SAFETY: the keys are constant strings that Core Foundation defines, and live for good.
    let key = |key: CFStringRef| unsafe { CFString::wrap_under_get_rule(key) };
    let text = |text: &str| CFString::new(text).as_CFType();
    // SAFETY (for the keys): reading Core Foundation's constants.
    let mut pairs: Vec<(CFString, CFType)> = unsafe {
        vec![
            (key(kCFUserNotificationAlertHeaderKey), text(title)),
            (key(kCFUserNotificationDefaultButtonTitleKey), text(default)),
        ]
    };
    if let Some(message) = message {
        // SAFETY: as above.
        pairs.push((
            key(unsafe { kCFUserNotificationAlertMessageKey }),
            text(message),
        ));
    }
    if let Some(alternate) = alternate {
        // SAFETY: as above.
        pairs.push((
            key(unsafe { kCFUserNotificationAlternateButtonTitleKey }),
            text(alternate),
        ));
    }
    if let Some(url) = icon.and_then(|icon| CFURL::from_path(icon, false)) {
        // SAFETY: as above.
        pairs.push((
            key(unsafe { kCFUserNotificationIconURLKey }),
            url.as_CFType(),
        ));
    }
    let description = CFDictionary::from_CFType_pairs(&pairs);
    let mut error = 0;
    // SAFETY: the description is valid for the call. The notification, if any, is this code's to
    // release (the Create rule). No timeout: it waits for the person.
    let notification = unsafe {
        CFUserNotificationCreate(
            kCFAllocatorDefault,
            0.0,
            kCFUserNotificationPlainAlertLevel,
            &mut error,
            description.as_concrete_TypeRef(),
        )
    };
    if notification.is_null() {
        eprintln!("Redlines can't show an alert (error {error}): {title}");
        return false;
    }
    showing().replace(Showing(notification));
    let mut response: CFOptionFlags = 0;
    // SAFETY: `notification` is valid until it is released below.
    let received = unsafe { CFUserNotificationReceiveResponse(notification, 0.0, &mut response) };
    showing().take();
    // SAFETY: created above, and no longer shared: `dismiss_alert` cancels only while it holds the
    // lock, which `take` waited for.
    unsafe { CFRelease(notification as CFTypeRef) };
    // The low two bits say which button.
    received == 0 && response & 0b11 == kCFUserNotificationDefaultResponse
}

/// Takes away the alert on screen, if there is one. The app calls this as it quits.
pub fn dismiss_alert() {
    let mut showing = showing();
    if let Some(alert) = showing.take() {
        // SAFETY: the asking thread releases the notification only after it gets this lock back.
        unsafe { CFUserNotificationCancel(alert.0) };
    }
}

/// Runs `command`, and turns a failure into an error that says what went wrong.
fn run(command: &mut Command) -> io::Result<()> {
    let output = command.output()?;
    if output.status.success() {
        return Ok(());
    }
    let said = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(io::Error::other(if said.is_empty() {
        format!("{} ({})", command.get_program().display(), output.status)
    } else {
        said
    }))
}

/// Copies the app at `from` to `to` with `ditto`, which keeps what a plain copy can lose, such as
/// the code signature and extended attributes, and then takes the copy out of the quarantine that
/// the files of a downloaded disk image carry. macOS checked the app when it opened from the
/// image; a copy still in quarantine would be checked and asked about again, and run translocated,
/// from a read-only folder of the system's, where it could never update itself (updates.rs).
fn copy_bundle(from: &Path, to: &Path) -> io::Result<()> {
    run(Command::new("/usr/bin/ditto").arg(from).arg(to))?;
    let release = run(Command::new("/usr/bin/xattr")
        .args(["-d", "-r", "-s", "com.apple.quarantine"])
        .arg(to));
    if let Err(error) = release {
        // The copy runs in quarantine too.
        eprintln!("Redlines can't take its copy out of quarantine: {error}");
    }
    Ok(())
}

/// Copies the app from the image to `target`.
fn copy_app(on_image: &OnImage, target: &Target) -> io::Result<()> {
    put_in_place(&target.path, std::process::id(), |copy| {
        copy_bundle(&on_image.bundle, copy).map_err(|error| {
            let said = error.to_string();
            eprintln!("Redlines can't copy itself: {said}");
            io::Error::other(copy_error(&said).to_owned())
        })
    })
}

/// The files the window hasn't taken yet, to hand to the installed copy.
fn waiting_files(app: &AppHandle) -> Vec<OsString> {
    let opened = app.state::<crate::Opened>();
    let waiting = opened
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    waiting
        .iter()
        .map(|file| OsString::from(&file.path))
        .collect()
}

/// The running copies of the app with the identifier `identifier` that are at `target`. Looked up
/// by bundle identifier, then by where each one is. This process is not one of them: it runs from
/// the disk image.
fn copies_at(target: &Path, identifier: &str) -> Vec<Retained<NSRunningApplication>> {
    // Polled while waiting for a quit, from a thread that has no pool of its own.
    autoreleasepool(|_| {
        let identifier = NSString::from_str(identifier);
        let apps: Vec<Retained<NSRunningApplication>> =
            NSRunningApplication::runningApplicationsWithBundleIdentifier(&identifier)
                .iter()
                .collect();
        // Process ids need an objc2 feature that nothing else enables, and are no use here, so a
        // position in the list stands in for one.
        let listed: Vec<RunningApp> = apps
            .iter()
            .enumerate()
            .filter_map(|(position, app)| {
                let path = app.bundleURL()?.path()?;
                Some(RunningApp {
                    pid: u32::try_from(position).ok()?,
                    bundle: PathBuf::from(path.to_string()),
                })
            })
            .collect();
        let found: Vec<usize> = running_copies(target, &listed, u32::MAX)
            .iter()
            .map(|app| app.pid as usize)
            .collect();
        apps.into_iter()
            .enumerate()
            .filter(|(position, _)| found.contains(position))
            .map(|(_, app)| app)
            .collect()
    })
}

/// How long a copy that was asked to quit may take: it may ask about unsaved edits first.
const QUIT_TIMEOUT: Duration = Duration::from_secs(60);

/// Asks the copies of the app at `target` to quit, as the app's Quit menu item does, and waits for
/// them. Says whether they are gone. A copy that doesn't quit, because the person has a document
/// to save or says Cancel, is left running; nothing is ever forced. The copy comes to the front
/// first, so that a question about unsaved changes is seen.
fn quit_running(target: &Path, identifier: &str) -> bool {
    for app in copies_at(target, identifier) {
        app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
        app.terminate();
    }
    let pause = Duration::from_millis(200);
    let polls = u32::try_from(QUIT_TIMEOUT.as_millis() / pause.as_millis()).unwrap_or(u32::MAX);
    // `wait_for_exit` asks about one process; here it is about the copies at `target`.
    wait_for_exit(
        0,
        polls,
        |_| !copies_at(target, identifier).is_empty(),
        || std::thread::sleep(pause),
    )
}

/// What the app needs to act on the answer.
struct Asked {
    home: PathBuf,
    icon: Option<PathBuf>,
    on_image: OnImage,
    target: Target,
    /// The app's identifier, which its other running copies have too.
    identifier: String,
    /// The window that asked, if a window asked. It stays open while the app copies itself, and
    /// goes once the app either quits or keeps running from the image.
    question: Option<WebviewWindow>,
}

impl Asked {
    fn close_question(&self) {
        if let Some(window) = &self.question {
            let _ = window.destroy();
        }
    }
}

/// Tells the person what went wrong, in an alert of the system's, and waits until they have read
/// it.
fn tell(asked: &Asked, notice: Notice) {
    asked.close_question();
    eprintln!("{}: {}", notice.title, notice.message);
    alert(
        asked.icon.as_deref(),
        &notice.title,
        Some(&notice.message),
        "OK",
        None,
    );
}

/// Acts on the person's answer, away from the main thread: installs, opens the installed copy and
/// quits, or keeps running from the image and opens the window.
fn answered(app: &AppHandle, asked: Asked, install: bool) {
    if install {
        let (target, home) = (&asked.target, &asked.home);
        match copy_app(&asked.on_image, target) {
            Ok(()) => {
                let handoff = Handoff {
                    mount_point: asked.on_image.mount_point.clone(),
                    pid: std::process::id(),
                };
                let mut args = handoff.args();
                args.extend(waiting_files(app));
                let opened = run(Command::new("/usr/bin/open")
                    .arg("-n")
                    .arg(&target.path)
                    .arg("--args")
                    .args(args));
                match opened {
                    // The installed copy ejects the image once this process is gone.
                    Ok(()) => {
                        app.exit(0);
                        return;
                    }
                    Err(error) => tell(&asked, open_failed(target, home, &error.to_string())),
                }
            }
            Err(error) => tell(&asked, copy_failed(target, home, &error.to_string())),
        }
    }
    asked.close_question();
    show_window(app);
}

/// Opens the main window from a thread other than the main one, after the app has looked for a
/// disk image, and brings it to the front: the person may have answered in another window.
fn show_window(app: &AppHandle) {
    let opened = crate::windows::open_main_window(app);
    ASKING.store(false, Ordering::SeqCst);
    match opened {
        Ok(window) => {
            let _ = window.set_focus();
        }
        Err(error) => {
            eprintln!("Redlines can't open its window: {error}");
            app.exit(1);
        }
    }
}

/// Set while the install question has the app's windows, from opening its window until the app's
/// own window opens.
static ASKING: AtomicBool = AtomicBool::new(false);

/// Whether the app must keep running when its last window closes: while it asks, the question's
/// window is its only one, and the app's own window opens after it closes.
pub fn asking() -> bool {
    ASKING.load(Ordering::SeqCst)
}

/// The environment variables that answer the questions in a debug build (`answer_for_check`).
const INSTALL_ANSWER: &str = "REDLINES_INSTALL_ANSWER";
const QUIT_ANSWER: &str = "REDLINES_QUIT_ANSWER";

/// For an unattended check of a debug build, the environment variable `variable` answers the
/// question in its window as a person would, once the page has shown it (and `after` has passed):
/// `install` or `not-now` presses that button, `return` or `escape` that key, and `close` closes
/// the window. `REDLINES_INSTALL_ANSWER` answers the install question, `REDLINES_QUIT_ANSWER` the
/// second one, whether to quit an open Redlines first, and nothing else does: a check never quits
/// a Redlines that someone is using by itself.
#[cfg(debug_assertions)]
fn answer_for_check(window: &WebviewWindow, variable: &str, after: Duration) {
    let Ok(answer) = std::env::var(variable) else {
        return;
    };
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(after);
        for _ in 0..100 {
            if window.is_visible().unwrap_or(false) {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let script = match answer.as_str() {
            "install" => "document.querySelector('.rl-question-install').click()",
            "not-now" => "document.querySelector('.rl-question-not-now').click()",
            "return" => "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))",
            "escape" => "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))",
            "close" => {
                let _ = window.close();
                return;
            }
            _ => return,
        };
        let _ = window.eval(script);
    });
}

/// A release build has no such switch: the person answers.
#[cfg(not(debug_assertions))]
fn answer_for_check(_window: &WebviewWindow, _variable: &str, _after: Duration) {}

/// Hides the window's close, minimize and zoom buttons. The question is answered by its own two
/// buttons, Return and Escape, so the window has no use for them; and hiding them, rather than
/// taking the title bar away, keeps what a window without one lacks: the rounded corners, the
/// shadow and the title that VoiceOver reads and the Window menu lists. The window is still
/// hidden when this runs, so no one sees the buttons go.
fn hide_window_buttons(window: &WebviewWindow) {
    let window_to_change = window.clone();
    // AppKit's windows are for the main thread alone.
    let _ = window.run_on_main_thread(move || {
        let Ok(view) = window_to_change.ns_view() else {
            return;
        };
        // SAFETY: Tauri says this is the window's content view, which stays for as long as the
        // window does, and this is the main thread.
        let view = unsafe { &*view.cast::<NSView>() };
        let Some(window) = view.window() else {
            return;
        };
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = window.standardWindowButton(kind) {
                button.setHidden(true);
            }
        }
    });
}

/// Asks in the question's own window (`install.html`, centered, its icon, line and buttons
/// centered too), which the app opens hidden and the page shows once it is styled. Returns the
/// answer and the window, or nothing when the window can't be opened.
fn ask_in_window(app: &AppHandle) -> Option<(bool, WebviewWindow)> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == QUESTION_WINDOW)?;
    let answer = app.state::<InstallAnswer>().expect();
    ASKING.store(true, Ordering::SeqCst);
    let window = WebviewWindowBuilder::from_config(app, config)
        .and_then(|builder| builder.build())
        .map_err(|error| eprintln!("Redlines can't open the install question: {error}"))
        .ok()?;
    hide_window_buttons(&window);
    // Closing the window is Not Now.
    let closing = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            closing.state::<InstallAnswer>().give(false);
        }
    });
    // Should the page never show it, the window shows itself, rather than leave the app waiting
    // with nothing on screen.
    let late = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        if late.is_visible().is_ok_and(|visible| !visible) {
            let _ = late.show();
        }
    });
    answer_for_check(&window, INSTALL_ANSWER, Duration::ZERO);
    let install = answer.recv().unwrap_or(false);
    Some((install, window))
}

/// Asks, once the person has said Install and the Redlines that would be replaced is open, whether
/// to quit it first: in the question's window, which changes to ask it, or in an alert where there
/// is no window. Says whether the person said yes.
fn ask_to_quit(app: &AppHandle, asked: &Asked) -> bool {
    let Some(window) = &asked.question else {
        return alert(
            asked.icon.as_deref(),
            QUIT_FIRST.title,
            None,
            QUIT_FIRST.install,
            Some(QUIT_FIRST.not_now),
        );
    };
    let answer = app.state::<InstallAnswer>().expect();
    // A window that can't be reached can't answer: don't wait for it.
    let sent = window.eval(format!(
        "document.dispatchEvent(new CustomEvent('{QUIT_FIRST_EVENT}'))"
    ));
    if sent.is_err() {
        return false;
    }
    answer_for_check(window, QUIT_ANSWER, Duration::from_millis(300));
    answer.recv().unwrap_or(false)
}

/// Makes room for the copy to be installed: if the Redlines it would replace is open, asks to quit
/// it, and quits it only if the person agrees. Says whether the install may go on.
fn make_room(app: &AppHandle, asked: &Asked) -> bool {
    let target = &asked.target;
    if !target.replaces || copies_at(&target.path, &asked.identifier).is_empty() {
        return true;
    }
    if !ask_to_quit(app, asked) {
        return false;
    }
    if quit_running(&target.path, &asked.identifier) {
        return true;
    }
    tell(asked, still_open(target, &asked.home));
    false
}

/// Asks whether to install the app from the image it runs from, and acts on the answer.
fn ask(app: &AppHandle, on_image: OnImage) {
    let bundle_name = on_image.bundle.file_name().map(OsStr::to_os_string);
    let (Ok(home), Some(bundle_name)) = (app.path().home_dir(), bundle_name) else {
        return show_window(app);
    };
    let target = install_target(&home, &bundle_name, installed(&home, &bundle_name));
    let mut asked = Asked {
        home,
        identifier: app.config().identifier.clone(),
        icon: icon_of(&on_image.bundle),
        on_image,
        target,
        question: None,
    };
    let install = match ask_in_window(app) {
        Some((install, window)) => {
            asked.question = Some(window);
            install
        }
        // Where the window can't be shown, an alert of the system's asks.
        None => alert(
            asked.icon.as_deref(),
            QUESTION.title,
            None,
            QUESTION.install,
            Some(QUESTION.not_now),
        ),
    };
    let install = install && make_room(app, &asked);
    answered(app, asked, install);
}

/// Offers to install the app when it may be running from a disk image, before the main window
/// opens. Says whether it took the window over: it then looks for the image on a thread of its
/// own, so that `hdiutil` never holds up the main thread, asks if the app runs from one, and opens
/// the window unless the app installs itself and quits.
pub fn offer_install(app: &AppHandle) -> bool {
    let Some(bundle) = running_bundle() else {
        return false;
    };
    let original = translocated_original(&bundle);
    // Most launches are from an Applications folder, where there is no image to look for.
    if !may_be_on_image(&bundle, original.as_deref()) {
        return false;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        match on_image(&bundle, original.as_deref(), &attached_image_mount_points()) {
            Some(on_image) => ask(&app, on_image),
            None => show_window(&app),
        }
    });
    true
}

/// Whether the process `pid` is running.
fn process_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 sends nothing; it only asks whether the process exists.
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Waits for the copy on the image to quit, then ejects the image, unless it is gone already or
/// doesn't hold this app (`bundle_name`, `identifier`). An image that stays in use, say because a
/// Terminal window is in it, stays mounted.
fn eject_when_gone(handoff: &Handoff, bundle_name: &OsStr, identifier: &str) {
    let pause = || std::thread::sleep(Duration::from_millis(100));
    if !wait_for_exit(handoff.pid, 300, process_alive, pause) {
        eprintln!(
            "Redlines leaves the disk image at {} mounted: the copy that installed it, process {}, \
             is still running",
            handoff.mount_point.display(),
            handoff.pid
        );
        return;
    }
    // The person may have ejected it already.
    if !attached_image_mount_points().contains(&handoff.mount_point) {
        return;
    }
    // A handoff only ever ejects the image that this app was installed from, not another image
    // that the arguments name.
    if !holds_app(&handoff.mount_point, bundle_name, identifier) {
        eprintln!(
            "Redlines leaves the disk image at {} mounted: it doesn't hold {}",
            handoff.mount_point.display(),
            bundle_name.display()
        );
        return;
    }
    let detach = || {
        run(Command::new("/usr/bin/hdiutil")
            .arg("detach")
            .arg(&handoff.mount_point))
        .is_ok()
    };
    if !eject(6, detach, || std::thread::sleep(Duration::from_secs(1))) {
        eprintln!(
            "Redlines leaves the disk image at {} mounted: it is in use",
            handoff.mount_point.display()
        );
    }
}

/// Removes what an install that stopped halfway left in the Applications folders the app installs
/// into: `.Redlines.app-copying-<process id>`, exactly, and only when that process is gone. Any
/// other file is left alone, and so is a folder that is a link.
fn remove_leftover_copies(folders: &[PathBuf], bundle_name: &OsStr) {
    for folder in folders {
        let Ok(entries) = std::fs::read_dir(folder) else {
            continue;
        };
        let names = entries.filter_map(|entry| Some(entry.ok()?.file_name()));
        for name in leftover_copies(names, bundle_name, process_alive) {
            let path = folder.join(&name);
            // A folder, not a link to one: only what `put_in_place` makes.
            if !path.symlink_metadata().is_ok_and(|found| found.is_dir()) {
                continue;
            }
            match std::fs::remove_dir_all(&path) {
                Ok(()) => eprintln!(
                    "Redlines removed {}, left by an install that stopped",
                    path.display()
                ),
                Err(error) => eprintln!("Redlines can't remove {}: {error}", path.display()),
            }
        }
    }
}

/// Clears away what a crashed install left behind, on a thread of its own so that a slow folder
/// never holds up the launch. The folders are the two the app installs into.
pub fn clean_up_after_crashed_install(app: &AppHandle) {
    let Some(bundle_name) =
        running_bundle().and_then(|bundle| bundle.file_name().map(OsStr::to_os_string))
    else {
        return;
    };
    let mut folders = vec![PathBuf::from(SYSTEM_APPLICATIONS)];
    folders.extend(
        app.path()
            .home_dir()
            .ok()
            .map(|home| home.join("Applications")),
    );
    std::thread::spawn(move || remove_leftover_copies(&folders, &bundle_name));
}

/// Starts ejecting the disk image the app was installed from, when it was started for that, and
/// returns the other command line arguments.
pub fn eject_after_handoff(
    app: &AppHandle,
    args: impl IntoIterator<Item = OsString>,
) -> Vec<OsString> {
    let (handoff, rest) = take_handoff(args);
    // The image must hold an app of this name and identifier, the one this copy was made from.
    let bundle_name =
        running_bundle().and_then(|bundle| bundle.file_name().map(OsStr::to_os_string));
    if let (Some(handoff), Some(bundle_name)) = (handoff, bundle_name) {
        let identifier = app.config().identifier.clone();
        std::thread::spawn(move || eject_when_gone(&handoff, &bundle_name, &identifier));
    }
    rest
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Whether `path` is in quarantine, as the files of a downloaded disk image are.
    fn quarantined(path: &Path) -> bool {
        Command::new("/usr/bin/xattr")
            .args(["-p", "com.apple.quarantine"])
            .arg(path)
            .output()
            .is_ok_and(|output| output.status.success())
    }

    #[test]
    fn the_installed_copy_leaves_the_quarantine_behind() {
        let folder =
            std::env::temp_dir().join(format!("redlines-copy-command-{}", std::process::id()));
        let (from, to) = (folder.join("Redlines.app"), folder.join("copy"));
        let plist = Path::new("Contents/Info.plist");
        std::fs::create_dir_all(from.join("Contents")).unwrap();
        std::fs::write(from.join(plist), "<plist/>").unwrap();
        for path in [from.clone(), from.join(plist)] {
            run(Command::new("/usr/bin/xattr")
                .args(["-w", "com.apple.quarantine", "0083;6740a1b2;Safari;"])
                .arg(&path))
            .unwrap();
            assert!(quarantined(&path));
        }

        copy_bundle(&from, &to).unwrap();
        assert_eq!(std::fs::read_to_string(to.join(plist)).unwrap(), "<plist/>");
        assert!(!quarantined(&to));
        assert!(!quarantined(&to.join(plist)));
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn translocation_is_not_found_when_the_system_lacks_a_function() {
        // Nothing found.
        assert!(Translocation::find(|_| std::ptr::null_mut()).is_none());
        // One of the two found: still none, rather than half of what is needed.
        let only_first = |name: &CStr| {
            if name == c"SecTranslocateIsTranslocatedURL" {
                std::ptr::dangling_mut::<c_void>()
            } else {
                std::ptr::null_mut()
            }
        };
        assert!(Translocation::find(only_first).is_none());
        let only_second = |name: &CStr| {
            if name == c"SecTranslocateCreateOriginalPathForURL" {
                std::ptr::dangling_mut::<c_void>()
            } else {
                std::ptr::null_mut()
            }
        };
        assert!(Translocation::find(only_second).is_none());
        // Both found (stand-in addresses, which are never called).
        assert!(Translocation::find(|_| std::ptr::dangling_mut::<c_void>()).is_some());
    }

    #[test]
    fn an_app_that_is_not_translocated_is_found_where_it_is() {
        // This macOS has the functions; a folder that is not translocated has no other place.
        assert!(Translocation::in_security_framework().is_some());
        assert_eq!(translocated_original(Path::new("/Applications")), None);
        assert_eq!(
            translocated_original(Path::new("/no/such/Redlines.app")),
            None
        );
    }

    #[test]
    fn looking_up_running_copies_finds_none_for_an_identifier_nobody_has() {
        let nowhere = Path::new("/no/such/Redlines.app");
        assert!(copies_at(nowhere, "md.redlines.no-such-app-for-a-test").is_empty());
        // The system's own app, which runs in a login session, is not at that path either.
        assert!(copies_at(nowhere, "com.apple.finder").is_empty());
    }

    #[test]
    fn leftovers_are_removed_only_in_the_given_folders_and_only_for_gone_processes() {
        let folder =
            std::env::temp_dir().join(format!("redlines-leftovers-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        let (applications, elsewhere) = (folder.join("Applications"), folder.join("Elsewhere"));
        // Process ids above what macOS hands out (99999 at most), so none of them runs.
        let gone = 2_000_001;
        assert!(!process_alive(gone) && !process_alive(gone + 1) && !process_alive(gone + 2));
        let name = |pid: u32| format!(".Redlines.app-copying-{pid}");
        let mine = std::process::id();
        for dir in [&applications, &elsewhere] {
            std::fs::create_dir_all(dir.join(name(gone)).join("Contents")).unwrap();
        }
        std::fs::create_dir_all(applications.join(name(mine))).unwrap();
        std::fs::create_dir_all(applications.join("Redlines.app")).unwrap();
        std::fs::create_dir_all(applications.join(".Redlines.app-replaced-1234")).unwrap();
        std::fs::write(applications.join(name(gone + 1)), "a file, not a folder").unwrap();

        // A link named like a leftover, to a folder with something in it: neither is touched.
        let precious = folder.join("Precious");
        std::fs::create_dir_all(&precious).unwrap();
        std::fs::write(precious.join("keep"), "mine").unwrap();
        std::os::unix::fs::symlink(&precious, applications.join(name(gone + 2))).unwrap();

        remove_leftover_copies(
            std::slice::from_ref(&applications),
            OsStr::new("Redlines.app"),
        );

        assert!(!applications.join(name(gone)).exists());
        assert!(applications.join(name(mine)).exists());
        assert!(applications.join("Redlines.app").exists());
        assert!(applications.join(".Redlines.app-replaced-1234").exists());
        assert!(applications.join(name(gone + 1)).exists());
        assert!(applications.join(name(gone + 2)).symlink_metadata().is_ok());
        assert_eq!(
            std::fs::read_to_string(precious.join("keep")).unwrap(),
            "mine"
        );
        // A folder the app doesn't install into is not touched.
        assert!(elsewhere.join(name(gone)).exists());
        // A folder that is not there is no trouble.
        remove_leftover_copies(&[folder.join("Nowhere")], OsStr::new("Redlines.app"));
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
