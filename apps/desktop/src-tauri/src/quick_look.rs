// What Preferences › General says of the Quick Look preview of Markdown files (#316). The preview is
// an extension inside the app (apps/desktop/quicklook) that macOS registers by itself when the app
// first runs from Applications, and System Settings lists it with the other Quick Look extensions,
// where it is turned off. Preferences has one line for it, drawn only where there is a preview to
// turn off (`quick_look_available`), with a button that opens that list (`open_quick_look_settings`).

use std::path::{Path, PathBuf};

/// The extension inside the app's bundle, where `bundle.macOS.files` in tauri.conf.json puts it.
const EXTENSION: &str = "Contents/PlugIns/RedlinesPreview.appex";

/// The oldest macOS, as (major, minor), that loads the extension: `MINIMUM_MACOS` in
/// scripts/build-quicklook, which says why.
const MINIMUM_MACOS: (isize, isize) = (13, 3);

/// The list of Quick Look extensions in System Settings. Tried on macOS 27 only, where this opens
/// Login Items & Extensions with the sheet of Quick Look extensions over it, each with a switch;
/// `com.apple.ExtensionsPreferences` with the same query opens General there, and without it Login
/// Items. A macOS that doesn't know the extension point may open a page a few steps from the list.
const SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.LoginItems-Settings.extension?extensionPointIdentifier=com.apple.quicklook.preview";

/// Whether this app has a Quick Look preview to turn off: it runs from a bundle that holds the
/// extension (a build run from the sources, as `pnpm tauri dev` does, has none), installed rather
/// than on a disk image, since macOS registers the extension when the app runs from Applications,
/// and on a macOS that loads it. Preferences draws its line only then.
#[tauri::command(async)]
pub fn quick_look_available() -> bool {
    running_bundle().is_some_and(|bundle| holds_the_extension(&bundle) && !on_an_image(&bundle))
        && macos_version().is_some_and(loads_the_extension)
}

/// Opens System Settings at the Quick Look extensions. Only the Mac has Quick Look: elsewhere this
/// refuses, in a sentence. The Preferences line is drawn only where `quick_look_available` says
/// there is a preview, and never shows that sentence; it is for a caller that didn't ask.
#[tauri::command(async)]
pub fn open_quick_look_settings() -> Result<(), String> {
    open(SETTINGS_URL)
}

/// Whether the app at `bundle` carries the extension.
fn holds_the_extension(bundle: &Path) -> bool {
    bundle.join(EXTENSION).is_dir()
}

/// Whether a macOS of this version, (major, minor), loads the extension.
fn loads_the_extension(version: (isize, isize)) -> bool {
    version >= MINIMUM_MACOS
}

/// Whether the app at `bundle` runs from a disk image, or translocated from one: it isn't installed
/// yet, and the other lines of Preferences ask such a copy to move first
/// (`install::may_be_on_image`).
#[cfg(target_os = "macos")]
fn on_an_image(bundle: &Path) -> bool {
    let original = crate::install::macos::translocated_original(bundle);
    crate::install::may_be_on_image(bundle, original.as_deref())
}

#[cfg(not(target_os = "macos"))]
fn on_an_image(_bundle: &Path) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn running_bundle() -> Option<PathBuf> {
    crate::install::macos::running_bundle()
}

#[cfg(not(target_os = "macos"))]
fn running_bundle() -> Option<PathBuf> {
    None
}

#[cfg(target_os = "macos")]
fn macos_version() -> Option<(isize, isize)> {
    let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    Some((version.majorVersion, version.minorVersion))
}

#[cfg(not(target_os = "macos"))]
fn macos_version() -> Option<(isize, isize)> {
    None
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

    /// The script that builds the extension, which says what it is built for.
    const BUILD_SCRIPT: &str = include_str!("../../scripts/build-quicklook");
    /// The configuration that puts the extension in the bundle.
    const TAURI_CONF: &str = include_str!("../tauri.conf.json");

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

    #[test]
    fn looks_for_the_extension_where_the_bundle_puts_it() {
        let in_plug_ins = EXTENSION
            .strip_prefix("Contents/")
            .expect("the extension is inside Contents");
        assert!(
            TAURI_CONF.contains(&format!("\"{in_plug_ins}\"")),
            "tauri.conf.json puts no {in_plug_ins} in the bundle"
        );
    }

    #[test]
    fn asks_of_macos_what_the_extension_asks() {
        let (major, minor) = MINIMUM_MACOS;
        assert!(
            BUILD_SCRIPT.contains(&format!("MINIMUM_MACOS = \"{major}.{minor}\"")),
            "scripts/build-quicklook builds for another macOS than {major}.{minor}"
        );
    }

    #[test]
    fn the_extension_loads_from_the_macos_that_the_build_names() {
        assert!(!loads_the_extension((10, 15)));
        assert!(!loads_the_extension((12, 7)));
        assert!(!loads_the_extension((13, 0)));
        assert!(!loads_the_extension((13, 2)));
        assert!(loads_the_extension((13, 3)));
        assert!(loads_the_extension((14, 0)));
        assert!(loads_the_extension((27, 0)));
    }

    #[test]
    fn a_bundle_has_a_preview_when_it_holds_the_extension() {
        let folder =
            std::env::temp_dir().join(format!("redlines-quick-look-{}", std::process::id()));
        let bundle = folder.join("Redlines.app");
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
        assert!(!holds_the_extension(&bundle));
        std::fs::create_dir_all(bundle.join(EXTENSION)).unwrap();
        assert!(holds_the_extension(&bundle));
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn has_none_to_turn_off_where_the_app_is_not_run_from_its_bundle() {
        // The tests run from `target/`, as a build from the sources does.
        assert!(!quick_look_available());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_copy_on_a_disk_image_is_not_installed_yet() {
        assert!(on_an_image(Path::new("/Volumes/Redlines/Redlines.app")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn knows_which_macos_it_runs_on() {
        assert!(macos_version().is_some_and(|(major, _)| major >= 11));
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
