// @vitest-environment happy-dom
// A div that is not a callout (`::: {.columns}`) is drawn as a small chip for its opening fence and
// nothing for its closing one, not as source (#1213); callouts are left to their own box.

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { setViewModeEffect } from '../tracked/field.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const DOC = [
  '::: {.columns}',
  '::: {.column width="50%"}',
  'Left.',
  ':::',
  '::: {.column width="50%"}',
  'Right.',
  ':::',
  ':::',
  '',
  '::: {.callout-note}',
  'A note.',
  ':::',
  '',
  'After.',
  '',
].join('\n');

function editorOf(dialect: 'gfm' | 'pandoc' = 'pandoc'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc: DOC, author, dialect });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: DOC.length } });
  open.push(editor);
  return editor;
}

describe('a div that is not a callout', () => {
  it('is a chip, with no fence drawn, in each look', () => {
    const editor = editorOf();
    for (const mode of ['redlines', 'simple', 'clean'] as const) {
      editor.view.dispatch({ effects: setViewModeEffect.of(mode) });
      const chips = [...editor.view.contentDOM.querySelectorAll('.rl-div-chip')].map(
        (chip) => chip.textContent,
      );
      expect(chips, mode).toEqual(['columns', 'column width=50%', 'column width=50%']);
      const shown = editor.view.contentDOM.textContent ?? '';
      expect(shown).not.toContain('{.');
      expect(shown).toContain('Left.');
      // The callout's closing fence and the divs' are all hidden, and `:::` shows nowhere.
      expect(shown).not.toContain(':::');
    }
  });

  it('shows its fence while the caret is on it', () => {
    const editor = editorOf();
    editor.view.dispatch({ selection: { anchor: 3 } });
    expect(editor.view.contentDOM.textContent).toContain('::: {.columns}');
    expect(editor.view.contentDOM.querySelectorAll('.rl-div-chip')).toHaveLength(2);
  });

  it('is text in a Markdown file', () => {
    const editor = editorOf('gfm');
    expect(editor.view.contentDOM.querySelector('.rl-div-chip')).toBeNull();
  });
});
