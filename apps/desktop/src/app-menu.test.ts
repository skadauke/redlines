// The application menu that native-menu.ts builds: About Redlines with the build tag, and the
// updates. Tauri's menu classes are stand-ins here that keep what each item was made with.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeMenu, type MenuCommands, type MenuState } from './native-menu.ts';

interface Made {
  kind: string;
  options: Record<string, unknown>;
  setChecked: ReturnType<typeof vi.fn>;
}

const made: Made[] = [];

vi.mock('@tauri-apps/api/menu', () => {
  const item = (kind: string) => ({
    new: (options: Record<string, unknown>) => {
      const entry = {
        kind,
        options,
        setChecked: vi.fn(() => Promise.resolve()),
        setEnabled: vi.fn(() => Promise.resolve()),
        setText: vi.fn(() => Promise.resolve()),
        setAsAppMenu: vi.fn(() => Promise.resolve()),
        setAsWindowsMenuForNSApp: vi.fn(() => Promise.resolve()),
      };
      made.push(entry);
      return Promise.resolve(entry);
    },
  });
  return {
    CheckMenuItem: item('check'),
    MenuItem: item('item'),
    Submenu: item('submenu'),
    Menu: item('menu'),
  };
});

afterEach(() => {
  made.length = 0;
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

const STATE: MenuState = {
  view: 'redlines',
  tracking: false,
  hasRedlines: true,
  sidebarOpen: false,
  lightTheme: 'default',
  darkTheme: 'default',
  rotateIcon: true,
  checkForUpdates: true,
};

/** The items of the submenu made with this text. */
function submenu(text: string): Record<string, unknown>[] {
  const found = made.find((entry) => entry.kind === 'submenu' && entry.options['text'] === text);
  if (!found) throw new Error(`no ${text} menu`);
  return found.options['items'] as Record<string, unknown>[];
}

const check = (text: string) => {
  const found = made.find((entry) => entry.kind === 'check' && entry.options['text'] === text);
  if (!found) throw new Error(`no ${text} item`);
  return found;
};

describe('the application menu', () => {
  it('shows the build tag in About Redlines, and nowhere else', async () => {
    await createNativeMenu(commands(), {
      name: 'Redlines',
      version: '0.1.0-dev',
      build: '1a2b3c4-20261101.1430',
    });
    const [about] = submenu('Redlines');
    expect(about).toEqual({
      item: {
        About: { name: 'Redlines', version: '0.1.0-dev', shortVersion: '1a2b3c4-20261101.1430' },
      },
      text: 'About Redlines',
    });
    // No item's label carries it: the About panel alone shows it.
    for (const entry of made) expect(String(entry.options['text'])).not.toContain('1a2b3c4');
  });

  it('leaves About to the bundle when the build tag can’t be read', async () => {
    await createNativeMenu(commands(), null);
    expect(submenu('Redlines')[0]).toEqual({ item: { About: null }, text: 'About Redlines' });
  });

  it('checks for updates from the menu, and keeps the setting’s check up to date', async () => {
    const c = commands();
    const menu = await createNativeMenu(c, null);
    const [, checkNow] = submenu('Redlines');
    expect(checkNow?.['text']).toBe('Check for Updates…');
    (checkNow?.['action'] as () => void)();
    expect(c.checkForUpdates).toHaveBeenCalledOnce();

    const automatic = check('Check for Updates Automatically');
    expect(submenu('Settings')).toContain(automatic);
    (automatic.options['action'] as () => void)();
    expect(c.toggleUpdateChecks).toHaveBeenCalledOnce();

    menu.update(STATE);
    expect(automatic.setChecked).toHaveBeenLastCalledWith(true);
    menu.update({ ...STATE, checkForUpdates: false });
    expect(automatic.setChecked).toHaveBeenLastCalledWith(false);
  });
});
