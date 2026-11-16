// @vitest-environment happy-dom
// Very long lines are shortened on screen, and nothing in the file changes (#694).
import { forceParsing } from '@codemirror/language';
import { deleteCharBackward, deleteCharForward } from '@codemirror/commands';
import { runScopeHandlers, type EditorView, type WidgetType } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from './index.ts';
import { chipRanges, chipsOfLine, LONG_LINE, SHOWN, sizeLabel } from './long-lines.ts';
import { previewDecorations } from './preview/decorations.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** Presses a key through the editor's keymaps, as a keyboard does. */
const press = (view: EditorView, key: string) =>
  runScopeHandlers(
    view,
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    'editor',
  );

const b64 = (chars: number) => 'iVBORw0KGgo'.padEnd(chars, 'A') + '=';
const png = (chars: number) => `data:image/png;base64,${b64(chars)}`;

function editorWith(doc: string, view: 'redlines' | 'clean' | 'raw' = 'redlines'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, view });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  open.push(editor);
  return editor;
}

describe('the chips of a line', () => {
  it('leaves a line that is not long alone, a data URI in it too', () => {
    expect(chipsOfLine('a short line', 0)).toEqual([]);
    expect(chipsOfLine(`\`${png(LONG_LINE - 100)}\``, 0)).toEqual([]);
  });

  it('names a data URI by its type and size, and keeps the text around it', () => {
    const line = `> - Shot: \`${png(1_500_000)}\` and after`;
    const chips = chipsOfLine(line, 100);
    expect(chips).toHaveLength(1);
    expect(chips[0]!.label).toBe('PNG image, 1.1 MB, embedded');
    expect(
      line.slice(chips[0]!.from - 100, chips[0]!.to - 100).startsWith('data:image/png;base64,'),
    ).toBe(true);
    // The backtick after it and the words stay text.
    expect(line.slice(chips[0]!.to - 100)).toBe('` and after');
  });

  it('holds the rest of a long line of text in one chip, after the first characters', () => {
    const line = 'word '.repeat(60_000);
    const chips = chipsOfLine(line, 0);
    expect(chips).toEqual([{ from: SHOWN, to: line.length, label: '… 298 KB more' }]);
  });

  it('counts the text before a data URI against what a line shows', () => {
    const line = `${'x'.repeat(SHOWN + 500)}${png(50_000)}`;
    const chips = chipsOfLine(line, 0);
    expect(chips).toHaveLength(1);
    expect(chips[0]!.from).toBe(SHOWN);
    expect(chips[0]!.label).toMatch(/more$/);
  });

  it('never cuts between the halves of a surrogate pair', () => {
    const line = '😀'.repeat(8_000);
    const [chip] = chipsOfLine(line, 0);
    expect(chip!.from % 2).toBe(0);
  });

  it('writes sizes as people read them', () => {
    expect([812, 34_000, 1_541_728].map(sizeLabel)).toEqual(['812 B', '34 KB', '1.5 MB']);
  });
});

describe('a document with very long lines', () => {
  const doc = `# Title\n\nBefore\n\n> - \`${png(400_000)}\`\n\nAfter\n`;

  it('draws a chip in place of the data, in every view, and the file is as it was', () => {
    for (const view of ['redlines', 'clean', 'raw'] as const) {
      const editor = editorWith(doc, view);
      expect(chipRanges(editor.view.state)).toHaveLength(1);
      expect(editor.getDoc()).toBe(doc);
      expect(editor.view.contentDOM.querySelector('.rl-chip')?.textContent).toBe(
        'PNG image, 300 KB, embedded',
      );
      // The page holds the chip, not the 400,000 characters under it.
      expect(editor.view.contentDOM.textContent.length).toBeLessThan(2_000);
    }
  });

  it('is one object for the caret: a step over it, and a deletion that takes all of it', () => {
    const editor = editorWith(doc, 'raw');
    const [{ from, to }] = chipRanges(editor.view.state) as [{ from: number; to: number }];
    editor.view.dispatch({ selection: { anchor: to } });
    expect(deleteCharBackward(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe(doc.slice(0, from) + doc.slice(to));
    const again = editorWith(doc, 'raw');
    again.view.dispatch({ selection: { anchor: from } });
    expect(deleteCharForward(again.view)).toBe(true);
    expect(again.getDoc()).toBe(doc.slice(0, from) + doc.slice(to));
  });

  it('copies all of it: a selection over the chip is read from the document', () => {
    const editor = editorWith(doc, 'raw');
    const [{ from, to }] = chipRanges(editor.view.state) as [{ from: number; to: number }];
    editor.view.dispatch({ selection: { anchor: from - 2, head: to + 1 } });
    const { state } = editor.view;
    expect(state.sliceDoc(from - 2, to + 1)).toHaveLength(to - from + 3);
    expect(state.sliceDoc(from, to)).toContain('iVBORw0KGgo');
  });

  it('follows an edit: typing in the line moves the chip, and a new long line gets one', () => {
    const editor = editorWith(doc, 'raw');
    const [{ from }] = chipRanges(editor.view.state) as unknown as [{ from: number }];
    editor.view.dispatch({ changes: { from: 0, insert: 'Intro\n\n' } });
    expect(chipRanges(editor.view.state)[0]!.from).toBe(from + 7);
    const end = editor.view.state.doc.length;
    editor.view.dispatch({ changes: { from: end, insert: `\n${'long '.repeat(5_000)}\n` } });
    expect(chipRanges(editor.view.state)).toHaveLength(2);
    // Cutting the long line down takes its chip away.
    const line = editor.view.state.doc.line(editor.view.state.doc.lines - 1);
    editor.view.dispatch({ changes: { from: line.from + 50, to: line.to } });
    expect(chipRanges(editor.view.state)).toHaveLength(1);
  });

  it('writes a tracked deletion over it whole, where a tracked change can go', () => {
    const text = `${'long words '.repeat(3_000)}end`;
    const tracked = `Before\n\n${text}\n\nAfter\n`;
    const editor = editorWith(tracked, 'redlines');
    editor.setTracking(true, { inFile: false });
    const [{ from, to }] = chipRanges(editor.view.state) as [{ from: number; to: number }];
    editor.view.dispatch({ selection: { anchor: from, head: to } });
    expect(press(editor.view, 'Backspace')).toBe(true);
    const written = editor.getDoc();
    expect(written).toMatch(/<!--del [a-z0-9]{4} /);
    // Every character is still in the file, in the deletion: reading the marker away gives it back.
    const body = written.split('\n<!-- redlines')[0]!;
    expect(body.replace(/<!--del [a-z0-9]{4} ?/, '').replace('-->', '')).toBe(tracked);
  });
});

describe('an image of embedded data', () => {
  /** The images the preview draws: their widgets' DOM. */
  function drawn(editor: Editor): HTMLImageElement[] {
    const found: HTMLImageElement[] = [];
    const { state } = editor.view;
    previewDecorations(state).between(0, state.doc.length, (_from, _to, value) => {
      const widget = (value.spec as { widget?: WidgetType }).widget;
      const dom = widget?.toDOM(editor.view);
      const img = dom?.querySelector('img');
      if (img) found.push(img);
    });
    return found;
  }

  it('is drawn as the image, from a Markdown image or an img tag', () => {
    const data = png(2_000);
    const editor = editorWith(`Text\n\n![shot](${data})\n\nMore <img src="${data}" alt="two">\n`);
    editor.view.dispatch({ selection: { anchor: 0 } });
    const images = drawn(editor);
    expect(images.map((img) => img.getAttribute('src'))).toEqual([data, data]);
  });

  it('is not drawn when the data is not an image', () => {
    const editor = editorWith('![x](data:text/html;base64,PGI+aGk8L2I+)\n');
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(drawn(editor)).toEqual([]);
  });
});
