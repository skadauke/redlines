//! The command lines the window may ask for. A program `which` found can still be made a shell by
//! its arguments: `codex sandbox -- sh`, an MCP server that is `/bin/sh`, or hooks in `--settings`.
//! So only the lines the providers use get through, and a refused flag is named in the error.
//!
//! This is the second place those lines live, on purpose: changing a provider's line means changing
//! this too. `provider-lines.json` holds them for a test on each side, so that neither can move
//! without the other (`src/provider-lines.node.test.ts`).

use std::path::Path;

use serde_json::Value;

/// One of the agents' own programs.
#[derive(Clone, Copy, Debug, PartialEq)]
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

    fn title(self) -> &'static str {
        match self {
            Agent::Claude => "Claude",
            Agent::Codex => "Codex",
        }
    }
}

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

/// Whether a small tool of the system's may be run this way, or `None` if `program` isn't one. A
/// provider makes an empty folder to run in with the first and removes it with the third, and finds
/// where a program really lives with the second. None of them can be started as a run.
pub fn check_system_tool(program: &str, args: &[String]) -> Option<Result<(), String>> {
    let allowed = match program {
        "/usr/bin/mktemp" => args == ["-d", "-t", "redlines-run"],
        "/bin/realpath" | "/bin/rmdir" => matches!(args, [path] if path.starts_with('/')),
        _ => return None,
    };
    Some(if allowed {
        Ok(())
    } else {
        Err(format!("Redlines won't run {program} that way."))
    })
}

/// Whether an agent's program may be started as a run this way. Everything after a `--` is the
/// prompt, which can say anything. `bundled` is the only program that may be an MCP server.
pub fn check_run_line(agent: Agent, args: &[String], bundled: &Path) -> Result<(), String> {
    let line: Vec<&str> = args
        .iter()
        .map(String::as_str)
        .take_while(|arg| *arg != "--")
        .collect();
    let refused = no_word_that_turns_off_safety(&line)
        .and_then(|()| match agent {
            Agent::Claude => claude_line(&line, bundled),
            Agent::Codex => codex_line(&line, bundled),
        })
        .err();
    match refused {
        None => Ok(()),
        Some(what) => Err(format!(
            "Redlines won't start {} with {what}.",
            agent.title()
        )),
    }
}

/// What is refused, for the error: a flag by its name, and anything else by its place, since it
/// may be someone's words.
fn name_of(arg: &str) -> String {
    if arg.starts_with('-') {
        arg.split('=').next().unwrap_or(arg).to_owned()
    } else {
        "an argument it wouldn't be given".to_owned()
    }
}

/// `dangerously` and `--yolo` anywhere but in free text: a selected quote goes in the system prompt,
/// and a folder in `-C`, and those can say "dangerously" and mean nothing by it. `claude_line` and
/// `codex_line` hold those two to what can't be a flag.
fn no_word_that_turns_off_safety(line: &[&str]) -> Result<(), String> {
    let mut free_text = false;
    for arg in line {
        let free = free_text || arg.starts_with("developer_instructions=");
        free_text = matches!(*arg, "--append-system-prompt" | "-C");
        if !free && (*arg == "--yolo" || arg.to_ascii_lowercase().contains("dangerously")) {
            return Err(name_of(arg));
        }
    }
    Ok(())
}

/// The line in `claudeArgs` (`plugins/agent-claude`), up to its `--`.
fn claude_line(line: &[&str], bundled: &Path) -> Result<(), String> {
    let Some((&"-p", rest)) = line.split_first() else {
        return Err("anything but -p first".to_owned());
    };
    let mut args = rest.iter().copied();
    while let Some(flag) = args.next() {
        let allowed = match flag {
            "--verbose" | "--restricted" | "--strict-mcp-config" => true,
            "--output-format" => args.next() == Some("stream-json"),
            "--permission-mode" => args.next() == Some("dontAsk"),
            "--tools" => args.next().is_some_and(|tools| {
                tools
                    .split(',')
                    .all(|tool| ["", "Read", "Grep", "Glob"].contains(&tool))
            }),
            "--allowedTools" => args.next().is_some_and(|tools| {
                tools
                    .split(',')
                    .all(|tool| tool.starts_with("mcp__redlines__"))
            }),
            "--settings" => args.next() == Some(r#"{"disableAllHooks":true}"#),
            "--mcp-config" => args
                .next()
                .is_some_and(|config| only_the_bundled_server(config, bundled)),
            "--append-system-prompt" => args.next().is_some_and(cant_be_a_flag),
            _ => false,
        };
        if !allowed {
            return Err(name_of(flag));
        }
    }
    Ok(())
}

/// The line in `codexArgs` (`plugins/agent-codex`), up to its `--`.
fn codex_line(line: &[&str], bundled: &Path) -> Result<(), String> {
    let Some((&"exec", rest)) = line.split_first() else {
        return Err("anything but exec first".to_owned());
    };
    let mut args = rest.iter().copied();
    while let Some(flag) = args.next() {
        let allowed = match flag {
            "--json"
            | "--strict-config"
            | "--skip-git-repo-check"
            | "--ignore-user-config"
            | "--ignore-rules" => true,
            "-C" => args.next().is_some_and(|folder| folder.starts_with('/')),
            // Turning a feature off is all this can do.
            "--disable" => args.next().is_some_and(|feature| {
                !feature.is_empty() && feature.chars().all(|c| c.is_ascii_lowercase() || c == '_')
            }),
            "-c" => {
                let setting = args.next().unwrap_or_default();
                if !codex_setting_is_allowed(setting, bundled) {
                    return Err(format!(
                        "the setting {}",
                        setting.split('=').next().unwrap_or_default()
                    ));
                }
                true
            }
            _ => false,
        };
        if !allowed {
            return Err(name_of(flag));
        }
    }
    Ok(())
}

/// One `-c` of the line. Anything else, such as `notify` or `sandbox_mode`, could run a program or
/// lift the sandbox. Values are as `codexArgs` writes them: JSON strings, which TOML reads the same.
fn codex_setting_is_allowed(setting: &str, bundled: &Path) -> bool {
    let Some((key, value)) = setting.split_once('=') else {
        return false;
    };
    match key {
        "approval_policy" => value == r#""never""#,
        "default_permissions" => value == r#""redlines""#,
        "web_search" => value == r#""disabled""#,
        "developer_instructions" => cant_be_a_flag(value),
        // With no escapes to hide it behind, `write` can't be there in any other spelling.
        "permissions.redlines.filesystem" => {
            !value.contains('\\') && !value.contains(r#""write""#) && !value.contains("'write'")
        }
        "mcp_servers.redlines.default_tools_approval_mode" => value == r#""approve""#,
        "mcp_servers.redlines.command" => serde_json::from_str::<String>(value)
            .is_ok_and(|command| Path::new(&command) == bundled),
        "mcp_servers.redlines.args" => {
            serde_json::from_str::<Vec<String>>(value).is_ok_and(|args| are_relay_args(&args))
        }
        _ => false,
    }
}

/// Free text as the value of a flag. A flag's value that starts with a dash is where a parser and
/// this check could disagree about what is a flag.
fn cant_be_a_flag(text: &str) -> bool {
    !text.starts_with('-')
}

/// Whether an MCP config, given as JSON and never as a file, names only the bundled program, doing
/// nothing but the relay, with nothing added to its environment.
fn only_the_bundled_server(config: &str, bundled: &Path) -> bool {
    let Ok(Value::Object(config)) = serde_json::from_str(config) else {
        return false;
    };
    let Some(Value::Object(servers)) = config.get("mcpServers") else {
        return false;
    };
    config.len() == 1
        && servers.values().all(|server| {
            let Value::Object(server) = server else {
                return false;
            };
            let command = server.get("command").and_then(Value::as_str);
            let args: Option<Vec<String>> = server
                .get("args")
                .and_then(|args| serde_json::from_value(args.clone()).ok());
            server.len() == 2
                && command.is_some_and(|command| Path::new(command) == bundled)
                && args.is_some_and(|args| are_relay_args(&args))
        })
}

/// `mcp --relay <socket>`: the program's other commands write files, which isn't for a server.
fn are_relay_args(args: &[String]) -> bool {
    matches!(args, [mcp, relay, _] if mcp == "mcp" && relay == "--relay")
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    const BUNDLED: &str = "/Applications/Redlines.app/Contents/MacOS/redlines";

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|&arg| arg.to_owned()).collect()
    }

    fn claude(args: &[&str]) -> Result<(), String> {
        check_run_line(Agent::Claude, &strings(args), Path::new(BUNDLED))
    }

    fn codex(args: &[&str]) -> Result<(), String> {
        check_run_line(Agent::Codex, &strings(args), Path::new(BUNDLED))
    }

    /// An MCP config for Claude with one server.
    fn config(server: &serde_json::Value) -> String {
        serde_json::json!({ "mcpServers": { "redlines": server } }).to_string()
    }

    fn the_real_server() -> serde_json::Value {
        serde_json::json!({ "command": BUNDLED, "args": ["mcp", "--relay", "/tmp/rl/s"] })
    }

    /// The providers' real lines, which `src/provider-lines.node.test.ts` holds to the providers.
    #[derive(Deserialize)]
    struct ProviderLines {
        bundled: String,
        lines: std::collections::BTreeMap<String, Vec<String>>,
    }

    #[test]
    fn the_providers_real_lines_are_allowed() {
        let lines: ProviderLines =
            serde_json::from_str(include_str!("provider-lines.json")).unwrap();
        assert_eq!(lines.lines.len(), 4);
        for (name, line) in &lines.lines {
            let agent = if name.starts_with("claude") {
                Agent::Claude
            } else {
                Agent::Codex
            };
            assert_eq!(
                check_run_line(agent, line, Path::new(&lines.bundled)),
                Ok(()),
                "{name}"
            );
        }
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
        let check = |program, args: &[&str]| check_system_tool(program, &strings(args));
        assert_eq!(
            check("/usr/bin/mktemp", &["-d", "-t", "redlines-run"]),
            Some(Ok(()))
        );
        assert_eq!(check("/bin/realpath", &["/opt/bin/codex"]), Some(Ok(())));
        assert_eq!(check("/bin/rmdir", &["/tmp/redlines-run.1"]), Some(Ok(())));

        for (program, args) in [
            ("/usr/bin/mktemp", &["/tmp/xXXXX"][..]),
            ("/usr/bin/mktemp", &["-d"]),
            ("/usr/bin/mktemp", &["-d", "-t", "another"]),
            ("/bin/realpath", &[]),
            ("/bin/realpath", &["relative"]),
            ("/bin/realpath", &["-e", "/x"]),
            ("/bin/realpath", &["/x", "/y"]),
            ("/bin/rmdir", &[]),
            ("/bin/rmdir", &["relative"]),
            ("/bin/rmdir", &["-p", "/x/y"]),
            ("/bin/rmdir", &["/x", "/y"]),
        ] {
            assert!(
                matches!(check(program, args), Some(Err(_))),
                "{program} {args:?}"
            );
        }
        assert_eq!(check("/bin/sh", &["-c", "x"]), None);
    }

    #[test]
    fn the_first_argument_is_p_for_claude_and_exec_for_codex() {
        assert!(claude(&["-p"]).is_ok());
        assert!(codex(&["exec"]).is_ok());
        for args in [&[][..], &["--verbose"], &["exec"], &["--print"], &["mcp"]] {
            assert!(claude(args).is_err(), "{args:?}");
        }
        for args in [
            &[][..],
            &["-p"],
            &["--json"],
            &["sandbox", "--", "/bin/sh"],
            &["--", "exec"],
        ] {
            assert!(codex(args).is_err(), "{args:?}");
        }
    }

    #[test]
    fn a_flag_that_turns_off_safety_is_refused() {
        for flag in [
            "--dangerously-skip-permissions",
            "--allow-dangerously-skip-permissions",
            "--dangerously-bypass-approvals-and-sandbox",
            "--yolo",
        ] {
            let refused = claude(&["-p", flag]).unwrap_err();
            assert!(refused.contains(flag), "{refused}");
            assert!(codex(&["exec", flag]).is_err(), "{flag}");
        }
    }

    #[test]
    fn the_word_is_refused_in_a_value_too_but_not_in_free_text() {
        // In any value that isn't someone's words.
        assert!(claude(&["-p", "--tools", "dangerouslyRead"]).is_err());
        assert!(codex(&["exec", "--disable", "dangerously"]).is_err());
        assert!(codex(&["exec", "-c", r#"web_search="dangerously""#]).is_err());
        // A person can select "the dam is dangerously high", or have a folder with that word.
        assert!(
            claude(&[
                "-p",
                "--append-system-prompt",
                "> the dam is dangerously high"
            ])
            .is_ok()
        );
        assert!(
            codex(&[
                "exec",
                "-c",
                r#"developer_instructions="> dangerously high""#
            ])
            .is_ok()
        );
        assert!(codex(&["exec", "-C", "/Users/ada/dangerously"]).is_ok());
    }

    #[test]
    fn free_text_cant_be_a_flag_in_disguise() {
        for text in ["--dangerously-skip-permissions", "--yolo", "-x"] {
            assert!(claude(&["-p", "--append-system-prompt", text]).is_err());
            assert!(codex(&["exec", "-C", text]).is_err());
        }
        assert!(codex(&["exec", "-c", "developer_instructions=-x"]).is_err());
        assert!(codex(&["exec", "-C", "relative/folder"]).is_err());
    }

    #[test]
    fn everything_after_a_double_dash_is_the_prompt() {
        for prompt in [
            "--dangerously-skip-permissions",
            "--yolo",
            "--mcp-config",
            "-c",
            "- a Markdown bullet",
        ] {
            assert!(claude(&["-p", "--", prompt]).is_ok(), "{prompt}");
            assert!(codex(&["exec", "--", prompt]).is_ok(), "{prompt}");
        }
        assert!(claude(&["-p", "--", "--", "--yolo"]).is_ok());
    }

    #[test]
    fn an_argument_with_no_flag_before_the_prompt_is_refused() {
        // It would be the prompt, or a second value for a flag that takes several.
        assert!(claude(&["-p", "hello"]).is_err());
        assert!(codex(&["exec", "hello"]).is_err());
        assert!(
            claude(&[
                "-p",
                "--mcp-config",
                &config(&the_real_server()),
                "/tmp/evil.json"
            ])
            .is_err()
        );
        assert!(claude(&["-p", "--tools", "Read", "Bash"]).is_err());
        assert!(claude(&["-p", "--allowedTools", "mcp__redlines__view", "Bash"]).is_err());
    }

    #[test]
    fn every_mcp_server_of_claude_is_the_bundled_program() {
        let good = config(&the_real_server());
        assert!(claude(&["-p", "--mcp-config", &good]).is_ok());

        let refused = [
            // Another program.
            config(&serde_json::json!({ "command": "/bin/sh", "args": ["mcp", "--relay", "s"] })),
            config(&serde_json::json!({ "command": "redlines", "args": ["mcp", "--relay", "s"] })),
            // The program, doing something else, or with a loaded environment.
            config(&serde_json::json!({ "command": BUNDLED, "args": ["view", "/etc/passwd"] })),
            config(&serde_json::json!({ "command": BUNDLED })),
            config(&serde_json::json!({
                "command": BUNDLED,
                "args": ["mcp", "--relay", "s"],
                "env": { "DYLD_INSERT_LIBRARIES": "/tmp/evil.dylib" },
            })),
            // Not a program at all.
            config(&serde_json::json!({ "type": "http", "url": "https://example.com/" })),
            serde_json::json!({ "mcpServers": { "redlines": "/bin/sh" } }).to_string(),
            // One good and one bad.
            serde_json::json!({ "mcpServers": {
                "redlines": the_real_server(),
                "other": { "command": "/bin/sh", "args": ["mcp", "--relay", "s"] },
            } })
            .to_string(),
            // Something besides the servers, a file, or not JSON.
            serde_json::json!({ "mcpServers": {}, "more": true }).to_string(),
            serde_json::json!({ "servers": {} }).to_string(),
            "/tmp/evil.json".to_owned(),
            "{not json".to_owned(),
        ];
        for config in &refused {
            assert!(claude(&["-p", "--mcp-config", config]).is_err(), "{config}");
        }
        assert!(claude(&["-p", "--mcp-config"]).is_err());
        assert!(claude(&["-p", &format!("--mcp-config={good}")]).is_err());
    }

    #[test]
    fn every_mcp_server_of_codex_is_the_bundled_program() {
        let command = format!(r#"mcp_servers.redlines.command="{BUNDLED}""#);
        let args = r#"mcp_servers.redlines.args=["mcp","--relay","/tmp/rl/s"]"#;
        assert!(codex(&["exec", "-c", &command, "-c", args]).is_ok());

        let inline = format!(r#"mcp_servers.x={{command="{BUNDLED}"}}"#);
        for setting in [
            r#"mcp_servers.redlines.command="/bin/sh""#,
            r#"mcp_servers.x.command="/bin/sh""#,
            r#"mcp_servers.redlines.command=["/bin/sh"]"#,
            r#"mcp_servers={x={command="/bin/sh"}}"#,
            r#"mcp_servers.x={command="/bin/sh"}"#,
            &inline,
            r#"mcp_servers.redlines.args=["view","/etc/passwd"]"#,
            r#"mcp_servers.redlines.env={DYLD_INSERT_LIBRARIES="/tmp/evil.dylib"}"#,
            r#""mcp_servers".x.command="/bin/sh""#,
        ] {
            let refused = codex(&["exec", "-c", setting]);
            assert!(refused.is_err(), "{setting}");
            assert!(refused.unwrap_err().contains("setting"), "{setting}");
        }
        // The other ways to write a setting aren't how a provider writes one.
        for arg in [
            format!("--config={command}"),
            format!("-c{command}"),
            "--config".to_owned(),
        ] {
            assert!(codex(&["exec", &arg]).is_err(), "{arg}");
        }
    }

    #[test]
    fn claude_cant_be_given_another_way_to_run_something() {
        let hooks = r#"{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"touch /tmp/x"}]}]}}"#;
        for args in [
            &["-p", "--settings", hooks][..],
            &["-p", "--settings", "/tmp/evil-settings.json"],
            &["-p", "--permission-mode", "bypassPermissions"],
            &["-p", "--permission-mode", "acceptEdits"],
            &["-p", "--tools", "Bash"],
            &["-p", "--tools", "Read,Bash"],
            &["-p", "--allowedTools", "Bash"],
            &["-p", "--allowedTools", "mcp__redlines__view,Bash"],
            &["-p", "--allowed-tools", "Bash"],
            &["-p", "--add-dir", "/"],
            &["-p", "--plugin-dir", "/tmp/evil"],
            &["-p", "--setting-sources", "project"],
            &["-p", "--resume", "someone-elses-session"],
            &["-p", "--output-format", "text"],
        ] {
            assert!(claude(args).is_err(), "{args:?}");
        }
    }

    #[test]
    fn codex_cant_be_given_another_way_to_run_something() {
        for args in [
            &["exec", "-c", r#"notify=["/bin/sh","-c","touch /tmp/x"]"#][..],
            &["exec", "-c", r#"sandbox_mode="danger-full-access""#],
            &["exec", "-c", r#"approval_policy="on-request""#],
            &["exec", "-c", r#"default_permissions="other""#],
            &["exec", "-c", r#"web_search="live""#],
            &[
                "exec",
                "-c",
                r#"mcp_servers.redlines.default_tools_approval_mode="prompt""#,
            ],
            &["exec", "-c", "no equals sign"],
            &["exec", "-c"],
            &["exec", "--sandbox", "danger-full-access"],
            &["exec", "-s", "danger-full-access"],
            &["exec", "--full-auto"],
            &["exec", "--enable", "computer_use"],
            &["exec", "--disable", "--yolo"],
            &["exec", "--disable", ""],
            &["exec", "--add-dir", "/"],
            &["exec", "resume", "someone-elses-session"],
        ] {
            assert!(codex(args).is_err(), "{args:?}");
        }
    }

    #[test]
    fn codex_cant_be_given_a_folder_to_write() {
        let profile = |value: &str| format!("permissions.redlines.filesystem={value}");
        let good = profile(r#"{":minimal"="read",":slash_tmp"="deny","/opt/rewrite/bin"="read"}"#);
        assert!(codex(&["exec", "-c", &good]).is_ok());
        for value in [
            r#"{"/"="write"}"#,
            r#"{"/"='write'}"#,
            r#"{"/"="""write"""}"#,
            r#"{"/"="write"}"#,
        ] {
            assert!(codex(&["exec", "-c", &profile(value)]).is_err(), "{value}");
        }
    }

    #[test]
    fn a_refusal_doesnt_repeat_someones_words() {
        let refused = claude(&["-p", "my private words"]).unwrap_err();
        assert!(!refused.contains("private"), "{refused}");
    }
}
