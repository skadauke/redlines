// @vitest-environment happy-dom
// Where an inserted block goes, and Quote, Callout and Code Block with a selection (#555).
import { forceParsing } from '@codemirror/language';
import { newestView } from '@redlines/format';
import { createEditor, type Editor, undo } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: { editor: Editor; remove: () => void }[] = [];

function mount(doc: string, tracking = false) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const notices: string[] = [];
  const editor = createEditor(parent, { doc, author, tracking, onNotice: (m) => notices.push(m) });
  mounted.push({
    editor,
    remove: createFormatting(editor, { author, notice: (message) => notices.push(message) }),
  });
  return { editor, notices };
}
afterEach(() => {
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

function select(editor: Editor, anchor: number, head = anchor): void {
  editor.view.dispatch({ selection: { anchor, head } });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
}
/** What a reader sees: the text with its changes read. */
const seen = (editor: Editor) => newestView(editor.getDoc()).text;
const at = (editor: Editor, text: string, plus = 0) => editor.getDoc().indexOf(text) + plus;

const DOC = 'First paragraph.\n\nSecond paragraph.\n\nThird.\n';

describe.each([false, true])('where an inserted block goes (tracking %s)', (tracking) => {
  const TABLE = /\| Column \| Column \|/;

  it('takes the place of an empty paragraph', () => {
    const { editor } = mount('One.\n\n\n\nTwo.\n', tracking);
    select(editor, 6);
    expect(editor.commands.run('insert.quote')).toBe(true);
    expect(seen(editor)).toMatch(/^One\.\n\n> Text\n+Two\.\n$/);
  });

  it('goes above a block when the caret is at its very start', () => {
    const { editor } = mount(DOC, tracking);
    select(editor, at(editor, 'Second'));
    expect(editor.commands.run('block.table')).toBe(true);
    const text = seen(editor);
    expect(text.indexOf('| Column')).toBeLessThan(text.indexOf('Second paragraph.'));
    expect(text.indexOf('| Column')).toBeGreaterThan(text.indexOf('First paragraph.'));
    expect(text).toMatch(TABLE);
  });

  it('goes above a heading when the caret is in front of its text', () => {
    const { editor, notices } = mount('Intro.\n\n# Title\n\nBody.\n', tracking);
    select(editor, at(editor, 'Title'));
    expect(editor.commands.run('block.alert'), notices.join('|')).toBe(true);
    const text = seen(editor);
    expect(text.indexOf('[!NOTE]')).toBeGreaterThan(text.indexOf('Intro.'));
    expect(text.indexOf('[!NOTE]')).toBeLessThan(text.indexOf('# Title'));
    expect(notices).toEqual([]);
  });

  it('goes above the first block of the document, where the format can write it', () => {
    const { editor, notices } = mount('# Title\n\nBody.\n', tracking);
    select(editor, 2);
    expect(editor.commands.run('block.alert')).toBe(true);
    const text = seen(editor);
    // With Track Changes on, an insertion can't end with line breaks in front of a heading: the
    // callout then goes below it, with no refusal.
    if (tracking) expect(text.indexOf('[!NOTE]')).toBeGreaterThan(text.indexOf('# Title'));
    else expect(text.indexOf('[!NOTE]')).toBeLessThan(text.indexOf('# Title'));
    expect(notices).toEqual([]);
  });

  it('goes below the block anywhere else, so that no sentence is split', () => {
    const { editor } = mount(DOC, tracking);
    select(editor, at(editor, 'Second paragraph.', 10));
    expect(editor.commands.run('insert.quote')).toBe(true);
    const text = seen(editor);
    expect(text).toContain('First paragraph.');
    expect(text).toContain('Second paragraph.');
    expect(text.indexOf('> Text')).toBeGreaterThan(text.indexOf('Second paragraph.'));
    expect(text.indexOf('> Text')).toBeLessThan(text.indexOf('Third.'));
  });

  it('puts a code block below a paragraph the caret is in, and undoes in one step', () => {
    const { editor } = mount(DOC, tracking);
    select(editor, at(editor, 'Second', 3));
    expect(editor.commands.run('block.code')).toBe(true);
    expect(seen(editor)).toMatch(/Second paragraph\.\n\n```\n\n```/);
    undo(editor.view);
    expect(editor.getDoc()).toBe(DOC);
  });

  it('leaves the text the caret was in as it was', () => {
    const { editor } = mount(DOC, tracking);
    select(editor, at(editor, 'Second paragraph.', 10));
    editor.commands.run('block.alert');
    expect(seen(editor)).toContain('Second paragraph.');
  });
});

describe.each([false, true])('with text selected (tracking %s)', (tracking) => {
  const TWO = 'Intro.\n\nOne sentence.\n\nAnother one.\n\nEnd.\n';
  const range = (editor: Editor) =>
    [at(editor, 'One sentence', 4), at(editor, 'Another', 5)] as const;

  it('wraps the selected blocks in a quote', () => {
    const { editor, notices } = mount(TWO, tracking);
    select(editor, ...range(editor));
    expect(editor.commands.run('insert.quote')).toBe(true);
    expect(notices).toEqual([]);
    expect(seen(editor)).toMatch(/Intro\.\n\n> One sentence\.\n>\n> Another one\.\n+End\.\n$/);
  });

  it('wraps the selected blocks in a callout', () => {
    const { editor, notices } = mount(TWO, tracking);
    select(editor, ...range(editor));
    expect(editor.commands.run('block.alert')).toBe(true);
    expect(notices).toEqual([]);
    expect(seen(editor)).toMatch(
      /Intro\.\n\n> \[!NOTE\]\n> One sentence\.\n>\n> Another one\.\n+End\.\n$/,
    );
  });

  it('wraps the selected blocks in a code block, which takes their text', () => {
    const { editor, notices } = mount(TWO, tracking);
    select(editor, ...range(editor));
    expect(editor.commands.run('block.code')).toBe(true);
    expect(notices).toEqual([]);
    expect(seen(editor)).toMatch(/Intro\.\n\n```\nOne sentence\.\n\nAnother one\.\n```\n+End\.\n$/);
  });

  it('undoes a wrap in one step', () => {
    const { editor } = mount(TWO, tracking);
    select(editor, ...range(editor));
    editor.commands.run('insert.quote');
    undo(editor.view);
    expect(editor.getDoc()).toBe(TWO);
  });

  it('inserts below, with no refusal, where the selection holds a table', () => {
    const doc = 'Intro.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nEnd.\n';
    const { editor, notices } = mount(doc, tracking);
    select(editor, at(editor, 'Intro', 2), at(editor, '| 1', 4));
    expect(editor.commands.run('insert.quote')).toBe(true);
    expect(notices).toEqual([]);
    const text = seen(editor);
    expect(text).toContain('| a | b |');
    expect(text.indexOf('> Text')).toBeGreaterThan(text.indexOf('| 1 | 2 |'));
  });

  it('inserts below, with no refusal, where the selection holds an image', () => {
    const doc = 'Intro.\n\n![An image](a.png)\n\nEnd.\n';
    const { editor, notices } = mount(doc, tracking);
    select(editor, at(editor, 'Intro', 2), at(editor, 'End', 1));
    expect(editor.commands.run('block.alert')).toBe(true);
    expect(notices).toEqual([]);
    expect(seen(editor)).toContain('![An image](a.png)');
    expect(seen(editor)).toContain('[!NOTE]');
  });
});

describe('the Quote of Insert', () => {
  it('names itself for what it does with the selection', () => {
    const { editor } = mount('One two.\n');
    const title = () => {
      const command = editor.commands.list().find((c) => c.id === 'insert.quote');
      return typeof command?.title === 'function' ? command.title(editor.view.state) : '';
    };
    select(editor, 2);
    expect(title()).toBe('Insert Quote');
    select(editor, 0, 3);
    expect(title()).toBe('Make Selection a Quote');
  });

  it('is not the Paragraph menu’s Quote, which changes the block', () => {
    const { editor } = mount('One two.\n');
    select(editor, 2);
    editor.commands.run('block.quote');
    expect(editor.getDoc()).toBe('> One two.\n');
  });
});
