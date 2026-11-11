// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';
import { visibleSelection } from './decorations.ts';
import { atomic } from './test-helpers.ts';

// A path rather than a URL: under happy-dom, `URL` is the DOM's class, which node:fs rejects.
const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../format/src/fixtures/launch-plan.md'),
  'utf8',
);

const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' }, ...options });
  open.push(editor);
  return editor;
}

const head = (editor: Editor) => editor.view.state.selection.main.head;

function caret(editor: Editor, at: number): void {
  editor.view.dispatch({ selection: { anchor: at }, userEvent: 'select' });
}

const mac = /Mac/.test(navigator.platform);

/** Presses a key, with any of Shift, Alt and Ctrl before it, through the editor's keymaps. */
function press(editor: Editor, key: string): void {
  const parts = key.split('-');
  const name = parts.pop()!;
  const event = new KeyboardEvent('keydown', {
    key: name,
    shiftKey: parts.includes('Shift'),
    altKey: parts.includes('Alt'),
    ctrlKey: parts.includes('Ctrl'),
    bubbles: true,
    cancelable: true,
  });
  runScopeHandlers(editor.view, event, 'editor');
}

/** `the <!--ins k3x9-->new <!--/k3x9-->importer`: where the opener and its text start. */
const opener = fixture.indexOf('<!--ins k3x9-->');
const text = fixture.indexOf('new ');

describe('arrow keys', () => {
  it('one arrow press crosses a run of hidden markers', () => {
    const editor = load(fixture);
    // After "the ", before the opener.
    caret(editor, opener);
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(text + 1);
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe(text);
    // Past the opener and the space before it, in one press.
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe(opener - 1);
  });

  it('crosses the closer after inserted text', () => {
    const editor = load(fixture);
    const closer = fixture.indexOf('<!--/k3x9-->');
    caret(editor, closer);
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(closer + '<!--/k3x9-->'.length + 1);
    press(editor, 'ArrowLeft');
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe(closer - 1);
  });

  it('stops after deleted text, which takes a press of its own', () => {
    const editor = load(fixture);
    caret(editor, fixture.indexOf('<!--sub p7qd'));
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(fixture.indexOf('April'));
  });

  it('extends a selection across hidden markers', () => {
    const editor = load(fixture);
    caret(editor, opener);
    press(editor, 'Shift-ArrowRight');
    expect(editor.view.state.selection.main).toMatchObject({ anchor: opener, head: text + 1 });
  });

  it('moves by word across hidden markers', () => {
    const editor = load(fixture);
    caret(editor, opener);
    press(editor, mac ? 'Alt-ArrowRight' : 'Ctrl-ArrowRight');
    expect(head(editor)).toBe(text + 'new'.length);
  });

  it('moves over every character of the source in Raw', () => {
    const editor = load(fixture, { view: 'raw' });
    caret(editor, opener);
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(opener + 1);
  });
});

describe('struck blocks', () => {
  const LEDGER =
    '\n<!-- redlines\nversion: 1\nmarks:\n  k3x9: {by: bo, at: 2026-10-31T09:30Z}\n-->\n';
  /** A deleted paragraph between two, one at the end of the text, and an item between two. */
  const between = `One.\n\n<!--del k3x9 Two.\\n\\n-->\n\nThree.\n${LEDGER}`;
  const atEnd = `One.\n\nTwo.<!--del k3x9 \\n\\nThree.-->\n${LEDGER}`;
  const items = `- one\n- <!--del k3x9 two\\n- -->\n  three\n${LEDGER}`;
  const where = (doc: string, text: string) => doc.indexOf(text);

  /** What a series of keys does in a view: the text and the caret after each. */
  function run(doc: string, view: 'redlines' | 'clean', start: number, keys: string[]) {
    const editor = load(doc, { view });
    caret(editor, start);
    const seen: [string, number][] = [];
    for (const key of keys) {
      press(editor, key);
      seen.push([editor.getDoc(), head(editor)]);
    }
    return seen;
  }

  it('is atomic: the lines of its marker, with the line breaks around them', () => {
    const editor = load(between);
    const from = where(between, 'One.') + 'One.'.length;
    const spans = atomic(editor).filter(([a, b]) => a <= from + 1 && b > from);
    expect(spans.length).toBeGreaterThan(0);
    const [a, b] = spans[0]!;
    expect(a).toBeLessThanOrEqual(from);
    expect(b).toBeGreaterThanOrEqual(where(between, 'Three.') - 1);
  });

  it('is stepped over by → and ←, which never enter it', () => {
    for (const doc of [between]) {
      const editor = load(doc);
      const one = where(doc, 'One.') + 'One.'.length;
      const three = where(doc, 'Three.');
      caret(editor, one);
      press(editor, 'ArrowRight');
      // Past the struck block, to the start of the next text: nothing of it is the caret's.
      expect(head(editor)).toBe(three);
      press(editor, 'ArrowLeft');
      expect(head(editor)).toBe(one);
      // The caret never rests inside the hidden lines of the block, whatever is asked.
      // (A blank line the caret is put on is a place for it, as ever: only the marker's lines.)
      for (let at = where(doc, '<!--del'); at < three; at++) {
        const moved = visibleSelection(
          editor.view.state.update({ selection: { anchor: at } }).state,
        ).main.head;
        expect(moved === one || moved === three, String(at)).toBe(true);
      }
    }
  });

  it('is stepped over at the end of the text, after the paragraph above', () => {
    const editor = load(atEnd);
    const two = where(atEnd, 'Two.') + 'Two.'.length;
    caret(editor, two - 1);
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(two);
    // The deleted paragraph is no text to enter: → stays at the end of the line it follows, and
    // no position in its marker is the caret's.
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(two);
    for (let at = two + 1; at <= atEnd.indexOf('-->') + 3; at++) {
      const state = editor.view.state.update({ selection: { anchor: at } }).state;
      expect(visibleSelection(state).main.head, String(at)).toBe(two);
    }
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe(two - 1);
  });

  it('is stepped over between list items: the bullet of the next item is its own', () => {
    const editor = load(items);
    const one = where(items, 'one') + 'one'.length;
    caret(editor, one);
    press(editor, 'ArrowRight');
    // The start of "three": the struck item is drawn above its line, and none of the marker
    // between its bullet and its text is the caret's.
    const three = where(items, 'three');
    // Just after the bullet, where the marker starts: the hidden marker is behind it.
    expect(head(editor)).toBe(where(items, '<!--del'));
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(three + 1);
    // Back again, one press at a time, the caret never rests inside the marker.
    const marker = [where(items, '<!--del'), three] as const;
    for (let i = 0; i < 6 && head(editor) > one; i++) {
      press(editor, 'ArrowLeft');
      expect(head(editor) <= marker[0] || head(editor) >= marker[1], String(head(editor))).toBe(
        true,
      );
    }
    expect(head(editor)).toBe(one);
  });

  it('acts as it does with the block hidden, for Backspace and Delete at its edges', () => {
    // The block draws in Redlines and not in Clean: the keys do the same in both, as before.
    for (const [doc, start, keys] of [
      [between, where(between, 'Three.'), ['Backspace']],
      [between, where(between, 'One.') + 4, ['Delete']],
      [atEnd, where(atEnd, 'Two.') + 4, ['Delete']],
      [items, where(items, 'three'), ['Backspace']],
    ] as const) {
      expect(run(doc, 'redlines', start, [...keys]), doc).toEqual(
        run(doc, 'clean', start, [...keys]),
      );
    }
  });

  it('keeps struck text out of the visible ends of a selection, for select-all and a drag across', () => {
    const editor = load(between);
    const one = where(between, 'One.') + 'One.'.length;
    const three = where(between, 'Three.');
    // A drag from inside "One." to inside "Three.": its ends are in visible text, the block
    // between is no end of it.
    editor.view.dispatch({ selection: { anchor: one - 2, head: three + 2 }, userEvent: 'select' });
    expect(visibleSelection(editor.view.state)).toBe(editor.view.state.selection);
    // An end put in the block moves out of it.
    editor.view.dispatch({ selection: { anchor: one - 2, head: one + 3 } });
    const moved = visibleSelection(editor.view.state).main;
    expect(moved.anchor).toBe(one - 2);
    expect([one, three]).toContain(moved.head);
    // Select all keeps the ends of the document where there is text.
    press(editor, mac ? 'Meta-a' : 'Ctrl-a');
    const all = visibleSelection(editor.view.state).main;
    expect(all.from).toBe(0);
    expect(all.to).toBeLessThanOrEqual(editor.getParsed().ledgerRange!.from);
  });
  it('does with ⌥↑, ⌥↓, Home, End and typing what it does with the block hidden', () => {
    // The block draws in Redlines and not in Clean; each key leaves the same text and caret in both.
    /** Types a character, as the keyboard does, at the caret. */
    const type = (editor: Editor) => {
      const at = head(editor);
      editor.view.dispatch({
        changes: { from: at, insert: 'x' },
        selection: { anchor: at + 1 },
        userEvent: 'input.type',
      });
    };
    const keys = (view: 'redlines' | 'clean', doc: string, start: number, key: string) => {
      const editor = load(doc, { view, tracking: false });
      caret(editor, start);
      if (key === 'type') type(editor);
      else press(editor, key);
      return [editor.getDoc(), head(editor)];
    };
    // The keys do something here: ⌥↓ goes down to the start of the block below the struck one.
    const [, down] = keys('redlines', between, where(between, 'One.') + 2, 'Alt-ArrowDown');
    expect(down).toBeGreaterThan(where(between, 'One.') + 2);
    for (const [doc, start, key] of [
      [between, where(between, 'One.') + 2, 'Alt-ArrowDown'],
      [between, where(between, 'Three.') + 2, 'Alt-ArrowUp'],
      [between, where(between, 'One.') + 2, 'End'],
      [between, where(between, 'Three.') + 2, 'Home'],
      [between, where(between, 'Three.'), 'type'],
      [between, where(between, 'One.') + 4, 'type'],
      [atEnd, where(atEnd, 'Two.') + 2, 'End'],
      [atEnd, where(atEnd, 'Two.') + 4, 'type'],
      [items, where(items, 'three'), 'type'],
      [items, where(items, 'three') + 2, 'Home'],
    ] as const) {
      expect(keys('redlines', doc, start, key), `${key} at ${start}`).toEqual(
        keys('clean', doc, start, key),
      );
    }
  });
  it('takes ⌥↓ to the end of the paragraph, then the next one’s end, and ⌥↑ back, past the struck block', () => {
    // As beside any block: the first press goes to the end of the paragraph the caret is in (not
    // past the block below it), the second to the end of the next one's, and never inside struck text.
    const one = where(between, 'One.');
    const three = where(between, 'Three.');
    for (const view of ['redlines', 'clean'] as const) {
      const editor = load(between, { view });
      caret(editor, one + 2);
      const seen: number[] = [];
      for (const key of ['Alt-ArrowDown', 'Alt-ArrowDown', 'Alt-ArrowUp', 'Alt-ArrowUp']) {
        press(editor, key);
        seen.push(head(editor));
      }
      expect(seen, view).toEqual([one + 4, three + 6, three, one]);
    }
  });
});
