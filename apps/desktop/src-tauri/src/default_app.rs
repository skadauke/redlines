//! The default app for Markdown files: which app opens them, and making Redlines that app, from
//! Preferences › General › Make Redlines the Default. macOS keeps the choice by the app's
//! identifier, so it holds for every copy of Redlines, and Finder's Get Info changes it too.
//!
//! This module decides from facts that the caller gathers, so that the decisions can be tested on
//! any system; `macos` gathers them from LaunchServices (`NSWorkspace`, macOS 12 and later) and
//! asks it to make the change. Nothing changes the default but the button.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

/// The type macOS gives Markdown files, which the bundle declares that Redlines opens
/// (`document-types.plist`).
pub const MARKDOWN: &str = "net.daringfireball.markdown";

/// What the system does about the default app.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum System {
    /// macOS 12 or later, which says which app opens a type and changes it when asked.
    Mac,
    /// An older macOS, where the person changes it in Finder.
    OlderMac,
    /// Windows or Linux, where Redlines doesn't change it.
    #[default]
    Other,
}

/// An app that opens Markdown files: its name, as Finder shows it, and the identifier it says it
/// has, if it says.
#[derive(Clone, Debug, PartialEq)]
pub struct Handler {
    pub name: String,
    pub identifier: Option<String>,
}

/// What the decisions go by.
#[derive(Debug, Default)]
pub struct Facts {
    pub system: System,
    /// The app bundle this copy of Redlines runs from, if it runs from one (`tauri dev` doesn't).
    pub bundle: Option<PathBuf>,
    /// Where the app really is, when macOS runs a translocated copy of it.
    pub original: Option<PathBuf>,
    /// The app that opens Markdown files now, if macOS says.
    pub handler: Option<Handler>,
}

/// Which app opens Markdown files, as Preferences says. The window tells them by `status`.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DefaultApp {
    /// Redlines does: whichever copy macOS opens.
    Redlines,
    /// Another app does, by its name, or none does.
    Other { app: Option<String> },
    /// Nobody can say here: an older macOS, Windows or Linux.
    Unknown,
}

/// What making Redlines the default app did. The window tells them by `outcome`.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum Changed {
    /// Markdown files open in Redlines now, or did already.
    Made,
    /// macOS kept the app that opens them, by its name, if any: the person said no, where macOS
    /// asked them.
    Kept { app: Option<String> },
}

/// What pressing the button does, when it doesn't refuse.
#[derive(Debug, PartialEq)]
pub enum Plan {
    /// Nothing: Redlines opens Markdown files already.
    Already,
    /// Asks macOS to open them in the app at this path, the one that runs.
    Ask(PathBuf),
}

/// What macOS answered when it was asked.
#[derive(Debug, PartialEq)]
pub enum Answer {
    /// It made the change.
    Done,
    /// The person cancelled, where macOS asked them.
    Cancelled,
    /// It couldn't, as it says.
    Failed(String),
}

/// What the button says off the Mac.
const MAC_ONLY: &str = "Redlines can be made the default app for Markdown only on the Mac.";

/// What it says on a macOS that can't be asked: the way to do it in Finder.
const IN_FINDER: &str = "On this version of macOS, choose Redlines in a Markdown file’s Get Info \
                         window, under Open With, then click Change All.";

/// What it says to a program that runs outside an app bundle, as `tauri dev` runs it.
const OUTSIDE_A_BUNDLE: &str =
    "Redlines wasn’t made the default app: this copy of Redlines runs outside an app bundle.";

/// What it says to a copy of the app that won't stay where it runs.
const MOVE_FIRST: &str = "Redlines wasn’t made the default app: this copy of Redlines won’t stay \
                          where it is. Move Redlines to your Applications folder, and open it \
                          from there.";

/// Whether `handler` is a copy of the app whose identifier is `identifier`: macOS keeps the default
/// by identifier, whatever the copy is called or wherever it is.
fn is_this_app(handler: Option<&Handler>, identifier: &str) -> bool {
    handler.and_then(|handler| handler.identifier.as_deref()) == Some(identifier)
}

/// Which app opens Markdown files, as the app whose identifier is `identifier` says.
pub fn state(facts: &Facts, identifier: &str) -> DefaultApp {
    if facts.system != System::Mac {
        return DefaultApp::Unknown;
    }
    if is_this_app(facts.handler.as_ref(), identifier) {
        return DefaultApp::Redlines;
    }
    DefaultApp::Other {
        app: facts.handler.as_ref().map(|handler| handler.name.clone()),
    }
}

/// What pressing the button does, or the sentence it refuses with. Nothing is asked when Redlines
/// opens Markdown files already, whichever copy runs. A copy that won't stay where it runs is
/// refused before anything is asked, as the command line refuses it (`command_line.rs`): one on its
/// disk image or another disk in /Volumes, or one that macOS runs translocated, which would leave
/// macOS no copy to open the files in once it is gone.
pub fn plan(facts: &Facts, identifier: &str) -> Result<Plan, String> {
    match facts.system {
        System::Mac => {}
        System::OlderMac => return Err(IN_FINDER.to_owned()),
        System::Other => return Err(MAC_ONLY.to_owned()),
    }
    if is_this_app(facts.handler.as_ref(), identifier) {
        return Ok(Plan::Already);
    }
    let Some(bundle) = &facts.bundle else {
        return Err(OUTSIDE_A_BUNDLE.to_owned());
    };
    if crate::install::may_be_on_image(bundle, facts.original.as_deref()) {
        return Err(MOVE_FIRST.to_owned());
    }
    Ok(Plan::Ask(bundle.clone()))
}

/// What the pane is told once macOS has answered: `after`, the app that opens Markdown files then,
/// decides, and a failure is said only when Redlines doesn't open them.
pub fn outcome(
    answer: Answer,
    after: Option<&Handler>,
    identifier: &str,
) -> Result<Changed, String> {
    if is_this_app(after, identifier) {
        return Ok(Changed::Made);
    }
    match answer {
        Answer::Failed(why) => Err(format!("Redlines wasn’t made the default app: {why}")),
        Answer::Done | Answer::Cancelled => Ok(Changed::Kept {
            app: after.map(|handler| handler.name.clone()),
        }),
    }
}

/// The app at `bundle`, as Preferences names it: as Finder does, without `.app`, and by the
/// identifier in its `Info.plist`.
pub fn handler_at(bundle: &Path) -> Handler {
    let name = bundle.file_stem().unwrap_or(bundle.as_os_str());
    Handler {
        name: name.to_string_lossy().into_owned(),
        identifier: crate::install::bundle_identifier(bundle),
    }
}

/// Which app opens Markdown files now, for Preferences › General, which asks when it opens.
#[tauri::command(async)]
pub fn default_app(app: AppHandle) -> DefaultApp {
    state(&facts(), &app.config().identifier)
}

/// Makes Redlines the default app for Markdown files, when the person presses Make Redlines the
/// Default: says what macOS did, or refuses with the sentence that says why it wasn't asked or
/// couldn't. macOS may ask the person first, so the wait is on a thread of its own.
#[tauri::command]
pub async fn make_default_app(app: AppHandle) -> Result<Changed, String> {
    let identifier = app.config().identifier.clone();
    tauri::async_runtime::spawn_blocking(move || match plan(&facts(), &identifier)? {
        Plan::Already => Ok(Changed::Made),
        Plan::Ask(bundle) => {
            let answer = ask(&bundle);
            outcome(answer, handler().as_ref(), &identifier)
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The facts on this Mac: what it can be asked, the copy that runs, and the app that opens Markdown
/// files now.
#[cfg(target_os = "macos")]
fn facts() -> Facts {
    use crate::install::macos::{running_bundle, translocated_original};

    let bundle = running_bundle();
    let original = bundle.as_deref().and_then(translocated_original);
    Facts {
        system: macos::system(),
        bundle,
        original,
        handler: macos::handler(),
    }
}

#[cfg(target_os = "macos")]
use macos::{ask, handler};

/// Off the Mac, nothing can be told or asked.
#[cfg(not(target_os = "macos"))]
fn facts() -> Facts {
    Facts::default()
}

#[cfg(not(target_os = "macos"))]
fn handler() -> Option<Handler> {
    None
}

#[cfg(not(target_os = "macos"))]
fn ask(_bundle: &Path) -> Answer {
    Answer::Failed(MAC_ONLY.to_owned())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::Path;
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, NSObjectProtocol};
    use objc2::{msg_send, sel};
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSCocoaErrorDomain, NSError, NSString, NSURL, NSUserCancelledError};

    use super::{Answer, Handler, MARKDOWN, System, handler_at};

    /// Markdown's type, a `UTType`. The class is looked up when the app runs rather than linked:
    /// macOS 11 brought it, and an older macOS must still start the app.
    fn markdown() -> Option<Retained<AnyObject>> {
        let class = AnyClass::get(c"UTType")?;
        let identifier = NSString::from_str(MARKDOWN);
        // SAFETY: `+[UTType typeWithIdentifier:]` takes a string, and gives a type or nil.
        unsafe { msg_send![class, typeWithIdentifier: &*identifier] }
    }

    /// Whether macOS says which app opens a type, and changes it when asked: macOS 12 and later.
    pub fn system() -> System {
        let workspace = NSWorkspace::sharedWorkspace();
        let answers = workspace.respondsToSelector(sel!(URLForApplicationToOpenContentType:))
            && workspace.respondsToSelector(sel!(
                setDefaultApplicationAtURL:toOpenContentType:completionHandler:
            ));
        if answers && markdown().is_some() {
            System::Mac
        } else {
            System::OlderMac
        }
    }

    /// The app that opens Markdown files now, if macOS says.
    pub fn handler() -> Option<Handler> {
        let workspace = NSWorkspace::sharedWorkspace();
        if !workspace.respondsToSelector(sel!(URLForApplicationToOpenContentType:)) {
            return None;
        }
        let markdown = markdown()?;
        // SAFETY: the method is there (above); it takes a type, and gives an app's URL or nil.
        let url: Option<Retained<NSURL>> =
            unsafe { msg_send![&*workspace, URLForApplicationToOpenContentType: &*markdown] };
        Some(handler_at(&url?.to_file_path()?))
    }

    /// Asks macOS to open Markdown files in the app at `bundle`, and waits for its answer, which
    /// may wait for the person: never on the main thread. Only `system` says it can be asked.
    pub fn ask(bundle: &Path) -> Answer {
        let Some(markdown) = markdown() else {
            return Answer::Failed("macOS doesn’t know what Markdown is".to_owned());
        };
        let Some(url) = NSURL::from_directory_path(bundle) else {
            return Answer::Failed(format!("macOS can’t find {}", bundle.display()));
        };
        let (sender, answer) = mpsc::channel();
        let answered = RcBlock::new(move |error: *mut NSError| {
            // SAFETY: macOS gives nil or an error that lives through the call.
            let error = unsafe { error.as_ref() };
            let _ = sender.send(error.map_or(Answer::Done, answer_to));
        });
        let workspace = NSWorkspace::sharedWorkspace();
        // SAFETY: macOS 12 and later have the method (`system`). It takes the app's URL, a type and
        // a block, which it keeps until it calls it, once, with nil or an error.
        let _: () = unsafe {
            msg_send![
                &*workspace,
                setDefaultApplicationAtURL: &*url,
                toOpenContentType: &*markdown,
                completionHandler: &*answered
            ]
        };
        // macOS has its own copy of the block. One it lets go of without calling drops the sender.
        drop(answered);
        answer
            .recv()
            .unwrap_or_else(|_| Answer::Failed("macOS didn’t answer".to_owned()))
    }

    /// The person cancelled, where macOS asked them, or what macOS said went wrong.
    fn answer_to(error: &NSError) -> Answer {
        // SAFETY: a constant string of Foundation's.
        let cocoa = unsafe { NSCocoaErrorDomain };
        if error.code() == NSUserCancelledError && error.domain().isEqualToString(cocoa) {
            Answer::Cancelled
        } else {
            Answer::Failed(error.localizedDescription().to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REDLINES: &str = "md.redlines.editor";
    const INSTALLED: &str = "/Applications/Redlines.app";

    fn app(name: &str, identifier: &str) -> Handler {
        Handler {
            name: name.to_owned(),
            identifier: Some(identifier.to_owned()),
        }
    }

    fn text_edit() -> Handler {
        app("TextEdit", "com.apple.TextEdit")
    }

    /// A Mac that can be asked, with this copy of the app at `bundle`, and `handler` opening
    /// Markdown files.
    fn mac(bundle: Option<&str>, handler: Option<Handler>) -> Facts {
        Facts {
            system: System::Mac,
            bundle: bundle.map(PathBuf::from),
            original: None,
            handler,
        }
    }

    #[test]
    fn preferences_says_which_app_opens_markdown_files() {
        assert_eq!(
            state(&mac(Some(INSTALLED), Some(text_edit())), REDLINES),
            DefaultApp::Other {
                app: Some("TextEdit".to_owned())
            }
        );
        assert_eq!(
            state(&mac(Some(INSTALLED), None), REDLINES),
            DefaultApp::Other { app: None }
        );
        // Redlines by its identifier, whichever copy macOS opens, and whatever it is called.
        for copy in [app("Redlines", REDLINES), app("Redlines 0.1", REDLINES)] {
            assert_eq!(
                state(&mac(Some(INSTALLED), Some(copy)), REDLINES),
                DefaultApp::Redlines
            );
        }
        // An app called Redlines with another identifier, or none, is another app.
        let named = Handler {
            name: "Redlines".to_owned(),
            identifier: None,
        };
        for other in [named, app("Redlines", "com.example.redlines")] {
            assert_eq!(
                state(&mac(Some(INSTALLED), Some(other)), REDLINES),
                DefaultApp::Other {
                    app: Some("Redlines".to_owned())
                }
            );
        }
    }

    #[test]
    fn nobody_can_say_on_an_older_macos_or_off_the_mac() {
        for system in [System::OlderMac, System::Other] {
            let facts = Facts {
                system,
                ..mac(Some(INSTALLED), Some(text_edit()))
            };
            assert_eq!(state(&facts, REDLINES), DefaultApp::Unknown, "{system:?}");
        }
    }

    #[test]
    fn the_button_asks_macos_to_open_markdown_files_in_the_copy_that_runs() {
        for bundle in [INSTALLED, "/Users/ada/Applications/Redlines.app"] {
            assert_eq!(
                plan(&mac(Some(bundle), Some(text_edit())), REDLINES),
                Ok(Plan::Ask(PathBuf::from(bundle)))
            );
            assert_eq!(
                plan(&mac(Some(bundle), None), REDLINES),
                Ok(Plan::Ask(PathBuf::from(bundle)))
            );
        }
    }

    #[test]
    fn nothing_is_asked_when_redlines_opens_markdown_files_already() {
        // Whichever copy runs, and wherever: there is nothing to change.
        for bundle in [
            Some(INSTALLED),
            Some("/Volumes/Redlines/Redlines.app"),
            None,
        ] {
            assert_eq!(
                plan(&mac(bundle, Some(app("Redlines", REDLINES))), REDLINES),
                Ok(Plan::Already),
                "{bundle:?}"
            );
        }
    }

    #[test]
    fn a_copy_that_wont_stay_where_it_runs_is_refused_before_anything_is_asked() {
        // On its disk image, or another disk in /Volumes: the copy goes when the disk does.
        for bundle in [
            "/Volumes/Redlines/Redlines.app",
            "/Volumes/Backup/Applications/Redlines.app",
        ] {
            assert_eq!(
                plan(&mac(Some(bundle), Some(text_edit())), REDLINES),
                Err(MOVE_FIRST.to_owned()),
                "{bundle}"
            );
        }
        // Translocated by macOS, from wherever it really is.
        let translocated = Facts {
            original: Some(PathBuf::from("/Users/ada/Downloads/Redlines.app")),
            ..mac(
                Some("/private/var/folders/x/T/AppTranslocation/1/d/Redlines.app"),
                Some(text_edit()),
            )
        };
        assert_eq!(plan(&translocated, REDLINES), Err(MOVE_FIRST.to_owned()));
    }

    #[test]
    fn a_program_outside_an_app_bundle_is_refused() {
        assert_eq!(
            plan(&mac(None, Some(text_edit())), REDLINES),
            Err(OUTSIDE_A_BUNDLE.to_owned())
        );
    }

    #[test]
    fn an_older_macos_is_shown_the_way_in_finder_and_elsewhere_the_mac_is_named() {
        let older = Facts {
            system: System::OlderMac,
            ..mac(Some(INSTALLED), None)
        };
        assert_eq!(plan(&older, REDLINES), Err(IN_FINDER.to_owned()));
        let elsewhere = Facts {
            system: System::Other,
            ..mac(Some(INSTALLED), None)
        };
        assert_eq!(plan(&elsewhere, REDLINES), Err(MAC_ONLY.to_owned()));
    }

    #[test]
    fn what_macos_says_afterwards_decides_what_the_pane_is_told() {
        let redlines = app("Redlines", REDLINES);
        assert_eq!(
            outcome(Answer::Done, Some(&redlines), REDLINES),
            Ok(Changed::Made)
        );
        // Done, but another app opens them still, or the person kept it where macOS asked.
        for answer in [Answer::Done, Answer::Cancelled] {
            assert_eq!(
                outcome(answer, Some(&text_edit()), REDLINES),
                Ok(Changed::Kept {
                    app: Some("TextEdit".to_owned())
                })
            );
        }
        assert_eq!(
            outcome(Answer::Cancelled, None, REDLINES),
            Ok(Changed::Kept { app: None })
        );
        // A failure says what macOS said, unless Redlines opens them all the same.
        assert_eq!(
            outcome(
                Answer::Failed("The operation couldn’t be completed. (OSStatus error -54.)".into()),
                Some(&text_edit()),
                REDLINES
            ),
            Err(
                "Redlines wasn’t made the default app: The operation couldn’t be completed. \
                 (OSStatus error -54.)"
                    .to_owned()
            )
        );
        assert_eq!(
            outcome(Answer::Failed("no".into()), Some(&redlines), REDLINES),
            Ok(Changed::Made)
        );
    }

    fn json(value: impl Serialize) -> serde_json::Value {
        serde_json::to_value(value).unwrap()
    }

    #[test]
    fn the_window_reads_the_state_and_the_outcome_by_name() {
        // src/preferences/panes.ts reads these fields.
        assert_eq!(
            json(&DefaultApp::Redlines),
            serde_json::json!({ "status": "redlines" })
        );
        assert_eq!(
            json(&DefaultApp::Other {
                app: Some("TextEdit".to_owned())
            }),
            serde_json::json!({ "status": "other", "app": "TextEdit" })
        );
        assert_eq!(
            json(&DefaultApp::Other { app: None }),
            serde_json::json!({ "status": "other", "app": null })
        );
        assert_eq!(
            json(&DefaultApp::Unknown),
            serde_json::json!({ "status": "unknown" })
        );
        assert_eq!(
            json(&Changed::Made),
            serde_json::json!({ "outcome": "made" })
        );
        assert_eq!(
            json(&Changed::Kept {
                app: Some("TextEdit".to_owned())
            }),
            serde_json::json!({ "outcome": "kept", "app": "TextEdit" })
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn this_mac_says_which_app_opens_markdown_files() {
        // It only reads, as Preferences does when it opens: no test asks macOS for a change.
        assert_eq!(macos::system(), System::Mac);
        // Every Mac has one: TextEdit opens plain text, and Markdown is plain text.
        let handler = macos::handler().expect("macOS names an app that opens Markdown files");
        assert!(!handler.name.is_empty(), "{handler:?}");
        assert!(handler.identifier.is_some(), "{handler:?}");
    }

    #[test]
    fn an_app_is_named_as_finder_names_it_and_by_the_identifier_it_says_it_has() {
        let folder = std::env::temp_dir().join(format!("redlines-default-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        let contents = folder.join("TextEdit.app/Contents");
        std::fs::create_dir_all(&contents).unwrap();
        std::fs::write(
            contents.join("Info.plist"),
            r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.apple.TextEdit</string></dict></plist>"#,
        )
        .unwrap();
        assert_eq!(handler_at(&folder.join("TextEdit.app")), text_edit());
        // One that doesn't say who it is is named all the same.
        std::fs::create_dir_all(folder.join("Text Editor.app")).unwrap();
        assert_eq!(
            handler_at(&folder.join("Text Editor.app")),
            Handler {
                name: "Text Editor".to_owned(),
                identifier: None
            }
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
