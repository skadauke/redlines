//! The original of a picture copied in Word (#1182).
//!
//! Word writes a picture to the pasteboard at the size it has on the page (`public.png`, `.tiff`,
//! `.jpeg` and a PDF, which is all that a web view gives a page), and also in its own drawing format,
//! `com.microsoft.Art--GVML-ClipFormat`: an Office package (a zip) that holds the image file as it
//! was inserted under `clipboard/media/`. This reads that kind from the pasteboard and gives its
//! bytes to the page, which opens the package and takes the picture; a pasteboard without the kind,
//! a package that is too large, and a window that doesn't have the keys give nothing, and the page
//! pastes what it has.

/// The pasteboard type of Word's drawing format.
#[cfg(target_os = "macos")]
const GVML_TYPE: &str = "com.microsoft.Art--GVML-ClipFormat";

/// The largest package that is read, in bytes. A picture with a large original is worth the memory;
/// a pasteboard larger than this is not one the app opens.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const MAX_PACKAGE_BYTES: usize = 50 * 1024 * 1024;

/// Whether a package of `len` bytes is within the limit and holds something.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn readable(len: usize) -> bool {
    len > 0 && len <= MAX_PACKAGE_BYTES
}

/// Whether the window `caller` may read the pasteboard: the one that has the keys, which is the one
/// whose paste this is.
fn may_read(caller: &str, key: Option<&str>) -> bool {
    key == Some(caller)
}

/// The bytes of Word's drawing package on the general pasteboard, if it holds one within the limit.
#[cfg(target_os = "macos")]
fn package() -> Option<Vec<u8>> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::NSString;
    let kind = NSString::from_str(GVML_TYPE);
    let data = NSPasteboard::generalPasteboard().dataForType(&kind)?;
    readable(data.length()).then(|| data.to_vec())
}

#[cfg(not(target_os = "macos"))]
fn package() -> Option<Vec<u8>> {
    None
}

/// Word's drawing package from the pasteboard, as raw bytes; empty when there is none. The page
/// opens it (`src/office-picture.ts`) and reads only `clipboard/media/`.
#[tauri::command]
pub fn read_office_picture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> tauri::ipc::Response {
    use tauri::Manager;
    let key = app
        .webview_windows()
        .into_iter()
        .find(|(_, candidate)| candidate.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    let bytes = if may_read(window.label(), key.as_deref()) {
        package().unwrap_or_default()
    } else {
        Vec::new()
    };
    tauri::ipc::Response::new(bytes)
}

#[cfg(test)]
mod tests {
    use super::{MAX_PACKAGE_BYTES, may_read, readable};

    #[test]
    fn reads_a_package_within_the_limit_only() {
        assert!(!readable(0));
        assert!(readable(1));
        assert!(readable(MAX_PACKAGE_BYTES));
        assert!(!readable(MAX_PACKAGE_BYTES + 1));
    }

    #[test]
    fn only_the_window_with_the_keys_reads() {
        assert!(may_read("doc-1", Some("doc-1")));
        assert!(!may_read("doc-1", Some("doc-2")));
        assert!(!may_read("doc-1", None));
    }
}
