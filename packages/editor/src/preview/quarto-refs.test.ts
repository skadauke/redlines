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
    // Without the setting a section is named by its title, not numbered.
    const plain = editorAt('# One {#sec-one}\n\nSee @sec-one.\n', 0);
    expect(targetsOf(plain.view.state.doc).get('sec-one')?.text).toBe('One');
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

describe('the extent of a target', () => {
  it('is the whole figure, table with its caption, equation, chunk and section', () => {
    const doc = editorAt(DOC, 0).view.state.doc;
    const targets = targetsOf(doc);
    const slice = (label: string) => {
      const target = targets.get(label)!;
      return doc.sliceString(target.pos, target.end);
    };
    expect(slice('fig-plot')).toBe('![A plot](plot.png){#fig-plot}');
    expect(slice('tbl-data')).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n\n: Data {#tbl-data}');
    expect(slice('eq-sum')).toBe('$$ x = 1 $$ {#eq-sum}');
    expect(slice('fig-second')).toBe('```{r}\n#| label: fig-second\nplot(1)\n```');
    // A section runs to the heading of its level or above: Method (level 2) ends before "Skipped".
    expect(slice('sec-method').startsWith('## Method {#sec-method}')).toBe(true);
    expect(slice('sec-method')).not.toContain('Skipped');
    expect(slice('sec-intro')).toContain('## Method');
    expect(slice('sec-intro')).not.toContain('# Skipped');
  });

  it('is the table below a caption that comes first', () => {
    const doc = editorAt('Intro\n\n: Data {#tbl-data}\n\n| a |\n| - |\n| 1 |\n\nEnd\n', 0).view
      .state.doc;
    const target = targetsOf(doc).get('tbl-data')!;
    expect(doc.sliceString(target.pos, target.end)).toBe(
      ': Data {#tbl-data}\n\n| a |\n| - |\n| 1 |',
    );
  });
});

describe('references as links', () => {
  const link = (editor: Editor, text: string) =>
    [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-xref')].find(
      (el) => el.textContent === text,
    )!;
  const press = (el: HTMLElement, init: MouseEventInit = {}) =>
    el.dispatchEvent(
      new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true, ...init }),
    );

  it('are text with a dotted underline, not a chip', () => {
    const editor = editorAt(DOC, DOC.length);
    const el = link(editor, 'Figure 1');
    expect(el.getAttribute('role')).toBe('link');
    expect(el.classList.contains('rl-xref')).toBe(true);
    // A section with no number (the file doesn't number sections) shows its title.
    const plain = editorAt('# One {#sec-one}\n\nSee @sec-one.\n', 0);
    expect(link(plain, 'One')).toBeTruthy();
  });

  it('put the caret there on a click, which shows the source', () => {
    const editor = editorAt(DOC, DOC.length);
    const token = DOC.indexOf('@tbl-data');
    press(link(editor, 'Table 1'));
    expect(editor.view.state.selection.main.head).toBe(token + '@tbl-data'.length);
    expect(editor.view.dom.querySelector('.rl-xref')?.textContent).not.toBe('Table 1');
    expect(chips(editor).map(([text]) => text)).not.toContain('@tbl-data');
  });

  it('go to the target on a ⌘-click, with the whole target to show', () => {
    const editor = editorAt(DOC, DOC.length);
    const doc = editor.view.state.doc;
    const effects: unknown[] = [];
    const seen = editor.view.state;
    press(link(editor, 'Table 1'), { metaKey: true });
    const target = targetsOf(doc).get('tbl-data')!;
    // (A table moves the caret into its first cell.)
    expect(editor.view.state.selection.main.head).toBeGreaterThanOrEqual(target.pos);
    expect(editor.view.state.selection.main.head).toBeLessThan(target.pos + 4);
    expect(seen).not.toBe(editor.view.state);
    expect(effects).toEqual([]);
    // Ctrl does the same, for systems that have no ⌘.
    editor.view.dispatch({ selection: { anchor: DOC.length } });
    press(link(editor, 'Figure 1'), { ctrlKey: true });
    expect(editor.view.state.selection.main.head).toBe(targetsOf(doc).get('fig-plot')!.pos);
  });

  it('leave a right-click and a Shift-click to the editor', () => {
    const editor = editorAt(DOC, DOC.length);
    press(link(editor, 'Figure 1'), { shiftKey: true });
    expect(editor.view.state.selection.main.head).toBe(DOC.length);
    press(link(editor, 'Figure 1'), { button: 2 });
    expect(editor.view.state.selection.main.head).toBe(DOC.length);
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
