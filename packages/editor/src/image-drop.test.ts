// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor, type EditorOptions } from './index.ts';
import { blockGaps, PROJECT_IMAGE_TYPE } from './image-drop.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, options: Partial<EditorOptions> = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const asked: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author: ada,
    tracking: false,
    projectImageLink: (path) => {
      asked.push(path);
      return `img/${path.split('/').at(-1)}`;
    },
    ...options,
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 1000);
  // No layout in happy-dom: a line is 20 px high, a block's top and bottom follow its lines.
  vi.spyOn(editor.view, 'lineBlockAt').mockImplementation((pos) => {
    const line = editor.view.state.doc.lineAt(pos).number - 1;
    return { top: line * 20, bottom: line * 20 + 18 } as ReturnType<typeof editor.view.lineBlockAt>;
  });
  return { editor, asked };
}

function drag(editor: Editor, type: string, y: number, path = '/p/shot.png') {
  const data = new DataTransfer();
  data.setData(PROJECT_IMAGE_TYPE, path);
  const event = new MouseEvent(type, { clientX: 10, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: data });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

describe('the gaps between blocks', () => {
  const gaps = (doc: string) => {
    const { editor } = load(doc);
    return blockGaps(editor.view.state).map((gap) => [gap.pos, gap.before, gap.after]);
  };

  it('are before every block, and after the last, set apart by blank lines', () => {
    expect(gaps('One\n\nTwo\n\nThree\n')).toEqual([
      [0, '', '\n\n'],
      [5, '', '\n\n'],
      [10, '', '\n\n'],
      [15, '\n\n', ''],
    ]);
  });

  it('are not above front matter, and not after the ledger, which no one reads', () => {
    expect(gaps('---\ntitle: A\n---\n\nOne\n')).toEqual([
      [18, '', '\n\n'],
      [21, '\n\n', ''],
    ]);
    const ledger = '<!-- redlines\nversion: 1\n-->\n';
    const text = `One\n\n${ledger}`;
    expect(gaps(text)).toEqual([
      [0, '', '\n\n'],
      [5, '', '\n\n'],
    ]);
  });

  it('are one place in an empty document', () => {
    expect(gaps('')).toEqual([[0, '', '']]);
  });
});

describe('an image file dragged from the sidebar', () => {
  it('shows a line at the gap nearest the pointer, and takes it away when it leaves', () => {
    const { editor } = load('One\n\nTwo\n\nThree\n');
    // Between One (line 0, to y 18) and Two (line 2, from y 40): y 29.
    const over = drag(editor, 'dragover', 30);
    expect(over.defaultPrevented).toBe(true);
    expect(editor.view.dom.querySelectorAll('.rl-drop-line')).toHaveLength(1);
    drag(editor, 'dragover', 31);
    expect(editor.view.dom.querySelectorAll('.rl-drop-line')).toHaveLength(1);
    drag(editor, 'drop', 31);
    expect(editor.view.dom.querySelector('.rl-drop-line')).toBeNull();
  });

  it('lands as a block of its own between the blocks nearest the pointer, linked by its path', () => {
    const { editor, asked } = load('One\n\nTwo\n\nThree\n');
    drag(editor, 'drop', 30);
    expect(asked).toEqual(['/p/shot.png']);
    expect(editor.view.state.doc.toString()).toBe('One\n\n![](img/shot.png)\n\nTwo\n\nThree\n');
  });

  it('lands after the last block when the pointer is below it, and above the first when above', () => {
    const below = load('One\n\nTwo\n');
    drag(below.editor, 'drop', 900);
    expect(below.editor.view.state.doc.toString()).toBe('One\n\nTwo\n\n![](img/shot.png)\n');
    const above = load('One\n\nTwo\n');
    drag(above.editor, 'drop', -50);
    expect(above.editor.view.state.doc.toString()).toBe('![](img/shot.png)\n\nOne\n\nTwo\n');
  });

  it('is one tracked insertion while Track Changes is on, which a reader sees as the image', () => {
    const { editor } = load('One\n\nTwo\n', { tracking: true });
    drag(editor, 'drop', 30);
    const text = editor.getDoc();
    expect(text).toContain('![](img/shot.png)');
    expect(text.match(/<!--ins /g)).toHaveLength(1);
    // As a reader sees it: the image is a paragraph of its own between One and Two.
    expect(newestView(text).text.trim()).toBe('One\n\n![](img/shot.png)\n\nTwo');
  });

  it('writes nothing when the host has no link for it, and leaves other drags alone', () => {
    const { editor } = load('One\n\nTwo\n', { projectImageLink: () => null });
    drag(editor, 'drop', 30);
    expect(editor.view.state.doc.toString()).toBe('One\n\nTwo\n');
    const plain = new MouseEvent('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(plain, 'dataTransfer', { value: new DataTransfer() });
    editor.view.contentDOM.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
  });
});
