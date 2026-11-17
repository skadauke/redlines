// @vitest-environment happy-dom
// Return again in the empty paragraph gives the text room (#515, format §3.4): a line that holds
// only `&nbsp;`, and the next empty paragraph opens below it. Track Changes on and off; every
// script is held to the suite's invariants (micromark's reading, the decisions, Undo), and the
// views draw the line as an empty line, the caret before or after it and never inside.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { previewDecorations } from '../preview/decorations.ts';
import { runScript, type Script, scriptRows, type Step } from './script.ts';

const typeEach = (text: string): Step[] => [...text].map((type) => ({ type }));

const rows: Script[] = [];
for (const tc of [false, true]) {
  const on = tc ? 'on' : 'off';
  for (const [name, doc, keys, file] of [
    ['one extra Return', 'a‸', ['Enter', 'Enter'], 'a⏎⏎&nbsp;'],
    ['two extra Returns', 'a‸', ['Enter', 'Enter', 'Enter'], 'a⏎⏎&nbsp;⏎⏎&nbsp;'],
    ['text after the room', 'a‸', ['Enter', 'Enter', ...typeEach('b')], 'a⏎⏎&nbsp;⏎⏎b'],
    ['between two paragraphs', 'a‸⏎⏎b', ['Enter', 'Enter', 'Enter'], 'a⏎⏎&nbsp;⏎⏎&nbsp;⏎⏎b'],
    ['Backspace takes the last back', 'a‸', ['Enter', 'Enter', 'Backspace'], 'a⏎⏎&nbsp;'],
    ['Backspace twice', 'a‸', ['Enter', 'Enter', 'Backspace', 'Backspace'], 'a'],
    ['down from the open paragraph', 'a‸⏎⏎b', ['Enter', 'Enter', 'ArrowDown'], 'a⏎⏎&nbsp;⏎⏎b'],
  ] as const) {
    rows.push({
      name: `${name}: a line of room, Track Changes ${on}`,
      doc,
      keys: [...keys] as Step[],
      tc,
      // Tracked, the newest view is the room as written.
      expect: tc ? (file.includes('&nbsp;') ? { newest: file } : {}) : { file },
    });
  }
}
scriptRows(rows);

describe('The second Return in a container leaves it, and writes no room', () => {
  it.each(['> a‸', '- a‸', '1. a‸', '> [!NOTE]⏎> a‸'])('%s', (doc) => {
    for (const tc of [false, true]) {
      const result = runScript({
        name: 'x',
        doc,
        keys: ['Enter', 'Enter'],
        tc,
        expect: {},
      });
      expect(result.file).not.toContain('&nbsp;');
    }
  });
});

describe('the views draw a line of room as an empty line', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });
  const editorAt = (doc: string, cursor: number) => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada Lovelace' } });
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    editor.view.dispatch({ selection: { anchor: cursor } });
    open.push(editor);
    return editor;
  };
  const replaced = (editor: Editor) => {
    const found: number[][] = [];
    const { state } = editor.view;
    previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
      if (value.point && to > from) found.push([from, to]);
    });
    return found;
  };

  it('hides the entity with the caret in the line, and draws text with an entity as before', () => {
    // The caret before the entity (3) and after it (9): it stays drawn, as the empty line.
    for (const at of [3, 9]) expect(replaced(editorAt('a\n\n&nbsp;\n\nb', at))).toEqual([[3, 9]]);
    // `&nbsp;` with other text in the paragraph is ordinary text: drawn as its character away
    // from the caret, and as source at it.
    expect(replaced(editorAt('a\n\nx&nbsp;y\n\nb', 0))).toEqual([[4, 10]]);
    expect(replaced(editorAt('a\n\nx&nbsp;y\n\nb', 6))).toEqual([]);
  });
});
