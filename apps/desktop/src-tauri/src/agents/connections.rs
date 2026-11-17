//! The OpenClaw connections the person made (docs/research/openclaw-connection.md, "Secrets"): for
//! each, a record (the name it writes as, the computer, the level, the folders) in a file of the
//! app's own, and what the Gateway gave in files that nothing shows or copies.
//!
//! ```text
//! <app config>/openclaw/            0700
//!   connections.json                0600   the records; no secret in them
//!   <handle>/                       0700
//!     node-token                    0600   what the Gateway gave this Mac as a node
//!     operator-token                0600   and as an operator (replies, mentions)
//!     device-key                    0600   this connection's own key, made here, never sent
//! ```
//!
//! A secret is a [`Secret`]: it has no `Display`, no `Serialize` and a `Debug` that says nothing,
//! so it can't reach a log, a screen or a command's result by accident. No command returns one, and
//! the window can only *give* one (a token the person typed). The records are what the window sees,
//! with a flag for each secret saying only that it exists. A file that others could read is not
//! read (as `ssh` does with a key), and a connection is added, widened or removed only with the
//! person's answer to a native question, as an Agent Client Protocol agent is (`acp.rs`).
//!
//! Redlines never reads OpenClaw's own files (`~/.openclaw`) or its Gateway's token: these are
//! only what this app wrote itself.

use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::acp::Question;
use super::which::is_clean_path;

/// What the connection may do in documents. Everything an agent writes is a tracked change in its
/// name; `Edit` is what a later version may let it do beyond that, and is held back until then.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Level {
    /// View documents and answer questions; no change of any kind.
    Read,
    /// Suggest changes and comments, as tracked changes in its name. The default.
    Suggest,
    /// Reserved: more than suggesting.
    Edit,
}

/// A connection, as the record keeps it and as the window sees it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Connection {
    /// The handle it writes as: `moby-ada`. Also the name of its folder.
    pub handle: String,
    /// What people see and write after an @: `Moby`.
    pub name: String,
    /// The computer the Gateway is on, as the person knows it: `studio-mini`.
    pub computer: String,
    /// The Gateway's address, with no secret in it.
    pub url: String,
    /// The OpenClaw agent the person named, if they did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    pub level: Level,
    /// The folders its tools may reach, whole paths; none is the folder of the document sent with
    /// a request alone.
    pub folders: Vec<String>,
    /// Seconds since the epoch.
    pub created: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used: Option<u64>,
}

/// What the window may ask for a new connection.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct NewConnection {
    pub handle: String,
    pub name: String,
    pub computer: String,
    pub url: String,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub folders: Vec<String>,
}

/// What may change in a connection: its level and its folders.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
pub struct Change {
    #[serde(default)]
    pub level: Option<Level>,
    #[serde(default)]
    pub folders: Option<Vec<String>>,
}

/// The records and a flag for each secret that exists, which is all the window sees.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct View {
    #[serde(flatten)]
    pub connection: Connection,
    pub node_token: bool,
    pub operator_token: bool,
    pub device_key: bool,
}

/// The secrets a connection keeps, each in a file of its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    NodeToken,
    OperatorToken,
    DeviceKey,
}

impl Kind {
    fn file(self) -> &'static str {
        match self {
            Kind::NodeToken => "node-token",
            Kind::OperatorToken => "operator-token",
            Kind::DeviceKey => "device-key",
        }
    }
}

/// A secret. It can be given to the code that needs it and to nothing else.
pub struct Secret(String);

impl Secret {
    /// A token the person typed, or the Gateway gave: one line, no white space, no control
    /// character, not empty, not enormous.
    pub fn new(text: &str) -> Result<Self, String> {
        let text = text.trim();
        let plain = !text.is_empty()
            && text.len() <= 4096
            && text.chars().all(|c| !c.is_whitespace() && !c.is_control());
        if plain {
            Ok(Secret(text.to_owned()))
        } else {
            Err("That doesn’t look like a token: it has to be one line with no spaces.".to_owned())
        }
    }

    /// The text, for the one place that sends it where it belongs.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(…)")
    }
}

/// The most connections, folders per connection and length of a path that are kept.
const MAX_CONNECTIONS: usize = 16;
const MAX_FOLDERS: usize = 32;
const MAX_PATH: usize = 1024;

/// The connections, in their folder.
pub struct Connections {
    root: PathBuf,
    /// Held while a question is up and the records change, so that there is one at a time.
    changing: Mutex<()>,
}

impl Connections {
    /// `root` is the folder, which is made (0700) when something is first kept. With no folder of
    /// the app's own (an empty path) nothing is kept.
    pub fn new(root: PathBuf) -> Self {
        Connections {
            root,
            changing: Mutex::new(()),
        }
    }

    fn records(&self) -> PathBuf {
        self.root.join("connections.json")
    }

    fn folder_of(&self, handle: &str) -> PathBuf {
        self.root.join(handle)
    }

    /// The connections in the file, leaving out an entry this would not have written.
    pub fn list(&self) -> Vec<Connection> {
        if self.root.as_os_str().is_empty() {
            return Vec::new();
        }
        let Ok(text) = fs::read_to_string(self.records()) else {
            return Vec::new();
        };
        let all: Vec<Connection> = serde_json::from_str(&text).unwrap_or_default();
        let mut seen: Vec<String> = Vec::new();
        all.into_iter()
            .filter(|one| {
                let fine = is_handle(&one.handle)
                    && !seen.contains(&one.handle)
                    && one.folders.len() <= MAX_FOLDERS
                    && one
                        .folders
                        .iter()
                        .all(|folder| folder_problem(folder).is_none());
                seen.push(one.handle.clone());
                fine
            })
            .collect()
    }

    /// The connections with a flag for each secret that is kept.
    pub fn views(&self) -> Vec<View> {
        self.list()
            .into_iter()
            .map(|connection| {
                let has = |kind| self.has(&connection.handle, kind);
                View {
                    node_token: has(Kind::NodeToken),
                    operator_token: has(Kind::OperatorToken),
                    device_key: has(Kind::DeviceKey),
                    connection,
                }
            })
            .collect()
    }

    pub fn get(&self, handle: &str) -> Option<Connection> {
        self.list().into_iter().find(|one| one.handle == handle)
    }

    /// Adds a connection, once the person has allowed it (`ask` puts the question and gives the
    /// answer). Returns the list as it then is.
    pub fn add(
        &self,
        new: NewConnection,
        now: u64,
        ask: impl FnOnce(&Question) -> bool,
    ) -> Result<Vec<View>, String> {
        let _one_at_a_time = self.changing.try_lock().map_err(|_| BUSY.to_owned())?;
        if self.root.as_os_str().is_empty() {
            return Err("Redlines has no folder of its own to keep this in.".to_owned());
        }
        if !is_handle(&new.handle) {
            return Err(
                "The name it writes as is one lowercase word, such as moby-ada.".to_owned(),
            );
        }
        let name = new.name.trim();
        let computer = new.computer.trim();
        for text in [name, computer] {
            if text.is_empty() || text.chars().count() > 60 || !shows_as_itself(text) {
                return Err("Give a short name that shows as it is.".to_owned());
            }
        }
        if let Some(agent) = &new.agent
            && !is_handle(agent)
        {
            return Err("The OpenClaw agent’s name is one lowercase word.".to_owned());
        }
        if let Some(problem) = super::acp::gateway_url_problem(&new.url) {
            return Err(problem);
        }
        let url = new.url.clone();
        let mut folders = Vec::new();
        for folder in &new.folders {
            if let Some(problem) = folder_problem(folder) {
                return Err(problem);
            }
            if !folders.contains(folder) {
                folders.push(folder.clone());
            }
        }
        if folders.len() > MAX_FOLDERS {
            return Err("That is too many folders.".to_owned());
        }
        let mut all = self.list();
        if all.len() >= MAX_CONNECTIONS {
            return Err("That is as many OpenClaw connections as Redlines keeps.".to_owned());
        }
        if all.iter().any(|one| one.handle == new.handle) {
            return Err(format!(
                "There is already an agent that writes as {}.",
                new.handle
            ));
        }
        let question = Question {
            title: format!("Let {name} suggest changes in your documents?"),
            message: format!(
                "{name} is an OpenClaw agent on {computer}. It will write in your documents as \
                 {handle}, as tracked changes, and Redlines will show every one. {reach} Redlines \
                 limits what {name} does in your documents, not what {name} does elsewhere.",
                handle = new.handle,
                reach = reach_sentence(&folders),
            ),
            yes: "Allow",
            no: "Don’t Allow",
        };
        if !ask(&question) {
            return Err("Not added: you said no.".to_owned());
        }
        let connection = Connection {
            handle: new.handle,
            name: name.to_owned(),
            computer: computer.to_owned(),
            url,
            agent: new.agent,
            level: Level::Suggest,
            folders,
            created: now,
            last_used: None,
        };
        make_private_folder(&self.root).map_err(failed)?;
        make_private_folder(&self.folder_of(&connection.handle)).map_err(failed)?;
        all.push(connection);
        self.save(&all)?;
        Ok(self.views())
    }

    /// Changes a connection's level or folders. Giving it more (a higher level, another folder)
    /// asks the person; giving it less doesn't.
    pub fn update(
        &self,
        handle: &str,
        change: Change,
        ask: impl FnOnce(&Question) -> bool,
    ) -> Result<Vec<View>, String> {
        let _one_at_a_time = self.changing.try_lock().map_err(|_| BUSY.to_owned())?;
        let mut all = self.list();
        let one = all
            .iter_mut()
            .find(|one| one.handle == handle)
            .ok_or_else(|| "That connection isn’t there any more.".to_owned())?;
        let mut more = Vec::new();
        if let Some(level) = change.level
            && level > one.level
        {
            more.push(match level {
                Level::Read => unreachable!("Read is the lowest"),
                Level::Suggest => "suggest changes".to_owned(),
                Level::Edit => "edit more than suggest".to_owned(),
            });
        }
        let mut folders = one.folders.clone();
        if let Some(wanted) = &change.folders {
            if wanted.len() > MAX_FOLDERS {
                return Err("That is too many folders.".to_owned());
            }
            folders.clear();
            for folder in wanted {
                if let Some(problem) = folder_problem(folder) {
                    return Err(problem);
                }
                if !folders.contains(folder) {
                    folders.push(folder.clone());
                }
            }
            let added: Vec<_> = folders
                .iter()
                .filter(|f| !one.folders.contains(f))
                .collect();
            if !added.is_empty() {
                more.push(format!(
                    "reach {}",
                    added
                        .iter()
                        .map(|f| f.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
        }
        if !more.is_empty() {
            let question = Question {
                title: format!("Let {} do more in your documents?", one.name),
                message: format!("{} will be able to {}.", one.name, more.join(" and ")),
                yes: "Allow",
                no: "Don’t Allow",
            };
            if !ask(&question) {
                return Err("Not changed: you said no.".to_owned());
            }
        }
        if let Some(level) = change.level {
            one.level = level;
        }
        one.folders = folders;
        self.save(&all)?;
        Ok(self.views())
    }

    #[allow(dead_code)] // The node connection notes its use (OC 4).
    /// Notes that the connection was used, for "Last used".
    pub fn used(&self, handle: &str, now: u64) -> Result<(), String> {
        let _one_at_a_time = self.changing.lock().map_err(|_| BUSY.to_owned())?;
        let mut all = self.list();
        if let Some(one) = all.iter_mut().find(|one| one.handle == handle) {
            one.last_used = Some(now);
            self.save(&all)?;
        }
        Ok(())
    }

    /// Removes a connection and every secret of it. The records keep nothing of it.
    pub fn remove(&self, handle: &str) -> Result<Vec<View>, String> {
        let _one_at_a_time = self.changing.lock().map_err(|_| BUSY.to_owned())?;
        let mut all = self.list();
        all.retain(|one| one.handle != handle);
        if is_handle(handle) {
            // Gone, whatever else the folder holds: a file that shouldn't be there goes too.
            match fs::remove_dir_all(self.folder_of(handle)) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(failed(error)),
            }
        }
        if self.records().exists() {
            self.save(&all)?;
        }
        Ok(self.views())
    }

    /// Keeps a secret of a connection that is in the records, replacing the one it had.
    pub fn keep(&self, handle: &str, kind: Kind, secret: &Secret) -> Result<(), String> {
        let _one_at_a_time = self.changing.lock().map_err(|_| BUSY.to_owned())?;
        if self.get(handle).is_none() {
            return Err("That connection isn’t there any more.".to_owned());
        }
        write_private(
            &self.folder_of(handle).join(kind.file()),
            secret.expose().as_bytes(),
        )
        .map_err(failed)
    }

    /// Whether a secret is kept, and kept as it should be.
    pub fn has(&self, handle: &str, kind: Kind) -> bool {
        is_handle(handle) && self.secret(handle, kind).is_some()
    }

    /// A secret, for the code that sends it to the Gateway. `None` when there is none, or when the
    /// file or its folder could be read by others: that file is not trusted.
    pub fn secret(&self, handle: &str, kind: Kind) -> Option<Secret> {
        if !is_handle(handle) {
            return None;
        }
        let folder = self.folder_of(handle);
        let file = folder.join(kind.file());
        let private = |path: &Path| {
            fs::symlink_metadata(path).is_ok_and(|meta| {
                !meta.file_type().is_symlink() && meta.permissions().mode() & 0o077 == 0
            })
        };
        if !private(&folder) || !private(&file) {
            return None;
        }
        let text = fs::read_to_string(&file).ok()?;
        Secret::new(&text).ok()
    }

    #[allow(dead_code)] // The node connection signs with it (OC 4).
    /// This connection's device key, made the first time it is asked for: 32 random bytes of the
    /// operating system's, as hex, kept like any secret.
    pub fn device_key(&self, handle: &str) -> Result<Secret, String> {
        if let Some(existing) = self.secret(handle, Kind::DeviceKey) {
            return Ok(existing);
        }
        let mut seed = [0u8; 32];
        getrandom::fill(&mut seed).map_err(|error| format!("Couldn’t make a key: {error}"))?;
        let hex: String = seed.iter().map(|byte| format!("{byte:02x}")).collect();
        let secret = Secret::new(&hex)?;
        self.keep(handle, Kind::DeviceKey, &secret)?;
        Ok(secret)
    }

    fn save(&self, all: &[Connection]) -> Result<(), String> {
        let text = serde_json::to_string_pretty(all).map_err(|error| failed(error.into()))?;
        write_private(&self.records(), text.as_bytes()).map_err(failed)
    }
}

const BUSY: &str = "Another change to the OpenClaw agents is waiting for your answer.";

fn failed(error: io::Error) -> String {
    format!("Couldn’t keep that: {error}")
}

/// The sentence of the question that says what the connection can reach.
fn reach_sentence(folders: &[String]) -> String {
    match folders {
        [] => "It can reach the document you send it with a request, and nothing else.".to_owned(),
        [one] => format!("Its tools can open files in {one}."),
        many => format!(
            "Its tools can open files in {} folders: {}.",
            many.len(),
            many.join(", ")
        ),
    }
}

/// A handle or an agent's name: lowercase letters, digits and hyphens, starting with a letter or
/// digit. It names a folder, so nothing else can be in it.
pub fn is_handle(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 40
        && text.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && text
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Whether text shows as itself: no control character, line break or invisible mark.
fn shows_as_itself(text: &str) -> bool {
    super::acp::shows_as_itself(text)
}

/// Why a folder can't be reached by a connection, if it can't: a whole, clean path that isn't the
/// disk's root.
fn folder_problem(folder: &str) -> Option<String> {
    let fine = folder.starts_with('/')
        && folder != "/"
        && folder.len() <= MAX_PATH
        && is_clean_path(folder)
        && shows_as_itself(folder);
    (!fine).then(|| format!("{folder:?} isn’t a whole folder path."))
}

fn make_private_folder(folder: &Path) -> io::Result<()> {
    match fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(folder)
    {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    // Made earlier with another mode, by a person or another version: made private now.
    fs::set_permissions(folder, fs::Permissions::from_mode(0o700))
}

/// Writes a file that only this user can read, whole or not at all.
fn write_private(file: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(folder) = file.parent() {
        make_private_folder(folder)?;
    }
    let mut name = file.as_os_str().to_owned();
    name.push(format!(".{}.tmp", std::process::id()));
    let next = PathBuf::from(name);
    let written = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&next)
        .and_then(|mut out| {
            out.write_all(bytes)?;
            out.sync_all()
        });
    match written.and_then(|()| fs::rename(&next, file)) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&next);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("redlines-oc-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn mode(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    fn new(handle: &str) -> NewConnection {
        NewConnection {
            handle: handle.to_owned(),
            name: "Moby".to_owned(),
            computer: "studio-mini".to_owned(),
            url: "wss://studio-mini.yak-bebop.ts.net".to_owned(),
            agent: None,
            folders: vec!["/Users/ada/Documents/Work".to_owned()],
        }
    }

    fn yes(_: &Question) -> bool {
        true
    }

    #[test]
    fn a_new_connection_is_kept_with_suggest_and_its_folders_after_a_yes() {
        let root = scratch("add");
        let store = Connections::new(root.join("openclaw"));
        let mut asked = None;
        let views = store
            .add(new("moby-ada"), 100, |question| {
                asked = Some(question.title.clone() + &question.message);
                true
            })
            .unwrap();
        let asked = asked.unwrap();
        assert!(asked.contains("Let Moby suggest changes in your documents?"));
        assert!(asked.contains("moby-ada") && asked.contains("studio-mini"));
        assert!(asked.contains("/Users/ada/Documents/Work"));
        assert!(asked.contains("not what Moby does elsewhere"));
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].connection.level, Level::Suggest);
        assert_eq!(views[0].connection.created, 100);
        assert!(!views[0].node_token && !views[0].operator_token && !views[0].device_key);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_no_adds_nothing_and_makes_no_folder() {
        let root = scratch("no");
        let store = Connections::new(root.join("openclaw"));
        assert!(store.add(new("moby-ada"), 1, |_| false).is_err());
        assert!(store.list().is_empty());
        assert!(!root.join("openclaw").exists());
    }

    #[test]
    fn the_folders_and_the_records_are_private_and_hold_no_secret() {
        let root = scratch("modes");
        let store = Connections::new(root.join("openclaw"));
        store.add(new("moby-ada"), 1, yes).unwrap();
        let token = Secret::new("sk-very-secret-token-123").unwrap();
        store.keep("moby-ada", Kind::NodeToken, &token).unwrap();
        store.keep("moby-ada", Kind::OperatorToken, &token).unwrap();
        store.device_key("moby-ada").unwrap();
        let base = root.join("openclaw");
        assert_eq!(mode(&base), 0o700);
        assert_eq!(mode(&base.join("moby-ada")), 0o700);
        for file in [
            "connections.json",
            "moby-ada/node-token",
            "moby-ada/operator-token",
            "moby-ada/device-key",
        ] {
            assert_eq!(mode(&base.join(file)), 0o600, "{file}");
        }
        let records = fs::read_to_string(base.join("connections.json")).unwrap();
        assert!(!records.contains("sk-very-secret"));
        // What the window sees says only that the secrets exist.
        let views = store.views();
        let seen = serde_json::to_string(&views).unwrap();
        assert!(!seen.contains("sk-very-secret"), "{seen}");
        assert!(views[0].node_token && views[0].operator_token && views[0].device_key);
        assert!(seen.contains("\"node_token\":true"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_secret_never_prints() {
        let secret = Secret::new("sk-very-secret-token-123").unwrap();
        assert_eq!(format!("{secret:?}"), "Secret(…)");
        assert!(!format!("{secret:#?}").contains("sk-very"));
    }

    #[test]
    fn what_isnt_one_plain_line_is_not_a_token() {
        for bad in [
            "",
            "   ",
            "two words",
            "line\nbreak",
            "tab\there",
            &"x".repeat(5000),
            "bell\u{7}",
        ] {
            assert!(Secret::new(bad).is_err(), "{bad:?}");
        }
        assert_eq!(
            Secret::new("  abc.DEF-123_xyz  ").unwrap().expose(),
            "abc.DEF-123_xyz"
        );
    }

    #[test]
    fn a_file_that_others_can_read_is_not_trusted() {
        let root = scratch("loose");
        let store = Connections::new(root.join("openclaw"));
        store.add(new("moby-ada"), 1, yes).unwrap();
        let token = Secret::new("abc123").unwrap();
        store.keep("moby-ada", Kind::NodeToken, &token).unwrap();
        assert!(store.has("moby-ada", Kind::NodeToken));
        let file = root.join("openclaw/moby-ada/node-token");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!store.has("moby-ada", Kind::NodeToken));
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(store.has("moby-ada", Kind::NodeToken));
        fs::set_permissions(
            root.join("openclaw/moby-ada"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert!(!store.has("moby-ada", Kind::NodeToken));
        // A link in its place is not followed.
        fs::set_permissions(
            root.join("openclaw/moby-ada"),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        let elsewhere = root.join("elsewhere");
        fs::write(&elsewhere, "abc123").unwrap();
        fs::set_permissions(&elsewhere, fs::Permissions::from_mode(0o600)).unwrap();
        fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink(&elsewhere, &file).unwrap();
        assert!(!store.has("moby-ada", Kind::NodeToken));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_device_key_is_made_once_and_is_random_hex() {
        let root = scratch("key");
        let store = Connections::new(root.join("openclaw"));
        store.add(new("moby-ada"), 1, yes).unwrap();
        store.add(new("claw-ada"), 1, yes).unwrap();
        let first = store.device_key("moby-ada").unwrap();
        assert_eq!(first.expose().len(), 64);
        assert!(first.expose().chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            store.device_key("moby-ada").unwrap().expose(),
            first.expose()
        );
        assert_ne!(
            store.device_key("claw-ada").unwrap().expose(),
            first.expose()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn remove_deletes_the_record_and_every_file() {
        let root = scratch("remove");
        let store = Connections::new(root.join("openclaw"));
        store.add(new("moby-ada"), 1, yes).unwrap();
        store.add(new("claw-ada"), 1, yes).unwrap();
        store
            .keep("moby-ada", Kind::NodeToken, &Secret::new("abc").unwrap())
            .unwrap();
        store.device_key("moby-ada").unwrap();
        let views = store.remove("moby-ada").unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].connection.handle, "claw-ada");
        assert!(!root.join("openclaw/moby-ada").exists());
        assert!(store.secret("moby-ada", Kind::NodeToken).is_none());
        // Removing what isn't there, or a name that is a path, changes nothing and touches nothing.
        fs::write(root.join("keep.txt"), "x").unwrap();
        store.remove("moby-ada").unwrap();
        store.remove("../..").unwrap();
        assert!(root.join("keep.txt").exists());
        assert_eq!(store.list().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_secret_is_kept_only_for_a_connection_that_is_there() {
        let root = scratch("orphan");
        let store = Connections::new(root.join("openclaw"));
        let token = Secret::new("abc").unwrap();
        assert!(store.keep("nobody", Kind::NodeToken, &token).is_err());
        assert!(store.keep("../x", Kind::NodeToken, &token).is_err());
        assert!(!root.join("openclaw").exists());
    }

    #[test]
    fn handles_folders_and_addresses_are_checked() {
        let root = scratch("checks");
        let store = Connections::new(root.join("openclaw"));
        for handle in ["", "Moby", "moby ada", "../x", "a/b", "-x", &"a".repeat(41)] {
            assert!(store.add(new(handle), 1, yes).is_err(), "{handle:?}");
        }
        for folder in [
            "",
            "/",
            "relative/path",
            "/a/../b",
            "/a/./b",
            "/a/\u{202e}b",
            "/a\nb",
        ] {
            let mut bad = new("moby-ada");
            bad.folders = vec![folder.to_owned()];
            assert!(store.add(bad, 1, yes).is_err(), "{folder:?}");
        }
        for url in [
            "",
            "https://x",
            "wss://user:pw@host.example",
            "wss://host.example/?t=1",
        ] {
            let mut bad = new("moby-ada");
            bad.url = url.to_owned();
            assert!(store.add(bad, 1, yes).is_err(), "{url:?}");
        }
        let mut bad = new("moby-ada");
        bad.name = "Mo\nby".to_owned();
        assert!(store.add(bad, 1, yes).is_err());
        assert!(store.list().is_empty());
        store.add(new("moby-ada"), 1, yes).unwrap();
        assert!(
            store.add(new("moby-ada"), 2, yes).is_err(),
            "a handle is one connection's"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn giving_more_asks_and_giving_less_doesnt() {
        let root = scratch("update");
        let store = Connections::new(root.join("openclaw"));
        store.add(new("moby-ada"), 1, yes).unwrap();
        // Less: no question.
        let views = store
            .update(
                "moby-ada",
                Change {
                    level: Some(Level::Read),
                    folders: Some(Vec::new()),
                },
                |_| panic!("giving less asks nothing"),
            )
            .unwrap();
        assert_eq!(views[0].connection.level, Level::Read);
        assert!(views[0].connection.folders.is_empty());
        // More: a question, and a no changes nothing.
        let more = Change {
            level: Some(Level::Suggest),
            folders: Some(vec!["/Users/ada/Notes".to_owned()]),
        };
        let mut asked = String::new();
        assert!(
            store
                .update("moby-ada", more.clone(), |question| {
                    asked = question.message.clone();
                    false
                })
                .is_err()
        );
        assert!(asked.contains("suggest changes") && asked.contains("/Users/ada/Notes"));
        assert_eq!(store.get("moby-ada").unwrap().level, Level::Read);
        store.update("moby-ada", more, yes).unwrap();
        let now = store.get("moby-ada").unwrap();
        assert_eq!(
            (now.level, now.folders),
            (Level::Suggest, vec!["/Users/ada/Notes".to_owned()])
        );
        assert!(store.update("nobody", Change::default(), yes).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn use_is_noted_and_an_entry_a_file_cant_have_written_is_dropped() {
        let root = scratch("file");
        let store = Connections::new(root.join("openclaw"));
        store.add(new("moby-ada"), 1, yes).unwrap();
        store.used("moby-ada", 50).unwrap();
        assert_eq!(store.get("moby-ada").unwrap().last_used, Some(50));
        // A hand-edited record with a handle that is a path is not a connection.
        let file = root.join("openclaw/connections.json");
        let mut all: Vec<Connection> =
            serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        let mut evil = all[0].clone();
        evil.handle = "../../etc".to_owned();
        all.push(evil);
        fs::write(&file, serde_json::to_string(&all).unwrap()).unwrap();
        assert_eq!(store.list().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn with_no_folder_of_its_own_nothing_is_kept() {
        let store = Connections::new(PathBuf::new());
        assert!(store.list().is_empty());
        assert!(store.add(new("moby-ada"), 1, yes).is_err());
    }
}
