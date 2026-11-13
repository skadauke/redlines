// @vitest-environment happy-dom
// Subscript and superscript in the preview (#310): `<sub>` and `<sup>` are read, in every file
// type, and their text is drawn smaller and lowered or raised. The tags are hidden unless the caret
// is in them or in the text, as the syntax of any inline format is.

import { forceParsing, syntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { previewDecorations } from './decorations.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function editorAt(doc: string, cursor: number): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

/** What the preview draws: the ranges of its replaced syntax, and of the text with each class. */
function drawn(editor: Editor) {
  const replaced: number[][] = [];
  const classes = new Map<string, number[][]>();
  const { state } = editor.view;
  previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
    if (value.point && from < to) replaced.push([from, to]);
    const spec = value.spec as { class?: string };
    for (const name of (spec.class ?? '').split(' ').filter(Boolean)) {
      classes.set(name, [...(classes.get(name) ?? []), [from, to]]);
    }
  });
  return { replaced, classes };
}

/** The names of the nodes of the parse, with their text, for what has `name` in it. */
function nodes(editor: Editor, name: string): string[] {
  const found: string[] = [];
  const { state } = editor.view;
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === name) found.push(state.sliceDoc(ref.from, ref.to));
    },
  });
  return found;
}

describe('subscript and superscript in the parse (#310)', () => {
  it('reads <sub> and <sup> pairs as nodes, their tags as marks', () => {
    const editor = editorAt('H<sub>2</sub>O and x<sup>2</sup>', 0);
    expect(nodes(editor, 'Subscript')).toEqual(['<sub>2</sub>']);
    expect(nodes(editor, 'Superscript')).toEqual(['<sup>2</sup>']);
    expect(nodes(editor, 'SubscriptMark')).toEqual(['<sub>', '</sub>']);
    expect(nodes(editor, 'SuperscriptMark')).toEqual(['<sup>', '</sup>']);
  });

  it('reads no other tag: they show as written, as HTML tags', () => {
    for (const doc of [
      'a <SUB>b</SUB> c',
      'a <sub class="x">b</sub> c',
      'a <sub >b</sub> c',
      'a <sub>b</SUB> c',
      'a <sub>b c',
      'a b</sub> c',
      'a \\<sub>b</sub> c',
      'a `<sub>b</sub>` c',
      'a <!-- <sub>b</sub> --> c',
    ]) {
      const editor = editorAt(doc, 0);
      expect(nodes(editor, 'Subscript'), doc).toEqual([]);
    }
  });

  it('pairs tags as HTML does, and reads them in the text of a link and in emphasis', () => {
    const editor = editorAt(
      'a <sub>b <sub>c</sub> d</sub> e *f <sup>g</sup>* [h<sub>i</sub>](u)',
      0,
    );
    expect(nodes(editor, 'Subscript')).toEqual([
      '<sub>b <sub>c</sub> d</sub>',
      '<sub>c</sub>',
      '<sub>i</sub>',
    ]);
    expect(nodes(editor, 'Superscript')).toEqual(['<sup>g</sup>']);
  });

  it('does not pair tags across the edge of a link or of a table cell', () => {
    for (const doc of ['[a<sub>b](u) c</sub>', '| a <sub>b | c</sub> |\n| - | - |\n| d | e |']) {
      expect(nodes(editorAt(doc, 0), 'Subscript'), doc).toEqual([]);
    }
  });
});

describe('subscript and superscript in the preview (#310)', () => {
  it('hides the tags away from the caret, and draws the text as subscript or superscript', () => {
    const doc = 'H<sub>2</sub>O and x<sup>2</sup>';
    const editor = editorAt(doc, 0);
    const { replaced, classes } = drawn(editor);
    expect(replaced).toEqual([
      [1, 6],
      [7, 13],
      [doc.indexOf('<sup>'), doc.indexOf('<sup>') + 5],
      [doc.indexOf('</sup>'), doc.indexOf('</sup>') + 6],
    ]);
    expect(classes.get('rl-sub')).toEqual([[1, 13]]);
    expect(classes.get('rl-sup')).toEqual([[doc.indexOf('<sup>'), doc.length]]);
    expect(classes.get('rl-syntax')).toBeUndefined();
  });

  it('shows the tags in the syntax color while the caret is in the text or the tags', () => {
    const doc = 'H<sub>2</sub>O';
    for (const at of [1, 3, 6, 7, 13]) {
      const { replaced, classes } = drawn(editorAt(doc, at));
      expect(replaced, `caret at ${at}`).toEqual([]);
      expect(classes.get('rl-syntax'), `caret at ${at}`).toEqual([
        [1, 6],
        [7, 13],
      ]);
    }
    // At the edge of the whole element, as for the other inline formats.
    expect(drawn(editorAt(doc, 0)).replaced).toEqual([
      [1, 6],
      [7, 13],
    ]);
  });

  it('draws nothing for tags that are not formats', () => {
    const { replaced, classes } = drawn(editorAt('a <SUB>b</SUB> c', 0));
    expect(replaced).toEqual([]);
    expect(classes.get('rl-sub')).toBeUndefined();
  });

  it('is not drawn in Raw, which shows the source as written', () => {
    const editor = editorAt('H<sub>2</sub>O', 0);
    editor.setViewMode('raw');
    expect(drawn(editor).classes.get('rl-sub')).toBeUndefined();
  });
});
