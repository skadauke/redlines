//! Opening a link in the browser, for a ⌘-click on a link in a document (design §5.2). The page asks
//! for an address, which the editor has limited to `http`, `https` and `mailto` already; the app
//! checks it again, because it is the app that runs a program on it. Whatever a page, or the
//! document it shows, says, nothing else is opened.

use std::process::Command;

/// The address a link may open: as it was given, when it is a web or mail address with something
/// after its scheme and no white space or control character in it. Anything else is None: another
/// scheme (`javascript:`, `file:`, `data:`), no scheme, a link to another document.
fn address(url: &str) -> Option<&str> {
    let url = url.trim();
    let rest = ["https://", "http://", "mailto:"].into_iter().find_map(|scheme| {
        url.get(..scheme.len())
            .filter(|head| head.eq_ignore_ascii_case(scheme))
            .map(|_| &url[scheme.len()..])
    })?;
    let plain = |c: char| !c.is_whitespace() && !c.is_control();
    (!rest.is_empty() && rest.chars().all(plain)).then_some(url)
}

/// The command that opens `address` in the default app for its kind: the browser, or the mail app.
fn opener(address: &str) -> Command {
    // The address is an argument and never part of a shell's text, and starts with its scheme, which
    // no program takes for an option.
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.arg(address);
        command
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", address]);
        command
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let mut command = Command::new("xdg-open");
        command.arg(address);
        command
    }
}

/// The command that opens what the page asked to open, or why nothing does: the page's text only
/// ever reaches a program through `address`.
fn command_for(url: &str) -> Result<Command, String> {
    let address = address(url).ok_or_else(|| "Only web and mail addresses open.".to_string())?;
    Ok(opener(address))
}

/// Opens a web or mail address in the default app for it.
#[tauri::command(async)]
pub fn open_link(url: String) -> Result<(), String> {
    let status = command_for(&url)?
        .status()
        .map_err(|error| format!("Couldn’t open the link: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Couldn’t open the link: {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{address, command_for, opener};

    #[test]
    fn opens_web_and_mail_addresses_whatever_the_case_of_the_scheme() {
        for url in [
            "https://example.org/a?b=1&c=2",
            "http://example.org",
            "HTTPS://Example.org",
            "Http://example.org/x#y",
            "mailto:ada@example.org",
            "MAILTO:ada@example.org?subject=Hi%20there",
        ] {
            assert_eq!(address(url), Some(url), "{url}");
        }
    }

    #[test]
    fn leaves_out_the_white_space_around_an_address_it_opens() {
        assert_eq!(address("  https://example.org \n"), Some("https://example.org"));
    }

    #[test]
    fn opens_nothing_else() {
        for url in [
            "",
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            " javascript:alert(1)",
            "java\tscript:alert(1)",
            "vbscript:x",
            "data:text/html,<b>x</b>",
            "file:///etc/passwd",
            "tel:+15551234",
            "ftp://example.org",
            "x-apple.systempreferences:",
            "//example.org/x",
            "plan.md#intro",
            "../plan.md",
            "#intro",
            "/etc/passwd",
            "example.org",
            "www.example.org",
            "-a Calculator",
            "https://",
            "https:",
            "mailto:",
            "https://exa mple.org",
            "https://example.org/\nopen",
            "https://example.org/\u{0}",
            "https://example.org/\u{7}",
            "https://example.org/\u{85}x",
            "https://example.org/\u{a0}x",
            "https:/example.org",
        ] {
            assert_eq!(address(url), None, "{url:?}");
        }
    }

    /// What the page asks for is what the program is built from, and nothing it may not open
    /// builds one: the check is part of the command, not a courtesy before it.
    #[test]
    fn builds_no_command_for_what_it_does_not_open() {
        for url in [
            "",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "-a Calculator",
            "--help",
            "https://example.org/ x",
            "https://example.org/\nopen",
            "www.example.org",
            "plan.md#intro",
        ] {
            let built = command_for(url);
            assert!(built.is_err(), "{url:?} built a command");
            assert_eq!(built.err().as_deref(), Some("Only web and mail addresses open."));
        }
    }

    #[test]
    fn builds_the_command_from_the_address_it_checked() {
        let command = command_for("  HTTPS://Example.org/?a=1&b=2\n").expect("a web address");
        let args: Vec<_> = command.get_args().collect();
        // The address as it was given, without the white space around it, and nothing else.
        assert_eq!(args.last().and_then(|arg| arg.to_str()), Some("HTTPS://Example.org/?a=1&b=2"));
        assert!(args.iter().all(|arg| !arg.to_string_lossy().starts_with('-')));
    }

    #[test]
    fn hands_the_default_app_the_address_alone() {
        let command = opener("https://example.org/?a=1&b=2");
        let args: Vec<_> = command.get_args().collect();
        // One argument, which a program can't take for an option: it starts with its scheme.
        assert_eq!(args.last().and_then(|arg| arg.to_str()), Some("https://example.org/?a=1&b=2"));
        assert!(args.iter().all(|arg| !arg.to_string_lossy().starts_with('-')));
        #[cfg(target_os = "macos")]
        {
            assert_eq!(command.get_program(), "open");
            assert_eq!(args.len(), 1);
        }
    }
}
