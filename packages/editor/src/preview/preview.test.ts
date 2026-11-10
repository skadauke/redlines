// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
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

  it('hides the heading prefix off its line', () => {
    const doc = '# Title\n\nText';
    expect(replaced(editorAt(doc, doc.length))).toEqual([[0, 2]]);

    const onLine = editorAt(doc, 4);
    expect(replaced(onLine)).toEqual([]);
    expect(classed(onLine, 'rl-syntax')).toEqual([[0, 1]]);
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

  it('marks blank lines between blocks as gaps, but not in code or Raw', () => {
    const doc = 'One.\n\nTwo.\n  \n```\na\n\nb\n```\n\nEnd';
    const editor = editorAt(doc, doc.length);
    const gaps = classed(editor, 'rl-gap').map(
      ([from]) => editor.view.state.doc.lineAt(from!).number,
    );
    expect(gaps).toEqual([2, 4, 10]);
    editor.setViewMode('raw');
    expect(classed(editor, 'rl-gap')).toEqual([]);
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

  describe('tables', () => {
    const doc = 'Intro\n\n| Name | Score |\n| --- | ---: |\n| Ada | **12** |\n\nEnd';
    const table = { from: 7, to: doc.indexOf('\n\nEnd') };

    it('renders a table as a widget away from the caret', () => {
      const editor = editorAt(doc, 0);
      const widgets = decorations(editor).filter((d) => d.block);
      expect(widgets.map((d) => [d.from, d.to])).toEqual([[table.from, table.to]]);

      const rendered = editor.view.contentDOM.querySelector('table');
      expect([...rendered!.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
        'Name',
        'Score',
      ]);
      expect(rendered!.querySelector('td .rl-strong')?.textContent).toBe('12');
      expect(rendered!.querySelectorAll('td')[1]!.style.textAlign).toBe('right');
    });

    it('shows the source, pipes in the syntax color, with the caret inside', () => {
      const editor = editorAt(doc, table.from + 3);
      expect(decorations(editor).filter((d) => d.block)).toEqual([]);
      expect(editor.view.contentDOM.querySelector('table')).toBeNull();
      expect(classed(editor, 'rl-syntax')).toContainEqual([table.from, table.from + 1]);
      expect(classed(editor, 'rl-syntax')).toContainEqual([
        doc.indexOf('| ---'),
        doc.indexOf('\n| Ada'),
      ]);
    });

    it('puts the caret in the table when it is clicked', () => {
      const editor = editorAt(doc, 0);
      const cell = editor.view.contentDOM.querySelectorAll('td')[0]!;
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      expect(editor.view.state.selection.main.head).toBe(doc.indexOf('Ada') + 3);
      expect(editor.view.contentDOM.querySelector('table')).toBeNull();
    });

    it('ignores other buttons and modified clicks', () => {
      const editor = editorAt(doc, 0);
      const cell = editor.view.contentDOM.querySelectorAll('td')[0]!;
      for (const init of [
        { button: 2 },
        { shiftKey: true },
        { metaKey: true },
        { ctrlKey: true },
      ]) {
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...init });
        cell.dispatchEvent(event);
        // The browser's own handling would move the caret to the table's edge.
        expect(event.defaultPrevented).toBe(true);
      }
      expect(editor.view.state.selection.main.head).toBe(0);
      expect(editor.view.contentDOM.querySelector('table')).not.toBeNull();
    });

    describe('from the keyboard', () => {
      const keyDoc = 'Intro line\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nEnd line';
      const keyTable = { from: 12, to: 41 };
      const press = (editor: Editor, key: string) =>
        runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key }), 'editor');

      it.each([
        ['ArrowDown', 11, keyTable.from],
        ['ArrowRight', 11, keyTable.from],
        ['ArrowUp', 42, keyTable.to],
        ['ArrowLeft', 42, keyTable.to],
      ])('%s from next to the table enters it', (key, from, to) => {
        const editor = editorAt(keyDoc, from);
        expect(editor.view.contentDOM.querySelector('table')).not.toBeNull();
        expect(press(editor, key)).toBe(true);
        expect(editor.view.state.selection.main.head).toBe(to);
        expect(editor.view.contentDOM.querySelector('table')).toBeNull();
      });

      it('leaves other movement to the editor', () => {
        const head = (editor: Editor) => editor.view.state.selection.main.head;
        const editor = editorAt(keyDoc, 5);
        press(editor, 'ArrowRight');
        expect(head(editor)).toBe(6);
        press(editor, 'ArrowDown');
        expect(head(editor)).not.toBe(keyTable.from);
        editor.view.dispatch({ selection: { anchor: 46 } });
        press(editor, 'ArrowLeft');
        expect(head(editor)).toBe(45);
        press(editor, 'ArrowUp');
        expect(head(editor)).not.toBe(keyTable.to);
      });
    });
  });

  it('renders every line of a CRLF or mixed-ending file', () => {
    const editor = editorAt('# Title\r\n\r\nIntro\n\n## Part\r\n\r\n- a\n', 0);
    expect(editor.view.state.doc.lines).toBe(8);
    expect(classed(editor, 'rl-h2')).toEqual([[16, 16]]);
    expect(classed(editor, 'rl-li')).toEqual([[25, 25]]);
  });
});
