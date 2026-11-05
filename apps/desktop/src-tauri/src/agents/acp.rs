//! Agents that speak the Agent Client Protocol, each "a name and a command" the person added in
//! Preferences ▸ Agents. The list is a file of the app's own that only this writes, and nothing goes
//! in it, or comes out of it, without the person's answer to a native question (`Question`), which
//! the window can neither draw nor answer. The question names the exact program the command
//! resolves to and its arguments, because those, and nothing else, are what a run of the agent
//! starts: the window names the agent by its id, and the app builds the line (`acp_start` in
//! `mod.rs`). What the window may then say to the agent is `acp_gate.rs`'s.

use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, TryLockError};

use serde::{Deserialize, Serialize};

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
}

/// What the native question says, and its two answers. The first answer is the yes.
#[derive(Debug, PartialEq)]
pub struct Question {
    pub title: String,
    pub message: String,
    pub yes: &'static str,
    pub no: &'static str,
}

/// The ids of the agents Redlines runs by their own providers.
const TAKEN: [&str; 2] = ["claude", "codex"];
const MAX_NAME: usize = 40;
const MAX_ID: usize = 24;

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
                    && agent.program.starts_with('/')
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
    /// resolves the command's program to a path, and `ask` puts the question and gives the answer.
    /// Returns the list as it then is.
    pub fn add(
        &self,
        name: &str,
        command: &str,
        find: impl FnOnce(&str) -> Option<String>,
        ask: impl FnOnce(&Question) -> bool,
    ) -> Result<Vec<AcpAgent>, String> {
        let name = name.trim();
        let id = id_for(name)?;
        let mut words = words_of(command)?.into_iter();
        let word = words.next().unwrap_or_default();
        if !word.starts_with('/') && word.contains('/') {
            return Err("Give the program's name, or its whole path.".to_owned());
        }
        let program =
            find(&word).ok_or_else(|| format!("Redlines can't find {word} on this Mac."))?;
        let agent = AcpAgent {
            id,
            name: name.to_owned(),
            program,
            args: words.collect(),
        };

        let _changing = self.one_at_a_time()?;
        let mut agents = self.list();
        let replaced = agents.iter().position(|other| other.id == agent.id);
        let question = Question {
            title: format!("Let Redlines run {} as an agent?", shown(&agent)),
            message: match replaced {
                Some(at) => format!(
                    "It takes the place of {}, which runs {}. An agent may also act on its own, \
                     outside what it asks Redlines, as its own settings allow.",
                    agents[at].name,
                    shown(&agents[at])
                ),
                None => format!(
                    "It will be listed as {}. An agent may also act on its own, outside what it \
                     asks Redlines, as its own settings allow.",
                    agent.name
                ),
            },
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
    if name.is_empty() || name.chars().count() > MAX_NAME || name.chars().any(char::is_control) {
        return Err(format!(
            "Give the agent a name of up to {MAX_NAME} characters."
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
/// words, and quotes, single or double, around a word with spaces in it.
pub fn words_of(command: &str) -> Result<Vec<String>, String> {
    if command.chars().any(char::is_control) {
        return Err("Give the command on one line.".to_owned());
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
    if words.first().is_none_or(String::is_empty) {
        return Err(
            "Give the command that starts the agent, such as gemini --experimental-acp.".to_owned(),
        );
    }
    Ok(words)
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

    fn gemini(_: &str) -> Option<String> {
        Some("/opt/homebrew/bin/gemini".to_owned())
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
                "OpenClaw",
                "openclaw acp 'two words'",
                |word| {
                    found.set(word.to_owned());
                    Some("/Users/ada/.local/bin/openclaw".to_owned())
                },
                |asked| {
                    title = asked.title.clone();
                    true
                },
            )
            .unwrap();
        assert_eq!(found.take(), "openclaw");
        assert_eq!(
            title,
            "Let Redlines run /Users/ada/.local/bin/openclaw acp 'two words' as an agent?"
        );
        assert_eq!(agents.get("openclaw").unwrap().args, ["acp", "two words"]);
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
        for command in ["", "   ", "bin/gemini acp", "./gemini", "'unclosed", "a\nb"] {
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
    fn ids_come_from_names_and_never_take_claudes_or_codexs() {
        assert_eq!(id_for("Gemini").as_deref(), Ok("gemini"));
        assert_eq!(id_for("OpenClaw").as_deref(), Ok("openclaw"));
        assert_eq!(id_for("Open Code 2").as_deref(), Ok("open-code-2"));
        assert_eq!(id_for("  goose!  ").as_deref(), Ok("goose"));
        assert_eq!(id_for("2fast").as_deref(), Ok("fast"));
        for name in ["Claude", "codex", "", "   ", "123", "!!!", "a\u{7}b"] {
            assert!(id_for(name).is_err(), "{name:?}");
        }
        assert!(id_for(&"x".repeat(41)).is_err());
        assert_eq!(id_for(&"x".repeat(40)).unwrap().len(), MAX_ID);
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
}
