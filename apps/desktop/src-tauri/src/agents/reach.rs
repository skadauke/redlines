//! What an agent may read at "This folder and my home folder" (`everything` in the plugin API),
//! beyond the folder of the document: the home folder, without what is private or could be quoted
//! out. It is a list of folders to grant, never a list to take away from, so that whatever isn't on
//! it isn't readable at all, however the agent searches:
//!
//! - each visible folder in the home folder (`~/Documents`, `~/code`), not a hidden one
//!   (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`) and not `~/Library`;
//! - except the cloud folders in `~/Library`, where people's documents live: `CloudStorage`
//!   (Dropbox, Google Drive, OneDrive, Box) and `Mobile Documents` (iCloud Drive);
//! - each one by its name and by the folder it really is when that is a link, because the agents'
//!   limits look at where a link leads: a `~/Documents` that is a link into a Dropbox folder is
//!   common, and a limit that named only the link, or only `~/Library`, would be wrong either way;
//! - and only where a link leads to somewhere that is itself allowed: never `/` or a folder that
//!   holds the home folder, never a hidden folder or `~/Library` but for its cloud folders, and, if
//!   it leaves the home folder, only to a volume or what is in one (`/Volumes/Backup`, not
//!   `/Volumes`) or to `/Users/Shared`, so that a link can't put back what the rules leave out.
//!
//! The page asks for this list (`agent_home_reach`) to build an agent's command line, and the app
//! checks that line against the list it makes itself when the agent starts (`allowed.rs`), so a
//! window can't widen it. Nothing here reads a file or lists any folder but the home folder itself.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// The folders of `~/Library` that hold people's documents, which stay readable though `~/Library`
/// isn't: Dropbox, Google Drive, OneDrive and Box, and iCloud Drive.
const CLOUD_FOLDERS: [&str; 2] = ["CloudStorage", "Mobile Documents"];

/// What an agent may read at This folder and my home folder: the home folder, which Codex's limits
/// name whole (with what is left out), and the folders Claude's limits grant one by one. The page
/// asks for it (`agent_home_reach`) and builds the agent's command line from it, and the app makes
/// it again to check that line when the agent starts (`allowed.rs`).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct HomeReach {
    pub home: String,
    pub roots: Vec<String>,
}

/// Characters that mean something to a glob or to a table key in an agent's limits, and that a
/// home folder's name would turn into another rule: such a home isn't one that this scope can be
/// given for, and the run reads the folder only.
const NOT_IN_A_HOME: [char; 9] = ['*', '?', '[', ']', '{', '}', '!', '"', '\\'];

/// The reach at `home`, or nothing when there is none to give: no home folder, one whose name
/// holds a character of a glob, or one with no folder to read. The home folder is named as it
/// really is, since the agents' limits look at real paths: a home that is itself a link would
/// otherwise be named by a path they never see.
pub fn of(home: &Path) -> Option<HomeReach> {
    let real_home = fs::canonicalize(home).ok()?;
    let shown_home = shown(&real_home)?;
    if shown_home.chars().any(|c| NOT_IN_A_HOME.contains(&c)) {
        return None;
    }
    let roots = roots(&real_home);
    (!roots.is_empty()).then_some(HomeReach {
        home: shown_home,
        roots,
    })
}

/// A folder the home folder holds, or a link to one.
fn is_folder(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|metadata| metadata.is_dir())
}

/// A folder as a path that shows, if it does: absolute, and text.
fn shown(path: &Path) -> Option<String> {
    path.to_str()
        .filter(|path| path.starts_with('/'))
        .map(str::to_owned)
}

/// Where a link may lead outside the home folder, and nowhere else: strictly below a folder of
/// volumes (`/Volumes/Backup`, and what is in it, not `/Volumes`), and the shared folder itself or
/// what is in it. Every other place outside the home folder is the system's, however deep: the
/// firmlink to the Data volume (`/System/Volumes/Data/Users/ada/Library/Mail` is the same file as
/// `~/Library/Mail`, which `canonicalize` doesn't fold), `/private/etc`, `/private/var`, `/usr`.
struct Outside {
    below: Vec<PathBuf>,
    within: Vec<PathBuf>,
}

impl Outside {
    /// The places a person's own documents can be outside the home folder.
    fn volumes() -> Self {
        Outside {
            below: vec![PathBuf::from("/Volumes")],
            within: vec![PathBuf::from("/Users/Shared")],
        }
    }

    fn allows(&self, real: &Path) -> bool {
        self.below.iter().any(|base| {
            real.strip_prefix(base)
                .is_ok_and(|rest| rest.components().next().is_some())
        }) || self.within.iter().any(|base| real.starts_with(base))
    }
}

/// Whether a folder, as it really is, may be granted: not `/`, not the home folder, not a folder
/// above it, not a hidden folder or one inside a hidden folder, not in `~/Library` but for its
/// cloud folders and, where it is outside the home folder, only where `outside` says. `home` is the
/// home folder as it really is.
fn may_grant(home: &Path, real: &Path, outside: &Outside) -> bool {
    // The disk's root, a folder above the home folder, and the home folder itself.
    if home.starts_with(real) {
        return false;
    }
    let hidden = |path: &Path| {
        path.components().any(
            |part| matches!(part, Component::Normal(name) if name.to_string_lossy().starts_with('.')),
        )
    };
    match real.strip_prefix(home) {
        Ok(below) => {
            if hidden(below) {
                return false;
            }
            let mut parts = below.components();
            match parts.next() {
                Some(Component::Normal(first)) if first == "Library" => matches!(
                    parts.next(),
                    Some(Component::Normal(second)) if CLOUD_FOLDERS.iter().any(|cloud| second == *cloud)
                ),
                _ => true,
            }
        }
        Err(_) => outside.allows(real) && !hidden(real),
    }
}

/// The folders an agent may read in `home`, each once, in order: the name in the home folder and,
/// when that is a link, where it leads. A link that leads somewhere that isn't allowed
/// (`may_grant`) is left out with where it leads, since the name alone would reach it. Empty when
/// there is no home folder to read. `home` is the home folder as it really is.
pub fn roots(home: &Path) -> Vec<String> {
    roots_in(home, &Outside::volumes())
}

/// `roots`, with `outside` the places a link may lead outside the home folder.
fn roots_in(home: &Path, outside: &Outside) -> Vec<String> {
    let Ok(entries) = fs::read_dir(home) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            !name.starts_with('.') && name != "Library"
        })
        .map(|entry| entry.path())
        .collect();
    let library = home.join("Library");
    found.extend(CLOUD_FOLDERS.iter().map(|name| library.join(name)));

    let mut roots = Vec::new();
    for path in found.into_iter().filter(|path| is_folder(path)) {
        // A folder whose real path can't be told isn't granted: it might lead anywhere.
        let Ok(real) = fs::canonicalize(&path) else {
            continue;
        };
        if !may_grant(home, &real, outside) {
            continue;
        }
        // A folder whose name would be taken for a glob is left out with where it leads, rather
        // than the rest: the name alone would reach it.
        if [path.as_path(), real.as_path()].iter().any(|each| {
            each.to_string_lossy()
                .chars()
                .any(|c| NOT_IN_A_HOME.contains(&c))
        }) {
            continue;
        }
        roots.extend(shown(&path));
        if real != path {
            roots.extend(shown(&real));
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

/// A folder macOS protects, which an agent's reads reach: Redlines is the program responsible for
/// what the agents it starts read, so macOS asks the person about each of these once, for Redlines.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Protected {
    /// What people call it: `Documents`, `iCloud Drive`, `Dropbox`.
    pub name: String,
    pub folder: String,
}

/// The protected folders an agent's reads reach, from the roots it was granted: Desktop, Documents
/// and Downloads in the home folder, iCloud Drive, each cloud provider's folder in `CloudStorage`
/// (macOS asks about each apart), and any removable or network volume a link leads to.
pub fn protected(home: &Path, roots: &[String]) -> Vec<Protected> {
    let mut found: Vec<Protected> = Vec::new();
    let mut add = |name: &str, folder: &Path| {
        if let Some(folder) = shown(folder)
            && !found.iter().any(|known| known.folder == folder)
        {
            found.push(Protected {
                name: name.to_owned(),
                folder,
            });
        }
    };
    for root in roots {
        let root = Path::new(root);
        if let Ok(below) = root.strip_prefix(home) {
            let parts: Vec<&str> = below.iter().filter_map(|part| part.to_str()).collect();
            match parts.as_slice() {
                [name @ ("Desktop" | "Documents" | "Downloads"), ..] => add(name, &home.join(name)),
                ["Library", "Mobile Documents", ..] => {
                    add("iCloud Drive", &home.join("Library/Mobile Documents"));
                }
                ["Library", "CloudStorage"] => {
                    // Each provider's folder is asked about by itself.
                    for entry in fs::read_dir(root).into_iter().flatten().flatten() {
                        if let Some(name) = entry.file_name().to_str() {
                            add(name, &entry.path());
                        }
                    }
                }
                ["Library", "CloudStorage", name, ..] => {
                    add(name, &home.join("Library/CloudStorage").join(name));
                }
                _ => {}
            }
        } else if let Ok(below) = root.strip_prefix("/Volumes")
            && let Some(name) = below.iter().next().and_then(|part| part.to_str())
        {
            add(name, &Path::new("/Volumes").join(name));
        }
    }
    found.sort_by(|one, other| one.folder.cmp(&other.folder));
    found
}

/// The protected folders macOS isn't letting this program read, found by listing each from this
/// process, which is also what makes macOS ask the person the first time (the call waits for the
/// answer). A folder that is missing, or that fails any other way, isn't refused: only a refusal
/// is, which is `Operation not permitted` (and `Permission denied`).
pub fn refused(protected: &[Protected]) -> Vec<Protected> {
    protected
        .iter()
        .filter(|place| {
            fs::read_dir(&place.folder)
                .is_err_and(|error| error.kind() == std::io::ErrorKind::PermissionDenied)
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;
    use crate::agents::test_support::TempFolder;

    /// The temp folder as it really is, since `/var` is a link on a Mac and a root that is no link
    /// would otherwise be listed under both of its names.
    fn real(temp: &TempFolder) -> PathBuf {
        fs::canonicalize(temp.path()).unwrap()
    }

    /// Places a link may lead outside the home folder, for a test whose folders are in a temp
    /// folder and not on a volume: everything below `dir`.
    fn outside_at(dir: &Path) -> Outside {
        Outside {
            below: vec![dir.to_owned()],
            within: Vec::new(),
        }
    }

    fn folder(at: &Path, name: &str) -> PathBuf {
        let path = at.join(name);
        fs::create_dir_all(&path).unwrap();
        path
    }

    /// The roots of `home`, with the home folder written `~`.
    fn shown_roots(home: &Path) -> Vec<String> {
        roots(home)
            .into_iter()
            .map(|root| root.replacen(home.to_str().unwrap(), "~", 1))
            .collect()
    }

    #[test]
    fn the_visible_folders_of_the_home_folder_are_granted_and_nothing_else() {
        let temp = TempFolder::new("reach-plain");
        let home = real(&temp);
        for name in ["Documents", "code", "Desktop", "Downloads", "Movies"] {
            folder(&home, name);
        }
        // Hidden folders and files, which hold keys, settings and credentials.
        for name in [
            ".ssh", ".aws", ".gnupg", ".config", ".claude", ".codex", ".Trash",
        ] {
            folder(&home, name);
        }
        fs::write(home.join(".zshrc"), "export X=1\n").unwrap();
        // A file in the home folder isn't a folder to grant.
        fs::write(home.join("notes.md"), "hello\n").unwrap();
        // Library: mail, messages, browser data, keychains.
        for name in [
            "Mail",
            "Messages",
            "Safari",
            "Keychains",
            "Application Support",
        ] {
            folder(&home.join("Library"), name);
        }
        assert_eq!(
            shown_roots(&home),
            [
                "~/Desktop",
                "~/Documents",
                "~/Downloads",
                "~/Movies",
                "~/code"
            ]
        );
    }

    #[test]
    fn the_cloud_folders_in_library_are_granted_though_library_is_not() {
        let temp = TempFolder::new("reach-cloud");
        let home = real(&temp);
        folder(&home, "Documents");
        let library = folder(&home, "Library");
        folder(&library, "Mail");
        folder(&library, "CloudStorage/Dropbox");
        folder(&library, "Mobile Documents/com~apple~CloudDocs");
        folder(&library, "Safari");
        assert_eq!(
            shown_roots(&home),
            [
                "~/Documents",
                "~/Library/CloudStorage",
                "~/Library/Mobile Documents"
            ]
        );
    }

    #[test]
    fn a_cloud_folder_that_is_not_there_is_not_granted() {
        let temp = TempFolder::new("reach-no-cloud");
        let home = real(&temp);
        folder(&home, "Documents");
        folder(&home, "Library/Mail");
        assert_eq!(shown_roots(&home), ["~/Documents"]);
    }

    #[test]
    fn a_link_is_granted_by_its_name_and_by_where_it_leads() {
        let temp = TempFolder::new("reach-links");
        let outside = real(&temp);
        let home = folder(&outside, "home");
        let elsewhere = folder(&outside, "Dropbox/Documents");
        // ~/Documents is a link into a cloud folder, as it often is.
        symlink(&elsewhere, home.join("Documents")).unwrap();
        folder(&home, "code");
        // A link that goes nowhere is no folder.
        symlink(outside.join("gone"), home.join("dangling")).unwrap();
        // A link to a file isn't either.
        fs::write(outside.join("file.md"), "x\n").unwrap();
        symlink(outside.join("file.md"), home.join("file-link")).unwrap();

        let mut expected: Vec<String> =
            [home.join("Documents"), home.join("code"), elsewhere.clone()]
                .map(|path| path.to_str().unwrap().to_owned())
                .to_vec();
        expected.sort();
        // Both the link and the folder it leads to, where that is a place a link may lead.
        assert_eq!(roots_in(&home, &outside_at(&outside)), expected);
        // Anywhere else outside the home folder it is neither: the name alone would reach it.
        assert_eq!(
            roots(&home),
            [home.join("code").to_str().unwrap().to_owned()]
        );
    }

    #[test]
    fn a_document_really_in_cloud_storage_is_granted_though_library_is_not() {
        // A link in the home folder to a folder inside ~/Library/CloudStorage: the limit must name
        // the real path, and leaving ~/Library out must not catch it.
        let temp = TempFolder::new("reach-library-link");
        let home = folder(&real(&temp), "home");
        let docs = folder(&home, "Library/CloudStorage/Dropbox/Docs");
        symlink(&docs, home.join("Docs")).unwrap();
        let found = roots(&home);
        let named = |path: &Path| found.contains(&path.to_str().unwrap().to_owned());
        assert!(named(&home.join("Docs")));
        assert!(named(&docs));
        assert!(named(&home.join("Library/CloudStorage")));
        assert!(!named(&home.join("Library")));
        assert!(!named(&home.join("Library/Mail")));
    }

    #[test]
    fn only_a_folder_that_may_be_read_is_granted_whatever_leads_there() {
        let home = Path::new("/Users/ada");
        let outside = Outside::volumes();
        let may = |path: &str| may_grant(home, Path::new(path), &outside);
        // In the home folder, and in the cloud folders of ~/Library.
        for path in [
            "/Users/ada/Documents",
            "/Users/ada/Library/CloudStorage",
            "/Users/ada/Library/CloudStorage/Dropbox/Docs",
            "/Users/ada/Library/Mobile Documents/com~apple~CloudDocs",
        ] {
            assert!(may(path), "{path}");
        }
        // Left out by where it really is: the disk's root, what holds the home folder, the home
        // folder itself, hidden folders and what is in them, and ~/Library but for its cloud
        // folders.
        for path in [
            "/",
            "/Users",
            "/Users/ada",
            "/Users/ada/.ssh",
            "/Users/ada/.config/gh",
            "/Users/ada/code/project/.git",
            "/Users/ada/Library",
            "/Users/ada/Library/Mail",
            "/Users/ada/Library/Messages",
            "/Users/ada/Library/Keychains",
            "/Users/ada/Library/Application Support",
        ] {
            assert!(!may(path), "{path}");
        }
        // Outside the home folder: a volume or a folder of one, and the shared folder, but not
        // the folder of volumes, another top-level folder, or what is hidden.
        for path in [
            "/Volumes/Backup",
            "/Volumes/Backup/Notes",
            "/Users/Shared/Docs",
        ] {
            assert!(may(path), "{path}");
        }
        for path in [
            "/Volumes",
            "/opt",
            "/private",
            "/etc",
            "/Volumes/.timemachine",
            "/Volumes/Backup/.Trashes",
        ] {
            assert!(!may(path), "{path}");
        }
        // A home folder on a volume: the volume above it is above it.
        let on_a_volume = Path::new("/Volumes/Data/ada");
        let outside = Outside::volumes();
        assert!(!may_grant(
            on_a_volume,
            Path::new("/Volumes/Data"),
            &outside
        ));
        assert!(!may_grant(on_a_volume, Path::new("/Volumes"), &outside));
        assert!(may_grant(
            on_a_volume,
            Path::new("/Volumes/Data/ada/code"),
            &outside
        ));
        assert!(may_grant(
            on_a_volume,
            Path::new("/Volumes/Backup"),
            &outside
        ));
    }

    #[test]
    fn a_link_that_leads_somewhere_private_gets_neither_its_name_nor_where_it_leads() {
        let temp = TempFolder::new("reach-private-links");
        let outside = real(&temp);
        let home = folder(&outside, "home");
        folder(&home, "code/project/.git");
        for name in ["Mail", "Messages"] {
            folder(&home, &format!("Library/{name}"));
            symlink(home.join("Library").join(name), home.join(name)).unwrap();
        }
        folder(&home, ".ssh");
        symlink(home.join(".ssh"), home.join("keys")).unwrap();
        symlink(home.join("code/project/.git"), home.join("git")).unwrap();
        // Above the home folder, the home folder itself and the disk's root.
        symlink(&outside, home.join("up")).unwrap();
        symlink(&home, home.join("self")).unwrap();
        symlink("/", home.join("disk")).unwrap();
        // One that is fine, for contrast.
        let documents = folder(&outside, "Dropbox/Documents");
        symlink(&documents, home.join("Documents")).unwrap();

        let mut expected: Vec<String> = [home.join("Documents"), home.join("code"), documents]
            .map(|path| path.to_str().unwrap().to_owned())
            .to_vec();
        expected.sort();
        assert_eq!(roots_in(&home, &outside_at(&outside)), expected);
    }

    #[test]
    fn a_link_to_the_systems_own_folders_is_not_followed_however_deep() {
        // `/System/Volumes/Data/...` is the same file as the one under `/`, which `canonicalize`
        // doesn't fold, and `/private/etc`, `/usr/local` and `/opt/homebrew` are the system's.
        let home = Path::new("/Users/ada");
        let outside = Outside::volumes();
        for path in [
            "/System/Volumes/Data/Users/ada/Library/Mail",
            "/System/Volumes/Data/Users/ada/Library",
            "/System/Volumes/Data",
            "/private/etc",
            "/private/var/db",
            "/usr/local",
            "/opt/homebrew",
            "/Library/Keychains",
            "/Applications/Redlines.app",
            "/Volumes",
            "/Users",
            "/Users/bob",
        ] {
            assert!(!may_grant(home, Path::new(path), &outside), "{path}");
        }
        for path in [
            "/Volumes/Backup",
            "/Volumes/Backup/Notes",
            "/Users/Shared",
            "/Users/Shared/Docs",
        ] {
            assert!(may_grant(home, Path::new(path), &outside), "{path}");
        }
    }

    #[test]
    fn a_cloud_folder_that_is_a_link_to_a_private_place_is_not_granted() {
        let temp = TempFolder::new("reach-cloud-link");
        let home = folder(&real(&temp), "home");
        folder(&home, "code");
        folder(&home, ".ssh");
        folder(&home, "Library");
        symlink(home.join(".ssh"), home.join("Library/CloudStorage")).unwrap();
        assert_eq!(shown_roots(&home), ["~/code"]);
    }

    #[test]
    fn the_home_folder_is_named_as_it_really_is() {
        let temp = TempFolder::new("reach-home-link");
        let outside = real(&temp);
        let real_home = folder(&outside, "real-home");
        folder(&real_home, "Documents");
        let linked = outside.join("home-link");
        symlink(&real_home, &linked).unwrap();
        let reach = of(&linked).unwrap();
        assert_eq!(reach.home, real_home.to_str().unwrap());
        assert_eq!(
            reach.roots,
            [real_home.join("Documents").to_str().unwrap().to_owned()]
        );
        // A home folder that isn't there has no reach.
        assert_eq!(of(&outside.join("nobody")), None);
    }

    #[test]
    fn a_home_with_a_quote_or_a_backslash_in_its_name_has_no_reach() {
        let temp = TempFolder::new("reach-odd-names");
        let outside = real(&temp);
        for name in ["a\"b", "a\\b", "a*b", "a{b}"] {
            let home = folder(&outside, name);
            folder(&home, "Documents");
            assert_eq!(of(&home), None, "{name}");
        }
        // The same names, in a folder a link leads to, leave that folder out, and the link with
        // it, and not the rest.
        let home = folder(&outside, "home");
        folder(&home, "Documents");
        let odd = folder(&outside, "odd\"name");
        symlink(&odd, home.join("Odd")).unwrap();
        assert_eq!(
            roots_in(&home, &outside_at(&outside)),
            [home.join("Documents").to_str().unwrap()]
        );
    }

    fn names(places: &[Protected], home: &Path) -> Vec<(String, String)> {
        places
            .iter()
            .map(|place| {
                (
                    place.name.clone(),
                    place.folder.replacen(home.to_str().unwrap(), "~", 1),
                )
            })
            .collect()
    }

    #[test]
    fn the_protected_folders_are_those_macos_asks_about() {
        let temp = TempFolder::new("reach-protected");
        let home = real(&temp);
        for name in ["Desktop", "Documents", "Downloads", "code", "Movies"] {
            folder(&home, name);
        }
        folder(&home, "Library/Mobile Documents/com~apple~CloudDocs");
        folder(&home, "Library/CloudStorage/Dropbox");
        folder(&home, "Library/CloudStorage/GoogleDrive-ada@example.org");
        let found = names(&protected(&home, &roots(&home)), &home);
        assert_eq!(
            found,
            [
                ("Desktop", "~/Desktop"),
                ("Documents", "~/Documents"),
                ("Downloads", "~/Downloads"),
                ("Dropbox", "~/Library/CloudStorage/Dropbox"),
                (
                    "GoogleDrive-ada@example.org",
                    "~/Library/CloudStorage/GoogleDrive-ada@example.org"
                ),
                ("iCloud Drive", "~/Library/Mobile Documents"),
            ]
            .map(|(name, folder)| (name.to_owned(), folder.to_owned()))
        );
    }

    #[test]
    fn a_link_into_a_volume_or_a_cloud_folder_is_protected_by_where_it_leads() {
        let temp = TempFolder::new("reach-protected-links");
        let home = folder(&real(&temp), "home");
        folder(&home, "Library/CloudStorage/Dropbox/Docs");
        symlink(
            home.join("Library/CloudStorage/Dropbox/Docs"),
            home.join("Notes"),
        )
        .unwrap();
        let roots = roots(&home);
        // The link's own name is nothing macOS asks about; the folder it leads to is Dropbox's.
        assert_eq!(
            names(&protected(&home, &roots), &home),
            [(
                "Dropbox".to_owned(),
                "~/Library/CloudStorage/Dropbox".to_owned()
            )]
        );
        // A volume a link leads to is asked about by its name.
        let by_hand = vec![
            "/Volumes/Backup/notes".to_owned(),
            "/Volumes/Backup".to_owned(),
        ];
        assert_eq!(
            protected(&home, &by_hand),
            [Protected {
                name: "Backup".to_owned(),
                folder: "/Volumes/Backup".to_owned()
            }]
        );
    }

    #[test]
    fn nothing_protected_is_listed_for_a_home_folder_with_none() {
        let temp = TempFolder::new("reach-unprotected");
        let home = real(&temp);
        folder(&home, "code");
        assert!(protected(&home, &roots(&home)).is_empty());
    }

    #[test]
    fn only_a_refusal_is_a_refusal() {
        use std::os::unix::fs::PermissionsExt;
        let temp = TempFolder::new("reach-refused");
        let home = real(&temp);
        let open = folder(&home, "Documents");
        let shut = folder(&home, "Desktop");
        fs::set_permissions(&shut, fs::Permissions::from_mode(0o000)).unwrap();
        let places = vec![
            Protected {
                name: "Documents".to_owned(),
                folder: open.to_str().unwrap().to_owned(),
            },
            Protected {
                name: "Desktop".to_owned(),
                folder: shut.to_str().unwrap().to_owned(),
            },
            Protected {
                name: "Gone".to_owned(),
                folder: home.join("Gone").to_str().unwrap().to_owned(),
            },
        ];
        let refused = refused(&places);
        fs::set_permissions(&shut, fs::Permissions::from_mode(0o755)).unwrap();
        // Root reads any folder, so that is all a test run as root can say.
        // SAFETY: `geteuid` has no effect and no arguments.
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        assert_eq!(
            refused
                .iter()
                .map(|place| place.name.as_str())
                .collect::<Vec<_>>(),
            ["Desktop"]
        );
    }

    #[test]
    fn the_reach_is_the_home_folder_and_its_roots() {
        let temp = TempFolder::new("reach-of");
        let home = real(&temp);
        folder(&home, "Documents");
        folder(&home, "code");
        let reach = of(&home).unwrap();
        assert_eq!(reach.home, home.to_str().unwrap());
        assert_eq!(reach.roots, roots(&home));
    }

    #[test]
    fn there_is_no_reach_where_a_name_would_be_taken_for_a_glob() {
        let temp = TempFolder::new("reach-glob-home");
        let home = folder(&real(&temp), "ho[me]");
        folder(&home, "Documents");
        assert_eq!(of(&home), None);

        // A folder of that kind is left out, and the rest stays.
        let temp = TempFolder::new("reach-glob-root");
        let home = real(&temp);
        folder(&home, "Documents");
        folder(&home, "what?");
        folder(&home, "a{b}");
        let reach = of(&home).unwrap();
        assert_eq!(
            reach.roots,
            [home.join("Documents").to_str().unwrap().to_owned()]
        );
    }

    #[test]
    fn there_is_no_reach_with_nothing_to_read() {
        let temp = TempFolder::new("reach-nothing");
        let home = real(&temp);
        folder(&home, ".ssh");
        assert_eq!(of(&home), None);
        assert_eq!(of(&temp.path().join("nobody")), None);
        assert_eq!(of(Path::new("")), None);
    }

    #[test]
    fn a_missing_home_folder_grants_nothing() {
        let temp = TempFolder::new("reach-none");
        assert!(roots(&temp.path().join("nobody")).is_empty());
    }

    #[test]
    fn the_list_is_sorted_and_has_each_folder_once() {
        let temp = TempFolder::new("reach-order");
        let home = real(&temp);
        for name in ["b", "a", "C", "ä"] {
            folder(&home, name);
        }
        let found = roots(&home);
        let mut sorted = found.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(found, sorted);
        assert_eq!(found.len(), 4);
    }
}
