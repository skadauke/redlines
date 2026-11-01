//! Installing from a disk image on a Mac: finding out whether the app runs from one, asking,
//! copying the app with `ditto`, opening the copy with `open` and ejecting the image with `hdiutil`.

use std::ffi::{CString, OsStr, OsString};
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;
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
use tauri::{AppHandle, Manager};

use super::{
    Handoff, Installed, Notice, OnImage, SYSTEM_APPLICATIONS, Target, bundle_icon, bundle_of,
    bundle_version, copy_error, copy_failed, eject, image_mount_points, install_target, on_image,
    open_failed, put_in_place, question, take_handoff, wait_for_exit,
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
fn translocated_original(bundle: &Path) -> Option<PathBuf> {
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

/// The folders where the attached disk images are mounted, as `hdiutil` lists them.
fn attached_image_mount_points() -> Vec<PathBuf> {
    let listed = Command::new("/usr/bin/hdiutil")
        .args(["info", "-plist"])
        .output()
        .map_err(|error| error.to_string())
        .and_then(|output| image_mount_points(&output.stdout).map_err(|error| error.to_string()));
    listed.unwrap_or_else(|error| {
        eprintln!("Redlines can't list the attached disk images: {error}");
        Vec::new()
    })
}

/// Whether the app runs from a disk image, and from which.
fn running_from_image() -> Option<OnImage> {
    let executable = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .ok()?;
    let bundle = bundle_of(&executable)?;
    let original = translocated_original(bundle);
    on_image(bundle, original.as_deref(), &attached_image_mount_points())
}

/// Whether this process may write `path`.
fn writable(path: &Path) -> bool {
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
/// on. Says whether the person chose `default`; `alternate`, if given, is the other button.
fn alert(
    icon: Option<&Path>,
    title: &str,
    message: &str,
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
            (key(kCFUserNotificationAlertMessageKey), text(message)),
            (key(kCFUserNotificationDefaultButtonTitleKey), text(default)),
        ]
    };
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
}

/// Tells the person what went wrong, and waits until they have read it.
fn tell(asked: &Asked, notice: Notice) {
    eprintln!("{}: {}", notice.title, notice.message);
    alert(
        asked.icon.as_deref(),
        &notice.title,
        &notice.message,
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
    match crate::open_main_window(app) {
        // The person answered in an alert of the system's; bring the window to the front.
        Ok(window) => {
            let _ = window.set_focus();
        }
        Err(error) => {
            eprintln!("Redlines can't open its window: {error}");
            app.exit(1);
        }
    }
}

/// For an unattended check of a debug build, `REDLINES_INSTALL_ANSWER=install` or `not-now`
/// answers the question instead of the person. A release build has no such switch.
#[cfg(debug_assertions)]
fn preset_answer() -> Option<bool> {
    match std::env::var("REDLINES_INSTALL_ANSWER").ok()?.as_str() {
        "install" => Some(true),
        "not-now" => Some(false),
        _ => None,
    }
}

/// Offers to install the app when it runs from a disk image, before the main window opens. Says
/// whether it asked; the window then opens after the answer, if the app keeps running.
pub fn offer_install(app: &AppHandle) -> bool {
    let Some(on_image) = running_from_image() else {
        return false;
    };
    let (Ok(home), Some(bundle_name)) = (app.path().home_dir(), on_image.bundle.file_name()) else {
        return false;
    };
    let target = install_target(&home, bundle_name, installed(&home, bundle_name));
    let installed_version = target
        .replaces
        .then(|| bundle_version(&info_plist(&target.path)?))
        .flatten();
    let version = app.package_info().version.to_string();
    let question = question(&target, &home, installed_version.as_deref(), &version);
    let asked = Asked {
        home,
        icon: icon_of(&on_image.bundle),
        on_image,
        target,
    };
    let app = app.clone();
    std::thread::spawn(move || {
        #[cfg(debug_assertions)]
        let preset = preset_answer();
        #[cfg(not(debug_assertions))]
        let preset = None;
        let install = preset.unwrap_or_else(|| {
            alert(
                asked.icon.as_deref(),
                &question.title,
                &question.message,
                question.install,
                Some("Not Now"),
            )
        });
        answered(&app, asked, install);
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

/// Waits for the copy on the image to quit, then ejects the image, unless it is gone already. An
/// image that stays in use, say because a Terminal window is in it, stays mounted.
fn eject_when_gone(handoff: &Handoff) {
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
    // The person may have ejected it already; and a handoff only ever ejects a disk image.
    if !attached_image_mount_points().contains(&handoff.mount_point) {
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
pub fn eject_after_handoff(args: impl IntoIterator<Item = OsString>) -> Vec<OsString> {
    let (handoff, rest) = take_handoff(args);
    if let Some(handoff) = handoff {
        std::thread::spawn(move || eject_when_gone(&handoff));
    }
    rest
}
