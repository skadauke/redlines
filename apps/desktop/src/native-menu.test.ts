// @vitest-environment happy-dom
import type { CommandRegistry, EditorCommand } from '@redlines/editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appMenuModel, type MenuCommands, type MenuState } from './menu-model.ts';
import { createNativeMenu, installPlusKeys, installShortcuts } from './native-menu.ts';

// The menu bar is the Mac's, built through Tauri. These stand in for its items and keep what the
// app sets on them, so that what the app does to the menu can be checked without a window.
interface FakeItem {
  kind: 'check' | 'item' | 'submenu' | 'menu';
  /** What the item was made with: its items, its action. */
  options: Record<string, unknown>;
  text: string | undefined;
  accelerator: string | undefined;
  enabled: boolean;
  checked: boolean;
  /** For a submenu: what it holds now. */
  children: FakeItem[];
  closed: boolean;
}
const made = vi.hoisted(() => ({
  items: [] as FakeItem[],
  /** Told the text of the submenu made the Mac's Window menu. */
  onWindowsMenu: undefined as ((text: string | undefined) => void) | undefined,
  onHelpMenu: undefined as ((text: string | undefined) => void) | undefined,
  /** The menus set as the app's, in order. */
  appMenus: [] as unknown[],
  /** What setting a menu as the app's hands back: the menu that was the app's. */
  previousMenu: null as { close(): Promise<void> } | null,
}));

vi.mock('@tauri-apps/api/menu', () => {
  interface Options {
    text?: string;
    accelerator?: string;
    [option: string]: unknown;
  }
  const fake = (kind: FakeItem['kind']) =>
    class implements FakeItem {
      readonly kind = kind;
      text: string | undefined;
      accelerator: string | undefined;
      readonly options: Options;
      enabled = true;
      checked = false;
      children: FakeItem[] = [];
      closed = false;

      constructor(options: Options) {
        this.options = options;
        this.text = options.text;
        this.accelerator = options.accelerator;
        if (Array.isArray(options['items'])) this.children = [...(options['items'] as FakeItem[])];
        made.items.push(this);
      }

      static new(options: Options) {
        return Promise.resolve(new this(options));
      }

      setEnabled(enabled: boolean) {
        this.enabled = enabled;
        return Promise.resolve();
      }

      setChecked(checked: boolean) {
        this.checked = checked;
        return Promise.resolve();
      }

      setText(text: string) {
        this.text = text;
        return Promise.resolve();
      }

      append(items: FakeItem | FakeItem[]) {
        this.children.push(...[items].flat());
        return Promise.resolve();
      }

      remove(item: FakeItem) {
        this.children = this.children.filter((child) => child !== item);
        return Promise.resolve();
      }

      items() {
        return Promise.resolve([...this.children]);
      }

      close() {
        this.closed = true;
        return Promise.resolve();
      }

      setAsAppMenu() {
        made.appMenus.push(this);
        return Promise.resolve(made.previousMenu);
      }

      setAsWindowsMenuForNSApp() {
        made.onWindowsMenu?.(this.text);
        return Promise.resolve();
      }

      setAsHelpMenuForNSApp() {
        made.onHelpMenu?.(this.text);
        return Promise.resolve();
      }
    };
  return {
    CheckMenuItem: fake('check'),
    MenuItem: fake('item'),
    PredefinedMenuItem: fake('item'),
    Submenu: fake('submenu'),
    Menu: fake('menu'),
  };
});

function commands() {
  return {
    create: vi.fn(),
    open: vi.fn(),
    openRecent: vi.fn(),
    clearRecent: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    rename: vi.fn(),
    revealInFinder: vi.fn(),
    print: vi.fn(),
    quit: vi.fn(),
    setView: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleTracking: vi.fn(),
    openReview: vi.fn(),
    toggleResolved: vi.fn(),
    pastePlain: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    actualSize: vi.fn(),
    biggerText: vi.fn(),
    smallerText: vi.fn(),
    actualTextSize: vi.fn(),
    nextChange: vi.fn(),
    previousChange: vi.fn(),
    checkForUpdates: vi.fn(),
    openAbout: vi.fn(),
    openPreferences: vi.fn(),
    showAgentLogs: vi.fn(),
  } satisfies MenuCommands;
}

function registryOf(list: readonly EditorCommand[] = []) {
  return {
    register: () => () => {},
    list: () => list,
    run: vi.fn(() => true),
  } satisfies CommandRegistry;
}

/** The app's menus for these commands and the plugins' registered commands, as a browser has them. */
const modelOf = (c: MenuCommands, registry: CommandRegistry = registryOf()) =>
  appMenuModel(c, registry, { browser: true });

const press = (code: string, modifiers: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { code, cancelable: true, ...modifiers });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

const documentState = (overrides: Partial<MenuState> = {}): MenuState => ({
  view: 'clean',
  tracking: false,
  hasRedlines: false,
  sidebarOpen: false,
  showResolved: false,
  zoom: 1,
  textSize: 1,
  hasFile: true,
  recent: [],
  activeCommands: [],
  enabledCommands: [],
  commandTitles: {},
  undo: null,
  redo: null,
  canUndo: false,
  canRedo: false,
  inDocument: true,
  ...overrides,
});

describe('the menu bar', () => {
  beforeEach(() => {
    made.items.length = 0;
  });

  const itemWith = (kind: FakeItem['kind'], text: string): FakeItem => {
    const found = made.items.find((item) => item.kind === kind && item.text === text);
    if (!found) throw new Error(`no ${kind} item called ${text}`);
    return found;
  };

  it('offers the Redlines view, and its shortcut, whatever the document holds', async () => {
    const menu = await createNativeMenu(modelOf(commands()));
    const redlines = itemWith('check', 'Redlines');
    expect(redlines.accelerator).toBe('Alt+CmdOrCtrl+2');
    // A disabled item takes its shortcut with it.
    menu.update(documentState({ hasRedlines: false }));
    expect(redlines.enabled).toBe(true);
    menu.update(documentState({ hasRedlines: true, view: 'redlines' }));
    expect(redlines.enabled).toBe(true);
    expect(redlines.checked).toBe(true);
    menu.update(documentState({ hasRedlines: false, view: 'redlines' }));
    expect(redlines.enabled).toBe(true);
    expect(redlines.checked).toBe(true);
  });

  it('lists Clean, Redlines and Raw, with Redlines checked in its simple look too', async () => {
    const menu = await createNativeMenu(modelOf(commands()));
    const names = ['Clean', 'Simple', 'Redlines', 'Raw'];
    const views = made.items.filter(
      (item) => item.kind === 'check' && item.text !== undefined && names.includes(item.text),
    );
    expect(views.map((item) => [item.text, item.accelerator])).toEqual([
      ['Clean', 'Alt+CmdOrCtrl+1'],
      ['Redlines', 'Alt+CmdOrCtrl+2'],
      ['Raw', 'Alt+CmdOrCtrl+3'],
    ]);
    menu.update(documentState({ hasRedlines: true, view: 'simple' }));
    expect(views.map((item) => item.checked)).toEqual([false, true, false]);
    menu.update(documentState({ hasRedlines: true, view: 'raw' }));
    expect(views.map((item) => item.checked)).toEqual([false, false, true]);
  });

  it('keeps reviewing for documents with redlines', async () => {
    const menu = await createNativeMenu(modelOf(commands()));
    const review = ['Review Changes', 'Next Change', 'Previous Change'].map((text) =>
      itemWith('item', text),
    );
    menu.update(documentState({ hasRedlines: false }));
    expect(review.map((item) => item.enabled)).toEqual([false, false, false]);
    menu.update(documentState({ hasRedlines: true }));
    expect(review.map((item) => item.enabled)).toEqual([true, true, true]);
  });

  /** The items of the application menu, Redlines. */
  const appMenu = () => itemWith('submenu', 'Redlines').options['items'] as unknown[];

  it('opens About Redlines, a window of the app’s own, from its item, which shows no build tag', async () => {
    const c = commands();
    await createNativeMenu(modelOf(c));
    // Not the system's panel, whose icon takes no click: an item like any other.
    const about = appMenu()[0] as { text: string; action: () => void };
    expect(about.text).toBe('About Redlines');
    about.action();
    expect(c.openAbout).toHaveBeenCalledOnce();
    // The build tag is in the window, and in no item's label.
    for (const item of made.items) expect(String(item.text)).not.toContain('1a2b3c4');
  });

  it('checks for updates, and opens Preferences, which hold the settings the menu used to', async () => {
    const c = commands();
    await createNativeMenu(modelOf(c));
    const checkNow = appMenu()[1] as { text: string; action: () => void };
    expect(checkNow.text).toBe('Check for Updates…');
    checkNow.action();
    expect(c.checkForUpdates).toHaveBeenCalledOnce();

    const preferences = appMenu()[3] as { text: string; accelerator: string; action: () => void };
    expect(preferences).toMatchObject({ text: 'Preferences…', accelerator: 'CmdOrCtrl+,' });
    preferences.action();
    expect(c.openPreferences).toHaveBeenCalledOnce();
    // No Settings submenu, and no theme or icon items in the menu bar.
    expect(made.items.some((item) => item.kind === 'submenu' && item.text === 'Settings')).toBe(
      false,
    );
    expect(made.items.some((item) => String(item.text).includes('Theme'))).toBe(false);
  });

  it('puts a clicked check back as the state says', async () => {
    const menu = await createNativeMenu(modelOf(commands()));
    const redlines = itemWith('check', 'Redlines');
    menu.update(documentState({ view: 'redlines' }));
    // The Mac flips the check of the item that was clicked; the view stays as it was.
    redlines.checked = false;
    (redlines.options['action'] as () => void)();
    expect(redlines.checked).toBe(true);
  });

  describe('Open Recent', () => {
    const recentMenu = () => itemWith('submenu', 'Open Recent');
    const labels = () => recentMenu().children.map((child) => child.text);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('rebuilds Open Recent when the list changes', async () => {
      const c = commands();
      const menu = await createNativeMenu(modelOf(c));
      menu.update(documentState({ recent: ['/docs/plan.md', '/notes/old.md'] }));
      await settle();
      expect(labels()).toEqual(['plan.md', 'old.md', undefined, 'Clear Menu']);
      const [old] = recentMenu().children;

      // The same list again changes nothing.
      menu.update(documentState({ recent: ['/docs/plan.md', '/notes/old.md'] }));
      await settle();
      expect(recentMenu().children[0]).toBe(old);

      menu.update(documentState({ recent: ['/notes/old.md'] }));
      await settle();
      expect(labels()).toEqual(['old.md', undefined, 'Clear Menu']);
      // The items taken out are let go of.
      expect(old?.closed).toBe(true);

      (recentMenu().children[0]?.options['action'] as () => void)();
      expect(c.openRecent).toHaveBeenCalledWith('/notes/old.md');
    });

    it('greys out Clear Menu when there is nothing to clear', async () => {
      const menu = await createNativeMenu(modelOf(commands()));
      menu.update(documentState({ recent: [] }));
      await settle();
      expect(labels()).toEqual(['Clear Menu']);
      expect(recentMenu().children[0]?.options['enabled']).toBe(false);
    });

    it('follows two quick changes to the last', async () => {
      const menu = await createNativeMenu(modelOf(commands()));
      menu.update(documentState({ recent: ['/a.md'] }));
      menu.update(documentState({ recent: ['/b.md', '/a.md'] }));
      await settle();
      expect(labels()).toEqual(['b.md', 'a.md', undefined, 'Clear Menu']);
    });
  });

  it('enables Reveal in Finder only for a document that is a file', async () => {
    const menu = await createNativeMenu(modelOf(commands()));
    const reveal = itemWith('item', 'Reveal in Finder');
    menu.update(documentState({ hasFile: false }));
    expect(reveal.enabled).toBe(false);
    menu.update(documentState({ hasFile: true }));
    expect(reveal.enabled).toBe(true);
  });

  it('sends the menu only what changed', async () => {
    const menu = await createNativeMenu(modelOf(commands()));
    const raw = itemWith('check', 'Raw');
    const setChecked = vi.spyOn(raw as unknown as { setChecked(on: boolean): void }, 'setChecked');
    menu.update(documentState({ view: 'clean' }));
    menu.update(documentState({ view: 'clean', tracking: true }));
    expect(setChecked).toHaveBeenCalledOnce();
    menu.update(documentState({ view: 'raw' }));
    expect(setChecked).toHaveBeenCalledTimes(2);
  });

  it('follows the sidebar in the label of Show Files', async () => {
    const menu = await createNativeMenu(modelOf(commands()));
    const files = itemWith('item', 'Show Files');
    menu.update(documentState({ sidebarOpen: true }));
    expect(files.text).toBe('Hide Files');
    menu.update(documentState({ sidebarOpen: false }));
    expect(files.text).toBe('Show Files');
  });

  it('takes over the Mac’s menu bar and Window menu only when asked, each time', async () => {
    // macOS has one menu bar, and each window draws its own: `windows.ts` says when it's this one.
    const setAsWindows = vi.fn();
    made.onWindowsMenu = setAsWindows;
    const setAsHelp = vi.fn();
    made.onHelpMenu = setAsHelp;
    const menu = await createNativeMenu(modelOf(commands()));
    expect(made.appMenus).toEqual([]);
    expect(setAsWindows).not.toHaveBeenCalled();

    await menu.activate();
    await menu.activate();
    expect(made.appMenus).toHaveLength(2);
    expect(setAsWindows).toHaveBeenCalledTimes(2);
    expect(setAsWindows).toHaveBeenCalledWith('Window');
    expect(setAsHelp).toHaveBeenCalledWith('Help');
  });

  it('lets go of the menu that was the app’s, which Tauri hands back each time', async () => {
    const previous = { close: vi.fn(() => Promise.resolve()) };
    made.previousMenu = previous;
    const menu = await createNativeMenu(modelOf(commands()));
    await menu.activate();
    expect(previous.close).toHaveBeenCalledOnce();
  });

  it('draws no empty menus', async () => {
    await createNativeMenu(modelOf(commands()));
    const bar = made.items.find((item) => item.kind === 'menu');
    const titles = (bar?.options['items'] as FakeItem[]).map((item) => item.text);
    expect(titles).toEqual(['Redlines', 'File', 'Edit', 'View', 'Review', 'Window', 'Help']);
  });

  describe('with registered commands', () => {
    const registered = () =>
      registryOf([
        {
          id: 'format.bold',
          title: 'Bold',
          menu: 'format',
          shortcut: 'Mod-b',
          run: () => true,
          isActive: () => false,
        },
        {
          id: 'format.link',
          title: 'Link…',
          menu: 'format',
          group: 'link',
          shortcut: 'Mod-k',
          run: () => true,
          isEnabled: () => false,
        },
        { id: 'format.clear', title: 'Clear', menu: 'format', group: 'link', run: () => true },
      ]);

    it('draws a check item that follows activeCommands, with its accelerator', async () => {
      const registry = registered();
      const menu = await createNativeMenu(modelOf(commands(), registry));
      const bold = itemWith('check', 'Bold');
      expect(bold.accelerator).toBe('CmdOrCtrl+B');
      menu.update(documentState({ activeCommands: ['format.bold'] }));
      expect(bold.checked).toBe(true);
      menu.update(documentState({ activeCommands: [] }));
      expect(bold.checked).toBe(false);

      // A click runs it by id, and the check still shows what the state says.
      bold.checked = true;
      (bold.options['action'] as () => void)();
      expect(registry.run).toHaveBeenCalledWith('format.bold');
      expect(bold.checked).toBe(false);
    });

    it("retitles and enables Undo and Redo from the history, and runs the app's commands", async () => {
      const c = commands();
      const menu = await createNativeMenu(modelOf(c, registered()));
      const undo = itemWith('item', 'Undo');
      const redo = itemWith('item', 'Redo');
      expect(undo.accelerator).toBe('CmdOrCtrl+Z');
      expect(redo.accelerator).toBe('Shift+CmdOrCtrl+Z');
      menu.update(documentState({ undo: 'Claude’s Changes', canUndo: true }));
      expect(undo.text).toBe('Undo Claude’s Changes');
      expect(undo.enabled).toBe(true);
      expect(redo.text).toBe('Redo');
      expect(redo.enabled).toBe(false);
      menu.update(documentState({ inDocument: false }));
      expect(undo.text).toBe('Undo');
      expect(redo.enabled).toBe(true);
      (undo.options['action'] as () => void)();
      expect(c.undo).toHaveBeenCalledOnce();
    });

    it('follows the title of a command that counts the selection', async () => {
      const registry = registryOf([
        {
          id: 'table.deleteRow',
          title: () => 'Delete Row',
          menu: 'table',
          run: () => true,
        },
      ]);
      const menu = await createNativeMenu(modelOf(commands(), registry));
      const item = itemWith('item', 'Delete Row');
      menu.update(documentState({ commandTitles: { 'table.deleteRow': 'Delete 3 Rows' } }));
      expect(item.text).toBe('Delete 3 Rows');
      menu.update(documentState({ commandTitles: {} }));
      expect(item.text).toBe('Delete Row');
    });

    it('disables an item that isn’t in enabledCommands', async () => {
      const menu = await createNativeMenu(modelOf(commands(), registered()));
      const link = itemWith('item', 'Link…');
      menu.update(documentState({ enabledCommands: [] }));
      expect(link.enabled).toBe(false);
      menu.update(documentState({ enabledCommands: ['format.link'] }));
      expect(link.enabled).toBe(true);
    });

    it('draws a command with nothing to follow as a plain item, under its menu', async () => {
      const registry = registered();
      await createNativeMenu(modelOf(commands(), registry));
      const rows = itemWith('submenu', 'Format').options['items'] as unknown[];
      expect(rows[0]).toBe(itemWith('check', 'Bold'));
      expect(rows[1]).toEqual({ item: 'Separator' });
      expect(rows[2]).toBe(itemWith('item', 'Link…'));
      const clear = rows[3] as { text: string; action: () => void };
      expect(clear.text).toBe('Clear');
      clear.action();
      expect(registry.run).toHaveBeenCalledWith('format.clear');
    });
  });

  it('gives the menu bar copies, so the table keeps its actions for the keys', async () => {
    // Tauri deletes the action from the options it is given.
    const c = commands();
    const model = modelOf(c);
    await createNativeMenu(model);
    for (const item of made.items) {
      for (const option of (item.options['items'] ?? []) as Record<string, unknown>[]) {
        delete option['action'];
      }
    }
    const stop = installShortcuts(model);
    press('KeyS', { metaKey: true });
    expect(c.save).toHaveBeenCalledOnce();
    stop();
  });
});

describe('browser shortcuts', () => {
  it('runs the menu bar’s commands from the keyboard', () => {
    const c = commands();
    const stop = installShortcuts(modelOf(c));
    expect(press('KeyE', { metaKey: true, shiftKey: true })).toBe(true);
    expect(c.toggleTracking).toHaveBeenCalledOnce();
    // Option changes the character typed, so the key's position decides.
    press('Digit3', { metaKey: true, altKey: true, key: '£' });
    expect(c.setView).toHaveBeenCalledWith('raw');
    // Redlines is there for any document, so its key never waits for redlines.
    press('Digit2', { metaKey: true, altKey: true, key: '™' });
    expect(c.setView).toHaveBeenLastCalledWith('redlines');
    press('Digit1', { metaKey: true, altKey: true, key: '¡' });
    expect(c.setView).toHaveBeenLastCalledWith('clean');
    // Simple is no view of the menu: no key shows it, and the fourth key is free.
    expect(press('Digit4', { metaKey: true, altKey: true, key: '¢' })).toBe(false);
    expect(c.setView).toHaveBeenCalledTimes(3);
    press('KeyS', { metaKey: true, ctrlKey: true });
    expect(c.toggleSidebar).toHaveBeenCalledOnce();
    expect(c.save).not.toHaveBeenCalled();
    press('KeyS', { metaKey: true });
    expect(c.save).toHaveBeenCalledOnce();
    press('BracketRight', { metaKey: true, altKey: true });
    expect(c.nextChange).toHaveBeenCalledOnce();
    stop();
  });

  it('in a browser, leaves ⌘=, ⌘− and ⌘0 to it, and steps the text with ⌃⌘= (also as +), ⌃⌘− and ⌃⌘0', () => {
    const c = commands();
    const stop = installShortcuts(modelOf(c));
    expect(press('Equal', { metaKey: true, key: '=' })).toBe(false);
    expect(press('Equal', { metaKey: true, shiftKey: true, key: '+' })).toBe(false);
    expect(press('Minus', { metaKey: true })).toBe(false);
    expect(press('Digit0', { metaKey: true })).toBe(false);
    expect(c.zoomIn).not.toHaveBeenCalled();
    expect(c.zoomOut).not.toHaveBeenCalled();
    expect(c.actualSize).not.toHaveBeenCalled();
    press('Equal', { metaKey: true, ctrlKey: true, shiftKey: true, key: '+' });
    press('Equal', { metaKey: true, ctrlKey: true, key: '=' });
    expect(c.biggerText).toHaveBeenCalledTimes(2);
    press('Minus', { metaKey: true, ctrlKey: true });
    expect(c.smallerText).toHaveBeenCalledOnce();
    press('Digit0', { metaKey: true, ctrlKey: true });
    expect(c.actualTextSize).toHaveBeenCalledOnce();
    // ⇧⌘0 is nobody's.
    expect(press('Digit0', { metaKey: true, shiftKey: true })).toBe(false);
    expect(c.actualTextSize).toHaveBeenCalledOnce();
    press('KeyV', { metaKey: true, shiftKey: true });
    expect(c.pastePlain).toHaveBeenCalledOnce();
    stop();
  });

  it('leaves other keys alone', () => {
    const c = commands();
    const stop = installShortcuts(modelOf(c));
    expect(press('KeyE', { metaKey: true })).toBe(false);
    expect(press('KeyS', { ctrlKey: true })).toBe(false);
    expect(press('Digit4', { metaKey: true })).toBe(false);
    expect(c.toggleTracking).not.toHaveBeenCalled();
    expect(c.save).not.toHaveBeenCalled();
    expect(c.setView).not.toHaveBeenCalled();
    stop();
  });

  it('leaves a registered command’s key to the editor’s keymap, so it can’t fire twice', () => {
    const registry = registryOf([
      { id: 'format.bold', title: 'Bold', menu: 'format', shortcut: 'Mod-b', run: () => true },
    ]);
    const stop = installShortcuts(modelOf(commands(), registry));
    expect(press('KeyB', { metaKey: true })).toBe(false);
    expect(registry.run).not.toHaveBeenCalled();
    stop();
  });

  it('leaves a key that something has already handled, such as the editor’s keymap', () => {
    const c = commands();
    const stop = installShortcuts(modelOf(c));
    const handle = (event: Event) => event.preventDefault();
    document.body.addEventListener('keydown', handle);
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyS',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    document.body.removeEventListener('keydown', handle);
    expect(c.save).not.toHaveBeenCalled();
    stop();
  });

  it('leaves ⌘N and ⌘Q to the browser, as it always has', () => {
    const c = commands();
    const stop = installShortcuts(modelOf(c));
    expect(press('KeyN', { metaKey: true })).toBe(false);
    expect(press('KeyQ', { metaKey: true })).toBe(false);
    expect(c.create).not.toHaveBeenCalled();
    expect(c.quit).not.toHaveBeenCalled();
    stop();
  });

  it('stops when asked', () => {
    const c = commands();
    installShortcuts(modelOf(c))();
    expect(press('KeyS', { metaKey: true })).toBe(false);
    expect(c.save).not.toHaveBeenCalled();
  });
});

describe('+ typed as a key', () => {
  const type = (init: KeyboardEventInit, target: EventTarget = window) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('runs Zoom In for ⌘+ and Larger Text for ⌃⌘+, from any key, Shift or not', () => {
    const c = commands();
    const stop = installPlusKeys(modelOf(c), () => documentState());
    // A US keyboard: Shift and the = key.
    expect(type({ key: '+', code: 'Equal', shiftKey: true, metaKey: true })).toBe(true);
    // A German keyboard: the + key, which is the right bracket's place.
    expect(type({ key: '+', code: 'BracketRight', metaKey: true })).toBe(true);
    expect(c.zoomIn).toHaveBeenCalledTimes(2);
    expect(c.biggerText).not.toHaveBeenCalled();
    expect(type({ key: '+', code: 'Equal', shiftKey: true, metaKey: true, ctrlKey: true })).toBe(
      true,
    );
    expect(type({ key: '+', code: 'BracketRight', metaKey: true, ctrlKey: true })).toBe(true);
    expect(c.biggerText).toHaveBeenCalledTimes(2);
    expect(c.zoomIn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('leaves = to the menu bar, and + at a limit', () => {
    const c = commands();
    let state = documentState();
    const stop = installPlusKeys(modelOf(c), () => state);
    expect(type({ key: '=', code: 'Equal', metaKey: true })).toBe(false);
    expect(c.zoomIn).not.toHaveBeenCalled();
    state = documentState({ zoom: 2 });
    expect(type({ key: '+', code: 'Equal', shiftKey: true, metaKey: true })).toBe(false);
    expect(c.zoomIn).not.toHaveBeenCalled();
    // The text size has its own limit.
    expect(type({ key: '+', metaKey: true, ctrlKey: true })).toBe(true);
    state = documentState({ textSize: 2 });
    expect(type({ key: '+', metaKey: true, ctrlKey: true })).toBe(false);
    expect(c.biggerText).toHaveBeenCalledOnce();
    stop();
  });

  it('leaves + without ⌘, or with ⌥, and what is taken already', () => {
    const c = commands();
    // Something nearer the key takes it first, as the editor's keymap would.
    const taken = (event: Event) => event.preventDefault();
    window.addEventListener('keydown', taken);
    const stop = installPlusKeys(modelOf(c), () => documentState());
    type({ key: '+', metaKey: true });
    expect(c.zoomIn).not.toHaveBeenCalled();
    window.removeEventListener('keydown', taken);
    expect(type({ key: '+', shiftKey: true })).toBe(false);
    expect(type({ key: '+', ctrlKey: true })).toBe(false);
    expect(type({ key: '+', metaKey: true, altKey: true })).toBe(false);
    expect(c.zoomIn).not.toHaveBeenCalled();
    stop();
    expect(type({ key: '+', metaKey: true })).toBe(false);
  });

  it('zooms once from a comment box or the find bar', () => {
    const c = commands();
    const stop = installPlusKeys(modelOf(c), () => documentState());
    const box = document.body.appendChild(document.createElement('textarea'));
    const find = document.body.appendChild(document.createElement('input'));
    expect(type({ key: '+', code: 'Equal', shiftKey: true, metaKey: true }, box)).toBe(true);
    expect(type({ key: '+', code: 'BracketRight', metaKey: true }, find)).toBe(true);
    expect(c.zoomIn).toHaveBeenCalledTimes(2);
    box.remove();
    find.remove();
    stop();
  });
});
