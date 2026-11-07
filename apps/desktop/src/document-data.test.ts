import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentData,
  DOCUMENT_DATA_PREFIX,
  documentPlacer,
  KEPT_CHARACTERS,
  KEPT_DAYS,
  KEPT_DOCUMENTS,
  memoryStorage,
  type PageStorage,
} from './document-data.ts';

const DAY = 24 * 60 * 60 * 1000;
const KEY = 'review.drafts';

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
    const data = createDocumentData(storage);
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
    createDocumentData(storage, time.now).set('/notes/plan.md', KEY, { last: 'comment' });
    expect(keys(storage)).toEqual([`${DOCUMENT_DATA_PREFIX}/notes/plan.md`]);
    expect(JSON.parse(storage.getItem(`${DOCUMENT_DATA_PREFIX}/notes/plan.md`)!)).toEqual({
      at: time.now(),
      data: { [KEY]: { last: 'comment' } },
    });
    expect(createDocumentData(storage).get('/notes/plan.md', KEY)).toEqual({ last: 'comment' });
  });

  it('gives back a copy, never what was put in', () => {
    const data = createDocumentData(memoryStorage());
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
    const data = createDocumentData(storage, time.now);
    for (let i = 0; i <= KEPT_DOCUMENTS; i++) data.set(`/notes/${i}.md`, KEY, i);
    time.pass((KEPT_DAYS + 1) * DAY);
    createDocumentData(storage, time.now).get('/notes/1.md', KEY);
    expect(keys(storage)).toEqual(['redlines.settings']);
  });

  it('reads an entry it can’t make sense of as nothing, and writes over it', () => {
    const storage = memoryStorage();
    storage.setItem(`${DOCUMENT_DATA_PREFIX}/a.md`, '{not json');
    storage.setItem(`${DOCUMENT_DATA_PREFIX}/b.md`, '[1,2]');
    const data = createDocumentData(storage);
    expect(data.get('/a.md', KEY)).toBeUndefined();
    expect(data.get('/b.md', KEY)).toBeUndefined();
    data.set('/a.md', KEY, 'kept');
    expect(data.get('/a.md', KEY)).toBe('kept');
  });

  describe('is bounded', () => {
    it(`drops what belongs to a document not opened or written in ${KEPT_DAYS} days`, () => {
      const storage = memoryStorage();
      const time = clock();
      const data = createDocumentData(storage, time.now);
      data.set('/old.md', KEY, 'old');
      data.set('/touched.md', KEY, 'touched');
      time.pass((KEPT_DAYS - 10) * DAY);
      // Written again, as when its document opened.
      data.set('/touched.md', KEY, 'touched');
      time.pass(11 * DAY);
      // A page that starts later looks once.
      const later = createDocumentData(storage, time.now);
      expect(later.get('/old.md', KEY)).toBeUndefined();
      expect(later.get('/touched.md', KEY)).toBe('touched');
    });

    it(`keeps at most ${KEPT_DOCUMENTS} documents, the newest`, () => {
      const storage = memoryStorage();
      const time = clock();
      const data = createDocumentData(storage, time.now);
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
      const data = createDocumentData(storage, time.now);
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
      const data = createDocumentData(storage);
      data.set('/small.md', KEY, 'small');
      data.set('/huge.md', KEY, 'x'.repeat(KEPT_CHARACTERS + 1));
      expect(data.get('/huge.md', KEY)).toHaveLength(KEPT_CHARACTERS + 1);
      expect(data.get('/small.md', KEY)).toBeUndefined();
    });

    it('makes room when the page’s storage is full, and gives up quietly when it can’t', () => {
      const inner = memoryStorage();
      const total = () => keys(inner).reduce((n, key) => n + inner.getItem(key)!.length, 0);
      // A storage that holds 300 characters, as a full one refuses more.
      const storage: PageStorage = {
        get length() {
          return inner.length;
        },
        key: (i) => inner.key(i),
        getItem: (key) => inner.getItem(key),
        removeItem: (key) => inner.removeItem(key),
        setItem: (key, value) => {
          const before = inner.getItem(key)?.length ?? 0;
          if (total() - before + value.length > 300)
            throw new DOMException('Full', 'QuotaExceededError');
          inner.setItem(key, value);
        },
      };
      const time = clock();
      const data = createDocumentData(storage, time.now);
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
      const data = createDocumentData(broken);
      expect(() => data.set('/a.md', KEY, 1)).not.toThrow();
      expect(data.get('/a.md', KEY)).toBeUndefined();
      warn.mockRestore();
    });
  });
});

describe('telling the review where the document is', () => {
  /** Lets every answer that came be heard. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** A real path lookup whose answers come when the test says. */
  function lookups() {
    const waiting: { path: string; answer: (real: string) => void }[] = [];
    const realPath = (path: string) =>
      new Promise<string>((answer) => waiting.push({ path, answer }));
    return { waiting, realPath };
  }

  it('says the real path of each document, and of each new name', async () => {
    const { waiting, realPath } = lookups();
    let generation = 1;
    const placed: (string | null)[] = [];
    const place = documentPlacer({
      generation: () => generation,
      realPath,
      place: (path) => placed.push(path),
    });
    place(null);
    await settle();
    expect(placed).toEqual([null]);
    // The same document and name again, as each change of its state says: nothing new.
    place(null);
    generation = 2;
    place('/link/plan.md');
    waiting[0]!.answer('/real/plan.md');
    await settle();
    expect(placed).toEqual([null, '/real/plan.md']);
    place('/link/plan.md');
    place('/link/launch.md');
    waiting[1]!.answer('/real/launch.md');
    await settle();
    expect(placed).toEqual([null, '/real/plan.md', '/real/launch.md']);
    expect(waiting).toHaveLength(2);
  });

  it('drops an answer that comes after another document or name was asked about', async () => {
    const { waiting, realPath } = lookups();
    let generation = 1;
    const placed: (string | null)[] = [];
    const place = documentPlacer({
      generation: () => generation,
      realPath,
      place: (path) => placed.push(path),
    });
    place('/a.md');
    generation = 2;
    place('/b.md');
    waiting[1]!.answer('/real/b.md');
    waiting[0]!.answer('/real/a.md');
    await settle();
    expect(placed).toEqual(['/real/b.md']);
  });

  it('names a document by its path when its real path can’t be found', async () => {
    const placed: (string | null)[] = [];
    const place = documentPlacer({
      generation: () => 1,
      realPath: () => Promise.reject(new Error('gone')),
      place: (path) => placed.push(path),
    });
    place('/a.md');
    await settle();
    expect(placed).toEqual(['/a.md']);
  });
});
