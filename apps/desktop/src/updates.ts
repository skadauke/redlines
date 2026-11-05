// Quiet updates (#34): when to check for an update, and what has become of the last check. A copy
// that can update itself checks soon after it starts and every few hours, downloads what it finds
// in the background and then waits, with the update ready, for the person to restart it. Nothing
// here ever asks or tells anything: a check that fails is tried again later, and the window
// decides what to show (update-notifications.ts). The update server and the clock come from
// outside, so that tests can drive them; update-source.ts is the app's.

/** Idle, checking, downloading what a check found, or ready to install it. */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready';

export interface UpdateState {
  readonly phase: UpdatePhase;
  /** The version being downloaded or ready, else null. */
  readonly version: string | null;
}

/** Why a copy can't update itself (src-tauri/src/updates.rs). */
export type Unavailable = 'development' | 'not-set-up' | 'disk-image' | 'read-only' | 'unsupported';

export type Availability = 'available' | Unavailable;

/** An update that a check found: a newer release, verified by the updater as it downloads. */
export interface FoundUpdate {
  readonly version: string;
  download(): Promise<void>;
  /** Replaces the app with the downloaded version; the app then has to be started again. */
  install(): Promise<void>;
  /** Lets go of an update that won't be installed. */
  close(): Promise<void>;
}

export interface UpdateSource {
  availability(): Promise<Availability>;
  /** A newer release, or null when there is none. */
  check(): Promise<FoundUpdate | null>;
}

/** What a check asked for (Check for Updates…) found. */
export type CheckResult =
  | { kind: 'up-to-date' }
  | { kind: 'downloading'; version: string }
  | { kind: 'ready'; version: string }
  | { kind: 'failed' }
  | { kind: 'unavailable'; reason: Unavailable };

export interface Updates {
  readonly state: UpdateState;
  /** Calls `listener` with each new state; returns a function that stops it. */
  subscribe(listener: (state: UpdateState) => void): () => void;
  /** Turns the automatic checks on, the first soon, or off. */
  setAutomatic(on: boolean): void;
  /** Checks now, and puts the next automatic check a full interval away. */
  checkNow(): Promise<CheckResult>;
  /**
   * Installs the update that is ready, once; the caller then starts the app again. Should a Cancel
   * stop the restart after that, the next restart goes on from there.
   */
  install(): Promise<void>;
  stop(): void;
}

/** The first automatic check, after the app has started. */
export const FIRST_CHECK_MS = 10 * 1000;
/** Between automatic checks. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** After a check or a download that failed, offline say. */
export const RETRY_MS = 60 * 60 * 1000;

const IDLE: UpdateState = { phase: 'idle', version: null };

export function createUpdates(source: UpdateSource): Updates {
  let state = IDLE;
  const listeners = new Set<(state: UpdateState) => void>();
  let automatic = false;
  let stopped = false;
  // Known after a check: this copy can't update itself, so there is nothing to check for.
  let unavailable = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<CheckResult> | null = null;
  let ready: FoundUpdate | null = null;
  let installed = false;

  const set = (next: UpdateState) => {
    if (stopped) return;
    state = next;
    for (const listener of listeners) listener(state);
  };

  /** Puts the next automatic check `ms` away, when there should be one. */
  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = undefined;
    if (!automatic || stopped || unavailable || state.phase !== 'idle') return;
    timer = setTimeout(() => {
      timer = undefined;
      void check();
    }, ms);
  };

  const fail = (what: string, error: unknown) => {
    console.warn(`Could not ${what}; Redlines will try again later`, error);
    set(IDLE);
    schedule(RETRY_MS);
  };

  async function download(update: FoundUpdate): Promise<void> {
    try {
      await update.download();
    } catch (error) {
      void update.close().catch(() => {});
      fail('download the update', error);
      return;
    }
    ready = update;
    set({ phase: 'ready', version: update.version });
  }

  function check(): Promise<CheckResult> {
    running ??= (async (): Promise<CheckResult> => {
      clearTimeout(timer);
      timer = undefined;
      try {
        const availability = await source.availability();
        if (availability !== 'available') {
          unavailable = true;
          return { kind: 'unavailable', reason: availability };
        }
        unavailable = false;
        set({ phase: 'checking', version: null });
        const update = await source.check();
        if (!update) {
          set(IDLE);
          schedule(CHECK_INTERVAL_MS);
          return { kind: 'up-to-date' };
        }
        set({ phase: 'downloading', version: update.version });
        void download(update);
        return { kind: 'downloading', version: update.version };
      } catch (error) {
        fail('check for updates', error);
        return { kind: 'failed' };
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setAutomatic(on) {
      automatic = on;
      if (!on) {
        clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined && running === null) {
        schedule(FIRST_CHECK_MS);
      }
    },
    checkNow() {
      const { phase, version } = state;
      if (phase === 'ready' && version !== null) return Promise.resolve({ kind: 'ready', version });
      if (phase === 'downloading' && version !== null) {
        return Promise.resolve({ kind: 'downloading', version });
      }
      return check();
    },
    async install() {
      const update = ready;
      if (state.phase !== 'ready' || update === null) throw new Error('No update is ready');
      if (installed) return;
      try {
        await update.install();
        installed = true;
      } catch (error) {
        ready = null;
        fail('install the update', error);
        throw error;
      }
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
