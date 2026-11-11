// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { checkBoxEffect, createEditor, type Editor, undo } from '@redlines/editor';
import { accept, applyChanges, newestView, originalView, parse, reject } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { editSourceFacet } from '../../../packages/editor/src/tracked/typing.ts';
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

/** Random bytes from a seed (mulberry32), for the ids of new marks. */
function seededBytes(seed: number): (n: number) => Uint8Array {
  let state = seed >>> 0;
  return (n) =>
    Uint8Array.from({ length: n }, () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) & 255;
    });
}

function mount(doc: string, tracking: boolean, notices: string[] = [], seed?: number): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author,
    tracking,
    ...(seed === undefined
      ? {}
      : { extensions: [editSourceFacet.of({ now: () => new Date(), random: seededBytes(seed) })] }),
  });
  const remove = createFormatting(editor, { author, notice: (m) => notices.push(m) });
  mounted.push({ editor, remove });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
  return editor;
}

function click(editor: Editor, index: number): void {
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
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
  /** A list of eight task items, `others` of them with a pending change after the item's text: with
   * `syntax`, one that brings a backtick, which a decision could make code of the lines after it
   * (rule 6); otherwise words, which are apart from a box change. */
  const pending = (others: number, notices: string[], syntax = false) => {
    const doc = `${'abcdefgh'
      .split('')
      .map((c) => `- [ ] ${c}`)
      .join('\n')}\n\nEnd.\n`;
    const editor = mount(doc, true, notices);
    for (let line = 2; line < 2 + others; line++) {
      const { to } = editor.view.state.doc.line(line);
      editor.view.dispatch({ selection: { anchor: to } });
      editor.view.dispatch(editor.view.state.replaceSelection(syntax ? ' x`' : ' x'), {
        userEvent: 'input.type',
      });
    }
    return editor;
  };

  it.each([4, 5])('works with %i other pending changes in the list (rule 5)', (others) => {
    const notices: string[] = [];
    const editor = pending(others, notices, true);
    const before = editor.getDoc();
    click(editor, 0);
    expect(notices).toEqual([]);
    expect(editor.getDoc()).not.toBe(before);
    expect(editor.getDoc()).toContain('+check');
  });

  it('works with seven changes of words, which stay pending (rule 6)', () => {
    const notices: string[] = [];
    const editor = pending(7, notices);
    const before = editor.getDoc();
    click(editor, 0);
    expect(notices).toEqual([]);
    expect(editor.getDoc()).toContain('+check');
    expect(editor.getDoc().match(/<!--ins /g)).toHaveLength(7);
    expect(before.match(/<!--ins /g)).toHaveLength(7);
  });

  it('says so with six that bring a backtick, not that Track Changes is the trouble (#167)', () => {
    const notices: string[] = [];
    const editor = pending(6, notices, true);
    const before = editor.getDoc();
    click(editor, 0);
    expect(editor.getDoc()).toBe(before);
    expect(notices).toEqual([
      expect.stringMatching(/^This box can't be changed while 6 changes in its list are pending/),
    ]);
    expect(notices.join()).not.toMatch(/Turn off Track Changes/);
  });
});

describe('a box clicked while an empty item is open (rule 6)', () => {
  /** A bullet list with a task list under it: Return and Tab at the end of `two` open an item that
   * Markdown can't hold under a line of text, which is not in the file while it is open. */
  const withOpenItem = (tracking: boolean, pending: number, notices: string[]) => {
    const items = 'abcdefgh'
      .slice(0, pending)
      .split('')
      .map((c, i) => `- [ ] ${c} x${i}`);
    const editor = mount(`- one\n- two\n${items.join('\n')}\n\nEnd.\n`, tracking, notices);
    const { view } = editor;
    for (let line = 3; tracking && line < 3 + pending; line++) {
      view.dispatch({ selection: { anchor: view.state.doc.line(line).to } });
      view.dispatch(view.state.replaceSelection(' y'), { userEvent: 'input.type' });
    }
    view.dispatch({ selection: { anchor: view.state.doc.line(2).to } });
    for (const key of ['Enter', 'Tab']) {
      runScopeHandlers(
        view,
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        'editor',
      );
    }
    expect(view.contentDOM.dataset['rlOpenBlock']).toBeDefined();
    return editor;
  };
  const isOpen = (editor: Editor) => editor.view.contentDOM.dataset['rlOpenBlock'] !== undefined;

  it.each([false, true])('checks the box and leaves the item open (tracking %s)', (tracking) => {
    const notices: string[] = [];
    const editor = withOpenItem(tracking, 3, notices);
    click(editor, 1);
    expect(notices).toEqual([]);
    expect(editor.getDoc()).toContain('- [x] b x1');
    expect(editor.getDoc()).not.toMatch(/\n {2}- *\n/);
    expect(isOpen(editor)).toBe(true);
  });

  it('says so, and leaves the item open, where it can’t check the list: eight pending changes', () => {
    const notices: string[] = [];
    const editor = withOpenItem(true, 8, notices);
    const before = editor.getDoc();
    click(editor, 1);
    expect(editor.getDoc()).toBe(before);
    expect(notices).toEqual([
      expect.stringMatching(/^This box can't be changed while \d+ changes/),
    ]);
    expect(isOpen(editor)).toBe(true);
  });
});

describe('an empty task item (#198)', () => {
  it.each([true, false])(
    'says to write the item first when its box is clicked (tracking %s)',
    (on) => {
      for (const doc of [
        '- [ ] one\n- [ ] \n\nEnd.\n',
        '- one\n  - [ ] \n\nEnd.\n',
        '1. [ ] one\n2. [ ] \n\nEnd.\n',
      ]) {
        const notices: string[] = [];
        const editor = mount(doc, on, notices);
        const boxes = editor.view.dom.querySelectorAll('.rl-box');
        expect(boxes.length, doc).toBeGreaterThan(0);
        click(editor, boxes.length - 1);
        expect(notices, doc).toEqual(['Write the item first.']);
        expect(editor.getDoc(), doc).toBe(doc);
      }
    },
  );

  it('draws the box a click on a pending change keeps, and the click on it again takes it back', () => {
    const editor = mount(DOC, true);
    click(editor, 0);
    const wrap = editor.view.dom.querySelector('.rl-task');
    expect(wrap?.querySelector('[aria-checked="true"]')).not.toBeNull();
    expect(editor.view.dom.querySelector('.cm-line')?.classList.contains('rl-bar')).toBe(true);
    click(editor, 0);
    expect(editor.getDoc()).toBe(DOC);
    expect(editor.view.dom.querySelector('.cm-line')?.classList.contains('rl-bar')).toBe(false);
  });
});

describe('Paragraph › Check Item (⇧⌘U)', () => {
  const LIST = '- [ ] one\n- [x] two\n- [ ] three\n- plain\n\nEnd.\n';

  /** The selection from `from` to `to`, found by text. */
  function select(editor: Editor, from: string, to = from): void {
    const doc = editor.getDoc();
    // The item's text, which ends its line or stands in front of a marker: a mark's id holds letters
    // too (a `b` in it ended the selection inside the marker in about one run in five).
    const find = (text: string) => {
      const escaped = text.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
      const at = doc.search(new RegExp(`${escaped}(?=<!--|\n)`));
      return at >= 0 ? at : doc.indexOf(text);
    };
    const anchor = find(from);
    const head = find(to) + to.length;
    editor.view.dispatch({ selection: { anchor, head } });
  }

  /** The key, as CodeMirror's Mod-Shift-u (Ctrl in the test's platform). */
  function press(editor: Editor): void {
    // Parsed to the end first: a busy machine stops the parse of an update early, and Check Item
    // reads the items from the tree.
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', {
        key: 'U',
        code: 'KeyU',
        keyCode: 85,
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
      'editor',
    );
  }

  it('is the Paragraph menu command, with ⇧⌘U', () => {
    const editor = mount(LIST, false);
    const command = editor.commands.list().find(({ id }) => id === 'block.check');
    expect(command).toMatchObject({
      title: 'Check Item',
      menu: 'paragraph',
      shortcut: 'Mod-Shift-u',
    });
  });

  it.each([
    [false, 'one', '- [x] one\n- [x] two'],
    [true, 'one', '- [x] one<!--fmt'],
  ])('checks the item the caret is in (tracking %s)', (on, word, after) => {
    const editor = mount(LIST, on);
    select(editor, word);
    editor.view.dispatch({ selection: { anchor: editor.getDoc().indexOf(word) + 1 } });
    press(editor);
    expect(editor.getDoc().startsWith(after)).toBe(true);
    if (on) expect(editor.getDoc()).toMatch(/^- \[x\] one<!--fmt \w+ \+check-->\n- \[x\] two\n/);
  });

  it('checks several items at once, tracked as a box change on each, in one step to undo', () => {
    const editor = mount(LIST, true);
    select(editor, 'one', 'plain');
    press(editor);
    const doc = editor.getDoc();
    // `two` was checked, `one` and `three` are, and the plain item is no task.
    expect(doc).toMatch(
      /^- \[x\] one<!--fmt \w+ \+check-->\n- \[x\] two\n- \[x\] three<!--fmt \w+ \+check-->\n- plain\n/,
    );
    expect(doc.match(/\+check/g)).toHaveLength(2);
    undo(editor.view);
    expect(editor.getDoc()).toBe(LIST);
  });

  it('writes the boxes plainly with Track Changes off, and unchecks when all are checked', () => {
    const editor = mount(LIST, false);
    select(editor, 'one', 'three');
    press(editor);
    expect(editor.getDoc()).toBe('- [x] one\n- [x] two\n- [x] three\n- plain\n\nEnd.\n');
    press(editor);
    expect(editor.getDoc()).toBe('- [ ] one\n- [ ] two\n- [ ] three\n- plain\n\nEnd.\n');
  });

  it('checks again, tracked, to give back the original bytes', () => {
    const editor = mount(LIST, true);
    select(editor, 'one');
    press(editor);
    press(editor);
    expect(editor.getDoc()).toBe(LIST);
  });

  it('checks a nested item together with its parent', () => {
    const doc = '- [ ] a\n  - [ ] b\n    - [ ] c\n\nEnd.\n';
    const editor = mount(doc, false);
    select(editor, 'a', 'c');
    press(editor);
    expect(editor.getDoc()).toBe('- [x] a\n  - [x] b\n    - [x] c\n\nEnd.\n');
  });

  it('says so where there is no task item, and leaves the text alone', () => {
    const notices: string[] = [];
    const editor = mount(LIST, true, notices);
    select(editor, 'plain');
    press(editor);
    expect(notices).toEqual([expect.stringMatching(/^Check Item works on a task list item/)]);
    expect(editor.getDoc()).toBe(LIST);
  });

  it('says to write the item first on an item with no text', () => {
    const doc = '- [ ] one\n- [ ] \n\nEnd.\n';
    const notices: string[] = [];
    const editor = mount(doc, true, notices);
    editor.view.dispatch({ selection: { anchor: doc.indexOf('\n\n') - 1 } });
    press(editor);
    expect(notices).toEqual(['Write the item first.']);
    expect(editor.getDoc()).toBe(doc);
  });

  it('passes over an empty item among written ones', () => {
    const doc = '- [ ] one\n- [ ] \n- [ ] three\n\nEnd.\n';
    const notices: string[] = [];
    const editor = mount(doc, false, notices);
    select(editor, 'one', 'three');
    press(editor);
    expect(notices).toEqual([]);
    expect(editor.getDoc()).toBe('- [x] one\n- [ ] \n- [x] three\n\nEnd.\n');
  });

  it('works in a list with other pending changes, as a click does (rule 6)', () => {
    const notices: string[] = [];
    const items = 'abcdefgh'.split('').map((c) => `- [ ] ${c}`);
    const editor = mount(`${items.join('\n')}\n\nEnd.\n`, true, notices);
    for (let line = 2; line < 9; line++) {
      const { to } = editor.view.state.doc.line(line);
      editor.view.dispatch({ selection: { anchor: to } });
      editor.view.dispatch(editor.view.state.replaceSelection(' x'), { userEvent: 'input.type' });
    }
    editor.view.dispatch({ selection: { anchor: 5 } });
    press(editor);
    expect(notices).toEqual([]);
    expect(editor.getDoc()).toMatch(/^- \[x\] a<!--fmt \w+ \+check-->\n/);
    expect(editor.getDoc().match(/<!--ins /g)).toHaveLength(7);
  });

  it("refuses with the other person's name where their box change is pending", () => {
    const doc = `- [x] item<!--fmt bbk2 +check-->\n- [ ] more\n\nEnd.\n${LEDGER({ bbk2: 'bob' })}`;
    const notices: string[] = [];
    const editor = mount(doc, true, notices);
    editor.view.dispatch({ selection: { anchor: 3 } });
    press(editor);
    expect(notices).toEqual(["Accept or reject Bob's change to this box first."]);
    expect(editor.getDoc()).toBe(doc);
  });

  it('does nothing in a table cell, as the other Paragraph commands do', () => {
    const doc = '| a | b |\n| - | - |\n| [ ] | 2 |\n\nEnd.\n';
    const notices: string[] = [];
    const editor = mount(doc, false, notices);
    editor.view.dispatch({ selection: { anchor: doc.indexOf('[ ]') + 1 } });
    press(editor);
    expect(editor.getDoc()).toBe(doc);
    const command = editor.commands.list().find(({ id }) => id === 'block.check');
    expect(command?.isEnabled?.(editor.view.state)).toBe(false);
  });

  const TWELVE = `${'abcdefghijkl'
    .split('')
    .map((c) => `- [ ] ${c}`)
    .join('\n')}\n\nEnd.\n`;

  it('checks six items tracked in one step, and takes them back in one', () => {
    const notices: string[] = [];
    const editor = mount(TWELVE, true, notices);
    select(editor, 'a', 'f');
    press(editor);
    expect(notices).toEqual([]);
    expect(editor.getDoc().match(/\+check/g)).toHaveLength(6);
    undo(editor.view);
    expect(editor.getDoc()).toBe(TWELVE);
  });

  it('checks twelve boxes tracked as twelve clicks do, in one step to undo, whatever is decided', () => {
    const notices: string[] = [];
    const editor = mount(TWELVE, true, notices);
    select(editor, 'a', 'l');
    press(editor);
    expect(notices).toEqual([]);
    const written = editor.getDoc();
    expect(written.match(/<!--fmt \w+ \+check-->/g)).toHaveLength(12);
    expect(newestView(written).text).toBe(TWELVE.replaceAll('[ ]', '[x]'));
    expect(originalView(written).text).toBe(TWELVE);
    // Every box decided in a random order, each accepted or rejected: the box reads as decided.
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let walk = 0; walk < 8; walk++) {
      let text = written;
      const expected = new Map<string, boolean>();
      for (;;) {
        const marks = parse(text).marks.filter((mark) => mark.kind === 'fmt');
        if (marks.length === 0) break;
        const mark = marks[Math.floor(random() * marks.length)];
        if (!mark) break;
        const on = random() < 0.5;
        const line = text.slice(text.lastIndexOf('\n', mark.segments[0]?.open.from ?? 0) + 1);
        expected.set(line.slice(6, 7), on);
        text = applyChanges(text, on ? accept(text, mark.id) : reject(text, mark.id));
      }
      const doc = text.split('\n').slice(0, 12);
      for (const [i, line] of doc.entries()) {
        const letter = 'abcdefghijkl'[i] ?? '';
        expect(line, `walk ${walk}`).toBe(`- [${expected.get(letter) ? 'x' : ' '}] ${letter}`);
      }
    }
    undo(editor.view);
    expect(editor.getDoc()).toBe(TWELVE);
  }, 30_000);

  it('checks twelve items with Track Changes off, in one step to undo', () => {
    const editor = mount(TWELVE, false);
    select(editor, 'a', 'l');
    press(editor);
    expect(editor.getDoc()).toBe(TWELVE.replaceAll('[ ]', '[x]'));
    undo(editor.view);
    expect(editor.getDoc()).toBe(TWELVE);
  });

  it('checks a box in a quote by a click and by Check Item, at depths 1 and 2, tracked or not', () => {
    for (const quote of ['> ', '> > ']) {
      const doc = `${quote}- [ ] a\n${quote}- [x] b\n\nEnd.\n`;
      for (const on of [true, false]) {
        const label = `${quote} tracking ${on}`;
        const notices: string[] = [];
        // A click.
        const clicked = mount(doc, on, notices);
        click(clicked, 0);
        click(clicked, 1);
        const flip = doc.replace('[ ] a', '[x] a').replace('[x] b', '[ ] b');
        expect(notices, label).toEqual([]);
        if (on) {
          expect(clicked.getDoc().match(/<!--fmt \w+ [+-]check-->/g), label).toHaveLength(2);
          expect(newestView(clicked.getDoc()).text, label).toBe(flip);
          expect(originalView(clicked.getDoc()).text, label).toBe(doc);
        } else expect(clicked.getDoc(), label).toBe(flip);
        // Check Item on the caret's item, then on both items.
        const keyed = mount(doc, on, notices);
        keyed.view.dispatch({ selection: { anchor: doc.indexOf('a') } });
        press(keyed);
        expect(notices, label).toEqual([]);
        expect(newestView(keyed.getDoc()).text, label).toBe(doc.replace('[ ] a', '[x] a'));
        select(keyed, 'a', 'b');
        press(keyed);
        expect(notices, label).toEqual([]);
        // Both are checked now: Check Item takes both boxes back.
        expect(newestView(keyed.getDoc()).text, label).toBe(doc.replaceAll('[x]', '[ ]'));
        undo(keyed.view);
        undo(keyed.view);
        expect(keyed.getDoc(), label).toBe(doc);
      }
    }
  });

  it('gives the same file whatever the ids of the marks are (50 seeds, depths 1 and 2)', () => {
    // The keys are the same for every seed: only the ids differ, and some hold the letters of the
    // items' texts, which a search of the file for an item would find inside a marker.
    for (const quote of ['> ', '> > ']) {
      const doc = `${quote}- [ ] a\n${quote}- [x] b\n\nEnd.\n`;
      for (let seed = 1; seed <= 50; seed++) {
        const label = `${quote} seed ${seed}`;
        const keyed = mount(doc, true, [], seed);
        keyed.view.dispatch({ selection: { anchor: doc.indexOf('a') } });
        press(keyed);
        expect(newestView(keyed.getDoc()).text, label).toBe(doc.replace('[ ] a', '[x] a'));
        select(keyed, 'a', 'b');
        press(keyed);
        expect(newestView(keyed.getDoc()).text, label).toBe(doc.replaceAll('[x]', '[ ]'));
        expect(originalView(keyed.getDoc()).text, label).toBe(doc);
      }
    }
  });

  it('decides a box checked in a quote in every order', () => {
    const doc = '> - [ ] a\n> - [ ] b\n> - [ ] c\n\nEnd.\n';
    const editor = mount(doc, true);
    select(editor, 'a', 'c');
    press(editor);
    const written = editor.getDoc();
    const ids = parse(written).marks.map((mark) => mark.id);
    expect(ids).toHaveLength(3);
    for (const order of [ids, [...ids].reverse()]) {
      for (const accepting of [true, false]) {
        let text = written;
        for (const id of order)
          text = applyChanges(text, accepting ? accept(text, id) : reject(text, id));
        expect(text).toBe(accepting ? doc.replaceAll('[ ]', '[x]') : doc);
      }
    }
  });

  it('checks twelve boxes by twelve clicks as well', () => {
    const notices: string[] = [];
    const editor = mount(TWELVE, true, notices);
    for (let i = 0; i < 12; i++) click(editor, i);
    expect(notices).toEqual([]);
    expect(editor.getDoc().match(/\+check/g)).toHaveLength(12);
  });
});
