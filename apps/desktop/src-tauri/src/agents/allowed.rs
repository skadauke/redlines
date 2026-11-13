//! The command lines the window may ask for. A program `which` found can still be made a shell by
//! its arguments, and checking flags one at a time has been shown not to hold: Claude splits a list
//! of tools on spaces as well as commas, TOML has more than one way to spell a word, and leaving a
//! protective flag out takes no flag at all. So a run has to match the provider's whole line: every
//! argument in its place with its exact text, and a few named slots, each with its own rule.
//!
//! What this does hold: the MCP server is the bundled program on a socket of this window's, the
//! tools and the file profile are the ones below, and nothing is added or left out. What it doesn't:
//! a window can still point a run at any folder, by `-C` or the `cwd` it asks for, and the system
//! prompt and the prompt are anyone's words, which is why they aren't looked into.
//!
//! This is the second place those lines live, on purpose: changing a provider's line means changing
//! this too. `provider-lines.json` holds them for a test on each side, so that neither can move
//! without the other (`src/provider-lines.node.test.ts`).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// One of the agents' own programs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Agent {
    Claude,
    Codex,
}

impl Agent {
    /// The agent whose program has this name. No other name is an agent's.
    pub fn named(name: &str) -> Option<Self> {
        match name {
            "claude" => Some(Agent::Claude),
            "codex" => Some(Agent::Codex),
            _ => None,
        }
    }

    /// What people call it.
    pub(super) fn title(self) -> &'static str {
        match self {
            Agent::Claude => "Claude",
            Agent::Codex => "Codex",
        }
    }

    /// The name of its program, which is also what `named` takes.
    pub(super) fn name(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
        }
    }
}

/// Makes an empty folder for a provider to run in.
pub const MKTEMP: &str = "/usr/bin/mktemp";
/// Removes that folder again.
pub const RMDIR: &str = "/bin/rmdir";
/// Finds where a program really lives, for Codex's file profile.
const REALPATH: &str = "/bin/realpath";

/// Whether an agent's program may be run this way to its end: for its version or sign-in status.
pub fn check_status_line(agent: Agent, args: &[String]) -> Result<(), String> {
    let status = match agent {
        Agent::Claude => ["auth", "status"],
        Agent::Codex => ["login", "status"],
    };
    if args == ["--version"] || args == status {
        Ok(())
    } else {
        Err(format!("Redlines won't run {} that way.", agent.title()))
    }
}

/// Whether a small tool of the system's may be run this way, or `None` if `program` isn't one.
/// `rmdir` removes only a folder `mktemp` made this session, and `realpath` looks only at a program
/// `which` found. None of them can be started as a run.
pub fn check_system_tool(
    program: &str,
    args: &[String],
    made_folders: &HashSet<PathBuf>,
    found_programs: &HashMap<PathBuf, Agent>,
) -> Option<Result<(), String>> {
    let allowed = match program {
        MKTEMP => args == ["-d", "-t", "redlines-run"],
        RMDIR => matches!(args, [folder] if made_folders.contains(Path::new(folder))),
        REALPATH => matches!(args, [path] if found_programs.contains_key(Path::new(path))),
        _ => return None,
    };
    Some(if allowed {
        Ok(())
    } else {
        Err(format!("Redlines won't run {program} that way."))
    })
}

/// What a line is compared with, from what the app knows rather than what the window says.
pub struct Known<'a> {
    /// The `redlines` program in the app.
    pub bundled: &'a str,
    /// The sockets of the relays that this window has open.
    pub sockets: &'a [String],
    /// The folder the program was found in, and the folder of its real path if that's another.
    pub program_folders: &'a [String],
}

/// One argument of a line.
enum Part {
    /// This text, and no other.
    Exact(String),
    /// One of these texts, and no other.
    OneOf(Vec<String>),
    /// Someone's words: any text, as long as nothing could take it for a flag.
    Words,
    /// An absolute path, which nothing could take for a flag.
    Folder,
    /// `developer_instructions=` and someone's words as a JSON string, as `codexArgs` writes them.
    /// One line of JSON can't be a second setting.
    Instructions,
    /// What comes after the `--`. It can say anything.
    Prompt,
}

const INSTRUCTIONS: &str = "developer_instructions=";

impl Part {
    fn accepts(&self, arg: &str) -> bool {
        match self {
            Part::Exact(text) => arg == text,
            Part::OneOf(texts) => texts.iter().any(|text| arg == text),
            Part::Words => !arg.starts_with('-'),
            Part::Folder => arg.starts_with('/'),
            Part::Instructions => arg
                .strip_prefix(INSTRUCTIONS)
                .is_some_and(|words| serde_json::from_str::<String>(words).is_ok()),
            Part::Prompt => true,
        }
    }

    /// What this argument should be, for an error. Never what it was, which may be someone's words.
    fn describe(&self) -> &str {
        match self {
            Part::Exact(text) if text.len() < 60 => text,
            Part::Exact(_) | Part::OneOf(_) => "what a provider passes there",
            Part::Words | Part::Prompt => "words that don't look like a flag",
            Part::Folder => "an absolute path",
            Part::Instructions => "instructions as a JSON string",
        }
    }
}

/// Arguments that have to be exactly these.
fn exact(texts: &[&str]) -> impl Iterator<Item = Part> {
    texts
        .iter()
        .map(|text| Part::Exact((*text).to_owned()))
        .collect::<Vec<_>>()
        .into_iter()
}

fn json_string(text: &str) -> String {
    serde_json::Value::from(text).to_string()
}

/// `mcp --relay <socket>` as JSON, as `JSON.stringify` writes it.
fn relay_args(socket: &str) -> String {
    serde_json::json!(["mcp", "--relay", socket]).to_string()
}

/// The `--mcp-config` of `claudeArgs`, as `JSON.stringify` writes it.
fn claude_mcp_config(bundled: &str, socket: &str) -> String {
    format!(
        r#"{{"mcpServers":{{"redlines":{{"command":{},"args":{}}}}}}}"#,
        json_string(bundled),
        relay_args(socket)
    )
}

/// The file profile of `codexArgs`. At This document there's no `:project_roots`.
fn codex_filesystem(program_folders: &[String], project_roots: bool) -> String {
    let mut entries = vec![r#"":minimal"="read""#.to_owned()];
    if project_roots {
        entries.push(r#"":project_roots"={"."="read"}"#.to_owned());
    }
    entries.push(r#"":slash_tmp"="deny""#.to_owned());
    entries.extend(
        program_folders
            .iter()
            .map(|folder| format!(r#"{}="read""#, json_string(folder))),
    );
    format!("permissions.redlines.filesystem={{{}}}", entries.join(","))
}

/// `claudeArgs` in `plugins/agent-claude`, and the same with the fallback the findings keep ready in
/// case `--restricted` loses a plan's sign-in.
fn claude_lines(known: &Known) -> Vec<Vec<Part>> {
    let line = |isolation: &[&str]| {
        let configs = known
            .sockets
            .iter()
            .map(|socket| claude_mcp_config(known.bundled, socket))
            .collect();
        exact(&["-p", "--output-format", "stream-json", "--verbose"])
            .chain(exact(isolation))
            .chain(exact(&["--permission-mode", "dontAsk", "--tools"]))
            .chain([Part::OneOf(vec![
                "Read,Grep,Glob".to_owned(),
                String::new(),
            ])])
            .chain(exact(&[
                "--allowedTools",
                "mcp__redlines__view,mcp__redlines__read_thread,mcp__redlines__str_replace,\
                 mcp__redlines__comment,mcp__redlines__reply,mcp__redlines__status",
                "--mcp-config",
            ]))
            .chain([Part::OneOf(configs)])
            .chain(exact(&[
                "--strict-mcp-config",
                "--settings",
                r#"{"disableAllHooks":true}"#,
                "--append-system-prompt",
            ]))
            .chain([Part::Words])
            .chain(exact(&["--"]))
            .chain([Part::Prompt])
            .collect()
    };
    vec![
        line(&["--restricted"]),
        line(&["--setting-sources", "user"]),
    ]
}

/// `codexArgs` in `plugins/agent-codex`.
fn codex_lines(known: &Known) -> Vec<Vec<Part>> {
    let args = known
        .sockets
        .iter()
        .map(|socket| format!("mcp_servers.redlines.args={}", relay_args(socket)))
        .collect();
    let line = exact(&["exec", "--json", "--strict-config", "-C"])
        .chain([Part::Folder])
        .chain(exact(&[
            "--skip-git-repo-check",
            "--ignore-user-config",
            "--ignore-rules",
            "-c",
            r#"approval_policy="never""#,
            "-c",
            r#"default_permissions="redlines""#,
            "-c",
        ]))
        .chain([Part::OneOf(vec![
            codex_filesystem(known.program_folders, true),
            codex_filesystem(known.program_folders, false),
        ])])
        .chain(exact(&[
            "-c",
            &format!(
                "mcp_servers.redlines.command={}",
                json_string(known.bundled)
            ),
            "-c",
        ]))
        .chain([Part::OneOf(args)])
        .chain(exact(&[
            "-c",
            r#"mcp_servers.redlines.default_tools_approval_mode="approve""#,
            "-c",
        ]))
        .chain([Part::Instructions])
        .chain(exact(&[
            "--disable",
            "apps",
            "--disable",
            "plugins",
            "--disable",
            "image_generation",
            "--disable",
            "goals",
            "--disable",
            "skill_search",
            "--disable",
            "tool_suggest",
            "--disable",
            "computer_use",
            "--disable",
            "browser_use",
            "--disable",
            "in_app_browser",
            "--disable",
            "hooks",
            "-c",
            r#"web_search="disabled""#,
            "--",
        ]))
        .chain([Part::Prompt])
        .collect();
    vec![line]
}

/// How far a line matches, and what's wrong where it stops.
fn compare(line: &[Part], args: &[String]) -> Result<(), (usize, String)> {
    for (at, part) in line.iter().enumerate() {
        match args.get(at) {
            None => return Err((at, format!("nothing where {} should be", part.describe()))),
            Some(arg) if !part.accepts(arg) => {
                let number = at + 1;
                return Err((
                    at,
                    format!("argument {number} not being {}", part.describe()),
                ));
            }
            Some(_) => {}
        }
    }
    if args.len() > line.len() {
        return Err((
            line.len(),
            "more arguments than a provider passes".to_owned(),
        ));
    }
    Ok(())
}

/// Whether an agent's program may be started as a run this way: only as a whole line of its
/// provider's. An empty `known.bundled` means the app doesn't know its own program, and then nothing
/// starts.
pub fn check_run_line(agent: Agent, args: &[String], known: &Known) -> Result<(), String> {
    if known.bundled.is_empty() {
        return Err(format!(
            "Redlines won't start {}: it can't find its own program.",
            agent.title()
        ));
    }
    let lines = match agent {
        Agent::Claude => claude_lines(known),
        Agent::Codex => codex_lines(known),
    };
    let mut closest: Option<(usize, String)> = None;
    for line in &lines {
        match compare(line, args) {
            Ok(()) => return Ok(()),
            Err(why) if closest.as_ref().is_none_or(|(at, _)| why.0 > *at) => closest = Some(why),
            Err(_) => {}
        }
    }
    let why = closest.map_or_else(String::new, |(_, why)| why);
    Err(format!(
        "Redlines won't start {} with {why}.",
        agent.title()
    ))
}

#[cfg(test)]
pub mod tests {
    use serde::Deserialize;

    use super::*;

    /// The providers' real lines, which `src/provider-lines.node.test.ts` holds to the providers.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ProviderLines {
        pub bundled: String,
        pub socket: String,
        pub program_folders: Vec<String>,
        pub lines: std::collections::BTreeMap<String, Vec<String>>,
        /// The messages `plugins/agent-acp` writes to an agent (`acp_gate.rs`).
        pub acp: AcpMessages,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AcpMessages {
        pub folder: String,
        pub session_id: String,
        pub messages: std::collections::BTreeMap<String, serde_json::Value>,
    }

    pub fn provider_lines() -> ProviderLines {
        serde_json::from_str(include_str!("provider-lines.json")).unwrap()
    }

    pub fn codex_filesystem_for_tests(program_folders: &[String], project_roots: bool) -> String {
        codex_filesystem(program_folders, project_roots)
    }

    /// Runs `check` with what the app would know while the file's lines are being asked for.
    fn with_known<T>(check: impl FnOnce(&ProviderLines, &Known) -> T) -> T {
        let lines = provider_lines();
        let sockets = [lines.socket.clone()];
        let known = Known {
            bundled: &lines.bundled,
            sockets: &sockets,
            program_folders: &lines.program_folders,
        };
        check(&lines, &known)
    }

    fn agent_of(name: &str) -> Agent {
        if name.starts_with("claude") {
            Agent::Claude
        } else {
            Agent::Codex
        }
    }

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|&arg| arg.to_owned()).collect()
    }

    fn claude(args: &[&str]) -> Result<(), String> {
        with_known(|_, known| check_run_line(Agent::Claude, &strings(args), known))
    }

    fn codex(args: &[&str]) -> Result<(), String> {
        with_known(|_, known| check_run_line(Agent::Codex, &strings(args), known))
    }

    /// A provider's real line with the argument that starts with `prefix` changed.
    fn with_changed(name: &str, prefix: &str, to: &str) -> Vec<String> {
        let mut line = provider_lines().lines[name].clone();
        let at = line.iter().position(|arg| arg.starts_with(prefix)).unwrap();
        line[at] = to.to_owned();
        line
    }

    /// A provider's real line with the value of `flag` changed.
    fn with_value_of(name: &str, flag: &str, to: &str) -> Vec<String> {
        let mut line = provider_lines().lines[name].clone();
        let at = line.iter().position(|arg| arg == flag).unwrap();
        line[at + 1] = to.to_owned();
        line
    }

    fn check_claude(line: &[String]) -> Result<(), String> {
        with_known(|_, known| check_run_line(Agent::Claude, line, known))
    }

    fn check_codex(line: &[String]) -> Result<(), String> {
        with_known(|_, known| check_run_line(Agent::Codex, line, known))
    }

    #[test]
    fn every_provider_line_is_allowed() {
        with_known(|lines, known| {
            assert_eq!(lines.lines.len(), 4);
            for (name, line) in &lines.lines {
                assert_eq!(
                    check_run_line(agent_of(name), line, known),
                    Ok(()),
                    "{name}"
                );
            }
        });
    }

    #[test]
    fn the_fallback_line_is_allowed_and_only_in_that_place() {
        let mut line = provider_lines().lines["claude at a folder"].clone();
        let at = line.iter().position(|arg| arg == "--restricted").unwrap();
        line.splice(at..=at, strings(&["--setting-sources", "user"]));
        assert_eq!(check_claude(&line), Ok(()));

        // Not with another source, and not on top of the other one.
        let mut other = line.clone();
        other[at + 1] = "project".to_owned();
        assert!(check_claude(&other).is_err());
        let mut both = line.clone();
        both.insert(at, "--restricted".to_owned());
        assert!(check_claude(&both).is_err());
    }

    #[test]
    fn claude_cant_be_given_bash_through_a_space() {
        // Claude takes "comma or space-separated", and this offered Bash and ran it.
        for tools in [
            "mcp__redlines__view Bash",
            "mcp__redlines__view,Bash",
            "Bash",
            "mcp__redlines__view",
        ] {
            let line = with_value_of("claude at a folder", "--allowedTools", tools);
            assert!(check_claude(&line).is_err(), "{tools}");
        }
        for tools in [
            "Read Bash",
            "Read,Grep,Glob,Bash",
            "Read",
            "Bash",
            "read,grep,glob",
        ] {
            let line = with_value_of("claude at a folder", "--tools", tools);
            assert!(check_claude(&line).is_err(), "{tools}");
        }
    }

    #[test]
    fn protective_flags_cant_be_left_out() {
        // These ran a folder's own `SessionStart` hook, and brought back the person's config.
        assert!(
            claude(&[
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--",
                "hi"
            ])
            .is_err()
        );
        assert!(codex(&["exec", "--skip-git-repo-check", "--", "hi"]).is_err());
        assert!(claude(&["-p"]).is_err());
        assert!(claude(&[]).is_err());
        assert!(codex(&["exec"]).is_err());
        assert!(codex(&[]).is_err());
    }

    #[test]
    fn codex_cant_run_with_its_hooks_on() {
        // Codex's hooks are on by default, and `--ignore-user-config` doesn't turn them off.
        for name in ["codex at a folder", "codex at this document"] {
            let mut line = provider_lines().lines[name].clone();
            let at = line.iter().position(|arg| arg == "hooks").unwrap();
            assert_eq!(line[at - 1], "--disable");
            line.drain(at - 1..=at);
            assert!(check_codex(&line).is_err(), "{name}");
        }
    }

    #[test]
    fn leaving_out_any_one_argument_is_refused() {
        with_known(|lines, known| {
            for (name, line) in &lines.lines {
                for at in 0..line.len() {
                    let mut shorter = line.clone();
                    shorter.remove(at);
                    assert!(
                        check_run_line(agent_of(name), &shorter, known).is_err(),
                        "{name} without argument {at}: {}",
                        line[at]
                    );
                }
            }
        });
    }

    #[test]
    fn an_extra_flag_is_refused_anywhere() {
        with_known(|lines, known| {
            for (name, line) in &lines.lines {
                for at in 0..=line.len() {
                    for extra in ["--dangerously-skip-permissions", "--yolo", "-x", "words"] {
                        let mut longer = line.clone();
                        longer.insert(at, extra.to_owned());
                        assert!(
                            check_run_line(agent_of(name), &longer, known).is_err(),
                            "{name} with {extra} at {at}"
                        );
                    }
                }
            }
        });
    }

    #[test]
    fn a_reordered_line_is_refused() {
        with_known(|lines, known| {
            for (name, line) in &lines.lines {
                for at in 0..line.len() - 1 {
                    if line[at] == line[at + 1] {
                        continue;
                    }
                    let mut swapped = line.clone();
                    swapped.swap(at, at + 1);
                    assert!(
                        check_run_line(agent_of(name), &swapped, known).is_err(),
                        "{name} with {at} and {} swapped",
                        at + 1
                    );
                }
            }
        });
        // A whole flag and its value moved, which keeps every pair together.
        let mut line = provider_lines().lines["claude at a folder"].clone();
        let at = line.iter().position(|arg| arg == "--settings").unwrap();
        let moved: Vec<String> = line.drain(at..at + 2).collect();
        line.splice(1..1, moved);
        assert!(check_claude(&line).is_err());
    }

    #[test]
    fn every_exact_argument_is_compared_as_text() {
        with_known(|lines, known| {
            for (name, line) in &lines.lines {
                for at in 0..line.len() {
                    let free = at + 1 == line.len()
                        || line[at].starts_with(INSTRUCTIONS)
                        || at > 0
                            && matches!(
                                line[at - 1].as_str(),
                                "-C" | "--append-system-prompt" | "--tools"
                            );
                    if free {
                        continue;
                    }
                    let mut changed = line.clone();
                    changed[at].push(' ');
                    assert!(
                        check_run_line(agent_of(name), &changed, known).is_err(),
                        "{name} with argument {at} changed: {}",
                        line[at]
                    );
                }
            }
        });
    }

    #[test]
    fn no_spelling_of_a_setting_gets_through() {
        let name = "codex at a folder";
        let bundled = provider_lines().bundled;
        let command = |value: &str| format!("mcp_servers.redlines.command={value}");
        let profile = |value: &str| format!("permissions.redlines.filesystem={value}");
        for setting in [
            // A TOML string drops a newline right after its quotes. This wrote a file, for real.
            profile("{\"/x\"=\"\"\"\nwrite\"\"\"}"),
            profile("{\"/x\"='''\nwrite'''}"),
            profile(r#"{"/x"="write"}"#),
            profile(r#"{"/x"='write'}"#),
            profile(r#"{"/x"="write"}"#),
            profile(r#"{"/"="read"}"#),
        ] {
            let line = with_changed(name, "permissions.redlines.filesystem=", &setting);
            assert!(check_codex(&line).is_err(), "{setting}");
        }
        for setting in [
            // A JSON parser reads this as the bundled program.
            command(&format!(r#""\/{}""#, &bundled[1..])),
            command(&format!("'{bundled}'")),
            command(r#""/bin/sh""#),
        ] {
            let line = with_changed(name, "mcp_servers.redlines.command=", &setting);
            assert!(check_codex(&line).is_err(), "{setting}");
        }
        for setting in [
            r#"mcp_servers.redlines.args=["view","/etc/passwd"]"#,
            r#"mcp_servers.redlines.args=["mcp", "--relay", "/var/folders/06/T/rl-7582-0/s"]"#,
        ] {
            let line = with_changed(name, "mcp_servers.redlines.args=", setting);
            assert!(check_codex(&line).is_err(), "{setting}");
        }
    }

    #[test]
    fn the_mcp_server_is_the_bundled_program_on_this_windows_socket() {
        let (bundled, socket) = {
            let lines = provider_lines();
            (lines.bundled, lines.socket)
        };
        let name = "claude at a folder";
        for config in [
            claude_mcp_config("/bin/sh", &socket),
            claude_mcp_config(&bundled, "/tmp/someone-elses/s"),
            // The same thing spelled another way, which isn't what Rust built.
            claude_mcp_config(&bundled, &socket).replace("\":", "\": "),
            format!(
                r#"{{"mcpServers":{{"redlines":{{"args":{},"command":{}}}}}}}"#,
                relay_args(&socket),
                json_string(&bundled)
            ),
            "/tmp/evil.json".to_owned(),
        ] {
            let line = with_value_of(name, "--mcp-config", &config);
            assert!(check_claude(&line).is_err(), "{config}");
        }

        // With no relay of this window's open, no line can name one.
        with_known(|lines, known| {
            let none = Known {
                sockets: &[],
                ..*known
            };
            for (name, line) in &lines.lines {
                assert!(
                    check_run_line(agent_of(name), line, &none).is_err(),
                    "{name}"
                );
            }
            let others = ["/tmp/another-windows/s".to_owned()];
            let elsewhere = Known {
                sockets: &others,
                ..*known
            };
            for (name, line) in &lines.lines {
                assert!(
                    check_run_line(agent_of(name), line, &elsewhere).is_err(),
                    "{name}"
                );
            }
        });
    }

    #[test]
    fn a_profile_is_for_the_programs_own_folders() {
        with_known(|lines, known| {
            let folders = ["/somewhere/else".to_owned()];
            let elsewhere = Known {
                program_folders: &folders,
                ..*known
            };
            for name in ["codex at a folder", "codex at this document"] {
                assert!(check_run_line(Agent::Codex, &lines.lines[name], &elsewhere).is_err());
            }
        });
    }

    #[test]
    fn nothing_starts_if_the_app_cant_find_its_own_program() {
        with_known(|lines, known| {
            let lost = Known {
                bundled: "",
                ..*known
            };
            for (name, line) in &lines.lines {
                let empty_named = line.join("\u{1}").replace(&lines.bundled, "");
                let line: Vec<String> = empty_named.split('\u{1}').map(str::to_owned).collect();
                assert!(
                    check_run_line(agent_of(name), &line, &lost).is_err(),
                    "{name}"
                );
            }
        });
    }

    #[test]
    fn free_text_isnt_looked_into_but_cant_be_a_flag() {
        // A person can select "the dam is dangerously high", or have a folder with that word.
        let claude_name = "claude at a folder";
        let codex_name = "codex at a folder";
        let quote = "> the dam is dangerously high, --yolo";
        let line = with_value_of(claude_name, "--append-system-prompt", quote);
        assert_eq!(check_claude(&line), Ok(()));
        let line = with_value_of(codex_name, "-C", "/Users/ada/dangerously/--yolo");
        assert_eq!(check_codex(&line), Ok(()));
        let words = format!("{INSTRUCTIONS}{}", json_string(quote));
        let line = with_changed(codex_name, INSTRUCTIONS, &words);
        assert_eq!(check_codex(&line), Ok(()));

        for text in ["--dangerously-skip-permissions", "--yolo", "-x"] {
            let line = with_value_of(claude_name, "--append-system-prompt", text);
            assert!(check_claude(&line).is_err(), "{text}");
            let line = with_value_of(codex_name, "-C", text);
            assert!(check_codex(&line).is_err(), "{text}");
        }
        assert!(check_codex(&with_value_of(codex_name, "-C", "relative/folder")).is_err());
        // Instructions are a single JSON string, which can't turn into another setting.
        for words in [
            "developer_instructions=-x",
            "developer_instructions=\"x\"\nnotify=[\"/bin/sh\"]",
            "developer_instructions='x'",
            "developer_instructions=[1]",
            "notify=\"x\"",
        ] {
            let line = with_changed(codex_name, INSTRUCTIONS, words);
            assert!(check_codex(&line).is_err(), "{words}");
        }
    }

    #[test]
    fn the_prompt_can_say_anything_and_there_is_one() {
        for name in provider_lines().lines.keys() {
            let check = |line: &[String]| {
                with_known(|_, known| check_run_line(agent_of(name), line, known))
            };
            for prompt in [
                "--dangerously-skip-permissions",
                "--yolo",
                "--",
                "-c",
                "",
                "- a bullet",
            ] {
                let mut line = provider_lines().lines[name].clone();
                *line.last_mut().unwrap() = prompt.to_owned();
                assert_eq!(check(&line), Ok(()), "{name}: {prompt}");
            }
            let mut two = provider_lines().lines[name].clone();
            two.push("b".to_owned());
            assert!(check(&two).is_err(), "{name}");
        }
        assert!(claude(&["-p", "--", "a", "b", "c"]).is_err());
    }

    #[test]
    fn a_refusal_doesnt_repeat_someones_words() {
        let mut line = provider_lines().lines["claude at a folder"].clone();
        line.insert(1, "my private words".to_owned());
        let refused = check_claude(&line).unwrap_err();
        assert!(!refused.contains("private"), "{refused}");
        assert!(refused.contains("--output-format"), "{refused}");
    }

    #[test]
    fn status_lines_are_only_the_ones_in_use() {
        let check = |agent, args: &[&str]| check_status_line(agent, &strings(args));
        assert!(check(Agent::Claude, &["--version"]).is_ok());
        assert!(check(Agent::Codex, &["--version"]).is_ok());
        assert!(check(Agent::Claude, &["auth", "status"]).is_ok());
        assert!(check(Agent::Codex, &["login", "status"]).is_ok());

        for args in [
            &["sandbox", "--", "/bin/sh", "-c", "touch /tmp/x"][..],
            &["exec", "hello"],
            &["-p", "hello"],
            &["auth", "login"],
            &["auth", "status", "--json"],
            &["--version", "--help"],
            &[],
        ] {
            assert!(check(Agent::Claude, args).is_err(), "{args:?}");
            assert!(check(Agent::Codex, args).is_err(), "{args:?}");
        }
        // Each has its own.
        assert!(check(Agent::Claude, &["login", "status"]).is_err());
        assert!(check(Agent::Codex, &["auth", "status"]).is_err());
    }

    #[test]
    fn system_tools_run_only_as_the_providers_run_them() {
        let made = HashSet::from([PathBuf::from("/tmp/redlines-run.abc")]);
        let found = HashMap::from([(PathBuf::from("/opt/bin/codex"), Agent::Codex)]);
        let check =
            |program, args: &[&str]| check_system_tool(program, &strings(args), &made, &found);
        assert_eq!(check(MKTEMP, &["-d", "-t", "redlines-run"]), Some(Ok(())));
        assert_eq!(check(REALPATH, &["/opt/bin/codex"]), Some(Ok(())));
        assert_eq!(check(RMDIR, &["/tmp/redlines-run.abc"]), Some(Ok(())));

        for (program, args) in [
            (MKTEMP, &["/tmp/xXXXX"][..]),
            (MKTEMP, &["-d"]),
            (MKTEMP, &["-d", "-t", "another"]),
            (REALPATH, &[]),
            (REALPATH, &["relative"]),
            (REALPATH, &["/etc/passwd"]),
            (REALPATH, &["-e", "/opt/bin/codex"]),
            (REALPATH, &["/opt/bin/codex", "/opt/bin/codex"]),
            // Any empty folder but the one this session made is someone else's.
            (RMDIR, &[]),
            (RMDIR, &["/Users/ada/empty-but-mine"]),
            (RMDIR, &["relative"]),
            (RMDIR, &["-p", "/tmp/redlines-run.abc"]),
            (RMDIR, &["/tmp/redlines-run.abc", "/tmp/redlines-run.abc"]),
            (RMDIR, &["/tmp/redlines-run.abc/../redlines-run.abc/"]),
        ] {
            assert!(
                matches!(check(program, args), Some(Err(_))),
                "{program} {args:?}"
            );
        }
        assert_eq!(check("/bin/sh", &["-c", "x"]), None);
    }
}
