import type { PluginManifest } from '@redlines/plugin-api';
import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentData,
  createShelf,
  DOCUMENT_DATA_PREFIX,
  KEPT_CHARACTERS,
  KEPT_DAYS,
  KEPT_DOCUMENTS,
  memoryStorage,
  type PageStorage,
  type Shelf,
} from './document-data.ts';

const DAY = 24 * 60 * 60 * 1000;
const PLUGIN = 'redlines.review';
const KEY = 'drafts';

/** One plugin's view of a shelf, by path, as the binding reads it. */
function on(shelf: Shelf, plugin = PLUGIN) {
  return {
    get: (path: string, key: string) => shelf.get(path, plugin, key),
    set: (path: string, key: string, value: unknown) => shelf.set(path, plugin, key, value),
  };
}

/** Lets every answer that came be heard: microtasks only, no timer. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** A clock that moves only when told. */
function clock(start = Date.UTC(2026, 10, 6)) {
  let time = start;
  return { now: () => time, pass: (ms: number) => (time += ms) };
}

const keys = (storage: PageStorage) =>
  Array.from({ length: storage.length }, (_, i) => storage.key(i)!).sort();

describe('what the app keeps of each document', () => {
  it('keeps values for a document under its path, and forgets them', () => {
    const storage = memoryStorage();
    const data = on(createShelf(storage));
    expect(data.get('/notes/plan.md', KEY)).toBeUndefined();
    data.set('/notes/plan.md', KEY, { replies: { c2dk: { text: 'Hi', v: 'a' } } });
    data.set('/notes/plan.md', 'other', 1);
    expect(data.get('/notes/plan.md', KEY)).toEqual({ replies: { c2dk: { text: 'Hi', v: 'a' } } });
    expect(data.get('/notes/other.md', KEY)).toBeUndefined();
    data.set('/notes/plan.md', KEY, undefined);
    expect(data.get('/notes/plan.md', KEY)).toBeUndefined();
    expect(data.get('/notes/plan.md', 'other')).toBe(1);
    // With nothing left, the document's key goes.
    data.set('/notes/plan.md', 'other', undefined);
    expect(keys(storage)).toEqual([]);
  });

  it('keeps each document under a key of its own, which another page reads', () => {
    const storage = memoryStorage();
    const time = clock();
    on(createShelf(storage, time.now)).set('/notes/plan.md', KEY, { last: 'comment' });
    expect(keys(storage)).toEqual([`${DOCUMENT_DATA_PREFIX}/notes/plan.md`]);
    expect(JSON.parse(storage.getItem(`${DOCUMENT_DATA_PREFIX}/notes/plan.md`)!)).toEqual({
      at: time.now(),
      data: { [PLUGIN]: { [KEY]: { last: 'comment' } } },
    });
    expect(on(createShelf(storage)).get('/notes/plan.md', KEY)).toEqual({ last: 'comment' });
  });

  it('gives back a copy, never what was put in', () => {
    const data = on(createShelf(memoryStorage()));
    const value = { text: 'Hi' };
    data.set('/a.md', KEY, value);
    value.text = 'Changed';
    (data.get('/a.md', KEY) as { text: string }).text = 'Changed too';
    expect(data.get('/a.md', KEY)).toEqual({ text: 'Hi' });
  });

  it('leaves the rest of the page’s storage alone', () => {
    const storage = memoryStorage();
    storage.setItem('redlines.settings', '{"textSize":1}');
    const time = clock();
    const data = on(createShelf(storage, time.now));
    for (let i = 0; i <= KEPT_DOCUMENTS; i++) data.set(`/notes/${i}.md`, KEY, i);
    time.pass((KEPT_DAYS + 1) * DAY);
    on(createShelf(storage, time.now)).get('/notes/1.md', KEY);
    expect(keys(storage)).toEqual(['redlines.settings']);
  });

  it('reads an entry it can’t make sense of as nothing, and writes over it', () => {
    const storage = memoryStorage();
    storage.setItem(`${DOCUMENT_DATA_PREFIX}/a.md`, '{not json');
    storage.setItem(`${DOCUMENT_DATA_PREFIX}/b.md`, '[1,2]');
    const data = on(createShelf(storage));
    expect(data.get('/a.md', KEY)).toBeUndefined();
    expect(data.get('/b.md', KEY)).toBeUndefined();
    data.set('/a.md', KEY, 'kept');
    expect(data.get('/a.md', KEY)).toBe('kept');
  });

  describe('is bounded', () => {
    it(`drops what belongs to a document not opened or written in ${KEPT_DAYS} days`, () => {
      const storage = memoryStorage();
      const time = clock();
      const data = on(createShelf(storage, time.now));
      data.set('/old.md', KEY, 'old');
      data.set('/touched.md', KEY, 'touched');
      time.pass((KEPT_DAYS - 10) * DAY);
      // Written again, as when its document opened.
      data.set('/touched.md', KEY, 'touched');
      time.pass(11 * DAY);
      // A page that starts later looks once.
      const later = on(createShelf(storage, time.now));
      expect(later.get('/old.md', KEY)).toBeUndefined();
      expect(later.get('/touched.md', KEY)).toBe('touched');
    });

    it(`keeps at most ${KEPT_DOCUMENTS} documents, the newest`, () => {
      const storage = memoryStorage();
      const time = clock();
      const data = on(createShelf(storage, time.now));
      for (let i = 0; i < KEPT_DOCUMENTS + 5; i++) {
        data.set(`/notes/${i}.md`, KEY, i);
        time.pass(1000);
      }
      expect(keys(storage)).toHaveLength(KEPT_DOCUMENTS);
      for (let i = 0; i < 5; i++) expect(data.get(`/notes/${i}.md`, KEY)).toBeUndefined();
      expect(data.get(`/notes/5.md`, KEY)).toBe(5);
      expect(data.get(`/notes/${KEPT_DOCUMENTS + 4}.md`, KEY)).toBe(KEPT_DOCUMENTS + 4);
    });

    it(`keeps at most ${KEPT_CHARACTERS.toLocaleString('en')} characters, the newest`, () => {
      const storage = memoryStorage();
      const time = clock();
      const data = on(createShelf(storage, time.now));
      const big = 'x'.repeat(KEPT_CHARACTERS / 4);
      for (let i = 0; i < 5; i++) {
        data.set(`/notes/${i}.md`, KEY, big);
        time.pass(1000);
      }
      // Each is a little over a quarter of the bound, with its key: three fit.
      expect(data.get('/notes/0.md', KEY)).toBeUndefined();
      expect(data.get('/notes/1.md', KEY)).toBeUndefined();
      expect(data.get('/notes/2.md', KEY)).toBe(big);
      expect(data.get('/notes/4.md', KEY)).toBe(big);
    });

    it('keeps the document just written, whatever its size', () => {
      const storage = memoryStorage();
      const data = on(createShelf(storage));
      data.set('/small.md', KEY, 'small');
      data.set('/huge.md', KEY, 'x'.repeat(KEPT_CHARACTERS + 1));
      expect(data.get('/huge.md', KEY)).toHaveLength(KEPT_CHARACTERS + 1);
      expect(data.get('/small.md', KEY)).toBeUndefined();
    });

    it('makes room when the page’s storage is full, and gives up quietly when it can’t', () => {
      const inner = memoryStorage();
      const total = () => keys(inner).reduce((n, key) => n + inner.getItem(key)!.length, 0);
      // A storage that holds 350 characters, as a full one refuses more: two entries of 100.
      const storage: PageStorage = {
        get length() {
          return inner.length;
        },
        key: (i) => inner.key(i),
        getItem: (key) => inner.getItem(key),
        removeItem: (key) => inner.removeItem(key),
        setItem: (key, value) => {
          const before = inner.getItem(key)?.length ?? 0;
          if (total() - before + value.length > 350)
            throw new DOMException('Full', 'QuotaExceededError');
          inner.setItem(key, value);
        },
      };
      const time = clock();
      const data = on(createShelf(storage, time.now));
      data.set('/a.md', KEY, 'a'.repeat(100));
      time.pass(1000);
      data.set('/b.md', KEY, 'b'.repeat(100));
      time.pass(1000);
      // No room for a third: the oldest makes way.
      data.set('/c.md', KEY, 'c'.repeat(100));
      expect(data.get('/a.md', KEY)).toBeUndefined();
      expect(data.get('/b.md', KEY)).toBe('b'.repeat(100));
      expect(data.get('/c.md', KEY)).toBe('c'.repeat(100));
      // One that can never fit is not kept, and says so only in the console.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => data.set('/d.md', KEY, 'd'.repeat(400))).not.toThrow();
      expect(data.get('/d.md', KEY)).toBeUndefined();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('drops no other document when the storage refuses a write for another reason', () => {
      const inner = memoryStorage();
      let refuse = false;
      const storage: PageStorage = {
        get length() {
          return inner.length;
        },
        key: (i) => inner.key(i),
        getItem: (key) => inner.getItem(key),
        removeItem: (key) => inner.removeItem(key),
        setItem: (key, value) => {
          if (refuse) throw new DOMException('Denied', 'SecurityError');
          inner.setItem(key, value);
        },
      };
      const data = on(createShelf(storage));
      data.set('/a.md', KEY, 'a');
      data.set('/b.md', KEY, 'b');
      refuse = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      data.set('/c.md', KEY, 'c');
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
      expect(data.get('/a.md', KEY)).toBe('a');
      expect(data.get('/b.md', KEY)).toBe('b');
    });

    it('keeps the bounds at every write that grows what is kept, not only for a new document', () => {
      const storage = memoryStorage();
      const time = clock();
      const data = on(createShelf(storage, time.now));
      const third = 'x'.repeat(KEPT_CHARACTERS / 3 - 100);
      for (let i = 0; i < 3; i++) {
        data.set(`/notes/${i}.md`, KEY, third);
        time.pass(1000);
      }
      expect(data.get('/notes/0.md', KEY)).toBe(third);
      // The newest grows past the bound: the oldest goes now.
      data.set('/notes/2.md', KEY, third + 'y'.repeat(1000));
      expect(data.get('/notes/0.md', KEY)).toBeUndefined();
      expect(data.get('/notes/1.md', KEY)).toBe(third);
    });

    it('works on when the page’s storage can’t be read at all', () => {
      const broken: PageStorage = {
        length: 0,
        key: () => null,
        getItem: () => {
          throw new DOMException('Denied', 'SecurityError');
        },
        setItem: () => {
          throw new DOMException('Denied', 'SecurityError');
        },
        removeItem: () => {},
      };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const data = on(createShelf(broken));
      expect(() => data.set('/a.md', KEY, 1)).not.toThrow();
      expect(data.get('/a.md', KEY)).toBeUndefined();
      warn.mockRestore();
    });
  });
});

describe('the shelf', () => {
  it("keeps each plugin's data apart", () => {
    const shelf = createShelf(memoryStorage());
    shelf.set('/a.md', 'one', KEY, 1);
    shelf.set('/a.md', 'two', KEY, 2);
    expect(shelf.get('/a.md', 'one', KEY)).toBe(1);
    expect(shelf.get('/a.md', 'two', KEY)).toBe(2);
    shelf.set('/a.md', 'one', KEY, undefined);
    expect(shelf.get('/a.md', 'two', KEY)).toBe(2);
  });

  it("moves a document's data, in place of what the other file had", () => {
    const shelf = createShelf(memoryStorage());
    shelf.set('/a.md', 'one', KEY, 'a');
    shelf.set('/a.md', 'two', KEY, 'a2');
    shelf.set('/b.md', 'one', KEY, 'stale');
    shelf.move('/a.md', '/b.md');
    expect(shelf.get('/a.md', 'one', KEY)).toBeUndefined();
    expect(shelf.get('/b.md', 'one', KEY)).toBe('a');
    expect(shelf.get('/b.md', 'two', KEY)).toBe('a2');
    // A document with nothing kept leaves nothing behind where it goes either.
    shelf.move('/c.md', '/b.md');
    expect(shelf.get('/b.md', 'one', KEY)).toBeUndefined();
  });

  it("keeps the data where it was when it can't be written where the document went", () => {
    const inner = memoryStorage();
    const storage: PageStorage = {
      get length() {
        return inner.length;
      },
      key: (i) => inner.key(i),
      getItem: (key) => inner.getItem(key),
      removeItem: (key) => inner.removeItem(key),
      setItem: (key, value) => {
        if (key.endsWith('/b.md')) throw new DOMException('Denied', 'SecurityError');
        inner.setItem(key, value);
      },
    };
    const shelf = createShelf(storage);
    shelf.set('/a.md', 'one', KEY, 'a');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    shelf.move('/a.md', '/b.md');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(shelf.get('/a.md', 'one', KEY)).toBe('a');
    expect(shelf.get('/b.md', 'one', KEY)).toBeUndefined();
  });

  it('forgets what was kept for a file', () => {
    const shelf = createShelf(memoryStorage());
    shelf.set('/a.md', 'one', KEY, 'a');
    shelf.clear('/a.md');
    expect(shelf.get('/a.md', 'one', KEY)).toBeUndefined();
  });
});

describe("plugins' data for the window's document", () => {
  const asking = (id: string): PluginManifest => ({
    id,
    name: id,
    version: '0.0.0',
    needs: ['document:data'],
  });

  /** A real path lookup whose answers come when the test says. */
  function lookups() {
    const waiting: { path: string; answer: (real: string) => void }[] = [];
    const realPath = (path: string) =>
      new Promise<string>((answer) => waiting.push({ path, answer }));
    return { waiting, realPath };
  }

  /** The host of a window whose real paths are the paths, found at once. */
  function window(shelf = createShelf(memoryStorage())) {
    const host = createDocumentData(shelf, (path) => Promise.resolve(path));
    return { shelf, host };
  }

  it("gives a plugin that asks for it a store of its own, and one that doesn't none", async () => {
    const { host } = window();
    expect(host.forPlugin({ id: 'quiet', name: 'q', version: '0.0.0' })).toBeUndefined();
    expect(host.forPlugin({ ...asking('read'), needs: ['document:read'] })).toBeUndefined();
    const one = host.forPlugin(asking('one'))!;
    const two = host.forPlugin(asking('two'))!;
    host.follow(1, '/a.md');
    await settle();
    one.set(KEY, 'mine');
    expect(one.get(KEY)).toBe('mine');
    // Another plugin can't read it, or write over it, with the same key.
    expect(two.get(KEY)).toBeUndefined();
    two.set(KEY, 'theirs');
    expect(one.get(KEY)).toBe('mine');
  });

  it('gives each plugin id one store: a plugin claiming an id already given one gets none', async () => {
    const { host } = window();
    const review = host.forPlugin(asking('redlines.review'))!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(host.forPlugin(asking('redlines.review'))).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    host.follow(1, '/a.md');
    await settle();
    review.set(KEY, 'drafts');
    expect(review.get(KEY)).toBe('drafts');
  });

  it('reads and keeps nothing for a document until its file is found, then says it opened', async () => {
    const { waiting, realPath } = lookups();
    const shelf = createShelf(memoryStorage());
    shelf.set('/real/a.md', 'one', KEY, 'kept');
    const host = createDocumentData(shelf, realPath);
    const one = host.forPlugin(asking('one'))!;
    const heard: string[] = [];
    one.onReady((why) => heard.push(why));
    host.follow(1, '/link/a.md');
    expect(one.get(KEY)).toBeUndefined();
    one.set(KEY, 'too soon');
    waiting[0]!.answer('/real/a.md');
    await settle();
    expect(heard).toEqual(['opened']);
    // By its real path, as a link to it finds it.
    expect(one.get(KEY)).toBe('kept');
    // The same document and name again, as each change of its state says: nothing new.
    host.follow(1, '/link/a.md');
    await settle();
    expect(heard).toEqual(['opened']);
    expect(waiting).toHaveLength(1);
  });

  it('keeps nothing for a document with no file, until it is saved', async () => {
    const { shelf, host } = window();
    shelf.set('/b.md', 'one', KEY, 'stale');
    const one = host.forPlugin(asking('one'))!;
    const heard: string[] = [];
    one.onReady((why) => heard.push(why));
    host.follow(1, null);
    await settle();
    one.set(KEY, 'lost');
    expect(heard).toEqual([]);
    // Saved over a file: what that file had was another document's, and goes.
    host.follow(1, '/b.md');
    await settle();
    expect(heard).toEqual(['saved']);
    expect(one.get(KEY)).toBeUndefined();
    one.set(KEY, 'kept');
    expect(shelf.get('/b.md', 'one', KEY)).toBe('kept');
  });

  it("moves every plugin's data with the document when it is renamed or saved as", async () => {
    const { shelf, host } = window();
    const one = host.forPlugin(asking('one'))!;
    const two = host.forPlugin(asking('two'))!;
    const heard: string[] = [];
    one.onReady((why) => heard.push(why));
    host.follow(1, '/a.md');
    await settle();
    one.set(KEY, 1);
    two.set(KEY, 2);
    host.follow(1, '/b.md');
    await settle();
    expect(heard).toEqual(['opened']);
    expect(shelf.get('/a.md', 'one', KEY)).toBeUndefined();
    expect(shelf.get('/b.md', 'one', KEY)).toBe(1);
    expect(shelf.get('/b.md', 'two', KEY)).toBe(2);
    expect(one.get(KEY)).toBe(1);
  });

  it('reads nothing of the last document while the next one opens', async () => {
    const { waiting, realPath } = lookups();
    const host = createDocumentData(createShelf(memoryStorage()), realPath);
    const one = host.forPlugin(asking('one'))!;
    host.follow(1, '/a.md');
    waiting[0]!.answer('/a.md');
    await settle();
    one.set(KEY, 'a');
    host.follow(2, '/b.md');
    expect(one.get(KEY)).toBeUndefined();
    one.set(KEY, 'not for a');
    waiting[1]!.answer('/b.md');
    await settle();
    host.follow(3, '/a.md');
    waiting[2]!.answer('/a.md');
    await settle();
    expect(one.get(KEY)).toBe('a');
  });

  it('drops an answer that comes after another document or name was asked about', async () => {
    const { waiting, realPath } = lookups();
    const host = createDocumentData(createShelf(memoryStorage()), realPath);
    const one = host.forPlugin(asking('one'))!;
    const heard: string[] = [];
    one.onReady((why) => heard.push(why));
    host.follow(1, '/a.md');
    host.follow(2, '/b.md');
    // Renamed before its file was found: still the document that opened.
    host.follow(2, '/c.md');
    waiting[2]!.answer('/c.md');
    waiting[1]!.answer('/b.md');
    waiting[0]!.answer('/a.md');
    await settle();
    expect(heard).toEqual(['opened']);
    one.set(KEY, 'c');
    host.follow(3, '/c.md');
    waiting[3]!.answer('/c.md');
    await settle();
    expect(one.get(KEY)).toBe('c');
  });

  it("names a document by its path when its real path can't be found", async () => {
    const shelf = createShelf(memoryStorage());
    const host = createDocumentData(shelf, () => Promise.reject(new Error('gone')));
    const one = host.forPlugin(asking('one'))!;
    host.follow(1, '/a.md');
    await settle();
    one.set(KEY, 'kept');
    expect(shelf.get('/a.md', 'one', KEY)).toBe('kept');
  });

  it('stops telling a listener once it is stopped', async () => {
    const { host } = window();
    const one = host.forPlugin(asking('one'))!;
    const heard: string[] = [];
    const stop = one.onReady((why) => heard.push(why));
    stop();
    host.follow(1, '/a.md');
    await settle();
    expect(heard).toEqual([]);
  });
});
