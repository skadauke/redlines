// @vitest-environment happy-dom
import { undo } from '../history/index.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';
import { AUTOCORRECTION } from './corrections.ts';
import { editSourceFacet } from './typing.ts';

// WebKit makes a correction (macOS's autocorrection, a text replacement, a smart quote or dash, a
// spelling suggestion picked from the context menu) as a command of its own,
// SpellingCorrectionCommand or a replacement of the selection: a cancelable beforeinput event of
// type insertReplacementText, whose target range is the text it replaces and whose dataTransfer
// holds the new text, and then, unless the event is canceled, a rewrite of the page, which
// CodeMirror reads back. These tests send the event as WebKit does, in the orders it does: after
// the key that ends the word typed its text, which CodeMirror may have read or not yet (it reads
// the page in a microtask); and, with the correction bubble showing, as the key is pressed, before
// its text goes in. Where nobody cancels the event, they rewrite the page as WebKit would.

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const NOW = new Date('2026-11-01T10:00:30Z');
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
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

/** An editor for Ada whose new marks take `ids` in order. */
function load(doc: string, options: Partial<EditorOptions> & { ids?: string[] } = {}): Editor {
  const { ids = ['b2b2', 'c3c3', 'd4d4'], ...rest } = options;
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: ada,
    typing: { spellCheck: true, smartPunctuation: false, closePairs: false },
    ...rest,
    extensions: [editSourceFacet.of({ now: () => NOW, random: randomIds(...ids) })],
  });
  // happy-dom fires `selectionchange` while CodeMirror writes a focused editor's selection, so the
  // editor stays unfocused, as in the other tests: the page's caret is set by hand.
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

/** A document with a ledger that holds Bo's thread `c8d2`. */
function withThread(body: string): string {
  const thread = '  c8d2:\n    by: bo\n    at: 2026-10-31T09:30Z\n    text: |-\n      Why?\n';
  return `${body}\n\n<!-- redlines\nversion: 1\ncomments:\n${thread}-->\n`;
}

/** The document without its ledger. */
function body(editor: Editor): string {
  const { text, ledgerRange } = editor.getParsed();
  return ledgerRange ? text.slice(0, ledgerRange.from).trimEnd() : text;
}

const docText = (editor: Editor) => editor.view.state.doc.toString();
const head = (editor: Editor) => editor.view.state.selection.main.head;
const marks = (editor: Editor) => Object.keys(editor.getParsed().ledger.marks);

/** A key that the browser types, rather than a key binding: its keydown. */
function keyDown(editor: Editor, key: string): void {
  editor.view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

/** The beforeinput event of text that WebKit is about to type into the page. */
function beforeTyping(editor: Editor, text: string): void {
  editor.view.contentDOM.dispatchEvent(
    new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true }),
  );
}

/**
 * Types text as WebKit and CodeMirror do: for each key its keydown and the beforeinput event of its
 * text, and the transaction CodeMirror makes of the text it reads from the page.
 */
function type(editor: Editor, text: string): void {
  for (const char of text) {
    keyDown(editor, char);
    beforeTyping(editor, char);
    editor.view.dispatch(editor.view.state.replaceSelection(char), { userEvent: 'input.type' });
  }
}

/** A place in the page's DOM. */
interface Point {
  node: Text;
  offset: number;
}

/**
 * Where position `pos` of the text is in the page: in a text node of the document's text, the one
 * that ends there (`side` -1) or the one that starts there (1) when `pos` is between two.
 */
function domPoint(editor: Editor, pos: number, side: -1 | 1): Point {
  const { view } = editor;
  const found: { node: Text; start: number }[] = [];
  const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const start = view.posAtDOM(node, 0);
    // Text drawn by a widget, such as deleted text, isn't the document's.
    if (view.posAtDOM(node, node.length) - start !== node.length) continue;
    if (start <= pos && pos <= start + node.length) found.push({ node, start });
  }
  const best =
    found.find(({ node, start }) => (side < 0 ? pos > start : pos < start + node.length)) ??
    found[0];
  if (!best) throw new Error(`No text of the page at ${pos}`);
  return { node: best.node, offset: pos - best.start };
}

/**
 * The place `n` characters into the page's text of line `line` (1-based), as WebKit counts them
 * when it puts the caret back after a correction: deleted text drawn in the line counts too.
 */
function lineOffset(editor: Editor, line: number, n: number): Point {
  const element = editor.view.contentDOM.querySelectorAll('.cm-line')[line - 1]!;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let left = n;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (left <= node.length) return { node, offset: left };
    left -= node.length;
  }
  throw new Error(`Line ${line} has fewer than ${n} characters`);
}

/** Where WebKit has the caret: the page's selection. */
function pageCaret(point: Point): void {
  document.getSelection()!.collapse(point.node, point.offset);
}

/**
 * WebKit moves the caret in the page, and says so with a `selectionchange` event, on which
 * CodeMirror reads the page's selection and makes it the editor's, as a `select` transaction. The
 * editor here has no focus, so CodeMirror wouldn't read it: the test makes the transaction.
 */
function movePageCaret(editor: Editor, point: Point): void {
  pageCaret(point);
  document.dispatchEvent(new Event('selectionchange'));
  const anchor = editor.view.posAtDOM(point.node, point.offset);
  editor.view.dispatch({ selection: { anchor }, scrollIntoView: true, userEvent: 'select' });
}

/**
 * The page says where its caret is, with a `selectionchange` event, and it is where the editor has
 * it: CodeMirror reads no change.
 */
function pageSaysCaret(editor: Editor): void {
  pageCaret(domPoint(editor, head(editor), -1));
  document.dispatchEvent(new Event('selectionchange'));
}

/**
 * Text WebKit types into the page at the caret, after the key's keydown: the beforeinput event of
 * its text, and the text in the page's DOM, which CodeMirror reads a moment later, when the record
 * of the change reaches its MutationObserver.
 */
function typeIntoPage(editor: Editor, text: string): void {
  beforeTyping(editor, text);
  const at = domPoint(editor, head(editor), -1);
  at.node.insertData(at.offset, text);
  pageCaret({ node: at.node, offset: at.offset + text.length });
}

/**
 * WebKit corrects the page's text from `start` to `end` to `text`, as SpellingCorrectionCommand
 * does: a cancelable beforeinput event of type insertReplacementText on the content element, its
 * target range the text it replaces and its dataTransfer the new text (its data is null in an
 * editable element). Unless the event is canceled, WebKit then rewrites the page itself.
 */
function correctPage(editor: Editor, start: Point, end: Point, text: string): InputEvent {
  const dataTransfer = new DataTransfer();
  dataTransfer.setData('text/plain', text);
  const event = new InputEvent('beforeinput', {
    inputType: 'insertReplacementText',
    dataTransfer,
    bubbles: true,
    cancelable: true,
  });
  // A static range, as WebKit gives: it doesn't follow later changes to the page.
  const target = {
    startContainer: start.node,
    startOffset: start.offset,
    endContainer: end.node,
    endOffset: end.offset,
    collapsed: false,
  };
  Object.defineProperties(event, {
    data: { value: null },
    getTargetRanges: { value: () => [target] },
  });
  editor.view.contentDOM.dispatchEvent(event);
  if (!event.defaultPrevented) {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    range.deleteContents();
    start.node.insertData(start.offset, text);
  }
  return event;
}

/** WebKit corrects `from`–`to` of the text to `text`. */
function correct(editor: Editor, from: number, to: number, text: string): InputEvent {
  return correctPage(editor, domPoint(editor, from, 1), domPoint(editor, to, -1), text);
}

/** The word `word` of the text, the last one there is. */
function wordAt(editor: Editor, word: string): [number, number] {
  const at = docText(editor).lastIndexOf(word);
  return [at, at + word.length];
}

/** Lets what the page does after an event happen: its microtasks, and a timer. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a correction in your own typing', () => {
  it('changes the text of your insertion, as one insertion, with the caret after the space', async () => {
    const editor = load('Hello ', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 6 } });
    type(editor, 'teh ');
    expect(body(editor)).toBe('Hello <!--ins b2b2-->teh <!--/b2b2-->');
    const caret = head(editor);
    // WebKit corrects the word after the space, with its caret after the space too.
    pageCaret(domPoint(editor, caret, -1));
    const event = correct(editor, ...wordAt(editor, 'teh'), 'the');
    expect(event.defaultPrevented).toBe(true);
    await settled();
    expect(body(editor)).toBe('Hello <!--ins b2b2-->the <!--/b2b2-->');
    expect(marks(editor)).toEqual(['b2b2']);
    expect(head(editor)).toBe(caret);
    // Typing goes on in the same insertion.
    type(editor, 'end');
    expect(body(editor)).toBe('Hello <!--ins b2b2-->the end<!--/b2b2-->');
  });

  it('is a step of its own, which Undo takes back first', async () => {
    const editor = load('Hello ', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 6 } });
    type(editor, 'teh ');
    correct(editor, ...wordAt(editor, 'teh'), 'the');
    await settled();
    expect(body(editor)).toBe('Hello <!--ins b2b2-->the <!--/b2b2-->');
    expect(undo(editor.view)).toBe(true);
    expect(body(editor)).toBe('Hello <!--ins b2b2-->teh <!--/b2b2-->');
    expect(head(editor)).toBe(docText(editor).indexOf('<!--/b2b2-->'));
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe('Hello ');
  });

  it('waits for the space WebKit typed when CodeMirror has yet to read it', async () => {
    const editor = load('Hello ', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 6 } });
    type(editor, 'teh');
    const word = wordAt(editor, 'teh');
    // WebKit types the space into the page and corrects the word before CodeMirror reads it.
    keyDown(editor, ' ');
    typeIntoPage(editor, ' ');
    correct(editor, ...word, 'the');
    await settled();
    expect(body(editor)).toBe('Hello <!--ins b2b2-->the <!--/b2b2-->');
    expect(head(editor)).toBe(docText(editor).indexOf('<!--/b2b2-->'));
    undo(editor.view);
    expect(body(editor)).toBe('Hello <!--ins b2b2-->teh <!--/b2b2-->');
  });

  it('made as the space is typed, comes after the space, so that Undo keeps the space', async () => {
    // With the correction bubble showing, WebKit corrects the word as the key is pressed, before it
    // types the space.
    const editor = load('Hello ', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 6 } });
    type(editor, 'teh');
    keyDown(editor, ' ');
    pageCaret(domPoint(editor, head(editor), -1));
    correct(editor, ...wordAt(editor, 'teh'), 'the');
    typeIntoPage(editor, ' ');
    await settled();
    expect(body(editor)).toBe('Hello <!--ins b2b2-->the <!--/b2b2-->');
    expect(head(editor)).toBe(docText(editor).indexOf('<!--/b2b2-->'));
    undo(editor.view);
    expect(body(editor)).toBe('Hello <!--ins b2b2-->teh <!--/b2b2-->');
    undo(editor.view);
    expect(editor.getDoc()).toBe('Hello ');
  });

  it('made as a key is pressed that types nothing, is still made', async () => {
    const editor = load('Hello ', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 6 } });
    type(editor, 'teh');
    keyDown(editor, ' ');
    pageCaret(domPoint(editor, head(editor), -1));
    correct(editor, ...wordAt(editor, 'teh'), 'the');
    await settled();
    expect(body(editor)).toBe('Hello <!--ins b2b2-->the<!--/b2b2-->');
  });

  it('takes a text replacement, longer than what it replaces', async () => {
    const editor = load('Hello ', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 6 } });
    type(editor, 'omw ');
    correct(editor, ...wordAt(editor, 'omw'), 'On my way!');
    await settled();
    expect(body(editor)).toBe('Hello <!--ins b2b2-->On my way! <!--/b2b2-->');
    expect(head(editor)).toBe(docText(editor).indexOf('<!--/b2b2-->'));
  });

  it('takes a smart dash made of the hyphen WebKit just typed', async () => {
    const editor = load('Hello ', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 6 } });
    type(editor, 'a-');
    const hyphen = domPoint(editor, docText(editor).indexOf('a-') + 1, 1);
    // The second hyphen is in the page, not yet in the text, when WebKit replaces the two.
    keyDown(editor, '-');
    typeIntoPage(editor, '-');
    correctPage(editor, hyphen, { node: hyphen.node, offset: hyphen.offset + 2 }, '—');
    await settled();
    expect(body(editor)).toBe('Hello <!--ins b2b2-->a—<!--/b2b2-->');
    // What is typed next is a step apart from the dash.
    type(editor, 'b');
    undo(editor.view);
    expect(body(editor)).toBe('Hello <!--ins b2b2-->a—<!--/b2b2-->');
    undo(editor.view);
    expect(body(editor)).toBe('Hello <!--ins b2b2-->a--<!--/b2b2-->');
  });

  it('takes a smart quote made of the quote WebKit just typed, in the middle of your text', async () => {
    const doc = withLedger('We <!--ins b2b2-->say  now<!--/b2b2-->', { b2b2: 'ada' });
    const editor = load(doc, { tracking: true });
    editor.view.dispatch({ selection: { anchor: doc.indexOf('  now') + 1 } });
    // The quote is in the page, not yet in the text, when WebKit replaces it.
    const at = domPoint(editor, head(editor), -1);
    keyDown(editor, '"');
    typeIntoPage(editor, '"');
    correctPage(editor, at, { node: at.node, offset: at.offset + 1 }, '“');
    await settled();
    expect(body(editor)).toBe('We <!--ins b2b2-->say “ now<!--/b2b2-->');
    expect(head(editor)).toBe(docText(editor).indexOf('“') + 1);
  });

  it('is a plain edit with Track Changes off', async () => {
    const editor = load('Hello ');
    editor.view.dispatch({ selection: { anchor: 6 } });
    type(editor, 'teh ');
    correct(editor, ...wordAt(editor, 'teh'), 'the');
    await settled();
    expect(editor.getDoc()).toBe('Hello the ');
    undo(editor.view);
    expect(editor.getDoc()).toBe('Hello teh ');
  });

  it('is a plain edit with Track Changes off inside your insertion too', async () => {
    const doc = withLedger('One <!--ins b2b2-->two words<!--/b2b2--> three.', { b2b2: 'ada' });
    const editor = load(doc, { ids: ['c3c3'] });
    editor.view.dispatch({ selection: { anchor: doc.indexOf('words') } });
    type(editor, 'teh ');
    expect(body(editor)).toBe(
      'One <!--ins b2b2-->two <!--/b2b2-->teh <!--ins c3c3-->words<!--/c3c3--> three.',
    );
    correct(editor, ...wordAt(editor, 'teh'), 'the');
    await settled();
    expect(body(editor)).toBe(
      'One <!--ins b2b2-->two <!--/b2b2-->the <!--ins c3c3-->words<!--/c3c3--> three.',
    );
  });
});

describe('a correction that reaches into other text', () => {
  it('makes a tracked change of that part only, and keeps the caret after the space', async () => {
    const editor = load('Hello te', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 8 } });
    type(editor, 'h ');
    expect(body(editor)).toBe('Hello te<!--ins b2b2-->h <!--/b2b2-->');
    const caret = head(editor);
    pageCaret(domPoint(editor, caret, -1));
    // The word reaches across the hidden opener of your insertion.
    correct(editor, docText(editor).indexOf('te<!--'), docText(editor).indexOf('h ') + 1, 'the');
    await settled();
    // The "e" that was there is deleted, and the rest is your insertion.
    expect(body(editor)).toBe('Hello t<!--del c3c3 e--><!--ins b2b2-->he <!--/b2b2-->');
    const after = docText(editor).indexOf('<!--/b2b2-->');
    expect(head(editor)).toBe(after);
    // WebKit puts its caret back by counting the characters of the line, which now shows the
    // deleted "e" too: one short of the space. The caret stays where it was.
    movePageCaret(editor, lineOffset(editor, 1, 'Hello teh '.length));
    expect(head(editor)).toBe(after - 1);
    await settled();
    expect(head(editor)).toBe(after);
    undo(editor.view);
    expect(body(editor)).toBe('Hello te<!--ins b2b2-->h <!--/b2b2-->');
  });

  it('corrects a word you picked a suggestion for, as a tracked replacement', async () => {
    const editor = load('Thsi is it.', { tracking: true });
    // The context menu selects the word, and WebKit replaces the selection.
    editor.view.dispatch({ selection: { anchor: 0, head: 4 } });
    correct(editor, 0, 4, 'This');
    await settled();
    expect(body(editor)).toBe('Th<!--sub b2b2 si-->is<!--/b2b2--> is it.');
    expect(head(editor)).toBe(docText(editor).indexOf('<!--/b2b2-->'));
    undo(editor.view);
    expect(editor.getDoc()).toBe('Thsi is it.');
  });

  it('takes a correction made away from typing for one picked, as without the word selected', async () => {
    // Chromium replaces the word under the context menu without selecting it.
    const editor = load('```\nteh\n```\n');
    editor.view.dispatch({ selection: { anchor: 5 } });
    correct(editor, 4, 7, 'the');
    await settled();
    expect(editor.getDoc()).toBe('```\nthe\n```\n');
  });

  it('takes a correction of the selected word for one picked, a moment after a key', async () => {
    // In code, where WebKit's own corrections are left out, one you pick is made.
    const editor = load('```\nx\n```\n');
    editor.view.dispatch({ selection: { anchor: 4 } });
    type(editor, 'teh ');
    // Within a second of the key, the context menu selects the word, and WebKit replaces it.
    editor.view.dispatch({ selection: { anchor: 4, head: 7 } });
    correct(editor, 4, 7, 'the');
    await settled();
    expect(editor.getDoc()).toBe('```\nthe x\n```\n');
    expect(head(editor)).toBe(7);
  });

  it("corrects another person's inserted word as a tracked change inside the insertion", async () => {
    const doc = withLedger('One <!--ins b2b2-->teh<!--/b2b2--> three.', { b2b2: 'bo' });
    const editor = load(doc, { tracking: true });
    editor.view.dispatch({ selection: { anchor: doc.indexOf('<!--/b2b2-->') } });
    // Your space goes after Bo's insertion (format §3.6).
    type(editor, ' ');
    expect(body(editor)).toBe(
      'One <!--ins b2b2-->teh<!--/b2b2--><!--ins c3c3--> <!--/c3c3--> three.',
    );
    pageCaret(domPoint(editor, head(editor), -1));
    correct(editor, ...wordAt(editor, 'teh'), 'the');
    await settled();
    // Replacing text in someone else's insertion is a substitution inside it (format §3.6).
    expect(body(editor)).toBe(
      'One <!--ins b2b2-->t<!--sub d4d4 eh-->he<!--/d4d4--><!--/b2b2--><!--ins c3c3--> <!--/c3c3-->' +
        ' three.',
    );
  });

  it('corrects a picked word with Track Changes off, in code too', async () => {
    const editor = load('```\nteh\n```\n');
    editor.view.dispatch({ selection: { anchor: 4, head: 7 } });
    correct(editor, 4, 7, 'the');
    await settled();
    expect(editor.getDoc()).toBe('```\nthe\n```\n');
  });
});

describe('the caret a correction leaves', () => {
  /** A correction that reaches into original text, as WebKit makes it after the space. */
  async function reachingIn(): Promise<Editor> {
    const editor = load('Hello te', { tracking: true });
    editor.view.dispatch({ selection: { anchor: 8 } });
    type(editor, 'h ');
    pageCaret(domPoint(editor, head(editor), -1));
    correct(editor, docText(editor).indexOf('te<!--'), docText(editor).indexOf('h ') + 1, 'the');
    await settled();
    return editor;
  }

  /** Where WebKit puts its caret back: it counts the deleted "e" the line shows, one short. */
  const miscounted = (editor: Editor) => lineOffset(editor, 1, 'Hello teh '.length);

  it('stays however late the page says where WebKit put its caret', async () => {
    const editor = await reachingIn();
    const after = head(editor);
    // The page is busy for more than a second before the selectionchange task runs.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    movePageCaret(editor, miscounted(editor));
    await settled();
    expect(head(editor)).toBe(after);
    type(editor, 'x');
    expect(body(editor)).toBe('Hello t<!--del c3c3 e--><!--ins b2b2-->he x<!--/b2b2-->');
  });

  it('is let go once the page has said where its caret is', async () => {
    const editor = await reachingIn();
    // WebKit's caret is where the correction left it, and the page says so.
    pageSaysCaret(editor);
    await settled();
    // A move of the caret the page makes later, as VoiceOver's, stays.
    movePageCaret(editor, domPoint(editor, 2, 1));
    await settled();
    expect(head(editor)).toBe(2);
  });

  it('is let go on a key, a click or an edit', async () => {
    const ends: ((editor: Editor) => void)[] = [
      (editor) => keyDown(editor, 'Shift'),
      (editor) =>
        editor.view.contentDOM.dispatchEvent(
          new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }),
        ),
      (editor) => editor.reloadDoc(`${editor.getDoc()}\nMore.\n`),
    ];
    for (const end of ends) {
      const editor = await reachingIn();
      end(editor);
      movePageCaret(editor, domPoint(editor, 2, 1));
      await settled();
      expect(head(editor)).toBe(2);
    }
  });

  it('is let go after a while when the page never says where its caret is', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const editor = load('Hello te', { tracking: true });
      editor.view.dispatch({ selection: { anchor: 8 } });
      type(editor, 'h ');
      pageCaret(domPoint(editor, head(editor), -1));
      correct(editor, docText(editor).indexOf('te<!--'), docText(editor).indexOf('h ') + 1, 'the');
      await vi.advanceTimersByTimeAsync(0);
      expect(body(editor)).toBe('Hello t<!--del c3c3 e--><!--ins b2b2-->he <!--/b2b2-->');
      await vi.advanceTimersByTimeAsync(10_000);
      movePageCaret(editor, domPoint(editor, 2, 1));
      await vi.advanceTimersByTimeAsync(0);
      expect(head(editor)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a correction next to hidden markers', () => {
  /** Puts the caret at the end of the body, and types a space there. */
  function spaceAtEnd(editor: Editor): void {
    editor.view.dispatch({ selection: { anchor: docText(editor).indexOf('\n\n<!-- redlines') } });
    type(editor, ' ');
    pageCaret(domPoint(editor, head(editor), -1));
  }

  const commented = withThread('Hello <!--cmt c8d2-->teh<!--/c8d2-->');

  it('stays inside the range of a comment the word ends', async () => {
    const editor = load(commented, { tracking: true });
    // The space typed at the end of the range is in it (format §4).
    spaceAtEnd(editor);
    expect(body(editor)).toBe('Hello <!--cmt c8d2-->teh<!--ins b2b2--> <!--/b2b2--><!--/c8d2-->');
    correct(editor, ...wordAt(editor, 'teh'), 'the');
    await settled();
    expect(body(editor)).toBe(
      'Hello <!--cmt c8d2-->t<!--sub c3c3 eh-->he<!--/c3c3--><!--ins b2b2--> <!--/b2b2--><!--/c8d2-->',
    );
  });

  it('keeps the markers of the range with Track Changes off', async () => {
    const editor = load(commented);
    spaceAtEnd(editor);
    correct(editor, ...wordAt(editor, 'teh'), 'the');
    await settled();
    expect(body(editor)).toBe('Hello <!--cmt c8d2-->the <!--/c8d2-->');
  });

  it('makes tracked changes on both sides of a marker inside the word, and not of it', async () => {
    const doc = withThread('Hello te<!--cmt c8d2-->h<!--/c8d2-->');
    const editor = load(doc, { tracking: true });
    spaceAtEnd(editor);
    correctPage(
      editor,
      domPoint(editor, doc.indexOf('te<!--'), 1),
      domPoint(editor, doc.indexOf('h<!--/') + 1, -1),
      'the',
    );
    await settled();
    // The "e" before the comment's opener is deleted, and the "h" after it replaced: one change on
    // each side, the range as it was.
    expect(body(editor)).toBe(
      'Hello t<!--del d4d4 e--><!--cmt c8d2--><!--sub c3c3 h-->he<!--/c3c3--><!--ins b2b2--> ' +
        '<!--/b2b2--><!--/c8d2-->',
    );
  });

  it('corrects the text on both sides of a marker inside the word, and not the marker', async () => {
    const doc = withThread('Hello te<!--cmt c8d2-->h<!--/c8d2-->');
    const editor = load(doc);
    spaceAtEnd(editor);
    correctPage(
      editor,
      domPoint(editor, doc.indexOf('te<!--'), 1),
      domPoint(editor, doc.indexOf('h<!--/') + 1, -1),
      'the',
    );
    await settled();
    expect(body(editor)).toBe('Hello t<!--cmt c8d2-->he <!--/c8d2-->');
  });

  it('leaves out a correction of a word with deleted text in it, and says nothing', async () => {
    const doc = withLedger('Hello te<!--del c3c3 x-->h', { c3c3: 'bo' });
    const notices: string[] = [];
    const editor = load(doc, { onNotice: (message) => notices.push(message) });
    spaceAtEnd(editor);
    const typed = editor.getDoc();
    // The page shows the deleted "x" in the word.
    const event = correctPage(
      editor,
      domPoint(editor, doc.indexOf('te<!--'), 1),
      domPoint(editor, doc.indexOf('h\n'), 1),
      'the',
    );
    await settled();
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getDoc()).toBe(typed);
    expect(notices).toEqual([]);
  });
});

describe('where nothing is corrected', () => {
  it('leaves code, URLs and front matter as typed', async () => {
    const docs = [
      ['```\nx\n```\n', 4, 'teh '],
      ['Some `x` code\n', 6, 'teh '],
      ['See https://example.com/x for more\n', 'See https://example.com/'.length, 'teh '],
      ['---\ntitle: x\n---\n\nBody\n', 'title: '.length + 4, 'teh '],
    ] as const;
    for (const [doc, at, typed] of docs) {
      const editor = load(doc);
      editor.view.dispatch({ selection: { anchor: at } });
      type(editor, typed);
      const before = editor.getDoc();
      const event = correct(editor, ...wordAt(editor, 'teh'), 'the');
      await settled();
      // WebKit doesn't rewrite the page either.
      expect(event.defaultPrevented).toBe(true);
      expect(editor.getDoc()).toBe(before);
    }
  });

  it('says nothing when a correction in code with Track Changes on is left out', async () => {
    const notices: string[] = [];
    const editor = load('```\nteh x\n```\n', {
      tracking: true,
      onNotice: (message) => notices.push(message),
    });
    editor.view.dispatch({ selection: { anchor: 8 } });
    // A key WebKit corrects the word on.
    keyDown(editor, ' ');
    correct(editor, 4, 7, 'the');
    await settled();
    expect(editor.getDoc()).toBe('```\nteh x\n```\n');
    expect(notices).toEqual([]);
  });

  it("says why a suggestion you pick can't be made, as typing would", async () => {
    const notices: string[] = [];
    const editor = load('```\nteh x\n```\n', {
      tracking: true,
      onNotice: (message) => notices.push(message),
    });
    editor.view.dispatch({ selection: { anchor: 4, head: 7 } });
    correct(editor, 4, 7, 'the');
    await settled();
    expect(editor.getDoc()).toBe('```\nteh x\n```\n');
    expect(notices).toEqual([expect.stringContaining("can't go inside code")]);
  });

  it("leaves out unsaid a correction of the Mac's that Track Changes can't make", () => {
    const notices: string[] = [];
    const editor = load('```\nteh x\n```\n', {
      tracking: true,
      onNotice: (message) => notices.push(message),
    });
    editor.view.dispatch({ changes: { from: 5, to: 7, insert: 'he' }, userEvent: AUTOCORRECTION });
    expect(editor.getDoc()).toBe('```\nteh x\n```\n');
    expect(notices).toEqual([]);
  });

  it('leaves Raw as typed', async () => {
    const editor = load('Hello ', { view: 'raw' });
    editor.view.dispatch({ selection: { anchor: 6 } });
    type(editor, 'teh ');
    correct(editor, ...wordAt(editor, 'teh'), 'the');
    await settled();
    expect(editor.getDoc()).toBe('Hello teh ');
  });
});
