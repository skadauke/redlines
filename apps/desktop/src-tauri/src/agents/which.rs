//! Finding an agent's program, and what may be started.
//!
//! An app started from Finder doesn't have the shell's `PATH`, so `claude` in `~/.local/bin` is
//! found by looking in known places, and otherwise by asking a login shell. The login shell's
//! `PATH` is what a program then runs with, because a program found anywhere may be a script that
//! needs `node` from it. The window can start only what `which` returned this session, and only as
//! `allowed.rs` says.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use super::allowed::{
    Agent, Known, MKTEMP, RMDIR, check_run_line, check_status_line, check_system_tool,
};
use super::process::{ExecOutput, Execs, clean_environment};
use super::relay::bundled_program;

/// How long a status command may take before it's killed.
const EXEC_TIMEOUT: Duration = Duration::from_secs(30);

/// How long a login shell may take to answer. Some people's take seconds.
const LOGIN_SHELL_TIMEOUT: Duration = Duration::from_secs(10);

/// What stands before each part of a login shell's answer, because its profile may print anything.
const PATH_MARK: &str = "redlines-login-path";
const FOUND_MARK: &str = "redlines-command-v";

/// Finds programs, and remembers what it found.
pub struct Programs {
    known_places: Vec<PathBuf>,
    shell: PathBuf,
    login_shell_timeout: Duration,
    environment: Vec<(OsString, OsString)>,
    /// The only program that may be an agent's MCP server.
    bundled: PathBuf,
    execs: Execs,
    remembered: Mutex<Remembered>,
}

#[derive(Default)]
struct Remembered {
    returned: HashMap<PathBuf, Agent>,
    login_path: Option<OsString>,
    /// A login shell has been asked for its `PATH`, and might not have answered.
    asked_for_path: bool,
    /// The folders `mktemp` made, until `rmdir` has removed them.
    made_folders: HashSet<PathBuf>,
}

impl Programs {
    /// `environment` is what the login shell and every program start from.
    pub fn new(
        known_places: Vec<PathBuf>,
        shell: PathBuf,
        environment: Vec<(OsString, OsString)>,
        bundled: PathBuf,
    ) -> Self {
        Programs {
            known_places,
            shell,
            login_shell_timeout: LOGIN_SHELL_TIMEOUT,
            environment,
            bundled,
            execs: Execs::default(),
            remembered: Mutex::default(),
        }
    }

    /// Finds programs as this app, as this user, on this machine.
    pub fn for_this_machine() -> Self {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let known_places = home
            .map(|home| home.join(".local/bin"))
            .into_iter()
            .chain([
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/usr/local/bin"),
            ])
            .collect();
        let shell =
            std::env::var_os("SHELL").map_or_else(|| PathBuf::from("/bin/sh"), PathBuf::from);
        // With no path to compare with, `check_run_line` refuses every line.
        let bundled = std::env::current_exe()
            .ok()
            .and_then(|exe| bundled_program(&exe))
            .unwrap_or_default();
        Programs::new(
            known_places,
            shell,
            clean_environment(std::env::vars_os()),
            bundled,
        )
    }

    fn remembered(&self) -> MutexGuard<'_, Remembered> {
        self.remembered
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// The program for an agent's name, if this machine has it. Only an agent's name is answered.
    pub fn which(&self, name: &str) -> Option<String> {
        let agent = Agent::named(name)?;
        let known = self
            .known_places
            .iter()
            .map(|place| place.join(name))
            .find(|path| is_program(path));
        // A program in a known place still needs the login shell's `PATH` to run with, once. Ask
        // more often than that, and a shell that hangs holds up every run.
        let ask = known.is_none() || !self.remembered().asked_for_path;
        let answer = if ask {
            self.ask_login_shell(name)
        } else {
            LoginAnswer::default()
        };
        let found = known.or(answer.found);
        let mut remembered = self.remembered();
        remembered.asked_for_path = true;
        if remembered.login_path.is_none() {
            remembered.login_path = answer.path;
        }
        let found = found?;
        let returned = found.to_str()?.to_owned();
        remembered.returned.insert(found, agent);
        Some(returned)
    }

    /// Where the program of a command the person gave for an agent is (`acp.rs`): a whole path to
    /// a program, or a plain name found as `which` finds an agent's. Unlike `which`, it remembers
    /// nothing that may start: a program found here runs only as an agent the person allowed.
    pub fn find_program(&self, word: &str) -> Option<String> {
        if word.starts_with('/') {
            return (is_clean_path(word) && is_program(Path::new(word))).then(|| word.to_owned());
        }
        if !is_plain_name(word) {
            return None;
        }
        let known = self
            .known_places
            .iter()
            .map(|place| place.join(word))
            .find(|path| is_program(path));
        let found = known.or_else(|| {
            let answer = self.ask_login_shell(word);
            let mut remembered = self.remembered();
            remembered.asked_for_path = true;
            if remembered.login_path.is_none() {
                remembered.login_path = answer.path;
            }
            answer.found
        })?;
        found.to_str().map(str::to_owned)
    }

    /// The `redlines` program in the app, or `None` if the app can't find its own.
    pub fn bundled(&self) -> Option<&str> {
        self.bundled.to_str().filter(|path| !path.is_empty())
    }

    /// Asks a login shell for its `PATH` and for where it finds a program. The name can go in the
    /// script because only an agent's name, or a plain name (`is_plain_name`), is ever asked about.
    fn ask_login_shell(&self, name: &str) -> LoginAnswer {
        let args = [
            "-lc".to_owned(),
            format!("echo {PATH_MARK}; printenv PATH; echo {FOUND_MARK}; command -v {name}"),
        ];
        let Some(shell) = self.shell.to_str() else {
            return LoginAnswer::default();
        };
        self.execs
            .run(shell, &args, &self.environment, self.login_shell_timeout)
            .map(|output| LoginAnswer::from_output(&output.stdout, name))
            .unwrap_or_default()
    }

    /// The agent whose program this is: only what `which` returned this session.
    fn agent_at(&self, program: &str) -> Result<Agent, String> {
        self.remembered()
            .returned
            .get(Path::new(program))
            .copied()
            .ok_or_else(|| format!("Redlines didn't find {program}, so it won't run it."))
    }

    /// Whether `program` may be started as a run with these arguments: only what `which` returned
    /// this session, and only as a whole line of its provider's, naming one of `sockets`, the
    /// asking window's relays (`allowed.rs`).
    pub fn may_start(
        &self,
        program: &str,
        args: &[String],
        sockets: &[String],
    ) -> Result<(), String> {
        let known = Known {
            bundled: self.bundled.to_str().unwrap_or_default(),
            sockets,
            program_folders: &program_folders(program),
        };
        check_run_line(self.agent_at(program)?, args, &known)
    }

    /// Whether `program` may be run to its end with these arguments: what `which` returned for its
    /// version or sign-in status, and the system's small tools for what a provider needs of them.
    pub fn may_exec(&self, program: &str, args: &[String]) -> Result<(), String> {
        let remembered = self.remembered();
        match check_system_tool(
            program,
            args,
            &remembered.made_folders,
            &remembered.returned,
        ) {
            Some(allowed) => allowed,
            None => {
                drop(remembered);
                check_status_line(self.agent_at(program)?, args)
            }
        }
    }

    /// Runs a program to its end, if it may be, and remembers a folder that made or removed.
    pub fn exec(&self, program: &str, args: &[String]) -> Result<ExecOutput, String> {
        self.may_exec(program, args)?;
        let environment = self.environment_for(Path::new(program));
        let output = self.execs.run(program, args, &environment, EXEC_TIMEOUT)?;
        if output.code == Some(0) {
            let mut remembered = self.remembered();
            if program == MKTEMP {
                let folder = PathBuf::from(output.stdout.trim());
                remembered.made_folders.insert(folder);
            } else if program == RMDIR {
                remembered.made_folders.remove(Path::new(&args[0]));
            }
        }
        Ok(output)
    }

    /// Kills any status command or login shell still going, and runs no more, for when the app
    /// quits.
    pub fn stop_execs(&self) {
        self.execs.stop_all();
    }

    /// The environment to start `program` with: this one's, with the login shell's `PATH`, and the
    /// program's own folder on the end, since a script there often needs what is beside it.
    pub fn environment_for(&self, program: &Path) -> Vec<(OsString, OsString)> {
        let (mut path, mut environment): (Vec<_>, Vec<_>) = self
            .environment
            .iter()
            .cloned()
            .partition(|(name, _)| name == "PATH");
        let path = self
            .remembered()
            .login_path
            .clone()
            .or_else(|| path.pop().map(|(_, value)| value))
            .unwrap_or_default();
        let mut folders: Vec<PathBuf> = std::env::split_paths(&path).collect();
        if let Some(folder) = program
            .parent()
            .filter(|folder| !folders.iter().any(|f| f == folder))
        {
            folders.push(folder.to_owned());
        }
        let path = std::env::join_paths(&folders).unwrap_or(path);
        environment.push((OsString::from("PATH"), path));
        environment
    }
}

/// The folder a program was found in, and the folder of its real path if that's another: what a
/// provider asks Codex to be able to read.
fn program_folders(program: &str) -> Vec<String> {
    let found = Path::new(program);
    let real = fs::canonicalize(found).unwrap_or_else(|_| found.to_owned());
    let mut folders = Vec::new();
    for path in [found, &real] {
        if let Some(folder) = path.parent().and_then(Path::to_str)
            && !folders.iter().any(|known| known == folder)
        {
            folders.push(folder.to_owned());
        }
    }
    folders
}

/// What a login shell said.
#[derive(Default)]
struct LoginAnswer {
    path: Option<OsString>,
    found: Option<PathBuf>,
}

impl LoginAnswer {
    fn from_output(stdout: &str, name: &str) -> Self {
        let mut lines = stdout.lines().skip_while(|line| *line != PATH_MARK).skip(1);
        let path = lines
            .by_ref()
            .take_while(|line| *line != FOUND_MARK)
            .last()
            .filter(|path| !path.is_empty())
            .map(OsString::from);
        // `command -v` can answer with an alias, which can't be run. The `PATH` it came with can.
        let found = lines
            .map(PathBuf::from)
            .find(|path| path.is_absolute() && is_program(path))
            .or_else(|| {
                std::env::split_paths(path.as_deref()?)
                    .filter(|folder| folder.is_absolute())
                    .map(|folder| folder.join(name))
                    .find(|path| is_program(path))
            });
        LoginAnswer { path, found }
    }
}

/// Whether a whole path says plainly where it is: absolute, with no `.`, `..` or empty parts.
pub fn is_clean_path(path: &str) -> bool {
    path.strip_prefix('/').is_some_and(|rest| {
        rest.split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
    })
}

/// A name a shell takes as it is: letters, digits and `._+-`, starting with a letter or digit.
fn is_plain_name(word: &str) -> bool {
    word.starts_with(|c: char| c.is_ascii_alphanumeric())
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c))
}

/// Whether `path` is a file that can be run, following links.
fn is_program(path: &Path) -> bool {
    fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::symlink;

    use super::*;
    use crate::agents::allowed::tests::{
        codex_filesystem_for_tests as codex_filesystem, provider_lines,
    };
    use crate::agents::test_support::TempFolder;

    const BUNDLED: &str = "/Applications/Redlines.app/Contents/MacOS/redlines";

    /// Programs with no bundled program to speak of, for tests of finding one.
    fn programs(
        known_places: Vec<PathBuf>,
        shell: PathBuf,
        environment: Vec<(OsString, OsString)>,
    ) -> Programs {
        Programs::new(known_places, shell, environment, PathBuf::from(BUNDLED))
    }

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|&arg| arg.to_owned()).collect()
    }

    fn value<'a>(environment: &'a [(OsString, OsString)], name: &str) -> Option<&'a OsString> {
        environment
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value)
    }

    /// A folder holding a program named `name`: a link to a program that's already on the machine,
    /// so nothing has to run a file that was just written.
    fn with_program(folder: &Path, name: &str) -> PathBuf {
        fs::create_dir_all(folder).unwrap();
        let path = folder.join(name);
        symlink("/bin/echo", &path).unwrap();
        path
    }

    /// A login shell that is the real `/bin/sh`, with a home whose profile sets `PATH`, as a
    /// person's does, and says hello on the way, as some do.
    fn login_shell(home: &Path, path_line: &str) -> (PathBuf, Vec<(OsString, OsString)>) {
        fs::write(
            home.join(".profile"),
            format!("echo Welcome back\nPATH={path_line}\nexport PATH\n"),
        )
        .unwrap();
        let environment = vec![
            (OsString::from("HOME"), home.as_os_str().to_owned()),
            (OsString::from("PATH"), OsString::from("/usr/bin:/bin")),
        ];
        (PathBuf::from("/bin/sh"), environment)
    }

    #[test]
    fn it_looks_in_known_places_first() {
        let temp = TempFolder::new("which-known");
        let known = temp.path().join("known");
        let program = with_program(&known, "claude");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = programs(vec![temp.path().join("none"), known], shell, environment);
        assert_eq!(
            programs.which("claude").as_deref(),
            program.to_str(),
            "found in a known place"
        );
    }

    #[test]
    fn then_it_asks_a_login_shell() {
        let temp = TempFolder::new("which-shell");
        let elsewhere = temp.path().join("elsewhere");
        let program = with_program(&elsewhere, "codex");
        let path_line = format!("{}:/usr/bin:/bin", elsewhere.display());
        let (shell, environment) = login_shell(temp.path(), &path_line);
        let programs = programs(vec![], shell, environment);
        assert_eq!(programs.which("codex").as_deref(), program.to_str());
        assert_eq!(programs.which("claude"), None);
    }

    #[test]
    fn a_file_that_cant_run_isnt_found() {
        let temp = TempFolder::new("which-plain");
        let known = temp.path().join("known");
        fs::create_dir_all(&known).unwrap();
        fs::write(known.join("claude"), "not a program").unwrap();
        fs::create_dir_all(known.join("codex")).unwrap();
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = programs(vec![known], shell, environment);
        assert_eq!(programs.which("claude"), None);
        assert_eq!(programs.which("codex"), None);
    }

    #[test]
    fn it_answers_only_for_agents() {
        let temp = TempFolder::new("which-agents");
        let known = temp.path().join("known");
        let sh = with_program(&known, "sh");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = programs(vec![known], shell, environment);
        for name in ["sh", "git", "../claude", "/bin/sh", "claude;touch x", ""] {
            assert_eq!(programs.which(name), None, "{name}");
        }
        assert!(
            programs.may_start(sh.to_str().unwrap(), &[], &[]).is_err(),
            "nor is what it wouldn't answer for remembered"
        );
    }

    #[test]
    fn a_command_for_an_agent_finds_its_program_but_nothing_it_may_start() {
        let temp = TempFolder::new("which-find");
        let known = temp.path().join("known");
        let gemini = with_program(&known, "gemini");
        let elsewhere = temp.path().join("elsewhere");
        let openclaw = with_program(&elsewhere, "openclaw");
        let path_line = format!("{}:/usr/bin:/bin", elsewhere.display());
        let (shell, environment) = login_shell(temp.path(), &path_line);
        let programs = programs(vec![known], shell, environment);

        assert_eq!(programs.find_program("gemini").as_deref(), gemini.to_str());
        assert_eq!(
            programs.find_program("openclaw").as_deref(),
            openclaw.to_str(),
            "by the login shell"
        );
        assert_eq!(
            programs.find_program(gemini.to_str().unwrap()).as_deref(),
            gemini.to_str()
        );
        assert_eq!(programs.find_program("/etc/passwd"), None, "not a program");
        let climbing = format!("{}/../known/gemini", known_folder(&gemini));
        assert_eq!(programs.find_program(&climbing), None, "a path with ..");
        let doubled = gemini.to_str().unwrap().replacen('/', "//", 1);
        assert_eq!(
            programs.find_program(&doubled),
            None,
            "a path with an empty part"
        );
        assert_eq!(programs.find_program("nowhere"), None);
        // Found isn't startable: only what the person allowed runs, by its id.
        let (line, sockets) = claude_line();
        assert!(
            programs
                .may_start(gemini.to_str().unwrap(), &line, &sockets)
                .is_err()
        );
        assert!(programs.may_exec(gemini.to_str().unwrap(), &[]).is_err());
    }

    fn known_folder(program: &Path) -> String {
        program.parent().unwrap().to_str().unwrap().to_owned()
    }

    #[test]
    fn a_clean_path_is_absolute_with_no_dots_or_empty_parts() {
        for clean in [
            "/bin/sh",
            "/opt/homebrew/bin/gemini",
            "/a/.hidden/b",
            "/a/b..c",
        ] {
            assert!(is_clean_path(clean), "{clean}");
        }
        for unclean in [
            "",
            "/",
            "bin/sh",
            "/bin/../sh",
            "/bin/./sh",
            "//bin/sh",
            "/bin/sh/",
            "/.",
        ] {
            assert!(!is_clean_path(unclean), "{unclean}");
        }
    }

    #[test]
    fn a_name_that_isnt_plain_never_reaches_a_shell() {
        let temp = TempFolder::new("which-find-plain");
        let asked = temp.path().join("asked");
        fs::write(
            temp.path().join(".profile"),
            format!("echo asked >> '{}'\n", asked.display()),
        )
        .unwrap();
        let environment = vec![(OsString::from("HOME"), temp.path().as_os_str().to_owned())];
        let programs = programs(vec![], PathBuf::from("/bin/sh"), environment);
        let touched = temp.path().join("touched");
        let dangerous = format!("x;touch {}", touched.display());
        for word in [
            dangerous.as_str(),
            "$(touch x)",
            "`x`",
            "-x",
            "a b",
            "",
            "../gemini",
            "bin/gemini",
            "gemini\nid",
        ] {
            assert_eq!(programs.find_program(word), None, "{word}");
        }
        assert!(!asked.exists(), "the login shell wasn't asked");
        assert!(!touched.exists());
    }

    #[test]
    fn a_login_shell_that_hangs_doesnt_hang_the_app() {
        let temp = TempFolder::new("which-hang");
        fs::write(temp.path().join(".profile"), "sleep 60\n").unwrap();
        let environment = vec![(OsString::from("HOME"), temp.path().as_os_str().to_owned())];
        let programs = Programs {
            login_shell_timeout: Duration::from_millis(200),
            ..programs(vec![], PathBuf::from("/bin/sh"), environment)
        };
        let started = std::time::Instant::now();
        assert_eq!(programs.which("claude"), None);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn a_login_shell_that_hangs_holds_up_only_the_first_look() {
        let temp = TempFolder::new("which-once");
        let known = temp.path().join("known");
        with_program(&known, "claude");
        let asked = temp.path().join("asked");
        fs::write(
            temp.path().join(".profile"),
            format!("echo once >> '{}'\nsleep 60\n", asked.display()),
        )
        .unwrap();
        let environment = vec![(OsString::from("HOME"), temp.path().as_os_str().to_owned())];
        let programs = Programs {
            login_shell_timeout: Duration::from_millis(200),
            ..programs(vec![known], PathBuf::from("/bin/sh"), environment)
        };
        assert!(programs.which("claude").is_some());
        assert!(programs.which("claude").is_some());
        assert_eq!(fs::read_to_string(&asked).unwrap(), "once\n");
    }

    #[test]
    fn an_alias_isnt_a_program_but_the_login_shells_path_may_hold_one() {
        let temp = TempFolder::new("which-alias");
        let folder = temp.path().join("bin");
        let program = with_program(&folder, "claude");
        let printed = format!(
            "Welcome back\n{PATH_MARK}\n{}\n{FOUND_MARK}\nalias claude='claude --flag'\n",
            folder.display()
        );
        let answer = LoginAnswer::from_output(&printed, "claude");
        assert_eq!(answer.path.as_deref(), Some(folder.as_os_str()));
        assert_eq!(answer.found.as_deref(), Some(program.as_path()));

        let answer = LoginAnswer::from_output(&printed, "codex");
        assert_eq!(answer.found, None);

        let answer = LoginAnswer::from_output("a profile that exits early\n", "claude");
        assert_eq!(answer.path, None);
        assert_eq!(answer.found, None);
    }

    #[test]
    fn it_knows_the_usual_places() {
        let programs = Programs::for_this_machine();
        assert!(
            programs
                .known_places
                .contains(&PathBuf::from("/opt/homebrew/bin"))
        );
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        assert!(programs.known_places.contains(&home.join(".local/bin")));
    }

    #[test]
    fn it_runs_programs_with_the_login_shells_path() {
        let temp = TempFolder::new("which-path");
        let known = temp.path().join("known");
        let program = with_program(&known, "claude");
        let (shell, environment) = login_shell(temp.path(), "/opt/from-login:/usr/bin");
        let programs = programs(vec![known.clone()], shell, environment);
        programs.which("claude").unwrap();

        let environment = programs.environment_for(&program);
        let path: Vec<_> = std::env::split_paths(value(&environment, "PATH").unwrap()).collect();
        assert_eq!(path[0], PathBuf::from("/opt/from-login"));
        assert_eq!(path[1], PathBuf::from("/usr/bin"));
        // A script's `env node` often sits beside it, wherever the shell's `PATH` says.
        assert_eq!(path[2], known);
        assert_eq!(path.len(), 3);
        assert_eq!(
            value(&environment, "HOME"),
            Some(&temp.path().as_os_str().to_owned())
        );
    }

    #[test]
    fn without_a_login_shell_programs_get_the_path_the_app_has() {
        let temp = TempFolder::new("which-noshell");
        let known = temp.path().join("known");
        let program = with_program(&known, "claude");
        let environment = vec![(OsString::from("PATH"), OsString::from("/usr/bin:/bin"))];
        let programs = programs(
            vec![known.clone()],
            temp.path().join("no-such-shell"),
            environment,
        );
        programs.which("claude").unwrap();
        let environment = programs.environment_for(&program);
        let path: Vec<_> = std::env::split_paths(value(&environment, "PATH").unwrap()).collect();
        assert_eq!(
            path,
            [PathBuf::from("/usr/bin"), PathBuf::from("/bin"), known]
        );
    }

    /// The provider's real line for Claude, and the window's relay that it names.
    fn claude_line() -> (Vec<String>, Vec<String>) {
        let lines = provider_lines();
        (
            lines.lines["claude at a folder"].clone(),
            vec![lines.socket.clone()],
        )
    }

    #[test]
    fn refuses_a_program_which_never_returned() {
        let temp = TempFolder::new("which-refuse");
        let known = temp.path().join("known");
        let program = with_program(&known, "claude");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = programs(vec![known.clone()], shell, environment);
        let path = program.to_str().unwrap();
        let (run, sockets) = claude_line();
        let status = strings(&["auth", "status"]);

        // Not yet: `which` hasn't returned it.
        assert!(programs.may_start(path, &run, &sockets).is_err());
        assert!(programs.may_exec(path, &status).is_err());
        programs.which("claude").unwrap();
        assert_eq!(programs.may_start(path, &run, &sockets), Ok(()));
        assert!(programs.may_exec(path, &status).is_ok());

        for other in ["/bin/sh", "/bin/echo", "claude", "", "/usr/bin/env"] {
            assert!(
                programs.may_start(other, &run, &sockets).is_err(),
                "{other}"
            );
            assert!(programs.may_exec(other, &status).is_err(), "{other}");
        }
        // The same file by another name isn't what was returned.
        let aside = known.join("..").join("known").join("claude");
        assert!(
            programs
                .may_start(aside.to_str().unwrap(), &run, &sockets)
                .is_err()
        );
    }

    #[test]
    fn a_program_that_was_returned_is_held_to_its_own_agents_lines() {
        let temp = TempFolder::new("which-lines");
        let known = temp.path().join("known");
        let claude = with_program(&known, "claude");
        let codex = with_program(&known, "codex");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = programs(vec![known], shell, environment);
        programs.which("claude").unwrap();
        programs.which("codex").unwrap();
        let (claude, codex) = (claude.to_str().unwrap(), codex.to_str().unwrap());
        let (line, sockets) = claude_line();

        assert_eq!(programs.may_start(claude, &line, &sockets), Ok(()));
        assert!(programs.may_start(codex, &line, &sockets).is_err());
        // The window's relays are what decide, and another window's aren't this one's.
        assert!(programs.may_start(claude, &line, &[]).is_err());

        let sandbox = strings(&["sandbox", "--", "/bin/sh", "-c", "touch /tmp/x"]);
        assert!(programs.may_exec(codex, &sandbox).is_err());
        assert!(
            programs
                .may_exec(codex, &strings(&["login", "status"]))
                .is_ok()
        );
        assert!(
            programs
                .may_exec(codex, &strings(&["auth", "status"]))
                .is_err()
        );
    }

    #[test]
    fn codexs_profile_is_held_to_where_the_program_really_is() {
        let temp = TempFolder::new("which-profile");
        let known = temp.path().join("known");
        let codex = with_program(&known, "codex");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = programs(vec![known.clone()], shell, environment);
        programs.which("codex").unwrap();
        let codex = codex.to_str().unwrap();
        let lines = provider_lines();
        let sockets = [lines.socket.clone()];
        let line = lines.lines["codex at a folder"].clone();

        // The file's line names the folders of a Homebrew install, which this one isn't.
        assert!(programs.may_start(codex, &line, &sockets).is_err());

        let real = fs::canonicalize(known.join("codex")).unwrap();
        assert_eq!(
            program_folders(codex),
            [
                known.to_str().unwrap().to_owned(),
                real.parent().unwrap().to_str().unwrap().to_owned(),
            ]
        );
        let profile = |folders: &[String]| {
            let mut line = line.clone();
            let at = line
                .iter()
                .position(|arg| arg.starts_with("permissions.redlines.filesystem="))
                .unwrap();
            line[at] = codex_filesystem(folders, true);
            line
        };
        assert_eq!(
            programs.may_start(codex, &profile(&program_folders(codex)), &sockets),
            Ok(())
        );
    }

    #[test]
    fn a_program_with_only_one_folder_lists_it_once() {
        let temp = TempFolder::new("which-one-folder");
        let plain = fs::canonicalize(temp.path()).unwrap().join("codex");
        fs::write(&plain, "").unwrap();
        let folder = plain.parent().unwrap().to_str().unwrap().to_owned();
        assert_eq!(program_folders(plain.to_str().unwrap()), [folder]);
    }

    #[test]
    fn the_bundled_program_is_the_only_mcp_server() {
        let temp = TempFolder::new("which-bundled");
        let known = temp.path().join("known");
        let claude = with_program(&known, "claude");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let bundled = PathBuf::from("/Somewhere/Else.app/Contents/MacOS/redlines");
        let programs = Programs::new(vec![known], shell, environment, bundled);
        programs.which("claude").unwrap();
        let (line, sockets) = claude_line();
        // The file's line names another copy of the program.
        assert!(
            programs
                .may_start(claude.to_str().unwrap(), &line, &sockets)
                .is_err()
        );
    }

    #[test]
    fn exec_also_runs_the_system_tools_a_provider_needs_but_start_doesnt() {
        let temp = TempFolder::new("which-tools");
        let known = temp.path().join("known");
        let codex = with_program(&known, "codex");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = programs(vec![known], shell, environment);
        let codex = codex.to_str().unwrap();
        programs.which("codex").unwrap();
        let (run, sockets) = claude_line();
        for (tool, args) in [
            (MKTEMP, strings(&["-d", "-t", "redlines-run"])),
            ("/bin/realpath", strings(&[codex])),
        ] {
            assert!(programs.may_exec(tool, &args).is_ok(), "{tool}");
            assert!(programs.may_start(tool, &run, &sockets).is_err(), "{tool}");
        }
    }

    // Agents run only on the Mac, and only macOS's `mktemp` takes `-t` with a bare prefix: GNU's
    // wants a template with X's in it, so on Linux the line fails as it should.
    #[test]
    #[cfg_attr(not(target_os = "macos"), ignore = "needs macOS's mktemp")]
    fn rmdir_removes_only_a_folder_mktemp_made_this_session() {
        let temp = TempFolder::new("which-rmdir");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = programs(vec![], shell, environment);

        // An empty folder of someone else's stays.
        let someone_elses = temp.path().join("someone-elses");
        fs::create_dir(&someone_elses).unwrap();
        let args = [someone_elses.to_str().unwrap().to_owned()];
        assert!(programs.exec(RMDIR, &args).is_err());
        assert!(someone_elses.exists());

        let made = programs
            .exec(MKTEMP, &strings(&["-d", "-t", "redlines-run"]))
            .unwrap();
        assert_eq!(made.code, Some(0));
        let folder = made.stdout.trim().to_owned();
        assert!(Path::new(&folder).is_dir());

        // A folder that has something in it stays, and can be tried again.
        let file = Path::new(&folder).join("a-file");
        fs::write(&file, "").unwrap();
        let args = [folder.clone()];
        assert_ne!(programs.exec(RMDIR, &args).unwrap().code, Some(0));
        assert!(Path::new(&folder).is_dir());
        fs::remove_file(&file).unwrap();

        assert_eq!(programs.exec(RMDIR, &args).unwrap().code, Some(0));
        assert!(!Path::new(&folder).exists());

        // And once it has gone, the name means nothing any more.
        fs::create_dir(&folder).unwrap();
        assert!(programs.exec(RMDIR, &args).is_err());
        fs::remove_dir(&folder).unwrap();
    }

    #[test]
    fn stop_execs_kills_a_login_shell_that_hangs_and_it_stays_stopped() {
        let temp = TempFolder::new("which-quit");
        fs::write(temp.path().join(".profile"), "sleep 60\n").unwrap();
        let environment = vec![(OsString::from("HOME"), temp.path().as_os_str().to_owned())];
        let programs = std::sync::Arc::new(programs(vec![], PathBuf::from("/bin/sh"), environment));
        let asking = {
            let programs = std::sync::Arc::clone(&programs);
            std::thread::spawn(move || programs.which("claude"))
        };
        // Give it time to be going, without counting on it.
        std::thread::sleep(Duration::from_millis(200));
        let began = std::time::Instant::now();
        programs.stop_execs();
        assert_eq!(asking.join().unwrap(), None);
        assert!(
            began.elapsed() < Duration::from_secs(5),
            "{:?}",
            began.elapsed()
        );
    }
}
