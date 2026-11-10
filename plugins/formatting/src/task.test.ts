// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { checkBoxEffect, createEditor, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: { editor: Editor; remove: () => void }[] = [];

afterEach(() => {
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

function mount(doc: string, tracking: boolean, notices: string[] = []): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, tracking });
  const remove = createFormatting(editor, { author, notice: (m) => notices.push(m) });
  mounted.push({ editor, remove });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
  return editor;
}

function click(editor: Editor, index: number): void {
  const box = editor.view.dom.querySelectorAll('.rl-box')[index];
  box?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
}

const DOC = '- [ ] Buy milk\n- [x] Call Ada\n\nEnd.\n';

describe('task boxes', () => {
  it('clicking writes +check with tracking on and edits the bracket with it off', () => {
    const on = mount(DOC, true);
    click(on, 0);
    expect(on.getDoc()).toMatch(/^- \[x\] Buy milk<!--fmt \w+ \+check-->\n- \[x\] Call Ada\n/);

    const off = mount(DOC, false);
    click(off, 0);
    expect(off.getDoc()).toBe('- [x] Buy milk\n- [x] Call Ada\n\nEnd.\n');
    click(off, 1);
    expect(off.getDoc()).toBe('- [x] Buy milk\n- [ ] Call Ada\n\nEnd.\n');
  });

  it('rejecting +check restores the bytes', () => {
    const editor = mount(DOC, true);
    click(editor, 0);
    const id = /<!--fmt (\w+) \+check-->/.exec(editor.getDoc())?.[1];
    expect(id).toBeTruthy();
    editor.reject(id ?? '');
    expect(editor.getDoc()).toBe(DOC);
  });

  it('does nothing without the plugin', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: DOC, author, tracking: false });
    forceParsing(editor.view, DOC.length, 5000);
    editor.view.dispatch({ selection: { anchor: DOC.length } });
    mounted.push({ editor, remove: () => {} });
    click(editor, 0);
    expect(editor.getDoc()).toBe(DOC);
  });
});

const LEDGER = (ids: Record<string, string>) =>
  `\n<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada Lovelace}\n  bob: {name: Bob}\nmarks:\n${Object.entries(
    ids,
  )
    .map(([id, by]) => `  ${id}: {by: ${by}, at: 2026-11-05T22:00Z}\n`)
    .join('')}-->\n`;

describe('task boxes that cannot change', () => {
  const bobsCheck = `- [x] item<!--fmt bbk2 +check-->\n\nEnd.\n${LEDGER({ bbk2: 'bob' })}`;

  it.each([true, false])("refuses another person's pending box change (tracking %s)", (on) => {
    const notices: string[] = [];
    const editor = mount(bobsCheck, on, notices);
    click(editor, 0);
    expect(notices).toEqual(["Accept or reject Bob's change to this box first."]);
    expect(editor.getDoc()).toBe(bobsCheck);
  });

  it("allows a click when another person's insertion is in another item", () => {
    const doc = `- [ ] item\n- other <!--ins bbk2-->added<!--/bbk2-->\n\nEnd.\n${LEDGER({ bbk2: 'bob' })}`;
    const notices: string[] = [];
    const editor = mount(doc, true, notices);
    click(editor, 0);
    expect(notices).toEqual([]);
    expect(editor.getDoc()).toMatch(/^- \[x\] item<!--fmt \w+ \+check-->\n- other <!--ins bbk2-->/);
  });

  it("says why when another person's insertion is in the item's own paragraph", () => {
    const doc = `- [ ] item <!--ins bbk2-->added<!--/bbk2-->\n\nEnd.\n${LEDGER({ bbk2: 'bob' })}`;
    const notices: string[] = [];
    const editor = mount(doc, true, notices);
    click(editor, 0);
    expect(notices).toEqual(['Accept or reject the changes in this paragraph first.']);
    expect(editor.getDoc()).toBe(doc);
  });

  it('says a pending change is in the way when one follows the bracket', () => {
    const doc = `- [ ] <!--fmt bbk2 +bold-->item<!--/bbk2-->\n\nEnd.\n${LEDGER({ bbk2: 'bob' })}`;
    const notices: string[] = [];
    const editor = mount(doc, true, notices);
    click(editor, 0);
    expect(notices).toEqual(['Accept or reject the changes in this paragraph first.']);
    expect(editor.getDoc()).toBe(doc);
  });

  it('ignores a request for a position that is not a task box', () => {
    const doc = 'plain para\n\n- [ ] x\n\nEnd.\n';
    const notices: string[] = [];
    const editor = mount(doc, true, notices);
    for (const pos of [0, 3, 9999, -1, 1.5, Number.NaN]) {
      expect(() =>
        editor.view.dispatch({ effects: checkBoxEffect.of({ pos, checked: true }) }),
      ).not.toThrow();
    }
    expect(editor.getDoc()).toBe(doc);
    expect(notices).toEqual([]);
  });
});

describe('task boxes, more cases', () => {
  it('clicking twice with tracking on gives back the original bytes', () => {
    const editor = mount(DOC, true);
    click(editor, 0);
    click(editor, 0);
    expect(editor.getDoc()).toBe(DOC);
  });

  it('unchecks an uppercase [X] and checks in a nested item and a CRLF file', () => {
    const upper = mount('- [X] up\n\nEnd.\n', false);
    click(upper, 0);
    expect(upper.getDoc()).toBe('- [ ] up\n\nEnd.\n');
    const nested = mount('- a\n  - [ ] deep\n- b\n\nEnd.\n', false);
    click(nested, 0);
    expect(nested.getDoc()).toBe('- a\n  - [x] deep\n- b\n\nEnd.\n');
    const crlf = mount('- [ ] one\r\n- [x] two\r\n\r\nEnd.\r\n', true);
    click(crlf, 0);
    expect(crlf.getDoc()).toMatch(/^- \[x\] one<!--fmt \w+ \+check-->\r\n- \[x\] two\r\n/);
  });
});

describe('a box refused for how much is pending', () => {
  it('says so, not that Track Changes is the trouble (#167)', () => {
    const doc = '- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n- [ ] f\n\nEnd.\n';
    const notices: string[] = [];
    const editor = mount(doc, true, notices);
    // Five other pending changes in the list.
    for (const line of [1, 2, 3, 4, 5]) {
      const at = editor.view.state.doc.line(line).to;
      editor.view.dispatch({ selection: { anchor: at } });
      editor.view.dispatch(editor.view.state.replaceSelection(' x'), { userEvent: 'input.type' });
    }
    const before = editor.getDoc();
    click(editor, 5);
    expect(editor.getDoc()).toBe(before);
    expect(notices).toEqual([expect.stringMatching(/^There are too many pending changes/)]);
    expect(notices.join()).not.toMatch(/Turn off Track Changes/);
  });
});
