//! Installing from a disk image on a Mac: finding out whether the app runs from one, asking,
//! copying the app with `ditto`, opening the copy with `open`, and ejecting the image with
//! `hdiutil`.

use std::ffi::{CString, OsStr, OsString};
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
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
use objc2_app_kit::{NSView, NSWindowButton};
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use super::{
    Handoff, InstallAnswer, Installed, Notice, OnImage, QUESTION, QUESTION_WINDOW,
    SYSTEM_APPLICATIONS, Target, bundle_icon, bundle_of, copy_error, copy_failed, eject, holds_app,
    image_mount_points, install_target, may_be_on_image, on_image, open_failed, output_within,
    put_in_place, take_handoff, wait_for_exit,
};

#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    // Security/SecTranslocate.h, macOS 10.12 and later.
    fn SecTranslocateIsTranslocatedURL(
        path: CFURLRef,
        is_translocated: *mut bool,
        error: *mut CFErrorRef,
    ) -> u8;
    fn SecTranslocateCreateOriginalPathForURL(
        translocated_path: CFURLRef,
        error: *mut CFErrorRef,
    ) -> CFURLRef;
}

/// Where a translocated app really is. macOS runs an app from a downloaded disk image from a
/// randomized read-only folder (App Translocation); this is `None` for an app it runs in place.
pub(crate) fn translocated_original(bundle: &Path) -> Option<PathBuf> {
    let url = CFURL::from_path(bundle, true)?;
    let mut translocated = false;
    // SAFETY: `url` is a valid CFURL for the call, the flag is a valid bool, and the error is
    // optional.
    let known = unsafe {
        SecTranslocateIsTranslocatedURL(
            url.as_concrete_TypeRef(),
            &mut translocated,
            std::ptr::null_mut(),
        )
    };
    if known == 0 || !translocated {
        return None;
    }
    // SAFETY: as above. The URL it returns, if any, is the caller's to release (the Create rule).
    let original = unsafe {
        SecTranslocateCreateOriginalPathForURL(url.as_concrete_TypeRef(), std::ptr::null_mut())
    };
    if original.is_null() {
        return None;
    }
    // SAFETY: `original` is a CFURL that this code owns, released when the wrapper drops.
    unsafe { CFURL::wrap_under_create_rule(original) }.to_path()
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

/// Copies the app from the image to `target`. `ditto` keeps what a plain copy can lose, such as
/// the code signature and extended attributes.
fn copy_app(on_image: &OnImage, target: &Target) -> io::Result<()> {
    put_in_place(&target.path, std::process::id(), |copy| {
        run(Command::new("/usr/bin/ditto")
            .arg(&on_image.bundle)
            .arg(copy))
        .map_err(|error| {
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

/// What the app needs to act on the answer.
struct Asked {
    home: PathBuf,
    icon: Option<PathBuf>,
    on_image: OnImage,
    target: Target,
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
    let opened = crate::open_main_window(app);
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

/// For an unattended check of a debug build, `REDLINES_INSTALL_ANSWER` answers the question in its
/// window as a person would, once the page has shown it: `install` or `not-now` presses that
/// button, `return` or `escape` that key, and `close` closes the window.
#[cfg(debug_assertions)]
fn answer_for_check(window: &WebviewWindow) {
    let Ok(answer) = std::env::var("REDLINES_INSTALL_ANSWER") else {
        return;
    };
    let window = window.clone();
    std::thread::spawn(move || {
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
fn answer_for_check(_window: &WebviewWindow) {}

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
    answer_for_check(&window);
    let install = answer.recv().unwrap_or(false);
    Some((install, window))
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
