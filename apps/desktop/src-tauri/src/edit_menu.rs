//! Undo and Redo in a text field. The Edit menu's two items are the app's own (`src/menu-model.ts`),
//! so that they can say what the document's history takes back; in the document they call the
//! editor. With the keys in a text field, a comment box, the find bar or a Preferences field, they
//! send what the Mac's own items send: `undo:` or `redo:` to the first responder of the window
//! that has the keys, which is the field's own undo. The menu's items belong to a document window's
//! page, which can't reach into another window (Preferences), so the app does it.

/// The action a Mac's Undo or Redo item sends to the first responder.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn action_name(redo: bool) -> &'static str {
    if redo { "redo:" } else { "undo:" }
}

/// Whether the window `caller`, whose page owns the menu bar's items, may send Undo to the window
/// that has the keys, `key`: its own, or Preferences', which has no menu bar of its own. Never
/// another document's: a window that is new and has no menu yet leaves the last window's menu bar
/// in place, and its Undo must not reach the key window's typing.
fn may_undo(caller: &str, key: Option<&str>) -> bool {
    key.is_some_and(|key| key == caller || key == crate::windows::PREFERENCES_WINDOW)
}

/// Sends Undo or Redo down the responder chain of the window that has the keys, as the Mac's own
/// Edit items do, and says whether something took it.
#[tauri::command]
pub async fn undo_in_field(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    redo: bool,
) -> Result<bool, String> {
    use tauri::Manager;
    // The window that has the keys now, which is the one whose field this is.
    let key = app
        .webview_windows()
        .into_iter()
        .find(|(_, candidate)| candidate.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    if !may_undo(window.label(), key.as_deref()) {
        return Ok(false);
    }
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            use objc2::MainThreadMarker;
            use objc2::runtime::Sel;
            use objc2_app_kit::NSApplication;
            let handled = MainThreadMarker::new().is_some_and(|main| {
                let action = Sel::register(
                    &std::ffi::CString::new(action_name(redo)).expect("a name without a NUL"),
                );
                // SAFETY: `undo:` and `redo:` take a sender, and nil is one.
                unsafe {
                    NSApplication::sharedApplication(main).sendAction_to_from(action, None, None)
                }
            });
            let _ = sender.send(handled);
        })
        .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || receiver.recv().map_err(|e| e.to_string()))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, redo);
        Ok(false)
    }
}

/// The system's beep, as the Mac makes it for an Undo that finds nothing.
#[tauri::command]
pub fn beep() {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "AppKit", kind = "framework")]
        unsafe extern "C" {
            fn NSBeep();
        }
        // SAFETY: `NSBeep` takes nothing and may be called from any thread.
        unsafe { NSBeep() }
    }
}

#[cfg(test)]
mod tests {
    use super::{action_name, may_undo};

    #[test]
    fn undo_reaches_the_callers_own_window_and_preferences_only() {
        assert!(may_undo("doc-1", Some("doc-1")));
        assert!(may_undo("doc-1", Some("preferences")));
        assert!(!may_undo("doc-1", Some("doc-2")));
        assert!(!may_undo("doc-1", None));
        assert!(!may_undo("doc-1", Some("install")));
    }

    #[test]
    fn names_the_actions_the_macs_items_send() {
        assert_eq!(action_name(false), "undo:");
        assert_eq!(action_name(true), "redo:");
    }
}
