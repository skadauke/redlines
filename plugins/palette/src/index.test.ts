// @vitest-environment happy-dom
import {
  createEditor,
  type Editor,
  type EditorCommand,
  type EditorOptions,
} from '@redlines/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPalette, type Palette, type PaletteOptions, plugin } from './index.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: { editor: Editor; palette: Palette }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const { editor, palette } of mounted.splice(0)) {
    palette.destroy();
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
  palette: Palette;
  notices: string[];
}

function mount(
  doc = 'Hello wrold there',
  options: Partial<PaletteOptions> = {},
  commands: readonly EditorCommand[] = COMMANDS,
  editorOptions: Partial<EditorOptions> = {},
): Mount {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, ...editorOptions });
  editor.commands.register(commands);
  const notices: string[] = [];
  const palette = createPalette(editor, {
    notice: (message) => notices.push(message),
    tooltipMs: 400,
    ...options,
  });
  mounted.push({ editor, palette });
  return { editor, palette, notices };
}

const handleOf = () => document.querySelector<HTMLElement>('.rl-palette-handle');
const panelOf = () => document.querySelector<HTMLElement>('.rl-palette');
const tipOf = () => document.querySelector<HTMLElement>('.rl-palette-tip');
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.rl-palette-item')];
const itemFor = (id: string) =>
  document.querySelector<HTMLButtonElement>(`.rl-palette-item[data-command="${id}"]`);
const words = () => [...document.querySelectorAll<HTMLButtonElement>('.rl-palette-word')];

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

describe('the handle', () => {
  it('is there, with the palette hidden', () => {
    mount();
    const handle = handleOf();
    expect(handle?.getAttribute('aria-label')).toBe('Formatting palette');
    expect(handle?.getAttribute('aria-expanded')).toBe('false');
    expect(panelOf()?.hidden).toBe(true);
  });

  it('brings the palette up on hover, and puts it away when the pointer goes', () => {
    mount();
    pointer(handleOf()!, 'pointerenter');
    expect(panelOf()?.hidden).toBe(true);
    vi.advanceTimersByTime(120);
    expect(panelOf()?.hidden).toBe(false);
    expect(handleOf()?.getAttribute('aria-expanded')).toBe('true');
    pointer(handleOf()!, 'pointerleave');
    vi.advanceTimersByTime(199);
    expect(panelOf()?.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(panelOf()?.hidden).toBe(true);
  });

  it('stays while the pointer is on the palette itself', () => {
    mount();
    pointer(handleOf()!, 'pointerenter');
    vi.advanceTimersByTime(120);
    pointer(handleOf()!, 'pointerleave');
    pointer(panelOf()!, 'pointerenter');
    vi.advanceTimersByTime(1000);
    expect(panelOf()?.hidden).toBe(false);
    pointer(panelOf()!, 'pointerleave');
    vi.advanceTimersByTime(200);
    expect(panelOf()?.hidden).toBe(true);
  });

  it('does nothing for a pointer with a button down, which is selecting text', () => {
    mount();
    pointer(handleOf()!, 'pointerenter', { buttons: 1 });
    vi.advanceTimersByTime(1000);
    expect(panelOf()?.hidden).toBe(true);
  });

  it('does nothing for a finger', () => {
    mount();
    pointer(handleOf()!, 'pointerenter', { pointerType: 'touch' });
    vi.advanceTimersByTime(1000);
    expect(panelOf()?.hidden).toBe(true);
  });

  it('keeps the palette after a click, until a second click, Esc or a press elsewhere', () => {
    mount();
    handleOf()?.click();
    expect(panelOf()?.hidden).toBe(false);
    pointer(handleOf()!, 'pointerleave');
    vi.advanceTimersByTime(1000);
    expect(panelOf()?.hidden).toBe(false);
    handleOf()?.click();
    expect(panelOf()?.hidden).toBe(true);

    handleOf()?.click();
    key(document, 'Escape');
    expect(panelOf()?.hidden).toBe(true);

    handleOf()?.click();
    pointer(document.body, 'pointerdown');
    expect(panelOf()?.hidden).toBe(true);
  });

  it('cancels a press on it, which is what keeps the keyboard in the text', () => {
    mount();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    handleOf()?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('goes out of the way while you type, and comes back with the pointer', () => {
    const { editor } = mount();
    key(editor.view.contentDOM, 'a');
    expect(handleOf()?.hasAttribute('data-writing')).toBe(true);
    window.dispatchEvent(new MouseEvent('pointermove'));
    expect(handleOf()?.hasAttribute('data-writing')).toBe(false);
    // A key that moves the caret, or holds a modifier, is not writing.
    key(editor.view.contentDOM, 'ArrowLeft');
    key(editor.view.contentDOM, 'b', { metaKey: true });
    expect(handleOf()?.hasAttribute('data-writing')).toBe(false);
  });

  it('puts away a palette the pointer opened, when you go back to typing', () => {
    const { editor } = mount();
    handleOf()?.click();
    key(editor.view.contentDOM, 'a');
    expect(panelOf()?.hidden).toBe(true);
  });
});

describe('the items', () => {
  it('are the commands of the registry, with no labels on them', () => {
    mount();
    handleOf()?.click();
    expect(buttons().map((button) => button.dataset['command'])).toEqual([
      'comment.add',
      'block.table',
      'format.link',
      'format.bold',
      'format.italic',
      'format.clear',
    ]);
    // Icons only: the name is for assistive technology, and for the hint.
    for (const button of buttons()) {
      expect(button.textContent).toBe('');
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
    expect(itemFor('format.link')?.getAttribute('aria-label')).toBe('Link');
    expect(itemFor('format.bold')?.getAttribute('aria-keyshortcuts')).toBe('Meta+B');
  });

  it('are in rows by group, with a hairline between them', () => {
    mount();
    handleOf()?.click();
    const rows = [...document.querySelectorAll('.rl-palette-row')].map((row) =>
      row.getAttribute('aria-label'),
    );
    expect(rows).toEqual(['Comment', 'Insert', 'Format']);
    expect(document.querySelectorAll('.rl-palette-rule')).toHaveLength(2);
  });

  it('shows an item once its command lands', () => {
    const { editor } = mount();
    handleOf()?.click();
    expect(itemFor('format.sub')).toBeNull();
    handleOf()?.click();
    editor.commands.register([command('format.sub', { title: 'Subscript' })]);
    handleOf()?.click();
    expect(itemFor('format.sub')).not.toBeNull();
  });

  it('runs the command, puts the palette away and leaves the keyboard in the text', () => {
    const ran = vi.fn(() => true);
    const { editor } = mount('Hello', {}, [command('format.bold', { title: 'Bold', run: ran })]);
    handleOf()?.click();
    itemFor('format.bold')?.click();
    expect(ran).toHaveBeenCalledTimes(1);
    expect(panelOf()?.hidden).toBe(true);
    expect(editor.view.hasFocus || document.activeElement === editor.view.contentDOM).toBe(true);
  });

  it('cancels a press on one, which is what keeps the text’s focus and selection', () => {
    mount();
    handleOf()?.click();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    itemFor('format.bold')?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('disables the ones that cannot run, and marks a toggle that is on', () => {
    mount('Hello', {}, [
      command('format.bold', { isActive: () => true }),
      command('format.italic', { isActive: () => false, isEnabled: () => false }),
      command('format.clear'),
    ]);
    handleOf()?.click();
    expect(itemFor('format.bold')?.getAttribute('aria-pressed')).toBe('true');
    expect(itemFor('format.italic')?.getAttribute('aria-pressed')).toBe('false');
    expect(itemFor('format.italic')?.disabled).toBe(true);
    expect(itemFor('format.clear')?.hasAttribute('aria-pressed')).toBe(false);
  });

  it('follows the selection while it is open', () => {
    let bold = false;
    const { editor } = mount('Hello world', {}, [command('format.bold', { isActive: () => bold })]);
    handleOf()?.click();
    expect(itemFor('format.bold')?.getAttribute('aria-pressed')).toBe('false');
    bold = true;
    editor.view.dispatch({ selection: { anchor: 2 } });
    expect(itemFor('format.bold')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the hint', () => {
  it('names an item and its keys after the title bar’s delay, and goes with the pointer', () => {
    mount();
    handleOf()?.click();
    const button = itemFor('block.table')!;
    pointer(button, 'pointerenter');
    vi.advanceTimersByTime(399);
    expect(tipOf()?.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tipOf()?.hidden).toBe(false);
    expect(tipOf()?.textContent).toBe('Table⌥⌘T');
    pointer(button, 'pointerleave');
    expect(tipOf()?.hidden).toBe(true);
  });

  it('takes the delay it is given', () => {
    mount('Hello', { tooltipMs: 1000 });
    handleOf()?.click();
    pointer(itemFor('format.bold')!, 'pointerenter');
    vi.advanceTimersByTime(999);
    expect(tipOf()?.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tipOf()?.hidden).toBe(false);
  });

  it('is not shown for a finger', () => {
    mount();
    handleOf()?.click();
    pointer(itemFor('format.bold')!, 'pointerenter', { pointerType: 'touch' });
    vi.advanceTimersByTime(1000);
    expect(tipOf()?.hidden).toBe(true);
  });

  it('goes when the palette does', () => {
    mount();
    handleOf()?.click();
    pointer(itemFor('format.bold')!, 'pointerenter');
    vi.advanceTimersByTime(400);
    key(document, 'Escape');
    expect(tipOf()?.hidden).toBe(true);
  });
});

describe('the right-click', () => {
  it('opens the palette in place of the browser’s menu', () => {
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

  it('puts the palette above the pointer where the window ends first', () => {
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
    expect(document.activeElement).toBe(buttons()[0]);
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
    // The pointer's palette doesn't take the keyboard.
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
    expect(document.activeElement).toBe(buttons()[0]);
  });

  it('puts itself away on Esc, and gives the keyboard back to the text', () => {
    const { editor } = mount();
    menuKey(editor);
    key(buttons()[0]!, 'Escape');
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

  it('opens again for the next right-click, and shows only one palette', () => {
    const { editor } = mount();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor, { clientX: 10, clientY: 10 });
    rightClick(editor, { clientX: 200, clientY: 100 });
    expect(document.querySelectorAll('.rl-palette')).toHaveLength(1);
    expect(panelOf()?.style.left).toBe('200px');
  });
});

/** The main selection's range, for `sliceDoc`. */
function rangeOf(editor: Editor): [number, number] {
  const { from, to } = editor.view.state.selection.main;
  return [from, to];
}

describe('where the palette goes', () => {
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
    editor.commands.run('palette.show');
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
    const { palette } = mount();
    const box = document.createElement('textarea');
    document.body.append(box);
    handleOf()?.click();
    box.focus();
    const event = key(box, 'Escape');
    expect(event.defaultPrevented).toBe(false);
    expect(palette.isOpen()).toBe(true);
  });

  it('puts the keyboard in the text for a choice made in the palette, whoever had it', () => {
    const ran = vi.fn(() => true);
    const { editor } = mount('Hello', {}, [command('format.bold', { run: ran })]);
    const box = document.createElement('textarea');
    document.body.append(box);
    box.focus();
    handleOf()?.click();
    itemFor('format.bold')?.click();
    // The command ran, which the registry does not for a keyboard left in another box.
    expect(ran).toHaveBeenCalledTimes(1);
    expect(editor.view.hasFocus || document.activeElement === editor.view.contentDOM).toBe(true);
  });

  it('leaves the keyboard in another box when the palette is put away by the pointer leaving', () => {
    mount();
    const box = document.createElement('textarea');
    document.body.append(box);
    pointer(handleOf()!, 'pointerenter');
    vi.advanceTimersByTime(120);
    box.focus();
    pointer(handleOf()!, 'pointerleave');
    vi.advanceTimersByTime(200);
    expect(panelOf()?.hidden).toBe(true);
    expect(document.activeElement).toBe(box);
  });

  it('cancels a press on the padding of the palette, as on an item', () => {
    mount();
    handleOf()?.click();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    panelOf()?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('says it is open for the palette the handle brought up, and not for a right-click’s', () => {
    const { editor } = mount();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    expect(handleOf()?.hasAttribute('aria-haspopup')).toBe(false);
    rightClick(editor);
    expect(handleOf()?.getAttribute('aria-expanded')).toBe('false');
    key(document.body, 'Escape');
    handleOf()?.click();
    expect(handleOf()?.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('spelling suggestions', () => {
  const spelling = (answer: readonly string[] | null, extra: object = {}) => ({
    enabled: () => true,
    suggest: vi.fn(() => Promise.resolve(answer)),
    ...extra,
  });

  it('shows the suggestions at the top of a palette opened on a misspelled word', async () => {
    const options = spelling(['world', 'word'], { learn: vi.fn() });
    const { editor } = mount('Hello wrold there', { spelling: options });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    rightClick(editor);
    await settle();
    expect(options.suggest).toHaveBeenCalledWith('wrold', 'Hello ');
    expect(words().map((word) => word.textContent)).toEqual(['world', 'word', 'Learn Spelling']);
    // They come before the items.
    const first = panelOf()?.firstElementChild;
    expect(first?.classList.contains('rl-palette-spelling')).toBe(true);
  });

  it('makes the suggestion that is picked, and puts the palette away', async () => {
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

  it('keeps the keyboard in the palette when the suggestions come late', async () => {
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
    expect(before).toBe(buttons()[0]);
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

  it('drops an answer that comes after the palette went away', async () => {
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
    // Rows that would do nothing are not left in the palette, and the items stay.
    expect(words()).toEqual([]);
    expect(buttons().length).toBeGreaterThan(0);
    expect(panelOf()?.hidden).toBe(false);
    expect(editor.view.state.doc.toString()).toBe('Oh. Hello wrold there');
  });

  it('keeps the keyboard in the palette when the suggestions go', async () => {
    const { editor } = mount('Hello wrold there', { spelling: spelling(['world']) });
    editor.view.dispatch({ selection: { anchor: 8 } });
    menuKey(editor);
    await settle();
    expect(document.activeElement).toBe(words()[0]);
    editor.view.dispatch({ changes: { from: 0, insert: 'Oh. ' } });
    expect(words()).toEqual([]);
    expect(document.activeElement).toBe(buttons()[0]);
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
    expect(document.activeElement).toBe(buttons()[0]);
  });
});

describe('from the keyboard', () => {
  it('opens with Show Formatting Palette, below the caret, with the keyboard in it', () => {
    const { editor, palette } = mount();
    expect(editor.commands.run('palette.show')).toBe(true);
    expect(palette.isOpen()).toBe(true);
    expect(document.activeElement).toBe(buttons()[0]);
    // The command has a key and a menu.
    const shown = editor.commands.list().find(({ id }) => id === 'palette.show');
    expect(shown?.shortcut).toBe('Mod-Alt-p');
    expect(shown?.menu).toBe('view');
  });

  it('puts itself away when the command runs again', () => {
    const { editor, palette } = mount();
    editor.commands.run('palette.show');
    editor.commands.run('palette.show');
    expect(palette.isOpen()).toBe(false);
  });

  it('moves with the arrow keys, along a row and between rows', () => {
    const { editor } = mount();
    editor.commands.run('palette.show');
    const [comment, table, link, , italic] = buttons();
    key(comment!, 'ArrowRight');
    // Only one item in the first row: the next in order is the next row's first.
    expect(document.activeElement).toBe(table);
    key(table!, 'ArrowRight');
    expect(document.activeElement).toBe(link);
    // Down keeps the column: the second item of the next row.
    key(link!, 'ArrowDown');
    expect(document.activeElement).toBe(italic);
    key(italic!, 'ArrowUp');
    expect(document.activeElement).toBe(link);
    // And up from the second column into the first row, which is shorter: its last item.
    key(link!, 'ArrowUp');
    expect(document.activeElement).toBe(comment);
    key(table!, 'Home');
    expect(document.activeElement).toBe(comment);
    key(comment!, 'End');
    expect(document.activeElement).toBe(buttons().at(-1));
    key(buttons().at(-1)!, 'ArrowRight');
    expect(document.activeElement).toBe(comment);
  });

  it('puts itself away on Esc and on Tab, and gives the keyboard back to the text', () => {
    const { editor, palette } = mount();
    editor.commands.run('palette.show');
    key(buttons()[0]!, 'Escape');
    expect(palette.isOpen()).toBe(false);
    expect(document.activeElement).toBe(editor.view.contentDOM);
    editor.commands.run('palette.show');
    key(buttons()[1]!, 'Tab');
    expect(palette.isOpen()).toBe(false);
    expect(document.activeElement).toBe(editor.view.contentDOM);
  });

  it('presses the item the keyboard is on', () => {
    const ran = vi.fn(() => true);
    const { editor } = mount('Hello', {}, [command('format.bold', { run: ran })]);
    editor.commands.run('palette.show');
    buttons()[0]?.click();
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('skips the items that are disabled', () => {
    const { editor } = mount('Hello', {}, [
      command('format.bold', { isEnabled: () => false }),
      command('format.italic'),
      command('format.clear'),
    ]);
    editor.commands.run('palette.show');
    expect(document.activeElement).toBe(itemFor('format.italic'));
  });
});

describe('Cut, Copy and Paste', () => {
  const clipboard = () => ({
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(() => Promise.resolve()),
  });

  it('are the palette’s own commands, and appear with a clipboard', () => {
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
    handleOf()?.click();
    pointer(itemFor('edit.copy')!, 'pointerenter');
    vi.advanceTimersByTime(400);
    expect(tipOf()?.textContent).toBe('Copy⌘C');
  });

  it('cut and copy need a selection', () => {
    const { editor } = mount('Hello world', { clipboard: clipboard() });
    handleOf()?.click();
    expect(itemFor('edit.cut')?.disabled).toBe(true);
    expect(itemFor('edit.copy')?.disabled).toBe(true);
    expect(itemFor('edit.paste')?.disabled).toBe(false);
    editor.view.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(itemFor('edit.cut')?.disabled).toBe(false);
    expect(itemFor('edit.copy')?.disabled).toBe(false);
  });

  it('go through the host’s clipboard', () => {
    const board = clipboard();
    const { editor } = mount('Hello world', { clipboard: board });
    editor.view.dispatch({ selection: { anchor: 0, head: 5 } });
    handleOf()?.click();
    itemFor('edit.copy')?.click();
    expect(board.copy).toHaveBeenCalledTimes(1);
    handleOf()?.click();
    itemFor('edit.cut')?.click();
    expect(board.cut).toHaveBeenCalledTimes(1);
    handleOf()?.click();
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
  it('removes the handle, the palette, the hint and the commands', () => {
    const { editor, palette } = mount('Hello', { clipboard: { cut() {}, copy() {}, paste() {} } });
    handleOf()?.click();
    palette.destroy();
    expect(handleOf()).toBeNull();
    expect(panelOf()).toBeNull();
    expect(tipOf()).toBeNull();
    expect(editor.commands.list().some(({ id }) => id.startsWith('palette.'))).toBe(false);
    expect(editor.commands.list().some(({ id }) => id.startsWith('edit.'))).toBe(false);
    // The right-click is the browser's again.
    expect(rightClick(editor).defaultPrevented).toBe(false);
  });
});

describe('the plugin', () => {
  it('names itself and what it needs', () => {
    expect(plugin.manifest.id).toBe('redlines.palette');
    expect(plugin.manifest.needs).toContain('clipboard');
  });

  it('activates without a clipboard, and leaves Cut, Copy and Paste out', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: 'Hello', author: ada });
    const remove = plugin.activate({ editor, host: {}, author: ada, notice: () => {} });
    expect(editor.commands.list().map(({ id }) => id)).toEqual(['palette.show']);
    remove();
    editor.destroy();
  });
});
