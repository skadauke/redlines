// @vitest-environment happy-dom
import type { CommandRegistry, EditorCommand } from '@redlines/editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appMenuModel, type MenuCommands, type MenuState } from './menu-model.ts';
import { createNativeMenu, installShortcuts } from './native-menu.ts';

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
}
const made = vi.hoisted(() => ({
  items: [] as FakeItem[],
  /** Told the text of the submenu made the Mac's Window menu. */
  onWindowsMenu: undefined as ((text: string | undefined) => void) | undefined,
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

      constructor(options: Options) {
        this.options = options;
        this.text = options.text;
        this.accelerator = options.accelerator;
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

      setAsAppMenu() {
        made.appMenus.push(this);
        return Promise.resolve(made.previousMenu);
      }

      setAsWindowsMenuForNSApp() {
        made.onWindowsMenu?.(this.text);
        return Promise.resolve();
      }
    };
  return {
    CheckMenuItem: fake('check'),
    MenuItem: fake('item'),
    Submenu: fake('submenu'),
    Menu: fake('menu'),
  };
});

function commands() {
  return {
    create: vi.fn(),
    open: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    quit: vi.fn(),
    setView: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleTracking: vi.fn(),
    openReview: vi.fn(),
    nextChange: vi.fn(),
    previousChange: vi.fn(),
    setTheme: vi.fn(),
    toggleIconRotation: vi.fn(),
    checkForUpdates: vi.fn(),
    toggleUpdateChecks: vi.fn(),
  } satisfies MenuCommands;
}

function registryOf(list: readonly EditorCommand[] = []) {
  return {
    register: () => () => {},
    list: () => list,
    run: vi.fn(() => true),
  } satisfies CommandRegistry;
}

/** The app's menus for these commands and the plugins' registered commands. */
const modelOf = (c: MenuCommands, registry: CommandRegistry = registryOf()) =>
  appMenuModel(c, registry);

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
  lightTheme: 'default',
  darkTheme: 'default',
  rotateIcon: true,
  checkForUpdates: true,
  activeCommands: [],
  enabledCommands: [],
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
    const menu = await createNativeMenu(modelOf(commands()), null);
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

  it('keeps reviewing for documents with redlines', async () => {
    const menu = await createNativeMenu(modelOf(commands()), null);
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

  it('shows the build tag in About Redlines, and in no item’s label', async () => {
    await createNativeMenu(modelOf(commands()), {
      name: 'Redlines',
      version: '0.1.0-dev',
      build: '1a2b3c4-20261101.1430',
    });
    // The Mac's panel reads "Version 0.1.0-dev (1a2b3c4-20261101.1430)".
    expect(appMenu()[0]).toEqual({
      item: {
        About: { name: 'Redlines', version: '0.1.0-dev', shortVersion: '1a2b3c4-20261101.1430' },
      },
      text: 'About Redlines',
    });
    for (const item of made.items) expect(String(item.text)).not.toContain('1a2b3c4');
  });

  it('leaves About to the bundle when the build tag can’t be read', async () => {
    await createNativeMenu(modelOf(commands()), null);
    expect(appMenu()[0]).toEqual({ item: { About: null }, text: 'About Redlines' });
  });

  it('checks for updates, and keeps the automatic checks’ setting checked as it is', async () => {
    const c = commands();
    const menu = await createNativeMenu(modelOf(c), null);
    const checkNow = appMenu()[1] as { text: string; action: () => void };
    expect(checkNow.text).toBe('Check for Updates…');
    checkNow.action();
    expect(c.checkForUpdates).toHaveBeenCalledOnce();

    const automatic = itemWith('check', 'Check for Updates Automatically');
    expect(itemWith('submenu', 'Settings').options['items']).toContain(automatic);
    (automatic.options['action'] as () => void)();
    expect(c.toggleUpdateChecks).toHaveBeenCalledOnce();
    menu.update(documentState({ checkForUpdates: true }));
    expect(automatic.checked).toBe(true);
    menu.update(documentState({ checkForUpdates: false }));
    expect(automatic.checked).toBe(false);
  });

  it('puts a clicked check back as the state says', async () => {
    const menu = await createNativeMenu(modelOf(commands()), null);
    const redlines = itemWith('check', 'Redlines');
    menu.update(documentState({ view: 'redlines' }));
    // The Mac flips the check of the item that was clicked; the view stays as it was.
    redlines.checked = false;
    (redlines.options['action'] as () => void)();
    expect(redlines.checked).toBe(true);
  });

  it('sends the menu only what changed', async () => {
    const menu = await createNativeMenu(modelOf(commands()), null);
    const raw = itemWith('check', 'Raw');
    const setChecked = vi.spyOn(raw as unknown as { setChecked(on: boolean): void }, 'setChecked');
    menu.update(documentState({ view: 'clean' }));
    menu.update(documentState({ view: 'clean', tracking: true }));
    expect(setChecked).toHaveBeenCalledOnce();
    menu.update(documentState({ view: 'raw' }));
    expect(setChecked).toHaveBeenCalledTimes(2);
  });

  it('follows the sidebar in the label of Show Files', async () => {
    const menu = await createNativeMenu(modelOf(commands()), null);
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
    const menu = await createNativeMenu(modelOf(commands()), null);
    expect(made.appMenus).toEqual([]);
    expect(setAsWindows).not.toHaveBeenCalled();

    await menu.activate();
    await menu.activate();
    expect(made.appMenus).toHaveLength(2);
    expect(setAsWindows).toHaveBeenCalledTimes(2);
    expect(setAsWindows).toHaveBeenCalledWith('Window');
  });

  it('lets go of the menu that was the app’s, which Tauri hands back each time', async () => {
    const previous = { close: vi.fn(() => Promise.resolve()) };
    made.previousMenu = previous;
    const menu = await createNativeMenu(modelOf(commands()), null);
    await menu.activate();
    expect(previous.close).toHaveBeenCalledOnce();
  });

  it('draws no empty menus', async () => {
    await createNativeMenu(modelOf(commands()), null);
    const bar = made.items.find((item) => item.kind === 'menu');
    const titles = (bar?.options['items'] as FakeItem[]).map((item) => item.text);
    expect(titles).toEqual(['Redlines', 'File', 'Edit', 'View', 'Review', 'Window']);
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
      const menu = await createNativeMenu(modelOf(commands(), registry), null);
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

    it('disables an item that isn’t in enabledCommands', async () => {
      const menu = await createNativeMenu(modelOf(commands(), registered()), null);
      const link = itemWith('item', 'Link…');
      menu.update(documentState({ enabledCommands: [] }));
      expect(link.enabled).toBe(false);
      menu.update(documentState({ enabledCommands: ['format.link'] }));
      expect(link.enabled).toBe(true);
    });

    it('draws a command with nothing to follow as a plain item, under its menu', async () => {
      const registry = registered();
      await createNativeMenu(modelOf(commands(), registry), null);
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
    await createNativeMenu(model, null);
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
    press('KeyS', { metaKey: true, ctrlKey: true });
    expect(c.toggleSidebar).toHaveBeenCalledOnce();
    expect(c.save).not.toHaveBeenCalled();
    press('KeyS', { metaKey: true });
    expect(c.save).toHaveBeenCalledOnce();
    press('BracketRight', { metaKey: true, altKey: true });
    expect(c.nextChange).toHaveBeenCalledOnce();
    stop();
  });

  it('leaves other keys alone', () => {
    const c = commands();
    const stop = installShortcuts(modelOf(c));
    expect(press('KeyE', { metaKey: true })).toBe(false);
    expect(press('KeyS', { ctrlKey: true })).toBe(false);
    expect(press('Digit3', { metaKey: true })).toBe(false);
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
