import { EditorState } from '@codemirror/state';
import type { EditorCommand } from '@redlines/editor';
import { describe, expect, it } from 'vitest';
import { ITEMS, shownGroups } from './items.ts';

const command = (id: string, fields: Partial<EditorCommand> = {}): EditorCommand => ({
  id,
  title: id,
  run: () => true,
  ...fields,
});

const state = EditorState.create({ doc: 'Some text' });

/** The ids the palette shows, group by group. */
const ids = (commands: readonly EditorCommand[], at: EditorState = state) =>
  shownGroups(commands, at).map((group) => ({
    group: group.id,
    items: group.items.map((item) => item.id),
  }));

describe('the palette items', () => {
  it('leaves out an item whose command is not registered, and a group with none left', () => {
    expect(ids([])).toEqual([]);
    expect(ids([command('format.bold')])).toEqual([{ group: 'format', items: ['format.bold'] }]);
  });

  it('shows an item once its command is registered', () => {
    const base = [command('format.bold'), command('format.italic')];
    expect(ids(base)[0]?.items).toEqual(['format.bold', 'format.italic']);
    // A later plugin's command lands: its item appears, in the palette's own order.
    expect(ids([...base, command('format.sub')])[0]?.items).toEqual([
      'format.bold',
      'format.italic',
      'format.sub',
    ]);
  });

  it('keeps the palette’s order whatever the order of registering', () => {
    const shown = ids([
      command('format.link'),
      command('format.bold'),
      command('comment.add'),
      command('block.table'),
    ]);
    expect(shown.map(({ group }) => group)).toEqual(['review', 'insert', 'format']);
    expect(shown[1]?.items).toEqual(['block.table', 'format.link']);
  });

  it('holds Insert, Format and Edit, with the comment group first', () => {
    const shown = ids(ITEMS.map(({ command: id }) => command(id)));
    expect(shown.map(({ group }) => group)).toEqual(['review', 'insert', 'format', 'edit']);
  });

  it('puts Ask beside Add Comment and Highlight', () => {
    const shown = ids([command('ask.start'), command('highlight.toggle'), command('comment.add')]);
    expect(shown).toEqual([
      { group: 'review', items: ['comment.add', 'highlight.toggle', 'ask.start'] },
    ]);
  });

  it('names an item by its command’s title, without the ellipsis of a title that opens a box', () => {
    const [group] = shownGroups([command('format.link', { title: 'Link…' })], state);
    expect(group?.items[0]?.name).toBe('Link');
  });

  it('follows a title that reads the state', () => {
    const toggle = command('highlight.toggle', {
      title: (at) => (at.doc.length > 5 ? 'Remove Highlight' : 'Highlight'),
    });
    expect(shownGroups([toggle], state)[0]?.items[0]?.name).toBe('Remove Highlight');
    expect(shownGroups([toggle], EditorState.create({ doc: 'Hi' }))[0]?.items[0]?.name).toBe(
      'Highlight',
    );
  });

  it('shows the shortcut the way the Mac writes it', () => {
    const [group] = shownGroups(
      [
        command('format.bold', { shortcut: 'Mod-b' }),
        command('format.italic', { shortcut: 'Mod-i' }),
        command('format.clear'),
      ],
      state,
    );
    expect(group?.items.map((item) => item.keys)).toEqual(['⌘B', '⌘I', null]);
    expect(group?.items[0]?.aria).toBe('Meta+B');
  });

  it('shows the system’s keys for the Edit items, which the registry binds none to', () => {
    const shown = shownGroups(
      [command('edit.cut'), command('edit.copy'), command('edit.paste')],
      state,
    );
    expect(shown[0]?.items.map((item) => item.keys)).toEqual(['⌘X', '⌘C', '⌘V']);
  });

  it('says whether an item is enabled and whether it is on', () => {
    const [group] = shownGroups(
      [
        command('format.bold', { isActive: () => true }),
        command('format.italic', { isEnabled: () => false }),
        command('format.clear'),
      ],
      state,
    );
    expect(
      group?.items.map(({ enabled, toggle, active }) => ({ enabled, toggle, active })),
    ).toEqual([
      { enabled: true, toggle: true, active: true },
      { enabled: false, toggle: false, active: false },
      { enabled: true, toggle: false, active: false },
    ]);
  });

  it('knows the commands of the plugins that come later by the ids they were given', () => {
    const later = ['format.sub', 'format.sup', 'block.alert', 'image.insert', 'highlight.toggle'];
    const shown = ids(later.map((id) => command(id)));
    expect(shown).toEqual([
      { group: 'review', items: ['highlight.toggle'] },
      { group: 'insert', items: ['block.alert', 'image.insert'] },
      { group: 'format', items: ['format.sub', 'format.sup'] },
    ]);
  });
});
