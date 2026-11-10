// What a new comment is on, through edits and reloads of its document, and when the document
// opens again with the comment's draft kept (drafts.ts): the same text, followed as a reload
// follows it, or else what replaced it, which the draft says.

import { type ChangeDesc, ChangeSet, Text, type Transaction } from '@codemirror/state';
import { followsText, followText, lineChanges } from '@redlines/editor';
import type { Range } from '@redlines/format';

/** What a new comment is on. `changed` is set when a reload changed the text it was on. */
export interface Anchor extends Range {
  changed?: true;
}

/**
 * An anchor through edits. What is put in right at its ends stays outside it. With its text
 * deleted, it is on the point where the text was.
 */
export function mapAnchor(range: Range, changes: ChangeDesc): Range {
  const from = changes.mapPos(range.from, 1);
  return { from, to: Math.max(from, changes.mapPos(range.to, -1)) };
}

const WORD = /[\p{L}\p{N}_]/u;

/** `range` grown to whole words at both ends: a cut never falls inside one. */
function wholeWords({ from, to }: Range, doc: Text): Range {
  const inWord = (pos: number) =>
    pos > 0 &&
    pos < doc.length &&
    WORD.test(doc.sliceString(pos - 1, pos + 1).at(0)!) &&
    WORD.test(doc.sliceString(pos, pos + 1));
  while (inWord(from)) from--;
  while (inWord(to)) to++;
  return { from, to };
}

/** What replaced an anchor's text in a reload, in whole words. */
function replacement(range: Range, changes: ChangeDesc, doc: Text): Range {
  return wholeWords({ from: changes.mapPos(range.from, -1), to: changes.mapPos(range.to, 1) }, doc);
}

/**
 * An anchor through `changes`, which turn `before` into `after`: through a reload as `followText`
 * finds its text, else as edits map it. Text that a reload changed is what replaced it, which
 * shows, and the anchor says it changed; an empty anchor has no text to lose.
 */
export function follow(
  range: Anchor,
  changes: ChangeDesc,
  before: Text,
  after: Text,
  reload: boolean,
): Anchor {
  const kept = reload ? followText(changes, before, after, range) : mapAnchor(range, changes);
  const lost = !kept && range.from < range.to;
  const result = kept ?? (lost ? replacement(range, changes, after) : mapAnchor(range, changes));
  return lost || range.changed ? { ...result, changed: true } : result;
}

/**
 * The anchor mapped through a transaction: through a reload, an agent's step and its Undo and Redo
 * as above (`followsText`), else as edits are.
 */
export function followAnchor(range: Anchor, tr: Transaction): Anchor {
  if (!tr.docChanged) return range;
  return follow(range, tr.changes, tr.startState.doc, tr.state.doc, followsText(tr));
}

/** How much of the text on either side of an anchor is kept when the document isn't. */
const CONTEXT = 32;

/** An anchor's text, and some of the text on either side of it. */
export interface AnchorContext {
  quote: string;
  before: string;
  after: string;
}

/**
 * What is kept of an anchor between sessions (drafts.ts): its place in a copy of the document's
 * text, or for a document too long to copy, its text and what is around it.
 */
export interface KeptAnchor extends Anchor, Partial<AnchorContext> {
  /** The document's text when the anchor was kept. */
  doc?: string;
}

/** The text of an anchor and up to 32 characters on either side, kept when the document isn't. */
export function contextOf({ from, to }: Range, doc: Text): AnchorContext {
  return {
    quote: doc.sliceString(from, to),
    before: doc.sliceString(Math.max(0, from - CONTEXT), from),
    after: doc.sliceString(to, Math.min(doc.length, to + CONTEXT)),
  };
}

/** Whether two characters at the edge of an anchor are alike: the same, or neither in a word. */
const alike = (a: string, b: string) => a === b || !(WORD.test(a) || WORD.test(b));

/**
 * Where an anchor kept without a copy of the document is: its text with what was around it, where
 * it was or else at the nearest place; else its text alone, where it is the only place it is and
 * neither grew nor was cut, as `followText` asks of a reload; or null.
 */
function findContext(kept: KeptAnchor, doc: Text): number | null {
  const { quote = '', before = '', after = '' } = kept;
  const wanted = before + quote + after;
  const text = doc.toString();
  const was = kept.from - before.length;
  if (text.startsWith(wanted, was)) return kept.from;
  let found: number | null = null;
  for (let at = text.indexOf(wanted); at >= 0; at = text.indexOf(wanted, at + 1)) {
    if (found === null || Math.abs(at - was) < Math.abs(found - was)) found = at;
  }
  if (found !== null) return found + before.length;
  const only = quote ? text.indexOf(quote) : -1;
  if (only < 0 || text.indexOf(quote, only + 1) >= 0) return null;
  const end = only + quote.length;
  const edges = alike(before.slice(-1), text.slice(Math.max(0, only - 1), only));
  return edges && alike(after.slice(0, 1), text.slice(end, end + 1)) ? only : null;
}

/**
 * Where a kept anchor is in the document as it opens now: where it was, when the document is the
 * same; else found as a reload from the kept text to this one finds it. Without a copy of the text,
 * it is found by its text and what was around it, nearest to where it was, or by its text alone
 * where that is the only place it is; else it is on what is at its old place now, and says it
 * changed. A point is no different: it never stays on other text without saying so.
 */
export function anchorAgain(kept: KeptAnchor, doc: Text): Anchor {
  const changed = kept.changed ? { changed: true as const } : {};
  if (kept.doc === undefined) {
    const at = findContext(kept, doc);
    if (at !== null) return { from: at, to: at + (kept.to - kept.from), ...changed };
    const from = Math.min(kept.from, doc.length);
    const range = { from, to: Math.min(Math.max(kept.to, from), doc.length) };
    return { ...(kept.from === kept.to ? range : wholeWords(range, doc)), changed: true };
  }
  const now = doc.toString();
  if (kept.doc === now) return { from: kept.from, to: kept.to, ...changed };
  const changes = ChangeSet.of(lineChanges(kept.doc, now), kept.doc.length);
  const before = Text.of(kept.doc.split('\n'));
  return follow({ from: kept.from, to: kept.to, ...changed }, changes, before, doc, true);
}
