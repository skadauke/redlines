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
    switchLook: vi.fn(),
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

const rowsOf = (model: MenuModel, title: string): readonly MenuRow[] => {
  const menu = model.menus.find((candidate) => candidate.title === title);
  if (!menu) throw new Error(`no menu called ${title}`);
  return menu.rows;
};

/** A row as it reads in the menu: its name and accelerator, or `---` for a separator. */
const reads = (row: MenuRow): string | [string, string | undefined] => {
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

describe('Simple Look (#330)', () => {
  const row = () => actionRow(appMenuModel(commands(), registryOf()), 'View', 'Simple Look');

  it('is on while Redlines shows its simple look, and off in the full markup', () => {
    expect(row().checked?.(state({ view: 'simple' }))).toBe(true);
    expect(row().checked?.(state({ view: 'redlines' }))).toBe(false);
  });

  it('can be chosen only while Redlines shows: Clean and Raw have no look to switch', () => {
    expect(row().enabled?.(state({ view: 'simple' }))).toBe(true);
    expect(row().enabled?.(state({ view: 'redlines' }))).toBe(true);
    expect(row().enabled?.(state({ view: 'clean' }))).toBe(false);
    expect(row().enabled?.(state({ view: 'raw' }))).toBe(false);
    expect(row().checked?.(state({ view: 'clean' }))).toBe(false);
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
      'Help',
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
      ['Undo', 'CmdOrCtrl+Z'],
      ['Redo', 'Shift+CmdOrCtrl+Z'],
      '---',
      'Cut',
      'Copy',
      'Paste',
      ['Paste as Plain Text', 'Shift+CmdOrCtrl+V'],
      'SelectAll',
    ]);
    // Simple Look is Redlines' simple look, a switch below the three views (#330).
    expect(readsAll(model, 'View')).toEqual([
      ['Clean', 'Alt+CmdOrCtrl+1'],
      ['Redlines', 'Alt+CmdOrCtrl+2'],
      ['Raw', 'Alt+CmdOrCtrl+3'],
      '---',
      ['Simple Look', 'Alt+CmdOrCtrl+4'],
      '---',
      ['Actual Size', 'CmdOrCtrl+0'],
      ['Zoom In', 'CmdOrCtrl+='],
      ['Zoom Out', 'CmdOrCtrl+-'],
      '---',
      ['Actual Text Size', 'Ctrl+Cmd+0'],
      ['Larger Text', 'Ctrl+Cmd+='],
      ['Smaller Text', 'Ctrl+Cmd+-'],
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
      '---',
      ['Show Resolved Comments', undefined],
    ]);
    expect(readsAll(model, 'Redlines')).toEqual([
      ['About Redlines', undefined],
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
    expect(readsAll(model, 'Help')).toEqual([['Show Agent Logs', undefined]]);
    expect(model.menus.find((menu) => menu.title === 'Help')?.helpMenu).toBe(true);
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
    expect(c.setView).toHaveBeenLastCalledWith('raw');
    // Redlines, which the editor shows in the look last chosen with a click on a change bar.
    click('View', 'Redlines');
    expect(c.setView).toHaveBeenLastCalledWith('redlines');
    expect(c.setView).toHaveBeenCalledTimes(2);
    // The simple look is no view: its row switches the look, and shows no other view.
    click('View', 'Simple Look');
    expect(c.switchLook).toHaveBeenCalledOnce();
    expect(c.setView).toHaveBeenCalledTimes(2);
    click('View', 'Larger Text');
    expect(c.biggerText).toHaveBeenCalledOnce();
    click('View', 'Smaller Text');
    expect(c.smallerText).toHaveBeenCalledOnce();
    click('View', 'Actual Text Size');
    expect(c.actualTextSize).toHaveBeenCalledOnce();
    click('View', 'Actual Size');
    expect(c.actualSize).toHaveBeenCalledOnce();
    click('View', 'Zoom In');
    expect(c.zoomIn).toHaveBeenCalledOnce();
    click('View', 'Zoom Out');
    expect(c.zoomOut).toHaveBeenCalledOnce();
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
    click('Review', 'Show Resolved Comments');
    expect(c.toggleResolved).toHaveBeenCalledOnce();
    click('Review', 'Previous Change');
    expect(c.previousChange).toHaveBeenCalledOnce();
    click('Redlines', 'Preferences…');
    expect(c.openPreferences).toHaveBeenCalledOnce();
    click('Help', 'Show Agent Logs');
    expect(c.showAgentLogs).toHaveBeenCalledOnce();
    click('Redlines', 'Quit Redlines');
    expect(c.quit).toHaveBeenCalledOnce();
  });

  it('says in the table what follows the state', () => {
    const model = appMenuModel(commands(), registryOf());
    const redlines = actionRow(model, 'View', 'Redlines');
    expect(redlines.checked?.(state({ view: 'redlines' }))).toBe(true);
    // The simple look is Redlines too: the check stays on the one item.
    expect(redlines.checked?.(state({ view: 'simple' }))).toBe(true);
    expect(redlines.checked?.(state({ view: 'raw' }))).toBe(false);
    expect(redlines.checked?.(state({ view: 'clean' }))).toBe(false);
    // A disabled item takes its shortcut with it, and the Redlines view is there for any document.
    expect(redlines.enabled?.(state({ hasRedlines: false })) ?? true).toBe(true);

    const tracking = actionRow(model, 'Review', 'Track Changes');
    expect(tracking.checked?.(state({ tracking: true }))).toBe(true);

    const resolved = actionRow(model, 'Review', 'Show Resolved Comments');
    expect(resolved.checked?.(state({ showResolved: true }))).toBe(true);
    expect(resolved.checked?.(state({ showResolved: false }))).toBe(false);
    // Any document with a rail can show them.
    expect(resolved.enabled?.(state({ hasRedlines: false })) ?? true).toBe(true);

    const next = actionRow(model, 'Review', 'Next Change');
    expect(next.enabled?.(state({ hasRedlines: false }))).toBe(false);
    expect(next.enabled?.(state({ hasRedlines: true }))).toBe(true);

    const files = actionRow(model, 'View', 'Show Files');
    expect(files.textFor?.(state({ sidebarOpen: false }))).toBe('Show Files');
    expect(files.textFor?.(state({ sidebarOpen: true }))).toBe('Hide Files');
  });

  it('enables the size rows between the ends', () => {
    const model = appMenuModel(commands(), registryOf());
    const enabledAt = (text: string, overrides: Partial<MenuState>) =>
      actionRow(model, 'View', text).enabled?.(state(overrides));
    expect(enabledAt('Actual Size', { zoom: 1 })).toBe(false);
    expect(enabledAt('Actual Size', { zoom: 1.25 })).toBe(true);
    expect(enabledAt('Zoom In', { zoom: 2 })).toBe(false);
    expect(enabledAt('Zoom In', { zoom: 1.75 })).toBe(true);
    expect(enabledAt('Zoom Out', { zoom: 0.8 })).toBe(false);
    expect(enabledAt('Zoom Out', { zoom: 0.9 })).toBe(true);
    expect(enabledAt('Actual Text Size', { textSize: 1 })).toBe(false);
    expect(enabledAt('Larger Text', { textSize: 4 })).toBe(false);
    // Past 200%, where the window zoom stops: the text goes on to 400%.
    for (const size of [2, 2.5, 3]) expect(enabledAt('Larger Text', { textSize: size })).toBe(true);
    expect(enabledAt('Smaller Text', { textSize: 0.8 })).toBe(false);
    for (const text of ['Actual Text Size', 'Larger Text', 'Smaller Text']) {
      expect(enabledAt(text, { textSize: 1.37 }), text).toBe(true);
    }
    // The zoom does not enable the text rows, nor the text size the zoom rows.
    expect(enabledAt('Actual Text Size', { zoom: 1.5 })).toBe(false);
    expect(enabledAt('Actual Size', { textSize: 1.5 })).toBe(false);
  });

  it('disables the zoom rows while the page has no zoom, and not the text rows', () => {
    const model = appMenuModel(commands(), registryOf());
    const enabled = (text: string) =>
      actionRow(model, 'View', text).enabled?.(state({ zoom: null, textSize: 1.25 }));
    for (const text of ['Actual Size', 'Zoom In', 'Zoom Out'])
      expect(enabled(text), text).toBe(false);
    expect(enabled('Larger Text')).toBe(true);
  });

  it('leaves the zoom keys to the browser', () => {
    const rows = [
      'Actual Size',
      'Zoom In',
      'Zoom Out',
      'Actual Text Size',
      'Larger Text',
      'Smaller Text',
    ];
    const inBrowser = appMenuModel(commands(), registryOf(), { browser: true });
    const inApp = appMenuModel(commands(), registryOf());
    for (const text of rows) {
      const zoom = !text.includes('Text');
      expect(actionRow(inBrowser, 'View', text).keyInMenuOnly, text).toBe(zoom ? true : undefined);
      expect(actionRow(inApp, 'View', text).keyInMenuOnly, text).toBeUndefined();
    }
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
        command('table.insertRowBelow', {
          title: 'Insert Row Below',
          menu: 'table',
          shortcut: 'Mod-Enter',
          isEnabled: () => false,
        }),
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
      'Table',
      'View',
      'Review',
      'Window',
      'Help',
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
    expect(readsAll(model, 'Table')).toEqual([['Insert Row Below', 'CmdOrCtrl+Enter']]);
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

describe('Undo and Redo in the Edit menu', () => {
  const rows = () => {
    const c = commands();
    const model = appMenuModel(c, registryOf());
    return { c, undo: actionRow(model, 'Edit', 'Undo'), redo: actionRow(model, 'Edit', 'Redo') };
  };

  it("are the app's own items, whose keys the editor and the field keep to themselves", () => {
    const { c, undo, redo } = rows();
    expect(undo.keyInMenuOnly).toBe(true);
    expect(redo.keyInMenuOnly).toBe(true);
    undo.action();
    redo.action();
    expect(c.undo).toHaveBeenCalledOnce();
    expect(c.redo).toHaveBeenCalledOnce();
  });

  it("say what the document's history takes back and brings back", () => {
    const { undo, redo } = rows();
    const claude = state({
      undo: 'Claude’s Changes',
      redo: 'Typing',
      canUndo: true,
      canRedo: true,
    });
    expect(undo.textFor?.(claude)).toBe('Undo Claude’s Changes');
    expect(redo.textFor?.(claude)).toBe('Redo Typing');
    expect(undo.textFor?.(state({ undo: null, canUndo: true }))).toBe('Undo');
    expect(redo.textFor?.(state())).toBe('Redo');
  });

  it('are enabled in the document only when the history has a step', () => {
    const { undo, redo } = rows();
    expect(undo.enabled?.(state({ canUndo: false, canRedo: true }))).toBe(false);
    expect(redo.enabled?.(state({ canUndo: true, canRedo: false }))).toBe(false);
    expect(undo.enabled?.(state({ canUndo: true }))).toBe(true);
    expect(redo.enabled?.(state({ canRedo: true }))).toBe(true);
  });

  it('are plain and enabled while a text field has the keys, which has its own history', () => {
    const { undo, redo } = rows();
    const field = state({ inDocument: false, undo: 'Typing', redo: 'Typing' });
    expect(undo.textFor?.(field)).toBe('Undo');
    expect(redo.textFor?.(field)).toBe('Redo');
    expect(undo.enabled?.(field)).toBe(true);
    expect(redo.enabled?.(field)).toBe(true);
  });
});
