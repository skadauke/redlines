// @vitest-environment happy-dom
import { forceParsing, syntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEditor,
  type Editor,
  type EditorCommand,
  type EditorOptions,
  type EditorUiState,
} from './index.ts';

const mac = /Mac/.test(navigator.platform);

const mounted: { destroy(): void }[] = [];

function mount(options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: 'One two.\n',
    author: { handle: 'ada', name: 'Ada Lovelace' },
    ...options,
  });
  mounted.push(editor, { destroy: () => parent.remove() });
  return editor;
}

/** Adds an element to the page, and takes it out again after the test. */
function added<T extends HTMLElement>(element: T): T {
  document.body.append(element);
  mounted.push({ destroy: () => element.remove() });
  return element;
}

const command = (overrides: Partial<EditorCommand> = {}): EditorCommand => ({
  id: 'format.bold',
  title: 'Bold',
  run: () => true,
  ...overrides,
});

/** Presses a key in the editor, as the browser does. `Mod` is Cmd on a Mac and Ctrl elsewhere. */
function press(editor: Editor, key: string): KeyboardEvent {
  const parts = key.split('-');
  const event = new KeyboardEvent('keydown', {
    key: parts.pop(),
    ctrlKey: parts.includes('Mod') && !mac,
    metaKey: parts.includes('Mod') && mac,
    bubbles: true,
    cancelable: true,
  });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

const caretAt = (editor: Editor, anchor: number) => editor.view.dispatch({ selection: { anchor } });

afterEach(() => {
  for (const item of mounted.splice(0)) item.destroy();
});

describe('shortcuts', () => {
  it('binds a shortcut and runs once', () => {
    const editor = mount();
    const run = vi.fn(() => true);
    editor.commands.register([command({ shortcut: 'Mod-b', run })]);

    const event = press(editor, 'Mod-b');
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(editor);
    expect(event.defaultPrevented).toBe(true);
  });

  it('stays registered when another document opens', () => {
    const editor = mount();
    const run = vi.fn(() => true);
    editor.commands.register([command({ shortcut: 'Mod-b', run })]);

    editor.setDoc('Another document.\n');
    press(editor, 'Mod-b');
    expect(run).toHaveBeenCalledOnce();
    expect(editor.commands.list().map(({ id }) => id)).toEqual(['format.bold']);
  });

  it('keeps the key from the browser and the menu bar when the command did nothing', () => {
    // WebKit would make the text bold itself, and a key the page leaves alone goes on to the menu
    // bar, whose item would run the command a second time.
    const editor = mount();
    const run = vi.fn(() => false);
    editor.commands.register([command({ shortcut: 'Mod-b', run })]);

    expect(press(editor, 'Mod-b').defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it('leaves other keys alone, and a command without a shortcut has no key', () => {
    const editor = mount();
    const run = vi.fn(() => true);
    editor.commands.register([command({ run })]);
    expect(press(editor, 'Mod-b').defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not run a disabled command', () => {
    const editor = mount();
    const run = vi.fn(() => true);
    editor.commands.register([command({ shortcut: 'Mod-b', run, isEnabled: () => false })]);
    press(editor, 'Mod-b');
    expect(run).not.toHaveBeenCalled();
    expect(editor.commands.run('format.bold')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('keys the core binds too', () => {
  // CodeMirror's default keymap has these, and the formatting commands need them.
  const doc = '  One two.\n\nThree.\n';
  const outcomes: Partial<EditorCommand>[] = [
    { run: () => true },
    { run: () => false },
    { run: () => true, isEnabled: () => false },
  ];

  it.each(['Mod-i', 'Mod-]', 'Mod-['])('%s belongs to the command, whatever it does', (key) => {
    for (const outcome of outcomes) {
      const editor = mount({ doc });
      const run = vi.fn(outcome.run);
      editor.commands.register([command({ ...outcome, shortcut: key, run })]);
      caretAt(editor, 5);

      expect(press(editor, key).defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledTimes(outcome.isEnabled ? 0 : 1);
      expect(editor.getDoc()).toBe(doc);
      expect(editor.view.state.selection.main).toMatchObject({ anchor: 5, head: 5 });
    }
  });

  it('gives the key back when the command is taken out', () => {
    const editor = mount({ doc });
    const remove = editor.commands.register([command({ shortcut: 'Mod-]' })]);
    remove();
    press(editor, 'Mod-]');
    expect(editor.getDoc()).not.toBe(doc);
  });
});

describe('registering', () => {
  it('lists commands in the order they were registered', () => {
    const editor = mount();
    editor.commands.register([command({ id: 'a' }), command({ id: 'b' })]);
    editor.commands.register([command({ id: 'c' })]);
    expect(editor.commands.list().map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('takes commands and their keys out again', () => {
    const editor = mount();
    const run = vi.fn(() => true);
    const remove = editor.commands.register([
      command({ shortcut: 'Mod-b', run, isActive: () => true }),
    ]);
    const stays = command({ id: 'stays' });
    editor.commands.register([stays]);

    remove();
    expect(editor.commands.list()).toEqual([stays]);
    expect(editor.getUiState().activeCommands).toEqual([]);
    expect(editor.getUiState().enabledCommands).toEqual(['stays']);
    expect(press(editor, 'Mod-b').defaultPrevented).toBe(false);
    expect(editor.commands.run('format.bold')).toBe(false);
    expect(run).not.toHaveBeenCalled();

    // Taking them out again does nothing, also once the id is in use again.
    editor.commands.register([command({ shortcut: 'Mod-b', run })]);
    remove();
    press(editor, 'Mod-b');
    expect(run).toHaveBeenCalledOnce();
  });

  it('refuses an id that is taken, and registers none of that batch', () => {
    const editor = mount();
    editor.commands.register([command()]);
    expect(() => editor.commands.register([command({ id: 'new' }), command()])).toThrow(
      'format.bold',
    );
    expect(() => editor.commands.register([command({ id: 'x' }), command({ id: 'x' })])).toThrow(
      'x',
    );
    expect(editor.commands.list().map(({ id }) => id)).toEqual(['format.bold']);
  });
});

describe('shortcuts CodeMirror can’t read', () => {
  it('refuses a mistyped modifier, and registers none of that batch', () => {
    const editor = mount();
    expect(() =>
      editor.commands.register([command({ id: 'new' }), command({ shortcut: 'Cmnd-b' })]),
    ).toThrow('Cmnd');
    expect(editor.commands.list()).toEqual([]);
  });

  it('keeps the keyboard working after refusing one', () => {
    const editor = mount();
    expect(() => editor.commands.register([command({ shortcut: 'Cmnd-b' })])).toThrow();
    caretAt(editor, 0);
    expect(press(editor, 'ArrowRight').defaultPrevented).toBe(true);
    expect(editor.view.state.selection.main.head).toBe(1);
  });

  it('takes every notation CodeMirror reads', () => {
    const editor = mount();
    const shortcuts = [
      'Mod-b',
      'Ctrl-`',
      'Ctrl-Shift-`',
      'Mod-\\',
      'Mod-0',
      'Mod-Alt-q',
      'Mod-]',
      'Mod-[',
      'Mod-Shift-g',
      'Mod--',
      'Mod-=',
      'Cmd-Enter',
      'Meta-ArrowUp',
      'Control-Alt-x',
      'c-a-s-m-k',
      'SHIFT-mod-F1',
    ];
    editor.commands.register(
      shortcuts.map((shortcut) => command({ id: shortcut, shortcut, run: () => true })),
    );
    // CodeMirror builds its keymaps at the first key press, and throws there on what it can't read.
    expect(press(editor, 'ArrowRight').defaultPrevented).toBe(true);
    expect(press(editor, 'Mod-b').defaultPrevented).toBe(true);
  });
});

describe('the ui state', () => {
  it('reports active commands on a selection change', () => {
    const reports: EditorUiState[] = [];
    const editor = mount({ onUiState: (state) => reports.push(state) });
    editor.commands.register([
      command({ isActive: (state) => state.selection.main.head >= 4 }),
      command({ id: 'never', isActive: () => false }),
      command({ id: 'no-check' }),
    ]);
    expect(editor.getUiState().activeCommands).toEqual([]);

    caretAt(editor, 5);
    expect(reports.at(-1)?.activeCommands).toEqual(['format.bold']);
    expect(editor.getUiState().activeCommands).toEqual(['format.bold']);

    // Nothing to tell: the same command is still active.
    const told = reports.length;
    caretAt(editor, 6);
    expect(reports.length).toBe(told);

    caretAt(editor, 1);
    expect(reports.at(-1)?.activeCommands).toEqual([]);
  });

  it('reports enabled commands on a document change', () => {
    const reports: EditorUiState[] = [];
    const editor = mount({ onUiState: (state) => reports.push(state) });
    editor.commands.register([
      command({ isEnabled: (state) => state.doc.length > 20 }),
      command({ id: 'always' }),
    ]);
    expect(editor.getUiState().enabledCommands).toEqual(['always']);

    editor.view.dispatch({ changes: { from: 0, insert: 'A longer document. ' } });
    expect(reports.at(-1)?.enabledCommands).toEqual(['format.bold', 'always']);
  });

  it('reports what a background parse changes', () => {
    // A check mark reads the syntax tree, and a long document is parsed a little at a time, in
    // transactions that change neither the document nor the selection.
    const reports: EditorUiState[] = [];
    const editor = mount({
      doc: 'A paragraph of text.\n\n'.repeat(5000),
      onUiState: (state) => reports.push(state),
    });
    editor.commands.register([
      command({ isActive: (state) => syntaxTree(state).length === state.doc.length }),
    ]);
    expect(editor.getUiState().activeCommands).toEqual([]);

    expect(forceParsing(editor.view, editor.view.state.doc.length, 5000)).toBe(true);
    expect(reports.at(-1)?.activeCommands).toEqual(['format.bold']);
  });

  it('reports when commands come and go, and when another document opens', () => {
    const reports: EditorUiState[] = [];
    const editor = mount({ onUiState: (state) => reports.push(state) });
    const remove = editor.commands.register([
      command({ isActive: (state) => state.doc.toString().startsWith('Bold') }),
    ]);
    expect(reports.at(-1)?.enabledCommands).toEqual(['format.bold']);

    editor.setDoc('Bold document.\n');
    expect(reports.at(-1)?.activeCommands).toEqual(['format.bold']);

    remove();
    expect(reports.at(-1)).toMatchObject({ activeCommands: [], enabledCommands: [] });
  });
});

describe('running by id', () => {
  it('runs a command and says whether it did anything', () => {
    const editor = mount();
    const run = vi.fn(() => true);
    editor.commands.register([command({ run }), command({ id: 'nothing', run: () => false })]);
    expect(editor.commands.run('format.bold')).toBe(true);
    expect(run).toHaveBeenCalledWith(editor);
    expect(editor.commands.run('nothing')).toBe(false);
    expect(editor.commands.run('no.such.command')).toBe(false);
  });

  it('does not run from a menu while focus is in another field', () => {
    const editor = mount();
    const run = vi.fn(() => true);
    editor.commands.register([command({ run })]);

    const fields = [
      added(document.createElement('textarea')),
      added(document.createElement('input')),
      added(Object.assign(document.createElement('div'), { contentEditable: 'true' })),
    ];
    for (const field of fields) {
      field.focus();
      expect(document.activeElement).toBe(field);
      expect(editor.commands.run('format.bold')).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('counts a text field in the editor’s frame as another field, such as a comment box', () => {
    const editor = mount();
    const run = vi.fn(() => true);
    editor.commands.register([command({ run })]);

    const box = document.createElement('textarea');
    editor.view.dom.append(box);
    box.focus();
    expect(document.activeElement).toBe(box);
    expect(editor.commands.run('format.bold')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs from a menu while focus is in another field when the command says it can', () => {
    const editor = mount();
    const run = vi.fn(() => true);
    editor.commands.register([command({ run, runsInFields: true }), command({ id: 'other' })]);

    const field = added(document.createElement('input'));
    field.focus();
    expect(document.activeElement).toBe(field);
    expect(editor.commands.run('format.bold')).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(editor.commands.run('other')).toBe(false);
  });

  it('runs from a menu with focus in the editor, on a button or nowhere', () => {
    const editor = mount();
    const run = vi.fn(() => true);
    editor.commands.register([command({ run })]);

    editor.focus();
    expect(editor.commands.run('format.bold')).toBe(true);

    const button = added(document.createElement('button'));
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(editor.commands.run('format.bold')).toBe(true);

    const checkbox = added(Object.assign(document.createElement('input'), { type: 'checkbox' }));
    checkbox.focus();
    expect(document.activeElement).toBe(checkbox);
    expect(editor.commands.run('format.bold')).toBe(true);

    checkbox.blur();
    expect(editor.commands.run('format.bold')).toBe(true);
    expect(run).toHaveBeenCalledTimes(4);
  });
});
