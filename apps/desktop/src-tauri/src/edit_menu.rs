//! Undo, Redo and Paste in a text field. The Edit menu's undo items are the app's own (`src/menu-model.ts`),
//! so that they can say what the document's history takes back; in the document they call the
//! editor. With the keys in a text field, a comment box, the find bar or a Preferences field, they
//! send what the Mac's own items send: `undo:` or `redo:` to the first responder of the window
//! that has the keys, which is the field's own undo. The menu's items belong to a document window's
//! page, which can't reach into another window (Preferences), so the app does it.
//!
//! Paste from the formatting palette is sent the same way (`paste_in_field`): the page's own paste
//! needs WebKit's confirmation when a button asks for it, and the clipboard plugin reads text alone,
//! where the Mac's `paste:` gives the page a paste event with the clipboard's HTML, as ⌘V does.

/// The action a Mac's Undo or Redo item sends to the first responder.
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

/// The window that has the keys now, which is the one whose field the Mac's Edit items act on.
fn key_window(app: &tauri::AppHandle) -> Option<String> {
    use tauri::Manager;
    app.webview_windows()
        .into_iter()
        .find(|(_, candidate)| candidate.is_focused().unwrap_or(false))
        .map(|(label, _)| label)
}

/// Whether the system's pasteboard holds anything at all. The Edit menu's Paste is disabled when it
/// doesn't, which is why a Paste from the keys can't give the page an empty paste; sending `paste:`
/// ourselves skips that check.
#[cfg(target_os = "macos")]
fn pasteboard_has_content() -> bool {
    use objc2_app_kit::NSPasteboard;
    NSPasteboard::generalPasteboard()
        .types()
        .is_some_and(|types| types.count() > 0)
}

/// Sends `action` down the responder chain of the window that has the keys, as the Mac's own Edit
/// items do, and says whether something took it. With `needs_content`, nothing is sent while the
/// pasteboard is empty: the page would get a paste of nothing, which the editor takes for a paste
/// over the selection and deletes it, and the caller says that there is nothing to paste instead.
async fn send_action(
    app: &tauri::AppHandle,
    action: &'static str,
    needs_content: bool,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            use objc2::MainThreadMarker;
            use objc2::runtime::Sel;
            use objc2_app_kit::NSApplication;
            let handled = MainThreadMarker::new().is_some_and(|main| {
                if needs_content && !pasteboard_has_content() {
                    return false;
                }
                let action =
                    Sel::register(&std::ffi::CString::new(action).expect("a name without a NUL"));
                // SAFETY: `undo:`, `redo:` and `paste:` take a sender, and nil is one.
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
        let _ = (app, action, needs_content);
        Ok(false)
    }
}

/// Sends Undo or Redo down the responder chain of the window that has the keys, as the Mac's own
/// Edit items do, and says whether something took it.
#[tauri::command]
pub async fn undo_in_field(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    redo: bool,
) -> Result<bool, String> {
    if !may_undo(window.label(), key_window(&app).as_deref()) {
        return Ok(false);
    }
    send_action(&app, action_name(redo), false).await
}

/// The action a Mac's Paste item sends to the first responder.
const PASTE: &str = "paste:";

/// Whether the window `caller` may paste into the window that has the keys, `key`: its own, and no
/// other. A document's page is the one that asks (the formatting palette's Paste), and Preferences'
/// fields have no use for it.
fn may_paste(caller: &str, key: Option<&str>) -> bool {
    key == Some(caller)
}

/// Pastes into the window as the Mac's Paste item does: `paste:` down the responder chain of the
/// window that has the keys, which WebKit answers with a paste in the page, with the clipboard's
/// HTML and text as ⌘V gives them, so that the editor converts what a web page or Word put there
/// to Markdown. Says whether something took it: not when nothing is on the pasteboard (the page
/// then says so), nor when no responder takes `paste:`. The page's own `execCommand('paste')` would
/// need WebKit's confirmation of a paste from a button, and the clipboard plugin reads text alone.
#[tauri::command]
pub async fn paste_in_field(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<bool, String> {
    if !may_paste(window.label(), key_window(&app).as_deref()) {
        return Ok(false);
    }
    send_action(&app, PASTE, true).await
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
    use super::{action_name, may_paste, may_undo};

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

    #[test]
    fn paste_reaches_the_callers_own_window_and_no_other() {
        assert!(may_paste("doc-1", Some("doc-1")));
        assert!(may_paste("main", Some("main")));
        assert!(!may_paste("doc-1", Some("doc-2")));
        // Not Preferences' either, nor a window the app doesn't know, nor none at all.
        assert!(!may_paste("doc-1", Some("preferences")));
        assert!(!may_paste("doc-1", Some("install")));
        assert!(!may_paste("doc-1", None));
    }
}
