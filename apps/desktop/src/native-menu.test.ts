// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNativeMenu,
  installShortcuts,
  type MenuCommands,
  type MenuState,
} from './native-menu.ts';

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
const made = vi.hoisted(() => ({ items: [] as FakeItem[] }));

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
        return Promise.resolve(null);
      }

      setAsWindowsMenuForNSApp() {
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
    const menu = await createNativeMenu(commands(), null);
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
    const menu = await createNativeMenu(commands(), null);
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
    await createNativeMenu(commands(), {
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
    await createNativeMenu(commands(), null);
    expect(appMenu()[0]).toEqual({ item: { About: null }, text: 'About Redlines' });
  });

  it('checks for updates, and keeps the automatic checks’ setting checked as it is', async () => {
    const c = commands();
    const menu = await createNativeMenu(c, null);
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
});

describe('browser shortcuts', () => {
  it('runs the menu bar’s commands from the keyboard', () => {
    const c = commands();
    const stop = installShortcuts(c);
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
    const stop = installShortcuts(c);
    expect(press('KeyE', { metaKey: true })).toBe(false);
    expect(press('KeyS', { ctrlKey: true })).toBe(false);
    expect(press('Digit3', { metaKey: true })).toBe(false);
    expect(c.toggleTracking).not.toHaveBeenCalled();
    expect(c.save).not.toHaveBeenCalled();
    expect(c.setView).not.toHaveBeenCalled();
    stop();
  });
});
