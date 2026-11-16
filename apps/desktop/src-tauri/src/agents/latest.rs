//! The newest version of an agent, for Preferences' Update button (#527): shown only when there is
//! one. The agents' packages on npm name the version their own updaters install, so the host asks
//! npm's registry for it with the system's `curl`, at a fixed address, sending nothing of the
//! person's: no document, no path, no account. The answer is kept for a few hours, so opening the
//! pane doesn't ask every time, and a failed look (offline) is no answer: the pane shows no Update
//! rather than guess.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use super::allowed::Agent;

/// The system's `curl`, which every Mac has.
const CURL: &str = "/usr/bin/curl";
/// How long an answer is kept.
const KEEP: Duration = Duration::from_secs(6 * 60 * 60);
/// How long the look may take, which is all of it: connecting and the answer.
const LOOK_SECONDS: &str = "10";
/// The most of an answer that is read, in bytes.
const MOST_READ: u64 = 2_000_000;
/// The most of an answer that curl itself takes, by what the server says it sends. The registry's answer for a package is a few kilobytes.
const MOST_BYTES: &str = "2000000";

type Answers = Mutex<HashMap<Agent, (Instant, String)>>;

fn kept() -> &'static Answers {
    static KEPT: OnceLock<Answers> = OnceLock::new();
    KEPT.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The address of the newest version of the agent's package.
pub fn registry_url(agent: Agent) -> String {
    format!("https://registry.npmjs.org/{}/latest", agent.npm_package())
}

/// The `x.y.z` in the registry's answer for a version, or nothing for anything else.
pub fn parse_latest(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let version = value.get("version")?.as_str()?;
    let numbers: Vec<&str> = version.split('.').collect();
    let plain = numbers.len() == 3
        && numbers.iter().all(|part| {
            !part.is_empty() && part.len() <= 9 && part.bytes().all(|b| b.is_ascii_digit())
        });
    plain.then(|| version.to_owned())
}

/// The newest version of the agent, kept for a few hours. An error says why it couldn't be found,
/// and isn't kept.
pub fn latest_version(agent: Agent, fresh: bool) -> Result<String, String> {
    if !fresh
        && let Some((at, version)) = kept()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&agent)
        && at.elapsed() < KEEP
    {
        return Ok(version.clone());
    }
    // `-q` first: no `.curlrc` of the person's changes the request.
    let mut child = Command::new(CURL)
        .args([
            "-q",
            "--fail",
            "--silent",
            "--location",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--max-time",
            LOOK_SECONDS,
            "--max-filesize",
            MOST_BYTES,
            "-H",
            "Accept: application/json",
        ])
        .arg(registry_url(agent))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Redlines couldn't look for a newer version.".to_owned())?;
    // Only so much is read, whatever the server sends (`--max-filesize` trusts its length).
    let mut body = Vec::new();
    if let Some(out) = child.stdout.take() {
        let _ = out.take(MOST_READ).read_to_end(&mut body);
    }
    let reached = if body.len() as u64 >= MOST_READ {
        // Still sending past the limit: stopped, and no answer.
        let _ = child.kill();
        let _ = child.wait();
        false
    } else {
        child.wait().is_ok_and(|status| status.success())
    };
    if !reached {
        return Err("Redlines couldn't reach the list of versions.".to_owned());
    }
    let version = parse_latest(&String::from_utf8_lossy(&body))
        .ok_or_else(|| "The list of versions said something Redlines doesn't know.".to_owned())?;
    kept()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(agent, (Instant::now(), version.clone()));
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_address_is_the_registry_and_the_package() {
        assert_eq!(
            registry_url(Agent::Claude),
            "https://registry.npmjs.org/@anthropic-ai/claude-code/latest"
        );
        assert_eq!(
            registry_url(Agent::Codex),
            "https://registry.npmjs.org/@openai/codex/latest"
        );
    }

    #[test]
    fn only_a_plain_version_is_taken() {
        assert_eq!(
            parse_latest(r#"{"name":"x","version":"2.1.400","dist":{}}"#),
            Some("2.1.400".to_owned())
        );
        for bad in [
            r#"{"version":"2.1.400-beta.1"}"#,
            r#"{"version":"2.1"}"#,
            r#"{"version":"2.1.x"}"#,
            r#"{"version":3}"#,
            r#"{"version":"1.2.3\n; rm"}"#,
            r#"{}"#,
            "not json",
        ] {
            assert_eq!(parse_latest(bad), None, "{bad}");
        }
    }
}
