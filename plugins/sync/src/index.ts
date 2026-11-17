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
import { anchorIntent, intentOf, rederiveIntent } from '@redlines/editor';
import type { Editor, Intent } from '@redlines/editor';
import { EditorView } from '@codemirror/view';

export type { SyncState } from '@redlines/collab';

/** What is kept with each edit made here. */
export interface EditNote {
  intent: Intent | undefined;
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
  /** Called when the authority's text replaced the editor's (a joining window). */
  onLoaded?: () => void;
  retryMs?: number;
}

export interface SyncBinding {
  readonly client: SyncClient<EditNote>;
  readonly replica: Replica<EditNote>;
  /** Resolves when everything made here is confirmed by the authority. */
  settled(): Promise<void>;
  /** Other people's presence, as the authority last said it. */
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
  const peers: Peer[] = [];

  const apply = (spec: { changes: ChangeSet | { from: number; to: number; insert: string } }) => {
    view.dispatch({
      ...spec,
      annotations: [
        received.of(true),
        Transaction.addToHistory.of(false),
        Transaction.remote.of(true),
      ],
      filter: false,
    });
  };

  const removeListener = editor.addExtension(
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      for (const tr of update.transactions) {
        if (!tr.docChanged || tr.annotation(received)) continue;
        replica.local(tr.changes, tr.startState.doc, { intent: intentOf(tr) });
      }
      client.edited();
    }),
  );

  const client = new SyncClient<EditNote>({
    transport: options.transport,
    replica,
    credential: options.credential,
    loaded: options.hosts,
    ...(options.retryMs ? { retryMs: options.retryMs } : {}),
    notice,
    ...(options.onState ? { onState: options.onState } : {}),
    showRemote: (changes) => apply({ changes }),
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
    peers,
    stop: async () => {
      removeListener();
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
  for (const edit of pending.slice(drop)) {
    const { intent } = edit.note;
    let changes: ChangeSet | null = null;
    if (intent?.kind === 'typing') {
      const placed = rederiveIntent(state, anchorIntent(edit.start.toString(), intent));
      if (placed.ok) {
        changes = placed.changes;
        notices.push(...placed.notices);
      } else if (intent.exact && edit.changes.length === state.doc.length) {
        // The text's own changes (Undo, an agent's edit) that can't be placed by their source: as
        // the session mapped them over what others changed, which never takes them back.
        changes = edit.changes;
      } else {
        notices.push(`An edit of yours was taken back: ${placed.reason}`);
      }
    } else if (edit.changes.length === state.doc.length) {
      changes = edit.changes;
    } else {
      notices.push('A change of yours could not be placed after what others changed.');
    }
    if (!changes || changes.empty) continue;
    kept.push({ changes, start: state.doc, note: edit.note });
    state = state.update({ changes, filter: false }).state;
  }
  return { pending: kept, notices: [...new Set(notices)] };
}
