//! The Redlines skill, installed from Preferences into the folder an agent reads its skills from.
//!
//! A skill is a folder with a `SKILL.md` that teaches an agent that a file is a Redlines file, to
//! read it with `redlines view --review`, and to change it only through the `redlines` command
//! line, so that its edits are tracked suggestions in its name (`integrations/skill/body.md`). It
//! is written once and made into the copies below (`scripts/build-skills.ts`), which this carries
//! inside the app, so that an updated app brings an updated skill. Each copy ends with the version
//! it is (`<!-- redlines-skill 3 -->`), which is how a copy that was installed shows as older than
//! the app's.
//!
//! Each agent reads personal skills from a folder of its own, under the home folder:
//!
//! - Claude Code: `.claude/skills/redlines` (it doesn't read `.agents/skills`);
//! - Codex: `.agents/skills/redlines`, which OpenClaw reads too;
//! - OpenClaw: `.openclaw/skills/redlines`.
//!
//! What is written is one file, `SKILL.md`, in a folder of the skill's own, and the only file that
//! is replaced is a copy of this skill: a file there that isn't one, a skill of somebody's own with
//! the same name, and a folder or a file that is a link are somebody else's, and are left as they
//! are, as the command line's link is (`command_line.rs`). The window names the agent and nothing
//! more: no path, and no text, comes from the page.

use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// The copies, as `scripts/build-skills.ts` writes them. Codex and OpenClaw have one text; each is
/// kept where its agent's folder of the repository has it.
const CLAUDE_COPY: &str =
    include_str!("../../../../../integrations/claude-code/skills/redlines/SKILL.md");
const CODEX_COPY: &str = include_str!("../../../../../integrations/codex/skills/redlines/SKILL.md");
const OPENCLAW_COPY: &str =
    include_str!("../../../../../integrations/openclaw/skills/redlines/SKILL.md");

/// The name of the file an agent reads, and of the folder it is in.
const FILE: &str = "SKILL.md";

/// The most of an installed file that is read to tell what it is: a skill is a few thousand bytes.
const LARGEST: u64 = 256 * 1024;

/// An agent that has a skill of Redlines to install.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Claude,
    Codex,
    OpenClaw,
}

impl Kind {
    /// The agent with this id, as Preferences names it.
    pub fn named(id: &str) -> Option<Kind> {
        match id {
            "claude" => Some(Kind::Claude),
            "codex" => Some(Kind::Codex),
            "openclaw" => Some(Kind::OpenClaw),
            _ => None,
        }
    }

    /// The skill's folder, below the home folder.
    fn relative_folder(self) -> &'static str {
        match self {
            Kind::Claude => ".claude/skills/redlines",
            Kind::Codex => ".agents/skills/redlines",
            Kind::OpenClaw => ".openclaw/skills/redlines",
        }
    }

    /// This app's copy of the skill for the agent.
    fn copy(self) -> &'static str {
        match self {
            Kind::Claude => CLAUDE_COPY,
            Kind::Codex => CODEX_COPY,
            Kind::OpenClaw => OPENCLAW_COPY,
        }
    }

    /// The version of this app's copy.
    fn current(self) -> u32 {
        version_of(self.copy()).unwrap_or(0)
    }
}

/// What is at an agent's skill folder, against this app's copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    /// There is no copy of the skill there.
    Missing,
    /// A copy of this app's version.
    Current,
    /// A copy older than this app's, or one with no version, as a copy made by hand has: it can be
    /// replaced.
    Older,
    /// A copy newer than this app's, as a newer app made it: it is left as it is.
    Newer,
    /// Something else, which isn't this skill's to replace: a link, a skill of somebody's own with
    /// the same name, or what isn't a folder.
    Other,
}

/// Where an agent's skill is, and what is there.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The skill's folder, as a person writes it: `~/.claude/skills/redlines`.
    pub folder: String,
    pub state: State,
    /// The version of the copy that is there, when it has one.
    pub version: Option<u32>,
    /// The version of this app's copy.
    pub current: u32,
    /// For `newer` and `other`, a sentence that says why it is left as it is.
    pub message: Option<String>,
}

/// Whether the `redlines` command is where an agent's shell finds it, which the skill needs.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "found", rename_all = "camelCase")]
pub enum CommandLine {
    /// A login shell finds it.
    OnPath,
    /// It is linked in a folder that isn't on a shell's `PATH`: where, as a person writes it.
    OffPath { linked: String },
    /// There is none: Preferences › General installs it.
    Missing,
}

/// What installing did: the folder the skill is in, its version, and the command line's state.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub folder: String,
    pub version: u32,
    pub command_line: CommandLine,
}

/// The home folder, which the skills' folders are below.
pub fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
        .ok_or_else(|| "Redlines can’t tell where your home folder is.".to_owned())
}

/// A path as a person writes it, with `~` for the home folder.
fn tilde(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

/// The version a copy ends with (`<!-- redlines-skill 3 -->`).
pub fn version_of(text: &str) -> Option<u32> {
    let tail = text.trim_end().strip_suffix("-->")?.trim_end();
    let (head, number) = tail.rsplit_once(' ')?;
    head.ends_with("<!-- redlines-skill")
        .then(|| number.parse().ok())?
}

/// Whether a text is a copy of this skill, of any version: its front matter names `redlines`, and
/// it has the heading every copy has. A skill of somebody's own with the same name isn't.
fn is_ours(text: &str) -> bool {
    let Some((front, body)) = text
        .strip_prefix("---\n")
        .and_then(|rest| rest.split_once("\n---\n"))
    else {
        return false;
    };
    front.lines().any(|line| line == "name: redlines")
        && body.contains("# Working in a Redlines file")
}

/// What was found at a skill folder.
struct Found {
    state: State,
    version: Option<u32>,
    message: Option<String>,
}

impl Found {
    fn of(state: State) -> Self {
        Found {
            state,
            version: None,
            message: None,
        }
    }

    fn left(state: State, message: String) -> Self {
        Found {
            state,
            version: None,
            message: Some(message),
        }
    }
}

/// The nearest part above `path` that exists, when it is a link that leads nowhere: nothing can be
/// made below it, and an install would fail with a message about a file that exists.
fn dangling_above(path: &Path) -> Option<PathBuf> {
    let above = path
        .ancestors()
        .skip(1)
        .find(|above| fs::symlink_metadata(above).is_ok())?;
    let is_link = fs::symlink_metadata(above).is_ok_and(|found| found.file_type().is_symlink());
    (is_link && fs::metadata(above).is_err()).then(|| above.to_owned())
}

/// Looks at the skill folder of an agent: what is there, and whether it is this skill's to replace.
/// Nothing is followed that is a link, and nothing is changed.
fn inspect(kind: Kind, folder: &Path, shown: &str) -> Found {
    let other = |sentence: String| Found::left(State::Other, sentence);
    let left = |what: String| other(format!("{what}, and Redlines leaves it as it is."));
    match fs::symlink_metadata(folder) {
        // Nothing there, unless the way to it goes through a link that leads nowhere, which no
        // folder can be made below.
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return match dangling_above(folder) {
                Some(link) => {
                    // The link as a person writes it: what of `shown` is above where it leads.
                    let name = folder
                        .strip_prefix(&link)
                        .ok()
                        .and_then(|rest| shown.strip_suffix(&format!("/{}", rest.display())))
                        .unwrap_or(shown);
                    other(format!(
                        "{name} is a link that leads nowhere, and Redlines leaves links as they are."
                    ))
                }
                None => Found::of(State::Missing),
            };
        }
        // A part of the path above it is a file, so there is no folder to put it in.
        Err(error) if error.kind() == io::ErrorKind::NotADirectory => {
            return other(format!(
                "Redlines can’t put the skill in {shown}: a part of the path isn’t a folder."
            ));
        }
        Err(error) => return other(format!("Redlines can’t look at {shown}: {error}.")),
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return other(format!(
                "{shown} is a link, and Redlines leaves links as they are."
            ));
        }
        Ok(metadata) if !metadata.is_dir() => return left(format!("{shown} isn’t a folder")),
        Ok(_) => {}
    }
    let file = folder.join(FILE);
    let metadata = match fs::symlink_metadata(&file) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Found::of(State::Missing),
        Err(error) => return other(format!("Redlines can’t look at {shown}/{FILE}: {error}.")),
        Ok(metadata) => metadata,
    };
    if metadata.file_type().is_symlink() {
        return other(format!(
            "{shown}/{FILE} is a link, and Redlines leaves links as they are."
        ));
    }
    let not_a_copy = || left(format!("{shown}/{FILE} isn’t a copy of the Redlines skill"));
    if !metadata.is_file() || metadata.len() > LARGEST {
        return not_a_copy();
    }
    let Ok(text) = fs::read_to_string(&file) else {
        return not_a_copy();
    };
    if !is_ours(&text) {
        return left(format!("{shown}/{FILE} is a different skill"));
    }
    let current = kind.current();
    let version = version_of(&text);
    let state = match version {
        Some(version) if version == current => State::Current,
        Some(version) if version > current => State::Newer,
        _ => State::Older,
    };
    Found {
        state,
        version,
        message: (state == State::Newer).then(|| {
            format!("The skill in {shown} is newer than this app’s, so it stays as it is.")
        }),
    }
}

/// Where an agent's skill is, and whether what is there is this app's copy, an older one, or not
/// the skill's to replace.
pub fn status(kind: Kind, home: &Path) -> Status {
    let folder = home.join(kind.relative_folder());
    let shown = tilde(&folder, home);
    let found = inspect(kind, &folder, &shown);
    Status {
        folder: shown,
        state: found.state,
        version: found.version,
        current: kind.current(),
        message: found.message,
    }
}

/// What a copy written is.
#[derive(Debug, PartialEq)]
pub struct Written {
    pub folder: String,
    pub version: u32,
}

/// Writes this app's copy of the skill for an agent: where there is none, or an older one. A copy
/// that is there already, of this version, is left; a newer one, and what isn't a copy of this
/// skill, refuse with the sentence that says why. The file is written whole, and then moved into
/// place, so that an agent never reads half of it.
pub fn install(kind: Kind, home: &Path) -> Result<Written, String> {
    let folder = home.join(kind.relative_folder());
    let shown = tilde(&folder, home);
    let found = inspect(kind, &folder, &shown);
    let written = Written {
        folder: shown.clone(),
        version: kind.current(),
    };
    match found.state {
        State::Current => return Ok(written),
        State::Newer | State::Other => return Err(found.message.unwrap_or_default()),
        State::Missing | State::Older => {}
    }
    fs::create_dir_all(&folder).map_err(|error| format!("Couldn’t make {shown}: {error}"))?;
    write_whole(&folder, kind.copy())
        .map_err(|error| format!("Couldn’t write {shown}/{FILE}: {error}"))?;
    Ok(written)
}

/// Writes `text` as the skill's file in `folder`: to a file of its own name first, which is then
/// moved over the skill's file, so that a reader sees the old file or the new one.
fn write_whole(folder: &Path, text: &str) -> io::Result<()> {
    // Never a name another call of this process has, which the clock alone doesn't promise: a
    // loser's cleanup would otherwise remove the file the winner is about to move into place.
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos());
    let count = NEXT.fetch_add(1, Ordering::Relaxed);
    let temporary = folder.join(format!(".{FILE}.{}.{count}.{unique}", std::process::id()));
    let written = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o644)
        .open(&temporary)
        .and_then(|mut file| {
            file.write_all(text.as_bytes())?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&temporary, folder.join(FILE)));
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written
}

/// Whether the `redlines` command is where an agent's shell finds it. `on_path` is where a login
/// shell found it, if it did. A command linked in the places the app links it in, which aren't on a
/// shell's `PATH`, is found there and said so.
pub fn command_line(on_path: Option<&str>, home: &Path) -> CommandLine {
    if on_path.is_some() {
        return CommandLine::OnPath;
    }
    [
        home.join(".local/bin/redlines"),
        PathBuf::from("/usr/local/bin/redlines"),
    ]
    .iter()
    .find(|link| fs::metadata(link).is_ok())
    .map_or(CommandLine::Missing, |link| CommandLine::OffPath {
        linked: tilde(link, home),
    })
}

/// What installing says: the written skill, and the command line it needs.
pub fn installed(written: Written, command_line: CommandLine) -> Installed {
    Installed {
        folder: written.folder,
        version: written.version,
        command_line,
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{PermissionsExt, symlink};

    use super::*;
    use crate::agents::test_support::TempFolder;

    const KINDS: [Kind; 3] = [Kind::Claude, Kind::Codex, Kind::OpenClaw];

    /// A copy as an older Redlines wrote it: the same skill, at `version`, or with none.
    fn older_copy(kind: Kind, version: Option<u32>) -> String {
        let copy = kind.copy();
        let end = copy.rfind("<!-- redlines-skill").unwrap();
        match version {
            Some(version) => format!("{}<!-- redlines-skill {version} -->\n", &copy[..end]),
            None => copy[..end].trim_end().to_owned() + "\n",
        }
    }

    fn put(home: &Path, kind: Kind, text: &str) -> PathBuf {
        let folder = home.join(kind.relative_folder());
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(FILE), text).unwrap();
        folder
    }

    #[test]
    fn every_copy_is_a_copy_of_the_skill_at_one_version() {
        let versions: Vec<_> = KINDS.iter().map(|kind| version_of(kind.copy())).collect();
        assert!(
            versions[0].is_some_and(|version| version > 0),
            "{versions:?}"
        );
        assert!(versions.iter().all(|version| *version == versions[0]));
        for kind in KINDS {
            assert!(is_ours(kind.copy()), "{kind:?} is the skill");
            // Once, at the end: that is where an installed copy is read for its version.
            assert_eq!(kind.copy().matches("redlines-skill").count(), 1);
        }
    }

    #[test]
    fn claude_names_itself_and_the_others_name_their_own() {
        assert!(CLAUDE_COPY.contains("--as claude-<person> --name Claude"));
        assert!(!CLAUDE_COPY.contains("<you>"));
        assert_eq!(CODEX_COPY, OPENCLAW_COPY);
        assert!(CODEX_COPY.contains("--as <you>-<person> --name <You>"));
        // OpenClaw loads it only where the `redlines` program is.
        assert!(OPENCLAW_COPY.contains(r#""requires": { "bins": ["redlines"] }"#));
    }

    #[test]
    fn each_agent_reads_its_skills_from_its_own_folder() {
        let home = Path::new("/Users/ada");
        let shown: Vec<_> = KINDS
            .iter()
            .map(|kind| status(*kind, home).folder)
            .collect();
        assert_eq!(
            shown,
            [
                "~/.claude/skills/redlines",
                "~/.agents/skills/redlines",
                "~/.openclaw/skills/redlines"
            ]
        );
        assert_eq!(Kind::named("claude"), Some(Kind::Claude));
        assert_eq!(Kind::named("codex"), Some(Kind::Codex));
        assert_eq!(Kind::named("openclaw"), Some(Kind::OpenClaw));
        // Only an agent's id is a name; nothing of a path goes through.
        for other in ["", "Claude", "../x", "claude/../../x", "gemini"] {
            assert_eq!(Kind::named(other), None, "{other}");
        }
    }

    #[test]
    fn the_version_is_what_a_copy_ends_with() {
        assert_eq!(version_of("text\n\n<!-- redlines-skill 12 -->\n"), Some(12));
        assert_eq!(version_of("text <!-- redlines-skill 3 -->"), Some(3));
        assert_eq!(version_of("<!-- redlines-skill 3 -->\nmore text\n"), None);
        assert_eq!(version_of("<!-- redlines-skill x -->\n"), None);
        assert_eq!(version_of("<!-- other 3 -->\n"), None);
        assert_eq!(version_of(""), None);
    }

    #[test]
    fn nothing_there_is_missing() {
        let temp = TempFolder::new("skill-missing");
        for kind in KINDS {
            let status = status(kind, temp.path());
            assert_eq!(status.state, State::Missing);
            assert_eq!(status.version, None);
            assert_eq!(status.current, kind.current());
            assert_eq!(status.message, None);
        }
        // A folder with other files in it, and no skill, is missing the skill.
        let folder = temp.path().join(Kind::Claude.relative_folder());
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("notes.txt"), "mine").unwrap();
        assert_eq!(status(Kind::Claude, temp.path()).state, State::Missing);
    }

    #[test]
    fn installing_writes_the_copy_where_the_agent_reads_it() {
        for kind in KINDS {
            let temp = TempFolder::new("skill-install");
            let written = install(kind, temp.path()).unwrap();
            assert_eq!(written.version, kind.current());
            let file = temp.path().join(kind.relative_folder()).join(FILE);
            assert_eq!(fs::read_to_string(&file).unwrap(), kind.copy());
            assert_eq!(
                fs::metadata(&file).unwrap().permissions().mode() & 0o777 & !0o022,
                0o644 & !0o022
            );
            let now = status(kind, temp.path());
            assert_eq!(
                (now.state, now.version),
                (State::Current, Some(kind.current()))
            );
            // Nothing else is left in the folder, such as the file it was written to first.
            let names: Vec<_> = fs::read_dir(file.parent().unwrap())
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .collect();
            assert_eq!(names, [FILE]);
        }
    }

    #[test]
    fn installing_again_changes_nothing() {
        let temp = TempFolder::new("skill-again");
        install(Kind::Codex, temp.path()).unwrap();
        let file = temp.path().join(Kind::Codex.relative_folder()).join(FILE);
        let before = fs::metadata(&file).unwrap().modified().unwrap();
        assert!(install(Kind::Codex, temp.path()).is_ok());
        assert_eq!(fs::metadata(&file).unwrap().modified().unwrap(), before);
    }

    #[test]
    fn an_older_copy_is_updated() {
        for version in [Some(0), None] {
            let temp = TempFolder::new("skill-older");
            put(
                temp.path(),
                Kind::Claude,
                &older_copy(Kind::Claude, version),
            );
            let before = status(Kind::Claude, temp.path());
            assert_eq!(before.state, State::Older, "{version:?}");
            assert_eq!(before.version, version);
            install(Kind::Claude, temp.path()).unwrap();
            let file = temp.path().join(Kind::Claude.relative_folder()).join(FILE);
            assert_eq!(fs::read_to_string(file).unwrap(), Kind::Claude.copy());
            assert_eq!(status(Kind::Claude, temp.path()).state, State::Current);
        }
    }

    #[test]
    fn a_newer_copy_is_left_as_it_is() {
        let temp = TempFolder::new("skill-newer");
        let newer = older_copy(Kind::Codex, Some(Kind::Codex.current() + 1));
        let folder = put(temp.path(), Kind::Codex, &newer);
        let found = status(Kind::Codex, temp.path());
        assert_eq!(found.state, State::Newer);
        assert_eq!(found.version, Some(Kind::Codex.current() + 1));
        assert!(
            found
                .message
                .as_deref()
                .unwrap()
                .contains("newer than this app’s")
        );
        let refused = install(Kind::Codex, temp.path()).unwrap_err();
        assert!(refused.contains("newer"), "{refused}");
        assert_eq!(fs::read_to_string(folder.join(FILE)).unwrap(), newer);
    }

    #[test]
    fn a_skill_of_somebody_elses_with_the_name_is_left_as_it_is() {
        let temp = TempFolder::new("skill-other");
        let theirs = "---\nname: redlines\ndescription: My own notes on redlining houses.\n---\n\n# Redlining\n";
        let folder = put(temp.path(), Kind::Claude, theirs);
        let found = status(Kind::Claude, temp.path());
        assert_eq!(found.state, State::Other);
        assert!(
            found
                .message
                .as_deref()
                .unwrap()
                .contains("a different skill")
        );
        let refused = install(Kind::Claude, temp.path()).unwrap_err();
        assert!(
            refused.contains("~/.claude/skills/redlines/SKILL.md"),
            "{refused}"
        );
        assert_eq!(fs::read_to_string(folder.join(FILE)).unwrap(), theirs);
        // What isn't text, or is too large to be a skill, isn't a copy either.
        fs::write(folder.join(FILE), [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(status(Kind::Claude, temp.path()).state, State::Other);
        fs::write(folder.join(FILE), vec![b'x'; (LARGEST + 1) as usize]).unwrap();
        assert_eq!(status(Kind::Claude, temp.path()).state, State::Other);
        assert!(install(Kind::Claude, temp.path()).is_err());
    }

    #[test]
    fn a_link_is_left_as_it_is_and_nothing_is_written_through_it() {
        // The folder is a link, as a skills folder kept in a repository of dotfiles is.
        let temp = TempFolder::new("skill-link");
        let mine = temp.path().join("dotfiles/redlines");
        fs::create_dir_all(&mine).unwrap();
        let folder = temp.path().join(Kind::Claude.relative_folder());
        fs::create_dir_all(folder.parent().unwrap()).unwrap();
        symlink(&mine, &folder).unwrap();
        assert_eq!(status(Kind::Claude, temp.path()).state, State::Other);
        let refused = install(Kind::Claude, temp.path()).unwrap_err();
        assert!(refused.contains("is a link"), "{refused}");
        assert!(!mine.join(FILE).exists());

        // The file is a link.
        let other = TempFolder::new("skill-link-file");
        let real = other.path().join("real.md");
        fs::write(&real, Kind::Codex.copy()).unwrap();
        let folder = other.path().join(Kind::Codex.relative_folder());
        fs::create_dir_all(&folder).unwrap();
        symlink(&real, folder.join(FILE)).unwrap();
        assert_eq!(status(Kind::Codex, other.path()).state, State::Other);
        assert!(install(Kind::Codex, other.path()).is_err());
        assert_eq!(fs::read_to_string(&real).unwrap(), Kind::Codex.copy());

        // The folders above it may be links: that is where the person keeps their skills.
        let third = TempFolder::new("skill-link-parent");
        let elsewhere = third.path().join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        fs::create_dir_all(third.path().join(".openclaw")).unwrap();
        symlink(&elsewhere, third.path().join(".openclaw/skills")).unwrap();
        install(Kind::OpenClaw, third.path()).unwrap();
        assert!(elsewhere.join("redlines").join(FILE).exists());
    }

    #[test]
    fn a_link_that_leads_nowhere_above_the_folder_is_said_and_nothing_is_made() {
        let temp = TempFolder::new("skill-dangling");
        symlink(temp.path().join("gone"), temp.path().join(".claude")).unwrap();
        let found = status(Kind::Claude, temp.path());
        assert_eq!(found.state, State::Other);
        let said = "~/.claude is a link that leads nowhere, and Redlines leaves links as they are.";
        assert_eq!(found.message.as_deref(), Some(said));
        assert_eq!(install(Kind::Claude, temp.path()), Err(said.to_owned()));
        // The same a step lower.
        let other = TempFolder::new("skill-dangling-2");
        fs::create_dir_all(other.path().join(".agents")).unwrap();
        symlink(
            other.path().join("gone"),
            other.path().join(".agents/skills"),
        )
        .unwrap();
        assert_eq!(
            install(Kind::Codex, other.path()),
            Err("~/.agents/skills is a link that leads nowhere, and Redlines leaves links as they are.".to_owned())
        );
        // A link that leads somewhere is no such thing: the folder is made there.
        let third = TempFolder::new("skill-dangling-3");
        let real = third.path().join("dotfiles");
        fs::create_dir_all(&real).unwrap();
        symlink(&real, third.path().join(".openclaw")).unwrap();
        install(Kind::OpenClaw, third.path()).unwrap();
        assert!(real.join("skills/redlines/SKILL.md").exists());
    }

    #[test]
    fn installs_at_the_same_time_neither_fail_nor_leave_a_file_behind() {
        let temp = TempFolder::new("skill-concurrent");
        let home = temp.path().to_owned();
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let home = home.clone();
                std::thread::spawn(move || install(Kind::Codex, &home))
            })
            .collect();
        for thread in threads {
            thread.join().unwrap().unwrap();
        }
        let folder = home.join(Kind::Codex.relative_folder());
        let names: Vec<_> = fs::read_dir(&folder)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, [FILE]);
        assert_eq!(
            fs::read_to_string(folder.join(FILE)).unwrap(),
            Kind::Codex.copy()
        );
    }

    #[test]
    fn what_is_not_a_folder_stays() {
        let temp = TempFolder::new("skill-file");
        let folder = temp.path().join(Kind::OpenClaw.relative_folder());
        fs::create_dir_all(folder.parent().unwrap()).unwrap();
        fs::write(&folder, "a file").unwrap();
        assert_eq!(status(Kind::OpenClaw, temp.path()).state, State::Other);
        assert!(install(Kind::OpenClaw, temp.path()).is_err());
        assert_eq!(fs::read_to_string(&folder).unwrap(), "a file");
    }

    #[test]
    fn other_files_in_the_skills_folder_stay() {
        let temp = TempFolder::new("skill-others");
        let folder = put(
            temp.path(),
            Kind::Claude,
            &older_copy(Kind::Claude, Some(0)),
        );
        fs::write(folder.join("extra.md"), "theirs").unwrap();
        install(Kind::Claude, temp.path()).unwrap();
        assert_eq!(
            fs::read_to_string(folder.join("extra.md")).unwrap(),
            "theirs"
        );
    }

    #[test]
    fn a_path_with_a_file_in_it_says_so() {
        let temp = TempFolder::new("skill-cant");
        // `.claude` is a file, so nothing can be made below it.
        fs::write(temp.path().join(".claude"), "a file").unwrap();
        let found = status(Kind::Claude, temp.path());
        assert_eq!(found.state, State::Other);
        let refused = install(Kind::Claude, temp.path()).unwrap_err();
        assert_eq!(
            refused,
            "Redlines can’t put the skill in ~/.claude/skills/redlines: a part of the path isn’t a folder."
        );
        assert_eq!(found.message.as_deref(), Some(refused.as_str()));
        assert_eq!(
            fs::read_to_string(temp.path().join(".claude")).unwrap(),
            "a file"
        );
    }

    #[test]
    fn the_command_line_is_on_the_path_linked_off_it_or_missing() {
        let temp = TempFolder::new("skill-command");
        assert_eq!(
            command_line(Some("/opt/homebrew/bin/redlines"), temp.path()),
            CommandLine::OnPath
        );
        // Nothing found, and nothing linked in the home folder: the command line is missing, as
        // far as an agent's shell can tell. (`/usr/local/bin` is on the PATH of every shell, so a
        // link there is found by a login shell.)
        if !Path::new("/usr/local/bin/redlines").exists() {
            assert_eq!(command_line(None, temp.path()), CommandLine::Missing);
        }
        let bin = temp.path().join(".local/bin");
        fs::create_dir_all(&bin).unwrap();
        symlink("/bin/echo", bin.join("redlines")).unwrap();
        assert_eq!(
            command_line(None, temp.path()),
            CommandLine::OffPath {
                linked: "~/.local/bin/redlines".to_owned()
            }
        );
        // A link that leads nowhere isn't a command.
        fs::remove_file(bin.join("redlines")).unwrap();
        symlink(temp.path().join("gone"), bin.join("redlines")).unwrap();
        if !Path::new("/usr/local/bin/redlines").exists() {
            assert_eq!(command_line(None, temp.path()), CommandLine::Missing);
        }
    }

    #[test]
    fn what_the_window_hears_is_plain_words() {
        let temp = TempFolder::new("skill-json");
        let found = serde_json::to_value(status(Kind::Claude, temp.path())).unwrap();
        assert_eq!(found["state"], "missing");
        assert_eq!(found["folder"], "~/.claude/skills/redlines");
        assert!(found["current"].as_u64().unwrap() > 0);
        let installed = installed(
            Written {
                folder: "~/.agents/skills/redlines".to_owned(),
                version: 2,
            },
            CommandLine::OffPath {
                linked: "~/.local/bin/redlines".to_owned(),
            },
        );
        assert_eq!(
            serde_json::to_value(installed).unwrap(),
            serde_json::json!({
                "folder": "~/.agents/skills/redlines",
                "version": 2,
                "commandLine": { "found": "offPath", "linked": "~/.local/bin/redlines" }
            })
        );
        assert_eq!(
            serde_json::to_value(CommandLine::OnPath).unwrap(),
            serde_json::json!({ "found": "onPath" })
        );
    }

    #[test]
    fn the_home_folder_is_the_one_the_app_runs_in() {
        // Whatever HOME is here, it is an absolute path or there is none.
        if let Ok(home) = home() {
            assert!(home.is_absolute());
        }
    }
}
