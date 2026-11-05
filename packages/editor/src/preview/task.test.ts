// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { checkBoxEffect, createEditor, type Editor } from '../index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function editorAt(doc: string, cursor: number, mode?: 'raw'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  if (mode) editor.setViewMode(mode);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

const boxes = (editor: Editor) => [...editor.view.dom.querySelectorAll('.rl-box')];
const entities = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('.rl-entity')].map((e) => e.textContent);

describe('task boxes', () => {
  const doc = '- [ ] Buy milk\n- [x] Call Ada\n\nEnd.\n';

  it('draws a checked and an unchecked box', () => {
    const editor = editorAt(doc, doc.length - 2);
    const [open_, done] = boxes(editor);
    expect(boxes(editor)).toHaveLength(2);
    expect(open_?.getAttribute('aria-checked')).toBe('false');
    expect(open_?.textContent).toBe('');
    expect(done?.getAttribute('aria-checked')).toBe('true');
    expect(done?.textContent).toBe('✓');
    expect(editor.view.dom.textContent).not.toContain('[x]');
  });

  it('shows the source while the caret is on the item, and in Raw', () => {
    const on = editorAt(doc, 3);
    expect(boxes(on)).toHaveLength(1);
    expect(on.view.dom.textContent).toContain('[ ]');
    const raw = editorAt(doc, doc.length - 2, 'raw');
    expect(boxes(raw)).toHaveLength(0);
  });

  it('is source inside a pending change', () => {
    const text = '- <!--fmt a1b2 +ins-->[ ] New<!--/a1b2-->\n\nEnd.\n';
    const editor = editorAt(text, text.length - 2);
    expect(boxes(editor)).toHaveLength(0);
  });

  it('asks for the new state on a click and leaves the caret and text alone', () => {
    const editor = editorAt(doc, doc.length - 2);
    const requests: unknown[] = [];
    editor.addExtension(
      EditorView.updateListener.of(({ transactions }) => {
        for (const tr of transactions)
          for (const e of tr.effects) if (e.is(checkBoxEffect)) requests.push(e.value);
      }),
    );
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    boxes(editor)[0]?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(requests).toEqual([{ pos: 0, checked: true }]);
    expect(editor.getDoc()).toBe(doc);
    expect(editor.view.state.selection.main.head).toBe(doc.length - 2);
  });
});

describe('entities', () => {
  const doc = 'Fish &amp; chips &mdash; &#169; &#x2014; &foo;\n';

  it('shows &amp; and &mdash; as their characters, and the source when the caret is on them', () => {
    const away = editorAt(doc, doc.length - 1);
    expect(entities(away)).toEqual(['&', '—', '©', '—']);
    const on = editorAt(doc, 7);
    expect(entities(on)).toEqual(['—', '©', '—']);
    expect(on.view.dom.textContent).toContain('&amp;');
  });

  it('leaves an unknown name as source', () => {
    const editor = editorAt(doc, 0);
    expect(editor.view.dom.textContent).toContain('&foo;');
  });

  it('leaves entities in code alone', () => {
    const text = 'Inline `&amp;` here.\n\n```\n&mdash;\n```\n\n    &copy;\n\nEnd.\n';
    const editor = editorAt(text, text.length - 2);
    expect(entities(editor)).toEqual([]);
    expect(editor.view.dom.textContent).toContain('&amp;');
    expect(editor.view.dom.textContent).toContain('&mdash;');
    expect(editor.view.dom.textContent).toContain('&copy;');
  });
});
