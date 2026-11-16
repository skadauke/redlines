import { EditorState } from '@codemirror/state';
import type { EditorCommand } from '@redlines/editor';
import { describe, expect, it } from 'vitest';
import { type AppCommand, entriesOf, search } from './palette.ts';

const command = (
  id: string,
  title: string,
  fields: Partial<EditorCommand> = {},
): EditorCommand => ({
  id,
  title,
  run: () => true,
  ...fields,
});

const state = EditorState.create({ doc: 'Some text' });

const COMMANDS = [
  command('format.link', 'Link…', { shortcut: 'Mod-k' }),
  command('image.insert', 'Image…'),
  command('format.sub', 'Subscript', { shortcut: 'Mod-Alt-,' }),
  command('block.ul', 'Bulleted List'),
  command('block.ol', 'Numbered List'),
  command('block.task', 'Task List'),
  command('comment.add', 'Add Comment'),
  command('highlight.toggle', 'Highlight'),
  command('format.bold', 'Bold', { shortcut: 'Mod-b' }),
  command('toolbar.show', 'Show Toolbar'),
];

const APP: AppCommand[] = [
  {
    id: 'appearance',
    title: 'Appearance',
    synonyms: ['dark mode', 'light mode'],
    control: {
      kind: 'choice',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      get: () => 'light',
      set: () => {},
    },
  },
  { id: 'prefs', title: 'Open Preferences', keys: '⌘,', run: () => {} },
  { id: 'later', title: 'Check for Updates', available: () => false },
];

const index = (at: EditorState = state, commands = COMMANDS) =>
  entriesOf(commands, at, APP, () => {});
const names = (query: string, entries = index()) =>
  search(entries, query).map((entry) => entry.name);

describe('the palette’s index', () => {
  it('names a command as a verb phrase, and keeps the menu’s word for search', () => {
    const entries = index();
    expect(entries.find((entry) => entry.id === 'format.link')?.name).toBe('Insert Link');
    expect(entries.find((entry) => entry.id === 'block.task')?.name).toBe('Make Checklist');
    expect(entries.find((entry) => entry.id === 'highlight.toggle')?.name).toBe('Highlight Text');
    // Others keep their names.
    expect(entries.find((entry) => entry.id === 'format.bold')?.name).toBe('Bold');
    // The menu's word finds it too: Link… is Insert Link, and "link" finds it.
    expect(names('link')).toContain('Insert Link');
  });

  it('leaves out a command that does not work at the caret, and one the host says is not available', () => {
    const grayed = COMMANDS.map((each) =>
      each.id === 'format.bold' ? { ...each, disabledReason: () => 'Not here.' } : each,
    );
    const all = index(state, grayed).map((entry) => entry.id);
    expect(all).not.toContain('format.bold');
    expect(all).not.toContain('later');
    // The toolbar's own command is not in the palette that is in it.
    expect(all).not.toContain('toolbar.show');
    expect(all).toContain('prefs');
  });

  it('shows the shortcut the way the Mac writes it, and none where there is none', () => {
    const entries = index();
    expect(entries.find((entry) => entry.id === 'format.link')?.keys).toBe('⌘K');
    expect(entries.find((entry) => entry.id === 'prefs')?.keys).toBe('⌘,');
    expect(entries.find((entry) => entry.id === 'comment.add')?.keys).toBeNull();
  });
});

describe('searching the palette', () => {
  it('finds a command by a synonym', () => {
    expect(names('unordered list')).toEqual(['Make Bulleted List']);
    expect(names('todo')).toEqual(['Make Checklist']);
    expect(names('h2o')).toEqual(['Subscript']);
    expect(names('picture')).toEqual(['Insert Image']);
  });

  it('finds a setting by a synonym', () => {
    expect(names('dark mode')).toEqual(['Appearance']);
  });

  it('matches whole words: "ordered list" does not find "unordered list"', () => {
    const found = names('ordered list');
    expect(found).toContain('Make Numbered List');
    expect(found).not.toContain('Make Bulleted List');
  });

  it('needs every word of the query', () => {
    expect(names('make list')).toEqual([
      'Make Bulleted List',
      'Make Numbered List',
      'Make Checklist',
    ]);
    expect(names('make zzz')).toEqual([]);
  });

  it('ranks a word of the name above a synonym, and keeps the index’s order among equals', () => {
    // "comment" starts the name Add Comment; nothing else answers it.
    expect(names('comm')).toEqual(['Add Comment']);
    // "list" is in three names, in the index's order.
    expect(names('list')).toEqual(['Make Bulleted List', 'Make Numbered List', 'Make Checklist']);
    // A name word beats a synonym: "bullet" is a word of Make Bulleted List's name, and of its synonyms.
    expect(names('numbers')[0]).toBe('Make Numbered List');
  });

  it('lists everything in the index’s order for an empty query', () => {
    expect(names('')).toHaveLength(index().length);
  });

  it('ignores case and punctuation', () => {
    expect(names('INSERT, link!')).toEqual(['Insert Link']);
  });
});
