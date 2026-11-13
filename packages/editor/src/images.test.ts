// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import type { WidgetType } from '@codemirror/view';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor, type EditorOptions, type ImageSpot } from './index.ts';
import { previewDecorations } from './preview/decorations.ts';
import { IMAGE_IN_CODE, imageFiles, imageLink } from './images.ts';
import { RAW_READ_ONLY } from './tracked/typing.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

/** What the host was given when images were pasted or dropped. */
interface Given {
  files: File[];
  spot: ImageSpot;
  pasted: boolean;
}

/** An editor that hands the images it is given to the test, and keeps the notices it says. */
function load(doc: string, options: Partial<EditorOptions> = {}) {
  const given: Given[] = [];
  const notices: string[] = [];
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: ada,
    onImageFiles: (files, spot, pasted) => given.push({ files, spot, pasted }),
    onNotice: (message) => notices.push(message),
    ...options,
  });
  open.push(editor);
  return { editor, given, notices };
}

const png = (name = 'image.png') => new File(['x'], name, { type: 'image/png' });

/** Pastes a clipboard holding `files` and whatever else `data` gives it, as ⌘V does. */
function pasteFiles(editor: Editor, files: File[], data: Record<string, string> = {}) {
  const clipboardData = new DataTransfer();
  for (const file of files) clipboardData.items.add(file);
  for (const [type, value] of Object.entries(data)) clipboardData.setData(type, value);
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

/**
 * A drop of `dataTransfer` at the client point `at`. happy-dom's DragEvent carries neither, so a
 * mouse event, which has the point, stands in for it, with the data a drag event has.
 */
function dropEvent(dataTransfer: DataTransfer, at = { x: 10, y: 20 }) {
  const event = new MouseEvent('drop', {
    clientX: at.x,
    clientY: at.y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

/** Drops `files` at the client point `at`; the editor finds the position under it. */
function dropFiles(editor: Editor, files: File[], at?: { x: number; y: number }) {
  const dataTransfer = new DataTransfer();
  for (const file of files) dataTransfer.items.add(file);
  const event = dropEvent(dataTransfer, at);
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

/** What the editor finds under a point: the test says, as a page with no layout can't. */
function pointsAt(editor: Editor, pos: number | null) {
  return vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(pos);
}

describe('the link of an image', () => {
  it('is an image with no alt text, its path written as a link destination', () => {
    expect(imageLink('images/screenshot.png')).toBe('![](images/screenshot.png)');
    expect(imageLink('screenshot.png')).toBe('![](screenshot.png)');
  });

  it('writes what would end or change the destination as percent codes', () => {
    expect(imageLink('my images/a b (1).png')).toBe('![](my%20images/a%20b%20%281%29.png)');
    expect(imageLink('images/Photo #2? 100%.png')).toBe('![](images/Photo%20%232%3F%20100%25.png)');
    expect(imageLink('a[1]<b>\\c.png')).toBe('![](a%5B1%5D%3Cb%3E%5Cc.png)');
  });

  it('keeps letters of any language, which a destination may hold', () => {
    expect(imageLink('images/café 日本.png')).toBe('![](images/café%20日本.png)');
  });
});

describe('images pasted into the editor', () => {
  it('goes to the host with a spot at the caret, and its link is written there once it is saved', () => {
    const { editor, given } = load('One two\n');
    editor.view.dispatch({ selection: { anchor: 3 } });
    const event = pasteFiles(editor, [png()]);
    // Nothing of the clipboard goes in as it is: no image in the text, no name.
    expect(event.defaultPrevented).toBe(true);
    expect(given).toHaveLength(1);
    expect(given[0]!.pasted).toBe(true);
    expect(given[0]!.files.map((file) => file.name)).toEqual(['image.png']);
    // Nothing is written until the host has saved the image and says what to link.
    expect(editor.getDoc()).toBe('One two\n');
    expect(given[0]!.spot.insert(['images/shot.png'])).toBe(true);
    expect(editor.getDoc()).toBe('One![](images/shot.png) two\n');
    // The caret is past the space after the link, off it, so that the image shows.
    expect(editor.view.state.selection.main.head).toBe(3 + '![](images/shot.png)'.length + 1);
  });

  it('replaces the selection, as pasting does', () => {
    const { editor, given } = load('One two three\n');
    editor.view.dispatch({ selection: { anchor: 4, head: 7 } });
    pasteFiles(editor, [png()]);
    given[0]!.spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('One ![](shot.png) three\n');
  });

  it('leaves a paste of text alone', () => {
    const { editor, given } = load('One\n');
    editor.view.dispatch({ selection: { anchor: 3 } });
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', ' two');
    editor.view.contentDOM.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    );
    expect(given).toEqual([]);
    expect(editor.getDoc()).toBe('One two\n');
  });

  it('leaves web content alone, whose images keep their addresses (design §5.10)', () => {
    const { editor, given } = load('One\n');
    // What copying an image in a browser puts on the clipboard: its markup, and its data too.
    pasteFiles(editor, [png()], {
      'text/html': '<img src="https://example.com/a.png" alt="A">',
      'text/plain': 'A',
    });
    expect(given).toEqual([]);
  });

  it('takes the image of a file copied in Finder, whose text is its name', () => {
    const { editor, given } = load('One\n');
    const event = pasteFiles(editor, [png('Photo 3.png')], { 'text/plain': 'Photo 3.png' });
    expect(given).toHaveLength(1);
    expect(given[0]!.files.map((file) => file.name)).toEqual(['Photo 3.png']);
    expect(event.defaultPrevented).toBe(true);
    // The name is not pasted as text.
    expect(editor.getDoc()).toBe('One\n');
  });

  it('takes several images together, and none of the other files', () => {
    const { editor, given } = load('One\n');
    const pdf = new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' });
    pasteFiles(editor, [png('a.png'), pdf, png('b.png')]);
    expect(given[0]!.files.map((file) => file.name)).toEqual(['a.png', 'b.png']);
  });

  it('leaves a clipboard with no image in it alone, whatever other files it holds', () => {
    const { editor, given } = load('One\n');
    const pdf = new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' });
    pasteFiles(editor, [pdf]);
    expect(given).toEqual([]);
    expect(editor.getDoc()).toBe('One\n');
  });

  it('is handled as it was when the host asks for no images, which is no spot to give', () => {
    const { editor } = load('One\n', { onImageFiles: undefined });
    pasteFiles(editor, [png()]);
    expect(editor.getDoc()).toBe('One\n');
    // The host that asks for no paste can still ask for a spot, for the images it has by itself.
    editor.imageSpot()!.insert(['a.png']);
    expect(editor.getDoc()).toBe('![](a.png)One\n');
  });
});

describe('images dropped on the editor', () => {
  it('go to the host with a spot where they landed', () => {
    const { editor, given } = load('One two three\n');
    editor.view.dispatch({ selection: { anchor: 0 } });
    const finding = pointsAt(editor, 8);
    const event = dropFiles(editor, [png('plan.png')], { x: 40, y: 12 });
    expect(event.defaultPrevented).toBe(true);
    expect(finding).toHaveBeenCalledWith({ x: 40, y: 12 }, false);
    expect(given).toHaveLength(1);
    // A dropped file keeps its name: it is a file, not a clipboard's data.
    expect(given[0]!.pasted).toBe(false);
    expect(given[0]!.files.map((file) => file.name)).toEqual(['plan.png']);
    expect(editor.getDoc()).toBe('One two three\n');
    given[0]!.spot.insert(['images/plan.png']);
    expect(editor.getDoc()).toBe('One two ![](images/plan.png)three\n');
  });

  it('go where the caret is when the point is over no text', () => {
    const { editor, given } = load('One two\n');
    editor.view.dispatch({ selection: { anchor: 3 } });
    pointsAt(editor, null);
    dropFiles(editor, [png()]);
    given[0]!.spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('One![](shot.png) two\n');
  });

  it('leave a drop of text to the editor, which has no image file in it', () => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'dragged');
    expect(imageFiles(dataTransfer)).toEqual([]);
    expect(imageFiles(null)).toEqual([]);
  });

  it('leave a drop of web content to the editor, whose images keep their addresses', () => {
    const { editor, given } = load('One\n');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(png());
    dataTransfer.setData('text/html', '<img src="https://example.com/a.png">');
    editor.view.contentDOM.dispatchEvent(dropEvent(dataTransfer));
    expect(given).toEqual([]);
  });
});

describe('after the links are written', () => {
  /** A spot at `at` in `doc`, as a paste there gives one. */
  function spotAt(doc: string, at: number, options: Partial<EditorOptions> = {}) {
    const made = load(doc, options);
    made.editor.view.dispatch({ selection: { anchor: at } });
    pasteFiles(made.editor, [png()]);
    return { ...made, spot: made.given[0]!.spot };
  }

  /** The images the preview draws now, which it draws except where the caret is. */
  function drawn(editor: Editor): number {
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    let found = 0;
    const { state } = editor.view;
    previewDecorations(state).between(0, state.doc.length, (_from, _to, value) => {
      const widget = (value.spec as { widget?: WidgetType }).widget;
      if (widget?.toDOM(editor.view).classList.contains('rl-image')) found++;
    });
    return found;
  }

  it('has the caret past the link, so that the preview draws the image at once', () => {
    const { editor, spot } = spotAt('One two\n', 3, { resolveImage: (src) => `app://${src}` });
    spot.insert(['shot.png']);
    expect(drawn(editor)).toBe(1);
  });

  it('has the caret on the next line when the links end a line', () => {
    const { editor, spot } = spotAt('One\nTwo\n', 3);
    spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('One![](shot.png)\nTwo\n');
    expect(editor.view.state.selection.main.head).toBe('One![](shot.png)\n'.length);
  });

  it('ends the document with a line break after them, where the caret goes, when they end it', () => {
    const { editor, spot } = spotAt('One\n', 4, { resolveImage: (src) => `app://${src}` });
    spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('One\n![](shot.png)\n');
    expect(editor.view.state.selection.main.head).toBe(editor.view.state.doc.length);
    expect(drawn(editor)).toBe(1);
  });

  it('does the same while Track Changes is on, which is the person’s own change and breaks no marker rule', () => {
    const { editor, spot } = spotAt('One\n', 4, {
      tracking: true,
      resolveImage: (src) => `app://${src}`,
    });
    spot.insert(['shot.png']);
    // After the last line break, the format writes the insertion as it writes typing there.
    const marks = editor.getParsed().marks;
    expect(marks.length).toBeGreaterThan(0);
    expect(new Set(marks.map((mark) => mark.entry.by))).toEqual(new Set(['ada']));
    expect(editor.getDoc()).toContain('![](shot.png)');
    expect(parse(editor.getDoc()).warnings.map((warning) => warning.code)).toEqual([]);
    expect(editor.view.state.selection.main.head).toBeGreaterThan(
      editor.getDoc().indexOf('shot.png') + 'shot.png)'.length,
    );
    expect(drawn(editor)).toBe(1);
  });

  it('keeps the caret on the link where a letter follows it, which is where the caret is', () => {
    const { editor, spot } = spotAt('Onetwo\n', 3);
    spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('One![](shot.png)two\n');
    expect(editor.view.state.selection.main.head).toBe('One![](shot.png)'.length);
  });
});

describe('a spot', () => {
  /** A spot at `at` in `doc`, as a paste there gives one. */
  function spotAt(doc: string, at: number, options: Partial<EditorOptions> = {}) {
    const made = load(doc, options);
    made.editor.view.dispatch({ selection: { anchor: at } });
    pasteFiles(made.editor, [png()]);
    return { ...made, spot: made.given[0]!.spot };
  }

  it('follows the text around it, so that what is written meanwhile moves nothing', () => {
    const { editor, spot } = spotAt('One two\n', 3);
    editor.view.dispatch({ changes: { from: 0, insert: 'Say: ' } });
    spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('Say: One![](shot.png) two\n');
  });

  it('is used once', () => {
    const { editor, spot } = spotAt('One\n', 3);
    expect(spot.insert(['a.png'])).toBe(true);
    expect(spot.insert(['b.png'])).toBe(false);
    expect(editor.getDoc()).toBe('One![](a.png)\n');
  });

  it('writes nothing once it is let go', () => {
    const { editor, spot } = spotAt('One\n', 3);
    spot.release();
    expect(spot.insert(['a.png'])).toBe(false);
    expect(editor.getDoc()).toBe('One\n');
  });

  it('writes one link for each image, a space apart', () => {
    const { editor, spot } = spotAt('One\n', 3);
    spot.insert(['my images/a b.png', 'x.png']);
    expect(editor.getDoc()).toBe('One![](my%20images/a%20b.png) ![](x.png)\n');
  });

  it('writes nothing for no images', () => {
    const { editor, spot } = spotAt('One\n', 3);
    expect(spot.insert([])).toBe(false);
    expect(editor.getDoc()).toBe('One\n');
  });

  it('is gone with the document it was taken in', () => {
    const { editor, spot } = spotAt('One\n', 3);
    editor.setDoc('Another document\n');
    expect(spot.insert(['a.png'])).toBe(false);
    expect(editor.getDoc()).toBe('Another document\n');
  });

  it('can be taken without a paste, at the selection or at a point', () => {
    const { editor } = load('One two\n');
    editor.view.dispatch({ selection: { anchor: 3 } });
    editor.imageSpot()!.insert(['a.png']);
    expect(editor.getDoc()).toBe('One![](a.png) two\n');
    pointsAt(editor, 0);
    editor.imageSpot({ x: 1, y: 1 })!.insert(['b.png']);
    expect(editor.getDoc()).toBe('![](b.png)One![](a.png) two\n');
  });
});

describe('an image written while Track Changes is on', () => {
  it('is the person’s own tracked insertion', () => {
    const { editor, given } = load('One two\n', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 3 } });
    pasteFiles(editor, [png()]);
    given[0]!.spot.insert(['images/shot.png']);
    const insertions = editor.getParsed().marks.filter((mark) => mark.kind === 'ins');
    expect(insertions.map((mark) => mark.entry.by)).toEqual(['ada']);
    // The link is what the mark holds; the file's text names the author in its ledger.
    expect(editor.getDoc()).toContain('![](images/shot.png)<!--/');
    expect(editor.getDoc()).toContain('One<!--ins ');
  });

  it('is plain text while Track Changes is off', () => {
    const { editor, given } = load('One two\n', { tracking: false });
    editor.view.dispatch({ selection: { anchor: 3 } });
    pasteFiles(editor, [png()]);
    given[0]!.spot.insert(['images/shot.png']);
    expect(editor.getDoc()).toBe('One![](images/shot.png) two\n');
    expect(editor.getParsed().marks).toEqual([]);
  });

  it('is taken back by one Undo, which the Edit menu calls Insert Image', () => {
    const { editor, given } = load('One two\n', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 3 } });
    pasteFiles(editor, [png()]);
    given[0]!.spot.insert(['shot.png']);
    expect(editor.getUiState().undo).toBe('Insert Image');
    expect(editor.undo()).toBe(true);
    expect(editor.getDoc()).toBe('One two\n');
  });
});

describe('where the editor takes no image', () => {
  it('refuses in Raw while Track Changes is on, with the reason, and pastes nothing', () => {
    const { editor, given, notices } = load('One two\n', { view: 'raw', tracking: true });
    editor.view.dispatch({ selection: { anchor: 3 } });
    const event = pasteFiles(editor, [png()]);
    // The image is not pasted into the page by the browser either.
    expect(event.defaultPrevented).toBe(true);
    expect(given).toEqual([]);
    expect(notices).toEqual([RAW_READ_ONLY]);
    expect(editor.getDoc()).toBe('One two\n');
  });

  it('takes one in Raw while Track Changes is off', () => {
    const { editor, given, notices } = load('One two\n', { view: 'raw', tracking: false });
    editor.view.dispatch({ selection: { anchor: 3 } });
    pasteFiles(editor, [png()]);
    expect(notices).toEqual([]);
    given[0]!.spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('One![](shot.png) two\n');
  });

  it('refuses in a code block, and in code in a line, and says why', () => {
    const { editor, given, notices } = load('Text `code` here\n\n```\nfenced\n```\n');
    const inline = 'Text `co'.length;
    editor.view.dispatch({ selection: { anchor: inline } });
    pasteFiles(editor, [png()]);
    const fenced = editor.view.state.doc.toString().indexOf('fenced') + 2;
    editor.view.dispatch({ selection: { anchor: fenced } });
    pasteFiles(editor, [png()]);
    expect(given).toEqual([]);
    expect(notices).toEqual([IMAGE_IN_CODE, IMAGE_IN_CODE]);
    expect(editor.getDoc()).toBe('Text `code` here\n\n```\nfenced\n```\n');
  });

  it('says so for a spot asked for by the host, which is then none', () => {
    const { editor, notices } = load('One\n', { view: 'raw', tracking: true });
    expect(editor.imageSpot()).toBeNull();
    expect(notices).toEqual([RAW_READ_ONLY]);
  });
});
