// @vitest-environment happy-dom
// Hard line breaks drawn (design: block editing, "Shift-Return"): the backslash, or the two spaces,
// in front of the line break is hidden and stepped over, so that the break is one character for
// the arrows and for Backspace; the line break itself is drawn as a break.
import { forceParsing } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { previewDecorations } from '../preview/decorations.ts';
import { scriptRows } from './script.ts';

const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, view?: 'raw'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    ...(view ? { view } : {}),
  });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  open.push(editor);
  return editor;
}

/** The ranges the preview hides. */
function hidden(editor: Editor): [number, number][] {
  const found: [number, number][] = [];
  const { state } = editor.view;
  previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
    if (value.point && from < to) found.push([from, to]);
  });
  return found;
}

describe('hard breaks drawn', () => {
  it('hides the backslash, and the spaces, of a hard break', () => {
    const doc = 'One\\\ntwo  \nthree.';
    expect(hidden(load(doc))).toEqual([
      [3, 4],
      [8, 10],
    ]);
  });

  it('hides it in a list item and a quote, and next to a pending change', () => {
    expect(hidden(load('- One\\\n  two.'))).toContainEqual([5, 6]);
    expect(hidden(load('> One\\\n> two.'))).toContainEqual([5, 6]);
    const doc = 'One <!--split a-->\\\ntwo.';
    expect(hidden(load(doc))).toContainEqual([doc.indexOf('\\'), doc.indexOf('\\') + 1]);
  });

  it('hides nothing in Raw, nor for an escaped backslash', () => {
    expect(hidden(load('One\\\ntwo.', 'raw'))).toEqual([]);
    // An escaped backslash is the escape's, and the line break after it is soft.
    expect(hidden(load('One\\\\\ntwo.'))).toEqual([[3, 4]]);
    expect(hidden(load('One\\'))).toEqual([]);
  });

  it('makes the syntax something the caret steps over', () => {
    const editor = load('One\\\ntwo.  \nthree.');
    const stepped: [number, number][] = [];
    for (const source of editor.view.state.facet(EditorView.atomicRanges)) {
      for (let it = source(editor.view).iter(); it.value; it.next()) stepped.push([it.from, it.to]);
    }
    expect(stepped).toEqual(expect.arrayContaining([[3, 4]]));
  });
});

describe('the arrows and Backspace over a hard break', () => {
  scriptRows([
    {
      name: '→ in front of the break goes to the start of the next line',
      doc: 'One‸\\⏎two.',
      keys: ['ArrowRight'],
      tc: false,
      expect: { caret: 'One\\⏎‸two.' },
    },
    {
      name: '← at the start of the next line goes in front of the break',
      doc: 'One\\⏎‸two.',
      keys: ['ArrowLeft'],
      tc: false,
      expect: { caret: 'One‸\\⏎two.' },
    },
    {
      name: '→ over a break of two spaces',
      doc: 'One‸  ⏎two.',
      keys: ['ArrowRight'],
      tc: false,
      expect: { caret: 'One  ⏎‸two.' },
    },
    {
      name: '← over a break in a list item',
      doc: '- One\\⏎  ‸two.',
      keys: ['ArrowLeft'],
      tc: false,
      expect: { caret: '- One‸\\⏎  two.' },
    },
    {
      name: 'Backspace over the break takes the whole break, a backslash',
      doc: 'One\\⏎‸two.',
      keys: ['Backspace'],
      tc: false,
      expect: { file: 'Onetwo.' },
    },
    {
      name: 'Backspace over the break takes the whole break, two spaces',
      doc: 'One  ⏎‸two.',
      keys: ['Backspace'],
      tc: false,
      expect: { file: 'Onetwo.' },
    },
  ]);
});
