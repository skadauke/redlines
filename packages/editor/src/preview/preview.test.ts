// @vitest-environment happy-dom
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
  });

  it('keeps CRLF', () => {
    const editor = createEditor(document.createElement('div'), { doc: 'a\r\nb\r\n', author });
    open.push(editor);
    expect(editor.getDoc()).toBe('a\r\nb\r\n');
    expect(editor.view.state.doc.lines).toBe(3);

    editor.view.dispatch({ changes: { from: 1, insert: editor.view.state.lineBreak + 'x' } });
    expect(editor.getDoc()).toBe('a\r\nx\r\nb\r\n');
  });

  it("gives pasted text the document's line breaks", () => {
    const editor = editorAt('a\r\nb', 0);
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'x\ny\n');
    editor.view.contentDOM.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    );
    expect(editor.getDoc()).toBe('x\r\ny\r\na\r\nb');
  });
});
