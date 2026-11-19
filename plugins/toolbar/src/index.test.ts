// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import {
  createEditor,
  type Editor,
  type EditorCommand,
  type EditorOptions,
} from '@redlines/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar, type Toolbar, type ToolbarOptions, plugin } from './index.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: { editor: Editor; toolbar: Toolbar }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const { editor, toolbar } of mounted.splice(0)) {
    toolbar.destroy();
    editor.destroy();
  }
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.useRealTimers();
});

/** A command that records how often it ran. */
const command = (id: string, fields: Partial<EditorCommand> = {}): EditorCommand => ({
  id,
  title: id,
  run: () => true,
  ...fields,
});

const COMMANDS = [
  command('comment.add', { title: 'Add Comment', shortcut: 'Mod-Alt-m' }),
  command('block.table', { title: 'Table', shortcut: 'Mod-Alt-t' }),
  command('format.link', { title: 'Link…', shortcut: 'Mod-k' }),
  command('format.bold', { title: 'Bold', shortcut: 'Mod-b', isActive: () => false }),
  command('format.italic', { title: 'Italic', shortcut: 'Mod-i', isActive: () => false }),
  command('format.clear', { title: 'Clear Formatting', shortcut: 'Mod-\\' }),
];

interface Mount {
  editor: Editor;
  toolbar: Toolbar;
  notices: string[];
}

function mount(
  doc = 'Hello wrold there',
  options: Partial<ToolbarOptions> = {},
  commands: readonly EditorCommand[] = COMMANDS,
  editorOptions: Partial<EditorOptions> = {},
): Mount {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, ...editorOptions });
  editor.commands.register(commands);
  const notices: string[] = [];
  const toolbar = createToolbar(editor, {
    notice: (message) => notices.push(message),
    tooltipMs: 400,
    ...options,
  });
  mounted.push({ editor, toolbar });
  return { editor, toolbar, notices };
}

const panelOf = () => document.querySelector<HTMLElement>('.rl-toolbar');
const tipOf = () => document.querySelector<HTMLElement>('.rl-toolbar-tip');
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.rl-toolbar-item')];
const itemFor = (id: string) =>
  document.querySelector<HTMLButtonElement>(`.rl-toolbar-item[data-command="${id}"]`);
const tops = () => [...document.querySelectorAll<HTMLButtonElement>('.rl-toolbar-top')];
const words = () => [...document.querySelectorAll<HTMLButtonElement>('.rl-toolbar-word')];

function pointer(
  target: Element,
  type: string,
  init: PointerEventInit & { pointerType?: string } = {},
): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
  target.dispatchEvent(event);
}

function key(
  target: Element | Document,
  name: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * A right-click as WebKit sends it: the press, then the menu event, with the right button down at
 * the pointer.
 */
function rightClick(editor: Editor, init: MouseEventInit = {}): MouseEvent {
  const at = { clientX: 120, clientY: 90, ...init };
  const down = { bubbles: true, cancelable: true, button: 2, buttons: 2, ...at };
  editor.view.contentDOM.dispatchEvent(new MouseEvent('mousedown', down));
  const event = new MouseEvent('contextmenu', down);
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

/**
 * The menu key, or Ctrl-Return, as WebKit sends it (`sendContextMenuEventForKey`): the right button,
 * no button held, and no press before it.
 */
function menuKey(editor: Editor): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    buttons: 0,
    clientX: 5,
    clientY: 5,
  });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('no handle', () => {
  it('draws nothing at the bottom of the window; the toolbar is hidden until summoned', () => {
    mount();
    expect(document.querySelector('.rl-toolbar-handle')).toBeNull();
    expect(document.querySelector('.rl-toolbar-grip')).toBeNull();
    expect(panelOf()?.hidden).toBe(true);
  });

  it('puts away a toolbar that was summoned, when you go back to typing', () => {
    const { editor, toolbar } = mount();
    rightClick(editor);
    key(editor.view.contentDOM, 'a');
    expect(panelOf()?.hidden).toBe(true);
    toolbar.show();
    expect(panelOf()?.hidden).toBe(false);
  });
});

describe('the items', () => {
  it('are the commands of the registry, in menus, each with its name and keys', () => {
    mount();
    mounted.at(-1)?.toolbar.show();
    expect(buttons().map((button) => button.dataset['command'])).toEqual([
      'format.link',
      'block.table',
      'comment.add',
      'format.bold',
      'format.italic',
      'format.clear',
    ]);
    for (const button of buttons()) {
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.querySelector('.rl-toolbar-label')?.textContent).toBeTruthy();
    }
    expect(itemFor('format.link')?.getAttribute('aria-label')).toBe('Link');
    // What is said is what is drawn: the menu's word, not the command's title.
    expect(itemFor('comment.add')?.getAttribute('aria-label')).toBe('Comment');
    expect(itemFor('format.link')?.textContent).toBe('Link…⌘K');
    expect(itemFor('comment.add')?.querySelector('.rl-toolbar-label')?.textContent).toBe('Comment');
    expect(itemFor('format.bold')?.getAttribute('aria-keyshortcuts')).toBe('Meta+B');
  });

  it('are in a menu for each group, in the bar’s order, shut until a menu opens', () => {
    mount();
    mounted.at(-1)?.toolbar.show();
    expect(tops().map((top) => top.textContent)).toEqual(['Insert', 'Review', 'Format']);
    const menus = [...document.querySelectorAll<HTMLElement>('.rl-toolbar-menu')];
    expect(menus.map((menu) => menu.getAttribute('aria-label'))).toEqual([
      'Insert',
      'Review',
      'Format',
    ]);
    expect(menus.every((menu) => menu.hidden)).toBe(true);
    // No Ask here, so no rule after it.
    expect(document.querySelectorAll('.rl-toolbar-rule')).toHaveLength(0);
  });

  it('puts Ask first, with a rule after it, and the List menu only where a list can be made', () => {
    const { editor } = mount('Hello\n\n# Title\n', {}, [
      command('ask.start'),
      command('block.body'),
      command('block.ul'),
      command('format.bold'),
    ]);
    forceParsing(editor.view, editor.view.state.doc.length, 1000);
    editor.view.dispatch({ selection: { anchor: 2 } });
    mounted.at(-1)?.toolbar.show();
    expect(tops().map((top) => top.textContent)).toEqual(['Ask', 'List', 'Format']);
    expect(document.querySelectorAll('.rl-toolbar-rule')).toHaveLength(1);
  });

  it('opens a menu on a click, shows one at a time, and switches on hover', () => {
    mount();
    mounted.at(-1)?.toolbar.show();
    const [insert, review] = tops();
    const menu = (name: string) =>
      document.querySelector<HTMLElement>(`.rl-toolbar-menu[aria-label="${name}"]`)!;
    insert!.click();
    expect(menu('Insert').hidden).toBe(false);
    expect(insert!.getAttribute('aria-expanded')).toBe('true');
    expect(menu('Insert').querySelector('.rl-toolbar-menu-head')?.textContent).toBe('Insert');
    // Hovering from the open menu to another switches menus.
    pointer(review!, 'pointerenter');
    expect(menu('Insert').hidden).toBe(true);
    expect(menu('Review').hidden).toBe(false);
    // The same button again puts it away.
    review!.click();
    expect(menu('Review').hidden).toBe(true);
    // With none open, hovering opens nothing.
    pointer(insert!, 'pointerenter');
    expect(menu('Insert').hidden).toBe(true);
  });

  it('puts an open menu away on Esc first, with the keyboard on its button, and on a press outside', () => {
    const { editor, toolbar } = mount();
    editor.commands.run('toolbar.show');
    tops()[1]!.focus();
    key(tops()[1]!, 'ArrowDown');
    const open = document.querySelector<HTMLElement>('.rl-toolbar-menu:not([hidden])');
    expect(open?.getAttribute('aria-label')).toBe('Review');
    expect(document.activeElement).toBe(itemFor('comment.add'));
    key(itemFor('comment.add')!, 'Escape');
    expect(document.querySelector('.rl-toolbar-menu:not([hidden])')).toBeNull();
    expect(document.activeElement).toBe(tops()[1]);
    expect(toolbar.isOpen()).toBe(true);
    key(tops()[1]!, 'Escape');
    expect(toolbar.isOpen()).toBe(false);
    // A press in the text puts a menu away, though the toolbar stays docked.
    toolbar.toggle();
    tops()[0]!.click();
    pointer(editor.view.contentDOM, 'pointerdown');
    expect(document.querySelector('.rl-toolbar-menu:not([hidden])')).toBeNull();
    expect(toolbar.isOpen()).toBe(true);
  });

  it('shows an item once its command lands', () => {
    const { editor } = mount();
    mounted.at(-1)?.toolbar.show();
    expect(itemFor('format.sub')).toBeNull();
    mounted.at(-1)?.toolbar.show();
    editor.commands.register([command('format.sub', { title: 'Subscript' })]);
    mounted.at(-1)?.toolbar.show();
    expect(itemFor('format.sub')).not.toBeNull();
  });

  it('runs the command, puts the toolbar away and leaves the keyboard in the text', () => {
    const ran = vi.fn(() => true);
    const { editor } = mount('Hello', {}, [command('format.bold', { title: 'Bold', run: ran })]);
    mounted.at(-1)?.toolbar.show();
    itemFor('format.bold')?.click();
    expect(ran).toHaveBeenCalledTimes(1);
    expect(panelOf()?.hidden).toBe(true);
    expect(editor.view.hasFocus || document.activeElement === editor.view.contentDOM).toBe(true);
  });

  it('cancels a press on one, which is what keeps the text’s focus and selection', () => {
    mount();
    mounted.at(-1)?.toolbar.show();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    itemFor('format.bold')?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('disables the ones that cannot run, and marks a toggle that is on', () => {
    mount('Hello', {}, [
      command('format.bold', { isActive: () => true }),
      command('format.italic', { isActive: () => false, disabledReason: () => 'Not here.' }),
      command('format.clear'),
    ]);
    mounted.at(-1)?.toolbar.show();
    expect(itemFor('format.bold')?.getAttribute('aria-checked')).toBe('true');
    expect(itemFor('format.italic')?.getAttribute('aria-checked')).toBe('false');
    expect(itemFor('format.italic')?.getAttribute('aria-disabled')).toBe('true');
    expect(itemFor('format.bold')?.getAttribute('aria-disabled')).toBe('false');
    expect(itemFor('format.clear')?.hasAttribute('aria-checked')).toBe(false);
  });

  it('follows the selection while it is open', () => {
    let bold = false;
    const { editor } = mount('Hello world', {}, [command('format.bold', { isActive: () => bold })]);
    mounted.at(-1)?.toolbar.show();
    expect(itemFor('format.bold')?.getAttribute('aria-checked')).toBe('false');
    bold = true;
    editor.view.dispatch({ selection: { anchor: 2 } });
    expect(itemFor('format.bold')?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('the hint', () => {
  it('says why a grayed item can’t be used, after the title bar’s delay, and goes with the pointer', () => {
    mount('Hello', {}, [
      command('format.italic', { title: 'Italic', disabledReason: () => 'Not in code.' }),
    ]);
    mounted.at(-1)?.toolbar.show();
    const button = itemFor('format.italic')!;
    pointer(button, 'pointerenter');
    vi.advanceTimersByTime(399);
    expect(tipOf()?.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tipOf()?.hidden).toBe(false);
    expect(tipOf()?.textContent).toBe('Not in code.');
    pointer(button, 'pointerleave');
    expect(tipOf()?.hidden).toBe(true);
  });

  it('names the icons of a shared line and their keys, which the line doesn’t write', () => {
    mount('Hello', {}, [
      command('change.accept', { title: 'Accept', shortcut: 'Mod-Alt-y' }),
      command('change.reject', { title: 'Reject' }),
    ]);
    mounted.at(-1)?.toolbar.show();
    expect(document.querySelectorAll('.rl-toolbar-pair')).toHaveLength(1);
    expect(itemFor('change.accept')?.querySelector('.rl-toolbar-keys')).toBeNull();
    pointer(itemFor('change.accept')!, 'pointerenter');
    vi.advanceTimersByTime(400);
    expect(tipOf()?.textContent).toBe('Accept⌥⌘Y');
  });

  it('takes the delay it is given', () => {
    mount('Hello', { tooltipMs: 1000 }, [
      command('format.bold', { disabledReason: () => 'Not here.' }),
    ]);
    mounted.at(-1)?.toolbar.show();
    pointer(itemFor('format.bold')!, 'pointerenter');
    vi.advanceTimersByTime(999);
    expect(tipOf()?.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tipOf()?.hidden).toBe(false);
  });

  it('is not shown for a finger', () => {
    const { editor } = mount();
    rightClick(editor);
    pointer(itemFor('format.bold')!, 'pointerenter', { pointerType: 'touch' });
    vi.advanceTimersByTime(1000);
    expect(tipOf()?.hidden).toBe(true);
  });

  it('goes when the toolbar does', () => {
    mount();
    mounted.at(-1)?.toolbar.show();
    pointer(itemFor('format.bold')!, 'pointerenter');
    vi.advanceTimersByTime(400);
    key(document, 'Escape');
    expect(tipOf()?.hidden).toBe(true);
  });
});

describe('the right-click', () => {
  it('opens the toolbar in place of the browser’s menu', () => {
    const { editor } = mount();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    const event = rightClick(editor);
    expect(event.defaultPrevented).toBe(true);
    expect(panelOf()?.hidden).toBe(false);
    expect(panelOf()?.style.left).toBe('120px');
    expect(panelOf()?.style.top).toBe('90px');
  });

  it('leaves the browser’s menu for ⇧ and a right-click, which has Look Up and Services', () => {
    const { editor } = mount();
    const event = rightClick(editor, { shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(panelOf()?.hidden).toBe(true);
  });

  it('leaves the browser’s menu where the host asks for it', () => {
    const { editor } = mount('Hello', { contextMenu: false });
    expect(rightClick(editor).defaultPrevented).toBe(false);
    expect(panelOf()?.hidden).toBe(true);
  });

  it('selects the word under the pointer, as the Mac does, unless it is in the selection', () => {
    const { editor } = mount('Hello wrold there');
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    // happy-dom tells CodeMirror of every selection it writes into a focused page, in the middle
    // of the update that writes it: the keyboard stays out of the editor here.
    vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
    rightClick(editor);
    expect(editor.view.state.sliceDoc(...rangeOf(editor))).toBe('wrold');
    key(document, 'Escape');
    // Inside a selection: kept.
    editor.view.dispatch({ selection: { anchor: 0, head: 11 } });
    rightClick(editor);
    expect(editor.view.state.sliceDoc(...rangeOf(editor))).toBe('Hello wrold');
  });

  it('selects the whole of a word with an apostrophe in it, as the Mac does', () => {
    const { editor } = mount("I dosen't know");
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(4);
    vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
    rightClick(editor);
    expect(editor.view.state.sliceDoc(...rangeOf(editor))).toBe("dosen't");
  });

  it('puts the toolbar above the pointer where the window ends first', () => {
    const { editor } = mount();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    Object.defineProperty(panelOf()!, 'offsetHeight', { value: 150, configurable: true });
    Object.defineProperty(panelOf()!, 'offsetWidth', { value: 214, configurable: true });
    rightClick(editor, { clientX: 900, clientY: window.innerHeight - 20 });
    expect(parseFloat(panelOf()!.style.top)).toBe(window.innerHeight - 20 - 150);
    expect(parseFloat(panelOf()!.style.left)).toBeLessThanOrEqual(window.innerWidth - 214 - 8);
  });

  it('opens below the caret with the keyboard in it, for the menu key', () => {
    const { editor } = mount();
    editor.view.dispatch({ selection: { anchor: 3 } });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      left: 100,
      right: 101,
      top: 200,
      bottom: 220,
    });
    const event = menuKey(editor);
    expect(event.defaultPrevented).toBe(true);
    expect(panelOf()?.hidden).toBe(false);
    expect(document.activeElement).toBe(tops()[0]);
    // Under the caret, not at the pointer the event carries (5, 5): the panel has no size here.
    expect(panelOf()?.style.left).toBe('100px');
    expect(panelOf()?.style.top).toBe(`${220 + 8}px`);
  });

  it('takes a right-click for the pointer’s though the buttons it reads are let go already', () => {
    // A quick tap: the hardware has no button down by the time the event is made.
    const { editor } = mount();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    const at = { bubbles: true, cancelable: true, button: 2, clientX: 140, clientY: 70 };
    editor.view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { ...at, buttons: 2 }));
    editor.view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { ...at, buttons: 0 }));
    expect(panelOf()?.hidden).toBe(false);
    expect(panelOf()?.style.left).toBe('140px');
    expect(panelOf()?.style.top).toBe('70px');
    // The pointer's toolbar doesn't take the keyboard.
    expect(document.activeElement).not.toBe(buttons()[0]);
  });

  it('takes a menu event far from the last press for the key’s', () => {
    const { editor } = mount();
    editor.view.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 2,
        buttons: 2,
        clientX: 10,
        clientY: 10,
      }),
    );
    editor.view.contentDOM.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 0,
        clientX: 400,
        clientY: 300,
      }),
    );
    expect(document.activeElement).toBe(tops()[0]);
  });

  it('puts itself away on Esc, and gives the keyboard back to the text', () => {
    const { editor } = mount();
    menuKey(editor);
    key(tops()[0]!, 'Escape');
    expect(panelOf()?.hidden).toBe(true);
    expect(document.activeElement).toBe(editor.view.contentDOM);
  });

  it('puts itself away on a press elsewhere and on a scroll of the text', () => {
    const { editor } = mount();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    pointer(document.body, 'pointerdown');
    expect(panelOf()?.hidden).toBe(true);
    rightClick(editor);
    editor.view.scrollDOM.dispatchEvent(new Event('scroll'));
    expect(panelOf()?.hidden).toBe(true);
  });

  it('opens again for the next right-click, and shows only one toolbar', () => {
    const { editor } = mount();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor, { clientX: 10, clientY: 10 });
    rightClick(editor, { clientX: 200, clientY: 100 });
    expect(document.querySelectorAll('.rl-toolbar')).toHaveLength(1);
    expect(panelOf()?.style.left).toBe('200px');
  });
});

/** The main selection's range, for `sliceDoc`. */
function rangeOf(editor: Editor): [number, number] {
  const { from, to } = editor.view.state.selection.main;
  return [from, to];
}

describe('where the toolbar goes', () => {
  it('stays in the window for a caret that is scrolled out of it', () => {
    const { editor } = mount();
    Object.defineProperty(panelOf()!, 'offsetHeight', { value: 160, configurable: true });
    Object.defineProperty(panelOf()!, 'offsetWidth', { value: 214, configurable: true });
    // Far below the window, where CodeMirror still draws a margin of lines.
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      left: 100,
      right: 110,
      top: window.innerHeight + 300,
      bottom: window.innerHeight + 320,
    });
    editor.commands.run('toolbar.show');
    const top = parseFloat(panelOf()!.style.top);
    expect(top).toBeLessThanOrEqual(window.innerHeight - 160 - 8);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it('stays in the window for a right-click below it', () => {
    const { editor } = mount();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    Object.defineProperty(panelOf()!, 'offsetHeight', { value: 160, configurable: true });
    rightClick(editor, { clientY: window.innerHeight + 500 });
    expect(parseFloat(panelOf()!.style.top)).toBeLessThanOrEqual(window.innerHeight - 160 - 8);
  });
});

describe('what the page’s other boxes keep', () => {
  it('leaves Esc to a text box that has the keyboard', () => {
    const { toolbar } = mount();
    const box = document.createElement('textarea');
    document.body.append(box);
    mounted.at(-1)?.toolbar.show();
    box.focus();
    const event = key(box, 'Escape');
    expect(event.defaultPrevented).toBe(false);
    expect(toolbar.isOpen()).toBe(true);
  });

  it('puts the keyboard in the text for a choice made in the toolbar, whoever had it', () => {
    const ran = vi.fn(() => true);
    const { editor } = mount('Hello', {}, [command('format.bold', { run: ran })]);
    const box = document.createElement('textarea');
    document.body.append(box);
    box.focus();
    mounted.at(-1)?.toolbar.show();
    itemFor('format.bold')?.click();
    // The command ran, which the registry does not for a keyboard left in another box.
    expect(ran).toHaveBeenCalledTimes(1);
    expect(editor.view.hasFocus || document.activeElement === editor.view.contentDOM).toBe(true);
  });

  it('cancels a press on the padding of the toolbar, as on an item', () => {
    mount();
    mounted.at(-1)?.toolbar.show();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    panelOf()?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });
});

describe('spelling suggestions', () => {
  const spelling = (answer: readonly string[] | null, extra: object = {}) => ({
    enabled: () => true,
    suggest: vi.fn(() => Promise.resolve(answer)),
    ...extra,
  });

  it('shows the suggestions at the top of a toolbar opened on a misspelled word', async () => {
    const options = spelling(['world', 'word'], { learn: vi.fn() });
    const { editor } = mount('Hello wrold there', { spelling: options });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await settle();
    expect(options.suggest).toHaveBeenCalledWith('wrold', 'Hello ');
    expect(words().map((word) => word.textContent)).toEqual(['world', 'word', 'Learn Spelling']);
    // They come before the items.
    const first = panelOf()?.firstElementChild;
    expect(first?.classList.contains('rl-toolbar-spelling')).toBe(true);
  });

  it('makes the suggestion that is picked, and puts the toolbar away', async () => {
    const { editor } = mount('Hello wrold there', { spelling: spelling(['world']) });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    const focus = vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
    rightClick(editor);
    await settle();
    words()[0]?.click();
    expect(focus).toHaveBeenCalled();
    expect(editor.view.state.doc.toString()).toBe('Hello world there');
    expect(editor.view.state.selection.main.head).toBe(11);
    expect(panelOf()?.hidden).toBe(true);
  });

  it('makes a pick a tracked change while Track Changes is on, as typing it would', async () => {
    const { editor } = mount('Hello wrold there', { spelling: spelling(['world']) }, COMMANDS, {
      tracking: true,
    });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
    rightClick(editor);
    await settle();
    words()[0]?.click();
    // The text that was there stays in the file, and the change is the author's, as typing over
    // the word would make it.
    const marks = editor.getParsed().marks;
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((mark) => mark.entry.by === 'ada')).toBe(true);
    expect(marks.some((mark) => mark.kind === 'sub' || mark.kind === 'del')).toBe(true);
    expect(editor.view.state.doc.toString()).not.toBe('Hello world there');
  });

  it('learns the word on Learn Spelling', async () => {
    const learn = vi.fn();
    const { editor } = mount('Hello wrold there', { spelling: spelling(['world'], { learn }) });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await settle();
    words()
      .find((word) => word.textContent === 'Learn Spelling')
      ?.click();
    expect(learn).toHaveBeenCalledWith('wrold');
    expect(editor.view.state.doc.toString()).toBe('Hello wrold there');
  });

  it('offers no Learn Spelling where the host has no dictionary to add to', async () => {
    const { editor } = mount('Hello wrold there', { spelling: spelling(['world']) });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await settle();
    expect(words().map((word) => word.textContent)).toEqual(['world']);
  });

  it('says so for a misspelled word the checker has no guess for', async () => {
    const { editor } = mount('Hello wrold there', { spelling: spelling([], { learn: vi.fn() }) });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await settle();
    expect(words().map((word) => [word.textContent, word.disabled])).toEqual([
      ['No Guesses Found', true],
      ['Learn Spelling', false],
    ]);
  });

  it('shows nothing for a word that is spelled right', async () => {
    const { editor } = mount('Hello wrold there', { spelling: spelling(null) });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await settle();
    expect(words()).toEqual([]);
    expect(panelOf()?.hidden).toBe(false);
  });

  it('asks nobody while spell check is off, or about what is no word', async () => {
    const off = spelling(['world'], { enabled: () => false });
    const { editor } = mount('Hello wrold there', { spelling: off });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await settle();
    expect(off.suggest).not.toHaveBeenCalled();
    expect(words()).toEqual([]);
  });

  it('opens without the suggestions when they are slow, and takes them in when they come', async () => {
    let answer: (suggestions: readonly string[]) => void = () => {};
    const slow = {
      enabled: () => true,
      suggest: () => new Promise<readonly string[]>((resolve) => (answer = resolve)),
    };
    const { editor } = mount('Hello wrold there', { spelling: slow });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await vi.advanceTimersByTimeAsync(120);
    expect(panelOf()?.hidden).toBe(false);
    expect(words()).toEqual([]);
    answer(['world']);
    await settle();
    expect(words().map((word) => word.textContent)).toEqual(['world']);
  });

  it('keeps the keyboard in the toolbar when the suggestions come late', async () => {
    let answer: (suggestions: readonly string[]) => void = () => {};
    const slow = {
      enabled: () => true,
      suggest: () => new Promise<readonly string[]>((resolve) => (answer = resolve)),
    };
    const { editor } = mount('Hello wrold there', { spelling: slow });
    editor.view.dispatch({ selection: { anchor: 8 } });
    menuKey(editor);
    await vi.advanceTimersByTimeAsync(120);
    const before = document.activeElement;
    expect(before).toBe(tops()[0]);
    answer(['world']);
    await settle();
    // The panel was drawn again, and the keyboard is in it, on the first suggestion.
    expect(document.activeElement).toBe(words()[0]);
    expect(tipOf()?.hidden).toBe(true);
  });

  it('does nothing for a late suggestion when the text moved before it came', async () => {
    let answer: (suggestions: readonly string[]) => void = () => {};
    const slow = {
      enabled: () => true,
      suggest: () => new Promise<readonly string[]>((resolve) => (answer = resolve)),
    };
    const { editor } = mount('Hello wrold there', { spelling: slow });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
    rightClick(editor);
    await vi.advanceTimersByTimeAsync(120);
    // The text moves while the checker thinks: the word is no longer where it was found.
    editor.view.dispatch({ changes: { from: 0, insert: 'Oh. ' } });
    answer(['world']);
    await settle();
    // The answer is for a word that is somewhere else now: no rows are drawn for it.
    expect(words()).toEqual([]);
    expect(editor.view.state.doc.toString()).toBe('Oh. Hello wrold there');
  });

  it('drops an answer that comes after the toolbar went away', async () => {
    let answer: (suggestions: readonly string[]) => void = () => {};
    const slow = {
      enabled: () => true,
      suggest: () => new Promise<readonly string[]>((resolve) => (answer = resolve)),
    };
    const { editor } = mount('Hello wrold there', { spelling: slow });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await vi.advanceTimersByTimeAsync(120);
    key(document, 'Escape');
    answer(['world']);
    await settle();
    expect(panelOf()?.hidden).toBe(true);
    expect(words()).toEqual([]);
  });

  it('takes the suggestions away when the text moves under them', async () => {
    const { editor } = mount('Hello wrold there', { spelling: spelling(['world']) });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await settle();
    expect(words()).toHaveLength(1);
    editor.view.dispatch({ changes: { from: 0, insert: 'Oh. ' } });
    // Rows that would do nothing are not left in the toolbar, and the items stay.
    expect(words()).toEqual([]);
    expect(buttons().length).toBeGreaterThan(0);
    expect(panelOf()?.hidden).toBe(false);
    expect(editor.view.state.doc.toString()).toBe('Oh. Hello wrold there');
  });

  it('keeps the keyboard in the toolbar when the suggestions go', async () => {
    const { editor } = mount('Hello wrold there', { spelling: spelling(['world']) });
    editor.view.dispatch({ selection: { anchor: 8 } });
    menuKey(editor);
    await settle();
    expect(document.activeElement).toBe(words()[0]);
    editor.view.dispatch({ changes: { from: 0, insert: 'Oh. ' } });
    expect(words()).toEqual([]);
    expect(document.activeElement).toBe(tops()[0]);
  });

  it('keeps the arrows among the suggestions and the items', async () => {
    const { editor } = mount('Hello wrold there', { spelling: spelling(['world', 'word']) });
    menuKey(editor);
    await settle();
    // From the keyboard: the focus is in the first row, the first suggestion.
    expect(document.activeElement).toBe(words()[0]);
    key(words()[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(words()[1]);
    key(words()[1]!, 'ArrowDown');
    expect(document.activeElement).toBe(tops()[0]);
  });
});

describe('from the keyboard', () => {
  it('opens with Show Toolbar, below the caret, with the keyboard in it', () => {
    const { editor, toolbar } = mount();
    expect(editor.commands.run('toolbar.show')).toBe(true);
    expect(toolbar.isOpen()).toBe(true);
    expect(document.activeElement).toBe(tops()[0]);
    // The command has a key and a menu.
    const shown = editor.commands.list().find(({ id }) => id === 'toolbar.show');
    expect(shown?.shortcut).toBe('Mod-Shift-p');
    expect(shown?.menu).toBe('view');
  });

  it('puts itself away when the command runs again', () => {
    const { editor, toolbar } = mount();
    editor.commands.run('toolbar.show');
    editor.commands.run('toolbar.show');
    expect(toolbar.isOpen()).toBe(false);
  });

  it('moves with the arrow keys along its bar, and Home and End to the ends', () => {
    const { editor } = mount();
    editor.commands.run('toolbar.show');
    const [insert, review, format] = tops();
    key(insert!, 'ArrowRight');
    expect(document.activeElement).toBe(review);
    key(review!, 'ArrowRight');
    expect(document.activeElement).toBe(format);
    key(format!, 'ArrowLeft');
    expect(document.activeElement).toBe(review);
    key(review!, 'Home');
    expect(document.activeElement).toBe(insert);
    key(insert!, 'End');
    expect(document.activeElement).toBe(format);
    key(format!, 'ArrowRight');
    expect(document.activeElement).toBe(insert);
  });

  it('opens a menu on ↓, moves by line in it, and switches menus past a line’s end', () => {
    const { editor } = mount();
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(itemFor('format.link'));
    key(itemFor('format.link')!, 'ArrowDown');
    expect(document.activeElement).toBe(itemFor('block.table'));
    key(itemFor('block.table')!, 'ArrowUp');
    key(itemFor('format.link')!, 'ArrowRight');
    // Past the end of Insert's line: Review, which opens.
    expect(document.activeElement).toBe(itemFor('comment.add'));
    expect(
      document.querySelector('.rl-toolbar-menu:not([hidden])')?.getAttribute('aria-label'),
    ).toBe('Review');
    key(itemFor('comment.add')!, 'ArrowLeft');
    expect(document.activeElement).toBe(itemFor('format.link'));
  });

  it('puts itself away on Esc and on Tab, and gives the keyboard back to the text', () => {
    const { editor, toolbar } = mount();
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'Escape');
    expect(toolbar.isOpen()).toBe(false);
    expect(document.activeElement).toBe(editor.view.contentDOM);
    editor.commands.run('toolbar.show');
    key(tops()[1]!, 'Tab');
    expect(toolbar.isOpen()).toBe(false);
    expect(document.activeElement).toBe(editor.view.contentDOM);
  });

  it('presses the item the keyboard is on', () => {
    const ran = vi.fn(() => true);
    const { editor } = mount('Hello', {}, [command('format.bold', { run: ran })]);
    editor.commands.run('toolbar.show');
    buttons()[0]?.click();
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('keeps a grayed item in reach of the keys, so that its hint can say why', () => {
    const { editor } = mount('Hello', {}, [
      command('format.bold', { disabledReason: () => 'Not here.' }),
      command('format.italic'),
    ]);
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(itemFor('format.bold'));
    vi.advanceTimersByTime(400);
    expect(tipOf()?.textContent).toBe('Not here.');
    // And it does nothing when pressed.
    itemFor('format.bold')?.click();
    expect(panelOf()?.hidden).toBe(false);
  });
});

describe('Cut, Copy and Paste', () => {
  const clipboard = () => ({
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(() => Promise.resolve()),
  });

  it('are the toolbar’s own commands, and appear with a clipboard', () => {
    const none = mount('Hello');
    expect(none.editor.commands.list().some(({ id }) => id === 'edit.paste')).toBe(false);
    const { editor } = mount('Hello', { clipboard: clipboard() });
    const ids = editor.commands.list().map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining(['edit.cut', 'edit.copy', 'edit.paste']));
    // They are in no menu and bind no key: ⌘X, ⌘C and ⌘V are the system's.
    for (const command of editor.commands.list().filter(({ id }) => id.startsWith('edit.'))) {
      expect(command.menu).toBeUndefined();
      expect(command.shortcut).toBeUndefined();
    }
  });

  it('show the system’s keys', () => {
    mount('Hello', { clipboard: clipboard() });
    mounted.at(-1)?.toolbar.show();
    expect(itemFor('edit.copy')?.querySelector('.rl-toolbar-keys')?.textContent).toBe('⌘C');
    expect(itemFor('edit.cut')?.querySelector('.rl-toolbar-keys')?.textContent).toBe('⌘X');
    expect(itemFor('edit.paste')?.querySelector('.rl-toolbar-keys')?.textContent).toBe('⌘V');
  });

  it('cut and copy need a selection', () => {
    const { editor } = mount('Hello world', { clipboard: clipboard() });
    mounted.at(-1)?.toolbar.show();
    expect(itemFor('edit.cut')?.getAttribute('aria-disabled')).toBe('true');
    expect(itemFor('edit.copy')?.getAttribute('aria-disabled')).toBe('true');
    expect(itemFor('edit.paste')?.getAttribute('aria-disabled')).toBe('false');
    editor.view.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(itemFor('edit.cut')?.getAttribute('aria-disabled')).toBe('false');
    expect(itemFor('edit.copy')?.getAttribute('aria-disabled')).toBe('false');
  });

  it('go through the host’s clipboard', () => {
    const board = clipboard();
    const { editor } = mount('Hello world', { clipboard: board });
    editor.view.dispatch({ selection: { anchor: 0, head: 5 } });
    mounted.at(-1)?.toolbar.show();
    itemFor('edit.copy')?.click();
    expect(board.copy).toHaveBeenCalledTimes(1);
    mounted.at(-1)?.toolbar.show();
    itemFor('edit.cut')?.click();
    expect(board.cut).toHaveBeenCalledTimes(1);
    mounted.at(-1)?.toolbar.show();
    itemFor('edit.paste')?.click();
    expect(board.paste).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['is empty', 'empty'],
    ['cannot be read', 'denied'],
  ])('say so when the clipboard %s', async (_what, reason) => {
    const board = { ...clipboard(), paste: vi.fn(() => Promise.reject(new Error(reason))) };
    const { editor, notices } = mount('Hello', { clipboard: board });
    editor.commands.run('edit.paste');
    await settle();
    expect(notices).toEqual(['The clipboard has no text to paste.']);
  });

  it('say so when the page will not cut', () => {
    const board = {
      ...clipboard(),
      cut: vi.fn(() => {
        throw new Error('no');
      }),
    };
    const { editor, notices } = mount('Hello world', { clipboard: board });
    editor.view.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(editor.commands.run('edit.cut')).toBe(false);
    expect(notices).toEqual(['Couldn’t cut.']);
  });
});

describe('taking it out', () => {
  it('removes the toolbar, the hint and the commands', () => {
    const { editor, toolbar } = mount('Hello', { clipboard: { cut() {}, copy() {}, paste() {} } });
    mounted.at(-1)?.toolbar.show();
    toolbar.destroy();
    expect(panelOf()).toBeNull();
    expect(tipOf()).toBeNull();
    expect(editor.commands.list().some(({ id }) => id.startsWith('toolbar.'))).toBe(false);
    expect(editor.commands.list().some(({ id }) => id.startsWith('edit.'))).toBe(false);
    // The right-click is the browser's again.
    expect(rightClick(editor).defaultPrevented).toBe(false);
  });
});

describe('the plugin', () => {
  it('names itself and what it needs', () => {
    expect(plugin.manifest.id).toBe('redlines.toolbar');
    expect(plugin.manifest.needs).toContain('clipboard');
  });

  it('activates without a clipboard, and leaves Cut, Copy and Paste out', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: 'Hello', author: ada });
    const remove = plugin.activate({ editor, host: {}, author: ada, notice: () => {} });
    expect(editor.commands.list().map(({ id }) => id)).toEqual(['toolbar.show']);
    remove();
    editor.destroy();
  });
});

describe('docked, by the wrench or the preference', () => {
  const press = (target: EventTarget) =>
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

  it('is shown by the wrench at the bottom center, and away by the wrench again', () => {
    const changes: boolean[] = [];
    const { toolbar } = mount('Hello', { onChange: (shown) => changes.push(shown) });
    expect(toolbar.toggle()).toBe(true);
    expect(panelOf()?.hidden).toBe(false);
    expect(panelOf()?.classList.contains('rl-toolbar-docked')).toBe(true);
    expect(panelOf()?.style.left).toBe('');
    expect(toolbar.toggle()).toBe(false);
    expect(panelOf()?.hidden).toBe(true);
    expect(changes).toEqual([true, false]);
  });

  it('stays through a press elsewhere, a scroll, a resize, a zoom and typing', () => {
    const { editor, toolbar } = mount();
    toolbar.toggle();
    press(editor.view.contentDOM);
    document.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    toolbar.hide();
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(toolbar.isOpen()).toBe(true);
  });

  it('fades while the person types and comes back when the pointer moves', () => {
    const { editor, toolbar } = mount();
    toolbar.toggle();
    expect(panelOf()?.hasAttribute('data-writing')).toBe(false);
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(panelOf()?.hasAttribute('data-writing')).toBe(true);
    expect(toolbar.isOpen()).toBe(true);
    // A key that only moves the caret is not writing.
    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect(panelOf()?.hasAttribute('data-writing')).toBe(false);
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    expect(panelOf()?.hasAttribute('data-writing')).toBe(false);
  });

  it('puts an open menu away as it fades, and fades no toolbar that the keyboard is in', () => {
    const { editor, toolbar } = mount();
    toolbar.toggle();
    tops()[0]!.click();
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(document.querySelector('.rl-toolbar-menu:not([hidden])')).toBeNull();
    // The toolbar at the caret goes on showing while the person types in it.
    toolbar.toggle();
    editor.commands.run('toolbar.show');
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(panelOf()?.hasAttribute('data-writing')).toBe(false);
  });

  it('shows again when the key takes the keyboard to a bar that faded', () => {
    const { editor, toolbar } = mount();
    toolbar.toggle();
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(panelOf()?.hasAttribute('data-writing')).toBe(true);
    editor.commands.run('toolbar.show');
    expect(panelOf()?.hasAttribute('data-writing')).toBe(false);
    expect(document.activeElement).toBe(tops()[0]);
  });

  it('draws again when the items change, with the keyboard kept in the bar', () => {
    const ids = ['block.body', 'block.ul', 'format.bold'];
    const { editor, toolbar } = mount(
      'Hello\n\n# Title\n',
      {},
      ids.map((id) => command(id)),
    );
    forceParsing(editor.view, editor.view.state.doc.length, 1000);
    editor.view.dispatch({ selection: { anchor: 2 } });
    toolbar.toggle();
    tops()[0]!.focus();
    key(tops()[0]!, 'ArrowDown');
    expect(tops().map((top) => top.textContent)).toEqual(['List', 'Format']);
    expect(document.activeElement).toBe(itemFor('block.ul'));
    // The selection moves into the heading: List goes, and the keyboard stays in the bar.
    editor.view.dispatch({ selection: { anchor: 10 } });
    expect(tops().map((top) => top.textContent)).toEqual(['Format']);
    expect(panelOf()?.contains(document.activeElement)).toBe(true);
  });

  it('leaves the room it takes at the bottom to the page, and gives it back', () => {
    const { toolbar } = mount();
    const container = document.querySelector<HTMLElement>('.cm-editor')!;
    expect(container.style.getPropertyValue('--rl-toolbar-room')).toBe('');
    toolbar.toggle();
    expect(container.style.getPropertyValue('--rl-toolbar-room')).toBe('24px');
    toolbar.toggle();
    expect(container.style.getPropertyValue('--rl-toolbar-room')).toBe('');
  });

  it('keeps the keyboard in the text when it is used, and stays after a command', () => {
    const ran = vi.fn(() => true);
    const { editor, toolbar } = mount('Hello', {}, [command('format.bold', { run: ran })]);
    toolbar.toggle();
    itemFor('format.bold')?.click();
    expect(ran).toHaveBeenCalledTimes(1);
    expect(toolbar.isOpen()).toBe(true);
    expect(document.activeElement).toBe(editor.view.contentDOM);
  });

  it('moves the keyboard in and out with the key, and Esc gives it back to the text', () => {
    const { editor, toolbar } = mount();
    toolbar.toggle();
    editor.commands.run('toolbar.show');
    expect(document.activeElement).toBe(tops()[0]);
    key(tops()[0]!, 'Escape');
    expect(document.activeElement).toBe(editor.view.contentDOM);
    expect(toolbar.isOpen()).toBe(true);
    editor.commands.run('toolbar.show');
    editor.commands.run('toolbar.show');
    expect(document.activeElement).toBe(editor.view.contentDOM);
    expect(toolbar.isOpen()).toBe(true);
  });

  it('follows the preference, and goes with it', () => {
    const changes: boolean[] = [];
    const { toolbar } = mount('Hello', { onChange: (shown) => changes.push(shown) });
    toolbar.setAtBottom(true);
    expect(toolbar.isOpen()).toBe(true);
    toolbar.setAtBottom(false);
    expect(toolbar.isOpen()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('stays through Tab, which only gives the keyboard back to the text', () => {
    const { editor, toolbar } = mount();
    toolbar.toggle();
    editor.commands.run('toolbar.show');
    key(buttons()[0]!, 'Tab');
    expect(toolbar.isOpen()).toBe(true);
    expect(document.activeElement).toBe(editor.view.contentDOM);
  });

  it('comes back after a right-click’s toolbar goes, and not after the wrench put it away', async () => {
    const { editor, toolbar } = mount();
    toolbar.toggle();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await vi.advanceTimersByTimeAsync(0);
    expect(panelOf()?.classList.contains('rl-toolbar-docked')).toBe(false);
    key(document.body, 'Escape');
    expect(panelOf()?.classList.contains('rl-toolbar-docked')).toBe(true);
    expect(panelOf()?.hidden).toBe(false);
    // The wrench while it is at the pointer puts it away for good.
    rightClick(editor);
    await vi.advanceTimersByTimeAsync(0);
    toolbar.toggle();
    expect(toolbar.isOpen()).toBe(false);
  });
});

describe('the palette in the toolbar', () => {
  const searchBox = () => document.querySelector<HTMLInputElement>('.rl-toolbar-input');
  const results = () =>
    [...document.querySelectorAll<HTMLElement>('.rl-toolbar-result')].map(
      (line) => line.querySelector('.rl-toolbar-result-name')?.textContent,
    );
  const type = (text: string) => {
    const input = searchBox()!;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const COMMANDS_FOR_SEARCH = [
    command('format.link', { title: 'Link…', shortcut: 'Mod-k' }),
    command('block.ul', { title: 'Bulleted List' }),
    command('block.task', { title: 'Task List' }),
    command('format.bold', { title: 'Bold', shortcut: 'Mod-b' }),
    command('format.italic', { title: 'Italic', disabledReason: () => 'Not here.' }),
  ];

  it('opens on a character typed in the bar, with it as the query, in place of the bar’s row', () => {
    const { editor } = mount('Hello', {}, COMMANDS_FOR_SEARCH);
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 't');
    expect(panelOf()?.hasAttribute('data-search')).toBe(true);
    expect(searchBox()?.value).toBe('t');
    expect(document.activeElement).toBe(searchBox());
    expect(results()).toEqual(['Make Checklist']);
  });

  it('finds by synonym, leaves out what does not work here, and names a command as a verb phrase', () => {
    const { editor } = mount('Hello', {}, COMMANDS_FOR_SEARCH);
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'x');
    type('todo');
    expect(results()).toEqual(['Make Checklist']);
    type('link');
    expect(results()).toEqual(['Insert Link']);
    expect(document.querySelector('.rl-toolbar-result .rl-toolbar-result-keys')?.textContent).toBe(
      '⌘K',
    );
    // Italic is grayed at the caret, so it isn't offered.
    type('italic');
    expect(results()).toEqual([]);
    expect(document.querySelector('.rl-toolbar-none-found')).not.toBeNull();
  });

  it('runs the chosen command on Return, puts the toolbar away and gives the text the keyboard', () => {
    const ran = vi.fn(() => true);
    const { editor, toolbar } = mount('Hello', {}, [
      command('format.bold', { title: 'Bold', run: ran }),
    ]);
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'b');
    key(searchBox()!, 'Enter');
    expect(ran).toHaveBeenCalledTimes(1);
    expect(toolbar.isOpen()).toBe(false);
    expect(document.activeElement).toBe(editor.view.contentDOM);
  });

  it('moves among the lines with ↑ and ↓, and a click runs one', () => {
    const ran = vi.fn(() => true);
    const { editor } = mount('Hello', {}, [
      command('block.ul', { title: 'Bulleted List' }),
      command('block.ol', { title: 'Numbered List', run: ran }),
      command('format.bold', { title: 'Bold' }),
    ]);
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'l');
    expect(results()).toEqual(['Make Bulleted List', 'Make Numbered List']);
    key(searchBox()!, 'ArrowDown');
    expect(document.querySelectorAll('.rl-toolbar-result')[1]?.getAttribute('aria-selected')).toBe(
      'true',
    );
    key(searchBox()!, 'ArrowDown');
    expect(document.querySelectorAll('.rl-toolbar-result')[0]?.getAttribute('aria-selected')).toBe(
      'true',
    );
    key(searchBox()!, 'ArrowUp');
    (document.querySelectorAll('.rl-toolbar-result')[1] as HTMLElement).click();
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('gives the bar back on Esc, then closes', () => {
    const { editor, toolbar } = mount('Hello', {}, COMMANDS_FOR_SEARCH);
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'b');
    key(searchBox()!, 'Escape');
    expect(panelOf()?.hasAttribute('data-search')).toBe(false);
    expect(searchBox()).toBeNull();
    expect(toolbar.isOpen()).toBe(true);
    expect(tops().length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(tops()[0]);
    key(tops()[0]!, 'Escape');
    expect(toolbar.isOpen()).toBe(false);
  });

  it('keeps a docked toolbar docked after a command, with the bar back', () => {
    const { editor, toolbar } = mount('Hello', {}, COMMANDS_FOR_SEARCH);
    toolbar.toggle();
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'b');
    key(searchBox()!, 'Enter');
    expect(toolbar.isOpen()).toBe(true);
    expect(panelOf()?.hasAttribute('data-search')).toBe(false);
    expect(tops().length).toBeGreaterThan(0);
  });

  it('shows a setting as a live control in its line, which stays open as it is used', () => {
    let on = false;
    let size = 100;
    let look = 'light';
    const { editor, toolbar } = mount('Hello', {
      appCommands: () => [
        {
          id: 'tracking',
          title: 'Track Changes',
          keys: '⇧⌘E',
          control: { kind: 'switch', get: () => on, set: (value) => (on = value) },
        },
        {
          id: 'appearance',
          title: 'Appearance',
          synonyms: ['dark mode'],
          control: {
            kind: 'choice',
            options: [
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ],
            get: () => look,
            set: (value) => (look = value),
          },
        },
        {
          id: 'size',
          title: 'Text Size',
          control: {
            kind: 'slider',
            min: 80,
            max: 160,
            step: 10,
            get: () => size,
            set: (value) => (size = value),
            format: (value) => `${value}%`,
          },
        },
      ],
    });
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'T');
    type('track');
    const track = () => document.querySelector('.rl-toolbar-switch')!;
    expect(track().getAttribute('aria-checked')).toBe('false');
    // The key and the control sit together in the line.
    expect(document.querySelector('.rl-toolbar-result-keys')?.textContent).toBe('⇧⌘E');
    key(searchBox()!, 'Enter');
    expect(on).toBe(true);
    expect(track().getAttribute('aria-checked')).toBe('true');
    expect(toolbar.isOpen()).toBe(true);
    expect(searchBox()).not.toBeNull();
    // A choice: found by a synonym, and the arrows change it.
    type('dark mode');
    expect(results()).toEqual(['Appearance']);
    key(searchBox()!, 'ArrowRight');
    expect(look).toBe('dark');
    expect(document.querySelector('.rl-toolbar-segment[aria-checked="true"]')?.textContent).toBe(
      'Dark',
    );
    key(searchBox()!, 'ArrowLeft');
    expect(look).toBe('light');
    // A slider: the arrows move it by its step, within its ends.
    type('text size');
    key(searchBox()!, 'ArrowRight');
    expect(size).toBe(110);
    expect(document.querySelector('.rl-toolbar-value')?.textContent).toBe('110%');
    expect(toolbar.isOpen()).toBe(true);
    expect(searchBox()).not.toBeNull();
  });

  it('returns from a control to the search box on Esc, and only then gives the bar back', () => {
    const { editor, toolbar } = mount('Hello', {
      appCommands: () => [
        {
          id: 'size',
          title: 'Text Size',
          control: { kind: 'slider', min: 80, max: 160, step: 10, get: () => 100, set: () => {} },
        },
      ],
    });
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 't');
    const range = document.querySelector<HTMLInputElement>('.rl-toolbar-range')!;
    range.focus();
    key(range, 'Escape');
    expect(document.activeElement).toBe(searchBox());
    expect(toolbar.isOpen()).toBe(true);
    key(searchBox()!, 'Escape');
    expect(searchBox()).toBeNull();
  });

  it('ends with an Ask line for what was typed, when the host can ask', () => {
    const asked = vi.fn();
    const { editor } = mount('Hello', { askAbout: asked }, COMMANDS_FOR_SEARCH);
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'q');
    type('why is this here');
    expect(results()).toEqual(['Ask about “why is this here”']);
    key(searchBox()!, 'Enter');
    expect(asked).toHaveBeenCalledWith('why is this here');
  });

  it('runs an app command and puts the toolbar away', () => {
    const run = vi.fn();
    const { editor, toolbar } = mount('Hello', {
      appCommands: () => [{ id: 'prefs', title: 'Open Preferences', run }],
    });
    editor.commands.run('toolbar.show');
    key(tops()[0]!, 'p');
    key(searchBox()!, 'Enter');
    expect(run).toHaveBeenCalledTimes(1);
    expect(toolbar.isOpen()).toBe(false);
  });
});

describe('the review card of a place (#1190)', () => {
  const card = (text = 'A card') => {
    const el = document.createElement('div');
    el.className = 'the-card';
    el.textContent = text;
    return el;
  };
  const spelling = (answer: readonly string[]) => ({
    enabled: () => true,
    suggest: vi.fn(() => Promise.resolve(answer)),
  });
  /** The card's children in order, top to bottom: the spelling rows, the card, the bar. */
  const stack = () =>
    [...(panelOf()?.children ?? [])]
      .filter((child) => !child.classList.contains('rl-toolbar-rule'))
      .map((child) => child.className.split(' ')[0]);

  it('stacks the card of a right-click above the bar, under the spelling rows', async () => {
    const bubbleAt = vi.fn(() => card());
    const { editor } = mount('Hello wrold there', { bubbleAt, spelling: spelling(['world']) });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await settle();
    expect(bubbleAt).toHaveBeenCalledWith({ pos: 8, target: editor.view.contentDOM });
    expect(stack()).toEqual(['rl-toolbar-spelling', 'rl-toolbar-bubble', 'rl-toolbar-bar']);
    expect(panelOf()?.querySelector('.rl-toolbar-bubble .the-card')).not.toBeNull();
  });

  it('opens with ⇧⌘P exactly what a right-click at the caret opens', async () => {
    const bubbleAt = vi.fn(() => card());
    const { editor, toolbar } = mount('Hello wrold there', {
      bubbleAt,
      spelling: spelling(['world']),
    });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    vi.spyOn(editor.view, 'focus').mockImplementation(() => {});
    rightClick(editor);
    await settle();
    const rightClicked = stack();
    const rightWords = words().map((word) => word.textContent);
    toolbar.show();
    expect(toolbar.isOpen()).toBe(false);
    editor.view.dispatch({ selection: { anchor: 8 } });
    toolbar.show();
    await settle();
    expect(toolbar.isOpen()).toBe(true);
    expect(stack()).toEqual(rightClicked);
    expect(words().map((word) => word.textContent)).toEqual(rightWords);
    expect(bubbleAt).toHaveBeenLastCalledWith({ pos: 8, target: null });
    // The keyboard goes to the first suggestion.
    expect(document.activeElement).toBe(words()[0]);
  });

  it('has no card where the place has none', () => {
    const { editor } = mount('Hello wrold there', { bubbleAt: () => null });
    rightClick(editor);
    expect(panelOf()?.querySelector('.rl-toolbar-bubble')).toBeNull();
  });

  it('puts the toolbar away when the card says its work is done', () => {
    const el = card();
    const { editor, toolbar } = mount('Hello wrold there', { bubbleAt: () => el });
    rightClick(editor);
    expect(toolbar.isOpen()).toBe(true);
    el.dispatchEvent(new CustomEvent('rl-bubble-done', { bubbles: true }));
    expect(toolbar.isOpen()).toBe(false);
  });

  it('takes the card away when the text changes, as it does the spelling rows', () => {
    const { editor } = mount('Hello wrold there', { bubbleAt: () => card() });
    rightClick(editor);
    editor.view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(panelOf()?.querySelector('.rl-toolbar-bubble')).toBeNull();
    expect(panelOf()?.hidden).toBe(false);
  });

  it('keeps the selection’s highlight while the toolbar is open, and not after', () => {
    const { editor, toolbar } = mount('Hello wrold there');
    editor.view.dispatch({ selection: { anchor: 6, head: 11 } });
    const held = () => document.querySelectorAll('.rl-toolbar-held');
    expect(held().length).toBe(0);
    toolbar.show();
    // The keyboard is in the toolbar, where the page draws the text's selection as inactive.
    expect(editor.view.hasFocus).toBe(false);
    expect([...held()].map((el) => el.textContent).join('')).toBe('wrold');
    toolbar.show();
    expect(held().length).toBe(0);
  });

  it('tells the host while a bar at the pointer or the caret is open, and not for a docked one', () => {
    const floating: boolean[] = [];
    const { editor, toolbar } = mount('Hello wrold there', {
      onFloating: (is) => floating.push(is),
    });
    rightClick(editor);
    toolbar.show();
    toolbar.toggle();
    toolbar.toggle();
    expect(floating).toEqual([true, false, false, false]);
  });
});
