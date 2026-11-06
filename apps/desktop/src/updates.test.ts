import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_INTERVAL_MS,
  createUpdates,
  FIRST_CHECK_MS,
  RETRY_MS,
  type Availability,
  type FoundUpdate,
  type UpdateSource,
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

function found(version = '0.2.0') {
  return {
    version,
    download: vi.fn(() => Promise.resolve()),
    install: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  } satisfies FoundUpdate;
}

/** An update server with nothing new, until the test says otherwise. */
function source(availability: Availability = 'available') {
  return {
    availability: vi.fn((): Promise<Availability> => Promise.resolve(availability)),
    check: vi.fn((): Promise<FoundUpdate | null> => Promise.resolve(null)),
  } satisfies UpdateSource;
}

function watch(updates: { subscribe(listener: (state: UpdateState) => void): () => void }) {
  const seen: string[] = [];
  updates.subscribe((state) =>
    seen.push(state.version ? `${state.phase} ${state.version}` : state.phase),
  );
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('updates', () => {
  it('check soon after launch, then every few hours', async () => {
    const server = source();
    const updates = createUpdates(server);
    expect(updates.state).toEqual({ phase: 'idle', version: null });
    updates.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS - 1);
    expect(server.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(server.check).toHaveBeenCalledOnce();
    expect(updates.state.phase).toBe('idle');
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(server.check).toHaveBeenCalledTimes(2);
    expect(CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it('go from idle to checking, downloading and ready, and stop checking', async () => {
    const server = source();
    const update = found('0.2.0');
    server.check.mockResolvedValue(update);
    const updates = createUpdates(server);
    const seen = watch(updates);
    updates.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(seen).toEqual(['checking', 'downloading 0.2.0', 'ready 0.2.0']);
    expect(update.download).toHaveBeenCalledOnce();
    // The downloaded update waits for the restart: no more checks.
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(server.check).toHaveBeenCalledOnce();
  });

  it('keep failures quiet and try again later', async () => {
    const server = source();
    server.check.mockRejectedValueOnce(new Error('offline'));
    const updates = createUpdates(server);
    const seen = watch(updates);
    updates.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(seen).toEqual(['checking', 'idle']);
    expect(console.warn).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1);
    expect(server.check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(server.check).toHaveBeenCalledTimes(2);
    expect(RETRY_MS).toBeLessThan(CHECK_INTERVAL_MS);
  });

  it('let go of a download that fails, and try again later', async () => {
    const server = source();
    const broken = found('0.2.0');
    broken.download.mockRejectedValueOnce(new Error('connection reset'));
    server.check.mockResolvedValueOnce(broken).mockResolvedValueOnce(found('0.2.0'));
    const updates = createUpdates(server);
    const seen = watch(updates);
    updates.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(seen).toEqual(['checking', 'downloading 0.2.0', 'idle']);
    expect(broken.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(updates.state).toEqual({ phase: 'ready', version: '0.2.0' });
  });

  it('stop checking when automatic checks are turned off, and check soon when on again', async () => {
    const server = source();
    const updates = createUpdates(server);
    updates.setAutomatic(true);
    updates.setAutomatic(false);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(server.check).not.toHaveBeenCalled();
    updates.setAutomatic(true);
    // Turning it on twice doesn't put the check off.
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS - 1);
    updates.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.check).toHaveBeenCalledOnce();
  });

  it('never check from a copy that cannot update itself, and say why when asked', async () => {
    const server = source('disk-image');
    const updates = createUpdates(server);
    const seen = watch(updates);
    updates.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(server.availability).toHaveBeenCalledOnce();
    expect(server.check).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    expect(await updates.checkNow()).toEqual({ kind: 'unavailable', reason: 'disk-image' });
    expect(server.check).not.toHaveBeenCalled();
  });

  it('check now and say what they found', async () => {
    const server = source();
    const updates = createUpdates(server);
    expect(await updates.checkNow()).toEqual({ kind: 'up-to-date' });

    server.check.mockRejectedValueOnce(new Error('offline'));
    expect(await updates.checkNow()).toEqual({ kind: 'failed' });

    const update = found('0.3.0');
    const download = deferred<void>();
    update.download.mockReturnValue(download.promise);
    server.check.mockResolvedValue(update);
    expect(await updates.checkNow()).toEqual({ kind: 'downloading', version: '0.3.0' });
    expect(await updates.checkNow()).toEqual({ kind: 'downloading', version: '0.3.0' });
    download.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(await updates.checkNow()).toEqual({ kind: 'ready', version: '0.3.0' });
    expect(server.check).toHaveBeenCalledTimes(3);
  });

  it('wait for the check under way instead of starting another', async () => {
    const server = source();
    const answer = deferred<FoundUpdate | null>();
    server.check.mockReturnValue(answer.promise);
    const updates = createUpdates(server);
    updates.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(updates.state.phase).toBe('checking');
    const asked = updates.checkNow();
    answer.resolve(null);
    expect(await asked).toEqual({ kind: 'up-to-date' });
    expect(server.check).toHaveBeenCalledOnce();
  });

  it('put the next automatic check a full interval after one asked for', async () => {
    const server = source();
    const updates = createUpdates(server);
    updates.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS / 2);
    await updates.checkNow();
    expect(server.check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1);
    expect(server.check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.check).toHaveBeenCalledTimes(3);
  });

  it('install the update that is ready, and only that', async () => {
    const server = source();
    const updates = createUpdates(server);
    await expect(updates.install()).rejects.toThrow();
    const update = found('0.2.0');
    server.check.mockResolvedValue(update);
    await updates.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    await updates.install();
    expect(update.install).toHaveBeenCalledOnce();
  });

  it('install once: a restart that a Cancel stopped goes on from there the next time', async () => {
    // The updater has let go of the download by then, and installing again would fail.
    const update = found();
    const server = source();
    server.check.mockResolvedValue(update);
    const updates = createUpdates(server);
    await updates.checkNow();
    await vi.waitFor(() => expect(updates.state.phase).toBe('ready'));
    await updates.install();
    await updates.install();
    expect(update.install).toHaveBeenCalledOnce();
  });

  it('install once when two windows ask at the same time', async () => {
    // Restart to update, chosen in two windows at once: the update replaces the app once.
    const update = found();
    const installing = deferred<void>();
    update.install.mockReturnValue(installing.promise);
    const server = source();
    server.check.mockResolvedValue(update);
    const updates = createUpdates(server);
    await updates.checkNow();
    await vi.waitFor(() => expect(updates.state.phase).toBe('ready'));
    const first = updates.install();
    const second = updates.install();
    installing.resolve();
    await Promise.all([first, second]);
    expect(update.install).toHaveBeenCalledOnce();
  });

  it('tell each window that asked at the same time when installing fails', async () => {
    const update = found();
    update.install.mockRejectedValueOnce(new Error('permission denied'));
    const server = source();
    server.check.mockResolvedValue(update);
    const updates = createUpdates(server);
    await updates.checkNow();
    await vi.waitFor(() => expect(updates.state.phase).toBe('ready'));
    const results = await Promise.allSettled([updates.install(), updates.install()]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(update.install).toHaveBeenCalledOnce();
  });

  it('install the next update after one whose install threw at once', async () => {
    // An install that throws before it returns a promise mustn't stay as the answer to the next.
    const broken = found('0.2.0');
    broken.install.mockImplementationOnce(() => {
      throw new Error('no bytes');
    });
    const next = found('0.2.0');
    const server = source();
    server.check.mockResolvedValueOnce(broken).mockResolvedValueOnce(next);
    const updates = createUpdates(server);
    await updates.checkNow();
    await vi.waitFor(() => expect(updates.state.phase).toBe('ready'));
    await expect(updates.install()).rejects.toThrow('no bytes');
    await updates.checkNow();
    await vi.waitFor(() => expect(updates.state.phase).toBe('ready'));
    await updates.install();
    expect(next.install).toHaveBeenCalledOnce();
  });

  it('go back to checking later when installing fails', async () => {
    const server = source();
    const update = found('0.2.0');
    update.install.mockRejectedValueOnce(new Error('permission denied'));
    server.check.mockResolvedValueOnce(update);
    const updates = createUpdates(server);
    updates.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    await expect(updates.install()).rejects.toThrow('permission denied');
    expect(updates.state).toEqual({ phase: 'idle', version: null });
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(server.check).toHaveBeenCalledTimes(2);
  });

  it('stop for good', async () => {
    const server = source();
    const updates = createUpdates(server);
    const seen = watch(updates);
    updates.setAutomatic(true);
    updates.stop();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(server.check).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});
