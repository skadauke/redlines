// Quiet updates (#34), as a window sees them. The app checks for an update, downloads it and
// installs it, for every window at once (src-tauri/src/updates/checks.rs, #122): no window owns
// any of it, so closing one loses nothing, and one that opens later shows the update that is ready.
// A window shows what the app says the updates are doing (update-notifications.ts), and asks: Check
// for Updates…, Restart to update, Later. It also says whether the automatic checks are on, for the
// setting is in the windows' settings. update-link.ts is the app's side of each of these.

/** Idle, checking, downloading what a check found, or ready to install it. */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready';

export interface UpdateState {
  readonly phase: UpdatePhase;
  /** The version being downloaded or ready, else null. */
  readonly version: string | null;
}

/** Why a copy can't update itself (src-tauri/src/updates.rs). */
export type Unavailable = 'development' | 'not-set-up' | 'disk-image' | 'read-only' | 'unsupported';

/** What a check asked for (Check for Updates…) found. */
export type CheckResult =
  | { kind: 'up-to-date' }
  | { kind: 'downloading'; version: string }
  | { kind: 'ready'; version: string }
  | { kind: 'failed' }
  | { kind: 'unavailable'; reason: Unavailable };

/** What the app tells every window (`Message` in src-tauri/src/updates/checks.rs). */
export type UpdateMessage =
  /** What the updates are doing now. */
  | { kind: 'state'; state: UpdateState }
  /** The card of the update `version` was dismissed in a window. */
  | { kind: 'dismissed'; version: string };

/** What a window reads as it starts (`Snapshot`). */
export interface UpdateSnapshot {
  state: UpdateState;
  /** The version whose card was dismissed, if one was. */
  dismissed: string | null;
}

/** What a window needs of the app for the updates; update-link.ts has the app's. */
export interface UpdateLink {
  /** Calls `handler` with each message the app sends. */
  listen(handler: (message: UpdateMessage) => void): Promise<unknown>;
  /** What the updates are doing now, and the version whose card was dismissed. */
  read(): Promise<UpdateSnapshot>;
  /** Check for Updates…: what the check under way, or a new one, found. */
  check(): Promise<CheckResult>;
  /** Installs the update that is ready, once however many windows ask. */
  install(): Promise<void>;
  /** The card of the update `version` was dismissed here. */
  dismiss(version: string): Promise<void>;
  /** Turns the automatic checks on, the first soon, or off. */
  setAutomatic(on: boolean): Promise<void>;
}

/** The app's updates, as this window sees them. */
export interface Updates {
  readonly state: UpdateState;
  /** The version whose card was dismissed, in this window or another, or null. */
  readonly dismissed: string | null;
  /** Calls `listener` with each new state; returns a function that stops it. */
  subscribe(listener: (state: UpdateState) => void): () => void;
  /**
   * Calls `listener` when the card is dismissed in another window, or when this window learns, as
   * it starts, that one was dismissed; returns a function that stops it.
   */
  onDismissed(listener: (version: string) => void): () => void;
  /** Turns the app's automatic checks on, the first soon, or off. */
  setAutomatic(on: boolean): void;
  /** Checks now, or waits for the check under way, and says what it found. */
  checkNow(): Promise<CheckResult>;
  /**
   * Installs the update that is ready; the caller then starts the app again. Should a Cancel stop
   * the restart after that, the next restart goes on from there.
   */
  install(): Promise<void>;
  /** Dismisses the card of the update `version` in every window. */
  dismiss(version: string): void;
}

const IDLE: UpdateState = { phase: 'idle', version: null };

const warn = (what: string) => (error: unknown) => {
  console.warn(`Could not ${what}`, error);
};

/** This window's view of the app's updates, through `link`. */
export function windowUpdates(link: UpdateLink): Updates {
  let state = IDLE;
  let dismissed: string | null = null;
  const listeners = new Set<(state: UpdateState) => void>();
  const dismissListeners = new Set<(version: string) => void>();
  // Heard while reading what the updates are doing: newer than what the read says.
  let heardState = false;
  let heardDismissed = false;

  const set = (next: UpdateState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  /** The card of the update `version` was dismissed elsewhere, or before this window began. */
  const learnDismissed = (version: string) => {
    // This window's own Later, coming back: nothing new.
    if (version === dismissed) return;
    dismissed = version;
    for (const listener of dismissListeners) listener(version);
  };

  const hear = (message: UpdateMessage) => {
    switch (message.kind) {
      case 'state':
        heardState = true;
        set(message.state);
        return;
      case 'dismissed':
        heardDismissed = true;
        learnDismissed(message.version);
        return;
    }
  };

  // Listening first, so that nothing the app says while this window reads is missed.
  void (async () => {
    await link.listen(hear);
    const snapshot = await link.read();
    // Before the state: a card shown for the update that is ready may be one dismissed already.
    if (!heardDismissed && snapshot.dismissed !== null) learnDismissed(snapshot.dismissed);
    if (!heardState) set(snapshot.state);
  })().catch(warn('learn what the updates are doing'));

  return {
    get state() {
      return state;
    },
    get dismissed() {
      return dismissed;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onDismissed(listener) {
      dismissListeners.add(listener);
      return () => dismissListeners.delete(listener);
    },
    setAutomatic(on) {
      link.setAutomatic(on).catch(warn('turn the automatic update checks on or off'));
    },
    async checkNow() {
      try {
        return await link.check();
      } catch (error) {
        warn('check for updates')(error);
        return { kind: 'failed' };
      }
    },
    install: () => link.install(),
    dismiss(version) {
      dismissed = version;
      link.dismiss(version).catch(warn('dismiss the update in the other windows'));
    },
  };
}
