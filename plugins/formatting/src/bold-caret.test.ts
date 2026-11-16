// @vitest-environment happy-dom
// Bold with the caret in a word bolds the word; Backspace then takes its last letter (#584).
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { createEditor, type Editor } from '@redlines/editor';
import { newestView, originalView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: { editor: Editor; remove: () => void }[] = [];

afterEach(() => {
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

function mount(doc: string, tracking: boolean): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, tracking });
  mounted.push({ editor, remove: createFormatting(editor, { author, notice: () => {} }) });
  return editor;
}

const press = (editor: Editor, key: string) =>
  runScopeHandlers(
    editor.view,
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    'editor',
  );

describe('Bold on a word of one letter, then Backspace (#584)', () => {
  for (const tracking of [false, true]) {
    it(`takes the markers of a word in a paragraph, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      const doc = 'One a';
      const editor = mount(doc, tracking);
      editor.view.dispatch({ selection: { anchor: doc.length } });
      forceParsing(editor.view, editor.view.state.doc.length, 5000);
      expect(editor.commands.run('format.bold')).toBe(true);
      press(editor, 'Backspace');
      const file = editor.getDoc();
      expect(file).not.toContain('****');
      expect(parse(file).warnings).toEqual([]);
      expect(newestView(file).text).toBe('One ');
      if (tracking) expect(originalView(file).text).toBe('One a');
    });

    it(`never leaves bare markers, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      const doc = '- one\n- a';
      const editor = mount(doc, tracking);
      editor.view.dispatch({ selection: { anchor: doc.length } });
      forceParsing(editor.view, editor.view.state.doc.length, 5000);
      expect(editor.commands.run('format.bold')).toBe(true);
      press(editor, 'Backspace');
      const file = editor.getDoc();
      expect(file).not.toContain('****');
      expect(parse(file).warnings).toEqual([]);
      // Tracked, the item left with no text goes whole (the format's own widening); rejecting
      // brings the bolded word back, and no order of decisions leaves bare markers.
      expect(newestView(file).text).toBe(tracking ? '- one' : '- one\n- ');
      if (tracking) expect(originalView(file).text).toBe('- one\n- a');
    });
  }
});
