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
import { bodyOf, everyOrder, exactly } from './test-helpers.ts';
import { newestView } from './views.ts';

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
  for (const { id, kind } of parse(text).marks) {
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
