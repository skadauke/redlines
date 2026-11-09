// What plugins keep of each document on this Mac (plugin API `HostDocumentData`), such as the
// comments being written (design §5.7). The shelf holds it in the page's local storage, which every
// window of the app shares, as the settings are (settings.ts): one key per document, named by its
// real path, so that a write is that document's alone, and inside it each plugin's data apart. None
// of it is ever written into a document or sent anywhere. In a plain browser it is kept in memory,
// as the saves are.
//
// Each window binds the shelf to its document (`createDocumentData`): it finds the document's real
// path, says when the data can be read, and moves every plugin's data with the document on Rename
// and Save As. A plugin gets a store only when its manifest asks for `document:data`, and reads and
// writes only its own data.
//
// The page's storage is small, about 5 MB shared with the settings, so what is kept is bounded:
// what belongs to a document not opened or written in 90 days goes, and of the rest only the newest
// 100 documents and 1,000,000 characters stay; the document just written always stays. The bounds
// are kept when a page first uses the shelf, and at every write that makes a document's entry
// longer or adds one. When the page's storage is full all the same, the oldest documents make way,
// one at a time, until the write fits; a write that fits nowhere, or that the storage refuses for
// another reason, is dropped, and the data then lasts while the window does. Moved on Rename or
// Save As, a document's data leaves its old path only once it is written at the new one.
//
// What the bounds drop of a document that is open in a window is not written again until it
// changes there: a plugin keeps it again with its next change (the review, when a draft's text
// changes).

import type { HostDocumentData, PluginManifest } from '@redlines/plugin-api';

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

/** Each plugin's data, by its id, then by key. */
type Data = Record<string, Record<string, unknown>>;

/** A document's data, as it is stored: `at` first, so that a look at the start finds it. */
interface Entry {
  at: number;
  data: Data;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEntry = (value: unknown): value is Entry =>
  isRecord(value) &&
  typeof value['at'] === 'number' &&
  isRecord(value['data']) &&
  Object.values(value['data']).every(isRecord);

/** Whether the page's storage refused a write for being full. */
const isFull = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');

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

/** What is kept for each document, by its real path, then by plugin and key. */
export interface Shelf {
  get(path: string, plugin: string, key: string): unknown;
  /** Keeps `value`, or forgets what is kept, for undefined. */
  set(path: string, plugin: string, key: string, value: unknown): void;
  /** The document at `from` is now at `to`: its data goes there, in place of what `to` had. */
  move(from: string, to: string): void;
  /** Forgets what is kept for the file at `path`, which another document now is. */
  clear(path: string): void;
}

/** The shelf for what plugins keep of each document, in `storage`, by the clock `now`. */
export function createShelf(storage: PageStorage, now: () => number = Date.now): Shelf {
  /** Whether this page has looked at the bounds yet. */
  let pruned = false;
  const keyOf = (path: string) => DOCUMENT_DATA_PREFIX + path;

  /** A document's entry, and how long it is as stored. */
  const read = (path: string): { entry: Entry | null; length: number } => {
    try {
      const text = storage.getItem(keyOf(path));
      const value: unknown = JSON.parse(text ?? 'null');
      return { entry: isEntry(value) ? value : null, length: text?.length ?? 0 };
    } catch {
      return { entry: null, length: 0 };
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

  /** Writes an entry, making room by dropping the oldest others while the storage is full. */
  const write = (key: string, text: string) => {
    for (;;) {
      try {
        storage.setItem(key, text);
        return;
      } catch (error) {
        if (!isFull(error)) throw error;
        const oldest = entries()
          .filter((entry) => entry.key !== key)
          .sort((a, b) => a.at - b.at)[0];
        if (!oldest) throw error;
        storage.removeItem(oldest.key);
      }
    }
  };

  /**
   * Writes a document's data, or takes its key away when there is none, and keeps the bounds when
   * the entry is longer than the `was` it replaces. Returns whether the storage took it.
   */
  const store = (path: string, data: Data, was: number): boolean => {
    const name = keyOf(path);
    let text: string | null = null;
    try {
      if (!Object.keys(data).length) storage.removeItem(name);
      else write(name, (text = JSON.stringify({ at: now(), data } satisfies Entry)));
    } catch (error) {
      // The page's storage is full or switched off: the data lasts while the window does.
      console.warn('Could not keep data for the document', error);
      return false;
    }
    try {
      if (text !== null && (text.length > was || !pruned)) prune(name);
    } catch (error) {
      console.warn('Could not look over what is kept of documents', error);
    }
    return true;
  };

  return {
    get(path, plugin, key) {
      try {
        if (!pruned) prune();
      } catch (error) {
        console.warn('Could not look over what is kept of documents', error);
      }
      return read(path).entry?.data[plugin]?.[key];
    },
    set(path, plugin, key, value) {
      const { entry, length } = read(path);
      const data: Data = { ...entry?.data };
      const own = { ...data[plugin] };
      if (value === undefined) delete own[key];
      else own[key] = value;
      if (Object.keys(own).length) data[plugin] = own;
      else delete data[plugin];
      store(path, data, length);
    },
    move(from, to) {
      if (from === to) return;
      // The data leaves its old place only once it is in the new one.
      if (!store(to, read(from).entry?.data ?? {}, 0)) return;
      try {
        storage.removeItem(keyOf(from));
      } catch (error) {
        console.warn('Could not move data for the document', error);
      }
    },
    clear(path) {
      store(path, {}, 0);
    },
  };
}

/** Why a plugin's data can now be read and kept (`HostDocumentData.onReady`). */
type Ready = 'opened' | 'saved';

/** What a window's page does with the shelf. */
export interface DocumentData {
  /**
   * The window's document, at each change of its state: another document took the window
   * (`generation`), or the document got another path, by Rename or Save As.
   */
  follow(generation: number, path: string | null): void;
  /**
   * The store of a plugin whose manifest asks for `document:data`; none for one that doesn't, or
   * for one whose id was given a store already in this window.
   */
  forPlugin(manifest: PluginManifest): HostDocumentData | undefined;
}

/**
 * Binds `shelf` to the window's document, which it names by its real path once `realPath` finds it,
 * or by its path when it can't. Nothing is read or kept for a document until then, nor for one
 * with no file. An answer that comes after another document or name was asked about is dropped, so
 * that the last are the ones bound.
 */
export function createDocumentData(
  shelf: Shelf,
  realPath: (path: string) => Promise<string>,
): DocumentData {
  let asked: { generation: number; path: string | null } | null = null;
  /** The real path the stores read and write, or null while there is none. */
  let bound: string | null = null;
  /** A document opened, and its file isn't found yet. */
  let opening = false;
  const listeners = new Set<(why: Ready) => void>();
  /** The plugin ids given a store: each keys a plugin's data, so it is given once. */
  const claimed = new Set<string>();
  const tell = (why: Ready) => {
    for (const listener of [...listeners]) listener(why);
  };

  return {
    follow(generation, path) {
      if (asked?.generation === generation && asked.path === path) return;
      if (asked?.generation !== generation) {
        bound = null;
        opening = path !== null;
      }
      const question = (asked = { generation, path });
      if (path === null) return;
      void realPath(path)
        .catch(() => path)
        .then((real) => {
          if (asked !== question) return;
          if (opening) {
            opening = false;
            bound = real;
            tell('opened');
          } else if (bound === null) {
            // Saved for the first time: what was kept for that file was another document's.
            shelf.clear(real);
            bound = real;
            tell('saved');
          } else if (bound !== real) {
            shelf.move(bound, real);
            bound = real;
          }
        });
    },
    forPlugin(manifest) {
      if (!manifest.needs?.includes('document:data')) return undefined;
      const { id } = manifest;
      // A plugin's data is under its id: another plugin that says it has that id would read it.
      if (claimed.has(id)) {
        console.warn(`Plugin ${id} gets no document data: a plugin with its id already has it`);
        return undefined;
      }
      claimed.add(id);
      return {
        get: (key) => (bound === null ? undefined : shelf.get(bound, id, key)),
        set: (key, value) => {
          if (bound !== null) shelf.set(bound, id, key, value);
        },
        onReady(listener) {
          const own = (why: Ready) => listener(why);
          listeners.add(own);
          return () => listeners.delete(own);
        },
      };
    },
  };
}
