// @vitest-environment happy-dom
// An image's alt text (#553): what the editor writes between `![` and `]`, or in a tag's `alt`, with
// Track Changes off and on, escaped as format §3.5.1 says, and taken back by one Undo.
import { forceParsing } from '@codemirror/language';
import { newestView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { undo } from './history/index.ts';
import { escapeAlt, imageInSelection, setImageAlt } from './image-size.ts';
import { createEditor, type Editor } from './index.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, at = 0): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    openImage: () => {},
  });
  open.push(editor);
  editor.view.dispatch({ selection: { anchor: at } });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  return editor;
}

const text = (editor: Editor) => editor.view.state.doc.toString();

describe('Alt text with Track Changes off', () => {
  it('replaces what is between the brackets and keeps the rest of the image as it was', () => {
    const editor = load('Words ![A cat](cat.png "Tip") more', 8);
    expect(setImageAlt(editor.view, 'A grey cat on a sofa')).toBe(true);
    expect(text(editor)).toBe('Words ![A grey cat on a sofa](cat.png "Tip") more');
    expect(imageInSelection(editor.view.state)?.alt).toBe('A grey cat on a sofa');
  });

  it('adds alt text to an image that has none, and takes it away again with an empty one', () => {
    const editor = load('![](cat.png)', 1);
    expect(setImageAlt(editor.view, '  A cat \n sleeping ')).toBe(true);
    expect(text(editor)).toBe('![A cat sleeping](cat.png)');
    expect(setImageAlt(editor.view, '')).toBe(true);
    expect(text(editor)).toBe('![](cat.png)');
  });

  it('does nothing, and says so, when the image has that alt text already or there is no image', () => {
    const editor = load('![A cat](cat.png)\n\nWords', 1);
    expect(setImageAlt(editor.view, 'A cat')).toBe(false);
    editor.view.dispatch({ selection: { anchor: text(editor).indexOf('Words') } });
    expect(setImageAlt(editor.view, 'Other')).toBe(false);
    expect(text(editor)).toBe('![A cat](cat.png)\n\nWords');
  });

  it('escapes brackets, backslashes and what Markdown would read as more than text', () => {
    expect(escapeAlt('a [b] \\ c & `d` *e* _f_ <g>', false)).toBe(
      'a \\[b\\] \\\\ c \\& \\`d\\` \\*e\\* \\_f\\_ \\<g\\>',
    );
    const editor = load('![](cat.png)', 1);
    setImageAlt(editor.view, 'Fig. [1] & *more*');
    expect(imageInSelection(editor.view.state)?.alt).toBe('Fig. [1] & *more*');
    expect(text(editor)).toBe('![Fig. \\[1\\] \\& \\*more\\*](cat.png)');
  });

  it('reads back what was typed, character references and escapes included', () => {
    const editor = load('![](cat.png)', 1);
    for (const typed of ['&amp;', '&#38;', '\\&', 'a &lt; b', '\\*x\\*', 'R&D']) {
      setImageAlt(editor.view, typed);
      expect(imageInSelection(editor.view.state)?.alt).toBe(typed);
      setImageAlt(editor.view, '');
    }
  });

  it('escapes a pipe in a table cell, where it would end the cell', () => {
    const table = '| x |\n|---|\n| ![](cat.png) |';
    const editor = load(table, table.indexOf('![') + 1);
    setImageAlt(editor.view, 'a|b');
    expect(text(editor)).toContain('| ![a\\|b](cat.png) |');
    expect(imageInSelection(editor.view.state)?.alt).toBe('a|b');
  });

  it('writes the alt attribute of a tag, in the place it had, keeping the others', () => {
    const editor = load('<img src="a.png" alt="Old" width="200">', 2);
    setImageAlt(editor.view, 'A "new" one & more');
    expect(text(editor)).toBe(
      '<img src="a.png" alt="A &quot;new&quot; one &amp; more" width="200">',
    );
    setImageAlt(editor.view, '');
    // An empty alt stays, which says the picture needs none; no alt at all says it was not described.
    expect(text(editor)).toBe('<img src="a.png" alt="" width="200">');
    setImageAlt(editor.view, 'Back');
    expect(text(editor)).toBe('<img src="a.png" alt="Back" width="200">');
    const bare = load('<img src="b.png">', 2);
    expect(setImageAlt(bare.view, '')).toBe(false);
    expect(text(bare)).toBe('<img src="b.png">');
  });

  it('is one change that one Undo takes back', () => {
    const editor = load('![A cat](cat.png)', 1);
    setImageAlt(editor.view, 'A dog');
    expect(undo(editor.view)).toBe(true);
    expect(text(editor)).toBe('![A cat](cat.png)');
  });
});

describe('Alt text with Track Changes on', () => {
  it('is an ordinary tracked edit: a substitution of the image that every decision reads the same', () => {
    const editor = load('Words ![A cat](cat.png) more', 8);
    editor.setTracking(true, { inFile: false });
    expect(setImageAlt(editor.view, 'A grey cat')).toBe(true);
    const file = text(editor);
    expect(parse(file).marks.map((mark) => mark.kind)).toEqual(['sub']);
    expect(file).toMatch(
      /Words <!--sub \w{4} !\[A cat\]\(cat\.png\)-->!\[A grey cat\]\(cat\.png\)<!--\/\w{4}--> more/,
    );
    expect(newestView(file).text).toBe('Words ![A grey cat](cat.png) more');
  });

  it('writes nothing for the alt text the image has, however it is written', () => {
    const editor = load('![a*b](cat.png)', 1);
    editor.setTracking(true, { inFile: false });
    expect(setImageAlt(editor.view, 'a*b')).toBe(false);
    expect(text(editor)).toBe('![a*b](cat.png)');
  });

  it('is tracked inside a pending change too, keeping its old text', () => {
    const editor = load('Some text here.\n\n![A cat](cat.png)\n', 2);
    editor.setTracking(true, { inFile: false });
    editor.view.dispatch({ changes: { from: 4, insert: 'new ' }, userEvent: 'input.type' });
    const at = text(editor).indexOf('![A cat');
    editor.view.dispatch({ selection: { anchor: at + 1 } });
    expect(setImageAlt(editor.view, 'A cat, asleep')).toBe(true);
    const kinds = parse(text(editor)).marks.map((mark) => mark.kind);
    expect(kinds).toContain('ins');
    expect(kinds).toContain('sub');
    expect(newestView(text(editor)).text).toContain('![A cat, asleep](cat.png)');
  });
});
