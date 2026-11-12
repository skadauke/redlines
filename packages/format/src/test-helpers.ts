// Helpers shared by the tests of the editing functions. They are not part of the package.

import { readFileSync } from 'node:fs';
import {
  micromark,
  parse as micromarkParse,
  postprocess as micromarkPostprocess,
  preprocess as micromarkPreprocess,
} from 'micromark';
import { gfmStrikethrough, gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';
import { expect } from 'vitest';
import { bodyStart, frontMatterEnd, prefixLength } from './blocks.ts';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import type { FormatOp } from './format-ops.ts';
import { isOlderPunctuation, isPunctuation, plainBody } from './format-reader.ts';
import { setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { randomDocument, seeded } from './random-docs.ts';
import { scan } from './scan.ts';
import type { Marker } from './scan.ts';
import { trackedEdit } from './track.ts';
import type { EditContext, Parsed, Person, Range, TextChange } from './types.ts';
import { newestView, originalView } from './views.ts';

/** The example of format §1.2. */
export const fixture = readFileSync(new URL('./fixtures/launch-plan.md', import.meta.url), 'utf8');

export const ada: Person = { handle: 'ada', name: 'Ada Lovelace', email: 'ada@example.org' };
export const bo: Person = { handle: 'bo', name: 'Bo Chen', email: 'bo@example.org' };
export const claudeAda: Person = { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' };

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';

/** A deterministic stand-in for `crypto.getRandomValues` that spells out the given ids, one after
 * the other, and throws when they run out. */
export function randomIds(...ids: string[]): (n: number) => Uint8Array {
  const bytes = ids.flatMap((id) =>
    [...id].map((c, i) => (i === 0 ? FIRST : REST).indexOf(c)).filter((b) => b >= 0),
  );
  let at = 0;
  return (n) => {
    if (at + n > bytes.length) throw new Error('The test ran out of random ids');
    const chunk = Uint8Array.from(bytes.slice(at, at + n));
    at += n;
    return chunk;
  };
}

/** The time of every test edit. */
export const TIME = '2026-10-31T09:00Z';

/** An edit context for `author`, drawing the given ids in order. */
export function context(
  author: Person,
  ids: string[] = [],
  more: Partial<EditContext> = {},
): EditContext {
  return { author, time: TIME, random: randomIds(...ids), ...more };
}

/** A thread for the ledger of `file`, as YAML lines. */
export function thread(id: string, by = 'ada', text = 'A note.', more: string[] = []): string[] {
  return [
    `  ${id}:`,
    `    by: ${by}`,
    '    at: 2026-10-13T22:40Z',
    ...more.map((line) => `    ${line}`),
    '    text: |-',
    `      ${text}`,
  ];
}

/** The first line of every ledger (format §5.5). */
export const LEDGER_NOTE =
  "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.";

/**
 * A file with the given body and a ledger in the form `serializeLedger` writes, so that saving it
 * again changes nothing. `marks` gives the author of each mark by id, in the order of the
 * document; Ada and Bo are the people; `threads` are the lines of the `comments` key (see `thread`).
 */
export function file(
  body: string,
  marks: Record<string, string> = {},
  threads: string[] = [],
): string {
  const lines = ['<!-- redlines', LEDGER_NOTE, 'version: 1', 'people:'];
  lines.push('  ada: {name: Ada Lovelace}', '  bo: {name: Bo Chen}');
  const entries = Object.entries(marks);
  if (entries.length > 0) {
    lines.push('marks:');
    for (const [id, by] of entries) lines.push(`  ${id}: {by: ${by}, at: 2026-10-13T22:30Z}`);
  }
  if (threads.length > 0) lines.push('comments:', ...threads);
  lines.push('-->');
  return `${body}\n\n${lines.join('\n')}\n`;
}

/** A file without its ledger: the body, as it looks after an edit. */
export function bodyOf(text: string): string {
  const range = parse(text).ledgerRange;
  return range ? text.slice(0, range.from) : text;
}

/** The ids of the marks of a file, with the comment threads, in document order. */
export function idsOf(text: string): string[] {
  return parse(text).marks.map((mark) => mark.id);
}

/** Warnings that mean marks and ledger do not match, or a marker where a renderer would read the
 * rest of its line as raw HTML (format §3.2): what no edit should leave behind. */
const STRUCTURAL = new Set([
  'unclosed-mark',
  'unopened-close',
  'kind-mismatch',
  'duplicate-id',
  'missing-entry',
  'orphan-entry',
  'orphan-thread',
  'bad-ledger',
]);

export function problemsOf(parsed: Parsed): string[] {
  return parsed.warnings
    .filter((w) => STRUCTURAL.has(w.code))
    .map((w) => `${w.code} ${w.id ?? ''}`.trim());
}

/** Insertions never hold insertions (format §3.6): the ids of those that sit in the text of an
 * insertion or substitution. */
export function nestedInsertions(parsed: Parsed): string[] {
  const nested: string[] = [];
  for (const outer of parsed.marks) {
    if (outer.kind !== 'ins' && outer.kind !== 'sub') continue;
    for (const holder of outer.segments) {
      if (!holder.close) continue;
      for (const inner of parsed.marks) {
        if (inner.kind !== 'ins' || inner.id === outer.id) continue;
        const inside = inner.segments.some(
          (s) => s.close && s.open.from >= holder.content.from && s.close.to <= holder.content.to,
        );
        if (inside) nested.push(inner.id);
      }
    }
  }
  return nested;
}

/** The codes of the errors a random edit may end in: it was refused, and the file is as it was. */
export const REFUSALS: readonly string[] = [
  'no-legal-placement',
  'would-hide-marks',
  'inside-code',
  'front-matter',
];

/** The text without the white space that Markdown ignores: spaces next to a line break, without
 * the line break at the end, and runs of spaces. A change at the start of a block or at a break
 * may keep a space more or less than a plain edit of the text would; the random tests compare the
 * words and the breaks. */
export function squash(text: string): string {
  return text
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/^ /, '')
    .replace(/\n+$/, '');
}

/** Whether the text has an empty block: a paragraph with nothing in it, or a bullet, quote or
 * heading with no text. A deletion of all the text of a block takes a break with it, so that none
 * is left (format §3.4). */
export function hasEmptyBlock(text: string): boolean {
  return (
    /^[ \t]*\n/.test(text) ||
    /\n[ \t>]*\n[ \t>]*\n/.test(text) ||
    /^(?:[-*+>]|\d+\.|#{1,6})[ \t]*$/m.test(text)
  );
}

/** A line with a prefix and nothing after it: a bullet, a number, a quote marker or `#`s. */
const EMPTY_LINE = String.raw`(?:(?:[ \t]*(?:[-*+>]|\d+[.)]))+[ \t]*|[ \t]*#{1,6}[ \t]*)`;

/** The text with its empty blocks taken out, each with one break: what a deletion of all the text of
 * a block leaves (format §3.4). The blank lines that are left are one. Front matter stays as it
 * is, and the body after it is read as a file of its own (format §3.8). */
export function dropEmptyBlocks(text: string): string {
  const start = bodyStart(text);
  return text.slice(0, start) + dropEmptyBlocksOfBody(text.slice(start));
}

function dropEmptyBlocksOfBody(text: string): string {
  return (
    text
      // A bullet with its text on the next line, indented, is the same item as one with the text on it.
      .replace(/^((?:[ \t]*(?:[-*+>]|\d+[.)]))+)[ \t]*\n[ \t]+(?=\S)/gm, '$1 ')
      .replace(new RegExp(`^${EMPTY_LINE}(?:\\n|$)`, 'gm'), '')
      .replace(new RegExp(`\\n+${EMPTY_LINE}$`), '')
      .replace(/^\n+/, '')
      .replace(/\n{3,}/g, '\n\n')
  );
}

/** A line of a body with a prefix and nothing else: a bullet or a number and its space, a quote
 * marker or `#`s. No text and no marker is on it; a lone `*` of the text is not one. */
const PREFIX_ONLY = /^(?:(?:[ \t]*(?:[-*+]|\d+[.)])[ \t]+|[ \t]*>[ \t]?)+|[ \t]*#{1,6}[ \t]*)$/gm;

/**
 * How many lines of a file have a prefix and nothing else: an empty block. An edit leaves no more
 * of them than the file had (format §3.4): the prefix of a block goes with its text. The carriers
 * of the openers, whose lines are made of the prefix (`>`), are not looked at, and a block that
 * holds only a pending mark has the marker on its line and is none. This is how the random tests
 * see a `> `, a `- ` or a `## ` that an edit leaves behind, which `dropEmptyBlocks` takes out of
 * the views they compare.
 */
export function emptyBlockLines(text: string): number {
  const parsed = parse(text);
  const carriers = parsed.marks
    .flatMap((mark) => mark.segments.map((segment) => segment.carrier))
    .filter((range): range is Range => range !== undefined)
    .toSorted((a, b) => a.from - b.from);
  let body = '';
  let at = 0;
  for (const carrier of carriers) {
    body += text.slice(at, carrier.from);
    at = Math.max(at, carrier.to);
  }
  body += text.slice(at, parsed.ledgerRange?.from ?? text.length);
  return (body.match(PREFIX_ONLY) ?? []).length;
}

/** The text with the numbers of its list items all the same: deleting the first item of a numbered
 * list numbers the next one from the start of the list. */
export function renumbered(text: string): string {
  return text.replace(/^([ \t]*)\d+([.)])/gm, '$11$2');
}

/** The text as far as the blocks go: the numbers of a list and the blank lines between blocks are
 * what a deletion of a whole block may change, because the blocks around it stay as they are. */
export function blocksOnly(text: string): string {
  return renumbered(text).replace(/\n+/g, '\n').trimEnd();
}

/** A block of a view: where its first line starts (in front of its prefix), where its text starts,
 * where the text of its last line ends, and where the line of the next block starts. */
export interface ViewBlock {
  line: number;
  text: number;
  end: number;
  next: number;
}

/**
 * The blocks of a view of plain paragraphs, list items, quotes and headings, such as the random
 * documents hold: a block starts after a blank line, or with a bullet, a number, a `>` after a line
 * that is not a quote, or a heading. A number starts a block after a line of a paragraph only when
 * it is 1, or when it goes on a list (CommonMark). Front matter is no block, and the line after it
 * starts the body as the first line of a file does (format §3.8).
 */
export function viewBlocks(view: string): ViewBlock[] {
  const lines: { start: number; text: string }[] = [];
  let at = 0;
  for (const text of view.split('\n')) {
    lines.push({ start: at, text });
    at += text.length + 1;
  }
  const body = bodyStart(view);
  const starts: number[] = [];
  // Whether a line since the last blank line is an item: a number then goes on the list.
  let list = false;
  lines.forEach((line, i) => {
    if (line.start < body) return;
    if (line.text.trim() === '') {
      list = false;
      return;
    }
    const previous = lines[i - 1]?.text ?? '';
    const blank = line.start === body || previous.trim() === '';
    const number = /^(\d+)[.)][ \t]/.exec(line.text)?.[1];
    const listItem =
      /^[-*+][ \t]/.test(line.text) ||
      (number !== undefined && (blank || Number(number) === 1 || list));
    const item = listItem || /^#{1,6}[ \t]/.test(line.text);
    const quote = line.text.startsWith('>') && !previous.startsWith('>');
    if (blank || item || quote) starts.push(i);
    if (listItem) list = true;
  });
  return starts.map((index, n) => {
    const first = lines[index] as { start: number; text: string };
    let last = (starts[n + 1] ?? lines.length) - 1;
    while (last > index && (lines[last]?.text ?? '').trim() === '') last--;
    const final = lines[last] as { start: number; text: string };
    const next = starts[n + 1];
    return {
      line: first.start,
      text:
        first.start +
        prefixLength(first.text) +
        (/^#{1,6}[ \t]+/.exec(first.text)?.[0].length ?? 0),
      end: final.start + final.text.length,
      next: next === undefined ? view.length : (lines[next]?.start ?? view.length),
    };
  });
}

/** The offsets of a view where an edit may start or end: in the text of a line, after its
 * prefix, which no change of the text edits. */
export function naturalOffsets(view: string): number[] {
  const offsets: number[] = [];
  let start = 0;
  for (const line of view.split('\n')) {
    const prefix = prefixLength(line);
    const heading = /^#{1,6}[ \t]+/.exec(line.slice(prefix))?.[0].length ?? 0;
    if (line.slice(prefix + heading).trim() !== '') {
      for (let i = start + prefix + heading; i <= start + line.length; i++) offsets.push(i);
    }
    start += line.length + 1;
  }
  return offsets;
}

/**
 * An edit of a view for a random test: typing, deleting or replacing, in the text of a block. The
 * edits that most often go wrong are the ones it is likely to pick: the start of a paragraph, of a
 * list item or of a quote line, the start of a wrapped line, the end of a line, and the places
 * inside a link or an image; and the deletion of whole blocks, which has `blocks`: the plain
 * edit of the view that the blocks around the deleted ones are left as they are by.
 */
export function randomEdit(
  below: (n: number) => number,
  view: string,
  inserts: readonly string[],
): TextChange & { blocks?: TextChange } {
  const offsets = naturalOffsets(view);
  const starts = offsets.filter(
    (offset) =>
      offset === 0 ||
      view[offset - 1] === '\n' ||
      /^[-*+>] |^\d+\. /.test(view.slice(Math.max(0, offset - 3), offset)),
  );
  // Inside a link or an image, and next to emphasis.
  const constructs = offsets.filter((offset) =>
    /\]\(|!\[|https?:|&\w+;|\*\*|_/.test(view.slice(Math.max(0, offset - 4), offset + 4)),
  );
  // A range of whole blocks, from the first column of the first to the first column of the block
  // after the last (or to the end of its text), which leaves the neighbours as they are.
  const blocks = viewBlocks(view);
  if (blocks.length > 0 && below(5) === 0) {
    const first = below(blocks.length);
    const last = Math.min(blocks.length - 1, first + below(2));
    const one = blocks[first] as ViewBlock;
    const two = blocks[last] as ViewBlock;
    // Whole blocks are gone from the first column of the first to that of the block after them,
    // whether the range starts in front of the prefix of the first or after it, and ends with the
    // text of the last or with the break after it.
    return {
      from: below(2) === 0 ? one.line : one.text,
      to: below(3) === 0 ? two.end : two.next,
      insert: '',
      blocks: { from: one.line, to: two.next, insert: '' },
    };
  }
  const roll = below(3);
  const pool =
    roll === 0 && starts.length > 0
      ? starts
      : roll === 1 && constructs.length > 0
        ? constructs
        : offsets;
  const from = pool[below(pool.length)] ?? 0;
  const insert = inserts[below(inserts.length)] ?? '';
  const kind = below(3);
  if (kind === 0) return { from, to: from, insert };
  const later = offsets.filter((offset) => offset > from && offset <= from + 14);
  const to = later[below(later.length)] ?? from;
  return { from, to, insert: kind === 1 ? '' : insert };
}

/** A prefix as CommonMark has it: the marker of the outermost container and one space, or the
 * `#`s of a heading and one space. The markers inside it may stand behind a hidden opener, where
 * the view has them next to the first and the file does not. */
const SHORT_PREFIX = /^[ \t]*(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t])|^#{1,6}[ \t]/;

/** What `prefixEdit` types in place of a part of a prefix. */
const PREFIX_INSERTS = ['', '', '1', '7', '10', '*', '- ', '> ', '## ', '2. ', 'x', ' '];

/**
 * An edit inside the prefix of a block of a view, such as the renumbering of a list item: a part of
 * the `- `, `> `, `5. ` or `## ` of a line, or all of it, replaced by a number, a bullet, text or
 * nothing. It is a range: text typed at a point in a prefix goes after it. It never goes on into
 * the text of the line: that is another edit, where the prefix stays. Not the first line of the
 * view. Undefined when no other line has a prefix.
 */
export function prefixEdit(
  below: (n: number) => number,
  view: string,
  inserts: readonly string[] = PREFIX_INSERTS,
): TextChange | undefined {
  const prefixes: { start: number; length: number }[] = [];
  let start = 0;
  for (const line of view.split('\n')) {
    // The marker and one space: more spaces are the text of the line, which Markdown ignores.
    const length = SHORT_PREFIX.exec(line)?.[0].length ?? 0;
    // The first line has no break in front of it to take the marker: a change of its prefix has no
    // place (format §3.1).
    if (length > 0 && start > 0) prefixes.push({ start, length });
    start += line.length + 1;
  }
  const found = prefixes[below(prefixes.length)];
  if (!found) return undefined;
  const from = found.start + below(found.length);
  const to = from + 1 + below(found.start + found.length - from);
  return { from, to, insert: inserts[below(inserts.length)] ?? '' };
}

/** What `editedDocument` types. */
const EDITED_INSERTS = ['x', 'new words', '\n', '\n\n', ' ', '**', 'one\n\ntwo', '- item'];

/**
 * A random document after a few random tracked edits by Ada, Bo and Claude, one after the other:
 * the whole-block insertions and deletions, splits and closers in front of openers that the
 * documents of `randomDocument` do not have, for the tests of what is done to such documents. An
 * edit that is refused is left out.
 */
export function editedDocument(seed: number, steps = 4): string {
  const random = seeded(seed * 7919);
  const below = (n: number) => Math.floor(random() * n);
  let text = randomDocument(seeded(seed));
  for (let step = 0; step < steps; step++) {
    const view = newestView(text);
    const author = [ada, bo, claudeAda][below(3)] as Person;
    const wanted = randomEdit(below, view.text, EDITED_INSERTS);
    // An edit stops at the end of the body, as the editor's do.
    const stop = parse(text).ledgerRange?.from ?? Infinity;
    // The point of an insertion is on either side of the markers; the ends of a range stay on its
    // text.
    const point = view.map.toSource(wanted.from, below(2) === 0 ? -1 : 1);
    const placed =
      wanted.from === wanted.to
        ? { from: point, to: point }
        : { from: view.map.toSource(wanted.from, 1), to: view.map.toSource(wanted.to, -1) };
    const at = seeded(seed * 104729 + step);
    const ctx: EditContext = {
      author,
      time: TIME,
      random: (n) => Uint8Array.from({ length: n }, () => Math.floor(at() * 256)),
    };
    const edit = {
      from: Math.min(placed.from, stop),
      to: Math.min(Math.max(placed.from, placed.to), stop),
      insert: wanted.insert,
    };
    try {
      text = applyChanges(text, trackedEdit(text, edit, ctx));
    } catch (error) {
      if (!(error instanceof EditError && REFUSALS.includes(error.code ?? ''))) throw error;
    }
  }
  return text;
}

/** The number of markers that start a line that has other text (format §3.2), in the body: text
 * after the ledger is no paragraph. */
function lineStarts(parsed: Parsed): number {
  const end = parsed.ledgerRange?.from ?? Infinity;
  return parsed.warnings.filter(
    (warning) => warning.code === 'line-start-marker' && (warning.range?.from ?? 0) < end,
  ).length;
}

/** The markers of the marks of a parse that start on or before `end`. */
function markersUpTo(parsed: Parsed, end: number): number {
  return parsed.marks
    .flatMap((mark) => mark.segments.flatMap((s) => (s.close ? [s.open, s.close] : [s.open])))
    .filter((range) => range.from <= end).length;
}

/** No edit makes a marker start a line that has other text (format §3.2): not one that it wrote and
 * not one of the file's that it moved, whoever they are by and whether or not their mark grew. An
 * opener at the start of a block has the form of format §3.3 instead. Nor does it put one in front
 * matter or on its closing line, which would no longer close it for Pandoc, Quarto, Jekyll or Hugo
 * (format §3.8): where a view still has the front matter, with its closing line and the line break
 * after it, no more markers start up to the end of that line than before. (Track Changes off, the
 * front matter is text like any other, and an edit may take it apart.) */
export function expectNoNewLineStarts(label: string, before: Parsed, after: Parsed): void {
  expect(lineStarts(after), `${label}: a marker starts a line`).toBeLessThanOrEqual(
    lineStarts(before),
  );
  const front = frontMatterEnd(before.text);
  const kept = before.text.slice(0, bodyStart(before.text));
  const views = () => [newestView(after.text).text, originalView(after.text).text];
  if (front >= 0 && views().some((view) => view.startsWith(kept))) {
    expect(
      markersUpTo(after, front),
      `${label}: a marker in front matter: ${JSON.stringify(after.text.slice(0, front + 40))}`,
    ).toBeLessThanOrEqual(markersUpTo(before, front));
  }
}

/** What every edit must leave: marks and ledger that match, the ledger written the way
 * `setLedger` would write it again, and the threads there should be. */
export function expectInOrder(label: string, threads: string[], after: string): Parsed {
  const parsed = parse(after);
  expect(problemsOf(parsed), label).toEqual([]);
  expect(nestedInsertions(parsed), `${label}: insertions inside insertions`).toEqual([]);
  expect(setLedger(after, parsed.ledger), `${label}: the ledger is not canonical`).toEqual([]);
  expect(
    parsed.ledger.comments.map((t) => t.id),
    `${label}: threads`,
  ).toEqual(threads);
  return parsed;
}

/** The body of a file, ending in one line break: a ledger leaves a blank line in front of it. */
const bodyEnd = (text: string) => `${bodyOf(text).replace(/[\r\n]+$/, '')}\n`;

/** What a file reads as, on both readings of CommonMark. */
export const reading = (text: string): string[] => [
  plainBody(text, isPunctuation),
  plainBody(text, isOlderPunctuation),
];

/** The file with one decision made, or undefined where it has no form. */
function decided(text: string, id: string, state: 'a' | 'r'): string | undefined {
  try {
    return applyChanges(text, state === 'a' ? accept(text, id) : reject(text, id));
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
}

/**
 * Every order of accepting and rejecting every mark of `after` (up to `limit` of them), with every
 * mark left pending on the way. Each state is compared with the same decisions of `before`, whose
 * marks are those of `after` but `fresh`: it reads the same, and once all of `fresh` is rejected it
 * has the same bytes, unless `inPlace`. A decision works in one exactly when it works in the other.
 * Returns how many states were looked at.
 */
export function expectEveryDecision(
  label: string,
  before: string,
  after: string,
  fresh: readonly string[],
  {
    inPlace = false,
    limit = 6,
    structure,
    alsoChanged = 0,
  }: {
    inPlace?: boolean;
    limit?: number;
    /** Compare the block structure too, as CommonMark reads it: the change's blocks as this op
     * makes them, once its marks are pending or accepted, and every other block as it was. */
    structure?: FormatOp;
    /** How many more blocks the change made as the op asks, with marks of the author's own that
     * it changed in place or took away. */
    alsoChanged?: number;
  } = {},
): number {
  const decidable = (text: string) => parse(text).marks.filter((mark) => mark.kind !== 'cmt');
  if (decidable(after).length > limit) return 0;
  const isFresh = new Set(fresh);
  const seen = new Set<string>();
  const visit = (a: string, b: string, path: string, acceptedFresh: boolean) => {
    const key = `${String(acceptedFresh)}\u0000${a}\u0000${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    const state = `${label}:${path} => ${JSON.stringify(bodyOf(a))}`;
    expect(reading(a), state).toEqual(reading(b));
    if (structure) {
      const rejected = fresh.filter((id) => path.includes(` r${id}`)).length;
      expectBlocksAs(state, a, b, structure, fresh.length - rejected + alsoChanged);
    }
    const marks = decidable(a);
    const freshLeft = marks.some((mark) => isFresh.has(mark.id));
    if (!inPlace && !freshLeft && !acceptedFresh) expect(bodyEnd(a), state).toBe(bodyEnd(b));
    const inB = new Set(parse(b).marks.map((mark) => mark.id));
    for (const { id } of marks) {
      for (const action of ['a', 'r'] as const) {
        const step = `${path} ${action}${id}`;
        const nextA = decided(a, id, action);
        if (isFresh.has(id)) {
          expect(nextA, `${label}:${step} refused`).toBeDefined();
          if (nextA !== undefined) visit(nextA, b, step, acceptedFresh || action === 'a');
          continue;
        }
        if (!inB.has(id)) continue;
        const nextB = decided(b, id, action);
        if (nextB === undefined) {
          expect(nextA, `${label}:${step} works only after the change`).toBeUndefined();
          continue;
        }
        expect(nextA, `${label}:${step} refused only after the change`).toBeDefined();
        if (nextA !== undefined) visit(nextA, nextB, step, acceptedFresh);
      }
    }
  };
  visit(after, before, '', false);
  return seen.size;
}

/** A leaf block as CommonMark reads it: the containers it is in, its kind, and its text. */
export interface Leaf {
  chain: string[];
  kind: string;
  text: string;
  /** For a table: the rendered text of each cell, row by row, the header row first. */
  rows?: string[][];
}

/**
 * The leaf blocks of a file's body as micromark, a CommonMark reader, renders it: each paragraph,
 * heading, code block or rule, with the lists, items and quotes around it, and its text without
 * markers. The number of an ordered item is left out: renumbering is not a change of structure.
 * Front matter is no block of the body. The file is GitHub Flavored Markdown (format §9.1), so its
 * tables and strikethrough are read as GFM reads them: a table is one leaf of kind `table`, whose
 * text has its cells parted by ` | ` and its rows by ` || `.
 */
export function blockLeaves(text: string): Leaf[] {
  const range = parse(text).ledgerRange;
  // After the front matter, which a reader that knows it, as Pandoc, Quarto, Jekyll and Hugo do,
  // reads as no block (format §3.8). micromark would read it as a rule and a heading or more text.
  const body = (range ? text.slice(0, range.from) : text)
    .slice(bodyStart(text))
    .replace(/\r\n?/g, '\n');
  const html = micromark(body, {
    allowDangerousHtml: true,
    extensions: [gfmTable(), gfmStrikethrough()],
    htmlExtensions: [gfmTableHtml(), gfmStrikethroughHtml()],
  });
  const leaves: Leaf[] = [];
  const stack: string[] = [];
  let leaf: { kind: string; text: string; tag: string } | undefined;
  const clean = (text: string) =>
    text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const close = () => {
    if (!leaf) return;
    leaves.push({ chain: [...stack], kind: leaf.kind, text: clean(leaf.text) });
    leaf = undefined;
  };
  /** The rows of the table being read, each a list of its cells' text. */
  let table: string[][] | undefined;
  /** The text of the cell being read. */
  let cell: string | undefined;
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)|</g)) {
    const [all, slash, name, , words] = match;
    const tag = (name ?? '').toLowerCase();
    if (table) {
      if (tag === 'table' && slash === '/') {
        leaves.push({
          chain: [...stack],
          kind: 'table',
          text: table.map((row) => row.join(' | ')).join(' || '),
          rows: table,
        });
        table = undefined;
      } else if (tag === 'tr' && slash !== '/') table.push([]);
      else if ((tag === 'th' || tag === 'td') && slash !== '/') cell = '';
      else if ((tag === 'th' || tag === 'td') && cell !== undefined) {
        table.at(-1)?.push(clean(cell));
        cell = undefined;
      } else if (
        cell !== undefined &&
        (words !== undefined || all === '<' || all.startsWith('<!--'))
      )
        cell += words ?? all;
      continue;
    }
    if (all.startsWith('<!--')) {
      if (leaf) leaf.text += all;
      continue;
    }
    if (words !== undefined || all === '<') {
      const piece = words ?? '<';
      if (leaf) leaf.text += piece;
      else if (piece.trim() !== '')
        leaf = { kind: stack.at(-1) === 'li' ? 'p' : 'html', text: piece, tag: '' };
      continue;
    }
    if (tag === 'table' && slash !== '/') {
      if (leaf && leaf.tag === '') close();
      table = [];
      continue;
    }
    if (!/^(?:ul|ol|li|blockquote|p|h[1-6]|pre|hr)$/.test(tag)) continue;
    if (leaf && leaf.tag === '') close();
    if (slash === '/') {
      if (leaf && tag === leaf.tag) close();
      else if (stack.at(-1) === tag) stack.pop();
      continue;
    }
    if (tag === 'ul' || tag === 'ol' || tag === 'li' || tag === 'blockquote') stack.push(tag);
    else if (tag === 'hr') leaves.push({ chain: [...stack], kind: 'hr', text: '' });
    else leaf = { kind: tag === 'pre' ? 'code' : tag, text: '', tag };
  }
  close();
  return leaves;
}

/**
 * The indented code blocks of `text[from, to)` as micromark, a CommonMark reader, reads them: each
 * from where the code's indentation starts on its first line, after the prefix of its container,
 * to the end of its last line.
 */
export function micromarkIndentedCode(text: string, from = 0, to = text.length): Range[] {
  const chunks = micromarkPreprocess()(text.slice(from, to), undefined, true);
  const events = micromarkPostprocess(micromarkParse().document().write(chunks));
  const ranges: Range[] = [];
  for (const [kind, token] of events) {
    if (kind !== 'enter' || token.type !== 'codeIndented') continue;
    ranges.push({ from: from + token.start.offset, to: from + token.end.offset });
  }
  return ranges;
}

/**
 * The markers of a file that stand in indented code as micromark reads it, which every renderer
 * shows as code (format §2.1): in the file, where its markers are HTML comments, and in its newest
 * and its original view, at the places the markers map to there, after the start of the code's
 * first line and up to the end of its last line (a marker on a blank line between two of its lines
 * breaks the block in two). Each is named by its kind (`/` for a closer), its id and where it is.
 */
export function markersInIndentedCode(text: string): string[] {
  const limit = parse(text).ledgerRange?.from ?? text.length;
  const markers = scan(text).markers.filter((marker) => marker.to <= limit);
  const name = (marker: Marker) => `${marker.type === 'open' ? marker.kind : '/'} ${marker.id}`;
  const found: string[] = [];
  for (const code of micromarkIndentedCode(text, bodyStart(text), limit)) {
    for (const marker of markers) {
      if (marker.from < code.to && code.from < marker.to) found.push(`${name(marker)} in the file`);
    }
  }
  for (const [label, view] of [
    ['newest', newestView(text)],
    ['original', originalView(text)],
  ] as const) {
    const codes = micromarkIndentedCode(view.text, bodyStart(view.text));
    for (const marker of markers) {
      const at = view.map.fromSource(marker.from);
      if (codes.some((code) => code.from < at && at <= code.to)) {
        found.push(`${name(marker)} in the ${label} view`);
      }
    }
  }
  return found;
}

/**
 * Expects the leaves of `a` to be those of `b`, with at most `changed` of them as `op` makes a block:
 * the same text in the same order, the same containers and kinds but for those.
 */
export function expectBlocksAs(
  label: string,
  a: string,
  b: string,
  op: FormatOp,
  changed: number,
): void {
  const now = blockLeaves(a);
  const was = blockLeaves(b);
  const show = `${label}\n  is  ${JSON.stringify(now)}\n  was ${JSON.stringify(was)}`;
  expect(now.length, show).toBe(was.length);
  let differ = 0;
  /** A chain with the kinds of its lists left out: the items under a list item whose type changed
   * are in a list of the new type, as they should be. */
  const shape = (chain: string[]) => chain.map((c) => (c === 'ol' ? 'ul' : c)).join('>');
  /** How deep the list item that a list type change changed is, while its blocks follow. */
  let item = Infinity;
  for (const [i, leaf] of now.entries()) {
    const old = was[i]!;
    // The structure: the kind and the containers. Words are what `reading` compares.
    const same = leaf.kind === old.kind;
    if (same && leaf.chain.join('>') === old.chain.join('>')) {
      item = Infinity;
      continue;
    }
    // The other blocks of an item whose list type changed, and those under it, are in a list of
    // the new type, as they should be.
    const inItem = leaf.chain.length >= item && shape(leaf.chain) === shape(old.chain);
    if (same && op.kind === 'block' && inItem) continue;
    item = leaf.chain.length;
    differ++;
    expect(
      changed > 0 && op.kind !== 'inline' && op.kind !== 'link' && op.kind !== 'clear',
      show,
    ).toBe(true);
    if (op.kind === 'block') {
      const outer = (chain: string[]) =>
        chain.at(-1) === 'blockquote'
          ? chain.slice(0, -1)
          : chain.length >= 2 && /^(?:ul|ol)$/.test(chain.at(-2) ?? '')
            ? chain.slice(0, -2)
            : chain;
      const inner = leaf.chain.slice(outer(leaf.chain).length).join('>');
      const kinds: Record<string, [string, string]> = {
        p: ['', 'p'],
        ul: ['ul>li', 'p'],
        ol: ['ol>li', 'p'],
        task: ['ul>li', 'p'],
        quote: ['blockquote', 'p'],
      };
      const [chain, kind] = kinds[op.to] ?? ['', op.to];
      if (op.to === 'quote') expect(leaf.chain.join('>'), show).toBe('blockquote');
      else if (chain === '') expect(leaf.chain, show).toEqual(outer(old.chain));
      else expect(inner, show).toBe(chain);
      expect(leaf.kind, show).toBe(kind);
      if (op.to === 'task') expect(leaf.text, show).toMatch(/^\[[ xX]\] /);
    } else if (op.kind === 'indent') {
      expect(leaf.kind, show).toBe(old.kind);
      expect(leaf.chain.length - old.chain.length, show).toBe(2 * op.by);
    } else if (op.kind === 'check') {
      expect(leaf.chain, show).toEqual(old.chain);
    }
  }
  if (op.kind !== 'indent') expect(differ, show).toBeLessThanOrEqual(changed);
}

/** What a file reads as once every change is decided: its leaf blocks as CommonMark reads them. */
const leavesOf = (text: string): string => JSON.stringify(blockLeaves(text));

/** What a file reads as once every change is decided: its text, exactly. */
export const exactly = (text: string): string => newestView(text).text;

/**
 * What deciding the changes of a file comes to in every order, accepting or rejecting each, as
 * CommonMark reads it (or as `read` reads it): for each set of decisions, the leaf blocks
 * (`blockLeaves`) that the orders which go through give. A decision that is refused ends that
 * order. `stuck` holds the files from which no decision can be made, while changes are left.
 */
export function everyOrder(
  text: string,
  read: (text: string) => string = leavesOf,
): { outcomes: Map<string, Set<string>>; stuck: string[] } {
  const outcomes = new Map<string, Set<string>>();
  const stuck: string[] = [];
  const seen = new Set<string>();
  const walk = (current: string, decided: string[]) => {
    const key = `${current}|${decided.toSorted().join(' ')}`;
    if (seen.has(key)) return;
    seen.add(key);
    const left = [
      ...new Set(
        parse(current)
          .marks.filter((mark) => mark.kind !== 'cmt' && mark.kind !== 'hl')
          .map((mark) => mark.id),
      ),
    ];
    if (left.length === 0) {
      const set = decided.toSorted().join(' ');
      const results = outcomes.get(set) ?? new Set<string>();
      results.add(read(current));
      outcomes.set(set, results);
      return;
    }
    let any = false;
    for (const id of left) {
      for (const [how, decide] of [
        ['a', accept],
        ['r', reject],
      ] as const) {
        let next: string;
        try {
          next = applyChanges(current, decide(current, id));
        } catch (error) {
          if (error instanceof EditError) continue;
          throw error;
        }
        any = true;
        walk(next, [...decided, `${how}${id}`]);
      }
    }
    if (!any) stuck.push(current);
  };
  walk(text, []);
  return { outcomes, stuck };
}

/** Expects every order of deciding the changes of a file to read the same for the same decisions,
 * and no order to come to a file where nothing can be decided. `read` is what is compared: the
 * blocks as CommonMark reads them, or `exactly` the text. */
export function expectEveryOrderAlike(
  label: string,
  text: string,
  read: (text: string) => string = leavesOf,
): void {
  const { outcomes, stuck } = everyOrder(text, read);
  for (const [decided, results] of outcomes) {
    expect([...results], `${label}: ${decided}`).toHaveLength(1);
  }
  expect(stuck, `${label}: stuck`).toEqual([]);
}

/**
 * Decides the changes of a file one at a time, accepting or rejecting each, in every order, and fails
 * on a decision that is refused: every single decision must be possible in every order, whatever else is
 * pending. (`everyOrder` lets a refusal end an order; this does not.) Returns how many states it saw.
 *
 * `rule` names what a refusal may rest on besides the file's own marks: with `unlessWithout`, a refusal
 * is allowed when the same decision is refused in the same state with its alignment changes rejected
 * first (the rules of rows, columns and edits that the file has without them; they are counted in
 * `refusedWithout`), and fails otherwise: the alignment change is what made it impossible.
 */
export function expectNoDecisionRefused(
  label: string,
  text: string,
  options: { unlessWithout?: boolean; refusedWithout?: { count: number } } = {},
): number {
  const seen = new Set<string>();
  const isAlign = (m: { kind: string; payload?: string }) =>
    m.kind === 'fmt' && /^align=/.test(m.payload ?? '');
  /** The state with its alignment changes rejected, or undefined where that is itself refused. */
  const without = (current: string): string | undefined => {
    let state = current;
    try {
      for (let n = 0; n < 4; n++) {
        const mark = parse(state).marks.find(isAlign);
        if (!mark) return state;
        state = applyChanges(state, reject(state, mark.id));
      }
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
    }
    return undefined;
  };
  const walk = (current: string, path: string[]) => {
    if (seen.has(current)) return;
    seen.add(current);
    const left = [
      ...new Set(
        parse(current)
          .marks.filter((mark) => mark.kind !== 'cmt' && mark.kind !== 'hl')
          .map((mark) => mark.id),
      ),
    ];
    for (const id of left) {
      for (const [how, decide] of [
        ['accept', accept],
        ['reject', reject],
      ] as const) {
        let next: string;
        try {
          next = applyChanges(current, decide(current, id));
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
          if (
            options.unlessWithout &&
            !parse(current).marks.some((m) => m.id === id && isAlign(m))
          ) {
            const bare = without(current);
            let alsoRefused = false;
            if (bare !== undefined) {
              try {
                decide(bare, id);
              } catch (again) {
                if (!(again instanceof EditError)) throw again;
                alsoRefused = true;
              }
            }
            if (alsoRefused) {
              if (options.refusedWithout) options.refusedWithout.count++;
              continue;
            }
          }
          throw new Error(
            `${label}: ${how} ${id} is refused after [${path.join(', ')}]: ${error.message}\n${current}`,
            { cause: error },
          );
        }
        walk(next, [...path, `${how} ${id}`]);
      }
    }
  };
  walk(text, []);
  return seen.size;
}

/**
 * Whether the steps of a random table (`who {json}` each) have a bold change, then a row move, then
 * a typed edit: such a table reads two ways in one order of decisions. The same on main (3ee31ae),
 * in tables with outer pipes or without or with leading pipes only: issue #295. The random suites
 * skip these tables until it is fixed.
 */
export function boldMoveEdit(steps: readonly string[]): boolean {
  const bold = steps.findIndex((step) => step.includes('"kind":"bold"'));
  const move = steps.findIndex((step, i) => i > bold && step.includes('"kind":"moveRows"'));
  return (
    bold !== -1 && move !== -1 && steps.some((step, i) => i > move && step.includes('"insert":'))
  );
}
