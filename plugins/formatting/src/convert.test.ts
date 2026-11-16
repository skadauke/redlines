// @vitest-environment happy-dom
// Converting between paragraphs, bullets, numbers and checkboxes (#506), as the toolbar's List menu
// runs the block commands: a selection of several paragraphs becomes one list, a list becomes
// another kind or paragraphs again, with Track Changes on and off.
import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { newestView } from '@redlines/format';
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
  const remove = createFormatting(editor, { author, notice: () => {} });
  mounted.push({ editor, remove });
  return editor;
}

/** Selects from the start of `from` to the end of `to`, and runs `id`. */
function run(editor: Editor, from: string, to: string, id: string): boolean {
  const text = editor.view.state.doc.toString();
  const anchor = text.indexOf(from);
  const head = text.indexOf(to) + to.length;
  editor.view.dispatch({ selection: { anchor, head } });
  forceParsing(editor.view, text.length, 5000);
  return editor.commands.run(id);
}

const visible = (editor: Editor) => newestView(editor.getDoc()).text;

const DOC = 'Intro.\n\nFirst.\n\nSecond.\n\nOutro.\n';

describe.each([false, true])('the List menu converts (tracking %s)', (tracking) => {
  it('makes a selection of paragraphs one list of each kind, and keeps the rest apart', () => {
    for (const [id, marker] of [
      ['block.ul', '- '],
      ['block.ol', '1. '],
      ['block.task', '- [ ] '],
    ] as const) {
      const editor = mount(DOC, tracking);
      expect(run(editor, 'First.', 'Second.', id)).toBe(true);
      const text = visible(editor);
      // One list of the two paragraphs, apart from the paragraphs around it.
      expect(text, id).toBe(`Intro.\n\n${marker}First.\n\n${marker}Second.\n\nOutro.\n`);
    }
  });

  it('makes one paragraph of the selection a list item, and leaves the others', () => {
    const editor = mount(DOC, tracking);
    expect(run(editor, 'Second.', 'Second.', 'block.task')).toBe(true);
    expect(visible(editor)).toBe('Intro.\n\nFirst.\n\n- [ ] Second.\n\nOutro.\n');
  });

  it('turns a list into another kind', () => {
    const editor = mount('Intro.\n\n- First.\n- Second.\n\nOutro.\n', tracking);
    expect(run(editor, 'First.', 'Second.', 'block.ol')).toBe(true);
    expect(visible(editor)).toBe('Intro.\n\n1. First.\n1. Second.\n\nOutro.\n');
    expect(run(editor, 'First.', 'Second.', 'block.task')).toBe(true);
    expect(visible(editor)).toBe('Intro.\n\n- [ ] First.\n- [ ] Second.\n\nOutro.\n');
  });

  it('takes a lone item out of its list, back to a paragraph', () => {
    const editor = mount('Intro.\n\n- Only.\n\nOutro.\n', tracking);
    expect(run(editor, 'Only.', 'Only.', 'block.body')).toBe(true);
    expect(visible(editor)).toBe('Intro.\n\nOnly.\n\nOutro.\n');
  });
});
