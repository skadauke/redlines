//! One window checks for updates for the whole app (#62). Each window has a page of its own, and
//! the update logic runs in a page (`src/updates.ts`), so without this every window would check,
//! download and tell of the same update. The first window to join is the owner: it checks,
//! downloads and installs for all of them. The others show what it says, and ask it to check or
//! install when the person does so from their window (`src/update-owner.ts`). When the owner closes,
//! the window that joined next takes over, and starts afresh: what the owner had downloaded was held
//! by its page, and went with it.
//!
//! The app keeps who the owner is, what its updates are doing, the version whose card was dismissed,
//! and the asks the owner has yet to answer. It hands every message on in the `updates` event,
//! to one window at a time.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/// The event every message to a window comes in.
const EVENT: &str = "updates";

/// What an ask that the owner can no longer answer is told.
const OWNER_CLOSED: &str = "The window that checks for updates has closed.";

/// What the owner's updates are doing (`UpdatePhase` in `src/updates.ts`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    #[default]
    Idle,
    Checking,
    Downloading,
    Ready,
}

/// The owner's update state (`UpdateState` in `src/updates.ts`). The windows read it by name.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct UpdateState {
    phase: Phase,
    /// The version being downloaded or ready.
    version: Option<String>,
}

/// What a window asks the owner to do for it.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum What {
    /// Check for Updates….
    Check,
    /// Install the update that is ready, for Restart to update.
    Install,
}

/// How the owner answered an ask: what a check found, or why it failed. The app hands it on as it
/// is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "lowercase")]
pub enum Answer {
    Done { value: serde_json::Value },
    Failed { error: String },
}

/// A message to one window. The windows read these by name.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Message {
    /// This window is the owner now: it checks for updates for all.
    Own,
    /// What the owner's updates are doing now.
    State { state: UpdateState },
    /// The card of the update `version` was dismissed in another window.
    Dismissed { version: String },
    /// To the owner: a window asks it to check or install. `id` is for the answer.
    Ask { id: u64, what: What },
    /// To the window that asked: the owner's answer, under the window's own `id`.
    Answer { id: u64, answer: Answer },
}

/// What a window learns as it joins. The window reads the fields by name.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Joined {
    /// Whether this window is the owner.
    owner: bool,
    state: UpdateState,
    /// The version whose card was dismissed, if one was.
    dismissed: Option<String>,
}

/// Messages to hand on, each to the window it names.
pub type Deliveries = Vec<(String, Message)>;

/// The windows that take part in the updates, and what they share.
#[derive(Debug, Default)]
pub struct Registry {
    /// The windows that have joined, the oldest first. The first is the owner.
    members: Vec<String>,
    /// What the owner's updates are doing, as it last said.
    state: UpdateState,
    /// The version whose card was dismissed. A later download of the same version, by an owner
    /// that took over, isn't told again.
    dismissed: Option<String>,
    /// The number of the last ask handed to an owner.
    last_ask: u64,
    /// The asks the owner has yet to answer: each window that asked, and its own number for it.
    asks: HashMap<u64, (String, u64)>,
}

impl Registry {
    fn owner(&self) -> Option<&str> {
        self.members.first().map(String::as_str)
    }

    fn is_owner(&self, label: &str) -> bool {
        self.owner() == Some(label)
    }

    /// The message to every window but `label`.
    fn to_others(&self, label: &str, message: &Message) -> Deliveries {
        self.members
            .iter()
            .filter(|member| *member != label)
            .map(|member| (member.clone(), message.clone()))
            .collect()
    }

    /// The owner's page is gone, closed or loaded again: the asks it had fail, and what it was
    /// doing is undone, for every window but `except` to hear.
    fn owner_gone(&mut self, except: &str) -> Deliveries {
        let mut asks: Vec<_> = self.asks.drain().collect();
        asks.sort_unstable_by_key(|(number, _)| *number);
        let mut told: Deliveries = asks
            .into_iter()
            .filter(|(_, (asker, _))| asker != except)
            .map(|(_, (asker, id))| {
                let answer = Answer::Failed {
                    error: OWNER_CLOSED.to_owned(),
                };
                (asker, Message::Answer { id, answer })
            })
            .collect();
        if let Some(owner) = self.owner().filter(|owner| *owner != except) {
            told.push((owner.to_owned(), Message::Own));
        }
        if self.state != UpdateState::default() {
            self.state = UpdateState::default();
            let state = self.state.clone();
            told.extend(self.to_others(except, &Message::State { state }));
        }
        told
    }

    /// A window joins, as its page starts. The first is the owner. A page that loads again (the
    /// same window) keeps its place, and as the owner starts afresh.
    pub fn join(&mut self, label: &str) -> (Joined, Deliveries) {
        let mut told = Vec::new();
        if self.members.iter().any(|member| member == label) {
            // Answers to the asks of the page that was here would reach the new one.
            self.asks.retain(|_, (asker, _)| asker != label);
            if self.is_owner(label) {
                told = self.owner_gone(label);
            }
        } else {
            self.members.push(label.to_owned());
        }
        let joined = Joined {
            owner: self.is_owner(label),
            state: self.state.clone(),
            dismissed: self.dismissed.clone(),
        };
        (joined, told)
    }

    /// A window has closed. When it was the owner, the next window takes over.
    pub fn leave(&mut self, label: &str) -> Deliveries {
        let was_owner = self.is_owner(label);
        self.members.retain(|member| member != label);
        if was_owner {
            self.owner_gone(label)
        } else {
            self.asks.retain(|_, (asker, _)| asker != label);
            Vec::new()
        }
    }

    /// The owner says what its updates are doing, and every other window hears it.
    pub fn report(&mut self, label: &str, state: UpdateState) -> Result<Deliveries, String> {
        if !self.is_owner(label) {
            return Err("This window doesn't check for updates.".to_owned());
        }
        self.state = state.clone();
        Ok(self.to_others(label, &Message::State { state }))
    }

    /// The card of the update `version` was dismissed in this window: it goes in every other.
    pub fn dismiss(&mut self, label: &str, version: String) -> Deliveries {
        self.dismissed = Some(version.clone());
        self.to_others(label, &Message::Dismissed { version })
    }

    /// A window asks the owner to check or install. `id` is the window's own number for it.
    pub fn ask(&mut self, label: &str, id: u64, what: What) -> Result<Deliveries, String> {
        if !self.members.iter().any(|member| member == label) {
            return Err("This window doesn't take part in the updates.".to_owned());
        }
        let owner = self.owner().map(str::to_owned);
        let Some(owner) = owner else {
            return Err("No window checks for updates.".to_owned());
        };
        self.last_ask += 1;
        self.asks.insert(self.last_ask, (label.to_owned(), id));
        Ok(vec![(
            owner,
            Message::Ask {
                id: self.last_ask,
                what,
            },
        )])
    }

    /// The owner answers the ask `id`, and the window that asked hears it.
    pub fn answer(&mut self, label: &str, id: u64, answer: Answer) -> Deliveries {
        if !self.is_owner(label) {
            return Vec::new();
        }
        self.asks
            .remove(&id)
            .map(|(asker, id)| (asker, Message::Answer { id, answer }))
            .into_iter()
            .collect()
    }
}

/// The app's `Registry`.
#[derive(Default)]
pub struct UpdateOwner(Mutex<Registry>);

impl UpdateOwner {
    /// Never held while a window is told something.
    fn lock(&self) -> MutexGuard<'_, Registry> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Hands each message to its window. A window that has just closed hears nothing.
fn deliver(app: &AppHandle, deliveries: Deliveries) {
    for (label, message) in deliveries {
        let _ = app.emit_to(label.as_str(), EVENT, message);
    }
}

/// This window takes part in the updates, and learns whether it is the owner.
#[tauri::command]
pub fn update_join(window: WebviewWindow, owner: tauri::State<'_, UpdateOwner>) -> Joined {
    let (joined, deliveries) = owner.lock().join(window.label());
    deliver(window.app_handle(), deliveries);
    joined
}

/// The owner says what its updates are doing.
#[tauri::command]
pub fn update_report(
    window: WebviewWindow,
    owner: tauri::State<'_, UpdateOwner>,
    state: UpdateState,
) -> Result<(), String> {
    let deliveries = owner.lock().report(window.label(), state)?;
    deliver(window.app_handle(), deliveries);
    Ok(())
}

/// The update's card was dismissed in this window (Later).
#[tauri::command]
pub fn update_dismiss(
    window: WebviewWindow,
    owner: tauri::State<'_, UpdateOwner>,
    version: String,
) {
    let deliveries = owner.lock().dismiss(window.label(), version);
    deliver(window.app_handle(), deliveries);
}

/// This window asks the owner to check or install; the answer comes as a message.
#[tauri::command]
pub fn update_ask(
    window: WebviewWindow,
    owner: tauri::State<'_, UpdateOwner>,
    id: u64,
    what: What,
) -> Result<(), String> {
    let deliveries = owner.lock().ask(window.label(), id, what)?;
    deliver(window.app_handle(), deliveries);
    Ok(())
}

/// The owner answers an ask.
#[tauri::command]
pub fn update_answer(
    window: WebviewWindow,
    owner: tauri::State<'_, UpdateOwner>,
    id: u64,
    answer: Answer,
) {
    let deliveries = owner.lock().answer(window.label(), id, answer);
    deliver(window.app_handle(), deliveries);
}

/// A window has closed: when it was the owner, the next takes over.
pub fn window_closed(app: &AppHandle, label: &str) {
    let deliveries = app.state::<UpdateOwner>().lock().leave(label);
    deliver(app, deliveries);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(phase: Phase, version: Option<&str>) -> UpdateState {
        UpdateState {
            phase,
            version: version.map(str::to_owned),
        }
    }

    fn idle() -> UpdateState {
        UpdateState::default()
    }

    fn ready(version: &str) -> UpdateState {
        state(Phase::Ready, Some(version))
    }

    fn to(label: &str, message: Message) -> (String, Message) {
        (label.to_owned(), message)
    }

    /// Three windows, `main` first.
    fn three() -> Registry {
        let mut registry = Registry::default();
        for label in ["main", "doc-1", "doc-2"] {
            registry.join(label);
        }
        registry
    }

    fn found(version: &str) -> Answer {
        Answer::Done {
            value: serde_json::json!({ "kind": "downloading", "version": version }),
        }
    }

    #[test]
    fn the_first_window_to_join_checks_for_all() {
        let mut registry = Registry::default();
        let (main, told) = registry.join("main");
        assert!(main.owner);
        assert_eq!(told, []);
        let (doc, told) = registry.join("doc-1");
        assert!(!doc.owner);
        assert_eq!(told, []);
        assert!(!registry.join("doc-2").0.owner);
        assert_eq!(registry.owner(), Some("main"));
    }

    #[test]
    fn only_the_owner_says_what_its_updates_are_doing_and_every_other_window_hears() {
        let mut registry = three();
        let told = registry.report("main", ready("0.3.0")).unwrap();
        assert_eq!(
            told,
            [
                to(
                    "doc-1",
                    Message::State {
                        state: ready("0.3.0")
                    }
                ),
                to(
                    "doc-2",
                    Message::State {
                        state: ready("0.3.0")
                    }
                ),
            ]
        );
        assert!(registry.report("doc-1", idle()).is_err());
        // A window that opens now shows the update that is ready.
        let (joined, _) = registry.join("doc-3");
        assert_eq!(joined.state, ready("0.3.0"));
        assert_eq!(joined.dismissed, None);
    }

    #[test]
    fn the_next_window_takes_over_when_the_owner_closes_and_starts_afresh() {
        let mut registry = three();
        registry.report("main", ready("0.3.0")).unwrap();
        // The download went with the owner's page: no update is ready any more.
        assert_eq!(
            registry.leave("main"),
            [
                to("doc-1", Message::Own),
                to("doc-1", Message::State { state: idle() }),
                to("doc-2", Message::State { state: idle() }),
            ]
        );
        assert_eq!(registry.owner(), Some("doc-1"));
        assert!(registry.report("doc-1", idle()).is_ok());
        assert!(registry.report("main", idle()).is_err());
    }

    #[test]
    fn a_window_that_is_not_the_owner_closing_changes_nothing() {
        let mut registry = three();
        assert_eq!(registry.leave("doc-1"), []);
        assert_eq!(registry.owner(), Some("main"));
        // Nor does a window that never joined, such as Preferences.
        assert_eq!(registry.leave("preferences"), []);
    }

    #[test]
    fn the_last_window_closing_leaves_no_owner_and_nothing_under_way() {
        let mut registry = Registry::default();
        registry.join("main");
        registry.report("main", ready("0.3.0")).unwrap();
        assert_eq!(registry.leave("main"), []);
        assert_eq!(registry.owner(), None);
        let (joined, _) = registry.join("doc-1");
        assert!(joined.owner);
        assert_eq!(joined.state, idle());
    }

    #[test]
    fn a_window_asks_the_owner_and_hears_its_answer_once() {
        let mut registry = three();
        let told = registry.ask("doc-2", 7, What::Check).unwrap();
        let [(owner, Message::Ask { id, what })] = told.as_slice() else {
            panic!("{told:?}");
        };
        assert_eq!((owner.as_str(), *what), ("main", What::Check));
        assert_eq!(
            registry.answer("main", *id, found("0.3.0")),
            [to(
                "doc-2",
                Message::Answer {
                    id: 7,
                    answer: found("0.3.0")
                }
            )]
        );
        // Answered once.
        assert_eq!(registry.answer("main", *id, found("0.3.0")), []);
    }

    #[test]
    fn asks_from_two_windows_are_told_apart() {
        let mut registry = three();
        // Each window numbers its own asks, so both may say 1.
        let first = registry.ask("doc-1", 1, What::Install).unwrap();
        let second = registry.ask("doc-2", 1, What::Install).unwrap();
        let id = |told: &Deliveries| match told.as_slice() {
            [(_, Message::Ask { id, .. })] => *id,
            _ => panic!("{told:?}"),
        };
        let (first, second) = (id(&first), id(&second));
        assert_ne!(first, second);
        let done = || Answer::Done {
            value: serde_json::Value::Null,
        };
        assert_eq!(
            registry.answer("main", second, done()),
            [to(
                "doc-2",
                Message::Answer {
                    id: 1,
                    answer: done()
                }
            )]
        );
        assert_eq!(
            registry.answer("main", first, done()),
            [to(
                "doc-1",
                Message::Answer {
                    id: 1,
                    answer: done()
                }
            )]
        );
    }

    #[test]
    fn the_owner_may_ask_itself() {
        // A window that became the owner while its ask was on the way gets the ask, and answers it.
        let mut registry = three();
        let told = registry.ask("main", 3, What::Check).unwrap();
        assert!(matches!(told.as_slice(), [(owner, Message::Ask { .. })] if owner == "main"));
    }

    #[test]
    fn only_the_owner_answers() {
        let mut registry = three();
        let told = registry.ask("doc-1", 1, What::Check).unwrap();
        let [(_, Message::Ask { id, .. })] = told.as_slice() else {
            panic!("{told:?}");
        };
        assert_eq!(registry.answer("doc-2", *id, found("0.3.0")), []);
        assert_eq!(registry.answer("main", *id, found("0.3.0")).len(), 1);
    }

    #[test]
    fn a_window_that_has_not_joined_cannot_ask() {
        let mut registry = three();
        assert!(registry.ask("preferences", 1, What::Check).is_err());
        assert!(Registry::default().ask("main", 1, What::Check).is_err());
    }

    #[test]
    fn an_ask_the_owner_can_no_longer_answer_fails_when_it_closes() {
        let mut registry = three();
        registry.ask("doc-2", 4, What::Install).unwrap();
        let told = registry.leave("main");
        assert_eq!(
            told,
            [
                to(
                    "doc-2",
                    Message::Answer {
                        id: 4,
                        answer: Answer::Failed {
                            error: OWNER_CLOSED.to_owned()
                        }
                    }
                ),
                to("doc-1", Message::Own),
            ]
        );
    }

    #[test]
    fn dismissing_the_card_in_one_window_dismisses_it_in_every_other() {
        let mut registry = three();
        registry.report("main", ready("0.3.0")).unwrap();
        assert_eq!(
            registry.dismiss("doc-1", "0.3.0".to_owned()),
            [
                to(
                    "main",
                    Message::Dismissed {
                        version: "0.3.0".to_owned()
                    }
                ),
                to(
                    "doc-2",
                    Message::Dismissed {
                        version: "0.3.0".to_owned()
                    }
                ),
            ]
        );
        // A window that opens now doesn't show it, nor does an owner that took over and downloaded
        // the same version again.
        assert_eq!(registry.join("doc-3").0.dismissed.as_deref(), Some("0.3.0"));
        registry.leave("main");
        assert_eq!(registry.join("doc-4").0.dismissed.as_deref(), Some("0.3.0"));
    }

    #[test]
    fn the_owners_page_loading_again_starts_afresh_as_the_owner() {
        let mut registry = three();
        registry.report("main", ready("0.3.0")).unwrap();
        registry.ask("doc-1", 2, What::Install).unwrap();
        let (joined, told) = registry.join("main");
        assert!(joined.owner);
        assert_eq!(joined.state, idle());
        assert_eq!(
            told,
            [
                to(
                    "doc-1",
                    Message::Answer {
                        id: 2,
                        answer: Answer::Failed {
                            error: OWNER_CLOSED.to_owned()
                        }
                    }
                ),
                to("doc-1", Message::State { state: idle() }),
                to("doc-2", Message::State { state: idle() }),
            ]
        );
        assert_eq!(registry.owner(), Some("main"));
    }

    #[test]
    fn another_page_loading_again_keeps_its_place_and_forgets_its_asks() {
        let mut registry = three();
        let told = registry.ask("doc-1", 1, What::Check).unwrap();
        let [(_, Message::Ask { id, .. })] = told.as_slice() else {
            panic!("{told:?}");
        };
        let (joined, told) = registry.join("doc-1");
        assert!(!joined.owner);
        assert_eq!(told, []);
        // The page numbers its asks from 1 again: an answer to the old page's goes nowhere.
        assert_eq!(registry.answer("main", *id, found("0.3.0")), []);
        assert_eq!(registry.leave("main")[0], to("doc-1", Message::Own));
    }

    #[test]
    fn messages_reach_the_window_by_name() {
        // src/update-owner.ts reads these.
        let json = |message: Message| serde_json::to_value(message).unwrap();
        assert_eq!(json(Message::Own), serde_json::json!({ "kind": "own" }));
        assert_eq!(
            json(Message::State {
                state: state(Phase::Downloading, Some("0.3.0"))
            }),
            serde_json::json!({
                "kind": "state",
                "state": { "phase": "downloading", "version": "0.3.0" }
            })
        );
        assert_eq!(
            json(Message::Dismissed {
                version: "0.3.0".to_owned()
            }),
            serde_json::json!({ "kind": "dismissed", "version": "0.3.0" })
        );
        assert_eq!(
            json(Message::Ask {
                id: 1,
                what: What::Install
            }),
            serde_json::json!({ "kind": "ask", "id": 1, "what": "install" })
        );
        assert_eq!(
            json(Message::Answer {
                id: 2,
                answer: Answer::Failed {
                    error: "no".to_owned()
                }
            }),
            serde_json::json!({
                "kind": "answer",
                "id": 2,
                "answer": { "outcome": "failed", "error": "no" }
            })
        );
        assert_eq!(
            serde_json::to_value(Joined {
                owner: true,
                state: idle(),
                dismissed: None
            })
            .unwrap(),
            serde_json::json!({
                "owner": true,
                "state": { "phase": "idle", "version": null },
                "dismissed": null
            })
        );
    }

    #[test]
    fn what_the_windows_send_is_read_by_name() {
        let state: UpdateState =
            serde_json::from_value(serde_json::json!({ "phase": "ready", "version": "0.3.0" }))
                .unwrap();
        assert_eq!(state, ready("0.3.0"));
        let what: What = serde_json::from_value(serde_json::json!("check")).unwrap();
        assert_eq!(what, What::Check);
        let answer: Answer = serde_json::from_value(
            serde_json::json!({ "outcome": "done", "value": { "kind": "up-to-date" } }),
        )
        .unwrap();
        assert_eq!(
            answer,
            Answer::Done {
                value: serde_json::json!({ "kind": "up-to-date" })
            }
        );
    }
}
