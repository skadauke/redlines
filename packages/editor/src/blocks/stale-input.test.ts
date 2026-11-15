// @vitest-environment happy-dom
// Typed text right after a key that redraws a list item goes where the editor's caret is, though
// the DOM's selection is still where WebKit left it (#508). A real keyboard types faster than
// WebKit writes the selection into the redrawn lines; here the DOM's selection is put where the
// stale one would be, and the text arrives as WebKit delivers it: a `beforeinput` of `insertText`,
// then, if nothing cancelled it, the browser's own insertion at the DOM's selection.
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { forceParsing } from '@codemirror/language';

// happy-dom's input events have no target ranges, which the spelling code reads.
Object.defineProperty(InputEvent.prototype, 'getTargetRanges', {
  value: () => [],
  configurable: true,
});

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: Editor[] = [];

function mount(doc: string, caret: number, tracking: boolean): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, tracking });
  editor.view.dispatch({ selection: { anchor: caret } });
  mounted.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function press(editor: Editor, key: string): void {
  const { view } = editor;
  forceParsing(view, view.state.doc.length, 5000);
  const shift = key.startsWith('Shift-');
  const event = new KeyboardEvent('keydown', {
    key: shift ? key.slice(6) : key,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  if (!event.defaultPrevented) runScopeHandlers(view, event, 'editor');
}

/** WebKit's selection, put at a document position (as the stale one would be). */
function domCaretAt(editor: Editor, pos: number): void {
  const { node, offset } = editor.view.domAtPos(pos);
  getSelection()?.collapse(node, offset);
}

/** What WebKit does for a typed character: the event, then the insertion at the DOM selection. */
async function typeChar(editor: Editor, data: string): Promise<void> {
  const { view } = editor;
  const event = new InputEvent('beforeinput', {
    inputType: 'insertText',
    data,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  if (event.defaultPrevented) return;
  const sel = getSelection();
  const node = sel?.anchorNode;
  if (node?.nodeType === 3) (node as Text).insertData(sel!.anchorOffset, data);
  else if (node) node.appendChild(document.createTextNode(data));
  await Promise.resolve();
  (view as unknown as { observer: { forceFlush(): void } }).observer.forceFlush();
}

const rows: { name: string; doc: string; at: string; key: string; typed: string; keys?: number }[] =
  [
    { name: 'Tab', doc: '- one\n- two\n\nNext block.\n', at: 'two', key: 'Tab', typed: 'xyz' },
    {
      name: 'Tab in a numbered list',
      doc: '1. one\n2. two\n3. three\n\nNext.\n',
      at: 'three',
      key: 'Tab',
      typed: 'xyz',
    },
    {
      name: 'Shift-Tab',
      doc: '- one\n  - two\n\nNext block.\n',
      at: 'two',
      key: 'Shift-Tab',
      typed: 'xyz',
    },
    { name: 'Return', doc: '- one\n- two\n\nNext block.\n', at: 'two', key: 'Enter', typed: 'xyz' },
  ];

describe('typing right after a key that redraws a list item', () => {
  for (const tracking of [true, false]) {
    for (const row of rows) {
      it(`${row.name}, Track Changes ${tracking ? 'on' : 'off'}: the text goes after the caret`, async () => {
        const start = row.doc.indexOf(row.at) + row.at.length;
        const editor = mount(row.doc, start, tracking);
        const { view } = editor;
        press(editor, row.key);
        const caret = view.state.selection.main.head;
        const after = view.state.doc.toString();
        // WebKit's selection hasn't followed: it's at the start of the next block.
        domCaretAt(editor, after.indexOf('Next'));
        for (const ch of row.typed) await typeChar(editor, ch);
        const doc = view.state.doc.toString();
        expect(doc).not.toContain(`${row.typed}Next`);
        expect(doc).toContain(row.typed);
        expect(view.state.selection.main.head).toBeGreaterThanOrEqual(caret + row.typed.length);
        const plain = doc.replace(/<!--.*?-->/gs, '');
        if (row.key === 'Enter') expect(plain).toMatch(new RegExp(`- ${row.typed}\\s`));
        else expect(plain).toContain(`${row.at}${row.typed}`);
      });
    }
  }

  it('Return then text in the burst goes in the new item, not the list below', async () => {
    const editor = mount('- one\n- two\n\n1. first\n', 11, true);
    press(editor, 'Enter');
    const { view } = editor;
    domCaretAt(editor, view.state.doc.toString().indexOf('1. first'));
    for (const ch of 'abc') await typeChar(editor, ch);
    const doc = view.state.doc.toString();
    expect(doc).not.toMatch(/abc.*first/);
    expect(doc.indexOf('abc')).toBeLessThan(doc.indexOf('first'));
    expect(doc).toContain('abc');
  });

  it('after an agent edit, the text goes after the caret', async () => {
    const editor = mount('One paragraph.\n\nNext block.\n', 14, true);
    editor.applyAgentEdit('One paragraph.\n\nA new one.\n\nNext block.\n', {
      group: 'g',
      agent: 'Claude',
    });
    const { view } = editor;
    const caret = view.state.selection.main.head;
    domCaretAt(editor, view.state.doc.toString().indexOf('Next'));
    await typeChar(editor, 'q');
    const doc = view.state.doc.toString();
    expect(doc).not.toContain('qNext');
    expect(doc.replace(/<!--.*?-->/gs, '')).toContain('One paragraph.q');
    expect(view.state.selection.main.head).toBeGreaterThanOrEqual(caret);
  });

  it('a key after the stale DOM selection was taken into the editor puts the caret back', () => {
    const editor = mount('- one\n- two\n\nNext block.\n', 11, true);
    const { view } = editor;
    press(editor, 'Tab');
    const caret = view.state.selection.main.head;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('Next') } });
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    expect(view.state.selection.main.head).toBe(caret);
  });

  it('does not act when the DOM selection is where the caret is', () => {
    const editor = mount('- one\n- two\n\nNext block.\n', 11, false);
    press(editor, 'Tab');
    const { view } = editor;
    domCaretAt(editor, view.state.selection.main.head);
    const event = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'x',
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves a composition, a replacement and a later press alone', () => {
    const editor = mount('- one\n- two\n\nNext block.\n', 11, false);
    const { view } = editor;
    const at = (inputType: string, extra: InputEventInit = {}) => {
      const event = new InputEvent('beforeinput', {
        inputType,
        data: 'é',
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      view.contentDOM.dispatchEvent(event);
      return event.defaultPrevented;
    };
    press(editor, 'Tab');
    domCaretAt(editor, view.state.doc.toString().indexOf('Next'));
    expect(at('insertCompositionText')).toBe(false);
    expect(at('insertReplacementText')).toBe(false);
    expect(at('insertText', { isComposing: true })).toBe(false);
    // A composition starting ends the moment: the dead key's text is the input method's.
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(at('insertText')).toBe(false);
  });

  it('a click that moves the caret before typing moves it on its own, not stale', () => {
    const editor = mount('- one\n- two\n\nNext block.\n', 11, false);
    const { view } = editor;
    press(editor, 'Tab');
    view.contentDOM.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    domCaretAt(editor, view.state.doc.toString().indexOf('Next'));
    const event = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'x',
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
