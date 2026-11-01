// Copy, cut and paste (design §5.10). In Clean and Redlines, what is copied or cut is the newest
// text of the selection (format §8): what it reads with every change accepted, without markers,
// deleted text or the ledger. Raw copies the source as written.
//
// A paste never creates marks from the clipboard's content. In Clean and Redlines, pasted text that
// holds Redlines markup becomes its newest text before it goes in, so it is plain text of the
// paster's own, an insertion of theirs while Track Changes is on. Raw, where markup is edited by
// hand, pastes the text as it is.

import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  newestView,
  parse,
  type Range,
  serializeLedger,
  type Thread,
  type WarningCode,
} from '@redlines/format';
import { viewModeField } from './field.ts';

/** The warnings the format gives a marker that makes no mark, with the marker's range. */
const STRAY: ReadonlySet<WarningCode> = new Set([
  'unclosed-mark',
  'unopened-close',
  'kind-mismatch',
  'duplicate-id',
]);

/** A comment's anchor, whose thread may be in another file's ledger. */
const ANCHOR = /<!--cmt ([a-z0-9]{4})(?: [^\r\n]*?)?-->/g;

/**
 * The newest text of `text`. Comment anchors whose threads are not in its own ledger are content to
 * the format; given threads of their own, they are marks too, which the newest text leaves out.
 */
function newest(text: string): string {
  const own = newestView(text).text;
  const ids = [...new Set(Array.from(own.matchAll(ANCHOR), ([, id]) => id!))];
  if (!ids.length) return own;
  const threads = ids.map((id): Thread => ({
    id,
    by: 'unknown',
    at: '',
    likes: [],
    replies: [],
    text: '',
  }));
  const ledger = serializeLedger({ version: 1, people: [], marks: {}, comments: threads });
  const result = newestView(`${own}\n\n${ledger}`).text;
  // In code, such as an unclosed fence, the ledger is text too, and the anchors make no marks.
  return result.includes(ledger) ? own : result;
}

/** `text` without the markers that make no mark in it. */
function withoutStrays(text: string): string {
  const strays: Range[] = parse(text)
    .warnings.flatMap(({ code, range }) => (STRAY.has(code) && range ? [range] : []))
    .sort((a, b) => b.from - a.from);
  let result = text;
  let end = Infinity;
  for (const { from, to } of strays) {
    if (to > end) continue;
    result = result.slice(0, from) + result.slice(to);
    end = from;
  }
  return result;
}

/**
 * Text as plain text, for a paste: its newest text (format §8), without the markers of its marks,
 * the text they deleted or its ledger, and without the markers that make no mark in it alone but
 * would where it is pasted, such as an opener whose closer was left behind, or the anchor of a
 * thread in another file's ledger. Text without markup comes back as it is, as does markup in code.
 */
export function plainText(text: string): string {
  let plain = text;
  // Taking markers out can bring the halves of another together; a few rounds are plenty.
  for (let round = 0; round < 4 && plain.includes('<!--'); round++) {
    const next = withoutStrays(newest(plain));
    if (next === plain) break;
    plain = next;
  }
  return plain;
}

/** What CodeMirror copies: the selected text, or with nothing selected the lines of the carets. */
function copiedRanges(state: EditorState): Range[] {
  const selected = state.selection.ranges.filter((range) => !range.empty);
  if (selected.length) return selected;
  const lines: Range[] = [];
  let last = -1;
  for (const { from } of state.selection.ranges) {
    const line = state.doc.lineAt(from);
    if (line.number > last) lines.push({ from: line.from, to: line.to });
    last = line.number;
  }
  return lines;
}

/** The text to copy, given as written: the newest text of what is copied. */
function copiedText(text: string, state: EditorState): string {
  const ranges = copiedRanges(state);
  const written = ranges.map(({ from, to }) => state.sliceDoc(from, to)).join(state.lineBreak);
  // Text from elsewhere than the selection, such as a dragged widget, is read on its own.
  if (written !== text) return plainText(text);
  const { text: shown, map } = newestView(state.doc.toString());
  return ranges
    .map(({ from, to }) => shown.slice(map.fromSource(from), map.fromSource(to)))
    .join(state.lineBreak);
}

const raw = (state: EditorState) => state.field(viewModeField) === 'raw';

/** Copy, cut, drag and paste of the newest text, outside Raw. */
export function clipboard(): Extension {
  return [
    EditorView.clipboardOutputFilter.of((text, state) =>
      raw(state) ? text : copiedText(text, state),
    ),
    EditorView.clipboardInputFilter.of((text, state) => (raw(state) ? text : plainText(text))),
  ];
}
