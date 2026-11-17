// @vitest-environment happy-dom
// A table that is a pending insertion has the marker of an inserted line break at the end of each of
// its lines, and the closer of the insertion at its end (format §3.4). It is a table to draw, as it
// is once the insertion is accepted, not raw Markdown (P0-a, the usability Epic).
import { forceParsing, syntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { blankTrailingMarkers } from '@redlines/format';
import { tablesOf } from './model.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const LEDGER =
  '\n\n<!-- redlines\nversion: 1\nmarks:\n  k3x9: {by: ada, at: 2026-11-01T10:00Z}\n  s1aa: {by: ada, at: 2026-11-01T10:00Z}\n  s2bb: {by: ada, at: 2026-11-01T10:00Z}\n  s3cc: {by: ada, at: 2026-11-01T10:00Z}\n-->\n';

function load(doc: string, view: 'redlines' | 'clean' = 'redlines'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    view,
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}

/** A table whose lines end with the markers a pending insertion of it writes. */
const PENDING =
  'One.<!--ins k3x9--><!--split s1aa-->\n\n| Name | Age |<!--split s2bb-->\n| --- | --- |<!--split s3cc-->\n| Ada | 36 |<!--/k3x9-->\n\nTwo.';

describe('the markers that end a line of a table', () => {
  it('are white space of the same length', () => {
    const text = '| a | b |<!--split s1aa--><!--/k3x9-->  ';
    expect(blankTrailingMarkers(text)).toHaveLength(text.length);
    expect(blankTrailingMarkers(text)).toBe(`| a | b |${' '.repeat(text.length - 9)}`);
    // Only a marker at the end of the line; an ordinary comment, or one in the middle, stays.
    expect(blankTrailingMarkers('| a | <!--split s1aa--> b |')).toBe('| a | <!--split s1aa--> b |');
    expect(blankTrailingMarkers('| a | b |<!-- note -->')).toBe('| a | b |<!-- note -->');
  });

  it('leave the parser a table, with every position where the document has it', () => {
    const editor = load(`${PENDING}${LEDGER}`);
    const tables: [number, number][] = [];
    syntaxTree(editor.view.state).iterate({
      enter: (node) => {
        if (node.name === 'Table') tables.push([node.from, node.to]);
      },
    });
    const doc = editor.view.state.doc.toString();
    expect(tables).toHaveLength(1);
    expect(doc.slice(tables[0]![0], tables[0]![0] + 9)).toBe('| Name | ');
    expect(doc.slice(tables[0]![0], tables[0]![1]).endsWith('| Ada | 36 |<!--/k3x9-->')).toBe(true);
    expect(tablesOf(editor.view.state)).toHaveLength(1);
    expect(tablesOf(editor.view.state)[0]!.rows.map((row) => row.cells.length)).toEqual([2, 2]);
  });

  it.each([
    ['the header', '| a | b |<!--split s1aa-->\n| - | - |\n| 1 | 2 |'],
    ['the delimiter row', '| a | b |\n| - | - |<!--split s1aa-->\n| 1 | 2 |'],
    ['a body row', '| a | b |\n| - | - |\n| 1 | 2 |<!--split s1aa-->\n| 3 | 4 |'],
    ['every line', '| a | b |<!--split s1aa-->\n| - | - |<!--split s2bb-->\n| 1 | 2 |<!--/s3cc-->'],
    ['the delimiter row, under a paragraph', 'Intro\n| a | b |\n| - | - |<!--/s1aa-->\n| 1 | 2 |'],
    ['a table with no outer pipes', 'a | b<!--split s1aa-->\n--- | ---<!--split s2bb-->\n1 | 2'],
  ])('a table with a marker ending %s is drawn as a table', (_, table) => {
    for (const view of ['redlines', 'clean'] as const) {
      const editor = load(`${table}${LEDGER}`, view);
      expect(tablesOf(editor.view.state), view).toHaveLength(1);
      const rows = [...editor.view.contentDOM.querySelectorAll('.cm-line.rl-trow')];
      expect(rows.length, view).toBeGreaterThanOrEqual(2);
      expect(
        rows.every((row) => !row.textContent?.includes('<!--')),
        view,
      ).toBe(true);
    }
  });

  it('draw no table for a header and a delimiter row of other widths, markers or not', () => {
    for (const doc of [
      '| a | b |<!--split s1aa-->\n| - |\n| 1 | 2 |',
      '| a | b |\n| - | - | - |<!--split s1aa-->\n| 1 | 2 |',
    ]) {
      expect(tablesOf(load(`${doc}${LEDGER}`).view.state)).toHaveLength(0);
    }
  });

  it('leave the file as it was', () => {
    const editor = load(`${PENDING}${LEDGER}`);
    expect(editor.getDoc()).toBe(`${PENDING}${LEDGER}`);
  });
});
