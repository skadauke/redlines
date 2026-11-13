//! Agents that speak the Agent Client Protocol, each "a name and a command" the person added in
//! Preferences ▸ Agents. The list is a file of the app's own that only this writes, and nothing goes
//! in it, or comes out of it, without the person's answer to a native question (`Question`), which
//! the window can neither draw nor answer. The question names the exact program the command
//! resolves to and its arguments, because those, and nothing else, are what a run of the agent
//! starts: the window names the agent by its id, and the app builds the line (`acp_start` in
//! `mod.rs`). So the question has to show exactly what will run: a name or a command with anything
//! in it that doesn't show as itself (line breaks, bidi controls, zero-width and other invisible
//! characters) is refused, both are short enough to read whole, and a program that is a link is
//! shown with the file it leads to. What the window may then say to the agent is `acp_gate.rs`'s.
//!
//! One agent is known by its command: OpenClaw's bridge, `openclaw acp --url <Gateway>
//! --token-file <file>` (`bridge_of`), which forwards each prompt to an OpenClaw Gateway that may
//! run on another machine, and takes no MCP server of the client's. It has no toolbox: its session
//! has none (`acp_gate.rs`), and the window sends it the document and the thread in its prompt
//! instead. The command is held to exactly that shape, so that no token or password is ever kept
//! in the list or in a command line, and the token file, which Redlines never reads, is named by
//! its path alone.

use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, TryLockError};

use serde::{Deserialize, Serialize};

use super::which::is_clean_path;

/// An agent the person added. The window reads these by name (`src/agent-host.ts`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AcpAgent {
    /// What its handles start with (`gemini-ada`), and what the window names it by.
    pub id: String,
    /// What people see, and write after an @.
    pub name: String,
    /// The path the command's program resolved to when the person allowed it.
    pub program: String,
    pub args: Vec<String>,
    /// Set for OpenClaw's bridge, and only where the command is exactly that (`bridge_of`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bridge: Option<Bridge>,
}

/// What is known of an agent that is OpenClaw's bridge: the agent at the Gateway it was asked for.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Bridge {
    /// The OpenClaw agent the person named (`--session agent:<id>:main`). Without one, the
    /// Gateway's default agent answers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
}

/// The longest Gateway address that is kept, and the shortest token-file name that can be one.
const MAX_URL: usize = 200;
/// A token file holds a token and nothing else: OpenClaw reads at most this much of one.
const MAX_TOKEN_FILE: u64 = 16 * 1024;

/// What a person is told of how OpenClaw is run, when it isn't that.
const OPENCLAW_USAGE: &str = "Run OpenClaw as openclaw acp --url <ws:// or wss:// address> \
     --token-file <file>, with --session agent:<id>:main to name its agent.";

/// Whether a command is OpenClaw's bridge, and, if it is, that it is exactly `openclaw acp --url
/// <address> --token-file <file>`, with `--session agent:<id>:main` after them if the person names
/// an agent: `Ok(None)` for any other program. A token or a password on the command line, any other
/// flag, an address with a user name, a password, a query or a fragment in it (a token could ride
/// there), and a token file that isn't a plain path are refused, so that nothing secret is ever kept
/// in the list or shown in a process list.
pub fn bridge_of(program: &str, args: &[String]) -> Result<Option<Bridge>, String> {
    let is_openclaw = Path::new(program)
        .file_name()
        .is_some_and(|name| name == "openclaw");
    if !is_openclaw {
        return Ok(None);
    }
    let mut words = args.iter().map(String::as_str);
    if words.next() != Some("acp") {
        return Err(OPENCLAW_USAGE.to_owned());
    }
    let (mut url, mut file, mut session) = (None, None, None);
    while let Some(flag) = words.next() {
        let slot = match flag {
            "--url" => &mut url,
            "--token-file" => &mut file,
            "--session" => &mut session,
            "--token" | "--password" | "--password-file" => {
                return Err(
                    "Redlines keeps no token or password: give the token file's path with \
                     --token-file, and OpenClaw reads it."
                        .to_owned(),
                );
            }
            _ => return Err(OPENCLAW_USAGE.to_owned()),
        };
        let value = words.next().ok_or_else(|| OPENCLAW_USAGE.to_owned())?;
        if slot.replace(value).is_some() {
            return Err(OPENCLAW_USAGE.to_owned());
        }
    }
    let (Some(url), Some(file)) = (url, file) else {
        return Err(OPENCLAW_USAGE.to_owned());
    };
    gateway_url_problem(url).map_or(Ok(()), Err)?;
    token_file_path_problem(file).map_or(Ok(()), Err)?;
    let agent = session.map(agent_of_session).transpose()?;
    Ok(Some(Bridge { agent }))
}

/// Why a Gateway address can't be used, if it can't: `ws://` or `wss://`, a host with an optional
/// port, and an optional plain path, and nothing that could carry a secret.
fn gateway_url_problem(url: &str) -> Option<String> {
    let bad = || {
        Some(
            "Give the Gateway's address as ws:// or wss:// and a host, such as \
             wss://gateway.example.org, with no user name, password, query or fragment."
                .to_owned(),
        )
    };
    let Some(rest) = url
        .strip_prefix("wss://")
        .or_else(|| url.strip_prefix("ws://"))
    else {
        return bad();
    };
    if url.chars().count() > MAX_URL || !shows_as_itself(url) {
        return bad();
    }
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host_chars = |c: char| c.is_ascii_alphanumeric() || ".-:[]".contains(c);
    let path_chars = |c: char| c.is_ascii_alphanumeric() || "._~/%+-".contains(c);
    if authority.is_empty() || !authority.chars().all(host_chars) || !path.chars().all(path_chars) {
        return bad();
    }
    None
}

/// Why a token file's name can't be used, if it can't: a whole, plain path.
fn token_file_path_problem(path: &str) -> Option<String> {
    let plain = is_clean_path(path) && shows_as_itself(path) && path.chars().count() <= MAX_COMMAND;
    (!plain).then(|| {
        "Give the token file's whole path, with no ., .. or empty parts, such as \
         /Users/ada/.openclaw/gateway-token."
            .to_owned()
    })
}

/// The agent a session key names: `agent:<id>:main`, with an id that is a plain lowercase name.
fn agent_of_session(key: &str) -> Result<String, String> {
    let id = key
        .strip_prefix("agent:")
        .and_then(|rest| rest.strip_suffix(":main"))
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 32
                && id.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
                && id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
        });
    id.map(str::to_owned).ok_or_else(|| {
        "Name the agent as --session agent:<id>:main, in lowercase letters, digits, - and _."
            .to_owned()
    })
}

/// Why a token file can't be used as it is, if it can't: it has to be there, and be a file of its
/// own and not a link (OpenClaw refuses a link), with something in it and no more than a token
/// holds. Only what the file system says of it is looked at: nothing in it is read.
fn token_file_problem(path: &str) -> Option<String> {
    let looked = fs::symlink_metadata(path);
    match looked {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            Some(format!("There is no token file at {path}."))
        }
        Err(error) => Some(format!("Redlines can't look at the token file: {error}.")),
        Ok(found) if found.file_type().is_symlink() => Some(
            "The token file is a link, which OpenClaw won't read: give the file itself.".to_owned(),
        ),
        Ok(found) if !found.is_file() => Some(format!("{path} isn't a file.")),
        Ok(found) if found.len() == 0 => Some("The token file is empty.".to_owned()),
        Ok(found) if found.len() > MAX_TOKEN_FILE => Some(
            "The token file is larger than a token file can be (16 KiB): is it the right file?"
                .to_owned(),
        ),
        Ok(_) => None,
    }
}

/// Whether other people on this Mac can read a file, from its mode alone.
fn others_can_read(path: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path).is_ok_and(|found| found.permissions().mode() & 0o044 != 0)
}

/// What the native question says, and its two answers. The first answer is the yes.
#[derive(Debug, PartialEq)]
pub struct Question {
    pub title: String,
    pub message: String,
    pub yes: &'static str,
    pub no: &'static str,
}

/// Where a command's program is: the path found, and the file it really is when that's a link.
#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    pub path: String,
    pub real: Option<String>,
}

impl Found {
    /// A program found at `path`, with where it leads if it is a link.
    pub fn at(path: String) -> Self {
        let real = fs::canonicalize(&path)
            .ok()
            .and_then(|real| real.to_str().map(str::to_owned))
            .filter(|real| *real != path);
        Found { path, real }
    }
}

/// The ids of the agents Redlines runs by their own providers.
const TAKEN: [&str; 2] = ["claude", "codex"];
const MAX_NAME: usize = 64;
const MAX_ID: usize = 24;
const MAX_COMMAND: usize = 300;
const MAX_WORDS: usize = 16;

/// Letters that show as nothing at all, which `char::is_alphanumeric` counts as letters.
const BLANK_LETTERS: [char; 4] = ['\u{115F}', '\u{1160}', '\u{3164}', '\u{FFA0}'];

/// Whether a text shows as what it is: letters and digits of any script, and printable ASCII with
/// its space. Nothing else, which leaves out control characters, line and paragraph separators,
/// bidi controls, zero-width and other format characters, other spaces, private-use and unassigned
/// code points, and the letters that show as blank.
pub fn shows_as_itself(text: &str) -> bool {
    text.chars().all(|c| {
        c == ' ' || c.is_ascii_graphic() || (c.is_alphanumeric() && !BLANK_LETTERS.contains(&c))
    })
}

/// The list, in its file.
pub struct AcpAgents {
    file: PathBuf,
    /// Held while a question is up and the list changes, so that there is one question at a time.
    changing: Mutex<()>,
}

impl AcpAgents {
    pub fn new(file: PathBuf) -> Self {
        AcpAgents {
            file,
            changing: Mutex::new(()),
        }
    }

    /// The agents in the file, leaving out any entry that isn't one this would have written.
    pub fn list(&self) -> Vec<AcpAgent> {
        let Ok(text) = fs::read_to_string(&self.file) else {
            return Vec::new();
        };
        let agents: Vec<AcpAgent> = serde_json::from_str(&text).unwrap_or_default();
        let mut seen = Vec::new();
        agents
            .into_iter()
            .filter(|agent| {
                let fine = id_for(&agent.name).as_deref() == Ok(agent.id.as_str())
                    && is_clean_path(&agent.program)
                    && shows_as_itself(&agent.program)
                    && agent.args.len() < MAX_WORDS
                    && agent.args.iter().all(|arg| shows_as_itself(arg))
                    // The flag that gives an agent no toolbox is what its command says, nothing a
                    // file could add or take away.
                    && bridge_of(&agent.program, &agent.args)
                        .is_ok_and(|bridge| bridge == agent.bridge)
                    && !seen.contains(&agent.id);
                seen.push(agent.id.clone());
                fine
            })
            .collect()
    }

    /// The agent with this id, if the person added one.
    pub fn get(&self, id: &str) -> Option<AcpAgent> {
        self.list().into_iter().find(|agent| agent.id == id)
    }

    /// Adds an agent, or changes the one with the same id, once the person has allowed it. `find`
    /// resolves the command's program, and `ask` puts the question and gives the answer. Returns
    /// the list as it then is.
    pub fn add(
        &self,
        name: &str,
        command: &str,
        find: impl FnOnce(&str) -> Option<Found>,
        ask: impl FnOnce(&Question) -> bool,
    ) -> Result<Vec<AcpAgent>, String> {
        let name = name.trim();
        let id = id_for(name)?;
        let mut words = words_of(command)?.into_iter();
        let word = words.next().unwrap_or_default();
        if word.starts_with('/') && !is_clean_path(&word) {
            return Err("Give the program's whole path with no ., .. or empty parts.".to_owned());
        }
        if !word.starts_with('/') && word.contains('/') {
            return Err("Give the program's name, or its whole path.".to_owned());
        }
        let found =
            find(&word).ok_or_else(|| format!("Redlines can't find {word} on this Mac."))?;
        let paths = std::iter::once(&found.path).chain(&found.real);
        if !paths.into_iter().all(|path| shows_as_itself(path)) {
            return Err("Redlines won't run a program whose path doesn't show plainly.".to_owned());
        }
        let args: Vec<String> = words.collect();
        let bridge = bridge_of(&found.path, &args)?;
        let agent = AcpAgent {
            id,
            name: name.to_owned(),
            program: found.path.clone(),
            args,
            bridge,
        };
        if agent.bridge.is_some()
            && let Some(file) = agent
                .args
                .iter()
                .skip_while(|arg| *arg != "--token-file")
                .nth(1)
            && let Some(problem) = token_file_problem(file)
        {
            return Err(problem);
        }

        let _changing = self.one_at_a_time()?;
        let mut agents = self.list();
        let replaced = agents.iter().position(|other| other.id == agent.id);
        // Where a link leads, since the file at the end of it is what runs.
        let link = found
            .real
            .as_ref()
            .map_or_else(String::new, |real| format!("{} → {real}\n\n", found.path));
        let question = Question {
            title: format!("Let Redlines run {} as an agent?", shown(&agent)),
            message: format!(
                "{}{}",
                match replaced {
                    Some(at) => format!(
                        "{link}It takes the place of {}, which runs {}. An agent may also act on \
                         its own, outside what it asks Redlines, as its own settings allow.",
                        agents[at].name,
                        shown(&agents[at])
                    ),
                    None => format!(
                        "{link}It will be listed as {}. An agent may also act on its own, outside \
                         what it asks Redlines, as its own settings allow.",
                        agent.name
                    ),
                },
                bridge_message(&agent)
            ),
            yes: "Allow",
            no: "Don't Allow",
        };
        if !ask(&question) {
            return Err(format!("{} wasn't added.", agent.name));
        }
        match replaced {
            Some(at) => agents[at] = agent,
            None => agents.push(agent),
        }
        self.save(&agents)?;
        Ok(agents)
    }

    /// Removes an agent, once the person has said so. Returns the list as it then is.
    pub fn remove(
        &self,
        id: &str,
        ask: impl FnOnce(&Question) -> bool,
    ) -> Result<Vec<AcpAgent>, String> {
        let _changing = self.one_at_a_time()?;
        let mut agents = self.list();
        let Some(at) = agents.iter().position(|agent| agent.id == id) else {
            return Ok(agents);
        };
        let question = Question {
            title: format!("Remove {} from Redlines?", agents[at].name),
            message: format!("Redlines will no longer run {}.", shown(&agents[at])),
            yes: "Remove",
            no: "Cancel",
        };
        if !ask(&question) {
            return Err(format!("{} wasn't removed.", agents[at].name));
        }
        agents.remove(at);
        self.save(&agents)?;
        Ok(agents)
    }

    fn one_at_a_time(&self) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        match self.changing.try_lock() {
            Ok(guard) => Ok(guard),
            Err(TryLockError::Poisoned(poisoned)) => Ok(poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => {
                Err("Redlines is already asking about an agent.".to_owned())
            }
        }
    }

    /// Writes the list whole, readable only by the person, and never half a file.
    fn save(&self, agents: &[AcpAgent]) -> Result<(), String> {
        write_private(
            &self.file,
            &serde_json::to_vec_pretty(agents).unwrap_or_default(),
        )
        .map_err(|error| format!("Couldn't save the agents: {error}"))
    }
}

fn write_private(file: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(folder) = file.parent() {
        fs::create_dir_all(folder)?;
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
            out.write_all(b"\n")?;
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

/// The id for a name: its ASCII letters and digits, lowercase, with a `-` for each run of anything
/// else between them, starting with a letter. It goes into handles and mentions.
pub fn id_for(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME || !shows_as_itself(name) {
        return Err(format!(
            "Give the agent a name of up to {MAX_NAME} letters, digits and plain punctuation."
        ));
    }
    let mut id = String::new();
    for c in name.chars() {
        if c.is_ascii_alphabetic() || (c.is_ascii_digit() && !id.is_empty()) {
            id.push(c.to_ascii_lowercase());
        } else if c.is_ascii() && !id.is_empty() && !id.ends_with('-') {
            id.push('-');
        }
    }
    id.truncate(MAX_ID);
    let id = id.trim_end_matches('-').to_owned();
    if id.is_empty() {
        return Err("Give the agent a name with a letter in it.".to_owned());
    }
    if TAKEN.contains(&id.as_str()) {
        return Err("Claude and Codex are already agents of Redlines.".to_owned());
    }
    Ok(id)
}

/// The words of a command as a shell would split it without running anything: spaces between
/// words, and quotes, single or double, around a word with spaces in it. A command that wouldn't
/// show as itself in the question, or is too long to read whole there, is refused.
pub fn words_of(command: &str) -> Result<Vec<String>, String> {
    if !shows_as_itself(command) {
        return Err(
            "Give the command on one line, in letters, digits and plain punctuation.".to_owned(),
        );
    }
    if command.chars().count() > MAX_COMMAND {
        return Err(format!("Give a command of up to {MAX_COMMAND} characters."));
    }
    let mut words = Vec::new();
    let mut word: Option<String> = None;
    let mut quote: Option<char> = None;
    for c in command.chars() {
        match quote {
            Some(open) if c == open => quote = None,
            Some(_) => word.get_or_insert_default().push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                word.get_or_insert_default();
            }
            None if c.is_whitespace() => words.extend(word.take()),
            None => word.get_or_insert_default().push(c),
        }
    }
    if quote.is_some() {
        return Err("A quote in the command isn't closed.".to_owned());
    }
    words.extend(word);
    if words.len() > MAX_WORDS {
        return Err(format!("Give a command of up to {MAX_WORDS} words."));
    }
    if words.first().is_none_or(String::is_empty) {
        return Err(
            "Give the command that starts the agent, such as gemini --experimental-acp.".to_owned(),
        );
    }
    Ok(words)
}

/// What the question adds for OpenClaw's bridge, which is not like the other agents: where the
/// document and the thread go, that its token file is never read, and what is worth a warning.
fn bridge_message(agent: &AcpAgent) -> String {
    if agent.bridge.is_none() {
        return String::new();
    }
    let after = |flag: &str| {
        agent
            .args
            .iter()
            .skip_while(|arg| *arg != flag)
            .nth(1)
            .cloned()
            .unwrap_or_default()
    };
    let (url, file) = (after("--url"), after("--token-file"));
    let mut message = format!(
        "\n\n{} is OpenClaw's bridge to the Gateway at {url}. When you mention @{} in a comment, the \
         document and its comments are sent there, wherever it runs, and its last message is posted \
         as a reply. It can't change the document. Redlines passes the token file's path ({file}) \
         to openclaw and never reads the file.",
        agent.name, agent.id
    );
    if url.starts_with("ws://") {
        message.push_str(
            "\n\nThis address isn't encrypted (ws://), so what goes to it can be read on the way.",
        );
    }
    if others_can_read(&file) {
        message.push_str("\n\nOther people on this Mac can read the token file.");
    }
    message
}

/// An agent's line as the question shows it: each word that a shell would split, quoted.
pub fn shown(agent: &AcpAgent) -> String {
    std::iter::once(&agent.program)
        .chain(&agent.args)
        .map(|word| {
            let plain = !word.is_empty()
                && word
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_./=:@,+%".contains(c));
            if plain {
                word.clone()
            } else {
                format!("'{}'", word.replace('\'', r"'\''"))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;
    use crate::agents::test_support::TempFolder;

    fn gemini(_: &str) -> Option<Found> {
        Some(Found {
            path: "/opt/homebrew/bin/gemini".to_owned(),
            real: None,
        })
    }

    fn store(temp: &TempFolder) -> AcpAgents {
        AcpAgents::new(temp.path().join("support").join("acp-agents.json"))
    }

    #[test]
    fn nothing_is_saved_without_allow() {
        let temp = TempFolder::new("acp-refused");
        let agents = store(&temp);
        let asked = Cell::new(0);
        let refused = agents.add("Gemini", "gemini --experimental-acp", gemini, |_| {
            asked.set(asked.get() + 1);
            false
        });
        assert_eq!(refused, Err("Gemini wasn't added.".to_owned()));
        assert_eq!(asked.get(), 1);
        assert!(!agents.file.exists(), "not even an empty list");
        assert_eq!(agents.list(), []);
    }

    #[test]
    fn allow_saves_the_resolved_program_and_its_arguments() {
        let temp = TempFolder::new("acp-allowed");
        let agents = store(&temp);
        let mut question = None;
        let list = agents
            .add(" Gemini ", "gemini --experimental-acp", gemini, |asked| {
                question = Some(format!("{}\n{}", asked.title, asked.message));
                true
            })
            .unwrap();
        let expected = AcpAgent {
            id: "gemini".to_owned(),
            name: "Gemini".to_owned(),
            program: "/opt/homebrew/bin/gemini".to_owned(),
            args: vec!["--experimental-acp".to_owned()],
            bridge: None,
        };
        assert_eq!(list, std::slice::from_ref(&expected));
        assert_eq!(agents.list(), std::slice::from_ref(&expected));
        assert_eq!(agents.get("gemini"), Some(expected));
        assert_eq!(agents.get("codex"), None);
        let question = question.unwrap();
        assert!(
            question.starts_with(
                "Let Redlines run /opt/homebrew/bin/gemini --experimental-acp as an agent?"
            ),
            "{question}"
        );
        assert!(question.contains("act on its own"), "{question}");
        // Only the person can read the list.
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&agents.file).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn the_question_names_the_path_the_program_resolved_to() {
        let temp = TempFolder::new("acp-resolved");
        let agents = store(&temp);
        let mut title = String::new();
        let found = Cell::new(String::new());
        agents
            .add(
                "Goose",
                "goose acp 'two words'",
                |word| {
                    found.set(word.to_owned());
                    Some(Found {
                        path: "/Users/ada/.local/bin/goose".to_owned(),
                        real: None,
                    })
                },
                |asked| {
                    title = asked.title.clone();
                    true
                },
            )
            .unwrap();
        assert_eq!(found.take(), "goose");
        assert_eq!(
            title,
            "Let Redlines run /Users/ada/.local/bin/goose acp 'two words' as an agent?"
        );
        assert_eq!(agents.get("goose").unwrap().args, ["acp", "two words"]);
    }

    #[test]
    fn a_program_that_isnt_found_isnt_asked_about() {
        let temp = TempFolder::new("acp-missing");
        let agents = store(&temp);
        let refused = agents.add("Nope", "nope acp", |_| None, |_| panic!("asked"));
        assert_eq!(
            refused,
            Err("Redlines can't find nope on this Mac.".to_owned())
        );
        for command in [
            "",
            "   ",
            "bin/gemini acp",
            "./gemini",
            "'unclosed",
            "a\nb",
            "a\tb",
        ] {
            let refused = agents.add("X", command, gemini, |_| panic!("asked: {command}"));
            assert!(refused.is_err(), "{command:?}");
        }
        assert!(!agents.file.exists());
    }

    #[test]
    fn a_change_is_asked_about_too_and_takes_the_old_ones_place() {
        let temp = TempFolder::new("acp-change");
        let agents = store(&temp);
        agents
            .add("Gemini", "gemini --experimental-acp", gemini, |_| true)
            .unwrap();
        let mut message = String::new();
        let refused = agents.add("gemini", "gemini --yolo", gemini, |asked| {
            message = asked.message.clone();
            false
        });
        assert!(refused.is_err());
        assert!(
            message.contains("/opt/homebrew/bin/gemini --experimental-acp"),
            "{message}"
        );
        assert_eq!(agents.get("gemini").unwrap().args, ["--experimental-acp"]);

        agents
            .add("gemini", "gemini --acp", gemini, |_| true)
            .unwrap();
        let list = agents.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "gemini");
        assert_eq!(list[0].args, ["--acp"]);
    }

    #[test]
    fn removing_is_asked_about_and_refusing_keeps_it() {
        let temp = TempFolder::new("acp-remove");
        let agents = store(&temp);
        agents
            .add("Gemini", "gemini --experimental-acp", gemini, |_| true)
            .unwrap();
        assert!(agents.remove("gemini", |_| false).is_err());
        assert_eq!(agents.list().len(), 1);
        let mut title = String::new();
        let list = agents
            .remove("gemini", |asked| {
                title = asked.title.clone();
                true
            })
            .unwrap();
        assert_eq!(title, "Remove Gemini from Redlines?");
        assert_eq!(list, []);
        assert_eq!(agents.list(), []);
        // Nothing to remove asks nothing.
        assert_eq!(agents.remove("gemini", |_| panic!("asked")), Ok(vec![]));
    }

    #[test]
    fn one_question_at_a_time() {
        let temp = TempFolder::new("acp-one");
        let agents = store(&temp);
        let inner = agents.add("Gemini", "gemini --experimental-acp", gemini, |_| {
            // A second request while the first question is up isn't asked.
            let second = agents.add("Other", "other acp", gemini, |_| panic!("asked twice"));
            assert_eq!(
                second,
                Err("Redlines is already asking about an agent.".to_owned())
            );
            assert!(agents.remove("gemini", |_| panic!("asked twice")).is_err());
            true
        });
        assert!(inner.is_ok());
        assert_eq!(agents.list().len(), 1);
    }

    #[test]
    fn the_question_shows_exactly_what_will_run() {
        // What the review's probe got into the question: each is refused before anything is asked.
        let temp = TempFolder::new("acp-plain");
        let agents = store(&temp);
        let separators = "\u{2028}".repeat(60);
        let cellar = "/opt/homebrew/Cellar/gemini-cli/0.25.2/libexec/lib/node_modules/@google/\
                      gemini-cli/../../../../../../../../../../bin/sh -c id";
        for command in [
            format!("/opt/homebrew/bin/gemini --experimental-acp '{separators}' --yolo"),
            format!(
                "/opt/homebrew/bin/gemini --experimental-acp --model '{}' --yolo",
                "x".repeat(5000)
            ),
            "/bin/sh -c '\u{202E}hs|live lruc\u{202C}'".to_owned(),
            cellar.to_owned(),
        ] {
            let refused = agents.add("Gemini", &command, gemini, |_| panic!("asked: {command:?}"));
            assert!(refused.is_err(), "{command:?}");
        }
        let refused = agents.add(
            "Gemini\u{2028}Checked by Redlines: safe",
            "gemini --experimental-acp",
            gemini,
            |_| panic!("asked"),
        );
        assert!(refused.is_err());
        assert!(!agents.file.exists());
    }

    #[test]
    fn only_text_that_shows_as_itself_gets_in() {
        for plain in [
            "Gemini",
            "Open Code 2",
            "Café",
            "Агент",
            "エージェント",
            "/opt/homebrew/bin/gemini --experimental-acp --model=gemini-2.5-pro",
            r#"a "b c" 'd' ~/$x;|&<>?*[]{}()!#^`\"#,
        ] {
            assert!(shows_as_itself(plain), "{plain:?}");
        }
        for hidden in [
            "a\tb",
            "a\nb",
            "a\u{7f}b",
            "a\u{85}b",
            "a\u{2028}b",
            "a\u{2029}b",
            "a\u{202A}b",
            "a\u{202B}b",
            "a\u{202C}b",
            "a\u{202D}b",
            "a\u{202E}b",
            "a\u{2066}b",
            "a\u{2067}b",
            "a\u{2068}b",
            "a\u{2069}b",
            "a\u{200E}b",
            "a\u{200F}b",
            "a\u{061C}b",
            "a\u{200B}b",
            "a\u{200C}b",
            "a\u{200D}b",
            "a\u{2060}b",
            "a\u{FEFF}b",
            "a\u{00AD}b",
            "a\u{180E}b",
            "a\u{00A0}b",
            "a\u{3000}b",
            "a\u{E000}b",
            "a\u{F0000}b",
            "a\u{0378}b",
            "a\u{3164}b",
            "a\u{115F}b",
        ] {
            assert!(!shows_as_itself(hidden), "{hidden:?}");
        }
    }

    #[test]
    fn names_and_commands_are_short_enough_to_read_whole() {
        let temp = TempFolder::new("acp-caps");
        let agents = store(&temp);
        let words = |count: usize| {
            std::iter::once("gemini".to_owned())
                .chain((1..count).map(|at| format!("a{at}")))
                .collect::<Vec<_>>()
                .join(" ")
        };
        assert!(words_of(&words(16)).is_ok());
        assert!(words_of(&words(17)).is_err());
        let long = format!("gemini {}", "x".repeat(MAX_COMMAND - 7));
        assert_eq!(long.chars().count(), MAX_COMMAND);
        assert!(words_of(&long).is_ok());
        assert!(words_of(&format!("{long}x")).is_err());
        let name = "N".repeat(MAX_NAME);
        assert!(agents.add(&name, "gemini", gemini, |_| true).is_ok());
        let longer = "N".repeat(MAX_NAME + 1);
        assert!(
            agents
                .add(&longer, "gemini", gemini, |_| panic!("asked"))
                .is_err()
        );
    }

    #[test]
    fn a_whole_path_has_no_dots_or_empty_parts() {
        let temp = TempFolder::new("acp-paths");
        let agents = store(&temp);
        for command in [
            "/opt/homebrew/bin/../bin/gemini",
            "/opt/homebrew/bin/./gemini",
            "/opt//homebrew/bin/gemini",
            "/opt/homebrew/bin/gemini/",
            "/",
        ] {
            let refused = agents.add("Gemini", command, gemini, |_| panic!("asked: {command}"));
            assert!(refused.is_err(), "{command}");
        }
    }

    #[test]
    fn a_link_is_shown_with_the_file_it_leads_to() {
        let temp = TempFolder::new("acp-link");
        let agents = store(&temp);
        let real = "/opt/homebrew/Cellar/gemini-cli/0.25.2/libexec/lib/node_modules/@google/\
                    gemini-cli/dist/index.js";
        let mut message = String::new();
        agents
            .add(
                "Gemini",
                "gemini --experimental-acp",
                |_| {
                    Some(Found {
                        path: "/opt/homebrew/bin/gemini".to_owned(),
                        real: Some(real.to_owned()),
                    })
                },
                |asked| {
                    message = asked.message.clone();
                    true
                },
            )
            .unwrap();
        assert!(
            message.starts_with(&format!("/opt/homebrew/bin/gemini → {real}\n")),
            "{message}"
        );
        // What runs is the path found, which the question named first.
        assert_eq!(
            agents.get("gemini").unwrap().program,
            "/opt/homebrew/bin/gemini"
        );

        // A link that leads to a path that doesn't show plainly isn't asked about.
        let refused = agents.add(
            "Other",
            "other",
            |_| {
                Some(Found {
                    path: "/opt/homebrew/bin/other".to_owned(),
                    real: Some("/tmp/\u{202E}sj.xedni".to_owned()),
                })
            },
            |_| panic!("asked"),
        );
        assert!(refused.is_err());

        // `Found::at` reads a real link.
        let target = temp.path().join("target");
        fs::write(&target, "").unwrap();
        let link = temp.path().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let found = Found::at(link.to_str().unwrap().to_owned());
        let canonical = fs::canonicalize(&target).unwrap();
        assert_eq!(found.real.as_deref(), canonical.to_str());
        let plain = Found::at(canonical.to_str().unwrap().to_owned());
        assert_eq!(plain.real, None);
    }

    #[test]
    fn ids_come_from_names_and_never_take_claudes_or_codexs() {
        assert_eq!(id_for("Gemini").as_deref(), Ok("gemini"));
        assert_eq!(id_for("OpenClaw").as_deref(), Ok("openclaw"));
        assert_eq!(id_for("Open Code 2").as_deref(), Ok("open-code-2"));
        assert_eq!(id_for("  goose!  ").as_deref(), Ok("goose"));
        assert_eq!(id_for("2fast").as_deref(), Ok("fast"));
        for name in ["Claude", "codex", "", "   ", "123", "!!!", "a\u{7}b"] {
            assert!(id_for(name).is_err(), "{name:?}");
        }
        assert!(id_for(&"x".repeat(65)).is_err());
        assert_eq!(id_for(&"x".repeat(64)).unwrap().len(), MAX_ID);
    }

    #[test]
    fn an_entry_this_wouldnt_have_written_is_left_out() {
        let temp = TempFolder::new("acp-file");
        let agents = store(&temp);
        let entry = |id: &str, name: &str, program: &str| serde_json::json!({ "id": id, "name": name, "program": program, "args": [] });
        let file = serde_json::json!([
            entry("gemini", "Gemini", "/opt/homebrew/bin/gemini"),
            entry("claude", "Claude", "/bin/sh"),
            entry("x", "Y", "/bin/sh"),
            entry("rel", "Rel", "bin/sh"),
            entry("gemini", "Gemini", "/bin/sh"),
        ]);
        fs::create_dir_all(agents.file.parent().unwrap()).unwrap();
        fs::write(&agents.file, file.to_string()).unwrap();
        let list = agents.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].program, "/opt/homebrew/bin/gemini");

        fs::write(&agents.file, "not json").unwrap();
        assert_eq!(agents.list(), []);
    }

    #[test]
    fn words_split_as_a_shell_would_without_running_anything() {
        let words = |command: &str| words_of(command).unwrap();
        assert_eq!(
            words("gemini --experimental-acp"),
            ["gemini", "--experimental-acp"]
        );
        assert_eq!(words("  a   b  "), ["a", "b"]);
        assert_eq!(words(r#"a "b c" 'd "e"'"#), ["a", "b c", r#"d "e""#]);
        assert_eq!(words("a ''"), ["a", ""]);
        assert_eq!(words("$(rm) `x` ;|&"), ["$(rm)", "`x`", ";|&"]);
        assert!(words_of("''").is_err());
    }

    /// A token file of a test's own, with something in it that is never read.
    fn token_in(temp: &TempFolder) -> String {
        let file = temp.path().join("moby-token");
        fs::write(&file, "not-a-real-token\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        file.to_str().unwrap().to_owned()
    }

    fn openclaw(_: &str) -> Option<Found> {
        Some(Found {
            path: "/opt/homebrew/bin/openclaw".to_owned(),
            real: None,
        })
    }

    fn words(command: &str) -> Vec<String> {
        words_of(command).unwrap()
    }

    #[test]
    fn openclaws_bridge_is_known_by_its_exact_command() {
        let bridge = |command: &str| bridge_of("/opt/homebrew/bin/openclaw", &words(command));
        assert_eq!(
            bridge("acp --url wss://gateway.example.org --token-file /Users/ada/.moby-token"),
            Ok(Some(Bridge { agent: None }))
        );
        assert_eq!(
            bridge(
                "acp --url ws://127.0.0.1:18789 --token-file /Users/ada/.moby-token \
                 --session agent:moby:main"
            ),
            Ok(Some(Bridge {
                agent: Some("moby".to_owned())
            }))
        );
        // Any other program is no bridge, whatever its arguments.
        assert_eq!(
            bridge_of("/opt/homebrew/bin/gemini", &words("acp --url wss://x")),
            Ok(None)
        );
        assert_eq!(
            bridge_of("/opt/homebrew/bin/openclaw-acp", &words("--url x")),
            Ok(None)
        );
    }

    #[test]
    fn openclaws_command_is_held_to_that_shape() {
        let bridge = |command: &str| bridge_of("/opt/homebrew/bin/openclaw", &words(command));
        let good = "--url wss://gateway.example.org --token-file /Users/ada/.moby-token";
        for refused in [
            // Not `acp`, or nothing after it.
            "gateway run".to_owned(),
            "acp".to_owned(),
            // A secret on the command line.
            format!("acp {good} --token not-a-real-token"),
            format!("acp {good} --password hunter2"),
            format!("acp {good} --password-file /Users/ada/.pw"),
            // Another flag, one given twice, and one with no value.
            format!("acp {good} --provenance meta"),
            format!("acp {good} --url wss://other.example.org"),
            "acp --url wss://gateway.example.org --token-file".to_owned(),
            // Either one missing.
            "acp --url wss://gateway.example.org".to_owned(),
            "acp --token-file /Users/ada/.moby-token".to_owned(),
            // An agent that isn't `agent:<id>:main`.
            format!("acp {good} --session agent:Moby:main"),
            format!("acp {good} --session main"),
            format!("acp {good} --session agent::main"),
            format!("acp {good} --session agent:moby:other"),
        ] {
            assert!(bridge(&refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn a_gateway_address_carries_no_secret() {
        for fine in [
            "wss://gateway.example.org",
            "wss://gateway.example.org:18789",
            "wss://gateway.example.org/gateway",
            "ws://127.0.0.1:18789",
            "ws://localhost:18789",
            "ws://[::1]:18789",
            "ws://192.168.1.20:18789",
            "wss://mini.tailnet.ts.net",
        ] {
            assert_eq!(gateway_url_problem(fine), None, "{fine}");
        }
        for refused in [
            "",
            "wss://",
            "https://gateway.example.org",
            "gateway.example.org",
            "wss://user:secret@gateway.example.org",
            "wss://secret@gateway.example.org",
            "wss://gateway.example.org?token=abc",
            "wss://gateway.example.org/path?token=abc",
            "wss://gateway.example.org/path#abc",
            "wss://gateway.example.org/a b",
            "wss://gateway.example.org/\u{202e}x",
            "wss://gate way.example.org",
            "wss://gateway.example.org;rm",
            &format!("wss://{}.example.org", "a".repeat(220)),
        ] {
            assert!(gateway_url_problem(refused).is_some(), "{refused}");
        }
    }

    #[test]
    fn a_token_file_is_named_by_a_whole_plain_path() {
        assert_eq!(
            token_file_path_problem("/Users/ada/.openclaw/gateway-token"),
            None
        );
        for refused in [
            "",
            "token",
            "~/token",
            "/Users/../token",
            "/Users//token",
            "/a/./b",
            "/tok\nen",
        ] {
            assert!(token_file_path_problem(refused).is_some(), "{refused:?}");
        }
    }

    #[test]
    fn adding_openclaw_checks_the_token_file_without_reading_it_and_says_where_things_go() {
        let temp = TempFolder::new("acp-openclaw");
        let agents = store(&temp);
        let token = token_in(&temp);
        let command = format!("openclaw acp --url wss://gateway.example.org --token-file {token}");
        let mut question = None;
        let list = agents
            .add("Moby", &command, openclaw, |asked| {
                question = Some(format!("{}\n{}", asked.title, asked.message));
                true
            })
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].bridge, Some(Bridge { agent: None }));
        let question = question.unwrap();
        // What goes where, and that the file is never read.
        assert!(
            question.contains("OpenClaw's bridge to the Gateway at wss://gateway.example.org"),
            "{question}"
        );
        assert!(
            question.contains("document and its comments are sent there"),
            "{question}"
        );
        assert!(question.contains("never reads the file"), "{question}");
        assert!(question.contains(&token), "{question}");
        assert!(
            !question.contains("not-a-real-token"),
            "the file's contents never get here"
        );
        assert!(!question.contains("isn't encrypted"), "{question}");
        assert!(!question.contains("Other people on this Mac"), "{question}");
        // It is listed with the flag, and the flag is what the file says.
        assert_eq!(
            agents.get("moby").unwrap().bridge,
            Some(Bridge { agent: None })
        );
        let saved = fs::read_to_string(&agents.file).unwrap();
        assert!(saved.contains("\"bridge\""), "{saved}");
        assert!(!saved.contains("not-a-real-token"));
    }

    #[test]
    fn the_question_warns_of_a_plain_address_and_of_a_token_others_can_read() {
        let temp = TempFolder::new("acp-openclaw-warn");
        let agents = store(&temp);
        let token = token_in(&temp);
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&token, fs::Permissions::from_mode(0o644)).unwrap();
        let mut message = String::new();
        agents
            .add(
                "Moby",
                &format!(
                    "openclaw acp --url ws://192.168.1.20:18789 --token-file {token} --session agent:moby:main"
                ),
                openclaw,
                |asked| {
                    message = asked.message.clone();
                    true
                },
            )
            .unwrap();
        assert!(
            message.contains("This address isn't encrypted (ws://)"),
            "{message}"
        );
        assert!(
            message.contains("Other people on this Mac can read the token file."),
            "{message}"
        );
        assert_eq!(
            agents.get("moby").unwrap().bridge,
            Some(Bridge {
                agent: Some("moby".to_owned())
            })
        );
    }

    #[test]
    fn a_token_file_that_cant_be_used_is_refused_before_anyone_is_asked() {
        let temp = TempFolder::new("acp-openclaw-token");
        let agents = store(&temp);
        let add = |file: &str| {
            agents.add(
                "Moby",
                &format!("openclaw acp --url wss://gateway.example.org --token-file {file}"),
                openclaw,
                |_| panic!("asked"),
            )
        };
        let missing = temp.path().join("gone");
        assert!(
            add(missing.to_str().unwrap())
                .unwrap_err()
                .starts_with("There is no token file at")
        );
        let empty = temp.path().join("empty");
        fs::write(&empty, "").unwrap();
        assert_eq!(
            add(empty.to_str().unwrap()),
            Err("The token file is empty.".to_owned())
        );
        let big = temp.path().join("big");
        fs::write(&big, vec![b'x'; 17 * 1024]).unwrap();
        assert!(
            add(big.to_str().unwrap())
                .unwrap_err()
                .contains("larger than a token file")
        );
        let folder = temp.path().join("folder");
        fs::create_dir_all(&folder).unwrap();
        assert!(
            add(folder.to_str().unwrap())
                .unwrap_err()
                .ends_with("isn't a file.")
        );
        // A link, which OpenClaw refuses, though what it leads to is fine.
        let link = temp.path().join("link");
        std::os::unix::fs::symlink(token_in(&temp), &link).unwrap();
        assert!(
            add(link.to_str().unwrap())
                .unwrap_err()
                .contains("is a link")
        );
        assert_eq!(agents.list(), []);
    }

    #[test]
    fn a_list_that_says_a_bridge_is_none_or_is_one_is_believed_only_where_the_command_agrees() {
        let temp = TempFolder::new("acp-openclaw-list");
        let agents = store(&temp);
        let token = token_in(&temp);
        let good = |bridge: &str| {
            format!(
                r#"{{"id":"moby","name":"Moby","program":"/opt/homebrew/bin/openclaw","args":["acp","--url","wss://gateway.example.org","--token-file","{token}"]{bridge}}}"#
            )
        };
        let write = |entries: &[String]| {
            fs::create_dir_all(agents.file.parent().unwrap()).unwrap();
            fs::write(&agents.file, format!("[{}]", entries.join(","))).unwrap();
        };
        write(&[good(r#","bridge":{}"#)]);
        assert_eq!(agents.list().len(), 1);
        assert_eq!(agents.list()[0].bridge, Some(Bridge { agent: None }));
        // A file that leaves the flag out of OpenClaw's bridge, or gives it to another agent, or
        // carries a token in the arguments, is not an entry this wrote.
        write(&[good("")]);
        assert_eq!(agents.list(), []);
        write(&[r#"{"id":"gemini","name":"Gemini","program":"/opt/homebrew/bin/gemini","args":["--experimental-acp"],"bridge":{}}"#.to_owned()]);
        assert_eq!(agents.list(), []);
        write(&[
            r#"{"id":"moby","name":"Moby","program":"/opt/homebrew/bin/openclaw","args":["acp","--url","wss://gateway.example.org","--token","secret"],"bridge":{}}"#
                .to_owned(),
        ]);
        assert_eq!(agents.list(), []);
        // An agent that isn't a bridge has no `bridge` in what it saves.
        let other = AcpAgent {
            id: "gemini".to_owned(),
            name: "Gemini".to_owned(),
            program: "/opt/homebrew/bin/gemini".to_owned(),
            args: vec!["--experimental-acp".to_owned()],
            bridge: None,
        };
        assert!(!serde_json::to_string(&other).unwrap().contains("bridge"));
    }
}
