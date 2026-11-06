//! The question the app puts to the person before an agent is added, changed or removed
//! (`acp.rs`): an alert of the system's, which no page can draw, read or answer. Its default button
//! is the refusal, so Return says no, and so does Escape; only a click on the yes says yes. What it
//! decides is behind `AcpAgents::add` and `remove`, which take the answer as a function, so the
//! tests answer it themselves.

use tauri::AppHandle;

use super::acp::Question;

/// What `NSAlert` answers for its first and second buttons, in the order they were added.
#[cfg(any(target_os = "macos", test))]
const FIRST_BUTTON: isize = 1000;
#[cfg(any(target_os = "macos", test))]
const SECOND_BUTTON: isize = 1001;

/// The buttons, in the order they are added: the first is the default, which Return presses.
#[cfg(any(target_os = "macos", test))]
fn buttons(question: &Question) -> [&'static str; 2] {
    [question.no, question.yes]
}

/// Whether the alert's answer is the yes: only its second button. The refusal, Escape and anything
/// else are no.
#[cfg(any(target_os = "macos", test))]
fn is_yes(response: isize) -> bool {
    response == SECOND_BUTTON
}

/// Puts the question in an alert on the main thread and waits for the answer. Never call it on the
/// main thread: the commands that ask are `async`.
#[cfg(target_os = "macos")]
pub fn ask(app: &AppHandle, question: &Question) -> bool {
    let (sender, receiver) = std::sync::mpsc::channel();
    let (title, message) = (question.title.clone(), question.message.clone());
    let [no, yes] = buttons(question);
    let shown = app.run_on_main_thread(move || {
        if let Some(main_thread) = objc2::MainThreadMarker::new() {
            let _ = sender.send(macos::alert(main_thread, &title, &message, no, yes));
        }
    });
    // An alert that couldn't be shown is no.
    shown.is_ok() && receiver.recv().is_ok_and(is_yes)
}

/// Agents run only on the Mac: elsewhere nothing is added.
#[cfg(not(target_os = "macos"))]
pub fn ask(_app: &AppHandle, _question: &Question) -> bool {
    false
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertStyle, NSApplication, NSEvent, NSEventMask, NSEventType};
    use objc2_foundation::NSString;

    use super::FIRST_BUTTON;

    /// The key code of Escape.
    const ESCAPE: u16 = 53;

    /// Shows the alert and gives its answer: `no` is the default button, which Return presses, and
    /// Escape presses it too; `yes` has no key, so only a click presses it.
    pub fn alert(
        main_thread: MainThreadMarker,
        title: &str,
        message: &str,
        no: &str,
        yes: &str,
    ) -> isize {
        let alert = NSAlert::new(main_thread);
        alert.setAlertStyle(NSAlertStyle::Warning);
        alert.setMessageText(&NSString::from_str(title));
        alert.setInformativeText(&NSString::from_str(message));
        alert.addButtonWithTitle(&NSString::from_str(no));
        let allow = alert.addButtonWithTitle(&NSString::from_str(yes));
        allow.setKeyEquivalent(&NSString::from_str(""));
        // `NSAlert` gives Escape only to a button titled Cancel: while the alert is up, Escape is
        // the refusal's too.
        let escape = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            // SAFETY: AppKit hands the monitor an event that lives at least as long as the call.
            let pressed = unsafe { event.as_ref() };
            if pressed.r#type() == NSEventType::KeyDown && pressed.keyCode() == ESCAPE {
                NSApplication::sharedApplication(main_thread).stopModalWithCode(FIRST_BUTTON);
                return std::ptr::null_mut();
            }
            event.as_ptr()
        });
        // SAFETY: the block lives until the monitor is removed below, on this same thread.
        let monitor = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &escape)
        };
        let response = alert.runModal();
        if let Some(monitor) = monitor {
            // SAFETY: the monitor is the one added above, and is removed once.
            unsafe { NSEvent::removeMonitor(&monitor) };
        }
        response
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn question() -> Question {
        Question {
            title: "Let Redlines run /bin/x as an agent?".to_owned(),
            message: String::new(),
            yes: "Allow",
            no: "Don't Allow",
        }
    }

    #[test]
    fn the_refusal_is_the_default_button_and_only_the_yes_says_yes() {
        // The first button added is the one Return presses.
        assert_eq!(buttons(&question()), ["Don't Allow", "Allow"]);
        assert!(!is_yes(FIRST_BUTTON), "the refusal, Return and Escape");
        assert!(is_yes(SECOND_BUTTON));
        for other in [0, -1, 1002, -1000] {
            assert!(!is_yes(other), "{other}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_numbers_are_appkits() {
        assert_eq!(objc2_app_kit::NSAlertFirstButtonReturn, FIRST_BUTTON);
        assert_eq!(objc2_app_kit::NSAlertSecondButtonReturn, SECOND_BUTTON);
    }
}
