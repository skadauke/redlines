// A window's copy of a session's text: the text the authority confirmed, and the edits made here
// that it has not confirmed yet (pending). What the person sees is the confirmed text with the
// pending edits written on it. The mapping follows `@codemirror/collab` (vendored, one update at
// a time), so that this side and the authority end with the same text.

import { ChangeSet, Text } from '@codemirror/state';
import type { ChangeDesc } from '@codemirror/state';
import type { LoggedWireUpdate } from './protocol.ts';

/** How many of the log's last updates a replica keeps, to place a position given at an older version. */
const RING = 256;

/** What changed the shown text when an update of someone else's came in. */
export interface Remote {
  /** To make to what the person sees, as it stands before it. */
  changes: ChangeSet;
  /** The author's handle and the replica that made it. */
  by: string;
  clientID: string;
}

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
  /** The last updates of the log as they changed the confirmed text, oldest first. */
  readonly #ring: { version: number; desc: ChangeDesc }[] = [];

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
    this.#ring.length = 0;
  }

  /**
   * A position in the confirmed text at `version`, as it is in the confirmed text now: null while
   * this replica has not reached `version`, or has forgotten the updates since.
   */
  mapFrom(pos: number, version: number, assoc: -1 | 1 = -1): number | null {
    if (version > this.version) return null;
    if (version === this.version) return pos;
    const since = this.#ring.filter((entry) => entry.version > version);
    if (since.length !== this.version - version) return null;
    let at = pos;
    for (const { desc } of since) at = desc.mapPos(at, assoc);
    return at;
  }

  /** A position in the confirmed text, as it is in what the person sees (their edits written on it). */
  toShown(pos: number, assoc: -1 | 1 = -1): number {
    let at = pos;
    for (const edit of this.pending) at = edit.changes.mapPos(at, assoc);
    return at;
  }

  /** A position in what the person sees, as it is in the confirmed text. */
  toConfirmed(pos: number, assoc: -1 | 1 = -1): number {
    let at = pos;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      at = this.pending[i]!.changes.invertedDesc.mapPos(at, assoc);
    }
    return at;
  }

  /** An edit the person made, which the editor has applied to its text already. */
  local(changes: ChangeSet, start: Text, note: T): void {
    this.pending.push({ changes, start, note });
  }

  /**
   * Takes in updates from the authority's log, in order, the first being version `version + 1`.
   * Own updates confirm the pending edit at the head; others are mapped over what is pending.
   * Returns the changes to make to what the person sees, one for each update of someone else's.
   * Updates at or before the replica's version are skipped (a pull that overlaps a notice).
   */
  receive(updates: readonly LoggedWireUpdate[]): Remote[] {
    const shown: Remote[] = [];
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
        shown.push({ changes: remote, by: update.by, clientID: update.clientID });
      }
      this.confirmed = changes.apply(this.confirmed);
      this.version = update.version;
      this.#ring.push({ version: update.version, desc: changes.desc });
      if (this.#ring.length > RING) this.#ring.shift();
    }
    return shown;
  }
}
