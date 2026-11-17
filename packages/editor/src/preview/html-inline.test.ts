// @vitest-environment happy-dom
// Inline HTML as GitHub draws it (#687): the tags are hidden and the text is drawn as the element,
// through a mark decoration with the real tag name; `<br>` and `<wbr>` are one unit for the caret;
// an element GitHub drops keeps its text or, with none, shows as a chip. The check against GitHub
// (github-html.check.test.ts) holds the list these read.

import { forceParsing, syntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { previewDecorations } from './decorations.ts';
import { baseThemeSpec } from './theme.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function editorAt(doc: string, cursor = 0): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: Math.min(cursor, doc.length) } });
  open.push(editor);
  return editor;
}

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

/** The marks drawn: the tag name, text and attributes of each; and the hidden spans. */
function drawn(editor: Editor) {
  const marks: { tag: string; text: string; attributes: Record<string, string> }[] = [];
  const hidden: string[] = [];
  const { state } = editor.view;
  previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { tagName?: string; attributes?: Record<string, string> };
    if (spec.tagName) {
      marks.push({
        tag: spec.tagName,
        text: state.sliceDoc(from, to),
        attributes: spec.attributes ?? {},
      });
    }
    if (value.point && from < to) hidden.push(state.sliceDoc(from, to));
  });
  return { marks, hidden };
}

describe('inline HTML tags', () => {
  it('draws each as its element, with its tags hidden', () => {
    const doc = 'Press <kbd>Ctrl</kbd> and <mark>this</mark> <abbr title="Hi">HI</abbr>.';
    const editor = editorAt(doc, doc.length);
    expect(nodes(editor, 'HtmlElement')).toHaveLength(3);
    const { marks, hidden } = drawn(editor);
    expect(marks.map((m) => [m.tag, m.text])).toEqual([
      ['kbd', 'Ctrl'],
      ['mark', 'this'],
      ['abbr', 'HI'],
    ]);
    expect(marks[2]?.attributes['data-rl-title']).toBe('Hi');
    expect(marks[2]?.attributes['title']).toBeUndefined();
    expect(hidden).toContain('<kbd>');
    expect(hidden).toContain('</abbr>');
    expect(hidden).toContain('<abbr title="Hi">');
  });

  it('shows the tags while the caret is in the element', () => {
    const editor = editorAt('a <kbd>Ctrl</kbd> b', 8);
    expect(drawn(editor).hidden).not.toContain('<kbd>');
  });

  it('nests, and leaves a tag with no pair as text', () => {
    const doc = '<q>a <cite>b</cite></q> and <small>c';
    const editor = editorAt(doc, doc.length);
    expect(
      drawn(editor)
        .marks.map((m) => m.tag)
        .sort(),
    ).toEqual(['cite', 'q']);
    expect(nodes(editor, 'HtmlElement')).toHaveLength(2);
  });

  it('draws ruby with its parts, bdo with its direction, ins, del and s', () => {
    const doc =
      '<ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby> <bdo dir="rtl">x</bdo> <ins>a</ins><del>b</del><s>c</s><strike>d</strike>';
    const editor = editorAt(doc, doc.length);
    const { marks } = drawn(editor);
    expect(marks.map((m) => m.tag)).toEqual(
      expect.arrayContaining(['ruby', 'rp', 'rt', 'bdo', 'ins', 'del', 's', 'strike']),
    );
    expect(marks.find((m) => m.tag === 'bdo')?.attributes['dir']).toBe('rtl');
  });

  it('draws a link as a link, never with its address', () => {
    const doc = '<a href="javascript:x" onclick="y()">go</a> b';
    const editor = editorAt(doc, doc.length);
    expect(drawn(editor).marks[0]).toMatchObject({ tag: 'a', text: 'go', attributes: {} });
  });

  it('steps over <br> and <wbr> as one unit, and hides <u> and unknown tags', () => {
    const doc = 'a<br>b<wbr>c <u>d</u> <blink>e</blink> end';
    const editor = editorAt(doc, doc.length);
    expect(nodes(editor, 'HtmlBreak')).toEqual(['<br>']);
    expect(nodes(editor, 'HtmlWbr')).toEqual(['<wbr>']);
    expect(drawn(editor).hidden).toEqual(
      expect.arrayContaining(['<u>', '</u>', '<blink>', '</blink>']),
    );
  });

  it('shows the nine escaped tags as text, and draws a video as a chip', () => {
    const doc = 'a <script>x</script> <iframe></iframe> <video src="a.mp4"></video> end';
    const editor = editorAt(doc, doc.length);
    expect(nodes(editor, 'HtmlElement')).toEqual([]);
    expect(nodes(editor, 'HtmlChip')).toEqual(['<video src="a.mp4">']);
    expect(drawn(editor).hidden).not.toContain('<script>');
  });

  it('leaves code, comments and autolinks alone', () => {
    const doc = '`<kbd>x</kbd>` <!-- <b>x</b> --> <https://a.example> <me@a.example>';
    const editor = editorAt(doc, doc.length);
    expect(nodes(editor, 'HtmlElement')).toEqual([]);
    expect(nodes(editor, 'HtmlDropped')).toEqual([]);
  });
});

describe('the look of the inline tags (#687)', () => {
  const rule = (selector: string): Record<string, string> =>
    (baseThemeSpec[selector] ?? {}) as Record<string, string>;
  const find = (name: string) =>
    Object.keys(baseThemeSpec).find((key) => key.split(/,\s*/).includes(`.rl-h-${name}`));

  it('<ins>, <del> and <s> take the text ink: underline or strike, no color of their own', () => {
    for (const name of ['ins', 'del', 's', 'strike']) {
      const key = find(name);
      expect(key, name).toBeDefined();
      expect(Object.keys(rule(key!)), name).toEqual(['textDecoration']);
    }
    expect(rule(find('ins')!)['textDecoration']).toBe('underline');
    expect(rule(find('del')!)['textDecoration']).toBe('line-through');
  });

  it('they are drawn with no class of a pending change, in the Redlines look', () => {
    const editor = editorAt('A <ins>added</ins> and <del>gone</del> and <s>struck</s> text.\n');
    editor.setViewMode('redlines');
    expect(editor.view.contentDOM.innerHTML).not.toMatch(/rl-(?:ins|del)\b/);
    for (const tag of ['ins', 'del', 's']) {
      expect(editor.view.contentDOM.querySelector(`${tag}.rl-h-${tag}`)).not.toBeNull();
    }
  });

  it('<mark> is GitHub yellow in light and in dark, with the text ink', () => {
    const style = rule(find('mark')!);
    const found = /^light-dark\((.+?), (rgba\(.+\))\)$/.exec(style['backgroundColor']!);
    expect(found?.[1]).toBe('#fff8c5');
    // A translucent amber over the dark page: it stays yellow, and the ink stays readable.
    expect(found?.[2]).toMatch(/^rgba\(187, 128, 9, /);
    expect(style['color']).toBe('inherit');
  });
});
