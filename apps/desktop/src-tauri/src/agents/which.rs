//! Finding an agent's program, and what may be started.
//!
//! An app started from Finder doesn't have the shell's `PATH`, so `claude` in `~/.local/bin` is
//! found by looking in known places, and otherwise by asking a login shell. The login shell's
//! `PATH` is what a program then runs with, because a program found anywhere may be a script that
//! needs `node` from it. The window can start only what `which` returned this session.

use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use super::process::{clean_environment, exec};

/// The agents' programs, the only names `which` answers for. Without this, the rule that the window
/// can start only what `which` returned would mean nothing: it could ask for `sh`.
const AGENTS: [&str; 2] = ["claude", "codex"];

/// The system's own small tools, which `exec` runs too: a provider makes an empty folder to run in
/// with the first, and finds where a program really lives with the second. Neither runs anything
/// else, and neither can be started as a run.
const SYSTEM_TOOLS: [&str; 2] = ["/usr/bin/mktemp", "/bin/realpath"];

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
    remembered: Mutex<Remembered>,
}

#[derive(Default)]
struct Remembered {
    returned: HashSet<PathBuf>,
    login_path: Option<OsString>,
    /// A login shell has been asked for its `PATH`, and might not have answered.
    asked_for_path: bool,
}

impl Programs {
    /// `environment` is what the login shell and every program start from.
    pub fn new(
        known_places: Vec<PathBuf>,
        shell: PathBuf,
        environment: Vec<(OsString, OsString)>,
    ) -> Self {
        Programs {
            known_places,
            shell,
            login_shell_timeout: LOGIN_SHELL_TIMEOUT,
            environment,
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
        Programs::new(known_places, shell, clean_environment(std::env::vars_os()))
    }

    fn remembered(&self) -> MutexGuard<'_, Remembered> {
        self.remembered
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// The program for an agent's name, if this machine has it. Only an agent's name is answered.
    pub fn which(&self, name: &str) -> Option<String> {
        if !AGENTS.contains(&name) {
            return None;
        }
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
        remembered.returned.insert(found);
        Some(returned)
    }

    /// Asks a login shell for its `PATH` and for where it finds a program. The name can go in the
    /// script because `which` only ever asks about the names in `AGENTS`.
    fn ask_login_shell(&self, name: &str) -> LoginAnswer {
        let args = [
            "-lc".to_owned(),
            format!("echo {PATH_MARK}; printenv PATH; echo {FOUND_MARK}; command -v {name}"),
        ];
        let Some(shell) = self.shell.to_str() else {
            return LoginAnswer::default();
        };
        exec(shell, &args, &self.environment, self.login_shell_timeout)
            .map(|output| LoginAnswer::from_output(&output.stdout, name))
            .unwrap_or_default()
    }

    /// Whether `start` may start `program`: only what `which` returned this session.
    pub fn may_start(&self, program: &str) -> Result<(), String> {
        if self.remembered().returned.contains(Path::new(program)) {
            Ok(())
        } else {
            Err(format!(
                "Redlines didn't find {program}, so it won't run it."
            ))
        }
    }

    /// Whether `exec` may run `program`: what may be started, and the system's small tools.
    pub fn may_exec(&self, program: &str) -> Result<(), String> {
        if SYSTEM_TOOLS.contains(&program) {
            Ok(())
        } else {
            self.may_start(program)
        }
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
    use crate::agents::test_support::TempFolder;

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
        let programs = Programs::new(vec![temp.path().join("none"), known], shell, environment);
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
        let programs = Programs::new(vec![], shell, environment);
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
        let programs = Programs::new(vec![known], shell, environment);
        assert_eq!(programs.which("claude"), None);
        assert_eq!(programs.which("codex"), None);
    }

    #[test]
    fn it_answers_only_for_agents() {
        let temp = TempFolder::new("which-agents");
        let known = temp.path().join("known");
        let sh = with_program(&known, "sh");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = Programs::new(vec![known], shell, environment);
        for name in ["sh", "git", "../claude", "/bin/sh", "claude;touch x", ""] {
            assert_eq!(programs.which(name), None, "{name}");
        }
        assert!(
            programs.may_start(sh.to_str().unwrap()).is_err(),
            "nor is what it wouldn't answer for remembered"
        );
    }

    #[test]
    fn a_login_shell_that_hangs_doesnt_hang_the_app() {
        let temp = TempFolder::new("which-hang");
        fs::write(temp.path().join(".profile"), "sleep 60\n").unwrap();
        let environment = vec![(OsString::from("HOME"), temp.path().as_os_str().to_owned())];
        let programs = Programs {
            login_shell_timeout: Duration::from_millis(200),
            ..Programs::new(vec![], PathBuf::from("/bin/sh"), environment)
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
            ..Programs::new(vec![known], PathBuf::from("/bin/sh"), environment)
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
        let programs = Programs::new(vec![known.clone()], shell, environment);
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
        let programs = Programs::new(
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

    #[test]
    fn refuses_a_program_which_never_returned() {
        let temp = TempFolder::new("which-refuse");
        let known = temp.path().join("known");
        let program = with_program(&known, "claude");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = Programs::new(vec![known.clone()], shell, environment);
        let path = program.to_str().unwrap();

        // Not yet: `which` hasn't returned it.
        assert!(programs.may_start(path).is_err());
        assert!(programs.may_exec(path).is_err());
        programs.which("claude").unwrap();
        assert!(programs.may_start(path).is_ok());
        assert!(programs.may_exec(path).is_ok());

        for other in ["/bin/sh", "/bin/echo", "claude", "", "/usr/bin/env"] {
            assert!(programs.may_start(other).is_err(), "{other}");
            assert!(programs.may_exec(other).is_err(), "{other}");
        }
        // The same file by another name isn't what was returned.
        let aside = known.join("..").join("known").join("claude");
        assert!(programs.may_start(aside.to_str().unwrap()).is_err());
    }

    #[test]
    fn exec_also_runs_the_two_system_tools_a_provider_needs_but_start_doesnt() {
        let temp = TempFolder::new("which-tools");
        let (shell, environment) = login_shell(temp.path(), "/usr/bin:/bin");
        let programs = Programs::new(vec![], shell, environment);
        for tool in ["/usr/bin/mktemp", "/bin/realpath"] {
            assert!(programs.may_exec(tool).is_ok(), "{tool}");
            assert!(programs.may_start(tool).is_err(), "{tool}");
        }
    }
}
