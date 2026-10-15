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

/** Someone who made a change or a comment. */
export interface Person {
  /** Letters, digits, `-` and `_`, starting with a letter, and never a YAML word such as `no`. */
  handle: Handle;
  /** The display name, which Word shows. */
  name: string;
  email?: string;
  org?: string;
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
}

export interface Reply {
  id: string;
  by: Handle;
  at: Time;
  /** Markdown. */
  text: string;
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
  replies: Reply[];
  /** The text the comment covered, recorded when it was created, for when that text is deleted. */
  quote?: string;
  /** Markdown. */
  text: string;
  /** Word's task assignment: who the comment is assigned to. */
  assigned?: Handle;
  /** The assigned task is done. */
  done?: boolean;
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
}

/** The YAML ledger in the `<!-- redlines` comment at the end of the file. */
export interface Ledger {
  version: 1;
  /** Everyone who opens the file starts in Suggesting, like Word's Track Changes for everyone. */
  tracking?: 'everyone';
  /** `full` keeps every revision and decision in the file. The default is `current`. */
  history?: 'current' | 'full';
  people: Person[];
  /** Every mark's entry, by mark id, in document order. */
  marks: Record<string, MarkEntry>;
  /** Threads in document order. */
  comments: Thread[];
}
