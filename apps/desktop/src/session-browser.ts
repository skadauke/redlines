// What a browser gives tabs for a session (`session-tabs.ts`): a BroadcastChannel between the
// tabs of the document, Web Locks for who leads, and an IndexedDB store for the epochs and the
// log, which every tab of the origin reaches. Each is a small adapter over the browser's own API.

import { TabPorts } from './session-tabs.ts';
import type { TabChannel, TabLocks, TabMessage, TabStore } from './session-tabs.ts';
import type { SessionPorts } from './session.ts';

/** A name for a channel and a database from a document's path: the path itself, so two never share one. */
function nameFor(path: string): string {
  return encodeURIComponent(path);
}

function channelFor(path: string): TabChannel {
  const channel = new BroadcastChannel(`redlines-session-${nameFor(path)}`);
  return {
    post: (message) => channel.postMessage(message),
    listen: (handler) => {
      const listener = (event: MessageEvent<TabMessage>) => handler(event.data);
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
  };
}

const locks: TabLocks = {
  request: (name, options, held) =>
    // The lock is held for as long as the promise the callback returns is pending.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    navigator.locks.request<void>(name, options, (lock) => held(lock !== null)),
};

const STORE = 'state';

/** The epoch and the log in one IndexedDB object store, written in one transaction each. */
function storeFor(path: string): TabStore {
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`redlines-session-${nameFor(path)}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
  });

  interface Held {
    epoch: number;
    base: string | null;
    records: string[];
  }
  const EMPTY: Held = { epoch: 0, base: null, records: [] };

  /** Reads the state, lets `change` make the new one (or refuse), and writes it, in one transaction. */
  const update = <T>(change: (held: Held) => { next: Held; result: T }): Promise<T> =>
    opened.then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const transaction = db.transaction(STORE, 'readwrite');
          const objects = transaction.objectStore(STORE);
          const read = objects.get('held');
          let result: T;
          read.onsuccess = () => {
            try {
              const made = change((read.result as Held | undefined) ?? EMPTY);
              result = made.result;
              objects.put(made.next, 'held');
            } catch (error) {
              transaction.abort();
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          };
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed.'));
        }),
    );

  const over = (held: Held, epoch: number) => {
    if (epoch < held.epoch) throw new Error(`The session is in epoch ${held.epoch}, not ${epoch}.`);
  };

  return {
    bumpEpoch: () =>
      update((held) => ({ next: { ...held, epoch: held.epoch + 1 }, result: held.epoch + 1 })),
    epoch: () => update((held) => ({ next: held, result: held.epoch })),
    start: (epoch, base) =>
      update((held) => {
        over(held, epoch);
        return {
          next: { epoch: Math.max(held.epoch, epoch), base, records: [] },
          result: undefined,
        };
      }),
    append: (epoch, lines) =>
      update((held) => {
        over(held, epoch);
        return { next: { ...held, records: [...held.records, ...lines] }, result: undefined };
      }),
    read: () =>
      update((held) => ({
        next: held,
        result: held.base === null ? null : { base: held.base, records: held.records },
      })),
  };
}

/** Ports for this tab, as a window of the session of the document at `path`. */
export function browserSessionPorts(path: string): SessionPorts {
  // A page made for a test may name its tab (`?tab=2`), which a window's number comes from.
  const named = import.meta.env.DEV ? new URLSearchParams(location.search).get('tab') : null;
  const label = named ? `tab-${named}` : `tab-${crypto.randomUUID().slice(0, 8)}`;
  const ports = new TabPorts({
    label,
    path,
    channel: channelFor(path),
    locks,
    store: storeFor(path),
  });
  // The page going away is the tab leaving: its lock is released by the browser, and the others
  // are told at once rather than by silence.
  addEventListener('pagehide', () => void ports.leave());
  // A page the browser brings back from its cache has left: it starts again, as a new tab.
  addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
  // Debug only (the journeys): a tab's page can be frozen, as a browser freezes one that hangs.
  if (import.meta.env.DEV) Object.assign(window, { __redlinesTab: ports });
  return ports;
}

/** Whether this browser has what a session between tabs needs. */
export const tabsCanShare =
  typeof BroadcastChannel !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  'locks' in navigator &&
  typeof indexedDB !== 'undefined';
