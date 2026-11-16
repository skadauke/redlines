// @vitest-environment happy-dom
// An image's size in a pandoc file (`.qmd`, `.Rmd`; #630, format §3.5.1): written as pandoc's
// attribute block, `![alt](src){width=300px}`, read, drawn and tracked with the image as one unit.
import { forceParsing } from '@codemirror/language';
import { parse } from '@redlines/format';
import type { MarkdownDialect } from './api.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { undo } from './history/index.ts';
import { IMAGE_ATTRIBUTES, imageInSelection, lookEdit } from './image-size.ts';
import type { ImageLook } from './image-size.ts';
import { createEditor, type Editor } from './index.ts';
import { previewDecorations } from './preview/decorations.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, dialect: MarkdownDialect = 'pandoc') {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    dialect,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    openImage: () => {},
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  return editor;
}

function written(doc: string, look: ImageLook, dialect: MarkdownDialect = 'pandoc') {
  const { view } = load(doc, dialect);
  const edit = lookEdit(view.state, imageInSelection(view.state)!, look);
  return edit ? (edit.changes[0]?.insert ?? edit.blocked) : null;
}

describe('an image in a pandoc file', () => {
  it('reads its attribute block as the image, with its width', () => {
    const { view } = load('![A cat](cat.png){width=50%} and ![b](b.png){width=120px #fig}');
    expect(imageInSelection(view.state)).toMatchObject({
      from: 0,
      to: 28,
      widthText: '50%',
      width: null,
    });
    view.dispatch({ selection: { anchor: 38 } });
    expect(imageInSelection(view.state)).toMatchObject({ width: 120, widthText: null });
  });

  it('writes the first size as an attribute block, never as a tag', () => {
    expect(written('![A cat](cat.png "Tip")', { width: 320 })).toBe(
      '![A cat](cat.png "Tip"){width=320px}',
    );
  });

  it('changes the width where it stands, keeps the other attributes, takes the height away', () => {
    expect(written('![](a.png){#fig width=50% height=10 .wide}', { width: 200 })).toBe(
      '![](a.png){#fig .wide width=200px}',
    );
  });

  it('gives the image its own size by taking the width away, and the block when it is empty', () => {
    expect(written('![](a.png){width=200px}', { width: null })).toBe('![](a.png)');
    expect(written('![](a.png){width=200px .wide}', { width: null })).toBe('![](a.png){.wide}');
  });

  it('turns a tag that is given a width into the block, where nothing would be lost', () => {
    expect(written('<img src="a.png" alt="A" width="100">', { width: 200 })).toBe(
      '![A](a.png){width=200px}',
    );
    expect(written('<img src="a.png" class="x" width="100">', { width: 200 })).toBe(
      '<img src="a.png" class="x" width="200">',
    );
  });

  it('keeps an image whose alignment is already centered as it is', () => {
    expect(written('![](a.png){width=50%}', { align: 'center' })).toBeNull();
  });

  it('writes an alignment as a tag that keeps the width, and says no for attributes it would lose', () => {
    expect(written('![](a.png){width=200px}', { align: 'left' })).toBe(
      '<img src="a.png" width="200" align="left">',
    );
    expect(written('![](a.png){.wide}', { align: 'left' })).toBe(IMAGE_ATTRIBUTES);
  });

  it('disables the alignments for an image whose block holds more than a size', () => {
    const { view, commands } = load('![](a.png){#fig width=10px}');
    expect(
      commands
        .list()
        .find((c) => c.id === 'image.align.left')
        ?.disabledReason?.(view.state),
    ).toBe(IMAGE_ATTRIBUTES);
    expect(
      commands
        .list()
        .find((c) => c.id === 'image.align.center')
        ?.disabledReason?.(view.state),
    ).toBeUndefined();
  });

  it('is drawn as one image, its block hidden with it', () => {
    const { view } = load('![A cat](cat.png){width=120px}\n');
    const ranges: [number, number][] = [];
    previewDecorations(view.state).between(0, view.state.doc.length, (from, to, value) => {
      if ((value.spec as { imageAtom?: true }).imageAtom) ranges.push([from, to]);
    });
    expect(ranges).toEqual([[0, 30]]);
  });

  it('writes a size as a substitution of the whole image with Track Changes on', () => {
    const editor = load('Words ![A cat](a.png){width=40px} more');
    editor.view.dispatch({ selection: { anchor: 8 } });
    editor.setTracking(true, { inFile: false });
    expect(editor.commands.run('image.size.medium')).toBe(true);
    const file = editor.getDoc();
    expect(parse(file).marks.map((mark) => mark.kind)).toEqual(['sub']);
    expect(file).toMatch(
      /^Words <!--sub \w{4} !\[A cat\]\(a\.png\)\{width=40px\}-->!\[A cat\]\(a\.png\)\{width=\d+px\}<!--\/\w{4}--> more/,
    );
  });

  it('writes the size without marks with Track Changes off, and Undo takes it back', () => {
    const editor = load('![A cat](a.png)\n');
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(editor.commands.run('image.size.small')).toBe(true);
    expect(editor.getDoc()).toMatch(/^!\[A cat\]\(a\.png\)\{width=\d+px\}\n$/);
    expect(parse(editor.getDoc()).marks).toEqual([]);
    undo(editor.view);
    expect(editor.getDoc()).toBe('![A cat](a.png)\n');
  });

  it('round trips from the image to its size and back', () => {
    for (const doc of ['![A cat](cat.png)', '![](a.png "T")', '![a b](<my cat.png>)']) {
      const sized = written(doc, { width: 77 })!;
      expect(sized).toBe(`${doc}{width=77px}`);
      expect(written(sized, { width: null })).toBe(doc);
    }
  });
});

describe('an image in a .md file', () => {
  it('still writes <img width>, and reads {width=} as text', () => {
    expect(written('![A cat](cat.png "Tip")', { width: 320 }, 'gfm')).toBe(
      '<img src="cat.png" alt="A cat" title="Tip" width="320">',
    );
    const { view } = load('![A cat](cat.png){width=50%}', 'gfm');
    expect(imageInSelection(view.state)).toMatchObject({ to: 17, widthText: null, width: null });
  });

  it('finds the image from a caret just after its block, and redraws at a rename', () => {
    const editor = load('![A cat](a.png){width=40px}\n', 'gfm');
    editor.setKind('markdown', 'pandoc');
    editor.view.dispatch({ selection: { anchor: 27 } });
    expect(imageInSelection(editor.view.state)).toMatchObject({ from: 0, to: 27, width: 40 });
    const ranges: [number, number][] = [];
    previewDecorations(editor.view.state).between(0, 27, (from, to, value) => {
      if ((value.spec as { imageAtom?: true }).imageAtom) ranges.push([from, to]);
    });
    expect(ranges).toEqual([[0, 27]]);
  });

  it('takes a dialect change, as a rename to .qmd does', () => {
    const editor = load('![A cat](a.png)\n', 'gfm');
    editor.setKind('markdown', 'pandoc');
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(editor.commands.run('image.size.medium')).toBe(true);
    expect(editor.getDoc()).toMatch(/\{width=\d+px\}/);
  });
});
