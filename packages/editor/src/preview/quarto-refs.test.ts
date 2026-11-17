// @vitest-environment happy-dom
// Cross-references as chips (decision 3 of docs/research/quarto.md): a reference whose target is in
// the file is a chip with its label and number, and any other is plain text.

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { refDecorations, targetsOf } from './quarto-refs.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const DOC = [
  '---',
  'number-sections: true',
  '---',
  '',
  '# Intro {#sec-intro}',
  '',
  '## Method {#sec-method}',
  '',
  '# Skipped {.unnumbered}',
  '',
  '# Results {#sec-results}',
  '',
  'See @fig-plot, @tbl-data, @eq-sum, @sec-method, @sec-results and @fig-missing, or `@fig-plot`.',
  '',
  '![A plot](plot.png){#fig-plot}',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  ': Data {#tbl-data}',
  '',
  '$$ x = 1 $$ {#eq-sum}',
  '',
  '```{r}',
  '#| label: fig-second',
  'plot(1)',
  '```',
  '',
  'And @fig-second.',
  '',
].join('\n');

function editorAt(doc: string, cursor: number, dialect: 'gfm' | 'pandoc' = 'pandoc'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, dialect });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

/** The text each chip stands for, with the token it replaces. */
function chips(editor: Editor): [string, string][] {
  const { state } = editor.view;
  const found: [string, string][] = [];
  refDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const widget = (value.spec as { widget?: { text: string } }).widget;
    if (widget) found.push([state.sliceDoc(from, to), widget.text]);
  });
  return found;
}

describe('the targets of a document', () => {
  it('numbers each kind in the order of the document', () => {
    const editor = editorAt(DOC, DOC.length);
    const targets = targetsOf(editor.view.state.doc);
    const texts = Object.fromEntries([...targets].map(([label, t]) => [label, t.text]));
    expect(texts).toMatchObject({
      'sec-intro': 'Section 1',
      'sec-method': 'Section 1.1',
      'sec-results': 'Section 2',
      'fig-plot': 'Figure 1',
      'tbl-data': 'Table 1',
      'eq-sum': 'Equation 1',
      'fig-second': 'Figure 2',
    });
  });
});

describe('what a document says of its targets', () => {
  it('numbers sections only where the file asks, and reads setext headings', () => {
    const plain = editorAt('# One {#sec-one}\n\nSee @sec-one.\n', 0);
    expect(targetsOf(plain.view.state.doc).size).toBe(0);
    const text =
      '---\nnumber-sections: true\n---\n\nOne {#sec-one}\n===\n\nTwo {#sec-two}\n---\n\n# Three {#sec-three}\n';
    const setext = editorAt(text, 0);
    const found = targetsOf(setext.view.state.doc);
    expect(found.get('sec-one')?.text).toBe('Section 1');
    expect(found.get('sec-two')?.text).toBe('Section 1.1');
    expect(found.get('sec-three')?.text).toBe('Section 2');
  });

  it('reads no target or reference in a marker or in code', () => {
    const text =
      'See <!--del k3x9 {#fig-gone} @fig-gone-->@fig-real and `{#fig-code}` @fig-code.\n\n![x](x.png){#fig-real}\n';
    const editor = editorAt(text, text.length);
    const found = targetsOf(editor.view.state.doc);
    expect([...found.keys()]).toEqual(['fig-real']);
    expect(chips(editor)).toEqual([['@fig-real', 'Figure 1']]);
  });
});

describe('references in the preview', () => {
  it('are chips where the target is, and plain text where it is not or in code', () => {
    const editor = editorAt(DOC, DOC.length);
    expect(chips(editor)).toEqual([
      ['@fig-plot', 'Figure 1'],
      ['@tbl-data', 'Table 1'],
      ['@eq-sum', 'Equation 1'],
      ['@sec-method', 'Section 1.1'],
      ['@sec-results', 'Section 2'],
      ['@fig-second', 'Figure 2'],
    ]);
  });

  it('show their source while the caret is on one', () => {
    const at = DOC.indexOf('@tbl-data') + 3;
    const editor = editorAt(DOC, at);
    expect(chips(editor).map(([token]) => token)).not.toContain('@tbl-data');
    expect(chips(editor).map(([token]) => token)).toContain('@fig-plot');
  });

  it('are none in a Markdown file', () => {
    expect(chips(editorAt(DOC, 0, 'gfm'))).toEqual([]);
  });
});
