// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor, type MarkupView, undo } from '@redlines/editor';
import { accept, applyChanges, newestView, originalView, reject } from '@redlines/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFormatting, plugin } from './index.ts';

interface Mounted {
  editor: Editor;
  notices: string[];
  refused: string[];
  remove: () => void;
}

const mounted: Mounted[] = [];
const author = { handle: 'ada', name: 'Ada Lovelace' };

function mount(
  doc: string,
  options: { tracking?: boolean; markupView?: MarkupView } = {},
): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const refused: string[] = [];
  const notices: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author,
    tracking: options.tracking ?? false,
    markupView: options.markupView,
    onNotice: (message) => refused.push(message),
  });
  const result = {
    editor,
    notices,
    refused,
    remove: createFormatting(editor, { author, notice: (message) => notices.push(message) }),
  };
  mounted.push(result);
  return result;
}

afterEach(() => {
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

/** Puts the selection at `anchor` to `head` and parses the document. */
function select(editor: Editor, anchor: number, head = anchor): void {
  editor.view.dispatch({ selection: { anchor, head } });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
}

const visible = (editor: Editor) => newestView(editor.getDoc()).text;

describe('inline formats', () => {
  it('bolds the word under the caret with no selection', () => {
    const { editor } = mount('One two three.\n');
    select(editor, 5);
    expect(editor.commands.run('format.bold')).toBe(true);
    expect(editor.getDoc()).toBe('One **two** three.\n');
  });

  it('writes a fmt mark with tracking on and plain ** with it off', () => {
    const on = mount('One two three.\n', { tracking: true });
    select(on.editor, 4, 7);
    on.editor.commands.run('format.bold');
    expect(on.editor.getDoc()).toMatch(/<!--fmt \w+ \+bold-->\*\*two\*\*<!--\/\w+-->/);
    expect(on.editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['fmt']);
    expect(on.editor.getParsed().ledger.marks).toBeDefined();

    const off = mount('One two three.\n');
    select(off.editor, 4, 7);
    off.editor.commands.run('format.bold');
    expect(off.editor.getDoc()).toBe('One **two** three.\n');
    expect(off.editor.getParsed().marks).toEqual([]);
  });

  it('undoes in one step', () => {
    const { editor } = mount('One two three.\n', { tracking: true });
    select(editor, 4, 7);
    editor.commands.run('format.italic');
    undo(editor.view);
    expect(editor.getDoc()).toBe('One two three.\n');
  });

  it('shows a check mark while the caret is inside bold', () => {
    const { editor } = mount('One **two** three.\n');
    select(editor, 7);
    expect(editor.getUiState().activeCommands).toContain('format.bold');
    expect(editor.getUiState().activeCommands).not.toContain('format.italic');
    select(editor, 1);
    expect(editor.getUiState().activeCommands).not.toContain('format.bold');
  });

  it('turns the same command off inside bold', () => {
    const { editor } = mount('One **two** three.\n');
    select(editor, 7);
    editor.commands.run('format.bold');
    expect(editor.getDoc()).toBe('One two three.\n');
  });

  it.each(['simple', 'redlines'] as const)(
    'a tracked format change made in Clean shows the markup view, %s',
    (markupView) => {
      const { editor } = mount('One two three.\n', { tracking: true, markupView });
      editor.setViewMode('clean');
      select(editor, 5, 8);
      expect(editor.commands.run('format.bold')).toBe(true);
      expect(editor.getUiState().view).toBe(markupView);
    },
  );

  it('a tracked format change made in Simple stays in Simple', () => {
    const { editor } = mount('One two three.\n', { tracking: true });
    editor.setViewMode('simple');
    select(editor, 5, 8);
    expect(editor.commands.run('format.bold')).toBe(true);
    expect(editor.getUiState().view).toBe('simple');
  });

  it('turns it off as a tracked change with tracking on', () => {
    const { editor } = mount('One **two** three.\n', { tracking: true });
    select(editor, 7);
    editor.commands.run('format.bold');
    expect(editor.getDoc()).toMatch(/<!--fmt \w+ -bold-->two<!--\/\w+-->/);
  });

  it('is refused with a one-line notice inside code', () => {
    const { editor, refused } = mount('```\nsome code\n```\n', { tracking: true });
    select(editor, 8);
    expect(editor.commands.run('format.bold')).toBe(false);
    expect(refused).toEqual(["Formatting doesn't apply inside code. Select text outside it."]);
    expect(editor.getUiState().disabledReasons['format.bold']).toBe(refused[0]);
    expect(editor.getDoc()).toBe('```\nsome code\n```\n');
  });

  it('does nothing with no word under the caret and no selection', () => {
    const { editor, notices } = mount('One  two.\n');
    select(editor, 4);
    expect(editor.commands.run('format.bold')).toBe(false);
    expect(editor.getDoc()).toBe('One  two.\n');
    expect(notices).toEqual([]);
  });

  it('clears the formats of a selection', () => {
    const { editor } = mount('One **two** three.\n');
    select(editor, 6, 9);
    editor.commands.run('format.clear');
    expect(editor.getDoc()).toBe('One two three.\n');
  });

  it('writes code and strikethrough', () => {
    const { editor } = mount('One two three.\n');
    select(editor, 4, 7);
    editor.commands.run('format.code');
    expect(editor.getDoc()).toBe('One `two` three.\n');
    select(editor, 10, 15);
    editor.commands.run('format.strike');
    expect(editor.getDoc()).toBe('One `two` ~~three~~.\n');
  });
});

describe('blocks', () => {
  it('makes the caret block a heading, and back to body', () => {
    const { editor } = mount('Title\n\nBody text.\n');
    select(editor, 2);
    editor.commands.run('block.h2');
    expect(editor.getDoc()).toBe('## Title\n\nBody text.\n');
    expect(editor.getUiState().activeCommands).toContain('block.h2');
    editor.commands.run('block.h2');
    expect(editor.getDoc()).toBe('Title\n\nBody text.\n');
  });

  it('makes a list item, tracked, and shows it checked', () => {
    const { editor } = mount('Item\n', { tracking: true });
    select(editor, 1);
    editor.commands.run('block.ul');
    expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['fmt']);
    expect(visible(editor)).toContain('- Item');
    expect(editor.getUiState().activeCommands).toContain('block.ul');
    expect(editor.getUiState().activeCommands).not.toContain('block.task');
  });

  it('indents a list item', () => {
    const { editor } = mount('- One\n- Two\n');
    select(editor, 8);
    editor.commands.run('block.indent');
    expect(editor.getDoc()).toBe('- One\n  - Two\n');
    editor.commands.run('block.outdent');
    expect(editor.getDoc()).toBe('- One\n- Two\n');
  });

  it('indents and outdents through the block layer, as Tab does', () => {
    // A numbered item is numbered from 1 in its new sublist; the first item is refused in the
    // format's words, and a top-level item can't be outdented, which does nothing.
    const { editor, refused } = mount('1. One\n2. Two\n3. Three\n');
    select(editor, editor.getDoc().indexOf('Three'));
    expect(editor.commands.run('block.indent')).toBe(true);
    expect(editor.getDoc()).toBe('1. One\n2. Two\n   1. Three\n');
    select(editor, 4);
    // The first item has nothing to go under: Indent is disabled, and says why.
    expect(editor.getUiState().disabledReasons['block.indent']).toBe(
      "The first item of a list can't be indented: there is no item to put it under.",
    );
    editor.commands.run('block.indent');
    expect(refused).toEqual([
      "The first item of a list can't be indented: there is no item to put it under.",
    ]);
    refused.length = 0;
    // A top-level item is under no item to come out of.
    editor.commands.run('block.outdent');
    expect(editor.getDoc()).toBe('1. One\n2. Two\n   1. Three\n');
    expect(refused).toEqual([
      "This item isn't under another item. Backspace at its start takes the bullet away.",
    ]);
  });

  it('inserts a table and a rule as tracked insertions with tracking on', () => {
    const { editor } = mount('One.\n\nTwo.\n', { tracking: true });
    select(editor, 2);
    expect(editor.commands.run('block.rule')).toBe(true);
    // A rule can't go in a table, now that the pending table is one: the table goes after "Two."
    select(editor, editor.getDoc().indexOf('Two.') + 4);
    expect(editor.commands.run('block.table')).toBe(true);
    const kinds = editor.getParsed().marks.map((mark) => mark.kind);
    expect(kinds.length).toBeGreaterThan(0);
    // The line breaks that part the block from its neighbors are insertions too.
    expect(kinds).toContain('ins');
    expect(kinds.every((kind) => kind === 'ins' || kind === 'split')).toBe(true);
    expect(visible(editor)).toContain('| --- |');
    expect(visible(editor)).toContain('\n---');
    expect(visible(editor).indexOf('Two.')).toBeGreaterThan(visible(editor).indexOf('---'));
  });

  // Every kind of block that a command inserts is drawn as that block with Track Changes on, as it
  // is with it off, not shown as Markdown (P0-a): the table was shown raw, its lines ending with the
  // markers of the line breaks it inserts.
  it.each([
    ['block.table', '.rl-trow', 2],
    ['block.rule', '.rl-hr', 1],
    ['block.code', '.rl-codeblock', 3],
    ['block.quote', '.rl-quote', 1],
    ['block.alert', '.rl-callout', 2],
  ])('draws %s as a block with tracking on and off', (command, selector, lines) => {
    for (const tracking of [false, true]) {
      for (const view of ['redlines', 'clean'] as const) {
        const { editor } = mount('One.\n\nTwo.\n', { tracking });
        editor.setViewMode(view);
        select(editor, 2);
        expect(editor.commands.run(command)).toBe(true);
        forceParsing(editor.view, editor.view.state.doc.length, 5000);
        const drawn = editor.view.contentDOM.querySelectorAll(selector);
        expect(drawn.length, `${command}, tracking ${tracking}, ${view}`).toBeGreaterThanOrEqual(
          lines,
        );
      }
    }
  });

  it('draws a table inserted with tracking on, types in it, and decides it', () => {
    const { editor } = mount('One.\n\nTwo.\n', { tracking: true });
    select(editor, 2);
    editor.commands.run('block.table');
    const rows = () => editor.view.contentDOM.querySelectorAll('.cm-line.rl-trow');
    expect(rows()).toHaveLength(2);
    expect([...rows()].some((row) => row.textContent?.includes('<!--'))).toBe(false);
    // The first header cell is empty with the caret in it: typing names the column, in the pending insertion.
    editor.view.dispatch(editor.view.state.replaceSelection('Name'), { userEvent: 'input.type' });
    expect(rows()).toHaveLength(2);
    expect(visible(editor)).toContain('| Name |  |');
    // Accepting everything leaves the table plain, rejecting everything takes it away.
    const doc = editor.getDoc();
    expect(newestView(doc).text).toMatch(
      /^One\.\n\n\| Name \| {2}\|\n\| --- \| --- \|\n\| {2}\| {2}\|\n\nTwo\./,
    );
    expect(originalView(doc).text.trim()).toBe('One.\n\nTwo.');
    // Undo takes the typing and the table back.
    for (let i = 0; i < 6; i++) undo(editor.view);
    expect(editor.getDoc()).toBe('One.\n\nTwo.\n');
    expect(rows()).toHaveLength(0);
  });

  it('inserts a table plainly with tracking off', () => {
    const { editor } = mount('One.\n');
    select(editor, 2);
    editor.commands.run('block.table');
    expect(editor.getParsed().marks).toEqual([]);
    expect(editor.getDoc()).toMatch(/^One\.\n\n\|.*\|\n\| --- /);
  });

  it('wraps a selection in a code block with tracking off', () => {
    const { editor, refused } = mount('Intro.\n\nlet x = 1;\nlet y = 2;\n');
    select(editor, 8, 28);
    expect(editor.commands.run('block.code')).toBe(true);
    expect(refused).toEqual([]);
    expect(editor.getDoc()).toBe('Intro.\n\n```\nlet x = 1;\nlet y = 2;\n```\n');
    select(editor, 14);
    expect(editor.getUiState().activeCommands).toContain('block.code');
    undo(editor.view);
    expect(editor.getDoc()).toBe('Intro.\n\nlet x = 1;\nlet y = 2;\n');
  });

  it('fences the paragraph under the caret, and an empty line gets an empty block', () => {
    const { editor } = mount('Intro.\n\nrun `a`\nnow\n\n');
    select(editor, 12);
    editor.commands.run('block.code');
    expect(editor.getDoc()).toBe('Intro.\n\n```\nrun `a`\nnow\n```\n\n');
    select(editor, editor.getDoc().length);
    editor.commands.run('block.code');
    expect(editor.getDoc().endsWith('```\n\n```')).toBe(true);
  });

  it('fences a paragraph as a tracked substitution with tracking on', () => {
    const { editor, notices, refused } = mount('Intro.\n\nlet x = 1;\nlet y = 2;\n\nEnd.\n', {
      tracking: true,
    });
    select(editor, 12);
    expect(editor.commands.run('block.code')).toBe(true);
    expect(notices).toEqual([]);
    expect(refused).toEqual([]);
    const doc = editor.getDoc();
    // The opener on the line before the fence, the closer on the line after it (format §3.3).
    expect(doc).toMatch(
      /^Intro\.\n\n<!--sub ([a-z0-9]{4}) let x = 1;\\nlet y = 2;-->\n\n```\nlet x = 1;\nlet y = 2;\n```\n<!--\/\1-->\n\nEnd\.\n/,
    );
    const [mark] = editor.getParsed().marks;
    expect(mark?.kind).toBe('sub');
    expect(visible(editor)).toMatch(/^Intro\.\n\n```\nlet x = 1;\nlet y = 2;\n```\n\n\nEnd\.\n/);
    select(editor, doc.indexOf('```\nlet') + 6);
    expect(editor.getUiState().activeCommands).toContain('block.code');
    // Accepting keeps the block, with the line break the closer stood after; rejecting brings
    // the paragraph back as it was.
    expect(applyChanges(doc, accept(doc, mark!.id))).toBe(
      'Intro.\n\n```\nlet x = 1;\nlet y = 2;\n```\n\n\nEnd.\n',
    );
    expect(applyChanges(doc, reject(doc, mark!.id))).toBe(
      'Intro.\n\nlet x = 1;\nlet y = 2;\n\nEnd.\n',
    );
  });

  it("says why a code block can't be made", () => {
    // Tracked, a heading keeps its `#`s in front of the change, and a fence after them is none.
    const heading = mount('Intro.\n\n# Head\n\nEnd.\n', { tracking: true });
    select(heading.editor, 11);
    expect(heading.editor.commands.run('block.code')).toBe(false);
    expect(heading.notices).toEqual([
      "A heading can't become a code block while Track Changes is on. Make it body text first.",
    ]);
    expect(heading.refused).toEqual([]);
    expect(heading.editor.getDoc()).toBe('Intro.\n\n# Head\n\nEnd.\n');

    const code = mount('```\nlet x;\n```\n');
    select(code.editor, 6);
    expect(code.editor.commands.run('block.code')).toBe(false);
    expect(code.refused).toEqual(['This is already a code block.']);

    const quoted = mount('> quoted text\n');
    select(quoted.editor, 4);
    expect(quoted.editor.commands.run('block.code')).toBe(false);
    expect(quoted.notices).toHaveLength(1);
  });
});

describe('blocks on an empty line (#167)', () => {
  const caretAt = (editor: Editor) => editor.view.state.selection.main.head;

  it.each([false, true])(
    'keeps a blank line on each side of a table, with the caret in its first cell (tracking %s)',
    (tracking) => {
      const { editor, notices, refused } = mount('One.\n\nTwo.\n', { tracking });
      select(editor, 5);
      expect(editor.commands.run('block.table')).toBe(true);
      expect(visible(editor)).toBe('One.\n\n|  |  |\n| --- | --- |\n|  |  |\n\nTwo.\n');
      expect(notices).toEqual([]);
      expect(refused).toEqual([]);
      // The header cells are empty, and the caret is in the first, so that typing names the column.
      const { from, to } = editor.view.state.selection.main;
      expect(from).toBe(to);
      expect(editor.view.state.sliceDoc(from - 2, from + 3)).toBe('|  | ');
      expect(caretAt(editor)).toBe(to);
    },
  );

  it.each([false, true])('keeps a blank line around a rule (tracking %s)', (tracking) => {
    const { editor, refused } = mount('One.\n\nTwo.\n', { tracking });
    select(editor, 5);
    expect(editor.commands.run('block.rule')).toBe(true);
    expect(visible(editor)).toBe('One.\n\n---\n\nTwo.\n');
    expect(refused).toEqual([]);
  });

  it.each([false, true])(
    'writes a rule under a paragraph with a blank line above it (tracking %s)',
    (tracking) => {
      // The line after Return at the end of a paragraph.
      const { editor, refused } = mount('One.\n', { tracking });
      select(editor, 5);
      expect(editor.commands.run('block.rule')).toBe(true);
      expect(refused).toEqual([]);
      expect(visible(editor)).toBe('One.\n\n---');
      expect(editor.getParsed().marks.every((mark) => mark.kind !== 'fmt')).toBe(true);
    },
  );

  it.each([false, true])('puts a code block on the line, caret on its empty line (%s)', (t) => {
    const { editor, refused, notices } = mount('One.\n\nTwo.\n', { tracking: t });
    select(editor, 5);
    expect(editor.commands.run('block.code')).toBe(true);
    // A tracked code block leaves its closer a line of its own, which shows as a blank one.
    expect(visible(editor)).toMatch(/^One\.\n\n```\n\n```\n\n{1,2}Two\.\n$/);
    expect(refused).toEqual([]);
    expect(notices).toEqual([]);
    expect(editor.view.state.sliceDoc(caretAt(editor) - 4, caretAt(editor))).toBe('```\n');
    expect(editor.view.state.sliceDoc(caretAt(editor), caretAt(editor) + 4)).toMatch(
      /^\n```|^<!--/,
    );
  });

  it.each([false, true])('takes a table right after a code block (tracking %s)', (tracking) => {
    const { editor, notices, refused } = mount('One.\n\n```\n\n```\n\nTwo.\n', { tracking });
    select(editor, editor.getDoc().indexOf('\n\nTwo.') + 1);
    expect(editor.commands.run('block.table')).toBe(true);
    expect(notices).toEqual([]);
    expect(refused).toEqual([]);
    expect(visible(editor)).toContain('```\n\n|  |  |\n| --- |');
    expect(visible(editor)).toContain('|  |  |\n\nTwo.');
  });

  it('adds no blank line where one is already there, at the end of a document', () => {
    const { editor } = mount('One.\n\n');
    select(editor, 6);
    editor.commands.run('block.rule');
    expect(editor.getDoc()).toBe('One.\n\n---');
  });

  it('keeps the marker of an empty item or quote line outside the fence', () => {
    const item = mount('- Write\n- [ ] ');
    select(item.editor, item.editor.getDoc().length);
    expect(item.editor.commands.run('block.code')).toBe(true);
    expect(item.editor.getDoc()).toBe('- Write\n- [ ] \n  ```\n  \n  ```');
    const quote = mount('> Quoted.\n> ');
    select(quote.editor, quote.editor.getDoc().length);
    expect(quote.editor.commands.run('block.code')).toBe(true);
    expect(quote.editor.getDoc()).toBe('> Quoted.\n> ```\n> \n> ```');
  });

  it('keeps the marker of an empty quote line outside the fence with Track Changes on too', () => {
    const { editor, refused, notices } = mount('> Quoted.\n> ', { tracking: true });
    select(editor, editor.getDoc().length);
    editor.commands.run('block.code');
    expect(refused.concat(notices)).toEqual([]);
    expect(visible(editor)).toMatch(/^> Quoted\.\n> ```\n> \n> ```\n/);
  });

  it('says what is in the way of an empty item, not that its Markdown is odd', () => {
    const { editor, notices, refused } = mount('- Write\n- \n', { tracking: true });
    select(editor, 10);
    expect(editor.commands.run('block.ol')).toBe(false);
    expect(notices.concat(refused)).toEqual([
      "Write the item first. An item with no text can't change type.",
    ]);
  });
});

describe('a block right under a heading, a thematic break or a closing fence (format rule 2)', () => {
  it.each([false, true])('changes its kind (tracking %s)', (tracking) => {
    for (const [doc, at, id, after] of [
      ['## Head\nText.\n', 10, 'block.h3', '## Head\n### Text.\n'],
      ['Intro.\n\n---\nText.\n', 14, 'block.quote', 'Intro.\n\n---\n> Text.\n'],
      ['```\ncode\n```\nText.\n', 18, 'block.ul', '```\ncode\n```\n- Text.\n'],
    ] as const) {
      const { editor, notices, refused } = mount(doc, { tracking });
      select(editor, at);
      expect(editor.commands.run(id), doc).toBe(true);
      expect(notices.concat(refused), doc).toEqual([]);
      expect(visible(editor).replace(/\n+$/, ''), doc).toBe(after.replace(/\n+$/, ''));
    }
  });
});

describe('the Paragraph menu on an empty paragraph (#170)', () => {
  const caretAt = (editor: Editor) => editor.view.state.selection.main.head;
  const SYNTAX = [
    ['block.h1', '# '],
    ['block.h2', '## '],
    ['block.h3', '### '],
    ['block.h4', '#### '],
    ['block.h5', '##### '],
    ['block.h6', '###### '],
    ['block.quote', '> '],
    ['block.ul', '- '],
    ['block.ol', '1. '],
    ['block.task', '- [ ] '],
  ] as const;

  it.each([false, true])(
    'writes the block syntax, the caret after it (tracking %s)',
    (tracking) => {
      for (const [id, syntax] of SYNTAX) {
        const { editor, refused, notices } = mount('One.\n\n\n\nTwo.\n', { tracking });
        select(editor, 6);
        expect(editor.commands.run(id), id).toBe(true);
        expect(visible(editor), id).toBe(`One.\n\n${syntax}\n\nTwo.\n`);
        expect(refused.concat(notices), id).toEqual([]);
        expect(
          editor.view.state.sliceDoc(caretAt(editor) - syntax.length, caretAt(editor)),
          id,
        ).toBe(syntax);
      }
    },
  );

  it.each([false, true])('keeps a blank line between the syntax and the text above (%s)', (t) => {
    const { editor, refused } = mount('One.\n', { tracking: t });
    select(editor, 5);
    expect(editor.commands.run('block.h2')).toBe(true);
    expect(visible(editor)).toBe('One.\n\n## ');
    expect(refused).toEqual([]);
  });

  it.each([false, true])('does nothing for Body (tracking %s)', (tracking) => {
    const { editor, refused, notices } = mount('One.\n\n\n\nTwo.\n', { tracking });
    select(editor, 6);
    const before = editor.getDoc();
    expect(editor.commands.run('block.body')).toBe(true);
    expect(editor.getDoc()).toBe(before);
    expect(refused.concat(notices)).toEqual([]);
  });

  it.each([false, true])('writes a closed code block, the caret inside (tracking %s)', (t) => {
    const { editor, refused } = mount('One.\n\n\n\nTwo.\n', { tracking: t });
    select(editor, 6);
    expect(editor.commands.run('block.code')).toBe(true);
    expect(refused).toEqual([]);
    expect(visible(editor)).toMatch(/^One\.\n\n```\n\n```\n\n{1,2}Two\.\n$/);
    expect(editor.view.state.sliceDoc(caretAt(editor) - 4, caretAt(editor))).toBe('```\n');
  });

  it.each([false, true])('writes a rule, and the table with the caret in its cell (%s)', (t) => {
    const rule = mount('One.\n\n\n\nTwo.\n', { tracking: t });
    select(rule.editor, 6);
    expect(rule.editor.commands.run('block.rule')).toBe(true);
    expect(visible(rule.editor)).toMatch(/^One\.\n\n---\n\n{1,2}Two\.\n$/);
    expect(rule.refused).toEqual([]);
    const table = mount('One.\n\n\n\nTwo.\n', { tracking: t });
    select(table.editor, 6);
    expect(table.editor.commands.run('block.table')).toBe(true);
    expect(visible(table.editor)).toContain('|  |  |\n| --- | --- |\n|  |  |');
    const { from, to } = table.editor.view.state.selection.main;
    expect(from).toBe(to);
  });

  it('changes the type of a block that has text, as before', () => {
    const { editor } = mount('One.\n\nSome text.\n');
    select(editor, 8);
    expect(editor.commands.run('block.h2')).toBe(true);
    expect(editor.getDoc()).toBe('One.\n\n## Some text.\n');
  });

  it('takes the empty quote it wrote away only when the person does', () => {
    const { editor } = mount('One.\n\n\n\nTwo.\n');
    select(editor, 6);
    editor.commands.run('block.quote');
    // The caret leaves: an empty quote is a block that stays, an empty paragraph goes.
    select(editor, 0);
    expect(editor.getDoc()).toContain('> ');
  });
});

describe('links', () => {
  it('opens a popover; Return applies, Esc cancels, and focus returns to the editor', () => {
    const { editor } = mount('One two three.\n');
    // happy-dom reports a selection change in the middle of an update when the view has the focus.
    const focus = vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
    select(editor, 4, 7);
    expect(editor.commands.run('format.link')).toBe(true);
    const field = document.querySelector<HTMLInputElement>('.rl-link-popover input')!;
    expect(field).not.toBeNull();
    field.value = 'https://example.com';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(editor.getDoc()).toBe('One [two](https://example.com) three.\n');
    expect(document.querySelector('.rl-link-popover')).toBeNull();
    expect(focus).toHaveBeenCalledTimes(1);

    select(editor, 11, 14);
    editor.commands.run('format.link');
    const again = document.querySelector<HTMLInputElement>('.rl-link-popover input')!;
    again.value = 'https://other.example';
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(focus).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.rl-link-popover')).toBeNull();
    expect(editor.getDoc()).toBe('One [two](https://example.com) three.\n');
  });

  it('shows the address of a link the caret is in, and an empty one removes it', () => {
    const { editor } = mount('One [two](https://example.com) three.\n');
    vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
    select(editor, 6);
    expect(editor.getUiState().activeCommands).toContain('format.link');
    editor.commands.run('format.link');
    const field = document.querySelector<HTMLInputElement>('.rl-link-popover input')!;
    expect(field.value).toBe('https://example.com');
    field.value = '';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(editor.getDoc()).toBe('One two three.\n');
  });
});

describe('link popover, keeping the address', () => {
  function opened() {
    const made = mount('One two three.\n');
    vi.spyOn(made.editor.view, 'focus').mockImplementation(() => {});
    select(made.editor, 4, 7);
    made.editor.commands.run('format.link');
    const field = document.querySelector<HTMLInputElement>('.rl-link-popover input')!;
    field.value = 'https://example.com';
    return { ...made, field };
  }

  it('stays open when the focus leaves it, and closes on a click outside', () => {
    const { field } = opened();
    const form = document.querySelector('.rl-link-popover')!;
    expect(form.getAttribute('tabindex')).toBe('-1');
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    window.dispatchEvent(new Event('blur'));
    expect(document.querySelector('.rl-link-popover')).not.toBeNull();
    expect(field.value).toBe('https://example.com');
    form.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.rl-link-popover')).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.rl-link-popover')).toBeNull();
  });

  it('does not apply on Return that ends a composition', () => {
    const { editor, field } = opened();
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }),
    );
    expect(document.querySelector('.rl-link-popover')).not.toBeNull();
    expect(editor.getDoc()).toBe('One two three.\n');
  });

  it('is closed by the function that takes the commands out', () => {
    const { remove } = opened();
    remove();
    expect(document.querySelector('.rl-link-popover')).toBeNull();
  });
});

describe('what formatting says when it does nothing', () => {
  it('says so for a selection of only a marker', () => {
    const doc = 'One <!--ins k3x9-->two<!--/k3x9--> three.\n';
    const { editor, refused } = mount(doc, { tracking: true });
    select(editor, 6, 14);
    expect(editor.commands.run('format.bold')).toBe(false);
    expect(refused).toHaveLength(1);
    expect(editor.getDoc()).toBe(doc);
  });

  it('says a list item cannot become a heading or a quote', () => {
    const { editor, refused } = mount('- One\n- Two\n');
    select(editor, 3);
    expect(editor.commands.run('block.h2')).toBe(false);
    expect(editor.commands.run('block.quote')).toBe(false);
    expect(refused).toEqual([
      "A list item can't be made into a heading. Take it out of the list first (Shift-Tab, or Backspace at the start of the item).",
      "A list item can't be made into a quote. Take it out of the list first (Shift-Tab, or Backspace at the start of the item).",
    ]);
    // The reasons are the hints of the grayed commands.
    expect(Object.keys(editor.getUiState().disabledReasons)).toEqual(
      expect.arrayContaining(['block.h2', 'block.quote']),
    );
  });
});

describe('registration', () => {
  it('registers every command of the table, once, and takes them out again', () => {
    const { editor, remove } = mount('x\n');
    const keys = Object.fromEntries(editor.commands.list().map((c) => [c.id, c.shortcut]));
    expect(keys).toEqual({
      'format.bold': 'Mod-b',
      'format.italic': 'Mod-i',
      'format.code': 'Ctrl-`',
      'format.strike': 'Ctrl-Shift-`',
      'format.sub': 'Mod-Alt-,',
      'format.sup': 'Mod-Alt-.',
      'format.link': 'Mod-k',
      'format.clear': 'Mod-\\',
      'block.body': 'Mod-Shift-n',
      'block.h1': 'Mod-1',
      'block.h2': 'Mod-2',
      'block.h3': 'Mod-3',
      'block.h4': 'Mod-4',
      'block.h5': 'Mod-5',
      'block.h6': 'Mod-6',
      'block.quote': 'Mod-Alt-q',
      'block.ul': 'Mod-Alt-u',
      'block.ol': 'Mod-Alt-o',
      'block.task': 'Mod-Alt-x',
      'block.check': 'Mod-Shift-u',
      'block.code': 'Mod-Alt-c',
      'block.table': 'Mod-Alt-t',
      'block.alert': undefined,
      'block.rule': undefined,
      'block.indent': 'Mod-]',
      'block.outdent': 'Mod-[',
    });
    remove();
    expect(editor.commands.list()).toEqual([]);
  });

  it("binds no command to Mod-0, which is the window zoom's Actual Size", () => {
    const { editor, remove } = mount('x\n');
    expect(editor.commands.list().map((c) => c.shortcut)).not.toContain('Mod-0');
    remove();
  });

  it('is a plugin that lists the same commands in its manifest', () => {
    const { editor } = mount('x\n');
    const ids = editor.commands.list().map((command) => command.id);
    expect(plugin.manifest.contributes?.commands?.map((command) => command.id)).toEqual(ids);
  });
});

describe('commands in a table', () => {
  const T = 'Intro.\n\n| a | b |\n| - | - |\n| one | two |\n\nAfter.\n';
  const BLOCKS = [
    'block.body',
    'block.h1',
    'block.h2',
    'block.h3',
    'block.h4',
    'block.h5',
    'block.h6',
    'block.quote',
    'block.ul',
    'block.ol',
    'block.task',
    'block.code',
    'block.table',
    'block.rule',
    'block.indent',
    'block.outdent',
  ];

  it('has no block command enabled with the caret in a cell, and all of them outside', () => {
    const { editor } = mount(T);
    select(editor, T.indexOf('one') + 1);
    const inside = editor.getUiState().enabledCommands;
    for (const id of BLOCKS) expect(inside, id).not.toContain(id);
    // The Format menu works on a cell's text.
    expect(inside).toContain('format.bold');
    select(editor, 3);
    const outside = editor.getUiState().enabledCommands;
    // Indent and Outdent are for a list item: outside one, in a paragraph, they are disabled too.
    for (const id of BLOCKS.filter((id) => !/indent|outdent/.test(id))) {
      expect(outside, id).toContain(id);
    }
    expect(editor.getUiState().disabledReasons['block.indent']).toBe(
      'Only a list item can be indented or outdented.',
    );
  });

  it('does nothing when a block command is run in a cell', () => {
    const { editor } = mount(T);
    select(editor, T.indexOf('one') + 1);
    expect(editor.commands.run('block.h1')).toBe(false);
    expect(editor.getDoc()).toBe(T);
  });

  it('bolds the text of a cell', () => {
    const { editor } = mount(T);
    select(editor, T.indexOf('one'), T.indexOf('one') + 3);
    expect(editor.commands.run('format.bold')).toBe(true);
    expect(editor.getDoc()).toContain('| **one** | two |');
  });

  it('leaves the caret in the first, empty header cell after Insert Table', () => {
    const { editor } = mount('One.\n\nTwo.\n');
    select(editor, 2);
    expect(editor.commands.run('block.table')).toBe(true);
    const { from, to } = editor.view.state.selection.main;
    expect(from).toBe(to);
    expect(editor.view.state.sliceDoc(from - 2, from + 3)).toBe('|  | ');
  });
});

describe('a selection that reaches out of verbatim text is still formatted (review of R6a)', () => {
  it('keeps Bold enabled for ⌘A in a document that starts with front matter or code', () => {
    for (const doc of ['---\ntitle: x\n---\n\nBody text.\n', '```\ncode\n```\n\nBody text.\n']) {
      const { editor } = mount(doc);
      select(editor, 0, doc.length);
      expect(editor.getUiState().disabledReasons['format.bold'], doc).toBeUndefined();
    }
  });

  it('keeps Bold enabled for a selection that starts inside a code span and ends after it', () => {
    const doc = 'Say `code here` now.\n';
    const { editor } = mount(doc);
    select(editor, doc.indexOf('here'), doc.indexOf('now') + 3);
    expect(editor.getUiState().disabledReasons['format.bold']).toBeUndefined();
  });

  it('keeps Indent enabled for a triple-clicked last list item', () => {
    const doc = '- aa\n- bb\n- cc\n';
    const { editor } = mount(doc);
    select(editor, doc.indexOf('- cc'), doc.length);
    expect(editor.getUiState().disabledReasons['block.indent']).toBeUndefined();
  });
});
