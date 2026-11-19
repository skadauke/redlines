// @vitest-environment happy-dom
// A heading's attributes in a pandoc file are a small chip after the text, with the source shown
// while the caret is in them (#1170); in a Markdown file they are text.

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { setViewModeEffect } from '../tracked/field.ts';
import { headingAttributes } from './quarto-heading-attrs.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const DOC = [
  '# Introduction {#sec-intro}',
  '',
  'Text.',
  '',
  '## Methods {#sec-methods .unnumbered}',
  '',
  'Setext {#sec-setext}',
  '===',
  '',
  '```',
  '# Not a heading {#sec-code}',
  '```',
  '',
].join('\n');

function editorOf(doc: string, dialect: 'gfm' | 'pandoc' = 'pandoc'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, dialect });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
  open.push(editor);
  return editor;
}

const chips = (editor: Editor) =>
  [...editor.view.contentDOM.querySelectorAll('.rl-attr-chip')].map((chip) => chip.textContent);

describe('the attributes at the end of a heading', () => {
  it('are read from the braces after a space', () => {
    expect(headingAttributes('# Intro {#sec-intro}')).toEqual({
      from: 8,
      to: 20,
      inner: '#sec-intro',
    });
    expect(headingAttributes('## A {.unnumbered}')?.inner).toBe('.unnumbered');
    expect(headingAttributes('## A {-}')?.inner).toBe('-');
    expect(headingAttributes('## A {key="v"}')?.inner).toBe('key="v"');
    // Markers of changes after them are not part of them.
    expect(headingAttributes('# A {#x}<!--ins k3x9-->')?.inner).toBe('#x');
    expect(headingAttributes('# A {just text}')).toBeNull();
    expect(headingAttributes('# A{#x}')).toBeNull();
  });
});

describe('a heading with attributes in the preview', () => {
  it('draws a chip in each look, and not in the code', () => {
    const editor = editorOf(DOC);
    for (const mode of ['redlines', 'simple', 'clean'] as const) {
      editor.view.dispatch({ effects: setViewModeEffect.of(mode) });
      expect(chips(editor), mode).toEqual([
        '#sec-intro',
        '#sec-methods .unnumbered',
        '#sec-setext',
      ]);
    }
    expect(editor.view.contentDOM.textContent).not.toContain('{#sec-intro}');
  });

  it('shows the source, small, while the caret is in it', () => {
    const editor = editorOf(DOC);
    const at = editor.view.state.doc.line(1).text.indexOf('{#') + 3;
    editor.view.dispatch({ selection: { anchor: at } });
    expect(chips(editor)).toEqual(['#sec-methods .unnumbered', '#sec-setext']);
    expect(editor.view.contentDOM.querySelector('.rl-attr-source')?.textContent).toBe(
      '{#sec-intro}',
    );
  });

  it('is text in a Markdown file', () => {
    const editor = editorOf(DOC, 'gfm');
    expect(chips(editor)).toEqual([]);
  });
});
