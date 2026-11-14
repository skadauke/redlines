// @vitest-environment happy-dom
// Alerts (#311): the menu in an alert's title, and the Alert command. The menu is a block format
// change, tracked or plain; the command writes a new alert, which Track Changes records as an
// insertion, like a table or a code block.

import { forceParsing } from '@codemirror/language';
import { calloutMenuEffect, createEditor, type Editor, undo } from '@redlines/editor';
import { newestView } from '@redlines/format';
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

const ALERT = 'Intro.\n\n> [!NOTE]\n> Useful information.\n\nAfter.\n';

/** Presses the title's menu button of the first alert, as a click on it does. */
function openMenu(editor: Editor): HTMLElement {
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  const button = editor.view.dom.querySelector<HTMLElement>('button.rl-callout-menu');
  if (!button) throw new Error('no menu button: no alert drawn');
  button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  const popover = editor.view.dom.querySelector<HTMLElement>('.rl-callout-popover');
  if (!popover) throw new Error('no menu opened');
  return popover;
}

const items = (menu: HTMLElement) =>
  [...menu.querySelectorAll<HTMLElement>('.rl-callout-item')].map((item) => [
    item.dataset['type'],
    item.textContent,
    item.getAttribute('aria-checked'),
  ]);

describe('the menu in an alert’s title', () => {
  it('opens under the button with GitHub’s five types, the alert’s own checked', () => {
    const { editor } = mount(ALERT);
    const menu = openMenu(editor);
    expect(menu.getAttribute('role')).toBe('menu');
    expect(items(menu)).toEqual([
      ['note', '✓Note', 'true'],
      ['tip', 'Tip', 'false'],
      ['important', 'Important', 'false'],
      ['warning', 'Warning', 'false'],
      ['caution', 'Caution', 'false'],
    ]);
    // The focus is on the type the alert has.
    expect(document.activeElement).toBe(menu.querySelector('[data-type="note"]'));
  });

  it('offers another type only where the file has it already, the alert’s own included', () => {
    const doc = '> [!info]\n> One.\n\n> [!NOTE]\n> Two.\n\n> [!todo] A title\n> Three.\n';
    const { editor } = mount(doc);
    select(editor, doc.length);
    const menu = openMenu(editor);
    expect(items(menu).map(([type]) => type)).toEqual([
      'note',
      'tip',
      'important',
      'warning',
      'caution',
      'info',
      'todo',
    ]);
    expect(items(menu).find(([type]) => type === 'info')?.[2]).toBe('true');
    // A file with GitHub's types only offers those.
    const plain = mount(ALERT);
    expect(items(openMenu(plain.editor)).map(([type]) => type)).toHaveLength(5);
  });

  it('offers a type only where the file has it as an alert, not in code or a quote’s later lines', () => {
    const doc =
      '> [!NOTE]\n> One.\n\n```\n> [!ghost]\n```\n\n> Text\n> [!phantom]\n\n> [!info]\n> Two.\n\n- Item\n\n  > [!nested]\n  > Three.\n';
    const { editor } = mount(doc);
    expect(items(openMenu(editor)).map(([type]) => type)).toEqual([
      'note',
      'tip',
      'important',
      'warning',
      'caution',
      'info',
    ]);
  });

  it('is shut by a second press of its button, and tells a screen reader whether it is open', () => {
    const { editor } = mount(ALERT);
    const button = () => editor.view.dom.querySelector<HTMLElement>('button.rl-callout-menu')!;
    expect(button().getAttribute('aria-expanded')).toBe('false');
    openMenu(editor);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    // Pressing it again is not a close and a reopening: the menu is put away.
    button().dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(editor.view.dom.querySelector('.rl-callout-popover')).toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('false');
    // And a third press opens it again.
    button().dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(editor.view.dom.querySelector('.rl-callout-popover')).not.toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('true');
  });

  it('chooses a type, written plainly with Track Changes off, and one step to undo', () => {
    const { editor } = mount(ALERT);
    const menu = openMenu(editor);
    (menu.querySelector('[data-type="tip"]') as HTMLElement).click();
    expect(editor.getDoc()).toBe('Intro.\n\n> [!TIP]\n> Useful information.\n\nAfter.\n');
    expect(editor.getParsed().marks).toEqual([]);
    expect(editor.view.dom.querySelector('.rl-callout-popover')).toBeNull();
    undo(editor.view);
    expect(editor.getDoc()).toBe(ALERT);
  });

  it('chooses a type as a format change with Track Changes on: was=callout-note', () => {
    const { editor } = mount(ALERT, { tracking: true });
    const menu = openMenu(editor);
    (menu.querySelector('[data-type="warning"]') as HTMLElement).click();
    expect(editor.getDoc()).toMatch(
      /<!--fmt \w+ was=callout-note-->\n\n> \[!WARNING\]\n> Useful information\.<!--\/\w+-->/,
    );
    expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['fmt']);
    undo(editor.view);
    expect(editor.getDoc()).toBe(ALERT);
  });

  it('chooses the type the alert has: nothing changes', () => {
    const { editor } = mount(ALERT, { tracking: true });
    (openMenu(editor).querySelector('[data-type="note"]') as HTMLElement).click();
    expect(editor.getDoc()).toBe(ALERT);
  });

  it('moves with the arrows, chooses with Return and Space, and is put away by Esc', () => {
    const { editor } = mount(ALERT);
    let menu = openMenu(editor);
    const press = (key: string) =>
      (document.activeElement ?? menu).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    press('ArrowDown');
    expect(document.activeElement).toBe(menu.querySelector('[data-type="tip"]'));
    press('ArrowUp');
    press('ArrowUp');
    expect(document.activeElement).toBe(menu.querySelector('[data-type="caution"]'));
    press('Escape');
    expect(editor.view.dom.querySelector('.rl-callout-popover')).toBeNull();
    expect(editor.getDoc()).toBe(ALERT);
    menu = openMenu(editor);
    press('ArrowDown');
    // A button is chosen by Return and by Space, which the browser makes a click of.
    (document.activeElement as HTMLElement).click();
    expect(editor.getDoc()).toContain('[!TIP]');
  });

  it('is put away by a click elsewhere, and when the text changes', () => {
    const { editor } = mount(ALERT);
    openMenu(editor);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(editor.view.dom.querySelector('.rl-callout-popover')).toBeNull();
    const menu = openMenu(editor);
    editor.view.dispatch({ changes: { from: 0, to: 0, insert: 'X' } });
    // The menu was for text that is no longer there: it is put away by the change itself.
    expect(editor.view.dom.querySelector('.rl-callout-popover')).toBeNull();
    // And a click on a row it left behind changes nothing.
    (menu.querySelector('[data-type="tip"]') as HTMLElement).click();
    expect(editor.getDoc().startsWith('XIntro.')).toBe(true);
    expect(editor.getDoc()).toContain('[!NOTE]');
  });

  it('says why when the type can’t change here, and changes nothing', () => {
    const doc =
      'Intro.\n\n> [!NOTE]\n> Useful <!--ins k3x9-->new <!--/k3x9-->information.\n\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n  k3x9: {by: bo, at: 2026-10-13T22:30Z}\n-->\n';
    const { editor, notices } = mount(doc, { tracking: true });
    (openMenu(editor).querySelector('[data-type="tip"]') as HTMLElement).click();
    expect(editor.getDoc()).toBe(doc);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/Accept or reject/);
  });

  it('is asked for by the effect, and a request for a place with no alert is ignored', () => {
    const { editor } = mount(ALERT);
    const anchor = document.createElement('button');
    document.body.append(anchor);
    editor.view.dispatch({ effects: calloutMenuEffect.of({ pos: 0, type: 'note', anchor }) });
    expect(editor.view.dom.querySelector('.rl-callout-popover')).toBeNull();
    editor.view.dispatch({
      effects: calloutMenuEffect.of({ pos: ALERT.indexOf('NOTE') + 1, type: 'note', anchor }),
    });
    expect(editor.view.dom.querySelector('.rl-callout-popover')).not.toBeNull();
  });
});

describe('the Alert command', () => {
  it('is a command of the Paragraph menu, with the table and the code block, and no shortcut', () => {
    const { editor } = mount('One.\n');
    const command = editor.commands.list().find((candidate) => candidate.id === 'block.alert');
    expect(command).toMatchObject({
      id: 'block.alert',
      title: 'Alert',
      menu: 'paragraph',
      group: 'insert',
    });
    expect(command?.shortcut).toBeUndefined();
    expect(plugin.manifest.contributes?.commands).toContainEqual({
      id: 'block.alert',
      title: 'Alert',
    });
  });

  /** The text of the document as a reader sees it, without the markers of tracked changes. */
  const newest = (editor: Editor) => newestView(editor.getDoc()).text;

  it.each([false, true])(
    'writes an alert on an empty paragraph, its body’s text selected (tracking %s)',
    (tracking) => {
      const { editor, notices } = mount('One.\n\n', { tracking });
      select(editor, editor.getDoc().length);
      expect(editor.commands.run('block.alert')).toBe(true);
      expect(notices).toEqual([]);
      expect(newest(editor).startsWith('One.\n\n> [!NOTE]\n> Text')).toBe(true);
      const { from, to } = editor.view.state.selection.main;
      expect(editor.view.state.sliceDoc(from, to)).toBe('Text');
      if (tracking) {
        expect(editor.getParsed().marks.some((mark) => mark.kind === 'ins')).toBe(true);
        expect(editor.getParsed().marks.every((mark) => ['ins', 'split'].includes(mark.kind))).toBe(
          true,
        );
      } else {
        expect(editor.getParsed().marks).toEqual([]);
      }
    },
  );

  it.each([false, true])(
    'writes a new alert after the block the caret is in, with blank lines (tracking %s)',
    (tracking) => {
      const { editor, notices } = mount('One.\n\nTwo.\n', { tracking });
      select(editor, 2);
      expect(editor.commands.run('block.alert')).toBe(true);
      expect(notices).toEqual([]);
      expect(newest(editor)).toBe('One.\n\n> [!NOTE]\n> Text\n\nTwo.\n');
      const { from, to } = editor.view.state.selection.main;
      expect(editor.view.state.sliceDoc(from, to)).toBe('Text');
    },
  );

  it('writes the body where typing over the selected text puts it', () => {
    const { editor } = mount('One.\n');
    select(editor, 2);
    editor.commands.run('block.alert');
    editor.view.dispatch(editor.view.state.replaceSelection('Mind the gap.'));
    expect(editor.getDoc()).toBe('One.\n\n> [!NOTE]\n> Mind the gap.\n');
  });

  it('makes an alert whose type can be changed with no mark: it is your own new text', () => {
    const { editor, notices } = mount('One.\n\n', { tracking: true });
    select(editor, editor.getDoc().length);
    editor.commands.run('block.alert');
    editor.view.dispatch(editor.view.state.replaceSelection('Typed.'));
    const menu = openMenu(editor);
    (menu.querySelector('[data-type="important"]') as HTMLElement).click();
    expect(notices).toEqual([]);
    expect(editor.getParsed().marks.map((mark) => mark.kind)).not.toContain('fmt');
    expect(editor.getDoc()).toContain('[!IMPORTANT]');
    expect(editor.getDoc()).not.toContain('was=callout');
  });

  it.each([false, true])('undoes in one step (tracking %s)', (tracking) => {
    const { editor } = mount('One.\n', { tracking });
    select(editor, 2);
    editor.commands.run('block.alert');
    undo(editor.view);
    expect(editor.getDoc()).toBe('One.\n');
  });

  it('is not offered in a table’s cells, as the other blocks are not', () => {
    const doc = '| a | b |\n| - | - |\n| c | d |\n';
    const { editor } = mount(doc);
    select(editor, doc.indexOf('c'));
    expect(editor.getUiState().enabledCommands).not.toContain('block.alert');
  });
});
