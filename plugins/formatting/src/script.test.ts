// @vitest-environment happy-dom
// Subscript and Superscript (#310): two commands of the Format menu, `format.sub` and `format.sup`,
// that write `<sub>` and `<sup>`, tracked as `+sub` and `+sup`. The palette runs them by id.

import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor, undo } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting, plugin } from './index.ts';

interface Mounted {
  editor: Editor;
  notices: string[];
  remove: () => void;
}

const mounted: Mounted[] = [];
const author = { handle: 'ada', name: 'Ada Lovelace' };

function mount(doc: string, options: { tracking?: boolean } = {}): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const notices: string[] = [];
  const editor = createEditor(parent, { doc, author, tracking: options.tracking ?? false });
  const result = {
    editor,
    notices,
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

function select(editor: Editor, anchor: number, head = anchor): void {
  editor.view.dispatch({ selection: { anchor, head } });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
}

const COMMANDS = [
  ['format.sub', 'Subscript', 'sub', 'Mod-Alt-,'],
  ['format.sup', 'Superscript', 'sup', 'Mod-Alt-.'],
] as const;

describe('Subscript and Superscript', () => {
  it('are commands of the Format menu with shortcuts that are not Word’s, which zoom has', () => {
    const { editor } = mount('One two three.\n');
    for (const [id, title, , shortcut] of COMMANDS) {
      const command = editor.commands.list().find((candidate) => candidate.id === id);
      expect(command, id).toMatchObject({ id, title, menu: 'format', group: 'text', shortcut });
    }
    const shortcuts = editor.commands.list().flatMap((command) => command.shortcut ?? []);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    // ⌘= and ⇧⌘= are Word's, and are View's Zoom In here.
    expect(shortcuts).not.toContain('Mod-=');
    expect(shortcuts).not.toContain('Mod-Shift-=');
  });

  it('are in the plugin manifest, for the palette', () => {
    const commands = plugin.manifest.contributes?.commands ?? [];
    for (const [id, title, , shortcut] of COMMANDS) {
      expect(commands, id).toContainEqual({ id, title, shortcut });
    }
  });

  it('write the tags around the word under the caret, or the selection', () => {
    for (const [id, , name] of COMMANDS) {
      const word = mount('One two three.\n');
      select(word.editor, 5);
      expect(word.editor.commands.run(id)).toBe(true);
      expect(word.editor.getDoc(), id).toBe(`One <${name}>two</${name}> three.\n`);

      const range = mount('One two three.\n');
      select(range.editor, 4, 13);
      expect(range.editor.commands.run(id)).toBe(true);
      expect(range.editor.getDoc(), id).toBe(`One <${name}>two three</${name}>.\n`);
    }
  });

  it('write a +sub or +sup format change with tracking on, and rejecting gives back the text', () => {
    for (const [id, , name] of COMMANDS) {
      const { editor } = mount('One two three.\n', { tracking: true });
      select(editor, 4, 7);
      expect(editor.commands.run(id)).toBe(true);
      expect(editor.getDoc(), id).toMatch(
        new RegExp(`<!--fmt \\w+ \\+${name}--><${name}>two</${name}><!--/\\w+-->`),
      );
      expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['fmt']);
    }
  });

  it('turn themselves off inside the text, as a tracked -sub or -sup with tracking on', () => {
    for (const [id, , name] of COMMANDS) {
      const off = mount(`One <${name}>two</${name}> three.\n`);
      select(off.editor, off.editor.getDoc().indexOf('two') + 1);
      expect(off.editor.commands.run(id)).toBe(true);
      expect(off.editor.getDoc(), id).toBe('One two three.\n');

      const tracked = mount(`One <${name}>two</${name}> three.\n`, { tracking: true });
      select(tracked.editor, tracked.editor.getDoc().indexOf('two') + 1);
      expect(tracked.editor.commands.run(id)).toBe(true);
      expect(tracked.editor.getDoc(), id).toMatch(
        new RegExp(`<!--fmt \\w+ -${name}-->two<!--/\\w+-->`),
      );
    }
  });

  it('show a check mark while the caret is inside, and only for that command', () => {
    const { editor } = mount('One <sub>two</sub> and <sup>three</sup>.\n');
    select(editor, editor.getDoc().indexOf('two') + 1);
    expect(editor.getUiState().activeCommands).toContain('format.sub');
    expect(editor.getUiState().activeCommands).not.toContain('format.sup');
    select(editor, editor.getDoc().indexOf('three') + 1);
    expect(editor.getUiState().activeCommands).toContain('format.sup');
    expect(editor.getUiState().activeCommands).not.toContain('format.sub');
    select(editor, 1);
    expect(editor.getUiState().activeCommands).not.toContain('format.sub');
  });

  it('undo in one step', () => {
    const { editor } = mount('One two three.\n', { tracking: true });
    select(editor, 4, 7);
    editor.commands.run('format.sub');
    undo(editor.view);
    expect(editor.getDoc()).toBe('One two three.\n');
  });

  it('are refused with a one-line notice inside code, and write nothing', () => {
    const { editor, notices } = mount('```\nsome code\n```\n', { tracking: true });
    select(editor, 8);
    expect(editor.commands.run('format.sup')).toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0]).not.toContain('\n');
    expect(editor.getDoc()).toBe('```\nsome code\n```\n');
  });

  it('work on the text of every selected cell of a table', () => {
    const doc = '| a | b |\n| - | - |\n| c | d |\n';
    const { editor } = mount(doc);
    select(editor, doc.indexOf('c'), doc.indexOf('d') + 1);
    // Both cells of the row are selected as a rectangle.
    expect(editor.commands.run('format.sub')).toBe(true);
    expect(editor.getDoc()).toContain('<sub>c</sub>');
  });

  it('are cleared by Clear Formatting', () => {
    const { editor } = mount('One <sub>two</sub> three.\n');
    select(editor, 4, 18);
    expect(editor.commands.run('format.clear')).toBe(true);
    expect(editor.getDoc()).toBe('One two three.\n');
  });

  it('say so, in a notice, where the pair the preview draws is no pair the format reads', () => {
    // The parse pairs the closing tag first and drops the star; the format's reader reads emphasis
    // first, and the pair crosses it: nothing can be taken off, which is never silent.
    for (const [id, name] of [
      ['format.sub', 'sub'],
      ['format.sup', 'sup'],
    ] as const) {
      const doc = `Plain <${name}>a *b</${name}> c* here.\n`;
      const { editor, notices } = mount(doc);
      select(editor, doc.indexOf('a *b') + 1);
      expect(editor.commands.run(id)).toBe(false);
      expect(editor.getDoc()).toBe(doc);
      expect(notices, id).toHaveLength(1);
      expect(notices[0]).toMatch(/tags/);
    }
  });

  it('say nothing of tags where a selection of white space has nothing to format', () => {
    const { editor, notices } = mount('One   two.\n');
    select(editor, 3, 6);
    expect(editor.commands.run('format.sub')).toBe(false);
    expect(notices).toEqual([]);
  });
});
