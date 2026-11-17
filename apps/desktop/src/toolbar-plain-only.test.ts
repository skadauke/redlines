// @vitest-environment happy-dom
// A file opened in Plain only (text or code) has no Markdown to make: the toolbar's Format, Insert,
// List, Table and Image items are all disabled, each with the Plain-only reason from the command
// registry (`disabledReasonOf`), which the item's hint says.

import { createEditor, type Author, type Editor } from '@redlines/editor';
import { createFormatting } from '@redlines/formatting';
import { createReview } from '@redlines/review';
import { createTables } from '@redlines/tables';
import { MENUS, shownBar } from '@redlines/toolbar';
import { afterEach, expect, it } from 'vitest';
import { activatePlugins, DESKTOP_PLUGINS } from './plugins.ts';

const author: Author = { handle: 'ada', name: 'Ada Lovelace' };
const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  document.body.replaceChildren();
});

function mount(kind: 'markdown' | 'plain-only'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc: 'const a = 1;\n', author, tracking: false, kind });
  const removeFormatting = createFormatting(editor, { author, notice: () => {} });
  const removeTables = createTables(editor, {});
  const review = createReview(editor, { author });
  const removePlugins = activatePlugins(editor, {}, DESKTOP_PLUGINS, { author });
  stops.push(() => {
    removePlugins();
    review.destroy();
    removeTables();
    removeFormatting();
    editor.destroy();
  });
  return editor;
}

const MARKDOWN_ONLY = /^Only Markdown files have /;
const CHECKED = ['format', 'insert', 'list', 'table', 'image'];

it('disables every Format, Insert, List, Table and Image command, with the Plain-only reason', () => {
  const editor = mount('plain-only');
  const ui = editor.getUiState();
  const registered = new Set(editor.commands.list().map((command) => command.id));
  let checked = 0;
  for (const menu of MENUS.filter((each) => CHECKED.includes(each.id))) {
    for (const { command } of menu.rows.flat()) {
      if (!registered.has(command)) continue;
      checked++;
      expect(ui.disabledReasons[command], `${menu.label}: ${command}`).toMatch(MARKDOWN_ONLY);
      expect(ui.enabledCommands, `${menu.label}: ${command}`).not.toContain(command);
    }
  }
  expect(checked).toBeGreaterThan(20);
});

it('draws the bar’s items in those menus disabled, each with its reason', () => {
  const editor = mount('plain-only');
  const bar = shownBar(editor.commands.list(), editor.view.state);
  const menus = bar.menus.filter((menu) => CHECKED.includes(menu.id));
  // Insert, List and Format are always in the bar; Table and Image only at a table or an image.
  expect(menus.map((menu) => menu.id)).toEqual(['insert', 'list', 'format']);
  for (const menu of menus) {
    for (const item of menu.rows.flat()) {
      expect(item.enabled, `${menu.label}: ${item.id}`).toBe(false);
      expect(item.reason, `${menu.label}: ${item.id}`).toMatch(MARKDOWN_ONLY);
    }
  }
});

it('leaves the same items on in a Markdown file', () => {
  const editor = mount('markdown');
  const bar = shownBar(editor.commands.list(), editor.view.state);
  const items = bar.menus.flatMap((menu) => menu.rows.flat());
  expect(items.find((item) => item.id === 'format.bold')).toMatchObject({
    enabled: true,
    reason: null,
  });
});
