// An agent's edit made over a stale base (docs/research/multiuser.md §4.9). An agent's tool reads the
// file, works out the whole new text, and writes it. In a session, other people type in between, and
// writing the whole text back would undo what they typed. So the edit is kept as what the agent
// changed (the base's text against its new text, as changes with the words around them), and placed
// again on the text as it is now. What the agent did is kept, what others typed is kept, and an edit
// whose text is gone is left out, and said: place, don't refuse (never an error).
//
// The ledger is not text to place: the agent's entries and everyone else's are merged by key
// (format §7.4) and written in the order the edits write them, so two writers give one ledger.

import {
  applyChanges,
  idsIn,
  ledgerEntries,
  mergeLedgers,
  parse,
  renameMarkId,
  setLedgerEntries,
} from '@redlines/format';
import type { TextChange } from '@redlines/format';
import { lineChanges } from '../diff.ts';

const idsOfBodies = (...bodies: string[]): Set<string> =>
  new Set(bodies.flatMap((body) => [...idsIn(body)]));

/** How much text on each side of an edit is kept to find its place again. */
const CONTEXT = 40;

/** One change of an agent's edit, with the text around it in the base. */
export interface AnchoredChange extends TextChange {
  removed: string;
  before: string;
  after: string;
}

/** An edit of the agent's that wasn't placed, and what to tell the person. */
export interface DroppedChange {
  /** Where it was in the text the agent worked from. */
  from: number;
  removed: string;
  insert: string;
}

export interface Rebased {
  /** The text with the agent's edits placed among what others wrote since. */
  text: string;
  /** The agent's changes that were placed. */
  applied: number;
  dropped: readonly DroppedChange[];
}

/**
 * The text of a file before its ledger comment, which is merged by entry and written apart. Its
 * offsets are the file's own. Text after the ledger (a ledger is the file's last thing) is not the
 * agent's to change here, and stays as it is.
 */
function bodyOf(text: string): string {
  const range = parse(text).ledgerRange;
  // A ledger's range takes the line break that ends the body; a file with none ends the same way.
  if (range) return text.slice(0, range.from);
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** What the agent changed in `base`, each change with the words around it. */
export function anchorChanges(base: string, next: string): AnchoredChange[] {
  return lineChanges(base, next).map((change) => ({
    ...change,
    removed: base.slice(change.from, change.to),
    before: base.slice(Math.max(0, change.from - CONTEXT), change.from),
    after: base.slice(change.to, change.to + CONTEXT),
  }));
}

/** How many characters of `a` end like `b` ends, up to the shorter. */
function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) found.push(at);
  return found;
}

/**
 * Where `change` goes in `text`, when its place is not where it was: the one place whose words
 * fit, or null. A replacement or deletion is found by the text it removes; an insertion by the
 * words on both sides of it.
 */
function find(
  text: string,
  change: AnchoredChange,
  near: number,
): { from: number; to: number } | null {
  const fit = (from: number, to: number) =>
    commonSuffix(text.slice(0, from), change.before) + commonPrefix(text.slice(to), change.after);
  const total = change.before.length + change.after.length;
  if (change.removed) {
    const found = occurrences(text, change.removed);
    if (!found.length) return null;
    const scored = found
      .map((from) => ({ from, score: fit(from, from + change.removed.length) }))
      .sort((a, b) => b.score - a.score || Math.abs(a.from - near) - Math.abs(b.from - near));
    const top = scored[0]!;
    // The only one like it, or the words around it agree well.
    if (found.length === 1 || top.score * 2 >= total) {
      return { from: top.from, to: top.from + change.removed.length };
    }
    return null;
  }
  // An insertion: the words that stood before it and after it, together.
  const anchor = change.before.slice(-12) + change.after.slice(0, 12);
  if (!anchor)
    return { from: Math.min(change.from, text.length), to: Math.min(change.from, text.length) };
  const candidates = occurrences(text, anchor).map((at) => at + change.before.slice(-12).length);
  if (candidates.length === 0) return null;
  const best = candidates
    .map((from) => ({ from, score: fit(from, from) }))
    .sort((a, b) => b.score - a.score || Math.abs(a.from - near) - Math.abs(b.from - near))[0]!;
  return candidates.length === 1 || best.score * 2 >= total
    ? { from: best.from, to: best.from }
    : null;
}

/**
 * The agent's edit from `base` to `next`, placed on `current`. With `current` still `base`, it is
 * `next`, byte for byte.
 */
export function rebaseAgentEdit(current: string, base: string, next: string): Rebased {
  if (current === base) return { text: next, applied: 0, dropped: [] };
  // The ledgers are merged by entry; an id the two sides drew alike is renamed in the agent's body.
  const ours = ledgerEntries(current);
  const theirs = ledgerEntries(next);
  let agentBody = bodyOf(next);
  const merged = mergeLedgers(ledgerEntries(base), ours, theirs, {
    taken: idsOfBodies(bodyOf(current), agentBody),
  });
  for (const rename of merged.renames) {
    if (rename.side === 'theirs' && rename.kind === 'id') {
      agentBody = renameMarkId(agentBody, rename.from, rename.to);
    }
  }
  const baseBody = bodyOf(base);
  const currentBody = bodyOf(current);
  const changes = anchorChanges(baseBody, agentBody);
  // Where the others' changes are, to move the agent's by what they added and removed before it.
  const others = lineChanges(baseBody, currentBody);
  /** A change of the agent's placed in the body, and what it was, to tell of it if it can't go. */
  interface Placed extends TextChange {
    origin: DroppedChange;
  }
  const placed: Placed[] = [];
  const dropped: DroppedChange[] = [];
  for (const change of changes) {
    const origin = { from: change.from, removed: change.removed, insert: change.insert };
    // Others' changes that touch the same stretch: where it was is no longer where it is. Two
    // insertions at one point don't touch; the agent's goes after the other's.
    const touched = others.some((other) => other.from < change.to && change.from < other.to);
    let delta = 0;
    for (const other of others) {
      if (other.to <= change.from) delta += other.insert.length - (other.to - other.from);
    }
    const from = change.from + delta;
    const to = change.to + delta;
    if (!touched && currentBody.slice(from, to) === change.removed) {
      placed.push({ from, to, insert: change.insert, origin });
      continue;
    }
    const found = find(currentBody, change, from);
    if (found) placed.push({ from: found.from, to: found.to, insert: change.insert, origin });
    else dropped.push(origin);
  }
  // Changes that now overlap can't be written together: the later ones go.
  placed.sort((a, b) => a.from - b.from || a.to - b.to);
  const kept: Placed[] = [];
  for (const change of placed) {
    const last = kept.at(-1);
    if (last && change.from < last.to) dropped.push(change.origin);
    else kept.push(change);
  }
  const fileChange = (change: Placed): TextChange => ({
    from: change.from,
    to: change.to,
    insert: change.insert,
  });
  // A change that would leave the file with more problems than it had is left out, with the
  // others kept: the agent's text is never worth a marker that no longer reads.
  const mergeable = !ours.unreadable && !theirs.unreadable && !ledgerEntries(base).unreadable;
  /** The text with the merged ledger written into it: how it would be saved. */
  const settle = (body: string) =>
    mergeable && !ledgerEntries(body).unreadable
      ? applyChanges(body, setLedgerEntries(body, merged.ledger))
      : body;
  const problems = (text: string) => parse(text).warnings.length;
  const allowed = Math.max(problems(current), problems(next));
  let text = current;
  let applied = 0;
  for (const change of kept.toReversed()) {
    const tried = applyChanges(text, [fileChange(change)]);
    if (problems(settle(tried)) > allowed) {
      dropped.push(change.origin);
    } else {
      text = tried;
      applied++;
    }
  }
  return { text: settle(text), applied, dropped };
}
