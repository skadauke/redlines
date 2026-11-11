// @vitest-environment happy-dom
// Tab and Shift-Tab in list items (design: block editing, "Tab and Shift-Tab; numbered sublists"),
// with Track Changes off and on.
import { runScopeHandlers } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { createEditor } from '../index.ts';
import { readTree } from '../preview/spacing.ts';
import { openBlock } from './open.ts';
import { type Script, scriptRows, type Step } from './script.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  off: Script['expect'];
  on: Script['expect'];
  skipOn?: Script['skip'];
  skipOff?: Script['skip'];
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) => [
    {
      name: `${row.name}, Track Changes off`,
      doc: row.doc,
      keys: row.keys,
      tc: false,
      expect: row.off,
      ...(row.skipOff ? { skip: row.skipOff } : {}),
    },
    {
      name: `${row.name}, Track Changes on`,
      doc: row.doc,
      keys: row.keys,
      tc: true,
      expect: row.on,
      ...(row.skipOn ? { skip: row.skipOn } : {}),
    },
  ]);

const NUMBERED_UNDER =
  "This numbered item can't move there: right after the text above it, Markdown would read it as part of that text. Put a blank line before it, or number it 1.";
const NOT_UNDER_TEXT =
  "An empty item can't be indented under a line of text in Markdown. Type in it first.";
const FIRST_ITEM = "The first item of a list can't be indented: there is no item to put it under.";

describe('Tab in a list item', () => {
  scriptRows(
    both([
      {
        name: 'at the start of the text: under the item above',
        doc: '- one⏎- ‸two',
        keys: ['Tab'],
        off: { file: '- one⏎  - two', caret: '- one⏎  - ‸two' },
        on: {
          file: '- one⏎  - <fmt was=indent=0>⏎    two</fmt>',
          caret: '- one⏎  - <fmt was=indent=0>⏎    ‸two</fmt>',
        },
      },
      {
        name: 'in the middle of the text',
        doc: '- one⏎- t‸wo',
        keys: ['Tab'],
        off: { file: '- one⏎  - two', caret: '- one⏎  - t‸wo' },
        on: { caret: '- one⏎  - <fmt was=indent=0>⏎    t‸wo</fmt>' },
      },
      {
        name: 'at the end of the text',
        doc: '- one⏎- two‸',
        keys: ['Tab'],
        off: { caret: '- one⏎  - two‸' },
        on: { caret: '- one⏎  - <fmt was=indent=0>⏎    two‸</fmt>' },
      },
      {
        name: 'with its nested items, which go with it',
        doc: '- one⏎- ‸two⏎  - sub',
        keys: ['Tab'],
        off: { file: '- one⏎  - two⏎    - sub' },
        on: { newest: '- one⏎  - two⏎    - sub', original: '- one⏎- two⏎  - sub' },
      },
      {
        name: 'in the second paragraph of an item: the item moves',
        doc: '- one⏎- two⏎⏎  ‸more',
        keys: ['Tab'],
        off: { file: '- one⏎  - two⏎⏎    more' },
        on: { newest: '- one⏎  - two⏎⏎    more', original: '- one⏎- two⏎⏎  more' },
      },
      {
        name: 'in a numbered item: a sublist numbered from 1',
        doc: '2. two⏎3. ‸three',
        keys: ['Tab'],
        off: { file: '2. two⏎   1. three', caret: '2. two⏎   1. ‸three' },
        on: {
          newest: '2. two⏎   1. three',
          original: '2. two⏎3. three',
          caret: '2. two⏎   1. <fmt was=indent=0 was=ol=3.\\x20>⏎      ‸three</fmt>',
        },
      },
      {
        name: 'in the first item of a list: refused, in the format’s words',
        doc: '- ‸one⏎- two',
        keys: ['Tab'],
        off: { file: '- one⏎- two', refusal: FIRST_ITEM },
        on: { file: '- one⏎- two', refusal: FIRST_ITEM },
      },
      {
        name: 'on an item that Return just made: the new item under the one it came from',
        doc: '- one⏎- two‸',
        keys: ['Enter', 'Tab'],
        // Open: the item is drawn and the caret is in it, the file has none (`- two` alone).
        off: { file: '- one⏎- two', caret: '- one⏎- two⏎  - ‸' },
        on: { file: '- one⏎- two', caret: '- one⏎- two<split>⏎  - ‸' },
      },
      {
        name: 'on an item that Return just made, then text typed',
        doc: '- one⏎- two‸',
        keys: ['Enter', 'Tab', { type: 'X' }],
        off: { file: '- one⏎- two⏎  - X' },
        on: { file: '- one⏎- two<ins><split>⏎  - X</ins>' },
      },
      {
        name: 'on an item that Return just made, then Shift-Tab: back as it was',
        doc: '- one⏎- two‸',
        keys: ['Enter', 'Tab', 'Shift-Tab'],
        off: { file: '- one⏎- two⏎- ', caret: '- one⏎- two⏎- ‸' },
        on: { file: '- one⏎- two<split>⏎- ', caret: '- one⏎- two<split>⏎- ‸' },
      },
      {
        name: 'on a numbered item that Return just made: numbered from 1',
        doc: '1. one⏎2. two‸',
        keys: ['Enter', 'Tab'],
        off: { file: '1. one⏎2. two', caret: '1. one⏎2. two⏎   1. ‸' },
        on: { file: '1. one⏎2. two', caret: '1. one⏎2. two<split>⏎   1. ‸' },
      },
      {
        name: 'on an item Return just made, then the caret leaves: it is taken back with its Return',
        doc: '- one⏎- two‸',
        keys: ['Enter', 'Tab', 'ArrowLeft'],
        off: { file: '- one⏎- two', caret: '- one⏎- two‸' },
        on: { file: '- one⏎- two', caret: '- one⏎- two‸' },
      },
      {
        name: 'on an item Return just made, then Backspace: it goes, the caret at the end above',
        doc: '- one⏎- two‸',
        keys: ['Enter', 'Tab', 'Backspace'],
        off: { file: '- one⏎- two', caret: '- one⏎- two‸' },
        on: { file: '- one⏎- two', caret: '- one⏎- two‸' },
      },
      {
        name: 'on an item Return just made, then Return: out one level, an ordinary item',
        doc: '- one⏎- two‸',
        keys: ['Enter', 'Tab', 'Enter'],
        off: { file: '- one⏎- two⏎- ', caret: '- one⏎- two⏎- ‸' },
        on: { file: '- one⏎- two<split>⏎- ', caret: '- one⏎- two<split>⏎- ‸' },
      },
      {
        name: 'on an item Return just made, Shift-Tab, then Backspace: open again',
        doc: '- one⏎- two‸',
        keys: ['Enter', 'Tab', 'Shift-Tab', 'Backspace'],
        off: { file: '- one⏎- two', caret: '- one⏎- two⏎  - ‸' },
        on: { file: '- one⏎- two', caret: '- one⏎- two<split>⏎  - ‸' },
      },
      {
        name: 'on an item Return just made, Shift-Tab, then Tab: open again',
        doc: '- one⏎- two‸',
        keys: ['Enter', 'Tab', 'Shift-Tab', 'Tab'],
        off: { file: '- one⏎- two', caret: '- one⏎- two⏎  - ‸' },
        on: { file: '- one⏎- two', caret: '- one⏎- two<split>⏎  - ‸' },
      },
      {
        name: 'on an item Return just made, then Undo and Redo: open again, the file without it',
        doc: '- one⏎- two‸',
        keys: ['Enter', 'Tab', 'Mod-z', 'Mod-y'],
        off: { file: '- one⏎- two', caret: '- one⏎- two⏎  - ‸' },
        on: { file: '- one⏎- two', caret: '- one⏎- two<split>⏎  - ‸' },
      },
      {
        name: 'on an empty item the file already holds: refused, in words that say why',
        doc: '- one⏎- two⏎- ‸',
        keys: ['Tab'],
        off: { file: '- one⏎- two⏎- ', refusal: NOT_UNDER_TEXT },
        on: { file: '- one⏎- two⏎- ', refusal: NOT_UNDER_TEXT },
      },
      {
        name: 'on an empty item after a nested item: the form Markdown holds, written',
        doc: '- one⏎  - a⏎- ‸',
        keys: ['Tab'],
        off: { file: '- one⏎  - a⏎  - ', caret: '- one⏎  - a⏎  - ‸' },
        on: { file: '- one⏎  - a⏎  - ', caret: '- one⏎  - a⏎  - ‸' },
      },
      {
        name: 'on an empty item after a blank line: the form Markdown holds, written',
        doc: '- one⏎⏎- ‸',
        keys: ['Tab'],
        off: { file: '- one⏎⏎  - ', caret: '- one⏎⏎  - ‸' },
        on: { file: '- one⏎⏎  - ', caret: '- one⏎⏎  - ‸' },
      },
      {
        name: 'on an item with text typed after Return: its split’s break, no mark',
        doc: '- one⏎- two‸',
        keys: ['Enter', { type: 'X' }, 'Tab'],
        off: { file: '- one⏎- two⏎  - X' },
        on: { file: '- one⏎- two<ins><split>⏎  - X</ins>' },
      },
      {
        name: 'in a task item',
        doc: '- one⏎- [ ] ‸two',
        keys: ['Tab'],
        off: { file: '- one⏎  - [ ] two' },
        on: { newest: '- one⏎  - [ ] two', original: '- one⏎- [ ] two' },
      },
      {
        name: 'in an item of a numbered sublist: it keeps its number',
        doc: '1. a⏎   1. b⏎2. ‸c',
        keys: ['Tab'],
        off: { file: '1. a⏎   1. b⏎   2. c' },
        on: { newest: '1. a⏎   1. b⏎   2. c', original: '1. a⏎   1. b⏎2. c' },
      },
      {
        name: 'then Shift-Tab: the mark is taken away',
        doc: '- one⏎- ‸two',
        keys: ['Tab', 'Shift-Tab'],
        off: { file: '- one⏎- two' },
        on: { file: '- one⏎- two' },
      },
    ]),
  );
});

describe('Tab and Shift-Tab in a list in a quote', () => {
  scriptRows(
    both([
      {
        name: 'Tab under the item above',
        doc: '> - one⏎> - ‸two',
        keys: ['Tab'],
        off: { file: '> - one⏎>   - two', caret: '> - one⏎>   - ‸two' },
        on: { newest: '> - one⏎>   - two', original: '> - one⏎> - two' },
      },
      {
        name: 'Shift-Tab up a level',
        doc: '> - one⏎>   - ‸two',
        keys: ['Shift-Tab'],
        off: { file: '> - one⏎> - two' },
        on: { newest: '> - one⏎> - two', original: '> - one⏎>   - two' },
      },
      {
        name: 'Tab in a quote in a quote',
        doc: '> > - one⏎> > - ‸two',
        keys: ['Tab'],
        off: { file: '> > - one⏎> >   - two' },
        on: { newest: '> > - one⏎> >   - two', original: '> > - one⏎> > - two' },
      },
      {
        name: 'Tab in a numbered item: numbered from 1',
        doc: '> 1. one⏎> 2. ‸two',
        keys: ['Tab'],
        off: { file: '> 1. one⏎>    1. two' },
        on: { newest: '> 1. one⏎>    1. two', original: '> 1. one⏎> 2. two' },
      },
      {
        name: 'Tab in the first item: refused in the format’s words',
        doc: '> - ‸one⏎> - two',
        keys: ['Tab'],
        off: { file: '> - one⏎> - two', refusal: FIRST_ITEM },
        on: { file: '> - one⏎> - two', refusal: FIRST_ITEM },
      },
      {
        name: 'after Return: the open item, not in the file',
        doc: '> - one⏎> - two‸',
        keys: ['Enter', 'Tab'],
        off: { file: '> - one⏎> - two', caret: '> - one⏎> - two⏎>   - ‸' },
        on: { file: '> - one⏎> - two' },
      },
      {
        name: 'after Return, then typing',
        doc: '> - one⏎> - two‸',
        keys: ['Enter', 'Tab', { type: 'x' }],
        off: { file: '> - one⏎> - two⏎>   - x' },
        on: { newest: '> - one⏎> - two⏎>   - x' },
      },
    ]),
  );
});

describe('Tab in a list under review', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => `- ${'abcdefg'[i]} <ins>${i}</ins>`).join('⏎');
  const many = (n: number) =>
    `There are ${n} pending changes in this list, too many to check this change against. Accept or reject some of them first.`;
  scriptRows(
    [4, 5]
      .flatMap((n) =>
        both([
          {
            name: `with ${n} other pending changes in the list: works (rule 5)`,
            doc: `- one⏎- ‸two⏎${rows(n)}`,
            keys: ['Tab'],
            off: {
              newest: `- one⏎  - two⏎${rows(n).replaceAll('<ins>', '').replaceAll('</ins>', '')}`,
            },
            on: { original: `- one⏎- two⏎${rows(n).replaceAll(/<ins>.*?<\/ins>/g, '')}` },
          },
        ]),
      )
      .concat([
        {
          name: 'with six other pending changes in the list: refused, with the count, Track Changes on',
          doc: `- one⏎- ‸two⏎${rows(6)}`,
          keys: ['Tab'],
          tc: true,
          expect: { refusal: many(6) },
        },
        {
          // Without Track Changes there is no new mark to try with them: one more works.
          name: 'with seven other pending changes in the list: refused, with the count, Track Changes off',
          doc: `- one⏎- ‸two⏎${rows(7)}`,
          keys: ['Tab'],
          tc: false,
          expect: { refusal: many(7) },
        },
      ])
      .map((script) => ({ ...script, others: 'bo' })),
    // Trying every order of six marks takes a while, more under load.
    60_000,
  );
});

describe('Shift-Tab in a list item', () => {
  scriptRows(
    both([
      {
        name: 'in a nested item: up a level',
        doc: '- one⏎  - ‸two',
        keys: ['Shift-Tab'],
        off: { file: '- one⏎- two', caret: '- one⏎- ‸two' },
        on: {
          newest: '- one⏎- two',
          original: '- one⏎  - two',
          caret: '- one⏎- <fmt was=indent=2>⏎  ‸two</fmt>',
        },
      },
      {
        name: 'in the middle of the text',
        doc: '- one⏎  - t‸wo',
        keys: ['Shift-Tab'],
        off: { file: '- one⏎- two', caret: '- one⏎- t‸wo' },
        on: { newest: '- one⏎- two' },
      },
      {
        name: 'in a nested item with items after it: they become its children',
        doc: '- a⏎  - b⏎  - ‸c⏎  - d',
        keys: ['Shift-Tab'],
        off: { file: '- a⏎  - b⏎- c⏎  - d' },
        on: { newest: '- a⏎  - b⏎- c⏎  - d', original: '- a⏎  - b⏎  - c⏎  - d' },
      },
      {
        name: 'in a top-level item: nothing',
        doc: '- one⏎- ‸two',
        keys: ['Shift-Tab'],
        off: { file: '- one⏎- two', caret: '- one⏎- ‸two' },
        on: { file: '- one⏎- two', caret: '- one⏎- ‸two' },
      },
      {
        name: 'in a nested numbered item: its numbered sibling would become its child, as text',
        doc: '1. one⏎   1. ‸a⏎   2. b',
        keys: ['Shift-Tab'],
        off: {
          file: '1. one⏎   1. a⏎   2. b',
          refusal:
            "This item can't be outdented: the numbered item after it would become its first child, and right under its text Markdown would read that item as part of the text. Put a blank line between them, or number it 1.",
        },
        on: {
          file: '1. one⏎   1. a⏎   2. b',
          refusal:
            "This item can't be outdented: the numbered item after it would become its first child, and right under its text Markdown would read that item as part of the text. Put a blank line between them, or number it 1.",
        },
      },
      {
        name: 'in the last nested numbered item, right under text: refused as before',
        doc: '1. one⏎   1. a⏎   2. ‸b',
        keys: ['Shift-Tab'],
        off: { file: '1. one⏎   1. a⏎   2. b', refusal: NUMBERED_UNDER },
        on: { file: '1. one⏎   1. a⏎   2. b', refusal: NUMBERED_UNDER },
      },
    ]),
  );
});

describe('Tab and Shift-Tab over several items', () => {
  scriptRows(
    both([
      {
        name: 'Tab: each item, under the one above',
        doc: '- one⏎- [two⏎- three]⏎- four',
        keys: ['Tab'],
        off: { file: '- one⏎  - two⏎  - three⏎- four' },
        on: { newest: '- one⏎  - two⏎  - three⏎- four', original: '- one⏎- two⏎- three⏎- four' },
      },
      {
        name: 'Shift-Tab: each item',
        doc: '- one⏎  - [two⏎  - three]⏎- four',
        keys: ['Shift-Tab'],
        off: { file: '- one⏎- two⏎- three⏎- four' },
        on: { newest: '- one⏎- two⏎- three⏎- four', original: '- one⏎  - two⏎  - three⏎- four' },
      },
      {
        name: 'Tab, then Undo in one step: the group is one step',
        doc: '- one⏎- [two⏎- three]',
        keys: ['Tab', 'Mod-z'],
        off: { file: '- one⏎- two⏎- three' },
        on: { file: '- one⏎- two⏎- three' },
      },
    ]),
  );
});

describe('Tab elsewhere', () => {
  scriptRows(
    both([
      {
        name: 'in a paragraph: nothing',
        doc: 'One tw‸o.',
        keys: ['Tab'],
        off: { file: 'One two.', caret: 'One tw‸o.' },
        on: { file: 'One two.', caret: 'One tw‸o.' },
      },
      {
        name: 'in a heading: nothing',
        doc: '## One tw‸o',
        keys: ['Tab', 'Shift-Tab'],
        off: { file: '## One two' },
        on: { file: '## One two' },
      },
      {
        name: 'in a quote: nothing',
        doc: '> One tw‸o',
        keys: ['Tab'],
        off: { file: '> One two' },
        on: { file: '> One two' },
      },
    ]),
  );
});

describe('Escape, then Tab', () => {
  it('leaves the document: the keys do not take it', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: '- one\n- two\n\nA paragraph.\n',
      author: { handle: 'ada', name: 'Ada Lovelace' },
      tracking: false,
    });
    const { view } = editor;
    const key = (name: string, keyCode: number) => {
      const event = new KeyboardEvent('keydown', {
        key: name,
        keyCode,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      return event;
    };
    // Tab alone is taken: in a list item it indents, in a paragraph it does nothing.
    view.dispatch({ selection: { anchor: 8 } });
    expect(key('Tab', 9).defaultPrevented).toBe(true);
    expect(editor.getDoc()).toBe('- one\n  - two\n\nA paragraph.\n');
    view.dispatch({ selection: { anchor: editor.getDoc().indexOf('paragraph') } });
    expect(key('Tab', 9).defaultPrevented).toBe(true);
    // After Escape it is the browser's: the focus moves on, and nothing changes.
    view.dispatch({ selection: { anchor: 8 } });
    const before = editor.getDoc();
    key('Escape', 27);
    expect(key('Tab', 9).defaultPrevented).toBe(false);
    expect(editor.getDoc()).toBe(before);
    editor.destroy();
    parent.remove();
  });
});

describe('an unsound empty item the file already holds is an ordinary line', () => {
  // Undo and Redo bring it back as it was; the file never loses it, whatever the caret is on.
  scriptRows(
    both([
      {
        name: 'a nested empty bullet, typed in and Undone',
        doc: '- one⏎  - ‸',
        keys: [{ type: 'x' }, 'Mod-z'],
        off: { file: '- one⏎  - ', caret: '- one⏎  - ‸' },
        // The format takes no typing in a line of syntax alone, in a file that holds one already.
        on: { file: '- one⏎  - ', refusal: 'A line that is only Markdown syntax takes no change.' },
      },
      {
        name: 'a nested empty numbered item, typed in and Undone',
        doc: '1. one⏎   1. ‸',
        keys: [{ type: 'x' }, 'Mod-z'],
        off: { file: '1. one⏎   1. ', caret: '1. one⏎   1. ‸' },
        on: { file: '1. one⏎   1. ' },
      },
      {
        name: 'typed in, Undone and Redone',
        doc: '- one⏎  - ‸',
        keys: [{ type: 'x' }, 'Mod-z', 'Mod-y'],
        off: { file: '- one⏎  - x' },
        on: { file: '- one⏎  - ', refusal: 'A line that is only Markdown syntax takes no change.' },
      },
    ]),
  );
});

describe("an empty item of another person's pending split", () => {
  // The tracked layer takes no edit of their break until it is decided, and the file is never
  // changed untracked: refused, in words, and every order of decisions reads as before.
  const THEIRS =
    "Another person's pending change made this item. Accept or reject it before indenting or outdenting it.";
  scriptRows(
    ['Tab', 'Shift-Tab'].map((key) => ({
      name: `${key} with Track Changes on is refused`,
      doc: key === 'Tab' ? '- one⏎  - a<split>⏎- ‸' : '- one⏎  - a<split>⏎  - ‸',
      others: 'bo',
      keys: [key as 'Tab'],
      tc: true,
      expect: {
        file: key === 'Tab' ? '- one⏎  - a<split>⏎- ' : '- one⏎  - a<split>⏎  - ',
        refusal: THEIRS,
      },
    })),
  );
});

describe('the open empty item', () => {
  it('is read as an item at its level holding a character, and left out of the file', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: '- one\n- two',
      author: { handle: 'ada', name: 'Ada Lovelace' },
      tracking: false,
    });
    const { view } = editor;
    view.dispatch({ selection: { anchor: 11 } });
    const press = (key: string) =>
      runScopeHandlers(view, new KeyboardEvent('keydown', { key, bubbles: true }), 'editor');
    press('Enter');
    press('Tab');
    expect(view.state.doc.toString()).toBe('- one\n- two\n  - ');
    expect(editor.getDoc()).toBe('- one\n- two');
    expect(openBlock(view.state)).toMatchObject({ item: true });
    expect(view.contentDOM.dataset['rlOpenBlock']).toBe('3');
    // Read as if it held a character: a nested list of one item, and the list is tight.
    const read = readTree(view.state);
    expect(read.reading.sliceDoc(0, read.reading.doc.length)).toBe('- one\n- two\n  - x');
    let depth = 0;
    read.tree.iterate({
      enter: (node) => {
        if (node.name === 'ListItem')
          depth = Math.max(depth, 1 + (node.node.parent?.parent?.name === 'ListItem' ? 1 : 0));
      },
    });
    expect(depth).toBe(2);
    // Typing writes it.
    view.dispatch(view.state.replaceSelection('x'), { userEvent: 'input.type' });
    expect(editor.getDoc()).toBe('- one\n- two\n  - x');
    expect(openBlock(view.state)).toBeNull();
    editor.destroy();
    parent.remove();
  });
});
