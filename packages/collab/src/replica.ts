// A window's copy of a session's text: the text the authority confirmed, and the edits made here
// that it has not confirmed yet (pending). What the person sees is the confirmed text with the
// pending edits written on it. The mapping follows `@codemirror/collab` (vendored, one update at
// a time), so that this side and the authority end with the same text.

import { ChangeSet, Text } from '@codemirror/state';
import type { LoggedWireUpdate } from './protocol.ts';

/** An edit made here and not confirmed yet. */
export interface Pending<T = unknown> {
  /** Applies to the text before it: the confirmed text and the pending edits ahead of it. */
  changes: ChangeSet;
  /** The text it was made on, to find its place again if it has to be derived anew. */
  start: Text;
  /** Whatever the host of the replica keeps with the edit (its intent). */
  note: T;
}

export class Replica<T = unknown> {
  readonly clientID: string;
  /** The text the authority confirmed at `version`. */
  confirmed: Text;
  version: number;
  pending: Pending<T>[] = [];

  constructor(clientID: string, text: string | Text = '', version = 0) {
    this.clientID = clientID;
    this.confirmed = typeof text === 'string' ? Text.of(text.split('\n')) : text;
    this.version = version;
  }

  /** What the person sees. */
  get text(): Text {
    let doc = this.confirmed;
    for (const edit of this.pending) doc = edit.changes.apply(doc);
    return doc;
  }

  /** Starts over from the authority's text, with nothing pending. */
  reset(text: string, version: number): void {
    this.confirmed = Text.of(text.split('\n'));
    this.version = version;
    this.pending = [];
  }

  /** An edit the person made, which the editor has applied to its text already. */
  local(changes: ChangeSet, start: Text, note: T): void {
    this.pending.push({ changes, start, note });
  }

  /**
   * Takes in updates from the authority's log, in order, the first being version `version + 1`.
   * Own updates confirm the pending edit at the head; others are mapped over what is pending.
   * Returns the changes to make to what the person sees, or null when nothing shows.
   * Updates at or before the replica's version are skipped (a pull that overlaps a notice).
   */
  receive(updates: readonly LoggedWireUpdate[]): ChangeSet | null {
    let shown: ChangeSet | null = null;
    for (const update of updates) {
      if (update.version <= this.version) continue;
      if (update.version !== this.version + 1) {
        throw new Error(`Update ${update.version} after version ${this.version}`);
      }
      const changes = ChangeSet.fromJSON(update.changes);
      const head = this.pending[0];
      if (head && update.clientID === this.clientID) {
        // Ours, confirmed as the authority logged it. The text is the same one we show.
        this.pending.shift();
      } else {
        let remote = changes;
        this.pending = this.pending.map((local) => {
          const mapped = local.changes.map(remote);
          remote = remote.map(local.changes, true);
          return { ...local, changes: mapped };
        });
        shown = shown ? shown.compose(remote) : remote;
      }
      this.confirmed = changes.apply(this.confirmed);
      this.version = update.version;
    }
    return shown;
  }
}
