// @vitest-environment happy-dom
// Emoji (#312): the shortcodes in a file drawn as their emoji, and the list after a colon, which
// writes the character itself. It keeps out of the way of `10:30`, of code and of Raw, and can be
// turned off.

import { forceParsing } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmoji, plugin, triggerAt } from './index.ts';

interface Mounted {
  editor: Editor;
  remove: () => void;
}

const mounted: Mounted[] = [];
/** The editors that have the focus, as far as their views know. */
const focused = new Set<Editor>();
const author = { handle: 'ada', name: 'Ada Lovelace' };

function mount(
  doc: string,
  options: { tracking?: boolean; enabled?: () => boolean } = {},
): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, tracking: options.tracking ?? false });
  const remove = createEmoji(editor, options.enabled ? { enabled: options.enabled } : {});
  // happy-dom's selection sends its change events in the middle of an update, which a view that has
  // the real focus can't take: the view is told that it has the focus instead.
  Object.defineProperty(editor.view, 'hasFocus', {
    get: () => focused.has(editor),
    configurable: true,
  });
  focused.add(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
  const result = { editor, remove };
  mounted.push(result);
  return result;
}

afterEach(() => {
  focused.clear();
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

/** Types text at the end of the document, one character at a time, as the keyboard does. */
function typeText(editor: Editor, text: string): void {
  for (const char of text) {
    const end = editor.view.state.selection.main.head;
    editor.view.dispatch({
      changes: { from: end, to: end, insert: char },
      selection: { anchor: end + char.length },
      userEvent: 'input.type',
    });
  }
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
}

const popover = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-emoji-popover');
const rows = (editor: Editor) =>
  [...(popover(editor)?.querySelectorAll('.rl-emoji-row') ?? [])].map((row) => row.textContent);

/** A key pressed in the text, as the browser sends it. Returns whether a key map took it. */
function press(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  editor.view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('the list of emoji after a colon', () => {
  it('opens after a colon and two letters, under the caret, with the emoji and its name', () => {
    const { editor } = mount('Camp ');
    typeText(editor, ':tent');
    expect(popover(editor)).not.toBeNull();
    expect(rows(editor)[0]).toBe('⛺:tent:');
    expect(popover(editor)?.getAttribute('role')).toBe('listbox');
    expect(popover(editor)?.querySelectorAll('[role="option"]').length).toBeGreaterThan(1);
    expect(popover(editor)?.querySelectorAll('[role="option"]').length).toBeLessThanOrEqual(8);
    // The text is the text typed, until a choice is made.
    expect(editor.getDoc()).toBe('Camp :tent');
  });

  it('is not open for one letter, and follows what is typed', () => {
    const { editor } = mount('');
    typeText(editor, ':t');
    expect(popover(editor)).toBeNull();
    typeText(editor, 'e');
    const names = () => rows(editor).map((row) => row.slice(row.indexOf(':')));
    expect(names().every((name) => name.startsWith(':te'))).toBe(true);
    typeText(editor, 'n');
    expect(names()).toContain(':tennis:');
    expect(names()).toContain(':tent:');
    typeText(editor, 't');
    // The exact name first, then the names that have it as a word.
    expect(names()).toEqual([':tent:', ':circus_tent:']);
    typeText(editor, 'zzzz');
    expect(popover(editor)).toBeNull();
  });

  it('writes the emoji in place of what was typed, when Return chooses, and closes', () => {
    const { editor } = mount('Camp ');
    typeText(editor, ':tent');
    expect(press(editor, 'Enter')).toBe(true);
    expect(editor.getDoc()).toBe('Camp ⛺');
    expect(editor.view.state.selection.main.head).toBe('Camp ⛺'.length);
    expect(popover(editor)).toBeNull();
    expect(editor.view.contentDOM.getAttribute('aria-expanded')).toBeNull();
  });

  it('chooses with Tab, and with a click on a row', () => {
    const tab = mount('');
    typeText(tab.editor, ':smile');
    expect(press(tab.editor, 'Tab')).toBe(true);
    expect(tab.editor.getDoc()).toBe('😄');

    const click = mount('');
    typeText(click.editor, ':tent');
    click.editor.view.dom.querySelector<HTMLElement>('.rl-emoji-row')?.click();
    expect(click.editor.getDoc()).toBe('⛺');
  });

  it('moves with the arrows, around the ends, and chooses the one it is on', () => {
    const { editor } = mount('');
    typeText(editor, ':smi');
    const first = rows(editor)[0];
    expect(editor.view.dom.querySelector('.rl-emoji-selected')?.textContent).toBe(first);
    expect(press(editor, 'ArrowDown')).toBe(true);
    expect(editor.view.dom.querySelector('.rl-emoji-selected')?.textContent).toBe(rows(editor)[1]);
    expect(press(editor, 'ArrowUp')).toBe(true);
    expect(press(editor, 'ArrowUp')).toBe(true);
    const all = rows(editor);
    expect(editor.view.dom.querySelector('.rl-emoji-selected')?.textContent).toBe(all.at(-1));
    // The one that is chosen is told to a screen reader.
    const selected = editor.view.dom.querySelector('.rl-emoji-selected');
    expect(editor.view.contentDOM.getAttribute('aria-activedescendant')).toBe(selected?.id);
    press(editor, 'Enter');
    const char = [...all.at(-1)!][0]!;
    expect(editor.getDoc().startsWith(char) || editor.getDoc().includes(char)).toBe(true);
    expect(editor.getDoc()).not.toContain(':smi');
  });

  it('is put away by Esc, and stays away for that colon, until another is typed', () => {
    const { editor } = mount('');
    typeText(editor, ':smi');
    expect(press(editor, 'Escape')).toBe(true);
    expect(popover(editor)).toBeNull();
    typeText(editor, 'l');
    expect(popover(editor)).toBeNull();
    expect(editor.getDoc()).toBe(':smil');
    typeText(editor, ' :ten');
    expect(popover(editor)).not.toBeNull();
  });

  it('lets Return through while it is closed: the editor’s own key splits the paragraph', () => {
    const { editor } = mount('Camp\n\nText');
    editor.view.dispatch({ selection: { anchor: 2 } });
    press(editor, 'Enter');
    expect(popover(editor)).toBeNull();
    expect(editor.getDoc().replace(/\s+/g, '|')).toBe('Ca|mp|Text');
    // Tab and Esc are not the list's either, while it is closed.
    for (const key of ['Tab', 'Escape']) {
      press(editor, key);
      expect(popover(editor), key).toBeNull();
    }
  });

  it('is put away when the view changes to Raw, and writes nothing there', () => {
    const { editor } = mount('Camp ');
    typeText(editor, ':ten');
    expect(popover(editor)).not.toBeNull();
    editor.setViewMode('raw');
    expect(popover(editor)).toBeNull();
    // Return in Raw is the editor's, not the list's: no emoji is written.
    press(editor, 'Enter');
    expect(editor.getDoc()).not.toContain('⛺');
  });

  it('is closed when the caret moves away, and when the editor loses focus', () => {
    const { editor } = mount('One\n\nTwo ');
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    typeText(editor, ':smi');
    expect(popover(editor)).not.toBeNull();
    editor.view.dispatch({ selection: { anchor: 1 } });
    expect(popover(editor)).toBeNull();
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    expect(popover(editor)).not.toBeNull();
    focused.delete(editor);
    editor.view.contentDOM.dispatchEvent(new FocusEvent('blur'));
    expect(popover(editor)).toBeNull();
  });

  it('stays out of the way of times, words with a colon, and other uses of a colon', () => {
    for (const text of [
      'At 10:30',
      'At 10:30:45',
      'Note:abc',
      'ratio a:smi',
      'x::smi',
      'a [link](https://example.org/:smi',
      'at :30',
      'a :1',
    ]) {
      const { editor } = mount(text.endsWith(' ') ? text : '');
      if (!text.endsWith(' ')) typeText(editor, text);
      expect(popover(editor), text).toBeNull();
    }
  });

  it('stays out of code, a code block and front matter', () => {
    const cases: [string, number][] = [
      ['A `code ` here', 8],
      ['```\n\n```\n', 4],
      ['    \n', 4],
      ['---\ntitle: \n---\n\nText\n', 11],
    ];
    for (const [doc, at] of cases) {
      const { editor } = mount(doc);
      editor.view.dispatch({ selection: { anchor: at } });
      typeText(editor, ':smi');
      expect(popover(editor), JSON.stringify(doc)).toBeNull();
    }
    // The same text in a paragraph does open it.
    const { editor } = mount('A  here');
    editor.view.dispatch({ selection: { anchor: 2 } });
    typeText(editor, ':smi');
    expect(popover(editor)).not.toBeNull();
  });

  it('opens next to punctuation and in a list, a quote and a heading, as after a space', () => {
    for (const doc of ['(:smi', '- :smi', '> :smi', '# Head :smi', '"“:smi', '*:smi']) {
      const { editor } = mount('');
      typeText(editor, doc);
      expect(popover(editor), doc).not.toBeNull();
    }
  });

  it('is not open in Raw, nor with a range selected, nor where the text is read only', () => {
    const raw = mount('');
    raw.editor.setViewMode('raw');
    typeText(raw.editor, ':smi');
    expect(popover(raw.editor)).toBeNull();

    const range = mount('');
    typeText(range.editor, ':smi');
    range.editor.view.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(popover(range.editor)).toBeNull();

    // The editor has no read-only mode of its own; a host that adds the facet gets no list.
    const open = EditorState.create({ doc: 'Camp :smi', selection: { anchor: 9 } });
    expect(triggerAt(open)).toEqual({ from: 5, to: 9, query: 'smi' });
    const readOnly = EditorState.create({
      doc: 'Camp :smi',
      selection: { anchor: 9 },
      extensions: [EditorState.readOnly.of(true)],
    });
    expect(triggerAt(readOnly)).toBeNull();
  });

  it('can be turned off, and its answer is asked each time', () => {
    let on = false;
    const { editor } = mount('', { enabled: () => on });
    typeText(editor, ':smi');
    expect(popover(editor)).toBeNull();
    on = true;
    typeText(editor, 'l');
    expect(popover(editor)).not.toBeNull();
    on = false;
    typeText(editor, 'e');
    expect(popover(editor)).toBeNull();
  });

  it('opens only for a colon that is no letter’s neighbour, though a marker of a change is between', () => {
    // A marker is no text: the colon is still against the `c`, as it is without the marker.
    const letter = 'abc<!--ins k3x9-->:smi';
    const state = (doc: string) => {
      const { editor } = mount(doc);
      editor.view.dispatch({ selection: { anchor: doc.length } });
      return editor.view.state;
    };
    expect(triggerAt(state(letter))).toBeNull();
    const space = 'abc <!--ins k3x9-->:smi';
    expect(triggerAt(state(space))).toEqual({
      from: space.indexOf(':'),
      to: space.length,
      query: 'smi',
    });
  });

  it('writes the character as the author’s own typing with Track Changes on: one insertion', () => {
    const { editor } = mount('Camp ', { tracking: true });
    typeText(editor, ':tent');
    expect(popover(editor)).not.toBeNull();
    press(editor, 'Enter');
    expect(editor.getDoc()).toMatch(/^Camp <!--ins (\w+)-->⛺<!--\/\1-->/);
    expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['ins']);
    expect(editor.getDoc()).not.toContain(':tent');
  });

  it('works as typing does in the middle of text, and undoes in one step', async () => {
    const { editor } = mount('Camp  here');
    editor.view.dispatch({ selection: { anchor: 5 } });
    typeText(editor, ':tent');
    // The caret is before a space: the list opens.
    press(editor, 'Enter');
    expect(editor.getDoc()).toBe('Camp ⛺ here');
    const { undo } = await import('@redlines/editor');
    undo(editor.view);
    expect(editor.getDoc()).toBe('Camp :tent here');
  });
});

describe('a row for a screen reader', () => {
  it('is named by its words, and a thumbs down by its name as it is', () => {
    const { editor } = mount('');
    typeText(editor, ':t-rex');
    expect(editor.view.dom.querySelector('.rl-emoji-row')?.getAttribute('aria-label')).toBe(
      't rex',
    );
    const down = mount('');
    typeText(down.editor, ':-1');
    expect(down.editor.view.dom.querySelector('.rl-emoji-row')?.getAttribute('aria-label')).toBe(
      '-1',
    );
    // The content is a text box: `aria-expanded` is for a combobox, which it is not.
    expect(down.editor.view.contentDOM.hasAttribute('aria-expanded')).toBe(false);
    expect(down.editor.view.contentDOM.getAttribute('aria-controls')).not.toBeNull();
  });
});

describe('the shortcodes in a file', () => {
  it('are drawn as their emoji once the plugin is on, and as written once it is taken out', () => {
    const { editor, remove } = mount('Camp :tent: here, :+1: and :t-rex:.\n');
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    const shown = () =>
      [...editor.view.dom.querySelectorAll('.rl-emoji')].map((el) => el.textContent);
    expect(shown()).toEqual(['⛺', '👍', '🦖']);
    // A name that GitHub does not know stays as it is.
    editor.view.dispatch({
      changes: { from: 0, insert: ':not_an_emoji: ' },
      selection: { anchor: editor.view.state.doc.length + 15 },
    });
    expect(shown()).toEqual(['⛺', '👍', '🦖']);
    remove();
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(shown()).toEqual([]);
  });

  it('are drawn as soon as the names are given, and put back when they are taken out', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: 'Camp :tent: here.\n', author });
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    const shown = () => editor.view.dom.querySelectorAll('.rl-emoji').length;
    expect(shown()).toBe(0);
    const remove = createEmoji(editor);
    // The names came after the text was drawn: no selection moves, and it is drawn.
    expect(shown()).toBe(1);
    remove();
    expect(shown()).toBe(0);
    editor.destroy();
  });

  it('are drawn even where the list is off: Preferences turn off the list, not the drawing', () => {
    const { editor } = mount('Camp :tent: here.\n', { enabled: () => false });
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    expect(editor.view.dom.querySelector('.rl-emoji')?.textContent).toBe('⛺');
  });
});

describe('the plugin', () => {
  it('has a manifest, and starts and stops with the editor', () => {
    expect(plugin.manifest.id).toBe('redlines.emoji');
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: 'A :tent:\n', author });
    const remove = plugin.activate({
      editor,
      host: {},
      author,
      notice: () => {},
    });
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    expect(editor.view.dom.querySelector('.rl-emoji')?.textContent).toBe('⛺');
    remove();
    editor.destroy();
  });
});
