import { EditorState } from '@codemirror/state';
import type { EditorCommand } from '@redlines/editor';
import { describe, expect, it } from 'vitest';
import { MENUS, shownBar } from './items.ts';

const command = (id: string, fields: Partial<EditorCommand> = {}): EditorCommand => ({
  id,
  title: id,
  run: () => true,
  ...fields,
});

const state = EditorState.create({ doc: 'Some text' });

/** The ids the toolbar shows, menu by menu. */
const ids = (commands: readonly EditorCommand[], at: EditorState = state) =>
  shownBar(commands, at).menus.map((menu) => ({
    menu: menu.id,
    rows: menu.rows.map((row) => row.map((item) => item.id)),
  }));

const everything = [{ command: 'ask.start' }, ...MENUS.flatMap((menu) => menu.rows.flat())].map(
  ({ command: id }) => command(id, { isActive: () => true }),
);
const PARAGRAPH = { paragraph: true, item: false };

describe('the toolbar menus', () => {
  it('leaves out an item whose command is not registered, and a menu with none left', () => {
    expect(ids([])).toEqual([]);
    expect(ids([command('format.bold')])).toEqual([{ menu: 'format', rows: [['format.bold']] }]);
  });

  it('shows an item once its command is registered, in the menu’s own order', () => {
    const base = [command('format.italic'), command('format.bold')];
    expect(ids(base)[0]?.rows).toEqual([['format.bold'], ['format.italic']]);
    expect(ids([...base, command('format.sub')])[0]?.rows.flat()).toEqual([
      'format.bold',
      'format.italic',
      'format.sub',
    ]);
  });

  it('orders the bar Ask | Insert · Review · List · Format · Edit', () => {
    const bar = shownBar(everything, state, PARAGRAPH);
    expect(bar.ask?.id).toBe('ask.start');
    expect(bar.menus.map((menu) => menu.id)).toEqual([
      'insert',
      'review',
      'list',
      'table',
      'image',
      'format',
      'edit',
    ]);
  });

  it('keeps Ask out of the menus and leaves it out when the agents are not there', () => {
    expect(shownBar([command('format.bold')], state).ask).toBeNull();
    expect(ids([command('ask.start')])).toEqual([]);
  });

  it('puts Accept and Reject in one line of the Review menu', () => {
    const review = shownBar(everything, state).menus.find((menu) => menu.id === 'review');
    expect(review?.rows.map((row) => row.map((item) => item.id))).toEqual([
      ['comment.add'],
      ['highlight.toggle'],
      ['change.accept', 'change.reject'],
      ['review.start'],
    ]);
  });

  it('leaves a place in Insert for a Collapsible Section that a later lane registers', () => {
    const base = ['format.link', 'block.table'].map((id) => command(id));
    expect(ids(base)[0]?.rows.flat()).toEqual(['format.link', 'block.table']);
    const later = ids([...base, command('block.collapsible')])[0]?.rows.flat();
    expect(later?.at(-1)).toBe('block.collapsible');
  });

  it('names an item as its menu does, and by the command’s title where the menu has no word', () => {
    const bar = shownBar(
      [
        command('block.alert', { title: 'Alert' }),
        command('format.link', { title: 'Link…' }),
        command('comment.add', { title: 'Add Comment' }),
      ],
      state,
    );
    const items = bar.menus.flatMap((menu) => menu.rows.flat());
    expect(items.map((item) => [item.label, item.name])).toEqual([
      ['Link…', 'Link'],
      ['Callout', 'Alert'],
      ['Comment', 'Add Comment'],
    ]);
  });

  it('follows a title that reads the state', () => {
    const toggle = command('highlight.toggle', {
      title: (at) => (at.doc.length > 5 ? 'Remove Highlight' : 'Highlight'),
    });
    const name = (at: EditorState) => shownBar([toggle], at).menus[0]?.rows[0]?.[0]?.name;
    expect(name(state)).toBe('Remove Highlight');
    expect(name(EditorState.create({ doc: 'Hi' }))).toBe('Highlight');
  });

  it('shows the shortcut the way the Mac writes it', () => {
    const bar = shownBar(
      [
        command('format.bold', { shortcut: 'Mod-b' }),
        command('format.italic', { shortcut: 'Mod-i' }),
        command('format.clear'),
      ],
      state,
    );
    const items = bar.menus[0]?.rows.flat();
    expect(items?.map((item) => item.keys)).toEqual(['⌘B', '⌘I', null]);
    expect(items?.[0]?.aria).toBe('Meta+B');
  });

  it('shows the system’s keys for the Edit items, which the registry binds none to', () => {
    const bar = shownBar([command('edit.cut'), command('edit.copy'), command('edit.paste')], state);
    expect(bar.menus[0]?.rows.flat().map((item) => item.keys)).toEqual(['⌘X', '⌘C', '⌘V']);
  });

  it('says whether an item is enabled, why not, and whether it is on', () => {
    const bar = shownBar(
      [
        command('format.bold', { isActive: () => true }),
        command('format.italic', { disabledReason: () => 'Not here.' }),
        command('format.clear'),
      ],
      state,
    );
    expect(
      bar.menus[0]?.rows.flat().map(({ enabled, reason, toggle, active }) => ({
        enabled,
        reason,
        toggle,
        active,
      })),
    ).toEqual([
      { enabled: true, reason: null, toggle: true, active: true },
      { enabled: false, reason: 'Not here.', toggle: false, active: false },
      { enabled: true, reason: null, toggle: false, active: false },
    ]);
  });
});

describe('the List menu', () => {
  const lists = [
    command('block.body'),
    command('block.ul'),
    command('block.ol'),
    command('block.task'),
  ];
  const listMenu = (
    commands: readonly EditorCommand[],
    holds: { paragraph: boolean; item: boolean },
  ) => shownBar(commands, state, holds).menus.find((menu) => menu.id === 'list');
  const PARAGRAPH = { paragraph: true, item: false };
  const ITEM = { paragraph: false, item: true };
  const NEITHER = { paragraph: false, item: false };

  it('shows for a paragraph, which a list can be made of', () => {
    expect(
      listMenu(lists, PARAGRAPH)
        ?.rows.flat()
        .map((item) => item.label),
    ).toEqual(['Bullets', 'Numbers', 'Checkboxes', 'No List']);
  });

  it('shows for a list item, and is not in the bar for anything else', () => {
    expect(listMenu(lists, ITEM)).toBeDefined();
    expect(listMenu(lists, { paragraph: true, item: true })).toBeDefined();
    // A heading, a code block, a table: no paragraph and no item.
    expect(listMenu(lists, NEITHER)).toBeUndefined();
  });

  it('sits after Review and before Format in the bar', () => {
    const bar = shownBar(
      [...lists, command('comment.add'), command('format.bold')],
      state,
      PARAGRAPH,
    );
    expect(bar.menus.map((menu) => menu.id)).toEqual(['review', 'list', 'format']);
  });

  it('grays No List where there is no list item, with the reason, and leaves it on with one', () => {
    const noList = (holds: { paragraph: boolean; item: boolean }) =>
      listMenu(lists, holds)
        ?.rows.flat()
        .find((item) => item.id === 'block.body');
    expect(noList(PARAGRAPH)?.enabled).toBe(false);
    expect(noList(PARAGRAPH)?.reason).toMatch(/not a list/);
    expect(noList(ITEM)?.enabled).toBe(true);
    // A selection that reaches into a list takes the list out of it.
    expect(noList({ paragraph: true, item: true })?.enabled).toBe(true);
  });

  it('grays a conversion the command says makes no sense, with the command’s own reason', () => {
    const grayed = lists.map((each) =>
      each.id === 'block.task' ? { ...each, disabledReason: () => 'Not in a cell.' } : each,
    );
    const item = listMenu(grayed, PARAGRAPH)
      ?.rows.flat()
      .find((each) => each.id === 'block.task');
    expect(item).toMatchObject({ enabled: false, reason: 'Not in a cell.' });
  });
});
