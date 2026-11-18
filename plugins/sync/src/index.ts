// A window's side of a live session, bound to the editor (docs/research/collaboration.md "Rules for
// live collaboration"). The editor keeps working as it always did: the tracking filter writes each
// edit, and the binding records it as pending beside the intent the filter recorded. Edits of
// other people come in as remote transactions, which the filter, the history and every other
// writer leave alone. When the authority turns an edit away because someone changed what it
// depends on, the intent is placed again on the newest text, among its words, and that is sent.

import { EditorState, Annotation, ChangeSet, Text, Transaction } from '@codemirror/state';
import type { StateEffect } from '@codemirror/state';
import { SyncClient, Replica } from '@redlines/collab';
import type { Pending, SyncState, Transport } from '@redlines/collab';
import type { Credential, Peer } from '@redlines/collab';
import {
  addLineBreakStyles,
  anchorFormat,
  anchorIntent,
  anchorMove,
  anchorPaste,
  anchorReview,
  anchorTable,
  docFileText,
  intentOf,
  loadFile,
  rederiveFormat,
  rederiveIntent,
  rederiveMove,
  rederivePaste,
  rederiveReview,
  rederiveSteps,
  rederiveTable,
  remoteStep,
} from '@redlines/editor';
import type { Editor, Intent, Rederived } from '@redlines/editor';
import type { TextChange } from '@redlines/format';
import { EditorView } from '@codemirror/view';
import {
  fileChanges,
  fileDoc,
  fileOf,
  fileViewOf,
  intoDoc,
  between as diff,
} from './file-space.ts';
import { placeLedgerWrite } from './ledger.ts';
import { placeRejection } from './rejection.ts';
import { ensureStyle, peersShown, presenceExtension, showPeers } from './presence.ts';
import type { PeerView } from './presence.ts';
import type { Remote } from '@redlines/collab';

export { FLAG_MS, PALETTE, peersShown, STYLE, STYLE_ID } from './presence.ts';
export type { PeerView } from './presence.ts';

export type { SyncState } from '@redlines/collab';
export { fileOf as syncText } from './file-space.ts';

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
  return diff(from.toString(), to.toString());
}

export function syncEditor(editor: Editor, options: SyncOptions): SyncBinding {
  const { view } = editor;
  const notice = options.notice ?? ((message) => console.info(message));
  const replica = new Replica<EditNote>(
    options.clientID,
    options.hosts ? fileDoc(view.state) : '',
    options.hosts ? (options.version ?? 0) : 0,
  );
  let peers: Peer[] = [];
  /** What each peer last said, to place again when the text or this window's version moves. */
  let lastPeers: readonly Peer[] = [];
  ensureStyle();

  const apply = (
    spec: {
      changes:
        | ChangeSet
        | { from: number; to: number; insert: string }
        | { from: number; to: number; insert: string }[];
      effects?: StateEffect<unknown>[];
    },
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

  /**
   * Shows what the session's text became in a file whose line breaks aren't all alike: the window's
   * document and the record of its break kinds are checked against it, and where a change of a
   * break's kind alone left the record as it was (a CRLF made an LF, a break the other way), the
   * file is loaded again, which is no edit of the person's.
   */
  let reloading = false;
  const showFile = (make: () => void, expected: string) => {
    make();
    if (fileOf(view.state) === expected) return;
    reloading = true;
    try {
      editor.reloadDoc(expected);
    } finally {
      reloading = false;
    }
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
      const file = fileViewOf(view.state);
      const placed = {
        head: file ? file.toDoc(replica.toShown(head)) : replica.toShown(head),
        anchor: file ? file.toDoc(replica.toShown(anchor)) : replica.toShown(anchor),
      };
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
      const file = fileViewOf(view.state);
      void client.presence({
        v: replica.version,
        h: replica.toConfirmed(file ? file.toFile(head) : head),
        a: replica.toConfirmed(file ? file.toFile(anchor) : anchor),
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
        if (!tr.docChanged || tr.annotation(received) || reloading) continue;
        // The session speaks the file's offsets; the intent stays on the document it was made on.
        const file = fileChanges(tr);
        const changes = file ? file.changes : tr.changes;
        replica.local(changes, file ? file.start : tr.startState.doc, {
          intent: intentOf(tr),
          made: changes,
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
      const spec = intoDoc(view.state, remote.changes);
      const plain = docFileText(view.state) === null && spec.effects.length === 0;
      const expected = plain ? '' : remote.changes.apply(fileDoc(view.state)).toString();
      const make = () =>
        apply(
          spec,
          // A window of the same person is another editor for Undo, as another person is.
          { person: `${remote.by}:${remote.clientID}`, name: nameOf(remote.clientID, remote.by) },
        );
      if (plain) make();
      else showFile(make, expected);
      placePeers();
    },
    showAll: (doc) => {
      const change = between(fileDoc(view.state), doc);
      if (!change) return;
      const spec = intoDoc(view.state, change);
      if (docFileText(view.state) === null && spec.effects.length === 0) apply(spec);
      else showFile(() => apply(spec), doc.toString());
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
  // The confirmed text is the file's; the state has its document, with the kinds of its line breaks.
  const text = confirmed.toString();
  const loaded = text.includes('\r') || docFileText(view.state) !== null ? loadFile(text) : null;
  let state: EditorState = view.state.update({
    changes: { from: 0, to: view.state.doc.length, insert: loaded ? loaded.doc : text },
    effects: loaded ? loaded.effects : [],
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
    return change ? ChangeSet.of(change, from.length, '\n') : null;
  };
  let shift: ChangeSet | null = shiftTo(old, fileDoc(state));
  for (const edit of pending.slice(drop)) {
    const { intent } = edit.note;
    const fits = edit.changes.length === old.length;
    const mapped = fits && shift ? edit.changes.map(shift) : edit.changes;
    // What the edit is now, as changes of the file's text; `into` makes it in the window's document.
    let changes: ChangeSet | null = null;
    let into: { changes: ChangeSet | TextChange[]; effects: StateEffect<unknown>[] } | null = null;
    const origin = (edit.note.origin ?? edit.start).toString();
    // The text's own changes (Undo, an agent's edit) are written as they are: mapped over what
    // others did, with their ledger write and their rejections made again on the newest text.
    const asIs = !intent || (intent.kind === 'typing' && intent.exact === true);
    const byWords = (): Rederived | null =>
      intent?.kind === 'typing'
        ? rederiveIntent(state, anchorIntent(origin, intent))
        : intent?.kind === 'format'
          ? rederiveFormat(state, anchorFormat(origin, intent))
          : intent?.kind === 'move'
            ? rederiveMove(state, anchorMove(origin, intent))
            : intent?.kind === 'table'
              ? rederiveTable(state, anchorTable(origin, intent))
              : intent?.kind === 'widened-paste'
                ? rederivePaste(state, anchorPaste(origin, intent))
                : intent?.kind === 'steps'
                  ? rederiveSteps(state, origin, intent)
                  : intent?.kind === 'review'
                    ? rederiveReview(state, anchorReview(origin, intent))
                    : null;
    const take = (placed: Rederived) => {
      if (placed.ok) {
        // Written on the document: its file changes are what the transaction on it makes.
        into = {
          changes: placed.changes,
          effects: placed.styles?.length ? [addLineBreakStyles.of(placed.styles)] : [],
        };
        changes = fileChanges(state.update({ ...into, filter: false }))?.changes ?? placed.changes;
        notices.push(...placed.notices);
      } else {
        notices.push(`An edit of yours was taken back: ${placed.reason}`);
      }
    };
    if (!asIs) {
      const placed = byWords();
      if (placed) take(placed);
      else notices.push('A change of yours could not be placed after what others changed.');
    } else if (fits && mapped.length === fileDoc(state).length) {
      // An Undo that only rejects marks is done again as that rejection on the newest text.
      const rejected = edit.note.made
        ? placeRejection(fileDoc(state), edit.start, edit.note.made)
        : null;
      if (rejected) {
        if (rejected.gone) {
          notices.push('Some of what you took back was already decided by someone else.');
        }
        changes = rejected.changes;
      } else {
        // Mapped over what others did, but its ledger write is made again on the newest ledger.
        changes = edit.note.made
          ? (placeLedgerWrite(fileDoc(state), mapped, edit.start, edit.note.made) ?? mapped)
          : mapped;
      }
    } else if (intent) {
      const placed = byWords();
      if (placed) take(placed);
    } else {
      notices.push('A change of yours could not be placed after what others changed.');
    }
    if (fits) old = edit.changes.apply(old);
    if (changes && !changes.empty) {
      kept.push({ changes, start: fileDoc(state), note: { ...edit.note, made: changes } });
      state = state.update({ ...(into ?? intoDoc(state, changes)), filter: false }).state;
    }
    if (fits) shift = shiftTo(old, fileDoc(state));
  }
  return { pending: kept, notices: [...new Set(notices)] };
}
