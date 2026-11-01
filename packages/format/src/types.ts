// Provisional: these types follow docs/format.md and will change when the parser is written.

/** A UTC time with minute precision, `YYYY-MM-DDTHH:MMZ`, kept as a string. */
export type Time = string;

/** A person's stable handle, such as `ada` or `claude-ada`. Handles never change. */
export type Handle = string;

/** The word that starts a marker, as in `<!--ins k3x9-->`. */
export type MarkKind = 'ins' | 'del' | 'sub' | 'fmt' | 'hl' | 'cmt' | 'split';

/** A tracked change, highlight or comment range in the text. `by` and `at` come from its ledger entry. */
export interface Mark {
  /** Four characters; see `newId`. */
  id: string;
  kind: MarkKind;
  by: Handle;
  at: Time;
  /** The decoded payload of a `del`, `sub` or `fmt` marker: the old text or the format operations. */
  payload?: string;
}

/** A YAML value as the ledger reader gets it (the `failsafe` schema): every scalar is a string. */
export type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };

/** Fields in the ledger that this version doesn't use, by name. They are kept as they were read,
 * so a save doesn't lose what a later version wrote (format §5.2). */
export type ExtraFields = Record<string, YamlValue>;

/** Someone who made a change or a comment. */
export interface Person {
  /** Letters, digits, `-` and `_`, starting with a letter, and never a YAML word such as `no`. */
  handle: Handle;
  /** The display name, which Word shows. */
  name: string;
  email?: string;
  org?: string;
  /** Stable ids such as `github:ada-l`, to match the same person across documents. */
  accounts?: string[];
  /** An AI agent. */
  agent?: boolean;
  /** The person an agent acts for. */
  for?: Handle;
  /** Other handles this person was found under. */
  aliases?: Handle[];
  /** A team's members, so the team can be mentioned. */
  members?: Handle[];
  /** Someone who left keeps their handle. */
  deleted?: boolean;
  /** Fields this version doesn't use. */
  extra?: ExtraFields;
}

export interface Reply {
  id: string;
  by: Handle;
  at: Time;
  /** Markdown. */
  text: string;
  /** Fields this version doesn't use. */
  extra?: ExtraFields;
}

/** A comment thread. Replies are one level deep, as in Word. */
export interface Thread {
  id: string;
  by: Handle;
  at: Time;
  /** The mark this comment is about, when it has no range of its own. */
  about?: string;
  /** When the comment text was last edited. Edits themselves are not tracked. */
  edited?: Time;
  /** Present while the thread is resolved. */
  resolved?: { by: Handle; at: Time };
  likes: { by: Handle; at: Time }[];
  /** Reactions other than likes. The format doesn't say yet what they look like, so they are kept
   * as they were read (format §4, §5.4). */
  reactions?: YamlValue;
  replies: Reply[];
  /** The text the comment covered, recorded when it was created, for when that text is deleted. */
  quote?: string;
  /** Markdown. */
  text: string;
  /** Word's task assignment: who the comment is assigned to. */
  assigned?: Handle;
  /** The assigned task is done. */
  done?: boolean;
  /** Fields this version doesn't use. */
  extra?: ExtraFields;
}

/** Ledger fields that only some marks have. */
export interface MarkExtras {
  /** The author's reason. Agents should always give one. */
  note?: string;
  /** Marks in one group are accepted or rejected together. */
  group?: string;
  /** The other half of a move. */
  move?: string;
  /** The marked-up text that "Simplify markup" collapsed into this mark. */
  parts?: string;
}

/** A mark's line in the ledger: its author and time, plus any extras. */
export interface MarkEntry extends MarkExtras {
  by: Handle;
  at: Time;
  /** Fields this version doesn't use. */
  extra?: ExtraFields;
}

/** The YAML ledger in the `<!-- redlines` comment at the end of the file. */
export interface Ledger {
  version: 1;
  /** Everyone who opens the file starts with Track Changes on, like Word's "For Everyone". */
  tracking?: 'everyone';
  /** `full` keeps every revision and decision in the file. The default is `current`. */
  history?: 'current' | 'full';
  people: Person[];
  /** Every mark's entry, by mark id, in document order. */
  marks: Record<string, MarkEntry>;
  /** Threads in document order. */
  comments: Thread[];
  /** Top-level keys this version doesn't use, such as `frontmatter`. */
  extra?: ExtraFields;
}

/** A change to a string, in UTF-16 offsets of the string before the change. Lists of changes are
 * sorted and don't overlap. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface Range {
  from: number;
  to: number;
}

/** One stretch of a mark. `content` lies between the markers; a mark without a closer (a deletion,
 * a point comment) has an empty content at `open.to`. */
export interface Segment {
  /** The opener. When it stands alone on its line before a block, which is how a mark that starts
   * the block is written (format §3.3), the range goes on over the line break, the blank line and
   * the container prefix that follow it: they are not text, and go with the opener. */
  open: Range;
  content: Range;
  close?: Range;
  /** The decoded payload written in this segment's opener; absent when it has none. */
  payload?: string;
}

/** A mark as found in the text: its segments, and its ledger entry. */
export interface MarkRange {
  id: string;
  kind: MarkKind;
  /** The decoded payload: the old text of a `del` or `sub`, the operations of a `fmt`, or `row` or
   * `col` for a table mark. */
  payload?: string;
  /** In document order. */
  segments: Segment[];
  /** From the ledger; `{ by: 'unknown', at: '' }` when the entry is missing. */
  entry: MarkEntry;
}

export type WarningCode =
  | 'unknown-key'
  | 'duplicate-id'
  | 'line-start-marker'
  | 'kind-mismatch'
  | 'missing-entry'
  | 'orphan-entry'
  | 'orphan-thread'
  | 'unclosed-mark'
  | 'unopened-close'
  | 'bad-ledger';

/** Something wrong in a file that the parser worked around (format §12). */
export interface Warning {
  code: WarningCode;
  message: string;
  id?: string;
  range?: Range;
}

/** A parsed file. */
export interface Parsed {
  /** The input, unchanged. */
  text: string;
  /** Marks in the document order of their first segment. */
  marks: MarkRange[];
  ledger: Ledger;
  /** The ledger comment plus the blank line before it; null when the file has none. */
  ledgerRange: Range | null;
  warnings: Warning[];
}

/** Maps offsets between a view and the source it was derived from. */
export interface PositionMap {
  /** A view offset to a source offset. Where hidden text sits at the offset, `assoc` picks its
   * side: -1 before it, 1 after it (the default). */
  toSource(pos: number, assoc?: -1 | 1): number;
  /** A source offset to a view offset. Offsets inside hidden text map to the nearest visible one
   * before them. */
  fromSource(pos: number): number;
}

/** A derived view of a file (format §8), with its position map. */
export interface DocView {
  text: string;
  map: PositionMap;
}

/** Who makes an edit, and when. */
export interface EditContext {
  /** The author, added to the ledger's people when missing. */
  author: Person;
  time: Time;
  /** Returns `n` random bytes, for new ids; tests pass a deterministic source. */
  random?: (n: number) => Uint8Array;
  /** The reason for the change, written to each new mark's ledger entry. */
  note?: string;
  /** A group id for the new marks, decided together. */
  group?: string;
}
