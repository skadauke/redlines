// micromark as the oracle of what a tracked file reads as (tests only): every renderer that does
// not know the markers sees them as HTML comments, so the body of a file must read as its newest
// view does, in the file as it is and after each decision, in every order.

import { micromark } from 'micromark';
import { gfmStrikethrough, gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';
import { expect } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { payloadMarksOf } from './payload-marks.ts';
import { bodyOf, everyOrder, exactly } from './test-helpers.ts';
import { newestView } from './views.ts';

/** The block-level tags micromark writes, and the names of CommonMark's HTML blocks (§4.6). */
const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|pre|script|search|section|style|summary|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|ul';

/**
 * The line break after `<li>`, to drop (`readAs`), except in front of what starts a block there: a
 * block tag of either case, a declaration, comment or processing instruction (`<!`, `<?`), and any
 * tag alone on its line, which is an HTML block (a custom tag, `<my-tag>`) and not inline text.
 */
const AFTER_LI_OPENER = new RegExp(
  `(<li>)\\n+(?!<[!?]|</?(?:${BLOCK_TAGS})[\\s>/]|</?[a-z][\\w-]*(?:\\s[^>]*)?>[ \\t]*(?:\\n|$|</li>))`,
  'gi',
);

/** The HTML micromark makes of a text, with GFM's tables and strikethrough, without the HTML
 * comments (the markers), and without the white space that Markdown does not show (before a line
 * break, a closing tag or a hard break, and at the start of a cell). */
export function readAs(text: string): string {
  return (
    micromark(text, {
      allowDangerousHtml: true,
      extensions: [gfmStrikethrough(), gfmTable()],
      htmlExtensions: [gfmStrikethroughHtml(), gfmTableHtml()],
    })
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+(?=<\/|\n|<br \/>)/g, '')
      // The line break after the opener of an item's text (`- <!--ins x-->⏎  a`) shows nowhere, so
      // it is not a difference between two readings. It is dropped only in front of text or an
      // inline tag, never in front of a block tag: where a block (`<ul>`, `<p>`, `<pre>`, a heading,
      // a quote, a table, `<hr>`, or the HTML block names of CommonMark) follows `<li>` the line
      // break goes with the structure, and the two readings still differ by it. No view is judged
      // to read alike that has other words, another nesting or another block in it.
      .replace(AFTER_LI_OPENER, '$1')
      // A space at the start of a cell (after a marker that starts it) shows nowhere.
      .replace(/(<t[dh](?: [^>]*)?>)[ \t]+/g, '$1')
      .replace(/\n\s*\n/g, '\n')
      .trim()
  );
}

/** Whether the body of a file reads as its newest view does. */
export const readsAsNewest = (text: string): boolean =>
  readAs(bodyOf(text)) === readAs(newestView(text).text);

/** Whether a marker stands right after an unescaped backslash in the body. */
export const escapedMarker = (text: string): boolean =>
  /(?:^|[^\\])(?:\\\\)*\\<!--/.test(bodyOf(text));

/**
 * Decides the marks of `text` in every order, accepting or rejecting each, and expects each file on
 * the way, the first one too, to read as its newest view does, and every order that decides the same
 * changes to give the same text, exactly. A decision that is refused ends its order, which is
 * counted: `refused` lists the steps.
 */
export function expectEveryOrderRead(label: string, text: string, path = ''): string[] {
  expect(readAs(bodyOf(text)), `${label}${path} => ${JSON.stringify(bodyOf(text))}`).toBe(
    readAs(newestView(text).text),
  );
  const refused: string[] = [];
  const read = parse(text);
  for (const { id, kind } of [...read.marks, ...payloadMarksOf(read).map((found) => found.mark)]) {
    if (kind === 'cmt') continue;
    for (const [step, decide] of [
      [`${path} a${id}`, accept],
      [`${path} r${id}`, reject],
    ] as const) {
      let next: string;
      try {
        next = applyChanges(text, decide(text, id));
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        refused.push(step);
        continue;
      }
      refused.push(...expectEveryOrderRead(label, next, step));
    }
  }
  return refused;
}

/** Every order of decisions reads alike, exactly, and none is stuck, and the files on the way
 * read as their newest view (micromark). */
export function expectSound(label: string, text: string): void {
  const { outcomes, stuck } = everyOrder(text, exactly);
  for (const [decided, results] of outcomes) {
    expect([...results], `${label}: ${decided}`).toHaveLength(1);
  }
  expect(stuck, `${label}: stuck`).toEqual([]);
  expectEveryOrderRead(label, text);
}

/**
 * An edit that the fine rules refuse and the widened write takes (lane R2): it is written, reads
 * alike in every order of decisions, and rejecting what it added gives `before` back (the other
 * people's changes stay in the old text, and the author's own pending changes, which the write
 * takes in as `author` rejects them, are rejected in `before`, so `own` names them). Returns the
 * file after the edit.
 */
export function expectWidened(
  label: string,
  before: string,
  changes: Parameters<typeof applyChanges>[1],
  own?: string,
): string {
  expect(changes.length, `${label}: written`).toBeGreaterThan(0);
  const after = applyChanges(before, changes);
  // A file that reads otherwise in some order of its own decisions (a delimiter run that another
  // change leaves in front of a comment's `<`) is no worse for the write: it is held to read as its
  // newest view as it stands, and the orders that its own tell apart are left to it.
  let soundBefore = true;
  try {
    expectEveryOrderRead(label, before);
  } catch {
    soundBefore = false;
  }
  if (soundBefore) expectEveryOrderRead(label, after);
  else expect(readAs(bodyOf(after)), label).toBe(readAs(newestView(after).text));
  const read = parse(before);
  const known = new Set(Object.keys(read.ledger.marks));
  let back = after;
  for (const mark of parse(after).marks) {
    if (known.has(mark.id) || mark.kind === 'cmt') continue;
    if (!parse(back).marks.some((m) => m.id === mark.id)) continue;
    back = applyChanges(back, reject(back, mark.id));
  }
  let want = before;
  for (const mark of read.marks) {
    if (mark.kind === 'cmt' || read.ledger.marks[mark.id]?.by !== own || own === undefined)
      continue;
    want = applyChanges(want, reject(want, mark.id));
  }
  expect(bodyOf(back).trimEnd(), `${label}: rejects back`).toBe(bodyOf(want).trimEnd());
  return after;
}
