//! The app's updates (#34, #122): when to check, the check, the download and the install, and what
//! the windows are told of them. No window owns any of it. Each window has a page of its own, and
//! the app holds the download, so a window that closes takes nothing with it, and one that opens
//! later shows the update that is ready.
//!
//! A copy that can update itself (`updates.rs` says) checks soon after the windows say that the
//! automatic checks are on, then every few hours, downloads what it finds in the background, and
//! waits, with the update ready, for the person to restart. Nothing here ever asks or tells the
//! person anything: a check, a download or an install that fails is tried again later, and each
//! window decides what to show (`src/update-notifications.ts`). The windows ask through the
//! commands in `updates.rs`: Check for Updates… waits for the check under way, or starts one, and
//! answers the window that asked; Restart to update installs what was downloaded, once, however
//! many windows ask.
//!
//! The update server and the clock come from outside: in the app, the updater plugin and the timers
//! of Tauri's runtime; in the tests, a fake source and tokio's paused clock.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tokio::runtime::Handle;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::Availability;

/// The first automatic check, after the windows have said the checks are on.
pub const FIRST_CHECK: Duration = Duration::from_secs(10);
/// Between automatic checks.
pub const CHECK_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);
/// After a check, a download or an install that failed, offline say.
pub const RETRY: Duration = Duration::from_secs(60 * 60);
/// How long a check may take before it fails, to be tried again later.
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(60);
/// How long a download may take before it fails, to be tried again later.
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// What Restart to update is told when there is nothing to install.
const NOTHING_READY: &str = "No update is ready.";

/// What Restart to update is told when this copy could update itself when it checked, and can't any
/// more, as when the folder it is in has become read-only.
const NO_LONGER_AVAILABLE: &str = "Redlines can no longer update itself where it is.";

/// Work for the app's runtime: a check, a download or an install.
pub type Task<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// What a check found: a newer release, or none.
pub type Checked = Result<Option<Arc<dyn Found>>, String>;

/// Where updates come from: the updater plugin in the app (`updates.rs`), a fake in the tests.
pub trait Source: Send + Sync + 'static {
    /// Whether this copy can update itself, or why not.
    fn availability(&self) -> Availability;
    /// Asks for a newer release.
    fn check(&self) -> Task<Checked>;
}

/// An update that a check found.
pub trait Found: Send + Sync + 'static {
    fn version(&self) -> &str;
    /// Downloads the update, and verifies its signature.
    fn download(&self) -> Task<Result<Vec<u8>, String>>;
    /// Replaces the app with the downloaded update; the app then has to be started again.
    fn install(&self, bytes: Arc<Vec<u8>>) -> Task<Result<(), String>>;
}

/// Idle, checking, downloading what a check found, or ready to install it (`UpdatePhase` in
/// `src/updates.ts`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    #[default]
    Idle,
    Checking,
    Downloading,
    Ready,
}

/// What the updates are doing. The windows read it by name.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct UpdateState {
    pub phase: Phase,
    /// The version being downloaded or ready.
    pub version: Option<String>,
}

impl UpdateState {
    fn checking() -> Self {
        Self {
            phase: Phase::Checking,
            version: None,
        }
    }

    /// Downloading or ready: the phases with a version.
    fn with(phase: Phase, version: &str) -> Self {
        Self {
            phase,
            version: Some(version.to_owned()),
        }
    }
}

/// What a check asked for (Check for Updates…) found. The window that asked reads it by name.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CheckResult {
    UpToDate,
    Downloading {
        version: String,
    },
    Ready {
        version: String,
    },
    Failed,
    /// Never `Availability::Available`.
    Unavailable {
        reason: Availability,
    },
}

/// What every window is told, in the `updates` event. The windows read it by name.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Message {
    /// What the updates are doing now.
    State { state: UpdateState },
    /// The card of the update `version` was dismissed in a window (Later).
    Dismissed { version: String },
}

/// What a window reads as it starts. The window reads the fields by name.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Snapshot {
    pub state: UpdateState,
    /// The version whose card was dismissed, if one was.
    pub dismissed: Option<String>,
}

/// The update that is downloaded, ready to install.
#[derive(Clone)]
struct Ready {
    update: Arc<dyn Found>,
    bytes: Arc<Vec<u8>>,
}

/// The install of the update that is ready.
#[derive(Default)]
enum Install {
    #[default]
    NotYet,
    /// Under way: the windows waiting for it.
    Running(Vec<oneshot::Sender<Result<(), String>>>),
    /// Done. Should a Cancel stop the restart after that, the next restart goes on from here.
    Done,
}

/// The next automatic check.
struct Timer {
    /// Which timer this is: a timer that fires late checks that it is still the one.
    id: u64,
    task: JoinHandle<()>,
}

#[derive(Default)]
struct Inner {
    state: UpdateState,
    dismissed: Option<String>,
    automatic: bool,
    /// Known after a check: this copy can't update itself, so there is nothing to check for.
    unavailable: bool,
    /// The next automatic check, while one is due.
    timer: Option<Timer>,
    /// The number of the last timer set.
    timers: u64,
    /// The windows waiting for the check under way, while one is.
    checking: Option<Vec<oneshot::Sender<CheckResult>>>,
    ready: Option<Ready>,
    install: Install,
}

impl Inner {
    fn set(&mut self, told: &mut Told, state: UpdateState) {
        self.state = state.clone();
        told.push(Message::State { state });
    }

    fn clear_timer(&mut self) {
        if let Some(timer) = self.timer.take() {
            timer.task.abort();
        }
    }

    /// The check is done: every window waiting for it hears what it found.
    fn checked(&mut self, result: &CheckResult) {
        for waiting in self.checking.take().into_iter().flatten() {
            // A window that stopped waiting, as one that closed, hears nothing.
            let _ = waiting.send(result.clone());
        }
    }
}

/// What to tell the windows, once the lock is let go.
type Told = Vec<Message>;

struct Shared {
    source: Box<dyn Source>,
    tell: Box<dyn Fn(Message) + Send + Sync>,
    runtime: Handle,
    inner: Mutex<Inner>,
}

/// The app's updates. A clone is the same updates.
#[derive(Clone)]
pub struct Updates(Arc<Shared>);

/// Check for Updates…: what is known at once, or the check to wait for.
enum Asked {
    Now(CheckResult),
    Later(oneshot::Receiver<CheckResult>),
}

impl Updates {
    /// The updates from `source`, which tell the windows through `tell` and run on `runtime`.
    pub fn new(
        source: impl Source,
        tell: impl Fn(Message) + Send + Sync + 'static,
        runtime: Handle,
    ) -> Self {
        Self(Arc::new(Shared {
            source: Box::new(source),
            tell: Box::new(tell),
            runtime,
            inner: Mutex::default(),
        }))
    }

    /// Never held while the windows are told something, or across a wait.
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Makes a change, then tells the windows what it said to tell them.
    fn change<T>(&self, change: impl FnOnce(&mut Inner, &mut Told) -> T) -> T {
        let mut told = Told::new();
        let value = change(&mut self.lock(), &mut told);
        for message in told {
            (self.0.tell)(message);
        }
        value
    }

    /// What the updates are doing, and the version whose card was dismissed.
    pub fn snapshot(&self) -> Snapshot {
        let inner = self.lock();
        Snapshot {
            state: inner.state.clone(),
            dismissed: inner.dismissed.clone(),
        }
    }

    /// Turns the automatic checks on, the first soon, or off. Every window says so as it starts and
    /// when the setting changes, for the setting is in the windows' settings; saying it again
    /// doesn't put the next check off.
    pub fn set_automatic(&self, on: bool) {
        self.change(|inner, _| {
            inner.automatic = on;
            if !on {
                inner.clear_timer();
            } else if inner.timer.is_none() && inner.checking.is_none() {
                self.schedule(inner, FIRST_CHECK);
            }
        });
    }

    /// Check for Updates…: what a download under way or ready is, or what the check under way, or a
    /// new one, finds. The next automatic check is a full interval after it.
    pub async fn check_now(&self) -> CheckResult {
        let asked = self.change(|inner, _| match (inner.state.phase, &inner.state.version) {
            (Phase::Ready, Some(version)) => Asked::Now(CheckResult::Ready {
                version: version.clone(),
            }),
            (Phase::Downloading, Some(version)) => Asked::Now(CheckResult::Downloading {
                version: version.clone(),
            }),
            _ => Asked::Later(self.start_check(inner)),
        });
        match asked {
            Asked::Now(result) => result,
            Asked::Later(answer) => answer.await.unwrap_or(CheckResult::Failed),
        }
    }

    /// Restart to update: installs the update that is ready, once, also when asked again while it
    /// installs, as from two windows at once. The window that asked then starts the app again. A
    /// copy that can no longer update itself installs nothing, and goes on as when an install
    /// fails.
    pub async fn install(&self) -> Result<(), String> {
        let answer = self.change(|inner, _| {
            let ready = match (inner.state.phase, &inner.ready) {
                (Phase::Ready, Some(ready)) => ready.clone(),
                _ => return Err(NOTHING_READY.to_owned()),
            };
            let (answer, waiting) = oneshot::channel();
            match &mut inner.install {
                Install::Done => return Ok(None),
                Install::Running(others) => others.push(answer),
                Install::NotYet => {
                    inner.install = Install::Running(vec![answer]);
                    let this = self.clone();
                    self.0.runtime.spawn(async move {
                        // Asked again, for the update may have waited long: installing where the
                        // app can no longer replace itself would ask for an administrator's
                        // password, and nothing ever does.
                        let installed = match this.availability().await {
                            Ok(Availability::Available) => {
                                this.caught(async move { ready.update.install(ready.bytes).await })
                                    .await
                            }
                            Ok(_) => Err(NO_LONGER_AVAILABLE.to_owned()),
                            Err(error) => Err(error),
                        };
                        this.installed(installed);
                    });
                }
            }
            Ok(Some(waiting))
        })?;
        match answer {
            None => Ok(()),
            Some(waiting) => waiting
                .await
                .unwrap_or_else(|_| Err("The install stopped.".to_owned())),
        }
    }

    /// The card of the update `version` was dismissed in a window: it goes in every window, and a
    /// window that opens later doesn't show it.
    pub fn dismiss(&self, version: String) {
        self.change(|inner, told| {
            inner.dismissed = Some(version.clone());
            told.push(Message::Dismissed { version });
        });
    }

    /// Puts the next automatic check `after` from now, when there should be one.
    fn schedule(&self, inner: &mut Inner, after: Duration) {
        inner.clear_timer();
        if !inner.automatic || inner.unavailable || inner.state.phase != Phase::Idle {
            return;
        }
        inner.timers += 1;
        let id = inner.timers;
        // From now, not from when the runtime first gets to the timer.
        let due = tokio::time::Instant::now() + after;
        let this = self.clone();
        let task = self.0.runtime.spawn(async move {
            tokio::time::sleep_until(due).await;
            this.timer_fired(id);
        });
        inner.timer = Some(Timer { id, task });
    }

    fn timer_fired(&self, id: u64) {
        self.change(|inner, _| {
            if inner.timer.as_ref().is_some_and(|timer| timer.id == id) {
                inner.timer = None;
                // No window waits for an automatic check.
                drop(self.start_check(inner));
            }
        });
    }

    /// Joins the check under way, or starts one; what it finds comes to the receiver.
    fn start_check(&self, inner: &mut Inner) -> oneshot::Receiver<CheckResult> {
        let (answer, waiting) = oneshot::channel();
        if let Some(others) = &mut inner.checking {
            others.push(answer);
            return waiting;
        }
        inner.checking = Some(vec![answer]);
        inner.clear_timer();
        let this = self.clone();
        self.0.runtime.spawn(async move { this.check().await });
        waiting
    }

    /// Runs `work` as a task of its own and waits for it, so that a panic in it, a bug in the
    /// updater say, comes back as an error and goes the way a failure goes, rather than leaving the
    /// windows waiting for it and the updates stuck where they were.
    async fn caught<T: Send + 'static>(
        &self,
        work: impl Future<Output = Result<T, String>> + Send + 'static,
    ) -> Result<T, String> {
        self.0
            .runtime
            .spawn(work)
            .await
            .unwrap_or_else(|stopped| Err(stopped.to_string()))
    }

    /// Whether this copy can update itself, or why not (`caught`).
    async fn availability(&self) -> Result<Availability, String> {
        let this = self.clone();
        self.caught(async move { Ok(this.0.source.availability()) })
            .await
    }

    async fn check(self) {
        let found = match self.availability().await {
            Ok(Availability::Available) => {
                self.change(|inner, told| {
                    inner.unavailable = false;
                    inner.set(told, UpdateState::checking());
                });
                let this = self.clone();
                self.caught(async move { this.0.source.check().await })
                    .await
            }
            Ok(availability) => {
                self.change(|inner, _| {
                    inner.unavailable = true;
                    inner.checked(&CheckResult::Unavailable {
                        reason: availability,
                    });
                });
                return;
            }
            Err(error) => Err(error),
        };
        let found = self.change(|inner, told| {
            let (result, found) = match found {
                Ok(None) => {
                    inner.set(told, UpdateState::default());
                    self.schedule(inner, CHECK_INTERVAL);
                    (CheckResult::UpToDate, None)
                }
                Ok(Some(update)) => {
                    let version = update.version().to_owned();
                    inner.set(told, UpdateState::with(Phase::Downloading, &version));
                    (CheckResult::Downloading { version }, Some(update))
                }
                Err(error) => {
                    self.fail(inner, told, "check for updates", &error);
                    (CheckResult::Failed, None)
                }
            };
            inner.checked(&result);
            found
        });
        // Only now, with the windows told that it downloads: whatever the download tells them
        // comes after that, however soon it ends. The windows that asked have their answer.
        if let Some(update) = found {
            self.download(update).await;
        }
    }

    async fn download(&self, update: Arc<dyn Found>) {
        let downloading = update.clone();
        let downloaded = self
            .caught(async move { downloading.download().await })
            .await;
        self.change(|inner, told| match downloaded {
            Ok(bytes) => {
                let version = update.version().to_owned();
                inner.ready = Some(Ready {
                    update,
                    bytes: Arc::new(bytes),
                });
                inner.install = Install::NotYet;
                inner.set(told, UpdateState::with(Phase::Ready, &version));
            }
            Err(error) => self.fail(inner, told, "download the update", &error),
        });
    }

    fn installed(&self, installed: Result<(), String>) {
        self.change(|inner, told| {
            let waiting = match std::mem::take(&mut inner.install) {
                Install::Running(waiting) => waiting,
                Install::NotYet | Install::Done => Vec::new(),
            };
            match &installed {
                Ok(()) => inner.install = Install::Done,
                Err(error) => {
                    inner.ready = None;
                    self.fail(inner, told, "install the update", error);
                }
            }
            for answer in waiting {
                let _ = answer.send(installed.clone());
            }
        });
    }

    /// Something failed: nothing is under way any more, and the check is tried again later.
    fn fail(&self, inner: &mut Inner, told: &mut Told, what: &str, error: &str) {
        eprintln!("Redlines could not {what}, and will try again later: {error}");
        inner.set(told, UpdateState::default());
        self.schedule(inner, RETRY);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    /// A moment, to look just before something is due.
    const MOMENT: Duration = Duration::from_millis(1);

    /// Runs a test on a clock that stands still until the test moves it on.
    fn run(test: impl Future<Output = ()>) {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .start_paused(true)
            .build()
            .unwrap()
            .block_on(test);
    }

    /// Lets every task that can go on do so, without moving the clock.
    async fn settle() {
        for _ in 0..100 {
            tokio::task::yield_now().await;
        }
    }

    /// Moves the clock on by `by`, and lets what was due happen.
    async fn wait(by: Duration) {
        tokio::time::advance(by).await;
        settle().await;
    }

    /// What a check, a download or an install of the fakes does: answers at once, or when the test
    /// says, or panics, as a bug in the updater would.
    enum Plan<T> {
        Now(Result<T, String>),
        Later(oneshot::Receiver<Result<T, String>>),
        Panic,
    }

    impl<T: Send + 'static> Plan<T> {
        fn run(self) -> Task<Result<T, String>> {
            Box::pin(async move {
                match self {
                    Plan::Now(result) => result,
                    Plan::Later(answer) => answer
                        .await
                        .unwrap_or_else(|_| Err("the test let go".to_owned())),
                    Plan::Panic => panic!("the fake broke, as a bug in the updater would"),
                }
            })
        }
    }

    /// A plan that answers when the test sends the answer (`give`).
    fn later<T>() -> (oneshot::Sender<Result<T, String>>, Plan<T>) {
        let (answer, waiting) = oneshot::channel();
        (answer, Plan::Later(waiting))
    }

    /// Answers a plan made with `later`.
    fn give<T>(answer: oneshot::Sender<Result<T, String>>, result: Result<T, String>) {
        assert!(answer.send(result).is_ok(), "nothing waits for this answer");
    }

    type Plans<T> = Mutex<VecDeque<Plan<T>>>;

    /// An update a check found. Each download and install follows the next plan, and without one,
    /// a download gives the version's name as the update, and an install succeeds.
    struct FakeUpdate {
        version: String,
        downloads: AtomicUsize,
        installed: Mutex<Vec<Vec<u8>>>,
        download_plans: Plans<Vec<u8>>,
        install_plans: Plans<()>,
    }

    fn update(version: &str) -> Arc<FakeUpdate> {
        Arc::new(FakeUpdate {
            version: version.to_owned(),
            downloads: AtomicUsize::new(0),
            installed: Mutex::default(),
            download_plans: Mutex::default(),
            install_plans: Mutex::default(),
        })
    }

    impl FakeUpdate {
        fn downloads(&self) -> usize {
            self.downloads.load(Ordering::SeqCst)
        }

        /// What each install was given.
        fn installed(&self) -> Vec<Vec<u8>> {
            self.installed.lock().unwrap().clone()
        }

        fn plan_download(&self, plan: Plan<Vec<u8>>) {
            self.download_plans.lock().unwrap().push_back(plan);
        }

        fn plan_install(&self, plan: Plan<()>) {
            self.install_plans.lock().unwrap().push_back(plan);
        }
    }

    impl Found for FakeUpdate {
        fn version(&self) -> &str {
            &self.version
        }

        fn download(&self) -> Task<Result<Vec<u8>, String>> {
            self.downloads.fetch_add(1, Ordering::SeqCst);
            let plan = self.download_plans.lock().unwrap().pop_front();
            plan.unwrap_or_else(|| Plan::Now(Ok(self.version.clone().into_bytes())))
                .run()
        }

        fn install(&self, bytes: Arc<Vec<u8>>) -> Task<Result<(), String>> {
            self.installed.lock().unwrap().push(bytes.to_vec());
            let plan = self.install_plans.lock().unwrap().pop_front();
            plan.unwrap_or(Plan::Now(Ok(()))).run()
        }
    }

    /// The update server: available, with nothing new, until the test says otherwise. Each check
    /// follows the next plan.
    struct FakeSource {
        availability: Mutex<Availability>,
        checks: AtomicUsize,
        plans: Plans<Option<Arc<dyn Found>>>,
    }

    impl FakeSource {
        fn checks(&self) -> usize {
            self.checks.load(Ordering::SeqCst)
        }

        fn plan(&self, plan: Plan<Option<Arc<dyn Found>>>) {
            self.plans.lock().unwrap().push_back(plan);
        }

        /// The next check finds `update`.
        fn finds(&self, update: &Arc<FakeUpdate>) {
            self.plan(Plan::Now(Ok(Some(update.clone()))));
        }

        /// The next check fails.
        fn fails(&self) {
            self.plan(Plan::Now(Err("offline".to_owned())));
        }
    }

    impl Source for Arc<FakeSource> {
        fn availability(&self) -> Availability {
            *self.availability.lock().unwrap()
        }

        fn check(&self) -> Task<Checked> {
            self.checks.fetch_add(1, Ordering::SeqCst);
            let plan = self.plans.lock().unwrap().pop_front();
            plan.unwrap_or(Plan::Now(Ok(None))).run()
        }
    }

    /// The app's updates over a fake source, and what the windows were told.
    struct App {
        updates: Updates,
        source: Arc<FakeSource>,
        told: Arc<Mutex<Vec<Message>>>,
    }

    fn app() -> App {
        app_with(Availability::Available)
    }

    fn source(availability: Availability) -> Arc<FakeSource> {
        Arc::new(FakeSource {
            availability: Mutex::new(availability),
            checks: AtomicUsize::new(0),
            plans: Mutex::default(),
        })
    }

    fn app_with(availability: Availability) -> App {
        let source = source(availability);
        let told = Arc::new(Mutex::new(Vec::new()));
        let heard = told.clone();
        let updates = Updates::new(
            source.clone(),
            move |message| heard.lock().unwrap().push(message),
            Handle::current(),
        );
        App {
            updates,
            source,
            told,
        }
    }

    impl App {
        /// The states the windows were told of so far, as `phase version`, and forgets them.
        fn phases(&self) -> Vec<String> {
            let mut told = self.told.lock().unwrap();
            told.drain(..)
                .filter_map(|message| match message {
                    Message::State { state } => Some(match state.version {
                        Some(version) => format!("{:?} {version}", state.phase),
                        None => format!("{:?}", state.phase),
                    }),
                    Message::Dismissed { .. } => None,
                })
                .collect()
        }

        fn state(&self) -> UpdateState {
            self.updates.snapshot().state
        }

        /// A window asks Check for Updates…, and waits for the answer.
        fn ask_check(&self) -> JoinHandle<CheckResult> {
            let updates = self.updates.clone();
            tokio::spawn(async move { updates.check_now().await })
        }

        /// A window asks to install, for Restart to update, and waits for the answer.
        fn ask_install(&self) -> JoinHandle<Result<(), String>> {
            let updates = self.updates.clone();
            tokio::spawn(async move { updates.install().await })
        }

        /// The update `version` is downloaded and ready, from a check a window asked for.
        async fn ready(&self, version: &str) -> Arc<FakeUpdate> {
            let found = update(version);
            self.source.finds(&found);
            self.updates.check_now().await;
            settle().await;
            assert_eq!(self.state(), UpdateState::with(Phase::Ready, version));
            found
        }
    }

    fn downloading(version: &str) -> CheckResult {
        CheckResult::Downloading {
            version: version.to_owned(),
        }
    }

    fn ready(version: &str) -> CheckResult {
        CheckResult::Ready {
            version: version.to_owned(),
        }
    }

    #[test]
    fn the_checks_come_soon_after_the_windows_turn_them_on_then_every_few_hours() {
        run(async {
            let app = app();
            assert_eq!(app.state(), UpdateState::default());
            app.updates.set_automatic(true);
            wait(FIRST_CHECK - MOMENT).await;
            assert_eq!(app.source.checks(), 0);
            wait(MOMENT).await;
            assert_eq!(app.source.checks(), 1);
            assert_eq!(app.phases(), ["Checking", "Idle"]);
            wait(CHECK_INTERVAL - MOMENT).await;
            assert_eq!(app.source.checks(), 1);
            wait(MOMENT).await;
            assert_eq!(app.source.checks(), 2);
        });
    }

    #[test]
    fn an_update_goes_from_checking_to_downloading_and_ready_and_the_checks_stop() {
        run(async {
            let app = app();
            let found = update("0.3.0");
            app.source.finds(&found);
            app.updates.set_automatic(true);
            wait(FIRST_CHECK).await;
            assert_eq!(
                app.phases(),
                ["Checking", "Downloading 0.3.0", "Ready 0.3.0"]
            );
            assert_eq!(found.downloads(), 1);
            // The downloaded update waits for the restart: no more checks.
            wait(CHECK_INTERVAL * 3).await;
            assert_eq!(app.source.checks(), 1);
            assert_eq!(app.phases(), Vec::<String>::new());
        });
    }

    #[test]
    fn a_download_that_finishes_at_once_is_told_after_downloading() {
        // Downloading goes out on one thread, and Ready, from a download that finishes at once, may
        // go out on another. Here the thread that tells Downloading is held up, as a busy machine
        // might hold it, and a download that has begun by then gets the time to finish and tell
        // Ready first. None must have begun.
        const HELD_UP: Duration = Duration::from_millis(100);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_time()
            .build()
            .unwrap();
        runtime.block_on(async {
            let source = source(Availability::Available);
            source.finds(&update("0.3.0"));
            let told = Arc::new(Mutex::new(Vec::new()));
            let heard = told.clone();
            let (ready, readied) = std::sync::mpsc::channel();
            let readied = Mutex::new(readied);
            let updates = Updates::new(
                source,
                move |message| {
                    let Message::State { state } = message else {
                        return;
                    };
                    match state.phase {
                        Phase::Downloading => tokio::task::block_in_place(|| {
                            let _ = readied.lock().unwrap().recv_timeout(HELD_UP);
                        }),
                        Phase::Ready => {
                            let _ = ready.send(());
                        }
                        Phase::Idle | Phase::Checking => {}
                    }
                    heard.lock().unwrap().push(format!("{:?}", state.phase));
                },
                Handle::current(),
            );
            assert_eq!(updates.check_now().await, downloading("0.3.0"));
            tokio::time::timeout(HELD_UP * 50, async {
                while told.lock().unwrap().len() < 3 {
                    tokio::time::sleep(MOMENT).await;
                }
            })
            .await
            .unwrap();
            assert_eq!(*told.lock().unwrap(), ["Checking", "Downloading", "Ready"]);
        });
    }

    #[test]
    fn a_check_that_fails_says_nothing_and_is_tried_again_later() {
        run(async {
            let app = app();
            app.source.fails();
            app.updates.set_automatic(true);
            wait(FIRST_CHECK).await;
            assert_eq!(app.phases(), ["Checking", "Idle"]);
            wait(RETRY - MOMENT).await;
            assert_eq!(app.source.checks(), 1);
            wait(MOMENT).await;
            assert_eq!(app.source.checks(), 2);
        });
    }

    #[test]
    fn a_download_that_fails_is_let_go_and_tried_again_later() {
        run(async {
            let app = app();
            let broken = update("0.3.0");
            broken.plan_download(Plan::Now(Err("connection reset".to_owned())));
            app.source.finds(&broken);
            app.source.finds(&update("0.3.0"));
            app.updates.set_automatic(true);
            wait(FIRST_CHECK).await;
            assert_eq!(app.phases(), ["Checking", "Downloading 0.3.0", "Idle"]);
            wait(RETRY).await;
            assert_eq!(app.state(), UpdateState::with(Phase::Ready, "0.3.0"));
        });
    }

    #[test]
    fn a_check_that_panics_fails_and_is_tried_again_later() {
        run(async {
            let app = app();
            app.updates.set_automatic(true);
            app.source.plan(Plan::Panic);
            let asked = app.ask_check();
            settle().await;
            // The window that asked hears that the check failed, rather than waiting for ever.
            assert!(asked.is_finished());
            assert_eq!(asked.await.unwrap(), CheckResult::Failed);
            assert_eq!(app.phases(), ["Checking", "Idle"]);
            wait(RETRY).await;
            assert_eq!(app.source.checks(), 2);
            assert_eq!(app.updates.check_now().await, CheckResult::UpToDate);
        });
    }

    #[test]
    fn a_download_that_panics_is_let_go_and_tried_again_later() {
        run(async {
            let app = app();
            app.updates.set_automatic(true);
            let broken = update("0.3.0");
            broken.plan_download(Plan::Panic);
            app.source.finds(&broken);
            app.source.finds(&update("0.3.0"));
            assert_eq!(app.updates.check_now().await, downloading("0.3.0"));
            settle().await;
            // Not downloading for ever: Check for Updates… would say so, and nothing would retry.
            assert_eq!(app.phases(), ["Checking", "Downloading 0.3.0", "Idle"]);
            wait(RETRY).await;
            assert_eq!(app.state(), UpdateState::with(Phase::Ready, "0.3.0"));
        });
    }

    #[test]
    fn an_install_that_panics_fails_for_the_window_that_asked() {
        run(async {
            let app = app();
            let found = app.ready("0.3.0").await;
            found.plan_install(Plan::Panic);
            let asked = app.ask_install();
            settle().await;
            assert!(asked.is_finished());
            assert!(asked.await.unwrap().is_err());
            assert_eq!(app.state(), UpdateState::default());
        });
    }

    #[test]
    fn the_checks_stop_when_turned_off_and_come_soon_when_on_again() {
        run(async {
            let app = app();
            app.updates.set_automatic(true);
            app.updates.set_automatic(false);
            wait(CHECK_INTERVAL * 2).await;
            assert_eq!(app.source.checks(), 0);
            app.updates.set_automatic(true);
            // Another window says so too as it starts: that doesn't put the check off.
            wait(FIRST_CHECK - MOMENT).await;
            app.updates.set_automatic(true);
            wait(MOMENT).await;
            assert_eq!(app.source.checks(), 1);
        });
    }

    #[test]
    fn a_copy_that_cannot_update_itself_never_checks_and_says_why_when_asked() {
        run(async {
            let app = app_with(Availability::Development);
            app.updates.set_automatic(true);
            wait(CHECK_INTERVAL * 2).await;
            assert_eq!(app.source.checks(), 0);
            assert_eq!(app.phases(), Vec::<String>::new());
            assert_eq!(
                app.updates.check_now().await,
                CheckResult::Unavailable {
                    reason: Availability::Development
                }
            );
            assert_eq!(app.source.checks(), 0);
            // Nor does it check again by itself.
            wait(CHECK_INTERVAL * 2).await;
            assert_eq!(app.source.checks(), 0);
        });
    }

    #[test]
    fn check_for_updates_says_what_it_found() {
        run(async {
            let app = app();
            assert_eq!(app.updates.check_now().await, CheckResult::UpToDate);

            app.source.fails();
            assert_eq!(app.updates.check_now().await, CheckResult::Failed);

            let found = update("0.3.0");
            let (download, plan) = later();
            found.plan_download(plan);
            app.source.finds(&found);
            assert_eq!(app.updates.check_now().await, downloading("0.3.0"));
            // Asked again while it downloads, it says so, and doesn't check again.
            assert_eq!(app.updates.check_now().await, downloading("0.3.0"));
            give(download, Ok(b"0.3.0".to_vec()));
            settle().await;
            assert_eq!(app.updates.check_now().await, ready("0.3.0"));
            assert_eq!(app.source.checks(), 3);
        });
    }

    #[test]
    fn check_for_updates_waits_for_the_automatic_check_under_way() {
        run(async {
            let app = app();
            let (answer, plan) = later();
            app.source.plan(plan);
            app.updates.set_automatic(true);
            wait(FIRST_CHECK).await;
            assert_eq!(app.state().phase, Phase::Checking);
            let asked = app.ask_check();
            settle().await;
            give(answer, Ok(None));
            assert_eq!(asked.await.unwrap(), CheckResult::UpToDate);
            assert_eq!(app.source.checks(), 1);
        });
    }

    #[test]
    fn two_windows_asking_check_for_updates_at_once_both_get_the_answer() {
        run(async {
            let app = app();
            let (answer, plan) = later();
            app.source.plan(plan);
            let first = app.ask_check();
            let second = app.ask_check();
            settle().await;
            let found = update("0.3.0");
            give(answer, Ok(Some(found.clone())));
            assert_eq!(first.await.unwrap(), downloading("0.3.0"));
            assert_eq!(second.await.unwrap(), downloading("0.3.0"));
            assert_eq!(app.source.checks(), 1);
            assert_eq!(found.downloads(), 1);
        });
    }

    #[test]
    fn the_next_automatic_check_is_a_full_interval_after_one_asked_for() {
        run(async {
            let app = app();
            app.updates.set_automatic(true);
            wait(FIRST_CHECK).await;
            wait(CHECK_INTERVAL / 2).await;
            app.updates.check_now().await;
            assert_eq!(app.source.checks(), 2);
            wait(CHECK_INTERVAL - MOMENT).await;
            assert_eq!(app.source.checks(), 2);
            wait(MOMENT).await;
            assert_eq!(app.source.checks(), 3);
        });
    }

    #[test]
    fn a_window_closing_during_a_download_loses_nothing() {
        run(async {
            let app = app();
            let found = update("0.3.0");
            let (download, plan) = later();
            found.plan_download(plan);
            let (answer, plan) = later();
            app.source.plan(plan);
            // The window that asked closes while the check runs, and before the download ends:
            // nothing waits for either of them any more.
            let closing = app.ask_check();
            settle().await;
            closing.abort();
            give(answer, Ok(Some(found.clone())));
            settle().await;
            assert_eq!(app.state(), UpdateState::with(Phase::Downloading, "0.3.0"));
            give(download, Ok(b"0.3.0".to_vec()));
            settle().await;
            // Another window shows the update that is ready, and installs what was downloaded.
            assert_eq!(app.state(), UpdateState::with(Phase::Ready, "0.3.0"));
            assert_eq!(app.updates.check_now().await, ready("0.3.0"));
            app.updates.install().await.unwrap();
            assert_eq!(found.installed(), [b"0.3.0".to_vec()]);
            assert_eq!((app.source.checks(), found.downloads()), (1, 1));
        });
    }

    #[test]
    fn a_window_that_opens_while_an_update_is_ready_sees_it() {
        run(async {
            let app = app();
            app.ready("0.3.0").await;
            assert_eq!(
                app.updates.snapshot(),
                Snapshot {
                    state: UpdateState::with(Phase::Ready, "0.3.0"),
                    dismissed: None
                }
            );
        });
    }

    #[test]
    fn restart_to_update_with_nothing_ready_installs_nothing() {
        run(async {
            let app = app();
            assert_eq!(app.updates.install().await, Err(NOTHING_READY.to_owned()));
            // Nor while the update downloads.
            let found = update("0.3.0");
            let (_download, plan) = later();
            found.plan_download(plan);
            app.source.finds(&found);
            app.updates.check_now().await;
            assert!(app.updates.install().await.is_err());
            assert_eq!(found.installed(), Vec::<Vec<u8>>::new());
        });
    }

    #[test]
    fn restart_to_update_installs_what_was_downloaded_once() {
        run(async {
            let app = app();
            let found = app.ready("0.3.0").await;
            app.updates.install().await.unwrap();
            assert_eq!(found.installed(), [b"0.3.0".to_vec()]);
            // A Cancel at the question about unsaved edits stopped the restart after the install:
            // the next restart goes on from there, and the update stays ready.
            app.updates.install().await.unwrap();
            assert_eq!(found.installed().len(), 1);
            assert_eq!(app.state(), UpdateState::with(Phase::Ready, "0.3.0"));
        });
    }

    #[test]
    fn restart_to_update_installs_nothing_once_the_copy_can_no_longer_update_itself() {
        run(async {
            let app = app();
            let found = app.ready("0.3.0").await;
            app.told.lock().unwrap().clear();
            // Its folder became read-only while the update waited: installing now would ask for an
            // administrator's password, and nothing ever does.
            *app.source.availability.lock().unwrap() = Availability::ReadOnly;
            let first = app.ask_install();
            let second = app.ask_install();
            settle().await;
            assert!(first.await.unwrap().is_err());
            assert!(second.await.unwrap().is_err());
            assert_eq!(found.installed(), Vec::<Vec<u8>>::new());
            // As when installing fails: the update goes, and the windows hear that, nothing more.
            assert_eq!(
                *app.told.lock().unwrap(),
                [Message::State {
                    state: UpdateState::default()
                }]
            );
        });
    }

    #[test]
    fn the_update_installs_once_when_two_windows_ask_at_the_same_time() {
        run(async {
            let app = app();
            let found = app.ready("0.3.0").await;
            let (installing, plan) = later();
            found.plan_install(plan);
            let first = app.ask_install();
            let second = app.ask_install();
            settle().await;
            give(installing, Ok(()));
            assert_eq!(first.await.unwrap(), Ok(()));
            assert_eq!(second.await.unwrap(), Ok(()));
            assert_eq!(found.installed().len(), 1);
        });
    }

    #[test]
    fn each_window_that_asked_hears_when_installing_fails() {
        run(async {
            let app = app();
            let found = app.ready("0.3.0").await;
            let (installing, plan) = later();
            found.plan_install(plan);
            let first = app.ask_install();
            let second = app.ask_install();
            settle().await;
            give(installing, Err("permission denied".to_owned()));
            let failed = Err("permission denied".to_owned());
            assert_eq!(first.await.unwrap(), failed);
            assert_eq!(second.await.unwrap(), failed);
            assert_eq!(found.installed().len(), 1);
        });
    }

    #[test]
    fn an_install_that_fails_lets_the_update_go_and_checks_again_later() {
        run(async {
            let app = app();
            app.updates.set_automatic(true);
            let broken = update("0.3.0");
            broken.plan_install(Plan::Now(Err("permission denied".to_owned())));
            app.source.finds(&broken);
            wait(FIRST_CHECK).await;
            app.phases();
            assert!(app.updates.install().await.is_err());
            assert_eq!(app.phases(), ["Idle"]);
            assert!(app.updates.install().await.is_err());
            // The next check downloads it again, and that one installs.
            let next = update("0.3.0");
            app.source.finds(&next);
            wait(RETRY).await;
            assert_eq!(app.source.checks(), 2);
            app.updates.install().await.unwrap();
            assert_eq!(next.installed().len(), 1);
        });
    }

    #[test]
    fn dismissing_the_card_in_one_window_dismisses_it_in_every_window() {
        run(async {
            let app = app();
            app.ready("0.3.0").await;
            app.told.lock().unwrap().clear();
            app.updates.dismiss("0.3.0".to_owned());
            assert_eq!(
                *app.told.lock().unwrap(),
                [Message::Dismissed {
                    version: "0.3.0".to_owned()
                }]
            );
            // A window that opens now doesn't show it either.
            assert_eq!(app.updates.snapshot().dismissed.as_deref(), Some("0.3.0"));
        });
    }

    #[test]
    fn the_timings_keep_their_order() {
        assert!(FIRST_CHECK < RETRY);
        assert!(RETRY < CHECK_INTERVAL);
        // A check gives up, and a download too, well before it would be tried again.
        assert!(CHECK_TIMEOUT < RETRY);
        assert!(DOWNLOAD_TIMEOUT < RETRY);
    }

    #[test]
    fn what_the_windows_hear_is_read_by_name() {
        // src/updates.ts reads these.
        fn json(value: impl Serialize) -> serde_json::Value {
            serde_json::to_value(value).unwrap()
        }
        assert_eq!(
            json(Message::State {
                state: UpdateState::with(Phase::Downloading, "0.3.0")
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
            json(Snapshot {
                state: UpdateState::default(),
                dismissed: None
            }),
            serde_json::json!({
                "state": { "phase": "idle", "version": null },
                "dismissed": null
            })
        );
        assert_eq!(
            json(UpdateState::checking()),
            serde_json::json!({ "phase": "checking", "version": null })
        );
        assert_eq!(
            json(ready("0.3.0")),
            serde_json::json!({ "kind": "ready", "version": "0.3.0" })
        );
        assert_eq!(
            [
                CheckResult::UpToDate,
                downloading("0.3.0"),
                CheckResult::Failed,
                CheckResult::Unavailable {
                    reason: Availability::DiskImage
                },
            ]
            .map(json),
            [
                serde_json::json!({ "kind": "up-to-date" }),
                serde_json::json!({ "kind": "downloading", "version": "0.3.0" }),
                serde_json::json!({ "kind": "failed" }),
                serde_json::json!({ "kind": "unavailable", "reason": "disk-image" }),
            ]
        );
    }
}
