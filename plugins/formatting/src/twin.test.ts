// @vitest-environment happy-dom
// HTML with a Markdown twin (#690): a command that changes a block's structure converts the HTML
// to its twin first, as one change; a substitution of the block with Track Changes on, whose card
// names the conversion; and, where the conversion isn't exact, the command is disabled with its
// reason.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { createEditor, type Editor } from '@redlines/editor';
import { newestView, originalView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const made: { editor: Editor; remove: () => void }[] = [];
const notices: string[] = [];

function mount(doc: string, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author,
    tracking,
    onNotice: (message) => notices.push(message),
  });
  made.push({
    editor,
    remove: createFormatting(editor, {
      author,
      notice: (message: string) => notices.push(message),
    }),
  });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  return editor;
}

afterEach(() => {
  notices.length = 0;
  for (const { editor, remove } of made.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

function caretIn(editor: Editor, needle: string): void {
  const at = editor.getDoc().indexOf(needle);
  editor.view.dispatch({ selection: { anchor: at + 1 } });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
}

const reason = (editor: Editor, id: string) => editor.getUiState().disabledReasons[id];

describe('an HTML heading', () => {
  it('is converted by a heading command, then the command acts on its twin', () => {
    const editor = mount('Intro.\n\n<h2>The title</h2>\n\nAfter.\n');
    caretIn(editor, 'The title');
    expect(reason(editor, 'block.h3')).toBeUndefined();
    expect(editor.commands.run('block.h3')).toBe(true);
    expect(editor.getDoc()).toBe('Intro.\n\n### The title\n\nAfter.\n');
  });

  it('is one step to undo for the conversion, and the command is another', () => {
    const editor = mount('<h2>Title</h2>\n');
    caretIn(editor, 'Title');
    expect(editor.commands.run('block.h1')).toBe(true);
    expect(editor.getDoc()).toBe('# Title\n');
    editor.commands.run('block.body');
    expect(editor.getDoc()).toBe('Title\n');
  });

  it('tracked: the conversion is a substitution of the whole block with a card that names it', () => {
    const editor = mount('Intro.\n\n<h2>The title</h2>\n\nAfter.\n', true);
    caretIn(editor, 'The title');
    expect(editor.commands.run('block.h3'), notices.join('|') + editor.getDoc()).toBe(true);
    const doc = editor.getDoc();
    // Accepting everything reads as the Markdown heading; rejecting reads as the HTML again.
    expect(newestView(doc).text).toContain('### The title');
    expect(originalView(doc).text).toBe('Intro.\n\n<h2>The title</h2>\n\nAfter.\n');
    const parsed = parse(doc);
    const notes = Object.values(parsed.ledger.marks).map((entry) => entry.note);
    expect(notes).toContain('Converted the <h2> heading to Markdown');
  });

  it('is disabled, with its reason, when the conversion would not be exact', () => {
    for (const html of [
      '<h2 align="center">Title</h2>',
      '<h2>*Not* emphasis</h2>',
      '<h2>Two\nlines</h2>',
    ]) {
      const editor = mount(`${html}\n`);
      caretIn(editor, 'Title'.slice(0, 1) === 'T' ? html.slice(4, 6) : html);
      const found = reason(editor, 'block.h3');
      expect(found, html).toMatch(/can't be changed as Markdown/);
      expect(editor.commands.run('block.h3')).toBe(false);
      expect(editor.getDoc()).toBe(`${html}\n`);
      expect(notices.at(-1)).toBe(found);
    }
  });

  it('leaves HTML that is not a twin to the command as it was', () => {
    const editor = mount('<img src="a.png">\n');
    caretIn(editor, 'img');
    expect(reason(editor, 'block.h3') ?? '').not.toMatch(/Markdown/);
  });
});

describe('an HTML list', () => {
  const LIST = '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>\n';

  it('Indent converts the list, then indents the item', () => {
    const editor = mount(LIST);
    caretIn(editor, 'two');
    expect(editor.commands.run('block.indent')).toBe(true);
    expect(editor.getDoc()).toBe('- one\n  - two\n');
  });

  it('Tab on the second item converts the list and indents it', () => {
    const editor = mount(LIST);
    caretIn(editor, 'two');
    const key = new KeyboardEvent('keydown', { key: 'Tab' });
    expect(runScopeHandlers(editor.view, key, 'editor')).toBe(true);
    expect(editor.getDoc()).toBe('- one\n  - two\n');
  });

  it('Tab on the first item does not convert it: there is nothing to go under', () => {
    const editor = mount(LIST);
    caretIn(editor, 'one');
    runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key: 'Tab' }), 'editor');
    expect(editor.getDoc()).not.toContain('- one');
  });

  it('is disabled when an item has a paragraph in it', () => {
    const editor = mount('<ul>\n  <li><p>one</p></li>\n</ul>\n');
    caretIn(editor, 'one');
    expect(reason(editor, 'block.indent')).toMatch(/can't be changed as Markdown/);
  });

  it('tracked: Indent is disabled before the click, with its reason, and nothing changes', () => {
    const editor = mount(LIST, true);
    caretIn(editor, 'two');
    expect(reason(editor, 'block.indent')).toMatch(/Turn Track Changes off/);
    expect(editor.commands.run('block.indent')).toBe(false);
    expect(editor.getDoc()).toBe(LIST);
  });
});

describe('an HTML quote', () => {
  it('is converted by a block command', () => {
    const editor = mount('<blockquote>Said so</blockquote>\n');
    caretIn(editor, 'Said');
    expect(editor.commands.run('block.quote')).toBe(true);
    expect(editor.getDoc()).toBe('Said so\n');
  });
});
