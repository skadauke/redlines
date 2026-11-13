// The settings pane where a person turns the Quick Look preview of Markdown files off (#316). The
// preview is an extension inside the app (apps/desktop/quicklook) that macOS registers by itself
// when the app first runs from Applications, and System Settings › General › Login Items &
// Extensions › Quick Look lists it. Preferences › General has one line for it, with a button that
// opens that pane.

/// The pane: Login Items & Extensions, with its sheet of the Quick Look extensions, each with a
/// switch (seen on macOS 27; `com.apple.ExtensionsPreferences`, which looks as if it should do this,
/// opens at Login Items alone). Where System Settings doesn't know the extension point it shows the
/// Login Items page, a few steps from the list.
const SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.LoginItems-Settings.extension?extensionPointIdentifier=com.apple.quicklook.preview";

/// Opens System Settings at the Quick Look extensions. Only the Mac has Quick Look: elsewhere this
/// refuses, in a sentence that the Preferences line shows.
#[tauri::command(async)]
pub fn open_quick_look_settings() -> Result<(), String> {
    open(SETTINGS_URL)
}

#[cfg(target_os = "macos")]
fn open(url: &str) -> Result<(), String> {
    match std::process::Command::new("open").arg(url).status() {
        Ok(status) if status.success() => Ok(()),
        Ok(_) => Err("System Settings didn’t open.".to_string()),
        Err(error) => Err(format!("System Settings didn’t open: {error}.")),
    }
}

#[cfg(not(target_os = "macos"))]
fn open(_url: &str) -> Result<(), String> {
    Err("Quick Look previews are the Mac’s.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The extension point that the Quick Look extension is built for, in the script that builds it.
    const BUILD_SCRIPT: &str = include_str!("../../scripts/build-quicklook");

    #[test]
    fn the_pane_lists_the_extensions_that_quick_look_previews_come_from() {
        assert!(SETTINGS_URL.starts_with("x-apple.systempreferences:"));
        let extension_point = SETTINGS_URL
            .split("extensionPointIdentifier=")
            .nth(1)
            .expect("the URL names an extension point");
        // The one the extension declares (NSExtensionPointIdentifier in its Info.plist).
        assert!(
            BUILD_SCRIPT.contains(&format!("\"{extension_point}\"")),
            "scripts/build-quicklook doesn't declare {extension_point}"
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn refuses_where_there_is_no_quick_look() {
        assert_eq!(
            open_quick_look_settings(),
            Err("Quick Look previews are the Mac’s.".to_string())
        );
    }
}
