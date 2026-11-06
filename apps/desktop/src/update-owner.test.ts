import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_CHECK_MS,
  ASK_INSTALL_MS,
  shareUpdates,
  type Joined,
  type SharedUpdates,
  type UpdateLink,
  type UpdateMessage,
} from './update-owner.ts';
import {
  CHECK_INTERVAL_MS,
  CHECK_TIMEOUT_MS,
  createUpdates,
  FIRST_CHECK_MS,
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

/** The one update server every window reaches, with nothing new until the test says otherwise. */
function source(availability: Availability = 'available') {
  return {
    availability: vi.fn((): Promise<Availability> => Promise.resolve(availability)),
    check: vi.fn((): Promise<FoundUpdate | null> => Promise.resolve(null)),
  } satisfies UpdateSource;
}

const IDLE: UpdateState = { phase: 'idle', version: null };

/**
 * The app's side, by the rules of src-tauri/src/update_owner.rs, whose own tests hold the real one
 * to them: the first window to join is the owner; a window closing, or its page loading again,
 * leaves, and takes its asks with it; when the owner leaves, its asks fail, the next window takes
 * over and every window hears that nothing is under way; only members ask, and only the owner
 * reports and answers, each ask once. Every message reaches its window a moment later.
 *
 * It leaves out: replies to commands and messages crossing on the way (here every reply comes
 * first; the scripted link below sends them in other orders), any check of what a window sends,
 * and the wording of the app's errors.
 */
function app() {
  const members: string[] = [];
  const hearers = new Map<string, (message: UpdateMessage) => void>();
  let state = IDLE;
  let dismissed: string | null = null;
  let lastAsk = 0;
  const asks = new Map<number, [string, number]>();
  const owner = () => members[0];
  const send = (label: string, message: UpdateMessage) => {
    const hear = hearers.get(label);
    if (hear) queueMicrotask(() => hear(message));
  };
  const toOthers = (label: string, message: UpdateMessage) => {
    for (const member of members) if (member !== label) send(member, message);
  };
  const ownerGone = () => {
    for (const [asker, id] of asks.values()) {
      send(asker, { kind: 'answer', id, answer: { outcome: 'failed', error: 'closed' } });
    }
    asks.clear();
    const next = owner();
    if (next !== undefined) send(next, { kind: 'own' });
    if (state.phase !== 'idle') {
      state = IDLE;
      for (const member of members) send(member, { kind: 'state', state });
    }
  };
  const leave = (label: string) => {
    const wasOwner = owner() === label;
    const place = members.indexOf(label);
    if (place >= 0) members.splice(place, 1);
    for (const [number, [asker]] of asks) if (asker === label) asks.delete(number);
    if (wasOwner) ownerGone();
  };

  const link = (label: string): UpdateLink => ({
    listen: (hear) => {
      hearers.set(label, hear);
      return Promise.resolve();
    },
    join: () => {
      // A page that loads again leaves, and joins afresh at the end.
      leave(label);
      members.push(label);
      const joined: Joined = { owner: owner() === label, state, dismissed };
      return Promise.resolve(joined);
    },
    report: (next) => {
      if (owner() !== label) return Promise.reject(new Error('not the owner'));
      state = next;
      toOthers(label, { kind: 'state', state });
      return Promise.resolve();
    },
    ask: (id, what) => {
      const to = owner();
      if (!members.includes(label) || to === undefined) {
        return Promise.reject(new Error('not a member'));
      }
      asks.set(++lastAsk, [label, id]);
      send(to, { kind: 'ask', id: lastAsk, what });
      return Promise.resolve();
    },
    answer: (id, answer) => {
      const asked = asks.get(id);
      if (owner() === label && asked) {
        asks.delete(id);
        send(asked[0], { kind: 'answer', id: asked[1], answer });
      }
      return Promise.resolve();
    },
    dismiss: (version) => {
      dismissed = version;
      toOthers(label, { kind: 'dismissed', version });
      return Promise.resolve();
    },
  });

  return {
    link,
    /** A window closes: Tauri forgets it, and the app hears so. */
    close(label: string) {
      hearers.delete(label);
      leave(label);
    },
  };
}

/** Windows of one app, each with its updates shared, and one update server for them all. */
function windows(labels: string[], server = source()) {
  const shared = app();
  const made: string[] = [];
  const open = (label: string) =>
    shareUpdates(shared.link(label), () => {
      made.push(label);
      return createUpdates(server);
    });
  const all = new Map(labels.map((label) => [label, open(label)]));
  const get = (label: string) => {
    const updates = all.get(label);
    if (!updates) throw new Error(`no window ${label}`);
    return updates;
  };
  return {
    server,
    get,
    /** Which windows made the updates they own, in turn. */
    made,
    open(label: string) {
      const updates = open(label);
      all.set(label, updates);
      return updates;
    },
    close(label: string) {
      get(label).stop();
      all.delete(label);
      shared.close(label);
    },
    /** The window's page loads again: the old page is gone, and a new one starts. */
    reload(label: string) {
      get(label).stop();
      return this.open(label);
    },
    /** Each window, on starting, turns the automatic checks on or off as Preferences say. */
    setAutomatic(on: boolean) {
      for (const updates of all.values()) updates.setAutomatic(on);
    },
    states: () => [...all.values()].map((updates) => updates.state),
  };
}

function watch(updates: SharedUpdates) {
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

describe('one owner of the updates', () => {
  it('check once for the whole app, with three windows', async () => {
    const app = windows(['main', 'doc-1', 'doc-2']);
    await vi.advanceTimersByTimeAsync(0);
    app.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(app.server.check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(app.server.check).toHaveBeenCalledTimes(2);
    // Only the first window made updates of its own.
    expect(app.made).toEqual(['main']);
  });

  it('download once, and show every window the same state', async () => {
    const app = windows(['main', 'doc-1', 'doc-2']);
    const update = found('0.2.0');
    app.server.check.mockResolvedValue(update);
    const seen = ['main', 'doc-1', 'doc-2'].map((label) => watch(app.get(label)));
    await vi.advanceTimersByTimeAsync(0);
    app.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(update.download).toHaveBeenCalledOnce();
    expect(app.states()).toEqual([
      { phase: 'ready', version: '0.2.0' },
      { phase: 'ready', version: '0.2.0' },
      { phase: 'ready', version: '0.2.0' },
    ]);
    for (const each of seen) expect(each.at(-1)).toBe('ready 0.2.0');
  });

  it('let a window that opens later show the update that is ready', async () => {
    const app = windows(['main']);
    app.server.check.mockResolvedValue(found('0.2.0'));
    await vi.advanceTimersByTimeAsync(0);
    await app.get('main').checkNow();
    await vi.advanceTimersByTimeAsync(0);
    const later = app.open('doc-1');
    const seen = watch(later);
    await vi.advanceTimersByTimeAsync(0);
    expect(later.state).toEqual({ phase: 'ready', version: '0.2.0' });
    expect(seen).toEqual(['ready 0.2.0']);
    expect(app.server.check).toHaveBeenCalledOnce();
  });

  it('run a check asked from a window that is not the owner, and answer there', async () => {
    const app = windows(['main', 'doc-1', 'doc-2']);
    await vi.advanceTimersByTimeAsync(0);
    app.setAutomatic(true);
    expect(await app.get('doc-2').checkNow()).toEqual({ kind: 'up-to-date' });
    expect(app.server.check).toHaveBeenCalledOnce();
    // It is the app's check: the next automatic one is a full interval away.
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1);
    expect(app.server.check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(app.server.check).toHaveBeenCalledTimes(2);
  });

  it('report the check under way to a window that asks for one', async () => {
    const app = windows(['main', 'doc-1']);
    const answer = deferred<FoundUpdate | null>();
    app.server.check.mockReturnValue(answer.promise);
    await vi.advanceTimersByTimeAsync(0);
    app.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(app.get('doc-1').state.phase).toBe('checking');
    const asked = app.get('doc-1').checkNow();
    await vi.advanceTimersByTimeAsync(0);
    answer.resolve(null);
    expect(await asked).toEqual({ kind: 'up-to-date' });
    expect(app.server.check).toHaveBeenCalledOnce();
  });

  it('say what a download under way or ready is, when asked from any window', async () => {
    const app = windows(['main', 'doc-1']);
    const update = found('0.3.0');
    const download = deferred<void>();
    update.download.mockReturnValue(download.promise);
    app.server.check.mockResolvedValue(update);
    await vi.advanceTimersByTimeAsync(0);
    expect(await app.get('doc-1').checkNow()).toEqual({ kind: 'downloading', version: '0.3.0' });
    expect(await app.get('main').checkNow()).toEqual({ kind: 'downloading', version: '0.3.0' });
    download.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(await app.get('doc-1').checkNow()).toEqual({ kind: 'ready', version: '0.3.0' });
    expect(app.server.check).toHaveBeenCalledOnce();
  });

  it('install the one update once, from whichever windows ask', async () => {
    const app = windows(['main', 'doc-1', 'doc-2']);
    const update = found('0.2.0');
    app.server.check.mockResolvedValue(update);
    await vi.advanceTimersByTimeAsync(0);
    await app.get('main').checkNow();
    await vi.advanceTimersByTimeAsync(0);
    const asked = Promise.all([app.get('doc-1').install(), app.get('doc-2').install()]);
    await vi.advanceTimersByTimeAsync(0);
    await asked;
    expect(update.install).toHaveBeenCalledOnce();
  });

  it('tell a window that asked to install when it fails', async () => {
    const app = windows(['main', 'doc-1']);
    const update = found('0.2.0');
    update.install.mockRejectedValueOnce(new Error('permission denied'));
    app.server.check.mockResolvedValue(update);
    await vi.advanceTimersByTimeAsync(0);
    await app.get('main').checkNow();
    await vi.advanceTimersByTimeAsync(0);
    const asked = app.get('doc-1').install();
    const settled = asked.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(await settled).toEqual(new Error('permission denied'));
    // And every window hears that no update is ready any more.
    expect(app.states()).toEqual([IDLE, IDLE]);
  });

  it('pass the checks on to the next window when the owner closes', async () => {
    const app = windows(['main', 'doc-1', 'doc-2']);
    await vi.advanceTimersByTimeAsync(0);
    app.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(app.server.check).toHaveBeenCalledOnce();
    app.close('main');
    await vi.advanceTimersByTimeAsync(0);
    expect(app.made).toEqual(['main', 'doc-1']);
    // The new owner checks soon, once for the two windows left, and then every few hours.
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(app.server.check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(app.server.check).toHaveBeenCalledTimes(3);
    // And answers the others.
    expect(await app.get('doc-2').checkNow()).toEqual({ kind: 'up-to-date' });
    expect(app.server.check).toHaveBeenCalledTimes(4);
  });

  it('start afresh when the owner closes with an update ready, for its page held the download', async () => {
    const app = windows(['main', 'doc-1']);
    const first = found('0.2.0');
    const again = found('0.2.0');
    app.server.check.mockResolvedValueOnce(first).mockResolvedValueOnce(again);
    await vi.advanceTimersByTimeAsync(0);
    app.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    const seen = watch(app.get('doc-1'));
    app.close('main');
    await vi.advanceTimersByTimeAsync(0);
    expect(app.get('doc-1').state).toEqual(IDLE);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(again.download).toHaveBeenCalledOnce();
    expect(seen).toEqual(['idle', 'checking', 'downloading 0.2.0', 'ready 0.2.0']);
    await app.get('doc-1').install();
    expect(again.install).toHaveBeenCalledOnce();
    expect(first.install).not.toHaveBeenCalled();
  });

  it('hand the checks on when the owner’s page loads again, and mirror them there', async () => {
    const app = windows(['main', 'doc-1']);
    const update = found('0.2.0');
    app.server.check.mockResolvedValue(update);
    await vi.advanceTimersByTimeAsync(0);
    app.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    const main = app.reload('main');
    main.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(app.made).toEqual(['main', 'doc-1']);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(app.states()).toEqual([
      { phase: 'ready', version: '0.2.0' },
      { phase: 'ready', version: '0.2.0' },
    ]);
    expect(app.server.check).toHaveBeenCalledTimes(2);
  });

  it('fail an ask that the owner closed before answering', async () => {
    const app = windows(['main', 'doc-1']);
    app.server.check.mockReturnValue(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(0);
    const asked = app.get('doc-1').checkNow();
    await vi.advanceTimersByTimeAsync(0);
    app.close('main');
    await vi.advanceTimersByTimeAsync(0);
    expect(await asked).toEqual({ kind: 'failed' });
  });

  it('let the Check for Updates setting apply to the app, whichever window owns the checks', async () => {
    const app = windows(['main', 'doc-1']);
    await vi.advanceTimersByTimeAsync(0);
    app.setAutomatic(false);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(app.server.check).not.toHaveBeenCalled();
    // A window that takes over keeps the setting.
    app.close('main');
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(app.server.check).not.toHaveBeenCalled();
    app.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(app.server.check).toHaveBeenCalledOnce();
  });

  it('turn the checks on as a window starts, before it knows whether it owns them', async () => {
    const app = windows(['main']);
    app.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(app.server.check).toHaveBeenCalledOnce();
  });

  it('say from any window why a copy that cannot update itself does not, and never check', async () => {
    const app = windows(['main', 'doc-1'], source('development'));
    await vi.advanceTimersByTimeAsync(0);
    app.setAutomatic(true);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(app.server.check).not.toHaveBeenCalled();
    expect(await app.get('doc-1').checkNow()).toEqual({
      kind: 'unavailable',
      reason: 'development',
    });
    expect(app.server.availability).toHaveBeenCalledTimes(2);
    expect(app.server.check).not.toHaveBeenCalled();
  });

  it('dismiss the card in every window when it is dismissed in one', async () => {
    const app = windows(['main', 'doc-1', 'doc-2']);
    await vi.advanceTimersByTimeAsync(0);
    const heard = { main: vi.fn(), 'doc-2': vi.fn() };
    app.get('main').onDismissed(heard.main);
    app.get('doc-2').onDismissed(heard['doc-2']);
    const own = vi.fn();
    app.get('doc-1').onDismissed(own);
    app.get('doc-1').dismiss('0.2.0');
    await vi.advanceTimersByTimeAsync(0);
    expect(heard.main).toHaveBeenCalledWith('0.2.0');
    expect(heard['doc-2']).toHaveBeenCalledWith('0.2.0');
    // The window it was dismissed in has done so already.
    expect(own).not.toHaveBeenCalled();
    expect(['main', 'doc-1', 'doc-2'].map((label) => app.get(label).dismissed)).toEqual([
      '0.2.0',
      '0.2.0',
      '0.2.0',
    ]);
    // So it is in a window that opens later.
    const later = app.open('doc-3');
    await vi.advanceTimersByTimeAsync(0);
    expect(later.dismissed).toBe('0.2.0');
  });
});

/** A link the test speaks for, to send messages in an order the app might. */
function scripted(joined: Joined) {
  let hear: (message: UpdateMessage) => void = () => {};
  const answer = deferred<Joined>();
  const link = {
    listen: vi.fn((handler: (message: UpdateMessage) => void) => {
      hear = handler;
      return Promise.resolve();
    }),
    join: vi.fn(() => answer.promise),
    report: vi.fn<UpdateLink['report']>(() => Promise.resolve()),
    ask: vi.fn<UpdateLink['ask']>(() => Promise.resolve()),
    answer: vi.fn<UpdateLink['answer']>(() => Promise.resolve()),
    dismiss: vi.fn<UpdateLink['dismiss']>(() => Promise.resolve()),
  } satisfies UpdateLink;
  return {
    link,
    hear: (message: UpdateMessage) => hear(message),
    joinAnswers: () => answer.resolve(joined),
  };
}

describe('a window joining the updates', () => {
  it('listens before it joins, so that it misses nothing', async () => {
    const { link, joinAnswers } = scripted({ owner: false, state: IDLE, dismissed: null });
    shareUpdates(link, () => createUpdates(source()));
    joinAnswers();
    await vi.advanceTimersByTimeAsync(0);
    expect(link.listen.mock.invocationCallOrder[0]).toBeLessThan(
      link.join.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('keeps what it heard while it joined over what the join said', async () => {
    // Events and the answer to a command take different ways, and may cross.
    const { link, hear, joinAnswers } = scripted({ owner: false, state: IDLE, dismissed: null });
    const updates = shareUpdates(link, () => createUpdates(source()));
    await vi.advanceTimersByTimeAsync(0);
    hear({ kind: 'state', state: { phase: 'ready', version: '0.2.0' } });
    hear({ kind: 'dismissed', version: '0.2.0' });
    joinAnswers();
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.state).toEqual({ phase: 'ready', version: '0.2.0' });
    expect(updates.dismissed).toBe('0.2.0');
  });

  it('tells its listeners of a dismissal it learns from the join', async () => {
    // The owner said an update was ready before the join's answer came, which says it was
    // dismissed: a card shown for it in the meantime goes.
    const { link, hear, joinAnswers } = scripted({
      owner: false,
      state: { phase: 'ready', version: '0.2.0' },
      dismissed: '0.2.0',
    });
    const updates = shareUpdates(link, () => createUpdates(source()));
    const heard = vi.fn();
    updates.onDismissed(heard);
    await vi.advanceTimersByTimeAsync(0);
    hear({ kind: 'state', state: { phase: 'ready', version: '0.2.0' } });
    expect(updates.dismissed).toBeNull();
    joinAnswers();
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.dismissed).toBe('0.2.0');
    expect(heard).toHaveBeenCalledExactlyOnceWith('0.2.0');
  });

  it('tells its listeners nothing when the join says no card was dismissed', async () => {
    const { link, joinAnswers } = scripted({ owner: false, state: IDLE, dismissed: null });
    const updates = shareUpdates(link, () => createUpdates(source()));
    const heard = vi.fn();
    updates.onDismissed(heard);
    joinAnswers();
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).not.toHaveBeenCalled();
  });

  it('owns the checks once told so, whatever the join said', async () => {
    const { link, hear, joinAnswers } = scripted({ owner: false, state: IDLE, dismissed: null });
    const create = vi.fn(() => createUpdates(source()));
    shareUpdates(link, create);
    await vi.advanceTimersByTimeAsync(0);
    hear({ kind: 'own' });
    joinAnswers();
    await vi.advanceTimersByTimeAsync(0);
    expect(create).toHaveBeenCalledOnce();
  });

  it('checks for itself when it cannot reach the other windows, as each window did', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { link } = scripted({ owner: false, state: IDLE, dismissed: null });
    link.join.mockRejectedValue(new Error('no such command'));
    const server = source();
    const updates = shareUpdates(link, () => createUpdates(server));
    expect(await updates.checkNow()).toEqual({ kind: 'up-to-date' });
    expect(server.check).toHaveBeenCalledOnce();
  });

  it('tells the others what its updates are doing, as the owner', async () => {
    const { link, joinAnswers } = scripted({ owner: true, state: IDLE, dismissed: null });
    const updates = shareUpdates(link, () => createUpdates(source()));
    joinAnswers();
    await updates.checkNow();
    expect(link.report.mock.calls.map(([state]) => state.phase)).toEqual(['checking', 'idle']);
  });

  it('answers what another window asks, as the owner', async () => {
    const { link, hear, joinAnswers } = scripted({ owner: true, state: IDLE, dismissed: null });
    shareUpdates(link, () => createUpdates(source()));
    joinAnswers();
    await vi.advanceTimersByTimeAsync(0);
    hear({ kind: 'ask', id: 5, what: 'check' });
    await vi.advanceTimersByTimeAsync(0);
    expect(link.answer).toHaveBeenCalledWith(5, {
      outcome: 'done',
      value: { kind: 'up-to-date' },
    });
    hear({ kind: 'ask', id: 6, what: 'install' });
    await vi.advanceTimersByTimeAsync(0);
    expect(link.answer).toHaveBeenLastCalledWith(6, {
      outcome: 'failed',
      error: 'No update is ready',
    });
  });

  it('answers an ask that arrives before the join says it is the owner', async () => {
    const { link, hear, joinAnswers } = scripted({ owner: true, state: IDLE, dismissed: null });
    shareUpdates(link, () => createUpdates(source()));
    await vi.advanceTimersByTimeAsync(0);
    hear({ kind: 'ask', id: 1, what: 'check' });
    await vi.advanceTimersByTimeAsync(0);
    joinAnswers();
    await vi.advanceTimersByTimeAsync(0);
    expect(link.answer).toHaveBeenCalledWith(1, {
      outcome: 'done',
      value: { kind: 'up-to-date' },
    });
  });

  it('gives up on a check the owner doesn’t answer, a little after the check would have', async () => {
    // The owner's page is there, but stuck: Check for Updates… says it couldn't check.
    const { link, hear, joinAnswers } = scripted({ owner: false, state: IDLE, dismissed: null });
    const updates = shareUpdates(link, () => createUpdates(source()));
    joinAnswers();
    let result: unknown = null;
    void updates.checkNow().then((answer) => (result = answer));
    await vi.advanceTimersByTimeAsync(ASK_CHECK_MS - 1);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ kind: 'failed' });
    expect(ASK_CHECK_MS).toBeGreaterThan(CHECK_TIMEOUT_MS);
    // An answer that comes after all is let go.
    const id = link.ask.mock.calls[0]?.[0] ?? 0;
    hear({ kind: 'answer', id, answer: { outcome: 'done', value: { kind: 'up-to-date' } } });
    expect(result).toEqual({ kind: 'failed' });
  });

  it('gives up on an install the owner doesn’t answer within minutes', async () => {
    const { link, joinAnswers } = scripted({ owner: false, state: IDLE, dismissed: null });
    const updates = shareUpdates(link, () => createUpdates(source()));
    joinAnswers();
    let failed: unknown = null;
    updates.install().catch((error: unknown) => (failed = error));
    await vi.advanceTimersByTimeAsync(ASK_INSTALL_MS - 1);
    expect(failed).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toBeInstanceOf(Error);
    expect(ASK_INSTALL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it('waits for an answer that comes in time', async () => {
    const { link, hear, joinAnswers } = scripted({ owner: false, state: IDLE, dismissed: null });
    const updates = shareUpdates(link, () => createUpdates(source()));
    joinAnswers();
    const asked = updates.checkNow();
    await vi.advanceTimersByTimeAsync(ASK_CHECK_MS - 1);
    const id = link.ask.mock.calls[0]?.[0] ?? 0;
    hear({ kind: 'answer', id, answer: { outcome: 'done', value: { kind: 'up-to-date' } } });
    expect(await asked).toEqual({ kind: 'up-to-date' });
  });

  it('tells the others when the card is dismissed here', () => {
    const { link } = scripted({ owner: false, state: IDLE, dismissed: null });
    const updates = shareUpdates(link, () => createUpdates(source()));
    updates.dismiss('0.2.0');
    expect(link.dismiss).toHaveBeenCalledWith('0.2.0');
    expect(updates.dismissed).toBe('0.2.0');
  });
});
