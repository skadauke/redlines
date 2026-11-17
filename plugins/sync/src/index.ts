// A window's side of a live session, bound to the editor (docs/research/collaboration.md "Rules for
// live collaboration"). The editor keeps working as it always did: the tracking filter writes each
// edit, and the binding records it as pending beside the intent the filter recorded. Edits of
// other people come in as remote transactions, which the filter, the history and every other
// writer leave alone. When the authority turns an edit away because someone changed what it
// depends on, the intent is placed again on the newest text, among its words, and that is sent.

import { EditorState, Annotation, ChangeSet, Text, Transaction } from '@codemirror/state';
import { SyncClient, Replica } from '@redlines/collab';
import type { Pending, SyncState, Transport } from '@redlines/collab';
import type { Credential, Peer } from '@redlines/collab';
import {
  anchorFormat,
  anchorIntent,
  anchorMove,
  intentOf,
  rederiveFormat,
  rederiveIntent,
  rederiveMove,
  remoteStep,
} from '@redlines/editor';
import type { Editor, Intent } from '@redlines/editor';
import { EditorView } from '@codemirror/view';
import { placeLedgerWrite } from './ledger.ts';
import { ensureStyle, peersShown, presenceExtension, showPeers } from './presence.ts';
import type { PeerView } from './presence.ts';
import type { Remote } from '@redlines/collab';

export { FLAG_MS, PALETTE, peersShown, STYLE, STYLE_ID } from './presence.ts';
export type { PeerView } from './presence.ts';

export type { SyncState } from '@redlines/collab';

/** What is kept with each edit made here. */
export interface EditNote {
  intent: Intent | undefined;
  /** The edit as made, on the text it started from (`Pending.start`), to place its ledger write. */
  made?: ChangeSet;
  /** The text the intent was made on, which its offsets are of; it stays as the edit is placed again. */
  origin?: Text;
}

export interface SyncOptions {
  transport: Transport;
  /** This window's own id in the session: unique to the window. */
  clientID: string;
  credential: Credential;
  /**
   * Whether this window's text is the session's start: the window that hosts the authority. A
   * window that joins takes the authority's text in its place.
   */
  hosts: boolean;
  /** For the window that hosts: the version of the log its text is (after a restore); 0 is a new log. */
  version?: number;
  /** A short message for the person; defaults to the console. */
  notice?: (message: string) => void;
  onState?: (state: SyncState) => void;
  /** The other windows of the session changed: who is there, in each one's color. */
  onPeers?: (peers: readonly Peer[]) => void;
  /** Called when the authority's text replaced the editor's (a joining window). */
  onLoaded?: () => void;
  retryMs?: number;
}

export interface SyncBinding {
  readonly client: SyncClient<EditNote>;
  readonly replica: Replica<EditNote>;
  /** Resolves when everything made here is confirmed by the authority. */
  settled(): Promise<void>;
  /** The other windows, as the authority last said them. */
  readonly peers: readonly Peer[];
  /** Leaves the session; the editor keeps its text and is the window's alone again. */
  stop(): Promise<void>;
}

/** Marks the transactions the binding makes itself, which are not the person's edits. */
const received = Annotation.define<boolean>();

/** The smallest single change that turns `from` into `to`, or null when they are the same. */
function between(from: Text, to: Text): { from: number; to: number; insert: string } | null {
  if (from.eq(to)) return null;
  const a = from.toString();
  const b = to.toString();
  let start = 0;
  const limit = Math.min(a.length, b.length);
  while (start < limit && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < limit - start &&
    a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)
  ) {
    end++;
  }
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}

export function syncEditor(editor: Editor, options: SyncOptions): SyncBinding {
  const { view } = editor;
  const notice = options.notice ?? ((message) => console.info(message));
  const replica = new Replica<EditNote>(
    options.clientID,
    options.hosts ? view.state.doc : '',
    options.hosts ? (options.version ?? 0) : 0,
  );
  let peers: Peer[] = [];
  /** What each peer last said, to place again when the text or this window's version moves. */
  let lastPeers: readonly Peer[] = [];
  ensureStyle();

  const apply = (
    spec: { changes: ChangeSet | { from: number; to: number; insert: string } },
    from?: { person: string; name: string },
  ) => {
    view.dispatch({
      ...spec,
      annotations: [
        received.of(true),
        Transaction.addToHistory.of(false),
        Transaction.remote.of(true),
        // Another person's edit is theirs for Undo: it stays when this person takes back their own.
        ...(from ? [remoteStep.of(from)] : []),
      ],
      filter: false,
    });
  };

  /** What a window is called: its name from the authority, or the author's handle. */
  const nameOf = (clientID: string, by: string): string =>
    peers.find((peer) => peer.clientID === clientID)?.name ?? `${by} (another window)`;

  /** The other windows' carets and selections, placed in what this window shows. */
  const placePeers = () => {
    const views: PeerView[] = [];
    const shownNow = peersShown(view);
    for (const peer of lastPeers) {
      const state = peer.state as { v?: unknown; h?: unknown; a?: unknown };
      if (
        typeof state.v !== 'number' ||
        typeof state.h !== 'number' ||
        typeof state.a !== 'number'
      ) {
        continue;
      }
      const head = replica.mapFrom(state.h, state.v);
      const anchor = replica.mapFrom(state.a, state.v);
      // A window that is ahead of this one: placed once this one has caught up.
      if (head === null || anchor === null) continue;
      const placed = { head: replica.toShown(head), anchor: replica.toShown(anchor) };
      // The flag shows when a window moves, not when the text under it did, nor when it says
      // where it is again at another version.
      const before = shownNow.find((mine) => mine.clientID === peer.clientID);
      const stamp =
        before && before.head === placed.head && before.anchor === placed.anchor
          ? before.stamp
          : Date.now();
      views.push({
        clientID: peer.clientID,
        name: peer.name,
        color: peer.color ?? 'p1',
        ...placed,
        stamp,
      });
    }
    showPeers(view, views);
  };

  const heard = (next: readonly Peer[]) => {
    lastPeers = next;
    peers = [...next];
    placePeers();
    options.onPeers?.(peers);
  };

  /** Says where this window's caret is, a moment after it moves, and now and then. */
  let said: ReturnType<typeof setTimeout> | null = null;
  const sayWhere = () => {
    if (said) return;
    said = setTimeout(() => {
      said = null;
      const { head, anchor } = view.state.selection.main;
      void client.presence({
        v: replica.version,
        h: replica.toConfirmed(head),
        a: replica.toConfirmed(anchor),
      });
    }, 80);
  };
  const heartbeat = setInterval(sayWhere, 10_000);

  const removeListener = editor.addExtension([
    presenceExtension(),
    EditorView.updateListener.of((update) => {
      if (update.selectionSet) sayWhere();
      if (!update.docChanged) return;
      let local = false;
      for (const tr of update.transactions) {
        if (!tr.docChanged || tr.annotation(received)) continue;
        replica.local(tr.changes, tr.startState.doc, {
          intent: intentOf(tr),
          made: tr.changes,
          origin: tr.startState.doc,
        });
        local = true;
      }
      if (local) {
        client.edited();
        sayWhere();
      }
    }),
  ]);

  const client = new SyncClient<EditNote>({
    transport: options.transport,
    replica,
    credential: options.credential,
    loaded: options.hosts,
    ...(options.retryMs ? { retryMs: options.retryMs } : {}),
    notice,
    onState: (state) => {
      if (state === 'synced') sayWhere();
      options.onState?.(state);
    },
    onPeers: heard,
    showRemote: (remote: Remote) => {
      apply(
        { changes: remote.changes },
        // A window of the same person is another editor for Undo, as another person is.
        { person: `${remote.by}:${remote.clientID}`, name: nameOf(remote.clientID, remote.by) },
      );
      placePeers();
    },
    showAll: (doc) => {
      const change = between(view.state.doc, doc);
      if (change) apply({ changes: change });
    },
    load: (text) => {
      editor.setDoc(text);
      options.onLoaded?.();
    },
    rederive: (confirmed, pending, drop) => rederive(view, confirmed, pending, drop),
  });
  void client.start();

  return {
    client,
    replica,
    settled: () => client.sync(),
    get peers() {
      return peers;
    },
    stop: async () => {
      removeListener();
      clearInterval(heartbeat);
      if (said) clearTimeout(said);
      showPeers(view, []);
      await client.stop();
    },
  };
}

/**
 * The pending edits derived again on `confirmed`, in order, each on what the ones before it made.
 * A typing edit is placed among its words; one with no intent to place, such as a command's, is
 * kept as it is only if it still fits the text, and otherwise taken back and said.
 */
function rederive(
  view: EditorView,
  confirmed: Text,
  pending: readonly Pending<EditNote>[],
  drop: number,
): { pending: Pending<EditNote>[]; notices: string[] } {
  const notices: string[] = [];
  // The editor's state at the confirmed text: every field the writers read, parsed anew.
  let state: EditorState = view.state.update({
    changes: { from: 0, to: view.state.doc.length, insert: confirmed.toString() },
    filter: false,
  }).state;
  const kept: Pending<EditNote>[] = [];
  // The pending edits were mapped over each other as the session first wrote them. When one is
  // written anew, or taken back, the ones after it no longer fit the text that follows it: `old`
  // is the text the chain still thinks it is on, and `shift` carries its next edit to the text
  // that is really there.
  let old: Text = confirmed;
  for (const edit of pending.slice(0, drop)) {
    if (edit.changes.length === old.length) old = edit.changes.apply(old);
  }
  const shiftTo = (from: Text, to: Text): ChangeSet | null => {
    const change = between(from, to);
    return change ? ChangeSet.of(change, from.length) : null;
  };
  let shift: ChangeSet | null = shiftTo(old, state.doc);
  for (const edit of pending.slice(drop)) {
    const { intent } = edit.note;
    const fits = edit.changes.length === old.length;
    const mapped = fits && shift ? edit.changes.map(shift) : edit.changes;
    let changes: ChangeSet | null = null;
    const origin = (edit.note.origin ?? edit.start).toString();
    const placed =
      intent?.kind === 'typing'
        ? rederiveIntent(state, anchorIntent(origin, intent))
        : intent?.kind === 'format'
          ? rederiveFormat(state, anchorFormat(origin, intent))
          : intent?.kind === 'move'
            ? rederiveMove(state, anchorMove(origin, intent))
            : null;
    if (placed) {
      if (placed.ok) {
        changes = placed.changes;
        notices.push(...placed.notices);
      } else {
        notices.push(`An edit of yours was taken back: ${placed.reason}`);
      }
    } else if (fits && mapped.length === state.doc.length) {
      // Mapped over what others did, but its ledger write is made again on the newest ledger.
      changes = edit.note.made
        ? (placeLedgerWrite(state.doc, mapped, edit.start, edit.note.made) ?? mapped)
        : mapped;
    } else {
      notices.push('A change of yours could not be placed after what others changed.');
    }
    if (fits) old = edit.changes.apply(old);
    if (changes && !changes.empty) {
      kept.push({ changes, start: state.doc, note: { ...edit.note, made: changes } });
      state = state.update({ changes, filter: false }).state;
    }
    if (fits) shift = shiftTo(old, state.doc);
  }
  return { pending: kept, notices: [...new Set(notices)] };
}
