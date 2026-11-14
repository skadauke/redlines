// @vitest-environment happy-dom
// Emoji shortcodes in the preview (#312, design §5.2): a `:name:` the host knows is drawn as its emoji
// in every view but Raw, as an entity is drawn as its character, and shows as written while the caret
// is on it. The editor has no list of names: a host gives one, and without it the text stays as it is.

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, emojiLookup, type Editor } from '../index.ts';
import { previewDecorations } from './decorations.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const NAMES = new Map([
  ['tent', '⛺'],
  ['smile', '😄'],
  ['+1', '👍'],
  ['t-rex', '🦖'],
  ['x', '❌'],
  ['-1', '👎'],
]);

function editorAt(doc: string, cursor: number, known = true): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author });
  if (known) editor.addExtension(emojiLookup.of((name) => NAMES.get(name)));
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

/** The ranges that the preview replaces with a widget, as the text of the source they hide. */
function drawn(editor: Editor): { source: string; shown: string | undefined }[] {
  const found: { source: string; shown: string | undefined }[] = [];
  const { state } = editor.view;
  previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const widget = (value.spec as { widget?: { char?: string } }).widget;
    if (value.point && from < to && widget?.char !== undefined) {
      found.push({ source: state.sliceDoc(from, to), shown: widget.char });
    }
  });
  return found;
}

describe('an emoji shortcode in the preview (#312)', () => {
  const doc = 'Camp :tent: and :smile: here, :+1: and :t-rex: and :x:.\n';

  it('is drawn as its emoji while the caret is elsewhere', () => {
    const editor = editorAt(doc, doc.length);
    expect(drawn(editor)).toEqual([
      { source: ':tent:', shown: '⛺' },
      { source: ':smile:', shown: '😄' },
      { source: ':+1:', shown: '👍' },
      { source: ':t-rex:', shown: '🦖' },
      { source: ':x:', shown: '❌' },
    ]);
    const emoji = [...editor.view.dom.querySelectorAll('.rl-emoji')].map((el) => el.textContent);
    expect(emoji).toEqual(['⛺', '😄', '👍', '🦖', '❌']);
  });

  it('shows as written while the caret is on it, or next to it, and only that one', () => {
    for (const at of [
      doc.indexOf(':tent:'),
      doc.indexOf(':tent:') + 3,
      doc.indexOf(':tent:') + 6,
    ]) {
      const editor = editorAt(doc, at);
      expect(drawn(editor).map((found) => found.source)).not.toContain(':tent:');
      expect(drawn(editor).map((found) => found.source)).toContain(':smile:');
    }
  });

  it('stays text for a name the host does not know, and without a host that knows any', () => {
    const unknown = 'A :not_an_emoji: here, and 10:30:45 and :x y: and ::.\n';
    expect(drawn(editorAt(unknown, 0))).toEqual([]);
    expect(drawn(editorAt(doc, 0, false))).toEqual([]);
  });

  it('is no emoji against a letter or a digit before it, as GitHub shows it as written', () => {
    const glued = 'a:tent: 9:smile: (:tent:) b :tent:.\n';
    expect(drawn(editorAt(glued, glued.length))).toEqual([
      { source: ':tent:', shown: '⛺' },
      { source: ':tent:', shown: '⛺' },
    ]);
  });

  it('is left alone in code, in a link’s address and in a code block', () => {
    const code = 'A `:tent:` and [a](https://example.org/:tent:) and\n\n```\n:smile:\n```\n';
    expect(drawn(editorAt(code, code.length))).toEqual([]);
  });

  it('is drawn in a heading, in emphasis, in a link’s text and in a table cell', () => {
    const text =
      '# Camp :tent:\n\n*Go :smile:* and [on :tent:](https://example.org)\n\n| a |\n| - |\n| :+1: |\n';
    expect(
      drawn(editorAt(text, text.length))
        .map((found) => found.source)
        .sort(),
    ).toEqual([':+1:', ':smile:', ':tent:', ':tent:'].sort());
  });

  it('is not drawn in Raw, which shows the text as written', () => {
    const editor = editorAt(doc, doc.length);
    editor.setViewMode('raw');
    expect(drawn(editor)).toEqual([]);
    expect(editor.view.dom.querySelector('.rl-emoji')).toBeNull();
  });

  it('is drawn with the emoji and its name for a screen reader', () => {
    const editor = editorAt(doc, doc.length);
    const first = editor.view.dom.querySelector('.rl-emoji');
    expect(first?.getAttribute('role')).toBe('img');
    expect(first?.getAttribute('aria-label')).toBe('tent');
    expect(editor.view.dom.querySelector('.rl-emoji[aria-label="t rex"]')).not.toBeNull();
    // A name that starts with a sign keeps it: `-1` is no word with a missing first letter.
    const down = editorAt(':-1: x\n', 6);
    expect(down.view.dom.querySelector('.rl-emoji')?.getAttribute('aria-label')).toBe('-1');
  });
});
