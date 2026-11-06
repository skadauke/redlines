// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotifications, PASSING_MS } from './ui/notifications.ts';
import { presentUpdates, unavailableText } from './update-notifications.ts';
import type { SharedUpdates } from './update-owner.ts';
import type { CheckResult, Unavailable, UpdateState } from './updates.ts';

/** Updates whose state and answers the test sets, shared with windows the test speaks for. */
function fakeUpdates() {
  const listeners = new Set<(state: UpdateState) => void>();
  const dismissListeners = new Set<(version: string) => void>();
  let state: UpdateState = { phase: 'idle', version: null };
  let dismissed: string | null = null;
  const updates = {
    get state() {
      return state;
    },
    get dismissed() {
      return dismissed;
    },
    subscribe: (listener: (state: UpdateState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setAutomatic: vi.fn(),
    checkNow: vi.fn((): Promise<CheckResult> => Promise.resolve({ kind: 'up-to-date' })),
    install: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    dismiss: vi.fn((version: string) => {
      dismissed = version;
    }),
    onDismissed: (listener: (version: string) => void) => {
      dismissListeners.add(listener);
      return () => dismissListeners.delete(listener);
    },
  } satisfies SharedUpdates;
  return {
    updates,
    become: (next: UpdateState) => {
      state = next;
      for (const listener of listeners) listener(next);
    },
    /** The card is dismissed in another window. */
    dismissedElsewhere: (version: string) => {
      dismissed = version;
      for (const listener of dismissListeners) listener(version);
    },
  };
}

function setup() {
  const { updates, become, dismissedElsewhere } = fakeUpdates();
  const notifications = createNotifications(document.body);
  const restart = vi.fn(() => Promise.resolve(true));
  const presented = presentUpdates({ updates, notifications, restart });
  const cards = () => [...document.querySelectorAll<HTMLElement>('.rl-notification')];
  const texts = () =>
    cards().map((card) => card.querySelector('.rl-notification-text')?.textContent);
  const button = (label: string) => {
    const found = [...document.querySelectorAll('.rl-notification button')].find(
      (b) => b.textContent === label,
    );
    if (!(found instanceof HTMLButtonElement)) throw new Error(`no ${label} button`);
    return found;
  };
  return { updates, become, dismissedElsewhere, restart, presented, texts, button };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('update notifications', () => {
  it('say nothing while checking and downloading', () => {
    const { become, texts } = setup();
    become({ phase: 'checking', version: null });
    become({ phase: 'downloading', version: '0.2.0' });
    become({ phase: 'idle', version: null });
    expect(texts()).toEqual([]);
  });

  it('offer Restart to update, or Later, once an update is ready', () => {
    const { become, texts, button } = setup();
    become({ phase: 'ready', version: '0.2.0' });
    expect(texts()).toEqual(['Redlines 0.2.0 is ready to install.']);
    expect(button('Restart to update')).toBeTruthy();
    button('Later').click();
    expect(texts()).toEqual([]);
    // It stays dismissed until asked for again.
    vi.advanceTimersByTime(PASSING_MS * 10);
    expect(texts()).toEqual([]);
  });

  it('restart into the new version from the card', async () => {
    const { become, restart, button } = setup();
    become({ phase: 'ready', version: '0.2.0' });
    button('Restart to update').click();
    expect(button('Restart to update').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(restart).toHaveBeenCalledOnce();
  });

  it('keep the card when the restart is called off at the question about unsaved edits', async () => {
    const { become, restart, texts, button } = setup();
    restart.mockResolvedValueOnce(false);
    become({ phase: 'ready', version: '0.2.0' });
    button('Restart to update').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(texts()).toEqual(['Redlines 0.2.0 is ready to install.']);
    expect(button('Restart to update').disabled).toBe(false);
  });

  it('say briefly when the update could not be installed', async () => {
    const { become, restart, texts, button } = setup();
    restart.mockRejectedValueOnce(new Error('permission denied'));
    become({ phase: 'ready', version: '0.2.0' });
    button('Restart to update').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(texts()).toEqual(['Redlines couldn’t update itself. It will try again later.']);
    await vi.advanceTimersByTimeAsync(PASSING_MS);
    expect(texts()).toEqual([]);
  });

  it('answer Check for Updates… in a card that passes by', async () => {
    const { updates, presented, texts } = setup();
    const answers: [CheckResult, string][] = [
      [{ kind: 'up-to-date' }, 'Redlines is up to date.'],
      [{ kind: 'downloading', version: '0.2.0' }, 'Downloading Redlines 0.2.0…'],
      [{ kind: 'failed' }, 'Redlines couldn’t check for updates. Try again later.'],
      [{ kind: 'unavailable', reason: 'disk-image' }, unavailableText('disk-image')],
    ];
    for (const [result, text] of answers) {
      updates.checkNow.mockResolvedValueOnce(result);
      await presented.checkForUpdates();
      // One answer at a time: each replaces the one before.
      expect(texts()).toEqual([text]);
    }
    await vi.advanceTimersByTimeAsync(PASSING_MS);
    expect(texts()).toEqual([]);
  });

  it('show the ready update again when asked, after Later', async () => {
    const { updates, become, presented, texts, button } = setup();
    become({ phase: 'ready', version: '0.2.0' });
    button('Later').click();
    updates.checkNow.mockResolvedValueOnce({ kind: 'ready', version: '0.2.0' });
    await presented.checkForUpdates();
    expect(texts()).toEqual(['Redlines 0.2.0 is ready to install.']);
    // It waits to be handled.
    await vi.advanceTimersByTimeAsync(PASSING_MS * 10);
    expect(texts()).toEqual(['Redlines 0.2.0 is ready to install.']);
  });

  it('replace the download’s card with the ready one', async () => {
    const { updates, become, presented, texts } = setup();
    updates.checkNow.mockResolvedValueOnce({ kind: 'downloading', version: '0.2.0' });
    await presented.checkForUpdates();
    become({ phase: 'ready', version: '0.2.0' });
    expect(texts()).toEqual(['Redlines 0.2.0 is ready to install.']);
  });

  it('dismiss the card in every window when Later is chosen in this one', () => {
    const { updates, become, button } = setup();
    become({ phase: 'ready', version: '0.2.0' });
    button('Later').click();
    expect(updates.dismiss).toHaveBeenCalledWith('0.2.0');
  });

  it('take the card away when it is dismissed in another window', () => {
    const { become, dismissedElsewhere, texts } = setup();
    become({ phase: 'ready', version: '0.2.0' });
    dismissedElsewhere('0.2.0');
    expect(texts()).toEqual([]);
  });

  it('leave an answer in this window when the card is dismissed in another', async () => {
    const { dismissedElsewhere, presented, texts } = setup();
    await presented.checkForUpdates();
    dismissedElsewhere('0.2.0');
    expect(texts()).toEqual(['Redlines is up to date.']);
  });

  it('not offer again an update whose card was dismissed, but offer a newer one', () => {
    // The owner that took over downloaded it again, or this window opened after Later.
    const { become, dismissedElsewhere, texts } = setup();
    dismissedElsewhere('0.2.0');
    become({ phase: 'ready', version: '0.2.0' });
    expect(texts()).toEqual([]);
    become({ phase: 'idle', version: null });
    become({ phase: 'ready', version: '0.3.0' });
    expect(texts()).toEqual(['Redlines 0.3.0 is ready to install.']);
  });

  it('take the card away when the update is no longer ready', () => {
    // The window that downloaded it closed, and with it the download.
    const { become, texts } = setup();
    become({ phase: 'ready', version: '0.2.0' });
    become({ phase: 'idle', version: null });
    expect(texts()).toEqual([]);
  });

  it('say why a copy can’t update itself', () => {
    const reasons: Unavailable[] = [
      'development',
      'not-set-up',
      'disk-image',
      'read-only',
      'unsupported',
    ];
    const texts = reasons.map(unavailableText);
    expect(new Set(texts).size).toBe(reasons.length);
    expect(unavailableText('disk-image')).toMatch(/Applications folder/);
    expect(unavailableText('development')).toMatch(/development build/);
  });
});
