// @vitest-environment happy-dom
// Typing right after an indent change in a list item (P0-a, the first fix of the usability Epic).
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, undo } from '../index.ts';
import { visibleText } from './test-helpers.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, caret: number, tracking: boolean): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, tracking });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  editor.view.dispatch({ selection: { anchor: caret } });
  return editor;
}

function key(editor: Editor, name: string, shiftKey = false): void {
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  const event = new KeyboardEvent('keydown', {
    key: name,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  runScopeHandlers(editor.view, event, 'editor');
}

const type = (editor: Editor, text: string) => {
  for (const ch of text) {
    editor.view.dispatch(editor.view.state.replaceSelection(ch), { userEvent: 'input.type' });
  }
};

describe('typing right after an indent change', () => {
  for (const tracking of [false, true]) {
    const on = tracking ? 'on' : 'off';
    it(`at the start of an item's text, Track Changes ${on}: the text is drawn after the bullet`, () => {
      const editor = load('- one\n- two\n- three\n', 8, tracking);
      key(editor, 'Tab');
      type(editor, 'abc');
      expect(visibleText(editor).split('\n').filter(Boolean)).toEqual([
        '- one',
        '  - abctwo',
        '- three',
      ]);
    });

    it(`at the start of an item's text, Shift-Tab, Track Changes ${on}`, () => {
      const editor = load('- one\n  - two\n- three\n', 10, tracking);
      key(editor, 'Tab', true);
      type(editor, 'abc');
      expect(visibleText(editor).split('\n').filter(Boolean)).toEqual([
        '- one',
        '- abctwo',
        '- three',
      ]);
    });
  }
});

/**
 * Keys that arrive without waiting, one after the other: after every one, the letters typed so
 * far are in order and the caret stands right after them, as drawn (a caret that lags behind
 * the bullet, or letters that come out reversed, show here as a different order or caret).
 */
describe('keys typed without waiting after Tab, Shift-Tab, Return and paste', () => {
  const docs: [string, number][] = [
    ['- one\n- two\n- three\n', 8],
    ['- one\n- two\n- three\n', 11],
    ['- one\n  - two\n- three\n', 10],
    ['- one\n  - two\n- three\n', 13],
    ['1. one\n2. two\n3. three\n', 10],
    ['1. one\n2. two\n3. three\n', 13],
    ['- one\n- two\n- \n', 14],
  ];
  const prefixes: { name: string; run: (editor: Editor) => void }[] = [
    { name: 'Tab', run: (e) => key(e, 'Tab') },
    { name: 'Shift-Tab', run: (e) => key(e, 'Tab', true) },
    { name: 'Return', run: (e) => key(e, 'Enter') },
    {
      name: 'Return, Tab',
      run: (e) => {
        key(e, 'Enter');
        key(e, 'Tab');
      },
    },
    {
      name: 'Tab, Shift-Tab',
      run: (e) => {
        key(e, 'Tab');
        key(e, 'Tab', true);
      },
    },
    {
      name: 'Tab, Tab',
      run: (e) => {
        key(e, 'Tab');
        key(e, 'Tab');
      },
    },
  ];
  for (const tracking of [false, true]) {
    for (const [doc, caret] of docs) {
      for (const prefix of prefixes) {
        it(`${prefix.name} then typing at ${caret} in ${JSON.stringify(doc)}, Track Changes ${tracking ? 'on' : 'off'}`, () => {
          const editor = load(doc, caret, tracking);
          prefix.run(editor);
          let typed = '';
          for (const ch of 'abc') {
            type(editor, ch);
            typed += ch;
            const { head } = editor.view.state.selection.main;
            expect(visibleText(editor, head).endsWith(typed), `after ${typed}`).toBe(true);
          }
          const lines = visibleText(editor).split('\n').filter(Boolean);
          // The letters are drawn together, on the line of one item (never alone under a bullet).
          expect(lines.filter((line) => /a.*b.*c/.test(line.replace(/<[^>]*>/g, '')))).toHaveLength(
            1,
          );
          expect(
            lines.every((line) => !/<!--/.test(line)),
            lines.join(' / '),
          ).toBe(true);
        });
      }
    }
  }

  it('a paste right after Tab goes in order, after the bullet', () => {
    for (const tracking of [false, true]) {
      const editor = load('- one\n- two\n- three\n', 8, tracking);
      key(editor, 'Tab');
      editor.view.dispatch(editor.view.state.replaceSelection('abc'), { userEvent: 'input.paste' });
      expect(visibleText(editor).split('\n').filter(Boolean)).toEqual([
        '- one',
        '  - abctwo',
        '- three',
      ]);
    }
  });

  it('Undo takes the typing back, then the indent change, and the file is as it was', () => {
    for (const tracking of [false, true]) {
      const doc = '- one\n- two\n- three\n';
      const editor = load(doc, 8, tracking);
      const before = editor.getDoc();
      key(editor, 'Tab');
      type(editor, 'abc');
      for (let i = 0; i < 4 && editor.getDoc() !== before; i++) undo(editor.view);
      expect(editor.getDoc()).toBe(before);
    }
  });
});

describe('a deleted item whose marker line the join of a bullet takes along', () => {
  it('is still drawn struck in Redlines', () => {
    const doc = [
      '- one',
      '- <!--fmt c3c3 was=indent=2-->',
      '  <!--del b2b2 two-->',
      '  <!--/c3c3--><!--del b2b2 \\n- -->',
      '  three',
      '',
      '<!-- redlines',
      'version: 1',
      'marks:',
      '  b2b2: {by: ada, at: 2026-11-01T10:00Z}',
      '  c3c3: {by: ada, at: 2026-11-01T10:00Z}',
      '-->',
      '',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc, author: ada, view: 'redlines' });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    expect(editor.view.contentDOM.textContent).toContain('two');
    expect(editor.view.contentDOM.textContent).toContain('three');
  });
});
