// @vitest-environment happy-dom
// An inserted row drawn (design: tables, "Track Changes"; format §3.7): in Redlines its cells take
// the author's tint and its text is underlined in the author's color, with a change bar on the row;
// Clean shows the plain row; the review bar and the counts list it. Simple (review views' second
// stage) is drawn by the same marks and is tested where that view lives.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import type { ViewMode } from '../api.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const LEDGER =
  '\n<!-- redlines\nversion: 1\nmarks:\n  k3x9: {by: bo, at: 2026-11-01T10:00Z}\n  m2bd: {by: bo, at: 2026-11-01T10:00Z}\n-->\n';
const DOC = [
  '| Fruit | Count |',
  '| ----- | ----- |',
  '| Apples | 3 |',
  '| <!--ins k3x9 row--> Pears | 5 |',
  '| Plums | <!--ins m2bd-->7<!--/m2bd--> |',
  '',
].join('\n');

function load(view: ViewMode, doc = `${DOC}${LEDGER}`, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    view,
    tracking,
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}

const rows = (editor: Editor) => [
  ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line.rl-trow'),
];

describe('an inserted row in Redlines', () => {
  it('draws the row with the author’s tint and underline, and a change bar', () => {
    const lines = rows(load('redlines'));
    const pears = lines[2];
    expect(pears!.classList.contains('rl-ins-row')).toBe(true);
    expect(pears!.classList.contains('rl-bar')).toBe(true);
    expect([...pears!.classList].some((name) => /^rl-author-\d$/.test(name))).toBe(true);
    // Its cells are the row's: the tint and the underline are theirs.
    expect(pears!.querySelectorAll('.rl-tc')).toHaveLength(2);
  });

  it('draws no other row as inserted: the bar of a change in a cell is the cell’s own', () => {
    const lines = rows(load('redlines'));
    expect(lines.filter((line) => line.classList.contains('rl-ins-row'))).toHaveLength(1);
    const plums = lines[3]!;
    expect(plums.classList.contains('rl-bar')).toBe(true);
    expect(plums.classList.contains('rl-ins-row')).toBe(false);
  });

  it('puts the marker out of the text, and the text in its cell', () => {
    const editor = load('redlines');
    const pears = rows(editor)[2]!;
    expect(pears.textContent).not.toContain('<!--');
    expect(pears.textContent).toContain('Pears');
  });

  it('lists the row as a change, and counts it', () => {
    const editor = load('redlines');
    const { changes, hasRedlines } = editor.getUiState();
    expect(changes.map((mark) => mark.id)).toEqual(['k3x9', 'm2bd']);
    expect(changes[0]?.payload).toBe('row');
    expect(hasRedlines).toBe(true);
  });

  it('is a document with redlines on its own', () => {
    const editor = load(
      'clean',
      `| a | b |\n| - | - |\n| <!--ins k3x9 row--> x | y |\n${LEDGER.replace(/ {2}m2bd.*\n/, '')}`,
    );
    expect(editor.getUiState().hasRedlines).toBe(true);
  });
});

describe('an inserted row in Clean', () => {
  it('is the plain row: no tint, no underline, no bar, and its text as it reads', () => {
    const editor = load('clean');
    const pears = rows(editor)[2]!;
    expect(pears.classList.contains('rl-ins-row')).toBe(false);
    expect(pears.classList.contains('rl-bar')).toBe(false);
    expect(pears.textContent).toContain('Pears');
  });
});

describe('a cell cleared with Track Changes on', () => {
  const plain = '| a | b |\n| - | - |\n| 1 | 2 |\n';

  function cleared(view: ViewMode): Editor {
    const editor = load('clean', plain, true);
    const at = editor.view.state.doc.toString().indexOf('1 |');
    editor.view.dispatch({ selection: { anchor: at, head: at + 1 } });
    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
      'editor',
    );
    editor.view.dispatch({ effects: [] });
    // A tracked change made in Clean shows in Redlines: the view asked for is set after it.
    editor.setViewMode(view);
    return editor;
  }

  it('shows struck text in Redlines, and nothing in Clean', () => {
    const redlines = cleared('redlines');
    expect(redlines.view.contentDOM.querySelectorAll('.rl-del').length).toBeGreaterThan(0);
    const clean = cleared('clean');
    expect(clean.view.contentDOM.querySelectorAll('.rl-del')).toHaveLength(0);
    // The cell reads empty.
    const cell = rows(clean)[1]?.querySelector('.rl-tc');
    expect(cell?.textContent?.replaceAll('\u200b', '')).toBe('');
  });
});
