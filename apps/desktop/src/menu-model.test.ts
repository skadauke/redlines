import type { CommandRegistry, EditorCommand } from '@redlines/editor';
import { describe, expect, it, vi } from 'vitest';
import {
  acceleratorFor,
  appMenuModel,
  drawnCommandsCheck,
  type ActionRow,
  type MenuCommands,
  type MenuModel,
  type MenuRow,
  type MenuState,
  type SubmenuRow,
} from './menu-model.ts';

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
    pastePlain: vi.fn(),
    biggerText: vi.fn(),
    smallerText: vi.fn(),
    actualTextSize: vi.fn(),
    nextChange: vi.fn(),
    previousChange: vi.fn(),
    checkForUpdates: vi.fn(),
    openPreferences: vi.fn(),
  } satisfies MenuCommands;
}

function registryOf(list: readonly EditorCommand[] = []) {
  return {
    register: () => () => {},
    list: () => list,
    run: vi.fn(() => true),
  } satisfies CommandRegistry;
}

const command = (id: string, overrides: Partial<EditorCommand> = {}): EditorCommand => ({
  id,
  title: id,
  run: () => true,
  ...overrides,
});

const state = (overrides: Partial<MenuState> = {}): MenuState => ({
  view: 'clean',
  tracking: false,
  hasRedlines: false,
  sidebarOpen: false,
  hasFile: true,
  viewing: false,
  recent: [],
  activeCommands: [],
  enabledCommands: [],
  ...overrides,
});

const rowsOf = (model: MenuModel, title: string): readonly MenuRow[] => {
  const menu = model.menus.find((candidate) => candidate.title === title);
  if (!menu) throw new Error(`no menu called ${title}`);
  return menu.rows;
};

/** A row as it reads in the menu: its name and accelerator, or `---` for a separator. */
const reads = (row: MenuRow): string | [string, string | undefined] => {
  if ('about' in row) return 'About Redlines';
  if ('item' in row) return row.item === 'Separator' ? '---' : (row.text ?? row.item);
  if ('rows' in row) return `${row.text} ›`;
  return [row.text, row.accelerator];
};
const readsAll = (model: MenuModel, title: string) => rowsOf(model, title).map(reads);

const actionRow = (model: MenuModel, title: string, text: string): ActionRow => {
  const found = rowsOf(model, title).find(
    (row): row is ActionRow => 'action' in row && row.text === text,
  );
  if (!found) throw new Error(`no ${text} in ${title}`);
  return found;
};

describe('Open Recent', () => {
  const recentRows = (c: MenuCommands, recent: readonly string[]) => {
    const model = appMenuModel(c, registryOf());
    const submenu = rowsOf(model, 'File').find(
      (row): row is SubmenuRow => 'rows' in row && row.text === 'Open Recent',
    );
    if (!submenu?.dynamic) throw new Error('Open Recent is not dynamic');
    return submenu.dynamic.rows(state({ recent }));
  };

  it('lists the files by name, newest first, and opens the one chosen', () => {
    const c = commands();
    const rows = recentRows(c, ['/docs/plan.md', '/notes/old.md']);
    expect(rows.map(reads)).toEqual([
      ['plan.md', undefined],
      ['old.md', undefined],
      '---',
      ['Clear Menu', undefined],
    ]);
    (rows[1] as ActionRow).action();
    expect(c.openRecent).toHaveBeenCalledWith('/notes/old.md');
    (rows[3] as ActionRow).action();
    expect(c.clearRecent).toHaveBeenCalledOnce();
  });

  it('has only a greyed-out Clear Menu when there is nothing', () => {
    const rows = recentRows(commands(), []);
    expect(rows.map(reads)).toEqual([['Clear Menu', undefined]]);
    expect((rows[0] as ActionRow).disabled).toBe(true);
  });

  it('says it changed when the list does', () => {
    const model = appMenuModel(commands(), registryOf());
    const submenu = rowsOf(model, 'File').find((row): row is SubmenuRow => 'dynamic' in row);
    const key = (recent: string[]) => submenu?.dynamic?.key(state({ recent }));
    expect(key(['/a.md'])).toBe(key(['/a.md']));
    expect(key(['/a.md'])).not.toBe(key(['/b.md', '/a.md']));
  });

  it('only enables Reveal in Finder for a document that is a file', () => {
    const model = appMenuModel(commands(), registryOf());
    const reveal = actionRow(model, 'File', 'Reveal in Finder');
    expect(reveal.enabled?.(state({ hasFile: true }))).toBe(true);
    expect(reveal.enabled?.(state({ hasFile: false }))).toBe(false);
  });
});

describe('while a viewer shows', () => {
  it('turns off saving, printing, renaming, Track Changes and the views', () => {
    const model = appMenuModel(commands(), registryOf());
    const off = [
      ['File', 'Save'],
      ['File', 'Save As…'],
      ['File', 'Rename…'],
      ['File', 'Print…'],
      ['View', 'Clean'],
      ['View', 'Raw'],
      ['Review', 'Track Changes'],
      ['Review', 'Review Changes'],
    ] as const;
    for (const [menu, text] of off) {
      const row = actionRow(model, menu, text);
      expect(row.enabled?.(state({ hasRedlines: true })), `${text} while editing`).not.toBe(false);
      expect(row.enabled?.(state({ hasRedlines: true, viewing: true })), text).toBe(false);
    }
    // Opening, new windows and the sidebar stay.
    expect(actionRow(model, 'File', 'Open…').enabled).toBeUndefined();
    expect(actionRow(model, 'View', 'Show Files').enabled).toBeUndefined();
  });
});

describe('the menu model', () => {
  it('keeps every item the v0.1 menu had', () => {
    const model = appMenuModel(commands(), registryOf());
    expect(model.menus.map((menu) => menu.title)).toEqual([
      'Redlines',
      'File',
      'Edit',
      'View',
      'Review',
      'Window',
    ]);
    expect(readsAll(model, 'File')).toEqual([
      ['New', 'CmdOrCtrl+N'],
      ['Open…', 'CmdOrCtrl+O'],
      'Open Recent ›',
      '---',
      ['Save', 'CmdOrCtrl+S'],
      ['Save As…', 'Shift+CmdOrCtrl+S'],
      ['Rename…', undefined],
      ['Reveal in Finder', undefined],
      '---',
      'Close',
      '---',
      ['Print…', 'CmdOrCtrl+P'],
    ]);
    expect(readsAll(model, 'Edit')).toEqual([
      'Undo',
      'Redo',
      '---',
      'Cut',
      'Copy',
      'Paste',
      ['Paste as Plain Text', 'Shift+CmdOrCtrl+V'],
      'SelectAll',
    ]);
    expect(readsAll(model, 'View')).toEqual([
      ['Clean', 'Alt+CmdOrCtrl+1'],
      ['Redlines', 'Alt+CmdOrCtrl+2'],
      ['Raw', 'Alt+CmdOrCtrl+3'],
      '---',
      ['Larger Text', 'CmdOrCtrl+='],
      ['Smaller Text', 'CmdOrCtrl+-'],
      ['Actual Size', 'Shift+CmdOrCtrl+0'],
      '---',
      ['Show Files', 'Ctrl+Cmd+S'],
      'Enter Full Screen',
    ]);
    expect(readsAll(model, 'Review')).toEqual([
      ['Track Changes', 'Shift+CmdOrCtrl+E'],
      '---',
      ['Review Changes', undefined],
      ['Next Change', 'Alt+CmdOrCtrl+]'],
      ['Previous Change', 'Alt+CmdOrCtrl+['],
    ]);
    expect(readsAll(model, 'Redlines')).toEqual([
      'About Redlines',
      ['Check for Updates…', undefined],
      '---',
      ['Preferences…', 'CmdOrCtrl+,'],
      '---',
      'Services',
      '---',
      'Hide Redlines',
      'HideOthers',
      'ShowAll',
      '---',
      ['Quit Redlines', 'CmdOrCtrl+Q'],
    ]);
    expect(readsAll(model, 'Window')).toEqual(['Minimize', 'Zoom', '---', 'BringAllToFront']);
    expect(model.menus.find((menu) => menu.title === 'Window')?.windowsMenu).toBe(true);
  });

  it('runs each item’s command', () => {
    const c = commands();
    const model = appMenuModel(c, registryOf());
    const click = (menu: string, text: string) => actionRow(model, menu, text).action();
    click('File', 'New');
    expect(c.create).toHaveBeenCalledOnce();
    click('File', 'Open…');
    expect(c.open).toHaveBeenCalledOnce();
    click('File', 'Save');
    expect(c.save).toHaveBeenCalledOnce();
    click('File', 'Save As…');
    expect(c.saveAs).toHaveBeenCalledOnce();
    click('File', 'Rename…');
    expect(c.rename).toHaveBeenCalledOnce();
    click('File', 'Reveal in Finder');
    expect(c.revealInFinder).toHaveBeenCalledOnce();
    click('File', 'Print…');
    expect(c.print).toHaveBeenCalledOnce();
    click('View', 'Raw');
    expect(c.setView).toHaveBeenCalledWith('raw');
    click('View', 'Larger Text');
    expect(c.biggerText).toHaveBeenCalledOnce();
    click('View', 'Smaller Text');
    expect(c.smallerText).toHaveBeenCalledOnce();
    click('View', 'Actual Size');
    expect(c.actualTextSize).toHaveBeenCalledOnce();
    click('Edit', 'Paste as Plain Text');
    expect(c.pastePlain).toHaveBeenCalledOnce();
    click('View', 'Show Files');
    expect(c.toggleSidebar).toHaveBeenCalledOnce();
    click('Review', 'Track Changes');
    expect(c.toggleTracking).toHaveBeenCalledOnce();
    click('Review', 'Review Changes');
    expect(c.openReview).toHaveBeenCalledOnce();
    click('Review', 'Next Change');
    expect(c.nextChange).toHaveBeenCalledOnce();
    click('Review', 'Previous Change');
    expect(c.previousChange).toHaveBeenCalledOnce();
    click('Redlines', 'Preferences…');
    expect(c.openPreferences).toHaveBeenCalledOnce();
    click('Redlines', 'Quit Redlines');
    expect(c.quit).toHaveBeenCalledOnce();
  });

  it('says in the table what follows the state', () => {
    const model = appMenuModel(commands(), registryOf());
    const redlines = actionRow(model, 'View', 'Redlines');
    expect(redlines.checked?.(state({ view: 'redlines' }))).toBe(true);
    expect(redlines.checked?.(state({ view: 'raw' }))).toBe(false);
    // A disabled item takes its shortcut with it, and the Redlines view is there for any document;
    // only a viewer in place of the editor turns it off.
    expect(redlines.enabled?.(state({ hasRedlines: false }))).toBe(true);

    const tracking = actionRow(model, 'Review', 'Track Changes');
    expect(tracking.checked?.(state({ tracking: true }))).toBe(true);

    const next = actionRow(model, 'Review', 'Next Change');
    expect(next.enabled?.(state({ hasRedlines: false }))).toBe(false);
    expect(next.enabled?.(state({ hasRedlines: true }))).toBe(true);

    const files = actionRow(model, 'View', 'Show Files');
    expect(files.textFor?.(state({ sidebarOpen: false }))).toBe('Show Files');
    expect(files.textFor?.(state({ sidebarOpen: true }))).toBe('Hide Files');
  });

  it('lists registered commands under their menu, in order, with separators between groups', () => {
    const model = appMenuModel(
      commands(),
      registryOf([
        command('format.bold', {
          title: 'Bold',
          menu: 'format',
          group: 'inline',
          shortcut: 'Mod-b',
        }),
        command('block.h1', { title: 'Heading 1', menu: 'paragraph', shortcut: 'Mod-1' }),
        command('format.italic', { title: 'Italic', menu: 'format', group: 'inline' }),
        command('format.link', {
          title: 'Link…',
          menu: 'format',
          group: 'link',
          shortcut: 'Mod-k',
        }),
        command('format.clear', { title: 'Clear Formatting', menu: 'format' }),
        command('find.open', { title: 'Find', menu: 'edit', shortcut: 'Mod-f' }),
        command('file.rename', { title: 'Rename…', menu: 'file' }),
        command('view.larger', { title: 'Zoom In', menu: 'view', group: 'size' }),
        command('view.smaller', { title: 'Zoom Out', menu: 'view', group: 'size' }),
        // Keys only: an embedded pane's kind of command.
        command('hidden', { title: 'Hidden', shortcut: 'Mod-h' }),
      ]),
    );

    expect(model.menus.map((menu) => menu.title)).toEqual([
      'Redlines',
      'File',
      'Edit',
      'Format',
      'Paragraph',
      'View',
      'Review',
      'Window',
    ]);
    expect(readsAll(model, 'Format')).toEqual([
      ['Bold', 'CmdOrCtrl+B'],
      ['Italic', undefined],
      '---',
      ['Link…', 'CmdOrCtrl+K'],
      '---',
      ['Clear Formatting', undefined],
    ]);
    expect(readsAll(model, 'Paragraph')).toEqual([['Heading 1', 'CmdOrCtrl+1']]);
    // After what the menu already holds, set apart from it.
    expect(readsAll(model, 'Edit').slice(-3)).toEqual([
      'SelectAll',
      '---',
      ['Find', 'CmdOrCtrl+F'],
    ]);
    expect(readsAll(model, 'File').slice(-3)).toEqual([
      ['Print…', 'CmdOrCtrl+P'],
      '---',
      ['Rename…', undefined],
    ]);
    expect(readsAll(model, 'View').slice(-5)).toEqual([
      ['Show Files', 'Ctrl+Cmd+S'],
      'Enter Full Screen',
      '---',
      ['Zoom In', undefined],
      ['Zoom Out', undefined],
    ]);
    const everyRow = model.menus.flatMap((menu) => menu.rows.map(reads));
    expect(everyRow).not.toContainEqual(['Hidden', 'CmdOrCtrl+H']);
  });

  it('runs a registered command through the registry, and follows the ui state', () => {
    const registry = registryOf([
      command('format.bold', { title: 'Bold', menu: 'format', isActive: () => false }),
      command('format.link', { title: 'Link…', menu: 'format', isEnabled: () => false }),
      command('format.clear', { title: 'Clear', menu: 'format' }),
    ]);
    const model = appMenuModel(commands(), registry);

    const bold = actionRow(model, 'Format', 'Bold');
    bold.action();
    expect(registry.run).toHaveBeenCalledWith('format.bold');
    expect(bold.checked?.(state({ activeCommands: ['format.bold'] }))).toBe(true);
    expect(bold.checked?.(state())).toBe(false);
    expect(bold.enabled).toBeUndefined();

    const link = actionRow(model, 'Format', 'Link…');
    expect(link.checked).toBeUndefined();
    expect(link.enabled?.(state({ enabledCommands: ['format.link'] }))).toBe(true);
    expect(link.enabled?.(state())).toBe(false);

    const clear = actionRow(model, 'Format', 'Clear');
    expect(clear.checked).toBeUndefined();
    expect(clear.enabled).toBeUndefined();
  });

  it('leaves the keys of registered commands to the editor', () => {
    const model = appMenuModel(
      commands(),
      registryOf([command('format.bold', { menu: 'format', shortcut: 'Mod-b' })]),
    );
    expect(actionRow(model, 'Format', 'format.bold').keyInMenuOnly).toBe(true);
    expect(actionRow(model, 'File', 'Save').keyInMenuOnly).toBeUndefined();
  });
});

describe('drawnCommandsCheck', () => {
  /** A registry whose list can change, as a late plugin changes it. */
  const changing = (initial: EditorCommand[]) => {
    let list = initial;
    return {
      registry: { ...registryOf(), list: () => list },
      set: (next: EditorCommand[]) => {
        list = next;
      },
    };
  };

  it('is quiet while the commands are those the menu bar was drawn with', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bold = command('format.bold');
    const { registry, set } = changing([bold]);
    const check = drawnCommandsCheck(registry);
    check();
    // Another array, the same commands.
    set([bold]);
    check();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('says which command came too late, once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bold = command('format.bold');
    const { registry, set } = changing([bold]);
    const check = drawnCommandsCheck(registry);

    set([bold, command('format.late')]);
    check();
    check();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toContain('format.late');
    error.mockRestore();
  });

  it('says which command went after the menu bar was drawn', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { registry, set } = changing([command('format.bold')]);
    const check = drawnCommandsCheck(registry);

    set([]);
    check();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toContain('format.bold');
    error.mockRestore();
  });
});

describe('acceleratorFor', () => {
  it.each([
    ['Mod-b', 'CmdOrCtrl+B'],
    ['Mod-0', 'CmdOrCtrl+0'],
    ['Mod-6', 'CmdOrCtrl+6'],
    ['Mod-]', 'CmdOrCtrl+]'],
    ['Mod-[', 'CmdOrCtrl+['],
    ['Mod-\\', 'CmdOrCtrl+\\'],
    ['Ctrl-`', 'Ctrl+`'],
    ['Ctrl-Shift-`', 'Ctrl+Shift+`'],
    ['Mod-Alt-q', 'CmdOrCtrl+Alt+Q'],
    ['Mod-Shift-g', 'CmdOrCtrl+Shift+G'],
    ['Mod--', 'CmdOrCtrl+-'],
    ['Mod-=', 'CmdOrCtrl+='],
    ['Cmd-Enter', 'Cmd+Enter'],
    ['Meta-ArrowUp', 'Cmd+ArrowUp'],
    ['Control-Alt-x', 'Ctrl+Alt+X'],
    ['c-a-s-m-k', 'Ctrl+Alt+Shift+Cmd+K'],
  ])('writes %s as %s', (shortcut, accelerator) => {
    expect(acceleratorFor(shortcut)).toBe(accelerator);
  });
});
