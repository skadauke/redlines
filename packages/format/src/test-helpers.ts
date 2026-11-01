// Helpers shared by the tests of the editing functions. They are not part of the package.

import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { prefixLength } from './blocks.ts';
import { setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import type { EditContext, Parsed, Person, TextChange } from './types.ts';

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
 * a block leaves (format §3.4). The blank lines that are left are one. */
export function dropEmptyBlocks(text: string): string {
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
 * that is not a quote, or a heading.
 */
export function viewBlocks(view: string): ViewBlock[] {
  const lines: { start: number; text: string }[] = [];
  let at = 0;
  for (const text of view.split('\n')) {
    lines.push({ start: at, text });
    at += text.length + 1;
  }
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (line.text.trim() === '') return;
    const previous = lines[i - 1]?.text ?? '';
    const blank = i === 0 || previous.trim() === '';
    const item = /^(?:[-*+]|\d+[.)])[ \t]/.test(line.text) || /^#{1,6}[ \t]/.test(line.text);
    const quote = line.text.startsWith('>') && !previous.startsWith('>');
    if (blank || item || quote) starts.push(i);
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

/** The number of markers that start a line that has other text (format §3.2), in the body: text
 * after the ledger is no paragraph. */
function lineStarts(parsed: Parsed): number {
  const end = parsed.ledgerRange?.from ?? Infinity;
  return parsed.warnings.filter(
    (warning) => warning.code === 'line-start-marker' && (warning.range?.from ?? 0) < end,
  ).length;
}

/** No edit makes a marker start a line that has other text (format §3.2): not one that it wrote and
 * not one of the file's that it moved, whoever they are by and whether or not their mark grew. An
 * opener at the start of a block has the form of format §3.3 instead. */
export function expectNoNewLineStarts(label: string, before: Parsed, after: Parsed): void {
  expect(lineStarts(after), `${label}: a marker starts a line`).toBeLessThanOrEqual(
    lineStarts(before),
  );
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
