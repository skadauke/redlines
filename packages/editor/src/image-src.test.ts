// @vitest-environment happy-dom
// Pointing an image at another file (Crop, #624): the reference changes and nothing else does, with
// Track Changes off and on, and one Undo takes it back.
import { forceParsing } from '@codemirror/language';
import { newestView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { undo } from './history/index.ts';
import { imageInSelection, setImageSrc } from './image-size.ts';
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

describe('An image pointed at its cropped copy, Track Changes off', () => {
  it('changes the address of a Markdown image and keeps its alt text and title', () => {
    const editor = load('Words ![A cat](images/cat.png "Tip") more', 8);
    expect(setImageSrc(editor.view, 'images/cat-crop-1.png')).toBe(true);
    expect(text(editor)).toBe('Words ![A cat](images/cat-crop-1.png "Tip") more');
    expect(imageInSelection(editor.view.state)?.src).toBe('images/cat-crop-1.png');
  });

  it('writes a path with a space as a link destination does', () => {
    const editor = load('![](images/my cat.png)'.replace(' ', '%20'), 1);
    setImageSrc(editor.view, 'images/my cat-crop-1.png');
    expect(text(editor)).toBe('![](images/my%20cat-crop-1.png)');
    expect(imageInSelection(editor.view.state)?.src).toBe('images/my%20cat-crop-1.png');
    // Pointed at the file it points at already: nothing to write.
    expect(setImageSrc(editor.view, 'images/my cat-crop-1.png')).toBe(false);
  });

  it('keeps the width and the alignment of a tag, and its other attributes as written', () => {
    const editor = load('<img src="a.png" alt="Old" width="200" align="right">', 2);
    expect(setImageSrc(editor.view, 'a-crop-1.png')).toBe(true);
    expect(text(editor)).toBe('<img src="a-crop-1.png" alt="Old" width="200" align="right">');
  });

  it('keeps the size block of a pandoc image', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: '![Cat](cat.png){width=300px}',
      author: { handle: 'ada', name: 'Ada' },
      dialect: 'pandoc',
    });
    open.push(editor);
    editor.view.dispatch({ selection: { anchor: 2 } });
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    expect(setImageSrc(editor.view, 'cat-crop-1.png')).toBe(true);
    expect(text(editor)).toBe('![Cat](cat-crop-1.png){width=300px}');
  });

  it('does nothing where the image points there already or there is no image', () => {
    const editor = load('![A cat](cat.png)\n\nWords', 1);
    expect(setImageSrc(editor.view, 'cat.png')).toBe(false);
    editor.view.dispatch({ selection: { anchor: text(editor).indexOf('Words') } });
    expect(setImageSrc(editor.view, 'other.png')).toBe(false);
    expect(text(editor)).toBe('![A cat](cat.png)\n\nWords');
  });

  it('is one change that one Undo takes back', () => {
    const editor = load('![A cat](cat.png)', 1);
    setImageSrc(editor.view, 'cat-crop-1.png');
    expect(undo(editor.view)).toBe(true);
    expect(text(editor)).toBe('![A cat](cat.png)');
  });
});

describe('An image pointed at its cropped copy, Track Changes on', () => {
  it('is an ordinary tracked edit: a substitution of the image, the original kept in it', () => {
    const editor = load('Words ![A cat](images/cat.png) more', 8);
    editor.setTracking(true, { inFile: false });
    expect(setImageSrc(editor.view, 'images/cat-crop-1.png')).toBe(true);
    const file = text(editor);
    expect(parse(file).marks.map((mark) => mark.kind)).toEqual(['sub']);
    expect(file).toMatch(
      /Words <!--sub \w{4} !\[A cat\]\(images\/cat\.png\)-->!\[A cat\]\(images\/cat-crop-1\.png\)<!--\/\w{4}--> more/,
    );
    expect(newestView(file).text).toBe('Words ![A cat](images/cat-crop-1.png) more');
  });

  it('keeps the width of a tag in the new text, and the old tag in the change', () => {
    const editor = load('<img src="a.png" width="200">', 2);
    editor.setTracking(true, { inFile: false });
    expect(setImageSrc(editor.view, 'a-crop-1.png')).toBe(true);
    expect(newestView(text(editor)).text).toBe('<img src="a-crop-1.png" width="200">');
    expect(text(editor)).toContain('<img src="a.png" width="200">');
  });
});
