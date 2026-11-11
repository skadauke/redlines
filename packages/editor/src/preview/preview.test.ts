// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
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
  // The preview draws what the parser has reached, which under load can be less than the whole
  // document when the test looks.
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

interface Found {
  from: number;
  to: number;
  kind: 'line' | 'mark' | 'replace';
  className: string;
  block: boolean;
}

function decorations(editor: Editor): Found[] {
  const found: Found[] = [];
  const { state } = editor.view;
  previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string; block?: boolean };
    found.push({
      from,
      to,
      kind: !value.point ? 'mark' : from === to ? 'line' : 'replace',
      className: spec.class ?? '',
      block: spec.block ?? false,
    });
  });
  return found;
}

const replaced = (editor: Editor) =>
  decorations(editor)
    .filter((d) => d.kind === 'replace')
    .map((d) => [d.from, d.to]);

const classed = (editor: Editor, className: string) =>
  decorations(editor)
    .filter((d) => d.className.split(' ').includes(className))
    .map((d) => [d.from, d.to]);

/** The preview's decorations that keep the spell check out, and their classes. */
const unchecked = (editor: Editor) => {
  const found: [number, number, string][] = [];
  const { state } = editor.view;
  previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string; attributes?: Record<string, string> };
    if (spec.attributes?.spellcheck === 'false') found.push([from, to, spec.class ?? '']);
  });
  return found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
};

describe('the spell check', () => {
  it('is kept out of code, URLs and front matter, on the decorations the preview draws', () => {
    const doc = '---\nt: x\n---\n\nA `c` https://e.f/g <https://h.i/j>.\n\n```\nk\n```\n';
    const editor = editorAt(doc, doc.indexOf('A'));
    const at = (text: string) => doc.indexOf(text);
    expect(unchecked(editor)).toEqual([
      [0, 0, expect.stringContaining('rl-frontmatter')],
      [at('t: x'), at('t: x'), expect.stringContaining('rl-frontmatter')],
      [at('---\n\n'), at('---\n\n'), expect.stringContaining('rl-frontmatter')],
      [at('`c`'), at('`c`') + 3, 'rl-code'],
      [at('https://e'), at(' <https'), 'rl-link'],
      [at('https://h'), at('>.'), 'rl-link'],
      [at('```\nk'), at('```\nk'), expect.stringContaining('rl-codeblock')],
      [at('k\n```'), at('k\n```'), expect.stringContaining('rl-codeblock')],
      [doc.lastIndexOf('```'), doc.lastIndexOf('```'), expect.stringContaining('rl-codeblock')],
    ]);
  });

  it('is kept out of the URL of a link, an image or a reference while it shows', () => {
    const doc = '[a](https://b.c/d) ![e](f/g.png)\n\n[h]: https://i.j/k\n';
    const at = (text: string) => doc.indexOf(text);
    const link = editorAt(doc, at('a]'));
    expect(unchecked(link)).toContainEqual([at('https://b'), at(') !['), '']);
    const image = editorAt(doc, at('e]'));
    expect(unchecked(image)).toContainEqual([at('f/g'), at('.png') + 4, '']);
    expect(unchecked(image)).toContainEqual([at('https://i'), doc.length - 1, '']);
  });
});

describe('markdownPreview', () => {
  it('heading lines get rl-h1', () => {
    const editor = editorAt('# Title\n\n## Part\n\nText', 20);
    expect(classed(editor, 'rl-h1')).toEqual([[0, 0]]);
    expect(classed(editor, 'rl-h2')).toEqual([[9, 9]]);
  });

  it('hides bold markers away from the caret', () => {
    const editor = editorAt('a **b** c', 0);
    expect(replaced(editor)).toEqual([
      [2, 4],
      [5, 7],
    ]);
    expect(classed(editor, 'rl-strong')).toEqual([[2, 7]]);
    expect(classed(editor, 'rl-syntax')).toEqual([]);
  });

  it('shows bold markers at the caret', () => {
    const editor = editorAt('a **b** c', 4);
    expect(replaced(editor)).toEqual([]);
    expect(classed(editor, 'rl-syntax')).toEqual([
      [2, 4],
      [5, 7],
    ]);
  });

  it('hides the heading prefix unless the caret is in its #s, also on its line', () => {
    const doc = '# Title\n\nText';
    expect(replaced(editorAt(doc, doc.length))).toEqual([[0, 2]]);
    // In the text, at its start too: hidden (design: block editing).
    expect(replaced(editorAt(doc, 4))).toEqual([[0, 2]]);
    expect(replaced(editorAt(doc, 2))).toEqual([[0, 2]]);

    const inMarks = editorAt(doc, 1);
    expect(replaced(inMarks)).toEqual([]);
    expect(classed(inMarks, 'rl-syntax')).toEqual([[0, 1]]);
  });

  it("hides a quote's marker unless the caret is at it, also on its line", () => {
    const doc = '> One two.\n\nText';
    expect(replaced(editorAt(doc, 5))).toEqual([[0, 2]]);
    expect(replaced(editorAt(doc, 2))).toEqual([[0, 2]]);
    const atMark = editorAt(doc, 1);
    expect(replaced(atMark)).toEqual([]);
  });

  it('hides the link destination and keeps its text', () => {
    const editor = editorAt('See [the docs](https://example.com) now.', 0);
    expect(replaced(editor)).toEqual([
      [4, 5],
      [13, 35],
    ]);
    expect(classed(editor, 'rl-link')).toEqual([[5, 13]]);
  });

  it('renders list bullets as bullets and keeps ordered numbers', () => {
    const editor = editorAt('- one\n- two\n\n1. first\n\nEnd', 25);
    const marks = [...editor.view.contentDOM.querySelectorAll('.rl-list-mark')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['•', '•', '1.']);
    expect(classed(editor, 'rl-li')).toEqual([
      [0, 0],
      [6, 6],
      [13, 13],
    ]);
  });

  it('draws bullets of nested lists as rings, then squares', () => {
    const doc = '1. one\n   - two\n     - three\n       - four\n\nEnd';
    const editor = editorAt(doc, doc.length);
    const marks = [...editor.view.contentDOM.querySelectorAll('.rl-list-mark')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['1.', '◦', '▪', '▪']);
  });

  it('hides blank lines between blocks, but not in code or Raw', () => {
    const doc = 'One.\n\nTwo.\n  \n```\na\n\nb\n```\n\nEnd';
    const editor = editorAt(doc, doc.length);
    const lines = () =>
      [...editor.view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.textContent);
    // The fences are hidden away from the caret; the code's blank line is a line of it.
    expect(lines()).toEqual(['One.', 'Two.', '', 'a', '', 'b', '', 'End']);
    editor.setViewMode('raw');
    expect(lines()).toEqual(doc.split('\n'));
  });

  describe('the space between blocks', () => {
    /** The spacing classes of the lines that start with `text`, in order. */
    const spaceOf = (doc: string, text: string) => {
      const editor = editorAt(doc, 0);
      const line = editor.view.state.doc.lineAt(doc.indexOf(text));
      return decorations(editor)
        .filter((d) => d.kind === 'line' && d.from === line.from)
        .flatMap((d) => d.className.split(' '))
        .filter((c) => c.startsWith('rl-space-'));
    };

    it.each([
      ['no blank line', '## Head\nPara.'],
      ['one', '## Head\n\nPara.'],
      ['three', '## Head\n\n\n\nPara.'],
    ])('is the same under a heading with %s between', (_, doc) => {
      expect(spaceOf(doc, 'Para.')).toEqual(['rl-space-heading']);
      expect(spaceOf(doc.replace('##', '#'), 'Para.')).toEqual(['rl-space-h1']);
      expect(spaceOf(doc, '## Head')).toEqual([]);
    });

    it.each([
      ['between paragraphs', 'One.\n\nTwo.', 'Two.', 'rl-space-block'],
      ['above a list after a paragraph', 'Intro:\n- a\n- b', '- a', 'rl-space-block'],
      ['between the items of a tight list', '- a\n- b', '- b', 'rl-space-item'],
      ['between a nested item and its parent', '- a\n  - b', '  - b', 'rl-space-item'],
      ['between a nested item and its parent, loose', '- a\n\n  - b', '  - b', 'rl-space-loose'],
      ['between the items of a loose list', '- a\n\n- b', '- b', 'rl-space-loose'],
      ['between the paragraphs of an item', '- p1\n\n  p2', '  p2', 'rl-space-loose'],
      ['between the paragraphs of a quote', '> One.\n>\n> Two.', '> Two.', 'rl-space-loose'],
      ['under a quote', '> One.\n\nTwo.', 'Two.', 'rl-space-block'],
    ])('is drawn by kind %s', (_, doc, line, spacing) => {
      expect(spaceOf(doc, line)).toEqual([spacing]);
    });

    it('goes below the line above code or a table, whose first line is tinted or a widget', () => {
      const code = 'Para.\n\n```\nx\n```\n\nAfter.';
      expect(spaceOf(code, 'Para.')).toEqual(['rl-space-block-below']);
      expect(spaceOf(code, '```')).toEqual([]);
      expect(spaceOf(code, 'After.')).toEqual(['rl-space-block']);
      const table = 'Para.\n\n| a |\n| - |\n| 1 |';
      expect(spaceOf(table, 'Para.')).toEqual(['rl-space-block-below']);
    });

    it('leaves out lines of markers alone and the ledger', () => {
      const doc =
        'One.\n\n<!--del k3x9 Old.-->\n\nTwo.\n\n<!-- redlines\nversion: 1\nmarks:\n' +
        '  k3x9: {by: bo, at: 2026-10-31T09:30Z}\n-->\n';
      expect(spaceOf(doc, 'Two.')).toEqual(['rl-space-block']);
      expect(spaceOf(doc, '<!--del')).toEqual([]);
      expect(spaceOf(doc, '<!-- redlines')).toEqual([]);
    });
  });

  describe('numbers', () => {
    const numbers = (editor: Editor) =>
      [...editor.view.contentDOM.querySelectorAll('.rl-list-mark')].map((m) => m.textContent);

    it.each([
      ['1. a\n1. b\n5. c\n\nEnd', ['1.', '2.', '3.']],
      ['3. a\n7. b\n\nEnd', ['3.', '4.']],
      ['1) a\n1) b\n\nEnd', ['1)', '2)']],
      ['2. a\n   1. x\n   1. y\n9. b\n\nEnd', ['2.', '1.', '2.', '3.']],
    ])('draws %j as Markdown counts it', (doc, drawn) => {
      expect(numbers(editorAt(doc, doc.length))).toEqual(drawn);
    });

    it('shows the source number with the caret on the marker', () => {
      const doc = '3. a\n7. b\n\nEnd';
      const editor = editorAt(doc, doc.indexOf('7.') + 1);
      expect(numbers(editor)).toEqual(['3.']);
      expect(classed(editor, 'rl-syntax')).toContainEqual([
        doc.indexOf('7.'),
        doc.indexOf('7.') + 2,
      ]);
    });
  });

  it('shows a bullet as source when the caret is on its marker', () => {
    const editor = editorAt('- one\n- two', 0);
    expect(replaced(editor)).toEqual([[6, 8]]);
    expect(classed(editor, 'rl-syntax')).toEqual([[0, 1]]);
  });

  it('hides blockquote marks and code fences off their lines', () => {
    const doc = '> Quoted\n\n```js\nlet x;\n```\n\nEnd';
    const editor = editorAt(doc, doc.length);
    expect(classed(editor, 'rl-quote')).toEqual([[0, 0]]);
    expect(classed(editor, 'rl-codeblock')).toEqual([
      [10, 10],
      [16, 16],
      [23, 23],
    ]);
    expect(replaced(editor)).toEqual([
      [0, 2],
      [10, 15],
      [23, 26],
    ]);
  });

  it('hides setext underlines, escapes and rules off their lines', () => {
    const doc = 'Title\n===\n\nA \\* star\n\n---\n\nEnd';
    const editor = editorAt(doc, doc.length);
    expect(classed(editor, 'rl-h1')).toEqual([[0, 0]]);
    expect(classed(editor, 'rl-hr')).toEqual([[22, 22]]);
    expect(replaced(editor)).toEqual([
      [5, 9],
      [13, 14],
      [22, 25],
    ]);
  });

  it('keeps the indentation of a code block inside a list item', () => {
    const doc = [
      '- Item with code:',
      '',
      '  ```py',
      '  def f(x):',
      '      if x:',
      '          return 1',
      '      return 0',
      '  ```',
      '',
      'End',
    ].join('\n');
    const editor = editorAt(doc, doc.length);
    const code = classed(editor, 'rl-codeblock').map(([from]) => from);
    const hanging = new Set(classed(editor, 'rl-hang').map(([from]) => from));
    expect(code).toHaveLength(6);
    // A hang's negative indent would cancel each line's own indentation.
    expect(code.filter((from) => hanging.has(from))).toEqual([]);
    expect(hanging.has(0)).toBe(true);
  });

  it('shows front matter as a dimmed block, not a rule and a heading', () => {
    const doc = '---\ntitle: Plan\ntags: [a, b]\n---\n\n# Heading\n';
    const editor = editorAt(doc, doc.length);
    expect(classed(editor, 'rl-frontmatter')).toEqual([
      [0, 0],
      [4, 4],
      [16, 16],
      [29, 29],
    ]);
    expect(classed(editor, 'rl-h2')).toEqual([]);
    expect(classed(editor, 'rl-hr')).toEqual([]);
    expect(classed(editor, 'rl-h1')).toEqual([[34, 34]]);
    // Its delimiters are hidden away from the caret, like a code block's fences.
    expect(replaced(editor)).toEqual([
      [0, 3],
      [29, 32],
      [34, 36],
    ]);
  });

  it('shows front matter closed by `...` as one block, its list lines not items (#154)', () => {
    const doc = '---\ntags:\n- a\n- b\n...\n\n- item\n';
    const editor = editorAt(doc, doc.length);
    expect(classed(editor, 'rl-frontmatter').map(([from]) => from)).toEqual([0, 4, 10, 14, 18]);
    expect(classed(editor, 'rl-frontmatter-last')).toEqual([[18, 18]]);
    // Only the body's item is a list item.
    expect(classed(editor, 'rl-li')).toEqual([[23, 23]]);
    expect(replaced(editor)).toContainEqual([18, 21]);
  });

  it('reads a `---` rule later in the file as a rule, not front matter', () => {
    const doc = 'Intro\n\n---\ntitle: x\n---\n\nEnd';
    const editor = editorAt(doc, doc.length);
    expect(classed(editor, 'rl-frontmatter')).toEqual([]);
    expect(classed(editor, 'rl-hr')).toEqual([[7, 7]]);
  });

  describe('tables', () => {
    it('draws no widget for a table: its source is laid out as one (table/layout.ts)', () => {
      const editor = editorAt(
        'Intro\n\n| Name | Score |\n| --- | ---: |\n| Ada | **12** |\n\nEnd',
        0,
      );
      expect(decorations(editor).filter((d) => d.block)).toEqual([]);
      expect(editor.view.contentDOM.querySelector('table')).toBeNull();
      expect(editor.view.contentDOM.querySelectorAll('.rl-trow')).toHaveLength(2);
    });
  });

  describe('syntax being typed in an empty paragraph', () => {
    it('draws a lone # or - as body text until the space completes it', () => {
      for (const [lone, whole, className] of [
        ['#', '# ', 'rl-h1'],
        ['######', '###### ', 'rl-h6'],
        ['-', '- ', 'rl-li'],
        ['*', '* ', 'rl-li'],
        ['1.', '1. ', 'rl-li'],
        ['2)', '2) ', 'rl-li'],
      ] as const) {
        const before = `One.\n\n${lone}\n\nNext.`;
        const typing = editorAt(before, 6 + lone.length);
        expect(classed(typing, className), lone).toEqual([]);
        // Nothing hides it or draws it as a bullet: it is text.
        expect(replaced(typing), lone).toEqual([]);
        // The space makes the block: an empty heading or item.
        const after = `One.\n\n${whole}\n\nNext.`;
        const done = editorAt(after, 6 + whole.length);
        expect(classed(done, className), whole).toEqual([[6, 6]]);
      }
    });

    it('draws a lone mark as body away from the caret too, and the one with text as a block', () => {
      const away = editorAt('#\n\nNext.', 8);
      expect(classed(away, 'rl-h1')).toEqual([]);
      const text = editorAt('#hashtag\n\nNext.', 8);
      expect(classed(text, 'rl-h1')).toEqual([]);
      const heading = editorAt('# One\n\nNext.', 8);
      expect(classed(heading, 'rl-h1')).toEqual([[0, 0]]);
      const item = editorAt('- a\n\nNext.', 8);
      expect(classed(item, 'rl-li')).toEqual([[0, 0]]);
    });
  });

  it('renders every line of a CRLF or mixed-ending file', () => {
    const editor = editorAt('# Title\r\n\r\nIntro\n\n## Part\r\n\r\n- a\n', 0);
    expect(editor.view.state.doc.lines).toBe(8);
    expect(classed(editor, 'rl-h2')).toEqual([[16, 16]]);
    expect(classed(editor, 'rl-li')).toEqual([[25, 25]]);
  });
});
