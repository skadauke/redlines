// @vitest-environment happy-dom
// Quarto's callouts in the preview (decision 2 of docs/research/quarto.md): a div with a class
// `callout-TYPE` wears the alert's box in a pandoc file, and is plain text in a Markdown file.

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { calloutsOf, divsOf } from './divs.ts';
import { quartoCalloutDecorations } from './quarto-callout.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const DOC = [
  '# Title',
  '',
  '::: {.callout-warning title="Careful" collapse="true"}',
  'The body.',
  '',
  'Another paragraph.',
  ':::',
  '',
  'After.',
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

function classes(editor: Editor): Map<number, string[]> {
  const lines = new Map<number, string[]>();
  const { state } = editor.view;
  quartoCalloutDecorations(state).between(0, state.doc.length, (from, _to, value) => {
    const spec = value.spec as { class?: string };
    if (spec.class) lines.set(from, [...(lines.get(from) ?? []), ...spec.class.split(' ')]);
  });
  return lines;
}

describe('the divs of a document', () => {
  it('reads fences, nesting, attributes and the title of a callout', () => {
    const editor = editorAt(DOC, DOC.length);
    const doc = editor.view.state.doc;
    const divs = divsOf(doc);
    expect(divs).toHaveLength(1);
    expect(divs[0]).toMatchObject({ open: 3, close: 7, depth: 0 });
    const [callout] = calloutsOf(doc, divs);
    expect(callout).toMatchObject({ type: 'warning', title: 'Careful', collapse: true });
  });

  it('takes the first heading as the title, and ignores fences in code and front matter', () => {
    const text = [
      '---',
      'title: x',
      '---',
      '',
      '```',
      '::: {.callout-note}',
      '```',
      '',
      '::: {.callout-tip}',
      '## From the heading',
      'Body',
      ':::',
    ].join('\n');
    const editor = editorAt(text, 0);
    const found = calloutsOf(editor.view.state.doc, divsOf(editor.view.state.doc));
    expect(found.map((c) => [c.type, c.title])).toEqual([['tip', 'From the heading']]);
  });

  it('reads divs when the front matter is never closed, and skips an indented code fence', () => {
    const open = editorAt('---\ntitle: x\n\n::: {.callout-note}\nBody\n:::\n', 0);
    expect(calloutsOf(open.view.state.doc, divsOf(open.view.state.doc))).toHaveLength(1);
    const listed = editorAt('- item\n\n    ```\n    ::: {.callout-note}\n    ```\n', 0);
    expect(divsOf(listed.view.state.doc)).toHaveLength(0);
  });

  it('closes the innermost div and counts depth', () => {
    const text = '::: {.callout-note}\n::: {.columns}\nx\n:::\ny\n:::\n';
    const editor = editorAt(text, 0);
    const divs = divsOf(editor.view.state.doc);
    expect(divs.map((d) => [d.open, d.close, d.depth])).toEqual([
      [1, 6, 0],
      [2, 4, 1],
    ]);
  });
});

describe('a callout in the preview', () => {
  it('draws the box on the alert classes, folded as written, until the caret comes', () => {
    const editor = editorAt(DOC, 0);
    const lines = classes(editor);
    const fence = editor.view.state.doc.line(3).from;
    expect(lines.get(fence)).toEqual(
      expect.arrayContaining([
        'rl-callout',
        'rl-callout-warning',
        'rl-callout-first',
        'rl-callout-last',
      ]),
    );
    // Folded: the body's lines have no box of their own.
    expect(lines.has(editor.view.state.doc.line(4).from)).toBe(false);
    const inside = editor.view.state.doc.line(4).from + 2;
    editor.view.dispatch({ selection: { anchor: inside } });
    const open = classes(editor);
    expect(open.get(editor.view.state.doc.line(4).from)).toContain('rl-callout');
    expect(open.get(editor.view.state.doc.line(6).from)).toContain('rl-callout-last');
  });

  it('forgets a fold when its fence is gone', () => {
    const editor = editorAt(DOC, 0);
    const fence = editor.view.state.doc.line(3);
    const press = editor.view.contentDOM.querySelector<HTMLElement>('.rl-callout-fold');
    expect(press).not.toBeNull();
    press?.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    // Open now. The whole div goes, and another callout is typed at the same place.
    const end = editor.view.state.doc.line(7).to + 1;
    editor.view.dispatch({ changes: { from: fence.from, to: end, insert: 'plain\n' } });
    editor.view.dispatch({
      changes: { from: fence.from, insert: '::: {.callout-tip collapse="true"}\nx\n:::\n' },
    });
    editor.view.dispatch({ selection: { anchor: 0 } });
    const lines = classes(editor);
    // The new callout is folded as it was written: its body line has no box.
    expect(lines.has(editor.view.state.doc.line(4).from)).toBe(false);
  });

  it('shows the fence as source while the caret is on it', () => {
    const editor = editorAt(DOC, 0);
    const line = editor.view.state.doc.line(3);
    editor.view.dispatch({ selection: { anchor: line.from + 4 } });
    let replacedFence = false;
    quartoCalloutDecorations(editor.view.state).between(line.from, line.to, (from, to) => {
      if (from === line.from && to === line.to) replacedFence = true;
    });
    expect(replacedFence).toBe(false);
  });

  it('draws nothing in a Markdown file', () => {
    const editor = editorAt(DOC, 0, 'gfm');
    expect(classes(editor).size).toBe(0);
  });

  it('draws nothing for a div that is not a callout, or one never closed', () => {
    const editor = editorAt('::: {.columns}\nx\n:::\n\n::: {.callout-note}\nunclosed\n', 0);
    expect(classes(editor).size).toBe(0);
  });
});
