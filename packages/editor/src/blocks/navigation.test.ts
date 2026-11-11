// @vitest-environment happy-dom
// The caret across breaks, the Mac's control keys and the page's line break inputs (design: block
// editing, "Arrows, clicks, selection and Mac keys" and "Other keys and input that edit line
// breaks"). Vertical motion and clicks need a layout, which happy-dom has none of: they are in the
// WebKit check (`apps/desktop/src/block-check.ts`), and `gapSide` is the clicks' rule.
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { newestView, originalView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { editSourceFacet } from '../tracked/typing.ts';
import { macBlockCommands } from './keys.ts';
import { gapSide, lineEndIn, lineStartIn } from './motion.ts';
import { type Script, scriptRows } from './script.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: Editor[] = [];

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const lf = (text: string) => text.replaceAll('⏎', '\n');

/** An editor on `doc`, the caret at its `‸`. */
function mount(doc: string, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  let n = 0;
  const text = lf(doc);
  const editor = createEditor(parent, {
    doc: text.replace('‸', ''),
    author: ada,
    tracking,
    extensions: [
      editSourceFacet.of({
        now: () => new Date('2026-11-01T10:00Z'),
        random: (k) => Uint8Array.from({ length: k }, () => n++ % 19),
      }),
    ],
  });
  editor.view.dispatch({ selection: EditorSelection.cursor(text.indexOf('‸')) });
  mounted.push(editor);
  return editor;
}

/** The text with the caret, in the notation. */
function caret(editor: Editor): string {
  const { state } = editor.view;
  const { head } = state.selection.main;
  const text = state.doc.toString();
  return (text.slice(0, head) + '‸' + text.slice(head)).replaceAll('\n', '⏎');
}

const both = (rows: Omit<Script, 'tc'>[]): Script[] =>
  rows.flatMap((row) => [
    { ...row, name: `${row.name}, Track Changes off`, tc: false },
    { ...row, name: `${row.name}, Track Changes on`, tc: true },
  ]);

describe('← and → across a break', () => {
  scriptRows(
    both([
      {
        name: "← at the start of a heading's text: the end of the text above in one press",
        doc: 'One.⏎⏎## ‸Two',
        keys: ['ArrowLeft'],
        expect: { caret: 'One.‸⏎⏎## Two' },
      },
      {
        name: "→ at the end of the text above: the start of the heading's text in one press",
        doc: 'One.‸⏎⏎## Two',
        keys: ['ArrowRight'],
        expect: { caret: 'One.⏎⏎## ‸Two' },
      },
      {
        name: "← at the start of a list item's text, over its bullet",
        doc: '- one⏎- ‸two',
        keys: ['ArrowLeft'],
        expect: { caret: '- one‸⏎- two' },
      },
      {
        name: "← at the start of a quote's text, over its marker",
        doc: 'One.⏎⏎> ‸Two.',
        keys: ['ArrowLeft'],
        expect: { caret: 'One.‸⏎⏎> Two.' },
      },
      {
        name: '← over a thematic break: the caret never rests on it',
        doc: 'One.⏎⏎---⏎⏎‸Two.',
        keys: ['ArrowLeft'],
        expect: { caret: 'One.‸⏎⏎---⏎⏎Two.' },
      },
      {
        name: '→ at the end of the last block, in front of its closers: nowhere to go (walk seed 85)',
        doc: 'One.⏎⏎Two <ins>three‸</ins>',
        keys: ['ArrowRight'],
        expect: { caret: 'One.⏎⏎Two <ins>three‸</ins>' },
      },
      {
        name: '→ and ← there and back',
        doc: 'One.‸⏎⏎> Two.',
        keys: ['ArrowRight', 'ArrowLeft'],
        expect: { caret: 'One.‸⏎⏎> Two.' },
      },
      {
        name: "← after Delete of an item's first letter: never into the hidden range (review D I10)",
        doc: '- one⏎- ‸alpha⏎⏎After.',
        keys: ['Delete', 'ArrowLeft'],
        expect: { newest: '- one⏎- lpha⏎⏎After.' },
      },
      {
        name: "← then → after Delete of an item's first letter",
        doc: '- one⏎- ‸alpha⏎⏎After.',
        keys: ['Delete', 'ArrowLeft', 'ArrowRight'],
        expect: { newest: '- one⏎- lpha⏎⏎After.' },
      },
      {
        name: '← inside the text: one character, as ever',
        doc: 'One.⏎⏎Tw‸o.',
        keys: ['ArrowLeft'],
        expect: { caret: 'One.⏎⏎T‸wo.' },
      },
    ]),
  );
});

describe('typing at the very end of a document that ends in a closer, after →', () => {
  // → at the end of the last block stays in front of the closers (past them there is only hidden
  // text up to the ledger, where the caret may not be), so what is typed lands where the caret is:
  // inside a comment's or a highlight's anchor; another person's insertion is no place for the
  // caret, and the text typed after it goes next to it.
  const rows: [string, string, string, string, string?][] = [
    [
      'a comment closer',
      'One <!--cmt c1-->two‸<!--/c1-->',
      'One <!--cmt c1-->twox‸<!--/c1-->',
      'One <!--cmt c1-->two<ins>x‸</ins><!--/c1-->',
    ],
    [
      'a highlight closer',
      'One <!--hl h1-->two‸<!--/h1-->',
      'One <!--hl h1-->twox‸<!--/h1-->',
      'One <!--hl h1-->two<ins>x‸</ins><!--/h1-->',
    ],
    [
      'another person’s insertion',
      'One <ins>two‸</ins>',
      'One <ins>two</ins>x‸',
      'One <ins>two</ins><ins>x‸</ins>',
      'bo',
    ],
  ];
  scriptRows(
    rows.flatMap(([name, doc, off, on, others]) =>
      [false, true].map((tc) => ({
        name: `${name}, Track Changes ${tc ? 'on' : 'off'}`,
        doc,
        keys: ['ArrowRight', { type: 'x' }],
        tc,
        ...(others ? { others } : {}),
        expect: { caret: tc ? on : off },
      })),
    ),
  );
});

describe('⌥↑ and ⌥↓ by paragraph', () => {
  scriptRows(
    both([
      {
        name: '⌥↑ in a paragraph: its start',
        doc: 'One.⏎⏎Tw‸o.',
        keys: ['Alt-ArrowUp'],
        expect: { caret: 'One.⏎⏎‸Two.', file: 'One.⏎⏎Two.' },
      },
      {
        name: '⌥↑ at the start of a paragraph: the start of the one before',
        doc: 'One.⏎⏎‸Two.',
        keys: ['Alt-ArrowUp'],
        expect: { caret: '‸One.⏎⏎Two.', file: 'One.⏎⏎Two.' },
      },
      {
        name: '⌥↓ in a paragraph: its end',
        doc: 'On‸e.⏎⏎Two.',
        keys: ['Alt-ArrowDown'],
        expect: { caret: 'One.‸⏎⏎Two.', file: 'One.⏎⏎Two.' },
      },
      {
        name: '⌥↓ at the end of a paragraph: the end of the next one',
        doc: 'One.‸⏎⏎Two.',
        keys: ['Alt-ArrowDown'],
        expect: { caret: 'One.⏎⏎Two.‸', file: 'One.⏎⏎Two.' },
      },
      {
        name: '⌥↑ at the start of the first block, and ⌥↓ at the end of the last: nothing',
        doc: '‸One.⏎⏎Two.',
        keys: ['Alt-ArrowUp', 'Alt-ArrowDown', 'Alt-ArrowDown'],
        expect: { caret: 'One.⏎⏎Two.‸', file: 'One.⏎⏎Two.' },
      },
      {
        name: '⌥↑ over a heading and its hidden marker',
        doc: 'One.⏎⏎## Tw‸o⏎⏎Three.',
        keys: ['Alt-ArrowUp', 'Alt-ArrowUp'],
        expect: { caret: '‸One.⏎⏎## Two⏎⏎Three.', file: 'One.⏎⏎## Two⏎⏎Three.' },
      },
      {
        name: '⌥↓ through list items, a quote and a paragraph',
        doc: '‸- one⏎- two⏎⏎> Quote.⏎⏎Last.',
        keys: ['Alt-ArrowDown', 'Alt-ArrowDown', 'Alt-ArrowDown', 'Alt-ArrowDown'],
        expect: { caret: '- one⏎- two⏎⏎> Quote.⏎⏎Last.‸' },
      },
      {
        name: '⌥↑ through list items',
        doc: '- one⏎- tw‸o',
        keys: ['Alt-ArrowUp', 'Alt-ArrowUp'],
        expect: { caret: '- ‸one⏎- two', file: '- one⏎- two' },
      },
      {
        name: 'a paragraph of two lines is one paragraph',
        doc: 'One⏎two‸⏎⏎Next.',
        keys: ['Alt-ArrowUp'],
        expect: { caret: '‸One⏎two⏎⏎Next.', file: 'One⏎two⏎⏎Next.' },
      },
      {
        name: '⇧⌥↑ selects to the start of the paragraph',
        doc: 'One.⏎⏎Tw‸o.',
        keys: ['Shift-Alt-ArrowUp'],
        expect: { caret: 'One.⏎⏎[Tw]o.', file: 'One.⏎⏎Two.' },
      },
      {
        name: '⇧⌥↓ selects to the end, then to the end of the next',
        doc: 'On‸e.⏎⏎Two.',
        keys: ['Shift-Alt-ArrowDown', 'Shift-Alt-ArrowDown'],
        expect: { caret: 'On[e.⏎⏎Two.]', file: 'One.⏎⏎Two.' },
      },
    ]),
  );
});

describe('⌥← and ⌥→ across a break', () => {
  scriptRows(
    both([
      {
        name: '⌥← at the start of a paragraph: over the break, by a word from the end above',
        doc: 'One two.⏎⏎‸Three.',
        keys: ['Alt-ArrowLeft'],
        expect: { caret: 'One two‸.⏎⏎Three.', file: 'One two.⏎⏎Three.' },
      },
      {
        name: '⌥→ at the end of a paragraph: over the break, by a word from the start below',
        doc: 'One two.‸⏎⏎Three four.',
        keys: ['Alt-ArrowRight'],
        expect: { caret: 'One two.⏎⏎Three‸ four.', file: 'One two.⏎⏎Three four.' },
      },
    ]),
  );
});

describe('⇧⌥← and ⇧⌥→ across a break', () => {
  scriptRows(
    both([
      {
        name: '⇧⌥← at the start of a paragraph: the selection runs over the break',
        doc: 'One two.⏎⏎‸Three.',
        keys: ['Shift-Alt-ArrowLeft'],
        expect: { caret: 'One two[.⏎⏎]Three.', file: 'One two.⏎⏎Three.' },
      },
    ]),
  );
});

describe('triple-click', () => {
  /** What the editor's mouse selection styles make of a click at `pos`, `detail` clicks in. */
  function click(editor: Editor, pos: number, detail = 3, drag?: number): EditorSelection | null {
    const { view } = editor;
    view.posAtCoords = (coords) => (coords.y === 1 && drag !== undefined ? drag : pos);
    const event = new MouseEvent('mousedown', { button: 0, detail, clientX: 0, clientY: 0 });
    for (const make of view.state.facet(EditorView.mouseSelectionStyle)) {
      const style = make(view, event);
      if (!style) continue;
      const moved =
        drag === undefined
          ? event
          : new MouseEvent('mousemove', { button: 0, detail, clientX: 0, clientY: 1 });
      return style.get(moved, false, false);
    }
    return null;
  }

  const selected = (editor: Editor) => {
    const { from, to } = editor.view.state.selection.main;
    return editor.view.state.sliceDoc(from, to);
  };

  it.each([
    ['a paragraph', 'One.⏎⏎Tw‸o three.⏎⏎Four.', 'Two three.'],
    ['a heading, without its marker', 'One.⏎⏎## Tw‸o⏎⏎Four.', 'Two'],
    ['a list item', '- one⏎- tw‸o⏎- three', 'two'],
    ['a quote', 'One.⏎⏎> Qu‸ote.⏎⏎Four.', 'Quote.'],
    ['a paragraph of two lines, whole', 'One⏎tw‸o.⏎⏎Four.', 'One\ntwo.'],
    ['a line of code', '```⏎let‸ x;⏎let y;⏎```', 'let x;'],
  ])('selects %s, not its line break', (_, doc, text) => {
    const editor = mount(doc);
    const selection = click(editor, editor.view.state.selection.main.head);
    expect(selection).not.toBeNull();
    editor.view.dispatch({ selection: selection! });
    expect(selected(editor)).toBe(text);
  });

  it('is CodeMirror’s for one and two clicks, in Raw, and on a thematic break', () => {
    const editor = mount('One.⏎⏎Tw‸o.');
    expect(click(editor, 8, 1)).toBeNull();
    expect(click(editor, 8, 2)).toBeNull();
    const rule = mount('One.⏎⏎---⏎⏎Tw‸o.');
    expect(click(rule, 7)).toBeNull();
  });

  it('typed over, the text is replaced and the break stays, Track Changes off', () => {
    const editor = mount('One.⏎⏎Tw‸o three.⏎⏎Four.');
    editor.view.dispatch({ selection: click(editor, editor.view.state.selection.main.head)! });
    editor.view.dispatch(editor.view.state.replaceSelection('X'), { userEvent: 'input.type' });
    expect(editor.getDoc()).toBe(lf('One.⏎⏎X⏎⏎Four.'));
  });

  it('typed over, the text is a tracked replacement and the break stays, Track Changes on', () => {
    const editor = mount('One.⏎⏎Tw‸o three.⏎⏎Four.', true);
    editor.view.dispatch({ selection: click(editor, editor.view.state.selection.main.head)! });
    editor.view.dispatch(editor.view.state.replaceSelection('X'), { userEvent: 'input.type' });
    expect(newestView(editor.getDoc()).text).toBe(lf('One.\n\nX\n\nFour.'));
    expect(originalView(editor.getDoc()).text).toBe(lf('One.\n\nTwo three.\n\nFour.'));
  });

  it('dragging on selects whole blocks’ text', () => {
    const editor = mount('One.⏎⏎Tw‸o.⏎⏎Three.⏎⏎Four.');
    const doc = editor.getDoc();
    const selection = click(editor, doc.indexOf('Two') + 1, 3, doc.indexOf('Three') + 2);
    editor.view.dispatch({ selection: selection! });
    expect(selected(editor)).toBe('Two.\n\nThree.');
  });
});

describe('walk seed 145 (review D I10)', () => {
  const doc = '- one⏎- ‸alpha⏎⏎After.';
  const keys: Script['keys'] = ['Enter', 'Enter', 'Delete', 'ArrowLeft'];
  scriptRows([
    { name: 'Return, Return, Delete, ←, Track Changes off', doc, keys, tc: false, expect: {} },
    {
      name: 'Return, Return, Delete, ←, Track Changes on',
      doc,
      keys,
      tc: true,
      expect: {},
    },
  ]);
});

describe('⌘← and ⌘→ on a block’s first and last rows', () => {
  it('stops at the start of the text, not the hidden prefix', () => {
    const editor = mount('One.⏎⏎## Tw‸o');
    const { state } = editor.view;
    const line = state.doc.lineAt(state.selection.main.head);
    expect(lineStartIn(state, state.selection.main.head, line.from)).toBe(line.from + 3);
    expect(lineEndIn(state, state.selection.main.head, line.to)).toBe(line.to);
  });
});

describe('a click in the space between blocks', () => {
  it('goes to the block above in the upper half of the space, below in the lower half', () => {
    expect(gapSide(102, 100, 16)).toBe('above');
    expect(gapSide(109, 100, 16)).toBeNull();
    expect(gapSide(120, 100, 16)).toBeNull();
    expect(gapSide(102, 100, 0)).toBeNull();
  });
});

describe("the Mac's control keys", () => {
  const run = (editor: Editor, key: string) => macBlockCommands[key]!(editor.view);

  it.each([
    ['⌃H at the start of a block: Backspace', 'One.⏎⏎‸Two.', 'Ctrl-h', 'One.‸Two.'],
    ['⌃D at the end of a block: Delete', 'One.‸⏎⏎Two.', 'Ctrl-d', 'One.‸Two.'],
    ['⌃K at the end of a block: Delete', 'One.‸⏎⏎Two.', 'Ctrl-k', 'One.‸Two.'],
    ['⌘⌦ at the end of a block: Delete', 'One.‸⏎⏎Two.', 'Cmd-Delete', 'One.‸Two.'],
    ['⌘Return in a paragraph: Return at its end', 'On‸e.⏎⏎Two.', 'Mod-Enter', 'One.⏎⏎‸⏎⏎Two.'],
    ['⌃O: Return, the caret left', 'One ‸two.', 'Ctrl-o', 'One ‸⏎⏎two.'],
    [
      '⇧⌘K: the line’s text goes, not its break',
      'One.⏎⏎## Tw‸o⏎⏎Three.',
      'Shift-Mod-k',
      'One.⏎⏎## ‸⏎⏎Three.',
    ],
  ])('%s', (_, doc, key, after) => {
    const editor = mount(doc);
    expect(run(editor, key)).toBe(true);
    expect(caret(editor)).toBe(after);
  });

  it('⌃K inside the text is CodeMirror’s', () => {
    expect(run(mount('On‸e.⏎⏎Two.'), 'Ctrl-k')).toBe(false);
  });

  it('⌃L selects the line’s text, not its line break', () => {
    const editor = mount('One.⏎⏎## Tw‸o⏎⏎Three.');
    run(editor, 'Ctrl-l');
    const { from, to } = editor.view.state.selection.main;
    expect(editor.view.state.sliceDoc(from, to)).toBe('Two');
  });

  it('⌃T does nothing at a line’s end, across the break', () => {
    const editor = mount('One.‸⏎⏎Two.');
    expect(run(editor, 'Ctrl-t')).toBe(true);
    expect(caret(editor)).toBe('One.‸⏎⏎Two.');
    expect(run(mount('O‸ne.'), 'Ctrl-t')).toBe(false);
  });
});

describe("the page's line break inputs", () => {
  const input = (editor: Editor, inputType: string) =>
    editor.view.contentDOM.dispatchEvent(
      new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }),
    );

  it('takes insertParagraph for Return', () => {
    const editor = mount('One ‸two.');
    input(editor, 'insertParagraph');
    expect(caret(editor)).toBe('One ⏎⏎‸two.');
  });

  it('takes insertLineBreak for Shift-Return', () => {
    const editor = mount('One ‸two.');
    input(editor, 'insertLineBreak');
    expect(caret(editor)).toBe('One \\⏎‸two.');
  });

  it('drops a user edit from anything else that takes a line break out of a hidden run', () => {
    const editor = mount('One.‸⏎⏎Two.');
    const at = 'One.'.length;
    editor.view.dispatch({ changes: { from: at, to: at + 1 }, userEvent: 'delete.forward' });
    expect(editor.getDoc()).toBe(lf('One.⏎⏎Two.'));
    // A selection's deletion goes in: it is a join.
    editor.view.dispatch({ selection: EditorSelection.single(at, at + 2) });
    editor.view.dispatch({ changes: { from: at, to: at + 2 }, userEvent: 'delete.selection' });
    expect(editor.getDoc()).toBe(lf('One.Two.'));
  });
});
