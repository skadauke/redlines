// @vitest-environment happy-dom
import { newestView, originalView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { undo } from '../history/index.ts';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';
import { editSourceFacet } from './typing.ts';

// The word under the pointer, which a right-click asks the system's spell checker about (the
// formatting palette shows its suggestions in place of WebKit's menu), and the correction the person
// picks: made as the Mac's own corrections are, as typing (corrections.ts).

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const NOW = new Date('2026-11-01T10:00:30Z');
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';

/** Random bytes that spell out the given ids, for new marks. */
function randomIds(...ids: string[]): (n: number) => Uint8Array {
  const bytes = ids.flatMap((id) => [...id].map((c, i) => (i === 0 ? FIRST : REST).indexOf(c)));
  let at = 0;
  return (n) => {
    const chunk = Uint8Array.from(bytes.slice(at, at + n));
    at += n;
    return chunk;
  };
}

function load(doc: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: ada,
    typing: { spellCheck: true, smartPunctuation: false, closePairs: false },
    ...options,
    extensions: [editSourceFacet.of({ now: () => NOW, random: randomIds('b2b2', 'c3c3', 'd4d4') })],
  });
  open.push(editor);
  return editor;
}

/** A document with a ledger that gives each mark's author. */
function withLedger(body: string, marks: Record<string, string>): string {
  const entries = Object.entries(marks).map(
    ([id, by]) => `  ${id}: {by: ${by}, at: 2026-10-31T09:30Z}\n`,
  );
  return `${body}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries.join('')}-->\n`;
}

const docText = (editor: Editor) => editor.view.state.doc.toString();

describe('Editor.wordAt', () => {
  it('finds the word at a position, with the block before it', () => {
    const editor = load('Hello wrold there');
    expect(editor.wordAt(8)).toEqual({ from: 6, to: 11, word: 'wrold', before: 'Hello ' });
  });

  it('finds a word from either of its ends', () => {
    const editor = load('Hello wrold there');
    expect(editor.wordAt(6)?.word).toBe('wrold');
    expect(editor.wordAt(11)?.word).toBe('wrold');
    expect(editor.wordAt(0)?.word).toBe('Hello');
    expect(editor.wordAt(17)?.word).toBe('there');
  });

  it('finds nothing between words', () => {
    const editor = load('Hello  there');
    expect(editor.wordAt(5)?.word).toBe('Hello');
    expect(editor.wordAt(6)).toBeNull();
    expect(editor.wordAt(7)?.word).toBe('there');
    const apart = load('One . Two');
    expect(apart.wordAt(5)).toBeNull();
  });

  it('keeps an apostrophe inside a word, and leaves one at an end out', () => {
    const editor = load("It's the 'cat' don’t");
    expect(editor.wordAt(2)).toMatchObject({ word: "It's", from: 0, to: 4 });
    expect(editor.wordAt(11)).toMatchObject({ word: 'cat' });
    expect(editor.wordAt(18)).toMatchObject({ word: 'don’t' });
  });

  it('is no word with a digit in it, which the checker is not asked about', () => {
    const editor = load('abc123 x2 plain');
    expect(editor.wordAt(2)).toBeNull();
    expect(editor.wordAt(7)).toBeNull();
    expect(editor.wordAt(12)?.word).toBe('plain');
  });

  it('is no word when it is longer than any word, which no checker is asked about', () => {
    const long = 'a'.repeat(101);
    const editor = load(`Hello ${long} there`);
    expect(editor.wordAt(20)).toBeNull();
    const fits = 'a'.repeat(100);
    expect(load(`Hello ${fits} there`).wordAt(20)?.word).toBe(fits);
  });

  it('reads the text before the word from the start of its paragraph', () => {
    const editor = load('First paragraph.\n\nSecond one has teh word.');
    const found = editor.wordAt(18 + 15);
    expect(found?.word).toBe('teh');
    expect(found?.before).toBe('Second one has ');
  });

  it('finds nothing in code, a code block or front matter', () => {
    const inline = load('Some `teh` code');
    expect(inline.wordAt(8)).toBeNull();
    const block = load('Text\n\n```\nteh\n```\n');
    expect(block.wordAt(10)).toBeNull();
    const front = load('---\ntitle: teh\n---\n\nBody\n');
    expect(front.wordAt(11)).toBeNull();
  });

  it('finds nothing in Raw, where the source is shown as it is', () => {
    const editor = load('Hello wrold', { view: 'raw' });
    expect(editor.wordAt(8)).toBeNull();
  });

  it('reads a word across the hidden markers of a change as the one word the page shows', () => {
    const doc = withLedger('Hello <!--ins b2b2-->wor<!--/b2b2-->ld there', { b2b2: 'bo' });
    const editor = load(doc, { view: 'redlines' });
    const found = editor.wordAt(docText(editor).indexOf('wor') + 1);
    expect(found?.word).toBe('world');
    expect(found?.from).toBe(6 + '<!--ins b2b2-->'.length);
    expect(found?.to).toBe(docText(editor).indexOf('ld') + 2);
  });

  it('finds the word in a table cell by the cell alone', () => {
    const doc = '| A | B |\n| --- | --- |\n| teh | two |\n';
    const editor = load(doc);
    const at = doc.indexOf('teh') + 1;
    expect(editor.wordAt(at)).toMatchObject({ word: 'teh', before: '' });
  });
});

describe('Editor.pickCorrection', () => {
  it('replaces the word and leaves the caret after it', () => {
    const editor = load('Hello wrold there');
    expect(editor.pickCorrection({ from: 6, to: 11 }, 'wrold', 'world')).toBe(true);
    expect(docText(editor)).toBe('Hello world there');
    expect(editor.view.state.selection.main.head).toBe(11);
  });

  it('is one step that Undo takes back', () => {
    const editor = load('Hello wrold there');
    editor.pickCorrection({ from: 6, to: 11 }, 'wrold', 'world');
    expect(undo(editor.view)).toBe(true);
    expect(docText(editor)).toBe('Hello wrold there');
  });

  it('makes a tracked change of text that was there, as typing over it would', () => {
    const editor = load('Hello wrold there', { tracking: true, view: 'redlines' });
    expect(editor.pickCorrection({ from: 6, to: 11 }, 'wrold', 'world')).toBe(true);
    const parsed = editor.getParsed();
    expect(parsed.marks.length).toBeGreaterThan(0);
    expect(parsed.marks.every((mark) => mark.entry.by === 'ada')).toBe(true);
    // Only the letters that differ are the change, and the word reads as it was corrected.
    expect(newestView(editor.getDoc()).text).toBe('Hello world there');
    expect(originalView(editor.getDoc()).text).toBe('Hello wrold there');
    expect(editor.view.state.selection.main.head).toBe(docText(editor).indexOf(' there'));
  });

  it('does nothing where the word is no longer what the page shows', () => {
    const editor = load('Hello world there');
    expect(editor.pickCorrection({ from: 6, to: 11 }, 'wrold', 'word')).toBe(false);
    expect(docText(editor)).toBe('Hello world there');
  });

  it('does nothing for the same text', () => {
    const editor = load('Hello wrold there');
    expect(editor.pickCorrection({ from: 6, to: 11 }, 'wrold', 'wrold')).toBe(false);
  });
});
