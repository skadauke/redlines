// @vitest-environment happy-dom
// Redlines' simple look (design §5.3): deletions hidden, insertions in the author's color without
// the underline, change bars and comments kept, and the caret never inside the hidden text.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewMode } from '../api.ts';
import { createEditor, type Editor } from '../index.ts';

const LEDGER = [
  '',
  '<!-- redlines',
  'version: 1',
  'people:',
  '  bo: {name: Bo Chen}',
  'marks:',
  '  b3nq: {by: bo, at: 2026-11-10T09:00Z}',
  '  c4rt: {by: bo, at: 2026-11-10T09:01Z}',
  '  d5sw: {by: bo, at: 2026-11-10T09:02Z}',
  '  f6vx: {by: bo, at: 2026-11-10T09:03Z}',
  '  g7zk: {by: bo, at: 2026-11-10T09:04Z}',
  '-->',
  '',
].join('\n');

const BODY = [
  'The launch is in <!--sub b3nq March-->April<!--/b3nq--> for the team<!--ins c4rt--> and its friends<!--/c4rt-->.<!--del d5sw  It will not slip.-->',
  '',
  '<!--del f6vx Gone entirely, a whole paragraph.-->',
  '',
  'Then <!--fmt g7zk +bold-->**bold**<!--/g7zk--> text.',
  '',
].join('\n');

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(view: ViewMode, body = BODY): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: body + LEDGER,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    view,
    tracking: false,
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}

const dom = (editor: Editor) => editor.view.contentDOM;
const all = (editor: Editor, selector: string) => [...dom(editor).querySelectorAll(selector)];

describe('the simple look', () => {
  it('draws inserted and substituted text in the author’s color, with no underline', () => {
    const simple = load('simple');
    const drawn = all(simple, '.rl-ins-plain');
    expect(drawn.map((el) => el.textContent)).toEqual(['April', ' and its friends']);
    for (const el of drawn) expect(el.className).toMatch(/\brl-author-\d\b/);
    // Nothing that underlines or strikes: the classes of the full markup are not drawn.
    expect(all(simple, '.rl-ins, .rl-del, .rl-fmt, .rl-split')).toHaveLength(0);
  });

  it('draws the full markup’s classes in Redlines, and none of the simple look’s', () => {
    const redlines = load('redlines');
    expect(all(redlines, '.rl-ins').length).toBeGreaterThan(0);
    expect(all(redlines, '.rl-ins-plain')).toHaveLength(0);
  });

  it('draws no insertion in Clean', () => {
    const clean = load('clean');
    expect(all(clean, '.rl-ins, .rl-ins-plain')).toHaveLength(0);
  });

  it('hides the deleted text, the replaced text and the deleted paragraph', () => {
    const simple = load('simple');
    const shown = dom(simple).textContent ?? '';
    expect(shown).toContain('The launch is in April for the team and its friends.');
    expect(shown).not.toContain('slip');
    expect(shown).not.toContain('March');
    expect(shown).not.toContain('Gone entirely');
  });

  it('keeps the change bars on the lines that hold a change', () => {
    const simple = load('simple');
    const bars = all(simple, '.cm-line.rl-bar');
    expect(bars.length).toBeGreaterThanOrEqual(2);
    expect(bars.map((line) => line.textContent).join('|')).toContain('The launch');
  });
});

describe('the simple look and the caret', () => {
  const press = (editor: Editor, key: string) => {
    const parts = key.split('-');
    const name = parts.pop()!;
    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', {
        key: name,
        shiftKey: parts.includes('Shift'),
        metaKey: parts.includes('Meta'),
        bubbles: true,
        cancelable: true,
      }),
      'editor',
    );
  };
  const head = (editor: Editor) => editor.view.state.selection.main.head;
  const at = (editor: Editor, pos: number) =>
    editor.view.dispatch({ selection: { anchor: pos }, userEvent: 'select' });

  /** The deletions, each from its `<!--del` to its `-->`, as the file has them. */
  const deletions = (editor: Editor): [number, number][] => {
    const text = editor.view.state.doc.toString();
    return [...text.matchAll(/<!--del [^>]*?-->/g)].map((m) => [m.index, m.index + m[0].length]);
  };
  const inside = (editor: Editor, pos: number) =>
    deletions(editor).some(([from, to]) => pos > from && pos < to);

  it('never rests inside a deletion, walking right and left through the whole text', () => {
    const editor = load('simple');
    at(editor, 0);
    let last = -1;
    for (let i = 0; i < 300 && head(editor) !== last; i++) {
      last = head(editor);
      press(editor, 'ArrowRight');
      expect(inside(editor, head(editor)), `→ ${i} at ${head(editor)}`).toBe(false);
    }
    last = -1;
    for (let i = 0; i < 300 && head(editor) !== last; i++) {
      last = head(editor);
      press(editor, 'ArrowLeft');
      expect(inside(editor, head(editor)), `← ${i} at ${head(editor)}`).toBe(false);
    }
  });

  it('keeps both ends of a selection out of a deletion, with Shift and Down', () => {
    const editor = load('simple');
    const text = editor.view.state.doc.toString();
    at(editor, text.indexOf('friends<!--/c4rt-->.') + 'friends<!--/c4rt-->.'.length);
    for (let i = 0; i < 6; i++) {
      press(editor, 'Shift-ArrowRight');
      const { anchor, head: to } = editor.view.state.selection.main;
      expect(inside(editor, anchor)).toBe(false);
      expect(inside(editor, to)).toBe(false);
    }
    at(editor, 3);
    for (let i = 0; i < 4; i++) {
      press(editor, 'ArrowDown');
      expect(inside(editor, head(editor)), `↓ ${i}`).toBe(false);
    }
  });

  it('ends a line outside the deletion that ends it, with End and Home', () => {
    const editor = load('simple');
    at(editor, 4);
    press(editor, 'End');
    expect(inside(editor, head(editor))).toBe(false);
    press(editor, 'Home');
    expect(inside(editor, head(editor))).toBe(false);
  });
});
