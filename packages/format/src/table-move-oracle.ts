// What a file with row moves pending is held to when its rows carry comments and highlights (format
// §3.7, "Moving rows"; #371). Deciding a move takes a row to another place with what it holds, so that
// nothing in it changes: not the comments in it, and not the lines they stand in. Not part of the
// package.

import { expect } from 'vitest';
import { lineEnd, lineStart } from './blocks.ts';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { blockLeaves, bodyOf, problemsOf } from './test-helpers.ts';

/**
 * What each comment and highlight of a file is: the line of its opener and the line of its closer (or
 * `point`), as text without any marker, so that it says which row of a table the marker is in.
 */
export function annotationLines(text: string): string[] {
  const line = (at: number) =>
    text
      .slice(lineStart(text, at), lineEnd(text, at))
      .replace(/<!--[^]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  return parse(text)
    .marks.filter((mark) => mark.kind === 'cmt' || mark.kind === 'hl')
    .flatMap((mark) =>
      mark.segments.map(
        (segment) =>
          `${mark.id}: ${line(segment.open.from)} => ${segment.close ? line(segment.close.from) : 'point'}`,
      ),
    )
    .sort();
}

/** Every state that deciding the changes of `text` comes to, in any order; a decision that is refused
 * ends its order. */
export function statesOf(text: string): string[] {
  const seen = new Set<string>();
  const walk = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    const ids = new Set(
      parse(current)
        .marks.filter((mark) => mark.kind !== 'cmt' && mark.kind !== 'hl')
        .map((mark) => mark.id),
    );
    for (const id of ids) {
      for (const decide of [accept, reject]) {
        try {
          walk(applyChanges(current, decide(current, id)));
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
      }
    }
  };
  walk(text);
  return [...seen];
}

/**
 * Where only moves of rows are pending in the table of `text`, whose rows have `columns` cells: in every
 * state that deciding the moves in any order comes to, the file's markers are as sound as they were,
 * every comment and highlight is in the line it was in, whichever way the rows went (none is left
 * behind, none is written twice), and micromark reads the file's own text, markers and all, as one
 * table of the same size.
 */
export function expectCommentsTravel(label: string, text: string, columns: number): void {
  const tables = (state: string) => blockLeaves(state).filter((leaf) => leaf.kind === 'table');
  const rows = tables(text)[0]?.rows?.length ?? 0;
  const wanted = annotationLines(text);
  for (const state of statesOf(text)) {
    const shown = `${label}: ${JSON.stringify(bodyOf(state))}`;
    expect(problemsOf(parse(state)), shown).toEqual([]);
    expect(annotationLines(state), shown).toEqual(wanted);
    const found = tables(state);
    expect(found, shown).toHaveLength(1);
    expect(found[0]?.rows?.length, shown).toBe(rows);
    expect(
      found[0]?.rows?.every((row) => row.length === columns),
      shown,
    ).toBe(true);
  }
}
