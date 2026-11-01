//! Installing Redlines from its disk image.
//!
//! Started from a mounted disk image, Redlines asks whether to install itself in an Applications
//! folder. If the person agrees, it copies itself there, opens the copy and quits, and the copy
//! ejects the image once the first one is gone. This module makes each decision from facts that
//! the caller gathers, so that the decisions can be tested on any system; `macos` gathers the facts
//! and acts on the decisions.

use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};

use serde::Deserialize;

#[cfg(target_os = "macos")]
pub mod macos;

/// The Applications folder for everyone on the Mac.
pub const SYSTEM_APPLICATIONS: &str = "/Applications";

/// The app bundle an executable runs in: `…/Redlines.app/Contents/MacOS/redlines-desktop` is in
/// `…/Redlines.app`. A binary outside a bundle, as `tauri dev` runs it, is in none.
pub fn bundle_of(executable: &Path) -> Option<&Path> {
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let in_bundle = macos.file_name() == Some(OsStr::new("MacOS"))
        && contents.file_name() == Some(OsStr::new("Contents"))
        && bundle.extension() == Some(OsStr::new("app"));
    in_bundle.then_some(bundle)
}

/// What `hdiutil info -plist` says about the attached disk images, as far as installing needs.
#[derive(Deserialize)]
struct HdiutilInfo {
    #[serde(default)]
    images: Vec<AttachedImage>,
}

#[derive(Deserialize)]
struct AttachedImage {
    #[serde(rename = "system-entities", default)]
    entities: Vec<Entity>,
}

/// A partition of an image, or the whole disk; only a mounted volume has a mount point.
#[derive(Deserialize)]
struct Entity {
    #[serde(rename = "mount-point")]
    mount_point: Option<PathBuf>,
}

/// The folders where the attached disk images are mounted, from the output of `hdiutil info
/// -plist`.
pub fn image_mount_points(hdiutil_info: &[u8]) -> Result<Vec<PathBuf>, plist::Error> {
    let info: HdiutilInfo = plist::from_bytes(hdiutil_info)?;
    Ok(info
        .images
        .into_iter()
        .flat_map(|image| image.entities)
        .filter_map(|entity| entity.mount_point)
        .collect())
}

/// Redlines running from a disk image: the app on the image, and where the image is mounted.
#[derive(Debug, PartialEq)]
pub struct OnImage {
    pub bundle: PathBuf,
    pub mount_point: PathBuf,
}

/// Whether the app at `bundle` runs from a disk image mounted at one of `mount_points`. For an app
/// from a downloaded image, macOS runs a copy in a randomized folder instead (App Translocation);
/// `original` is then where the app really is.
pub fn on_image(
    bundle: &Path,
    original: Option<&Path>,
    mount_points: &[PathBuf],
) -> Option<OnImage> {
    let bundle = original.unwrap_or(bundle);
    // `starts_with` compares whole components, so /Volumes/Redlines 1 isn't in /Volumes/Redlines.
    let mount_point = mount_points
        .iter()
        .filter(|mount_point| bundle.starts_with(mount_point))
        .max_by_key(|mount_point| mount_point.components().count())?;
    Some(OnImage {
        bundle: bundle.to_path_buf(),
        mount_point: mount_point.clone(),
    })
}

/// What is installed already, and what Redlines may replace.
#[derive(Clone, Copy, Debug, Default)]
pub struct Installed {
    /// The app is in the Applications folder in the home folder.
    pub in_home: bool,
    /// The app is in /Applications.
    pub in_system: bool,
    /// The app in /Applications can be replaced: it and the folder are writable.
    pub system_replaceable: bool,
}

/// Where to install the app.
#[derive(Debug, PartialEq)]
pub struct Target {
    /// The app's path once installed.
    pub path: PathBuf,
    /// The app is there already, and installing replaces it.
    pub replaces: bool,
    /// A copy that stays where it is, alongside the new one, because it can't be replaced.
    pub keeps: Option<PathBuf>,
}

/// Where to install the app called `bundle_name`. A copy that is installed already is replaced in
/// its own place, so that there is never a second one, unless it can't be; the app goes to the
/// Applications folder in the home folder otherwise.
pub fn install_target(home: &Path, bundle_name: &OsStr, installed: Installed) -> Target {
    let in_home = home.join("Applications").join(bundle_name);
    let in_system = Path::new(SYSTEM_APPLICATIONS).join(bundle_name);
    if installed.in_home {
        Target {
            path: in_home,
            replaces: true,
            keeps: None,
        }
    } else if installed.in_system && installed.system_replaceable {
        Target {
            path: in_system,
            replaces: true,
            keeps: None,
        }
    } else {
        Target {
            path: in_home,
            replaces: false,
            keeps: installed.in_system.then_some(in_system),
        }
    }
}

/// The parts of an app's `Info.plist` that installing reads.
#[derive(Deserialize)]
struct BundleInfo {
    #[serde(rename = "CFBundleShortVersionString")]
    version: Option<String>,
    #[serde(rename = "CFBundleIconFile")]
    icon: Option<String>,
}

/// The version an app's `Info.plist` gives, if it gives one.
pub fn bundle_version(info_plist: &[u8]) -> Option<String> {
    let info: BundleInfo = plist::from_bytes(info_plist).ok()?;
    let version = info.version?.trim().to_owned();
    (!version.is_empty()).then_some(version)
}

/// The file name of the icon that an app's `Info.plist` names, in its Resources folder.
pub fn bundle_icon(info_plist: &[u8]) -> Option<String> {
    let info: BundleInfo = plist::from_bytes(info_plist).ok()?;
    let icon = info.icon?;
    if icon.is_empty() || icon.contains('/') {
        return None;
    }
    Some(if icon.ends_with(".icns") {
        icon
    } else {
        format!("{icon}.icns")
    })
}

/// What to call an Applications folder when talking to the person.
fn folder_name(folder: &Path, home: &Path) -> String {
    if folder == Path::new(SYSTEM_APPLICATIONS) {
        "the Applications folder".to_owned()
    } else if folder == home.join("Applications") {
        "the Applications folder in your home folder".to_owned()
    } else {
        folder.display().to_string()
    }
}

/// What the app asks before it installs itself.
#[derive(Debug, PartialEq)]
pub struct Question {
    pub title: String,
    pub message: String,
    /// The label of the button that installs.
    pub install: &'static str,
}

/// What to ask before installing at `target`. `installed_version` is the version of the copy
/// there, if there is one and it gives its version; `version` is this copy's.
pub fn question(
    target: &Target,
    home: &Path,
    installed_version: Option<&str>,
    version: &str,
) -> Question {
    let folder = target_folder(target, home);
    let title = "Install Redlines in your Applications folder?".to_owned();
    if target.replaces {
        let (installed, this) = match installed_version {
            Some(installed) if installed == version => (
                format!("Redlines {installed}"),
                "this copy of the same version,".to_owned(),
            ),
            Some(installed) => (
                format!("Redlines {installed}"),
                format!("this copy, Redlines {version},"),
            ),
            None => (
                "Redlines".to_owned(),
                format!("this copy, Redlines {version},"),
            ),
        };
        return Question {
            title,
            message: format!(
                "{installed} is in {folder} already. Installing replaces it with {this} opens it \
                 and ejects this disk image."
            ),
            install: "Replace",
        };
    }
    let mut message =
        format!("Redlines copies itself to {folder}, opens from there and ejects this disk image.");
    if let Some(kept) = target.keeps.as_deref().and_then(Path::parent) {
        message.push_str(&format!(
            " The Redlines in {} stays, because replacing it needs an administrator.",
            folder_name(kept, home)
        ));
    }
    Question {
        title,
        message,
        install: "Install",
    }
}

/// What the app tells the person when installing goes wrong.
#[derive(Debug, PartialEq)]
pub struct Notice {
    pub title: String,
    pub message: String,
}

/// What to say when copying the app to `target` failed with `error`.
pub fn copy_failed(target: &Target, home: &Path, error: &str) -> Notice {
    let folder = target_folder(target, home);
    let after = if target.replaces {
        "The Redlines there is as it was. This one keeps running from the disk image."
    } else {
        "Redlines keeps running from the disk image."
    };
    Notice {
        title: "Redlines couldn't be installed".to_owned(),
        message: format!("Copying it to {folder} failed: {error}\n\n{after}"),
    }
}

/// The reason in what `ditto` said when it failed, without the paths, which name folders the
/// person never sees: `ditto: /…/.Redlines.app-copying-4242: Permission denied` is `Permission
/// denied`.
pub fn copy_error(said: &str) -> &str {
    let last = said
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    last.rsplit_once(": ").map_or(last, |(_, reason)| reason)
}

/// What to say when the copy at `target` is in place but opening it failed with `error`.
pub fn open_failed(target: &Target, home: &Path, error: &str) -> Notice {
    let folder = target_folder(target, home);
    Notice {
        title: "Redlines is installed but didn't open".to_owned(),
        message: format!(
            "Redlines is in {folder} now, but opening it from there failed: {error}\n\nThis copy \
             keeps running from the disk image. Next time, open Redlines from {folder}."
        ),
    }
}

/// What to call the folder the app is installed in.
fn target_folder(target: &Target, home: &Path) -> String {
    target
        .path
        .parent()
        .map_or_else(String::new, |folder| folder_name(folder, home))
}

/// What the installed copy is started with, so that it ejects the disk image once the copy that
/// installed it has quit.
#[derive(Debug, PartialEq)]
pub struct Handoff {
    /// Where the disk image is mounted.
    pub mount_point: PathBuf,
    /// The process of the copy on the image.
    pub pid: u32,
}

const EJECT_IMAGE: &str = "--eject-image";
const AFTER_PID: &str = "--after-pid";

impl Handoff {
    /// The handoff as command line arguments.
    pub fn args(&self) -> Vec<OsString> {
        vec![
            EJECT_IMAGE.into(),
            self.mount_point.clone().into(),
            AFTER_PID.into(),
            self.pid.to_string().into(),
        ]
    }
}

/// Takes a handoff from the command line arguments, and returns it and the other arguments.
/// Arguments that don't make a whole handoff are dropped.
pub fn take_handoff(args: impl IntoIterator<Item = OsString>) -> (Option<Handoff>, Vec<OsString>) {
    let (mut mount_point, mut pid, mut rest) = (None, None, Vec::new());
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == EJECT_IMAGE {
            mount_point = args.next().map(PathBuf::from);
        } else if arg == AFTER_PID {
            pid = args
                .next()
                .and_then(|value| value.to_str()?.parse::<u32>().ok());
        } else {
            rest.push(arg);
        }
    }
    let handoff = match (mount_point, pid) {
        // Process 0 and 1 are the kernel and launchd, never the copy on the image.
        (Some(mount_point), Some(pid)) if mount_point.is_absolute() && pid > 1 => {
            Some(Handoff { mount_point, pid })
        }
        _ => None,
    };
    (handoff, rest)
}

/// Waits until the process `pid` is gone, asking `alive` up to `polls` times and calling `pause`
/// in between. Says whether it went.
pub fn wait_for_exit(
    pid: u32,
    polls: u32,
    mut alive: impl FnMut(u32) -> bool,
    mut pause: impl FnMut(),
) -> bool {
    for _ in 0..polls {
        if !alive(pid) {
            return true;
        }
        pause();
    }
    !alive(pid)
}

/// Ejects a disk image by calling `detach` up to `attempts` times, with `pause` in between, while
/// the image is in use. Says whether it was ejected; an image that stays in use stays mounted.
pub fn eject(attempts: u32, mut detach: impl FnMut() -> bool, mut pause: impl FnMut()) -> bool {
    for attempt in 0..attempts {
        if attempt > 0 {
            pause();
        }
        if detach() {
            return true;
        }
    }
    false
}

/// A hidden folder beside `target` for one step of installing: `.Redlines.app-copying-4242`.
/// Hidden, and not named like an app, so that neither Finder nor Launch Services takes it for one,
/// should it stay behind.
fn beside(target: &Path, step: &str, pid: u32) -> PathBuf {
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    target.with_file_name(format!(".{name}-{step}-{pid}"))
}

/// Removes a folder, if it is there.
fn remove_folder(folder: &Path) -> io::Result<()> {
    match std::fs::remove_dir_all(folder) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Puts the app at `target`, copied there by `copy` into the folder it is given, and replaces what
/// is at `target` only once the copy is whole, so that a failure leaves an installed app as it
/// was. `pid` keeps the names of the folders used along the way apart from another process's.
pub fn put_in_place(
    target: &Path,
    pid: u32,
    copy: impl FnOnce(&Path) -> io::Result<()>,
) -> io::Result<()> {
    if let Some(folder) = target.parent() {
        std::fs::create_dir_all(folder)?;
    }
    // Beside the target, so that putting the copy in place is a rename on the same volume.
    let copying = beside(target, "copying", pid);
    remove_folder(&copying)?;
    if let Err(error) = copy(&copying) {
        let _ = remove_folder(&copying);
        return Err(error);
    }
    let replacing = target.symlink_metadata().is_ok();
    let replaced = beside(target, "replaced", pid);
    if replacing {
        let _ = remove_folder(&replaced);
        if let Err(error) = std::fs::rename(target, &replaced) {
            let _ = remove_folder(&copying);
            return Err(error);
        }
    }
    if let Err(error) = std::fs::rename(&copying, target) {
        if replacing {
            let _ = std::fs::rename(&replaced, target);
        }
        let _ = remove_folder(&copying);
        return Err(error);
    }
    if replacing && let Err(error) = remove_folder(&replaced) {
        // The new copy is in place; the old one stays behind, hidden.
        eprintln!(
            "Redlines can't remove the copy it replaced, {}: {error}",
            replaced.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(list: &[&str]) -> Vec<PathBuf> {
        list.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn bundle_of_finds_the_app_an_executable_runs_in() {
        assert_eq!(
            bundle_of(Path::new(
                "/Volumes/Redlines/Redlines.app/Contents/MacOS/redlines-desktop"
            )),
            Some(Path::new("/Volumes/Redlines/Redlines.app"))
        );
        // `tauri dev` runs the binary where Cargo builds it.
        assert_eq!(
            bundle_of(Path::new("/src/redlines/target/debug/redlines-desktop")),
            None
        );
        // A folder that looks almost like a bundle isn't one.
        assert_eq!(
            bundle_of(Path::new(
                "/Volumes/Redlines/Redlines/Contents/MacOS/redlines"
            )),
            None
        );
        assert_eq!(
            bundle_of(Path::new(
                "/Volumes/Redlines/Redlines.app/Contents/redlines"
            )),
            None
        );
        assert_eq!(bundle_of(Path::new("redlines")), None);
    }

    const HDIUTIL_INFO: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>framework</key>
	<string>704</string>
	<key>images</key>
	<array>
		<dict>
			<key>image-path</key>
			<string>/Users/ada/Downloads/Redlines_0.1.0_aarch64.dmg</string>
			<key>image-type</key>
			<string>UDIF read-only compressed (zlib)</string>
			<key>system-entities</key>
			<array>
				<dict>
					<key>content-hint</key>
					<string>GUID_partition_scheme</string>
					<key>dev-entry</key>
					<string>/dev/disk4</string>
				</dict>
				<dict>
					<key>content-hint</key>
					<string>48465300-0000-11AA-AA11-00306543ECAC</string>
					<key>dev-entry</key>
					<string>/dev/disk4s1</string>
					<key>mount-point</key>
					<string>/Volumes/Redlines</string>
				</dict>
			</array>
			<key>writeable</key>
			<false/>
		</dict>
		<dict>
			<key>image-path</key>
			<string>/Users/ada/Downloads/Tools &amp; More.dmg</string>
			<key>system-entities</key>
			<array>
				<dict>
					<key>dev-entry</key>
					<string>/dev/disk5s1</string>
					<key>mount-point</key>
					<string>/Volumes/Tools &amp; More 1</string>
				</dict>
			</array>
		</dict>
		<dict>
			<key>image-path</key>
			<string>/Users/ada/blank.dmg</string>
			<key>system-entities</key>
			<array>
				<dict>
					<key>dev-entry</key>
					<string>/dev/disk6</string>
				</dict>
			</array>
		</dict>
	</array>
	<key>revision</key>
	<string>704</string>
</dict>
</plist>
"#;

    #[test]
    fn image_mount_points_lists_where_each_attached_image_is_mounted() {
        assert_eq!(
            image_mount_points(HDIUTIL_INFO.as_bytes()).unwrap(),
            paths(&["/Volumes/Redlines", "/Volumes/Tools & More 1"])
        );
    }

    #[test]
    fn image_mount_points_is_empty_without_images_and_an_error_for_garbage() {
        let none = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>framework</key>
	<string>704</string>
	<key>images</key>
	<array/>
</dict>
</plist>
"#;
        assert_eq!(
            image_mount_points(none.as_bytes()).unwrap(),
            Vec::<PathBuf>::new()
        );
        assert!(image_mount_points(b"hdiutil: info failed").is_err());
    }

    #[test]
    fn on_image_finds_the_image_the_app_runs_from() {
        let mounts = paths(&["/Volumes/Notes", "/Volumes/Redlines"]);
        let found = on_image(Path::new("/Volumes/Redlines/Redlines.app"), None, &mounts).unwrap();
        assert_eq!(found.bundle, Path::new("/Volumes/Redlines/Redlines.app"));
        assert_eq!(found.mount_point, Path::new("/Volumes/Redlines"));
        // In a folder on the image, too.
        let nested = on_image(Path::new("/Volumes/Notes/Apps/Redlines.app"), None, &mounts);
        assert_eq!(
            nested.map(|found| found.mount_point),
            Some(PathBuf::from("/Volumes/Notes"))
        );
    }

    #[test]
    fn on_image_is_none_for_an_app_elsewhere() {
        let mounts = paths(&["/Volumes/Redlines"]);
        let elsewhere = |bundle: &str| on_image(Path::new(bundle), None, &mounts);
        assert_eq!(elsewhere("/Users/ada/Applications/Redlines.app"), None);
        assert_eq!(elsewhere("/Applications/Redlines.app"), None);
        // A volume whose name starts with the image's is another volume.
        assert_eq!(elsewhere("/Volumes/Redlines 1/Redlines.app"), None);
        assert_eq!(
            on_image(Path::new("/Volumes/Redlines/Redlines.app"), None, &[]),
            None
        );
    }

    #[test]
    fn on_image_looks_where_a_translocated_app_really_is() {
        let mounts = paths(&["/Volumes/Redlines"]);
        let translocated =
            Path::new("/private/var/folders/x7/T/AppTranslocation/4F1B2C3D/d/Redlines.app");
        let found = on_image(
            translocated,
            Some(Path::new("/Volumes/Redlines/Redlines.app")),
            &mounts,
        )
        .unwrap();
        assert_eq!(found.bundle, Path::new("/Volumes/Redlines/Redlines.app"));
        assert_eq!(found.mount_point, Path::new("/Volumes/Redlines"));
        // Translocated from the Downloads folder: not from an image.
        let downloaded = on_image(
            translocated,
            Some(Path::new("/Users/ada/Downloads/Redlines.app")),
            &mounts,
        );
        assert_eq!(downloaded, None);
    }

    #[test]
    fn on_image_takes_the_innermost_of_nested_mounts() {
        let mounts = paths(&["/Volumes/Outer", "/Volumes/Outer/Inner"]);
        let found = on_image(
            Path::new("/Volumes/Outer/Inner/Redlines.app"),
            None,
            &mounts,
        );
        assert_eq!(
            found.map(|found| found.mount_point),
            Some(PathBuf::from("/Volumes/Outer/Inner"))
        );
    }

    const HOME: &str = "/Users/ada";

    fn target_for(installed: Installed) -> Target {
        install_target(Path::new(HOME), OsStr::new("Redlines.app"), installed)
    }

    #[test]
    fn install_target_is_the_home_applications_folder_when_nothing_is_installed() {
        let target = target_for(Installed::default());
        assert_eq!(
            target.path,
            Path::new("/Users/ada/Applications/Redlines.app")
        );
        assert!(!target.replaces);
        assert_eq!(target.keeps, None);
        // Even when /Applications could be written.
        let writable = target_for(Installed {
            system_replaceable: true,
            ..Installed::default()
        });
        assert_eq!(
            writable.path,
            Path::new("/Users/ada/Applications/Redlines.app")
        );
    }

    #[test]
    fn install_target_replaces_a_copy_in_the_home_applications_folder() {
        let target = target_for(Installed {
            in_home: true,
            ..Installed::default()
        });
        assert_eq!(
            target.path,
            Path::new("/Users/ada/Applications/Redlines.app")
        );
        assert!(target.replaces);
        assert_eq!(target.keeps, None);
    }

    #[test]
    fn install_target_replaces_a_copy_in_applications_where_it_is_when_it_can() {
        let target = target_for(Installed {
            in_system: true,
            system_replaceable: true,
            ..Installed::default()
        });
        assert_eq!(target.path, Path::new("/Applications/Redlines.app"));
        assert!(target.replaces);
        assert_eq!(target.keeps, None);
    }

    #[test]
    fn install_target_installs_in_the_home_folder_beside_a_copy_it_cant_replace() {
        let target = target_for(Installed {
            in_system: true,
            system_replaceable: false,
            ..Installed::default()
        });
        assert_eq!(
            target.path,
            Path::new("/Users/ada/Applications/Redlines.app")
        );
        assert!(!target.replaces);
        assert_eq!(
            target.keeps,
            Some(PathBuf::from("/Applications/Redlines.app"))
        );
    }

    #[test]
    fn install_target_replaces_the_home_copy_when_both_folders_have_one() {
        for system_replaceable in [true, false] {
            let target = target_for(Installed {
                in_home: true,
                in_system: true,
                system_replaceable,
            });
            assert_eq!(
                target.path,
                Path::new("/Users/ada/Applications/Redlines.app")
            );
            assert!(target.replaces);
            // There were two copies already; installing doesn't add one.
            assert_eq!(target.keeps, None);
        }
    }

    #[test]
    fn install_target_uses_the_name_the_app_has() {
        let target = install_target(
            Path::new(HOME),
            OsStr::new("Redlines Beta.app"),
            Installed::default(),
        );
        assert_eq!(
            target.path,
            Path::new("/Users/ada/Applications/Redlines Beta.app")
        );
    }

    #[test]
    fn bundle_version_reads_the_short_version_string() {
        let info = br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>redlines-desktop</string>
	<key>CFBundleShortVersionString</key>
	<string>0.1.0</string>
	<key>CFBundleVersion</key>
	<string>20261101</string>
</dict>
</plist>
"#;
        assert_eq!(bundle_version(info), Some("0.1.0".to_owned()));
        let without = br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleName</key><string>Redlines</string></dict></plist>
"#;
        assert_eq!(bundle_version(without), None);
        let blank = br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string> </string></dict></plist>
"#;
        assert_eq!(bundle_version(blank), None);
        assert_eq!(bundle_version(b"not a plist"), None);
    }

    #[test]
    fn bundle_icon_names_the_icon_file_in_the_resources() {
        let info = |icon: &str| {
            format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIconFile</key><string>{icon}</string></dict></plist>
"#
            )
        };
        assert_eq!(
            bundle_icon(info("icon.icns").as_bytes()),
            Some("icon.icns".to_owned())
        );
        // The extension may be left out.
        assert_eq!(
            bundle_icon(info("Redlines").as_bytes()),
            Some("Redlines.icns".to_owned())
        );
        // A name that would lead out of the Resources folder is no icon.
        assert_eq!(bundle_icon(info("../../../etc/hosts").as_bytes()), None);
        assert_eq!(bundle_icon(info("").as_bytes()), None);
        assert_eq!(bundle_icon(b"not a plist"), None);
    }

    #[test]
    fn question_offers_to_install_in_the_home_applications_folder() {
        let target = target_for(Installed::default());
        let asked = question(&target, Path::new(HOME), None, "0.1.0");
        assert_eq!(asked.title, "Install Redlines in your Applications folder?");
        assert_eq!(asked.install, "Install");
        assert_eq!(
            asked.message,
            "Redlines copies itself to the Applications folder in your home folder, opens from \
             there and ejects this disk image."
        );
    }

    #[test]
    fn question_says_which_copy_installing_replaces() {
        let home_copy = target_for(Installed {
            in_home: true,
            ..Installed::default()
        });
        let asked = question(&home_copy, Path::new(HOME), Some("0.1.0"), "0.2.0");
        assert_eq!(asked.title, "Install Redlines in your Applications folder?");
        assert_eq!(asked.install, "Replace");
        assert_eq!(
            asked.message,
            "Redlines 0.1.0 is in the Applications folder in your home folder already. Installing \
             replaces it with this copy, Redlines 0.2.0, opens it and ejects this disk image."
        );

        let system_copy = target_for(Installed {
            in_system: true,
            system_replaceable: true,
            ..Installed::default()
        });
        let asked = question(&system_copy, Path::new(HOME), None, "0.2.0");
        assert_eq!(asked.install, "Replace");
        assert_eq!(
            asked.message,
            "Redlines is in the Applications folder already. Installing replaces it with this \
             copy, Redlines 0.2.0, opens it and ejects this disk image."
        );
    }

    #[test]
    fn question_says_when_the_installed_copy_is_the_same_version() {
        let target = target_for(Installed {
            in_home: true,
            ..Installed::default()
        });
        let asked = question(&target, Path::new(HOME), Some("0.2.0"), "0.2.0");
        assert_eq!(asked.install, "Replace");
        assert_eq!(
            asked.message,
            "Redlines 0.2.0 is in the Applications folder in your home folder already. Installing \
             replaces it with this copy of the same version, opens it and ejects this disk image."
        );
    }

    #[test]
    fn question_mentions_a_copy_that_stays_where_it_is() {
        let target = target_for(Installed {
            in_system: true,
            ..Installed::default()
        });
        let asked = question(&target, Path::new(HOME), None, "0.2.0");
        assert_eq!(asked.install, "Install");
        assert_eq!(
            asked.message,
            "Redlines copies itself to the Applications folder in your home folder, opens from \
             there and ejects this disk image. The Redlines in the Applications folder stays, \
             because replacing it needs an administrator."
        );
    }

    #[test]
    fn a_failed_copy_says_where_things_stand() {
        let fresh = target_for(Installed::default());
        let told = copy_failed(&fresh, Path::new(HOME), "No space left on device");
        assert_eq!(told.title, "Redlines couldn't be installed");
        assert_eq!(
            told.message,
            "Copying it to the Applications folder in your home folder failed: No space left on \
             device\n\nRedlines keeps running from the disk image."
        );
        let replacing = target_for(Installed {
            in_system: true,
            system_replaceable: true,
            ..Installed::default()
        });
        let told = copy_failed(&replacing, Path::new(HOME), "Operation not permitted");
        assert_eq!(
            told.message,
            "Copying it to the Applications folder failed: Operation not permitted\n\nThe \
             Redlines there is as it was. This one keeps running from the disk image."
        );
    }

    #[test]
    fn copy_error_keeps_the_reason_ditto_gives() {
        assert_eq!(
            copy_error(
                "ditto: /Users/ada/Applications/.Redlines.app-copying-4242: Permission denied\n"
            ),
            "Permission denied"
        );
        // The last of several lines.
        assert_eq!(
            copy_error(
                "ditto: /a/Contents/Info.plist: No space left on device\nditto: /a/Contents: No \
                 space left on device\n"
            ),
            "No space left on device"
        );
        assert_eq!(
            copy_error("something else went wrong"),
            "something else went wrong"
        );
        assert_eq!(copy_error(" \n"), "");
    }

    #[test]
    fn a_copy_that_does_not_open_says_where_it_is() {
        let target = target_for(Installed::default());
        let told = open_failed(&target, Path::new(HOME), "LSOpenURLsWithRole() failed");
        assert_eq!(told.title, "Redlines is installed but didn't open");
        assert_eq!(
            told.message,
            "Redlines is in the Applications folder in your home folder now, but opening it from \
             there failed: LSOpenURLsWithRole() failed\n\nThis copy keeps running from the disk \
             image. Next time, open Redlines from the Applications folder in your home folder."
        );
    }

    #[test]
    fn a_handoff_survives_the_command_line() {
        let handoff = Handoff {
            mount_point: PathBuf::from("/Volumes/Redlines 1"),
            pid: 4242,
        };
        let mut args = handoff.args();
        args.push(OsString::from("/Users/ada/plan.md"));
        let (taken, rest) = take_handoff(args);
        assert_eq!(taken, Some(handoff));
        assert_eq!(rest, vec![OsString::from("/Users/ada/plan.md")]);
    }

    fn os(args: &[&str]) -> Vec<OsString> {
        args.iter().map(OsString::from).collect()
    }

    #[test]
    fn take_handoff_keeps_the_other_arguments_in_order() {
        let (taken, rest) = take_handoff(os(&[
            "/docs/a.md",
            "--after-pid",
            "77",
            "-psn_0_12345",
            "--eject-image",
            "/Volumes/Redlines",
            "/docs/b.md",
        ]));
        assert_eq!(
            taken,
            Some(Handoff {
                mount_point: PathBuf::from("/Volumes/Redlines"),
                pid: 77,
            })
        );
        assert_eq!(rest, os(&["/docs/a.md", "-psn_0_12345", "/docs/b.md"]));
    }

    #[test]
    fn take_handoff_is_none_without_a_whole_handoff() {
        let none = |args: &[&str]| take_handoff(os(args)).0;
        assert_eq!(none(&["/docs/a.md"]), None);
        assert_eq!(none(&["--eject-image", "/Volumes/Redlines"]), None);
        assert_eq!(none(&["--after-pid", "77"]), None);
        assert_eq!(
            none(&[
                "--eject-image",
                "/Volumes/Redlines",
                "--after-pid",
                "seventy"
            ]),
            None
        );
        assert_eq!(
            none(&["--eject-image", "/Volumes/Redlines", "--after-pid", "-1"]),
            None
        );
        // Not a process the app could have been: none, and launchd.
        assert_eq!(
            none(&["--eject-image", "/Volumes/Redlines", "--after-pid", "0"]),
            None
        );
        assert_eq!(
            none(&["--eject-image", "/Volumes/Redlines", "--after-pid", "1"]),
            None
        );
        // A mount point is a full path.
        assert_eq!(
            none(&["--eject-image", "Volumes/Redlines", "--after-pid", "77"]),
            None
        );
        // A flag at the end, without its value.
        let (taken, rest) = take_handoff(os(&["--after-pid", "77", "--eject-image"]));
        assert_eq!(taken, None);
        assert_eq!(rest, Vec::<OsString>::new());
    }

    #[test]
    fn wait_for_exit_polls_until_the_process_is_gone() {
        let (mut asked, mut paused) = (0, 0);
        let gone = wait_for_exit(
            77,
            10,
            |pid| {
                assert_eq!(pid, 77);
                asked += 1;
                asked < 3
            },
            || paused += 1,
        );
        assert!(gone);
        assert_eq!((asked, paused), (3, 2));
    }

    #[test]
    fn wait_for_exit_does_not_wait_for_a_process_that_is_gone() {
        let mut paused = 0;
        assert!(wait_for_exit(77, 10, |_| false, || paused += 1));
        assert_eq!(paused, 0);
    }

    #[test]
    fn wait_for_exit_gives_up_on_a_process_that_stays() {
        let (mut asked, mut paused) = (0, 0);
        let gone = wait_for_exit(
            77,
            5,
            |_| {
                asked += 1;
                true
            },
            || paused += 1,
        );
        assert!(!gone);
        assert_eq!(paused, 5);
        assert_eq!(asked, 6);
    }

    #[test]
    fn eject_retries_while_the_image_is_in_use() {
        let (mut tries, mut paused) = (0, 0);
        let ejected = eject(
            5,
            || {
                tries += 1;
                tries == 3
            },
            || paused += 1,
        );
        assert!(ejected);
        assert_eq!((tries, paused), (3, 2));
    }

    #[test]
    fn eject_leaves_an_image_that_stays_in_use() {
        let (mut tries, mut paused) = (0, 0);
        let ejected = eject(
            4,
            || {
                tries += 1;
                false
            },
            || paused += 1,
        );
        assert!(!ejected);
        assert_eq!((tries, paused), (4, 3));
    }

    /// A folder of its own for one test, removed when the test ends.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let folder = std::env::temp_dir()
                .join(format!("redlines-install-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&folder);
            std::fs::create_dir_all(&folder).unwrap();
            Scratch(folder)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Makes a stand-in for an app bundle at `bundle`, whose executable says `version`.
    fn fake_app(bundle: &Path, version: &str) -> io::Result<()> {
        std::fs::create_dir_all(bundle.join("Contents/MacOS"))?;
        std::fs::write(bundle.join("Contents/MacOS/redlines-desktop"), version)
    }

    fn version_at(bundle: &Path) -> String {
        std::fs::read_to_string(bundle.join("Contents/MacOS/redlines-desktop")).unwrap()
    }

    fn names_in(folder: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(folder)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn put_in_place_installs_in_a_folder_it_makes() {
        let scratch = Scratch::new("fresh");
        let target = scratch.0.join("Applications/Redlines.app");
        put_in_place(&target, 4242, |copy| fake_app(copy, "new")).unwrap();
        assert_eq!(version_at(&target), "new");
        assert_eq!(names_in(&scratch.0.join("Applications")), ["Redlines.app"]);
    }

    #[test]
    fn put_in_place_replaces_an_installed_copy_and_leaves_nothing_else() {
        let scratch = Scratch::new("replace");
        let target = scratch.0.join("Redlines.app");
        fake_app(&target, "old").unwrap();
        std::fs::write(target.join("Contents/MacOS/extra"), "from the old copy").unwrap();
        put_in_place(&target, 4242, |copy| fake_app(copy, "new")).unwrap();
        assert_eq!(version_at(&target), "new");
        assert!(!target.join("Contents/MacOS/extra").exists());
        assert_eq!(names_in(&scratch.0), ["Redlines.app"]);
    }

    #[test]
    fn put_in_place_leaves_an_installed_copy_as_it_was_when_the_copy_fails() {
        let scratch = Scratch::new("fails");
        let target = scratch.0.join("Redlines.app");
        fake_app(&target, "old").unwrap();
        let failed = put_in_place(&target, 4242, |copy| {
            // Half a copy, then the disk is full.
            std::fs::create_dir_all(copy.join("Contents"))?;
            Err(io::Error::other("the disk is full"))
        });
        assert_eq!(failed.unwrap_err().to_string(), "the disk is full");
        assert_eq!(version_at(&target), "old");
        assert_eq!(names_in(&scratch.0), ["Redlines.app"]);
    }

    #[test]
    fn put_in_place_copies_into_a_hidden_folder_beside_the_target() {
        let scratch = Scratch::new("hidden");
        let target = scratch.0.join("Redlines.app");
        let mut used = None;
        put_in_place(&target, 4242, |copy| {
            used = Some(copy.to_path_buf());
            fake_app(copy, "new")
        })
        .unwrap();
        let used = used.unwrap();
        // Beside the target, so that putting it in place is a rename; hidden, and not an app,
        // so that Finder doesn't show it, should it stay behind.
        assert_eq!(used.parent(), Some(scratch.0.as_path()));
        let name = used.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with('.'), "{name}");
        assert!(!name.ends_with(".app"), "{name}");
        assert!(name.contains("4242"), "{name}");
    }

    #[test]
    fn put_in_place_clears_a_copy_a_failed_install_left_behind() {
        let scratch = Scratch::new("leftover");
        let target = scratch.0.join("Redlines.app");
        let mut used = None;
        put_in_place(&target, 4242, |copy| {
            used = Some(copy.to_path_buf());
            fake_app(copy, "first")
        })
        .unwrap();
        // A copy that an install which stopped halfway left in the same folder.
        let leftover = used.unwrap();
        fake_app(&leftover, "half").unwrap();
        std::fs::write(leftover.join("Contents/stale"), "").unwrap();
        put_in_place(&target, 4242, |copy| {
            assert!(!copy.exists());
            fake_app(copy, "second")
        })
        .unwrap();
        assert_eq!(version_at(&target), "second");
        assert_eq!(names_in(&scratch.0), ["Redlines.app"]);
    }
}
