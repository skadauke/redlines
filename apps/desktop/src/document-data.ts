// What plugins keep of each document on this Mac (plugin API `HostDocumentData`), such as the
// comments being written (design §5.7): in the page's local storage, which every window of the app
// shares, as the settings are (settings.ts). Each document has a key of its own, named by its real
// path, so that a write is that document's alone. None of it is ever written into a document or sent
// anywhere. In a plain browser it is kept in memory, as the saves are.
//
// The page's storage is small, about 5 MB shared with the settings, so what is kept is bounded:
// what belongs to a document not opened or written in 90 days goes, and of the rest only the newest
// 100 documents and 1,000,000 characters stay. The bounds are looked at once when a page first uses
// the store, and whenever a document is added. When the page's storage refuses a write all the same,
// the oldest documents make way, one at a time, until it fits; a write that fits nowhere is dropped,
// and the document's drafts then last while its window does.

import type { HostDocumentData } from '@redlines/plugin-api';

/** What each document's key in the page's storage starts with; its real path follows. */
export const DOCUMENT_DATA_PREFIX = 'redlines.document:';
/** The most documents whose data is kept. */
export const KEPT_DOCUMENTS = 100;
/** How long a document's data is kept after it was last opened or written. */
export const KEPT_DAYS = 90;
/** The most characters kept for all the documents together, keys included. */
export const KEPT_CHARACTERS = 1_000_000;

const DAY = 24 * 60 * 60 * 1000;

/** What the store needs of the page's storage. */
export type PageStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

/** A document's data, as it is stored: `at` first, so that a look at the start finds it. */
interface Entry {
  at: number;
  data: Record<string, unknown>;
}

const isEntry = (value: unknown): value is Entry =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Entry).at === 'number' &&
  typeof (value as Entry).data === 'object' &&
  (value as Entry).data !== null &&
  !Array.isArray((value as Entry).data);

/** When a stored entry was written, read from its start, without reading the rest. */
const AT = /^\{"at":(\d+)[,}]/;

/** A storage for the page that holds its items in memory, for a plain browser and for tests. */
export function memoryStorage(): PageStorage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
  };
}

/** The store for what plugins keep of each document, in `storage`, by the clock `now`. */
export function createDocumentData(
  storage: PageStorage,
  now: () => number = Date.now,
): HostDocumentData {
  /** Whether this page has looked at the bounds yet. */
  let pruned = false;
  const keyOf = (path: string) => DOCUMENT_DATA_PREFIX + path;

  const read = (path: string): Entry | null => {
    try {
      const value: unknown = JSON.parse(storage.getItem(keyOf(path)) ?? 'null');
      return isEntry(value) ? value : null;
    } catch {
      return null;
    }
  };

  /** Every document's entry: its key, when it was written, and its size. */
  const entries = () => {
    const found: { key: string; at: number; size: number }[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(DOCUMENT_DATA_PREFIX)) continue;
      const text = storage.getItem(key) ?? '';
      // One that can't be read is the oldest, and goes first.
      found.push({ key, at: Number(AT.exec(text)?.[1] ?? 0), size: key.length + text.length });
    }
    return found;
  };

  /** Drops what is past the bounds, newest kept first, and always `keep`, just written. */
  const prune = (keep?: string) => {
    pruned = true;
    const all = entries();
    const since = now() - KEPT_DAYS * DAY;
    const newest = all
      .filter(({ key, at }) => key === keep || at >= since)
      .sort((a, b) => Number(b.key === keep) - Number(a.key === keep) || b.at - a.at);
    const kept = new Set<string>();
    let size = 0;
    for (const entry of newest) {
      const fits = kept.size < KEPT_DOCUMENTS && size + entry.size <= KEPT_CHARACTERS;
      if (!fits && entry.key !== keep) break;
      kept.add(entry.key);
      size += entry.size;
    }
    for (const { key } of all) if (!kept.has(key)) storage.removeItem(key);
  };

  /** Writes an entry, making room by dropping the oldest others while the storage refuses it. */
  const write = (key: string, text: string) => {
    for (;;) {
      try {
        storage.setItem(key, text);
        return;
      } catch (error) {
        const oldest = entries()
          .filter((entry) => entry.key !== key)
          .sort((a, b) => a.at - b.at)[0];
        if (!oldest) throw error;
        storage.removeItem(oldest.key);
      }
    }
  };

  return {
    get(path, key) {
      try {
        if (!pruned) prune();
      } catch (error) {
        console.warn('Could not look over what is kept of documents', error);
      }
      return read(path)?.data[key];
    },
    set(path, key, value) {
      const entry = read(path);
      const data = { ...entry?.data };
      if (value === undefined) delete data[key];
      else data[key] = value;
      const name = keyOf(path);
      try {
        if (!Object.keys(data).length) {
          storage.removeItem(name);
          return;
        }
        write(name, JSON.stringify({ at: now(), data } satisfies Entry));
        if (!entry || !pruned) prune(name);
      } catch (error) {
        // The page's storage is full or switched off: the data lasts while the window does.
        console.warn('Could not keep data for the document', error);
      }
    },
  };
}

/**
 * Tells `place` where the window's document is, by its real path once `realPath` finds it (or by
 * its path, when it can't): each time another document takes the window (`generation`), or the
 * document gets another path, by Rename or Save As. An answer that comes after another question
 * was asked is dropped, so that the last document and name are the ones told.
 */
export function documentPlacer(options: {
  generation(): number;
  realPath(path: string): Promise<string>;
  place(path: string | null): void;
}): (path: string | null) => void {
  let asked: { generation: number; path: string | null } | null = null;
  return (path) => {
    const generation = options.generation();
    if (asked?.generation === generation && asked.path === path) return;
    const question = (asked = { generation, path });
    const real = path === null ? Promise.resolve(null) : options.realPath(path).catch(() => path);
    void real.then((found) => {
      if (asked === question) options.place(found);
    });
  };
}
