// @vitest-environment happy-dom
// A rewritten table cell (design: Part 3, "A rewritten cell"): in Redlines the old text is struck
// above the new inside the same cell, which grows in height; the other cells, the row's bar and
// the change's mark are as for any change in a cell. Simple and Clean show the new text in the
// cell. A cell with a smaller change draws as before.
import { forceParsing } from '@codemirror/language';
import { applyChanges, parse, suggestReplace } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewMode } from '../api.ts';
import { createEditor, type Editor } from '../index.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const claude = { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' };
const TABLE = [
  '| Milestone | Notes |',
  '| --------- | ----- |',
  '| M1 | the importer reads every file in the folder |',
  '| M2 | Plums |',
  '',
].join('\n');

/** The table after an agent's `str_replace`, as its tool writes it. */
const rewritten = (oldStr: string, newStr: string) =>
  applyChanges(
    TABLE,
    suggestReplace(TABLE, oldStr, newStr, { author: claude, time: '2026-11-10T10:00Z' }).changes,
  );

function load(doc: string, view: ViewMode = 'redlines'): Editor {
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

const rows = (editor: Editor) => [
  ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line.rl-trow'),
];
const cells = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>('.rl-tc')];

describe('a rewritten table cell', () => {
  const OLD = 'the importer reads every file in the folder';
  const NEXT = 'a batch job nightly';
  const doc = rewritten(OLD, NEXT);

  it('is one substitution of the cell, written in the row', () => {
    const marks = parse(doc).marks;
    expect(marks.map((mark) => mark.kind)).toEqual(['sub']);
    expect(doc.split('\n').filter((line) => line.startsWith('|'))).toHaveLength(4);
  });

  it('draws the old text struck above the new inside the same cell, not as a second row', () => {
    const editor = load(doc);
    const lines = rows(editor);
    // The header row and two rows: the delimiter row is hidden.
    expect(lines).toHaveLength(3);
    const [, notes] = cells(lines[1]!);
    const old = notes!.querySelector<HTMLElement>('.rl-del')!;
    expect(old.textContent).toBe(OLD);
    expect(old.className).toBe('rl-del rl-author-4');
    // A line break between them, in the cell's own element.
    expect(old.querySelector('br')).not.toBeNull();
    const added = notes!.querySelector<HTMLElement>('.rl-ins')!;
    expect(added.textContent).toBe(NEXT);
    expect(old.compareDocumentPosition(added) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notes!.textContent).toBe(OLD + NEXT);
  });

  it('leaves the other cells and rows alone, and puts the bar on the row', () => {
    const editor = load(doc);
    const lines = rows(editor);
    expect(cells(lines[1]!)[0]!.textContent).toBe('M1');
    expect(lines[2]!.textContent).toBe('M2Plums');
    expect(lines[1]!.classList).toContain('rl-bar');
    expect(lines[2]!.classList).not.toContain('rl-bar');
    expect(lines[0]!.classList).not.toContain('rl-bar');
    expect(editor.view.contentDOM.querySelectorAll('.rl-del br')).toHaveLength(1);
  });

  it('finds the change by the data-mark of its old text', () => {
    const editor = load(doc);
    const old = editor.view.contentDOM.querySelector<HTMLElement>('.rl-tc .rl-del')!;
    expect(old.dataset['mark']).toBe(parse(doc).marks[0]!.id);
  });

  it('draws only the new text in Simple and Clean, with the row’s bar in Simple', () => {
    for (const view of ['simple', 'clean'] as const) {
      const editor = load(doc, view);
      const [, notes] = cells(rows(editor)[1]!);
      expect(notes!.textContent, view).toBe(NEXT);
      expect(editor.view.contentDOM.querySelector('.rl-del, br'), view).toBeNull();
      expect(rows(editor)[1]!.classList.contains('rl-bar'), view).toBe(view === 'simple');
    }
  });

  it('draws a smaller change in a cell as before, inline', () => {
    const editor = load(rewritten('every', 'each'));
    const [, notes] = cells(rows(editor)[1]!);
    expect(notes!.querySelector('.rl-del br')).toBeNull();
    expect(notes!.querySelector('.rl-del')?.textContent).toBe('every');
    expect(notes!.querySelector('.rl-ins')?.textContent).toBe('each');
  });

  it('draws a cell someone typed over whole the same way', () => {
    const typed =
      TABLE.replace('Plums', '<!--sub k3x9 Plums-->Cherries<!--/k3x9-->') +
      '\n<!-- redlines\nversion: 1\nmarks:\n  k3x9: {by: bo, at: 2026-11-01T10:00Z}\n-->\n';
    const [, notes] = cells(rows(load(typed))[2]!);
    expect(notes!.querySelector('.rl-del')?.textContent).toBe('Plums');
    expect(notes!.querySelector('.rl-del br')).not.toBeNull();
    expect(notes!.querySelector('.rl-ins')?.textContent).toBe('Cherries');
  });
});
