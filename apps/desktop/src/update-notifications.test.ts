// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotifications, PASSING_MS } from './ui/notifications.ts';
import { presentUpdates, unavailableText } from './update-notifications.ts';
import type { CheckResult, Unavailable, Updates, UpdateState } from './updates.ts';

/** Updates whose state and answers the test sets. */
function fakeUpdates() {
  const listeners = new Set<(state: UpdateState) => void>();
  let state: UpdateState = { phase: 'idle', version: null };
  const updates = {
    get state() {
      return state;
    },
    subscribe: (listener: (state: UpdateState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setAutomatic: vi.fn(),
    checkNow: vi.fn((): Promise<CheckResult> => Promise.resolve({ kind: 'up-to-date' })),
    install: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
  } satisfies Updates;
  return {
    updates,
    become: (next: UpdateState) => {
      state = next;
      for (const listener of listeners) listener(next);
    },
  };
}

function setup() {
  const { updates, become } = fakeUpdates();
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
  return { updates, become, restart, presented, texts, button };
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
