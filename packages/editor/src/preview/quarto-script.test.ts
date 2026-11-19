// @vitest-environment happy-dom
// Pandoc's subscript and superscript are drawn in a pandoc file, with their marks hidden and the
// source shown under the caret, and are not in a Markdown file (#1176).

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { setViewModeEffect } from '../tracked/field.ts';
import { scriptsOf } from './quarto-script.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const DOC = [
  'Water is H~2~O and a square is x^2^.',
  '',
  'Not ~~struck~~, not ~a b~, not `H~2~O`, not $x^2^$.',
  '',
  '```',
  'H~2~O in code',
  '```',
  '',
  'Last.',
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

const drawn = (editor: Editor, selector: string) =>
  [...editor.view.contentDOM.querySelectorAll(selector)].map((el) => el.textContent);

describe('the parse of subscript and superscript', () => {
  it('reads pandoc’s rule', () => {
    expect(scriptsOf('H~2~O and x^2^')).toEqual([
      { from: 1, to: 4, kind: 'sub' },
      { from: 11, to: 14, kind: 'sup' },
    ]);
    // Spaces, strikethrough, an inline note, an escaped mark and math are not scripts.
    expect(scriptsOf('~a b~ ~~c~~ ^[note]^ \\~a~ $x^2^$')).toEqual([]);
    expect(scriptsOf('x^2^ and $y$ and z^3^')).toHaveLength(2);
  });
});

describe('subscript and superscript in the preview', () => {
  it('are drawn lowered and raised, with no marks, in each look', () => {
    const editor = editorOf();
    for (const mode of ['redlines', 'simple', 'clean'] as const) {
      editor.view.dispatch({ effects: setViewModeEffect.of(mode) });
      expect(drawn(editor, '.rl-sub'), mode).toEqual(['2']);
      expect(drawn(editor, '.rl-sup'), mode).toEqual(['2']);
      expect(editor.view.contentDOM.querySelector('.cm-line')?.textContent).toBe(
        'Water is H2O and a square is x2.',
      );
    }
    // Code and the lines of math keep their marks.
    expect(editor.view.contentDOM.textContent).toContain('H~2~O in code');
  });

  it('shows the source while the caret is in them', () => {
    const editor = editorOf();
    editor.view.dispatch({ selection: { anchor: DOC.indexOf('~2~') + 2 } });
    expect(editor.view.contentDOM.querySelector('.cm-line')?.textContent).toBe(
      'Water is H~2~O and a square is x2.',
    );
  });

  it('are not drawn in a Markdown file', () => {
    const editor = editorOf('gfm');
    expect(editor.view.contentDOM.querySelector('.rl-sub, .rl-sup')).toBeNull();
  });
});
