// A decision that empties the last cell of a header with no pipe at its end (#428): `| a | é` over
// `| --- | --- |` is a table, and `| a | ` over it, once the insertion that held all the text of the last
// cell is rejected (or the deletion of it accepted), is one cell less than the delimiter row, which
// micromark reads as a paragraph. The pipe that the cell needs is written, plain (` |`), as a key
// that empties the cell writes it (`outerPipeWrites`, format §3.7, rule 7), in the same decision, so
// that every order of decisions reads one table.

import { applyChanges } from './changes.ts';
import { lineEnd, lineStart } from './blocks.ts';
import type { TextChange } from './types.ts';

const DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const COMMENT = /<!--[^]*?-->/g;
const PIPE = /(?<!\\)\|/g;

/** How many cells GFM reads in a row: the pipes at its ends are the row's own, not cells. */
function cellsOf(row: string): number {
  let line = row.replace(COMMENT, '').trim();
  if (line.startsWith('|')) line = line.slice(1);
  if (/(?<!\\)\|$/.test(line)) line = line.slice(0, -1);
  return line.split(PIPE).length;
}

/**
 * `changes`, a decision of `text`, with the closing pipes that the headers it empties need: a header
 * line that the changes touch and that stood over a delimiter row with as many cells as it, and has
 * fewer after them, gets ` |` for each cell it lacks, at its end.
 */
export function closeBareHeaders(text: string, changes: readonly TextChange[]): TextChange[] {
  if (!text.includes('|') || changes.length === 0) return [...changes];
  const written = [...changes];
  const seen = new Set<number>();
  for (const change of changes) {
    const start = lineStart(text, change.from);
    if (seen.has(start)) continue;
    seen.add(start);
    const end = lineEnd(text, change.from);
    const next = end + 1;
    if (next >= text.length || !text.slice(start, end).includes('|')) continue;
    const delimiter = text.slice(next, lineEnd(text, next));
    if (!DELIMITER.test(delimiter) || !delimiter.includes('-')) continue;
    // A decision that takes a column away (or writes one) changes the delimiter row with the header:
    // the table keeps its cells in step, and no pipe is needed.
    const delimiterEnd = lineEnd(text, next);
    if (changes.some((each) => each.from <= delimiterEnd && each.to >= next)) continue;
    // The line as the decision leaves it: the changes inside it applied to it alone.
    const inside = changes
      .filter((each) => each.from >= start && each.to <= end)
      .map((each) => ({ ...each, from: each.from - start, to: each.to - start }));
    const row = text.slice(start, end);
    const after = applyChanges(row, inside);
    const columns = cellsOf(delimiter);
    const before = cellsOf(row);
    const left = cellsOf(after);
    // A header that was a table's (as many cells as the delimiter row) and is not once decided.
    if (before !== columns || left >= columns) continue;
    // (A space that the line ends with is the first pipe's.)
    const pipes = (/[ \t]$/.test(after) ? '|' : ' |') + ' |'.repeat(columns - left - 1);
    const touching = written.findIndex((each) => each.to === end && each.from >= start);
    if (touching >= 0) {
      const own = written[touching]!;
      written[touching] = { ...own, insert: own.insert + pipes };
    } else {
      written.push({ from: end, to: end, insert: pipes });
    }
  }
  return written.toSorted((a, b) => a.from - b.from || a.to - b.to);
}
