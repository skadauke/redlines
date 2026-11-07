// What a new comment is on, through edits and reloads of its document, and when the document opens
// again with the comment's draft kept (drafts.ts): the same text, followed as a reload follows it, or
// else what replaced it, which the draft says.

import { type ChangeDesc, ChangeSet, Text, type Transaction } from '@codemirror/state';
import { followText, lineChanges } from '@redlines/editor';
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
 * finds its text, else as edits map it. Text that a reload changed is what replaced it, which shows,
 * and the anchor says it changed; an empty anchor has no text to lose.
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

/** The anchor mapped through a transaction: through a reload as above, else as edits are. */
export function followAnchor(range: Anchor, tr: Transaction): Anchor {
  if (!tr.docChanged) return range;
  return follow(range, tr.changes, tr.startState.doc, tr.state.doc, tr.isUserEvent('reload'));
}

/**
 * What is kept of an anchor between sessions (drafts.ts): its place in a copy of the document's
 * text, or for a document too long to copy, its text with a character on either side.
 */
export interface KeptAnchor extends Anchor {
  /** The document's text when the anchor was kept. */
  doc?: string;
  /** Without `doc`: the text from a character before the anchor to a character after it. */
  around?: string;
}

/** The text around an anchor that is kept when the document isn't. */
export function aroundAnchor({ from, to }: Range, doc: Text): string {
  return doc.sliceString(Math.max(0, from - 1), Math.min(doc.length, to + 1));
}

/**
 * Where a kept anchor is in the document as it opens now: where it was, when the document is the
 * same; else found as a reload from the kept text to this one finds it. Without a copy of the text,
 * it is found only where it was, with the same text around it, and otherwise says it changed.
 */
export function anchorAgain(kept: KeptAnchor, doc: Text): Anchor {
  const changed = kept.changed ? { changed: true as const } : {};
  if (kept.doc === undefined) {
    const from = Math.min(kept.from, doc.length);
    const range = { from, to: Math.min(Math.max(kept.to, from), doc.length) };
    const same = kept.from === kept.to || aroundAnchor(range, doc) === kept.around;
    return same ? { ...range, ...changed } : { ...wholeWords(range, doc), changed: true };
  }
  const now = doc.toString();
  if (kept.doc === now) return { from: kept.from, to: kept.to, ...changed };
  const changes = ChangeSet.of(lineChanges(kept.doc, now), kept.doc.length);
  const before = Text.of(kept.doc.split('\n'));
  return follow({ from: kept.from, to: kept.to, ...changed }, changes, before, doc, true);
}
