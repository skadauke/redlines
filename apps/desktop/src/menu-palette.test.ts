import type { CommandRegistry, EditorCommand } from '@redlines/editor';
import { describe, expect, it, vi } from 'vitest';
import { appMenuModel, type MenuCommands, type MenuState } from './menu-model.ts';
import { HAND_WRITTEN, LEFT_OUT, menuPaletteCommands, placedRows } from './menu-palette.ts';

/** Every command of the menu model is a spy. */
const commands = new Proxy({}, { get: () => vi.fn() }) as unknown as MenuCommands;

const command = (id: string, menu: EditorCommand['menu']): EditorCommand => ({
  id,
  title: id,
  menu,
  run: () => true,
});
const registry = {
  register: () => () => {},
  list: () => [command('format.bold', 'format'), command('comment.add', 'review')],
  run: vi.fn(() => true),
} satisfies CommandRegistry;

const state = (overrides: Partial<MenuState> = {}): MenuState => ({
  plainOnly: false,
  view: 'clean',
  tracking: false,
  hasRedlines: false,
  canAcceptAll: false,
  sidebarOpen: false,
  showResolved: false,
  showWordCount: true,
  zoom: 1,
  textSize: 1,
  hasFile: true,
  recent: ['/notes/plan.md', '/notes/todo.md'],
  activeCommands: [],
  enabledCommands: [],
  disabledReasons: {},
  commandTitles: {},
  undo: null,
  redo: null,
  canUndo: false,
  canRedo: false,
  inDocument: true,
  ...overrides,
});

const model = appMenuModel(commands, registry);
const palette = (current: MenuState | null = state()) =>
  menuPaletteCommands(
    model,
    () => current,
    () => undefined,
  );

describe('the menu bar and the command palette (#1192)', () => {
  it('has every menu command in the palette, but those the registry holds, the hand-written lines and the short list left out', () => {
    const ids = new Set(palette().map(({ id }) => id));
    const missing = placedRows(model, state())
      .filter(
        ({ key, row }) =>
          !row.id?.startsWith('command:') && !HAND_WRITTEN.has(key) && !(key in LEFT_OUT),
      )
      .filter(({ key }) => !ids.has(`menu.${key}`))
      .map(({ key }) => key);
    expect(missing).toEqual([]);
    // And the palette has nothing the menu bar lacks.
    const keys = new Set(placedRows(model, state()).map(({ key }) => `menu.${key}`));
    expect([...ids].filter((id) => !keys.has(id))).toEqual([]);
  });

  it('names no row in its lists that the menu bar doesn’t have', () => {
    const keys = new Set(placedRows(model, state()).map(({ key }) => key));
    for (const key of [...HAND_WRITTEN, ...Object.keys(LEFT_OUT)]) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it('finds About Redlines, New, the exports and the zoom, by what the menu calls them', () => {
    const titles = palette().map(({ title }) => title);
    for (const wanted of [
      'About Redlines',
      'New',
      'Open',
      'Export to Word',
      'Export as PDF',
      'Print',
      'Zoom In',
      'Quit Redlines',
    ]) {
      expect(titles, wanted).toContain(wanted);
    }
  });

  it('runs a row as the menu bar does', () => {
    const about = palette().find(({ title }) => title === 'About Redlines');
    about?.run?.();
    expect(about).toBeDefined();
  });

  it('lists the files of Open Recent, and leaves out what the menu bar greys', () => {
    const titles = palette().map(({ title }) => title);
    expect(titles).toContain('Open Recent: plan.md');
    const reveal = palette().find(({ title }) => title === 'Reveal in Finder');
    expect(reveal?.available?.()).toBe(true);
    const none = palette(state({ hasFile: false })).find(
      ({ title }) => title === 'Reveal in Finder',
    );
    expect(none?.available?.()).toBe(false);
  });
});
