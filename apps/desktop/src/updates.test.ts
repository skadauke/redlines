import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  windowUpdates,
  type CheckResult,
  type UpdateLink,
  type UpdateMessage,
  type UpdateSnapshot,
  type UpdateState,
} from './updates.ts';

/** A promise and the functions that settle it, for steps the test lets finish when it wants. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const IDLE: UpdateState = { phase: 'idle', version: null };

/** The app's side, as the test says: nothing under way and nothing dismissed, at first. */
function fakeLink(snapshot: UpdateSnapshot = { state: IDLE, dismissed: null }) {
  let hear: ((message: UpdateMessage) => void) | null = null;
  const order: string[] = [];
  const link = {
    listen: vi.fn((handler: (message: UpdateMessage) => void) => {
      order.push('listen');
      hear = handler;
      return Promise.resolve();
    }),
    read: vi.fn(() => {
      order.push('read');
      return Promise.resolve(snapshot);
    }),
    check: vi.fn((): Promise<CheckResult> => Promise.resolve({ kind: 'up-to-date' })),
    install: vi.fn(() => Promise.resolve()),
    dismiss: vi.fn(() => Promise.resolve()),
    setAutomatic: vi.fn(() => Promise.resolve()),
  } satisfies UpdateLink;
  return {
    link,
    order,
    /** The app tells every window. */
    tell: (message: UpdateMessage) => hear?.(message),
  };
}

function watch(updates: { subscribe(listener: (state: UpdateState) => void): () => void }) {
  const seen: string[] = [];
  updates.subscribe((state) =>
    seen.push(state.version ? `${state.phase} ${state.version}` : state.phase),
  );
  return seen;
}

/** Lets the window read what the updates are doing, and whatever else is under way. */
const started = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a window’s updates', () => {
  it('listen before they read, so that they miss nothing', async () => {
    const { link, order } = fakeLink();
    windowUpdates(link);
    await vi.waitFor(() => expect(order).toEqual(['listen', 'read']));
  });

  it('show what the app says the updates are doing', async () => {
    const { link, tell } = fakeLink();
    const updates = windowUpdates(link);
    const seen = watch(updates);
    await started();
    tell({ kind: 'state', state: { phase: 'checking', version: null } });
    tell({ kind: 'state', state: { phase: 'downloading', version: '0.2.0' } });
    tell({ kind: 'state', state: { phase: 'ready', version: '0.2.0' } });
    expect(seen).toEqual(['idle', 'checking', 'downloading 0.2.0', 'ready 0.2.0']);
    expect(updates.state).toEqual({ phase: 'ready', version: '0.2.0' });
  });

  it('show the update that is ready in a window that opens later', async () => {
    // The app holds the download: a window that opened after it finished has it at once.
    const { link } = fakeLink({ state: { phase: 'ready', version: '0.2.0' }, dismissed: null });
    const updates = windowUpdates(link);
    const seen = watch(updates);
    await vi.waitFor(() => expect(seen).toEqual(['ready 0.2.0']));
  });

  it('keep what they heard while reading over what the read says', async () => {
    const read = deferred<UpdateSnapshot>();
    const { link, tell } = fakeLink();
    link.read.mockReturnValue(read.promise);
    const updates = windowUpdates(link);
    await vi.waitFor(() => expect(link.read).toHaveBeenCalled());
    tell({ kind: 'state', state: { phase: 'ready', version: '0.3.0' } });
    tell({ kind: 'dismissed', version: '0.3.0' });
    read.resolve({ state: { phase: 'downloading', version: '0.3.0' }, dismissed: '0.2.0' });
    await started();
    expect(updates.state).toEqual({ phase: 'ready', version: '0.3.0' });
    expect(updates.dismissed).toBe('0.3.0');
  });

  it('learn of a card dismissed before the window began before they show the update', async () => {
    const { link } = fakeLink({ state: { phase: 'ready', version: '0.2.0' }, dismissed: '0.2.0' });
    const updates = windowUpdates(link);
    const order: string[] = [];
    updates.onDismissed((version) => order.push(`dismissed ${version}`));
    updates.subscribe((state) => order.push(`${state.phase} ${updates.dismissed}`));
    await vi.waitFor(() => expect(order).toEqual(['dismissed 0.2.0', 'ready 0.2.0']));
  });

  it('tell no one of a dismissal when none was', async () => {
    const { link } = fakeLink();
    const updates = windowUpdates(link);
    const dismissed = vi.fn();
    updates.onDismissed(dismissed);
    await started();
    expect(dismissed).not.toHaveBeenCalled();
    expect(updates.dismissed).toBeNull();
  });

  it('dismiss the card in every window through the app', async () => {
    const { link, tell } = fakeLink();
    const updates = windowUpdates(link);
    const dismissed = vi.fn();
    updates.onDismissed(dismissed);
    await started();
    updates.dismiss('0.2.0');
    expect(link.dismiss).toHaveBeenCalledWith('0.2.0');
    expect(updates.dismissed).toBe('0.2.0');
    // The app tells every window, this one too: nothing new here.
    tell({ kind: 'dismissed', version: '0.2.0' });
    expect(dismissed).not.toHaveBeenCalled();
  });

  it('hear of a card dismissed in another window', async () => {
    const { link, tell } = fakeLink();
    const updates = windowUpdates(link);
    const dismissed = vi.fn();
    updates.onDismissed(dismissed);
    await started();
    tell({ kind: 'dismissed', version: '0.2.0' });
    expect(dismissed).toHaveBeenCalledWith('0.2.0');
    expect(updates.dismissed).toBe('0.2.0');
  });

  it('ask the app to check, and say what it found', async () => {
    const { link } = fakeLink();
    const updates = windowUpdates(link);
    link.check.mockResolvedValueOnce({ kind: 'downloading', version: '0.2.0' });
    expect(await updates.checkNow()).toEqual({ kind: 'downloading', version: '0.2.0' });
    // An app that can't be asked is a check that failed.
    link.check.mockRejectedValueOnce(new Error('no app'));
    expect(await updates.checkNow()).toEqual({ kind: 'failed' });
    expect(console.warn).toHaveBeenCalled();
  });

  it('ask the app to install, and hear when that fails', async () => {
    const { link } = fakeLink();
    const updates = windowUpdates(link);
    await updates.install();
    expect(link.install).toHaveBeenCalledOnce();
    link.install.mockRejectedValueOnce('No update is ready.');
    await expect(updates.install()).rejects.toBe('No update is ready.');
  });

  it('tell the app whether the automatic checks are on', async () => {
    const { link } = fakeLink();
    const updates = windowUpdates(link);
    updates.setAutomatic(true);
    updates.setAutomatic(false);
    expect(link.setAutomatic.mock.calls).toEqual([[true], [false]]);
    // Quietly, when the app can't be told.
    link.setAutomatic.mockRejectedValueOnce(new Error('no app'));
    updates.setAutomatic(true);
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
  });

  it('stay idle, quietly, when the app can’t be read', async () => {
    const { link } = fakeLink();
    link.read.mockRejectedValue(new Error('no app'));
    const updates = windowUpdates(link);
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(updates.state).toEqual(IDLE);
  });
});
