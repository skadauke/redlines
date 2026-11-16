// @vitest-environment happy-dom
// Insert > Collapsible Section (#688): a new section after the block with its summary selected and
// open, and a selection of blocks wrapped without rewriting them.
import { forceParsing } from '@codemirror/language';
import { containersOf, createEditor, type Editor, isSectionOpen } from '@redlines/editor';
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const made: { editor: Editor; remove: () => void }[] = [];

function mount(doc: string, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, tracking });
  made.push({ editor, remove: createFormatting(editor, { author, notice: () => {} }) });
  return editor;
}

afterEach(() => {
  for (const { editor, remove } of made.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

function select(editor: Editor, anchor: number, head = anchor): void {
  editor.view.dispatch({ selection: { anchor, head } });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
}

describe('Collapsible Section', () => {
  it('inserts a section after the block, open, with the summary selected', () => {
    const editor = mount('One.\n\nTwo.');
    select(editor, 2);
    expect(editor.commands.run('block.details')).toBe(true);
    expect(editor.getDoc()).toBe(
      'One.\n\n<details>\n<summary>Summary</summary>\n\nText\n\n</details>\n\nTwo.',
    );
    const { state } = editor.view;
    const [section] = containersOf(state);
    expect(isSectionOpen(state, section!)).toBe(true);
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe('Summary');
  });

  it('wraps a selection of blocks with two insertions, leaving them as they are', () => {
    const editor = mount('One.\n\nTwo.\n\nThree.');
    select(editor, 0, 'One.\n\nTwo.'.length);
    expect(editor.commands.run('block.details')).toBe(true);
    expect(editor.getDoc()).toBe(
      '<details>\n<summary>Summary</summary>\n\nOne.\n\nTwo.\n\n</details>\n\nThree.',
    );
    expect(isSectionOpen(editor.view.state, containersOf(editor.view.state)[0]!)).toBe(true);
  });

  it('tracked: the section is an insertion', () => {
    const editor = mount('One.\n\nTwo.', true);
    select(editor, 0, 4);
    expect(editor.commands.run('block.details')).toBe(true);
    expect(editor.getDoc()).toContain('<!--ins');
    expect(newestView(editor.getDoc()).text).toContain('<details>');
    expect(containersOf(editor.view.state)).toHaveLength(1);
  });
});
