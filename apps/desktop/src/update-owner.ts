// One window checks for updates for the whole app (#62). Each window has a page of its own, so
// without this each would check, download and tell of the same update. The app names an owner, the
// first window to join (src-tauri/src/update_owner.rs): it alone runs the updates (updates.ts),
// and says what they are doing. Every other window shows what it says, and asks it when the person
// checks or restarts from their window, so that a check is the app's one check and an install the
// one install. A card dismissed in one window is dismissed in all. When the owner closes, the
// window that joined after it takes over, and starts afresh: what it had downloaded went with it.

import type { CheckResult, Updates, UpdateState } from './updates.ts';

/** What a window asks the owner to do: Check for Updates…, or install for Restart to update. */
export type AskWhat = 'check' | 'install';

/** How the owner answered: what a check found, or why it failed. */
export type AskAnswer = { outcome: 'done'; value: unknown } | { outcome: 'failed'; error: string };

/** What the app sends a window (`Message` in update_owner.rs). */
export type UpdateMessage =
  /** This window is the owner now. */
  | { kind: 'own' }
  /** What the owner's updates are doing. */
  | { kind: 'state'; state: UpdateState }
  /** The card of the update `version` was dismissed in another window. */
  | { kind: 'dismissed'; version: string }
  /** To the owner: a window asks it something, to be answered under `id`. */
  | { kind: 'ask'; id: number; what: AskWhat }
  /** To a window that asked: the owner's answer, under the window's own `id`. */
  | { kind: 'answer'; id: number; answer: AskAnswer };

/** What a window learns as it joins. */
export interface Joined {
  owner: boolean;
  state: UpdateState;
  /** The version whose card was dismissed, if one was. */
  dismissed: string | null;
}

/** What a window needs of the app for the updates; update-source.ts has the app's. */
export interface UpdateLink {
  /** Calls `handler` with each message the app sends this window. */
  listen(handler: (message: UpdateMessage) => void): Promise<unknown>;
  /** Takes part in the updates, and learns whether this window is the owner. */
  join(): Promise<Joined>;
  /** As the owner, tells the other windows what the updates are doing. */
  report(state: UpdateState): Promise<void>;
  /** Asks the owner; the answer comes as a message, under this `id`. */
  ask(id: number, what: AskWhat): Promise<void>;
  /** As the owner, answers the ask `id`. */
  answer(id: number, answer: AskAnswer): Promise<void>;
  /** The card of the update `version` was dismissed here. */
  dismiss(version: string): Promise<void>;
}

/** The updates as a window sees them: the app's one check, download and install. */
export interface SharedUpdates extends Updates {
  /** The version whose card was dismissed, in this window or another, or null. */
  readonly dismissed: string | null;
  /** Dismisses the card of the update `version` in every window. */
  dismiss(version: string): void;
  /** Calls `listener` when another window dismisses the card; returns a function that stops it. */
  onDismissed(listener: (version: string) => void): () => void;
}

const IDLE: UpdateState = { phase: 'idle', version: null };

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * This window's share of the app's updates. `create` makes the updates themselves, and is called
 * only when this window becomes the owner.
 */
export function shareUpdates(link: UpdateLink, create: () => Updates): SharedUpdates {
  let state = IDLE;
  let dismissed: string | null = null;
  let automatic = false;
  let stopped = false;
  /** The updates themselves, once this window is the owner. */
  let own: Updates | null = null;
  // Heard while joining: newer than what the join says.
  let heardState = false;
  let heardDismissed = false;
  const listeners = new Set<(state: UpdateState) => void>();
  const dismissListeners = new Set<(version: string) => void>();
  let lastAsk = 0;
  const asks = new Map<number, (answer: AskAnswer) => void>();

  const set = (next: UpdateState) => {
    if (stopped) return;
    state = next;
    for (const listener of listeners) listener(state);
  };

  const warn = (what: string) => (error: unknown) => {
    console.warn(`Could not ${what}`, error);
  };

  const becomeOwner = () => {
    if (own || stopped) return;
    const updates = create();
    own = updates;
    updates.subscribe((next) => {
      set(next);
      link.report(next).catch(warn('tell the other windows what the updates are doing'));
    });
    set(updates.state);
    updates.setAutomatic(automatic);
  };

  const answerAsk = async (id: number, what: AskWhat) => {
    let answer: AskAnswer;
    try {
      if (!own) throw new Error('This window doesn’t check for updates');
      const value = what === 'check' ? await own.checkNow() : await own.install().then(() => null);
      answer = { outcome: 'done', value };
    } catch (error) {
      answer = { outcome: 'failed', error: reason(error) };
    }
    await link.answer(id, answer);
  };

  const hear = (message: UpdateMessage) => {
    switch (message.kind) {
      case 'own':
        becomeOwner();
        return;
      case 'state':
        heardState = true;
        // The owner's own updates say it first.
        if (!own) set(message.state);
        return;
      case 'dismissed':
        heardDismissed = true;
        dismissed = message.version;
        for (const listener of dismissListeners) listener(message.version);
        return;
      case 'ask':
        answerAsk(message.id, message.what).catch(warn('answer another window about updates'));
        return;
      case 'answer': {
        const settle = asks.get(message.id);
        asks.delete(message.id);
        settle?.(message.answer);
        return;
      }
    }
  };

  // Listening first, so that nothing sent once the app knows of this window is missed.
  const joined = (async () => {
    await link.listen(hear);
    const answer = await link.join();
    if (!heardDismissed) dismissed = answer.dismissed;
    if (answer.owner) becomeOwner();
    else if (!heardState && !own) set(answer.state);
  })().catch((error: unknown) => {
    // Alone, the window checks for itself, as every window did before there was an owner.
    console.error('Could not join the other windows for updates, so this one checks itself', error);
    becomeOwner();
  });

  const ask = (what: AskWhat) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++lastAsk;
      asks.set(id, (answer) => {
        if (answer.outcome === 'done') resolve(answer.value);
        else reject(new Error(answer.error));
      });
      link.ask(id, what).catch((error: unknown) => {
        asks.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

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
    setAutomatic(on) {
      automatic = on;
      own?.setAutomatic(on);
    },
    async checkNow() {
      await joined;
      if (own) return own.checkNow();
      try {
        return (await ask('check')) as CheckResult;
      } catch (error) {
        warn('check for updates')(error);
        return { kind: 'failed' };
      }
    },
    async install() {
      await joined;
      if (own) return own.install();
      await ask('install');
    },
    dismiss(version) {
      dismissed = version;
      link.dismiss(version).catch(warn('dismiss the update in the other windows'));
    },
    onDismissed(listener) {
      dismissListeners.add(listener);
      return () => dismissListeners.delete(listener);
    },
    stop() {
      stopped = true;
      own?.stop();
    },
  };
}
