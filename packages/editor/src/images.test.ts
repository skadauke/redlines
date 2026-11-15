// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import type { WidgetType } from '@codemirror/view';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor, type EditorOptions, type ImageSpot } from './index.ts';
import { previewDecorations } from './preview/decorations.ts';
import { DOCUMENT_CHANGED, IMAGE_IN_CODE, imageFiles, imageLink } from './images.ts';
import { RAW_READ_ONLY } from './tracked/typing.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  vi.restoreAllMocks();
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

/**
 * What is under a client point, which a page with no layout can't say: the editor's text for a point
 * in its box (here 100 to 700 across and 50 to 300 down), else the page around it, as the sidebar,
 * the title bar and the ground below the document are.
 */
function overText(editor: Editor) {
  return vi
    .spyOn(editor.view.root, 'elementFromPoint')
    .mockImplementation((x, y) =>
      x >= 100 && x <= 700 && y >= 50 && y <= 300 ? editor.view.contentDOM : document.body,
    );
}

/** What the editor finds in the text at a point over it: the test says, as a page with no layout can't. */
function pointsAt(editor: Editor, pos: number | null) {
  overText(editor);
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
    // The caret is at the end of the links, as after any paste.
    expect(editor.view.state.selection.main.head).toBe(3 + '![](images/shot.png)'.length);
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
    const event = dropFiles(editor, [png('plan.png')], { x: 400, y: 120 });
    expect(event.defaultPrevented).toBe(true);
    expect(finding).toHaveBeenCalledWith({ x: 400, y: 120 });
    expect(given).toHaveLength(1);
    // A dropped file keeps its name: it is a file, not a clipboard's data.
    expect(given[0]!.pasted).toBe(false);
    expect(given[0]!.files.map((file) => file.name)).toEqual(['plan.png']);
    expect(editor.getDoc()).toBe('One two three\n');
    given[0]!.spot.insert(['images/plan.png']);
    expect(editor.getDoc()).toBe('One two ![](images/plan.png)three\n');
  });

  it('go where the caret is when no line covers the point', () => {
    const { editor, given } = load('One two\n');
    editor.view.dispatch({ selection: { anchor: 3 } });
    pointsAt(editor, null);
    dropFiles(editor, [png()], { x: 400, y: 120 });
    given[0]!.spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('One![](shot.png) two\n');
  });

  it('go where the caret is when something else is over the text at the point, as the title bar is over a scrolled document', () => {
    const { editor, given } = load('One two\n');
    editor.view.dispatch({ selection: { anchor: 3 } });
    const finding = pointsAt(editor, 7);
    // At a point in the box, where the title bar is now, not the text.
    vi.spyOn(editor.view.root, 'elementFromPoint').mockReturnValue(
      document.createElement('header'),
    );
    dropFiles(editor, [png()], { x: 400, y: 120 });
    expect(finding).not.toHaveBeenCalled();
    given[0]!.spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('One![](shot.png) two\n');
  });

  it.each([
    ['over the sidebar, left of the text', { x: 50, y: 120 }],
    ['above the text, over the title bar', { x: 400, y: 20 }],
    ['below the text', { x: 400, y: 400 }],
    ['beyond the text on the right', { x: 800, y: 120 }],
  ])(
    'go where the caret is when the point is %s, which CodeMirror would clamp to the text',
    (_, at) => {
      const { editor, given } = load('One two\n');
      editor.view.dispatch({ selection: { anchor: 3 } });
      // Asked, the editor would give the start or the end of the text, or the line at that height.
      const finding = pointsAt(editor, 7);
      dropFiles(editor, [png()], at);
      expect(finding).not.toHaveBeenCalled();
      given[0]!.spot.insert(['shot.png']);
      expect(editor.getDoc()).toBe('One![](shot.png) two\n');
    },
  );

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
    const made = load(doc, { resolveImage: (src) => `app://${src}`, ...options });
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
      const dom = widget?.toDOM(editor.view);
      // An image that is not found draws its alt text under the same class.
      if (dom?.classList.contains('rl-image') && !dom.classList.contains('rl-image-missing')) {
        found++;
      }
    });
    return found;
  }

  it('leaves the caret at the end of the links, where the preview draws the image all the same', () => {
    const { editor, spot } = spotAt('One two\n', 3);
    spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('One![](shot.png) two\n');
    expect(editor.view.state.selection.main.head).toBe('One![](shot.png)'.length);
    // The preview draws an image except where the caret is on it, and a link just added is the
    // one exception, for the caret has nowhere else to be.
    expect(drawn(editor)).toBe(1);
  });

  it('draws it where text follows the links directly, and at the start of a line', () => {
    const joined = spotAt('Onetwo\n', 3);
    joined.spot.insert(['shot.png']);
    // Nothing is written that the person didn't paste.
    expect(joined.editor.getDoc()).toBe('One![](shot.png)two\n');
    expect(drawn(joined.editor)).toBe(1);
    const first = spotAt('Hello\n', 0);
    first.spot.insert(['shot.png']);
    expect(first.editor.getDoc()).toBe('![](shot.png)Hello\n');
    expect(drawn(first.editor)).toBe(1);
  });

  it('draws it at the end of a line, and of the document, with nothing written after the links', () => {
    const line = spotAt('One\nTwo\n', 3);
    line.spot.insert(['shot.png']);
    expect(line.editor.getDoc()).toBe('One![](shot.png)\nTwo\n');
    expect(drawn(line.editor)).toBe(1);
    const end = spotAt('One\n', 4);
    end.spot.insert(['shot.png']);
    expect(end.editor.getDoc()).toBe('One\n![](shot.png)');
    expect(end.editor.view.state.selection.main.head).toBe(end.editor.view.state.doc.length);
    expect(drawn(end.editor)).toBe(1);
  });

  it.each([
    ['a blank line before the ledger', 'One\n\n'],
    ['the ledger on the next line', 'One\n'],
  ])(
    'draws it at the end of the last line of a file that ends with its ledger, with %s',
    (_, body) => {
      // Nothing can follow the links there: the body ends with its last line.
      const LEDGER = '<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada Lovelace}\n-->\n';
      const { editor, spot } = spotAt(body + LEDGER, 3);
      spot.insert(['shot.png']);
      expect(editor.view.state.selection.main.head).toBe('One![](shot.png)'.length);
      expect(drawn(editor)).toBe(1);
    },
  );

  it('shows the source when the caret moves onto the link, and the image again once it moves off', () => {
    const { editor, spot } = spotAt('One two\n', 3);
    spot.insert(['shot.png']);
    const end = editor.view.state.selection.main.head;
    editor.view.dispatch({ selection: { anchor: end - 1 } });
    expect(drawn(editor)).toBe(0);
    editor.view.dispatch({ selection: { anchor: end + 2 } });
    expect(drawn(editor)).toBe(1);
    // And back to its end: the exception was for the link as it was added, and is over.
    editor.view.dispatch({ selection: { anchor: end } });
    expect(drawn(editor)).toBe(0);
  });

  it('ends the exception when anything is written, even where the caret and the link stay', () => {
    const { editor, spot } = spotAt('One two\n', 3);
    spot.insert(['shot.png']);
    expect(drawn(editor)).toBe(1);
    // Text written after the link, with no selection set: the caret is still at its end.
    editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: '!' } });
    expect(editor.view.state.selection.main.head).toBe('One![](shot.png)'.length);
    expect(drawn(editor)).toBe(0);
  });

  it('draws it still when text is typed after it, which leaves the caret off the link', () => {
    const { editor, spot } = spotAt('One two\n', 3);
    spot.insert(['shot.png']);
    const end = editor.view.state.selection.main.head;
    // As typing does: the text, and the caret after it.
    editor.view.dispatch({
      changes: { from: end, insert: '!' },
      selection: { anchor: end + 1 },
      userEvent: 'input.type',
    });
    expect(drawn(editor)).toBe(1);
  });

  it('does the same while Track Changes is on, which is the person’s own change and breaks no marker rule', () => {
    const { editor, spot } = spotAt('One\n', 4, { tracking: true });
    spot.insert(['shot.png']);
    // After the last line break, the format writes the insertion as it writes typing there.
    const marks = editor.getParsed().marks;
    // One mark, the format's own: nothing but the links is written, no line break and no split.
    expect(marks.map((mark) => mark.kind)).toEqual(['sub']);
    expect(new Set(marks.map((mark) => mark.entry.by))).toEqual(new Set(['ada']));
    expect(editor.getDoc()).toContain('![](shot.png)');
    expect(parse(editor.getDoc()).warnings.map((warning) => warning.code)).toEqual([]);
    expect(drawn(editor)).toBe(1);
  });

  it('writes no line break where the links end a table, which would make a break tag in its cell', () => {
    const { editor, spot } = spotAt('a | b\n- | -\nc | d', 'a | b\n- | -\nc | d'.length);
    spot.insert(['a b.png']);
    expect(editor.getDoc()).toBe('a | b\n- | -\nc | d![](a%20b.png)');
    expect(editor.getDoc()).not.toContain('<br>');
  });

  it.each(['clean', 'simple', 'redlines'] as const)('writes the links in the %s view', (view) => {
    const { editor, spot } = spotAt('One two\n', 3, { view });
    spot.insert(['shot.png']);
    expect(editor.getDoc()).toBe('One![](shot.png) two\n');
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

  it('goes before text typed at it meanwhile, and swallows none of it', () => {
    const { editor, spot } = spotAt('One\n', 3);
    editor.view.dispatch({ changes: { from: 3, insert: 'XYZ' } });
    spot.insert(['a.png']);
    expect(editor.getDoc()).toBe('One![](a.png)XYZ\n');
  });

  /** A spot over the text from `from` to `to` of `doc`, as a paste over a selection gives one. */
  function spotOver(doc: string, from: number, to: number) {
    const made = load(doc);
    made.editor.view.dispatch({ selection: { anchor: from, head: to } });
    pasteFiles(made.editor, [png()]);
    return { ...made, spot: made.given[0]!.spot };
  }

  it('replaces the text it was taken over, with what is typed at its two ends left', () => {
    const { editor, spot } = spotOver('One two three\n', 4, 7);
    editor.view.dispatch({ changes: { from: 4, insert: 'A' } });
    editor.view.dispatch({ changes: { from: 8, insert: 'B' } });
    expect(editor.getDoc()).toBe('One AtwoB three\n');
    spot.insert(['a.png']);
    expect(editor.getDoc()).toBe('One A![](a.png)B three\n');
  });

  it('goes after the text it was taken over when that was changed, and replaces none of it', () => {
    const { editor, spot } = spotOver('One two three\n', 4, 7);
    editor.view.dispatch({ changes: { from: 5, insert: 'X' } });
    spot.insert(['a.png']);
    expect(editor.getDoc()).toBe('One tXwo![](a.png) three\n');
  });

  it('goes after text that was written over what it covers, and replaces none of it', () => {
    const { editor, spot } = spotOver('One two three\n', 4, 7);
    editor.view.dispatch({ changes: { from: 4, to: 7, insert: 'TWO' } });
    spot.insert(['a.png']);
    expect(editor.getDoc()).toBe('One TWO![](a.png) three\n');
  });

  it('goes after text typed where what it covered was taken away', () => {
    const { editor, spot } = spotOver('One two three\n', 4, 7);
    editor.view.dispatch({ changes: { from: 4, to: 8 } });
    editor.view.dispatch({ changes: { from: 4, insert: 'Q' } });
    expect(editor.getDoc()).toBe('One Qthree\n');
    spot.insert(['a.png']);
    expect(editor.getDoc()).toBe('One Q![](a.png)three\n');
  });

  it('goes after text that was taken away from under it', () => {
    const { editor, spot } = spotOver('One two three\n', 4, 7);
    editor.view.dispatch({ changes: { from: 4, to: 8 } });
    expect(editor.getDoc()).toBe('One three\n');
    spot.insert(['a.png']);
    expect(editor.getDoc()).toBe('One ![](a.png)three\n');
  });

  it('leaves the caret where the person put it meanwhile, and only moves one that is at the spot', () => {
    const { editor, spot } = spotAt('One two\n', 3);
    editor.view.dispatch({ selection: { anchor: 7 } });
    spot.insert(['a.png']);
    // At the end of "two", where it was moved to, by the length of what went in before it.
    expect(editor.view.state.selection.main.head).toBe(7 + '![](a.png)'.length);
  });

  it('says so when the document changed before the links could be written', () => {
    const { editor, spot, notices } = spotAt('One\n', 3);
    editor.setDoc('Another document\n');
    expect(spot.insert(['a.png'])).toBe(false);
    expect(notices).toEqual([DOCUMENT_CHANGED]);
    expect(editor.getDoc()).toBe('Another document\n');
    // Said once: the spot is spent.
    spot.insert(['a.png']);
    expect(notices).toEqual([DOCUMENT_CHANGED]);
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
    editor.imageSpot({ x: 400, y: 120 })!.insert(['b.png']);
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

  it('takes an image right after inline code, and right before it, where the caret is outside it', () => {
    const doc = 'Run `npm i` now\n';
    const { editor, notices } = load(doc);
    const open = doc.indexOf('`');
    const close = doc.indexOf('`', open + 1) + 1;
    for (const at of [open, close]) {
      editor.view.dispatch({ selection: { anchor: at } });
      expect(editor.imageSpot(), `at ${at}`).not.toBeNull();
    }
    // At the end of a line that ends in code too.
    const ending = load('Run `npm i`\n');
    ending.editor.view.dispatch({ selection: { anchor: 'Run `npm i`'.length } });
    expect(ending.editor.imageSpot()).not.toBeNull();
    expect(notices).toEqual([]);
    expect(ending.notices).toEqual([]);
  });

  it('refuses an image inside inline code, and at the edges of a code block', () => {
    const { editor, notices } = load('Run `npm i` now\n\n```\ncode\n```\n');
    const doc = editor.getDoc();
    const inside = doc.indexOf('npm') + 1;
    const fence = doc.indexOf('```');
    const afterFence = doc.indexOf('```', fence + 3) + 3;
    for (const at of [inside, fence, afterFence]) {
      editor.view.dispatch({ selection: { anchor: at } });
      expect(editor.imageSpot(), `at ${at}`).toBeNull();
    }
    expect(notices).toEqual([IMAGE_IN_CODE, IMAGE_IN_CODE, IMAGE_IN_CODE]);
  });

  it('refuses an image in front of the first line of indented code, where it would end the block', () => {
    const doc = 'Para\n\n    code line\n';
    const { editor, notices } = load(doc);
    const line = doc.indexOf('    code');
    // The indent is not in the block's node, which begins at the code: columns 0, 2 and 4.
    for (const at of [line, line + 2, line + 4]) {
      editor.view.dispatch({ selection: { anchor: at } });
      expect(editor.imageSpot(), `at ${at}`).toBeNull();
    }
    expect(notices).toEqual([IMAGE_IN_CODE, IMAGE_IN_CODE, IMAGE_IN_CODE]);
    // The paragraph above is no code.
    editor.view.dispatch({ selection: { anchor: 4 } });
    expect(editor.imageSpot()).not.toBeNull();
  });

  it('says so for a spot asked for by the host, which is then none', () => {
    const { editor, notices } = load('One\n', { view: 'raw', tracking: true });
    expect(editor.imageSpot()).toBeNull();
    expect(notices).toEqual([RAW_READ_ONLY]);
  });
});
