import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AT_LEAST_EVERY_MS,
  createRecovery,
  keyOf,
  PAUSE_MS,
  type Kept,
  type Recovery,
  type RecoveryLink,
} from './recovery.ts';

/** The app's folder of copies, in memory. */
function setup(label = 'main') {
  const files = new Map<string, Kept>();
  const calls: string[] = [];
  const link: RecoveryLink = {
    write: (key, path, text) => {
      calls.push(`write ${key}`);
      files.set(key, { key, path, text });
      return Promise.resolve();
    },
    read: (key) => Promise.resolve(files.get(key) ?? null),
    remove: (key) => {
      calls.push(`remove ${key}`);
      files.delete(key);
      return Promise.resolve();
    },
  };
  let text = '';
  const recovery = createRecovery({ link, label, getText: () => text });
  const type = (next: string, state: { path: string | null; dirty: boolean }) => {
    text = next;
    recovery.follow(state);
    recovery.changed();
  };
  return { files, calls, recovery, type, setText: (next: string) => (text = next) };
}

let made: Recovery | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  made?.destroy();
  vi.useRealTimers();
});

const FILE = { path: '/docs/plan.md', dirty: true };

describe('a recovery copy', () => {
  it('is kept at a pause in typing, and holds the text of the document', async () => {
    const t = setup();
    made = t.recovery;
    t.type('one', FILE);
    expect(t.files.size).toBe(0);
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    expect(t.files.get('/docs/plan.md')).toEqual({
      key: '/docs/plan.md',
      path: '/docs/plan.md',
      text: 'one',
    });
  });

  it('is kept while typing goes on without a pause, and not again for the same text', async () => {
    const t = setup();
    made = t.recovery;
    t.type('a', FILE);
    for (let ms = 0; ms < AT_LEAST_EVERY_MS - 1000; ms += 1000) {
      await vi.advanceTimersByTimeAsync(1000);
      t.type(`a${ms}`, FILE);
    }
    expect(t.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.calls).toEqual(['write /docs/plan.md']);
    // Nothing typed since: nothing to keep again.
    t.recovery.changed();
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    expect(t.calls).toEqual(['write /docs/plan.md']);
  });

  it('is deleted when the document is saved', async () => {
    const t = setup();
    made = t.recovery;
    t.type('one', FILE);
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    t.recovery.follow({ path: '/docs/plan.md', dirty: false });
    expect(t.files.size).toBe(0);
  });

  it('is never kept for a document that was saved before the pause', async () => {
    const t = setup();
    made = t.recovery;
    t.type('one', FILE);
    t.recovery.follow({ path: '/docs/plan.md', dirty: false });
    await vi.advanceTimersByTimeAsync(AT_LEAST_EVERY_MS * 2);
    expect(t.calls).not.toContain('write /docs/plan.md');
  });

  it('is deleted when the window closes without saving', async () => {
    const t = setup();
    made = t.recovery;
    t.type('one', FILE);
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    t.recovery.discard();
    expect(t.files.size).toBe(0);
  });

  it('belongs to the untitled document until Save As gives it a file', async () => {
    const t = setup('doc-2');
    made = t.recovery;
    t.type('new', { path: null, dirty: true });
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    expect([...t.files.keys()]).toEqual(['untitled:doc-2']);
    t.recovery.follow({ path: '/docs/new.md', dirty: false });
    expect(t.files.size).toBe(0);
  });

  it('is deleted when another document takes the window', async () => {
    const t = setup();
    made = t.recovery;
    t.type('one', FILE);
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    t.recovery.follow({ path: '/docs/other.md', dirty: false });
    expect(t.files.size).toBe(0);
  });

  it('is found by the window that opens the document after a crash', async () => {
    const t = setup();
    made = t.recovery;
    t.files.set('/docs/plan.md', { key: '/docs/plan.md', path: '/docs/plan.md', text: 'lost' });
    t.recovery.follow({ path: '/docs/plan.md', dirty: false });
    expect(await t.recovery.find()).toMatchObject({ text: 'lost' });
    // Finding it deletes nothing: it stays until the edits are saved or given up.
    expect(t.files.size).toBe(1);
    // The edits are back and unsaved, and keep the copy until the save.
    t.type('lost', FILE);
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    t.recovery.follow({ path: '/docs/plan.md', dirty: false });
    expect(t.files.size).toBe(0);
  });

  it('names a document that was never saved by its window', () => {
    expect(keyOf(null, 'main')).toBe('untitled:main');
    expect(keyOf('/a.md', 'main')).toBe('/a.md');
  });
});
