// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redo, selectAll, undo } from '@codemirror/commands';
import { Annotation, Transaction } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { EditError, newestView, originalView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions, type EditorUiState } from '../index.ts';
import { list, visibleText } from './test-helpers.ts';
import { editSourceFacet, RAW_READ_ONLY } from './typing.ts';

// A path rather than a URL: under happy-dom, `URL` is the DOM's class, which node:fs rejects.
const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../format/src/fixtures/launch-plan.md'),
  'utf8',
);

const ada = { handle: 'ada', name: 'Ada Lovelace' };
/** The time of every tracked edit in these tests, and how the ledger writes it. */
const NOW = new Date('2026-11-01T10:00:30Z');
const AT = '2026-11-01T10:00Z';
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';

/** Random bytes that spell out the given ids, one after the other, for new marks. */
function randomIds(...ids: string[]): (n: number) => Uint8Array {
  const bytes = ids.flatMap((id) => [...id].map((c, i) => (i === 0 ? FIRST : REST).indexOf(c)));
  let at = 0;
  return (n) => {
    if (at + n > bytes.length) throw new Error('The test ran out of random ids');
    const chunk = Uint8Array.from(bytes.slice(at, at + n));
    at += n;
    return chunk;
  };
}

/** An editor for Ada with Track Changes on, whose new marks take `ids` in order. */
function load(doc: string, options: Partial<EditorOptions> & { ids?: string[] } = {}): Editor {
  const { ids = [], extensions = [], ...rest } = options;
  const parent = document.createElement('div');
  document.body.append(parent);
  const source = editSourceFacet.of({ now: () => NOW, random: randomIds(...ids) });
  const editor = createEditor(parent, {
    doc,
    author: ada,
    tracking: true,
    ...rest,
    extensions: [source, ...extensions],
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

/** The document without its ledger. */
function body(editor: Editor): string {
  const { text, ledgerRange } = editor.getParsed();
  return ledgerRange ? text.slice(0, ledgerRange.from) : text;
}

const docText = (editor: Editor) => editor.view.state.doc.toString();
const head = (editor: Editor) => editor.view.state.selection.main.head;

function caret(editor: Editor, at: number): void {
  editor.view.dispatch({ selection: { anchor: at }, userEvent: 'select' });
}

/** Types text over the selection, as the keyboard does. */
function type(editor: Editor, text: string): void {
  editor.view.dispatch(editor.view.state.replaceSelection(text), { userEvent: 'input.type' });
}

const mac = /Mac/.test(navigator.platform);

/** Presses a key through the editor's keymaps. `Mod` is Cmd on a Mac and Ctrl elsewhere. */
function press(editor: Editor, key: string): boolean {
  const parts = key.split('-');
  const name = parts.pop()!;
  const has = (modifier: string) => parts.includes(modifier);
  const event = new KeyboardEvent('keydown', {
    key: name,
    shiftKey: has('Shift'),
    altKey: has('Alt'),
    ctrlKey: has('Ctrl') || (has('Mod') && !mac),
    metaKey: has('Mod') && mac,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(editor.view, event, 'editor');
}

describe('tracked typing', () => {
  it('typing at the end of own insertion extends it', () => {
    const doc = withLedger('One <!--ins b2b2-->two<!--/b2b2--> three.', { b2b2: 'ada' });
    const editor = load(doc);
    // After "two", inside the insertion.
    caret(editor, doc.indexOf('<!--/b2b2-->'));
    type(editor, 's');
    expect(body(editor)).toBe('One <!--ins b2b2-->twos<!--/b2b2--> three.');
    // The caret stays in the insertion, so typing on extends it.
    type(editor, '!');
    expect(body(editor)).toBe('One <!--ins b2b2-->twos!<!--/b2b2--> three.');
    // Right after the closer, the same spot to the eye.
    caret(editor, docText(editor).indexOf(' three'));
    type(editor, '?');
    expect(body(editor)).toBe('One <!--ins b2b2-->twos!?<!--/b2b2--> three.');
    expect(Object.keys(editor.getParsed().ledger.marks)).toEqual(['b2b2']);
  });

  it("typing inside another's insertion splits it", () => {
    const doc = withLedger('One <!--ins b2b2-->two words<!--/b2b2--> here.', { b2b2: 'bo' });
    const editor = load(doc, { ids: ['q4gt'] });
    caret(editor, doc.indexOf(' words'));
    type(editor, 'x');
    expect(body(editor)).toBe(
      'One <!--ins b2b2-->two<!--/b2b2--><!--ins q4gt-->x<!--/q4gt--><!--ins b2b2--> words' +
        '<!--/b2b2--> here.',
    );
    const { ledger } = editor.getParsed();
    expect(ledger.marks['q4gt']).toEqual({ by: 'ada', at: AT });
    expect(ledger.people).toEqual([ada]);
    // The caret is in the new insertion, so typing on extends it.
    type(editor, 'y');
    expect(body(editor)).toContain('<!--ins q4gt-->xy<!--/q4gt--><!--ins b2b2-->');
  });

  it('Backspace at a hidden marker deletes the visible character before it, not the marker', () => {
    const doc = withLedger('One <!--ins b2b2-->two<!--/b2b2--> three.', { b2b2: 'bo' });
    const editor = load(doc, { ids: ['q4gt'] });
    // Right after the opener: between "One " and "two" to the eye.
    caret(editor, doc.indexOf('two'));
    expect(press(editor, 'Backspace')).toBe(true);
    expect(body(editor)).toBe('One<!--del q4gt  --><!--ins b2b2-->two<!--/b2b2--> three.');
    // The caret is before the deleted space, so Backspace goes on to the left.
    expect(head(editor)).toBe(3);
    press(editor, 'Backspace');
    expect(body(editor)).toBe('On<!--del q4gt e --><!--ins b2b2-->two<!--/b2b2--> three.');
  });

  it('Delete at a hidden marker deletes the visible character after it, not the marker', () => {
    const doc = withLedger('One <!--ins b2b2-->two<!--/b2b2--> three.', { b2b2: 'bo' });
    const editor = load(doc, { ids: ['q4gt'] });
    // Before the closer: right after "two".
    caret(editor, doc.indexOf('<!--/b2b2-->'));
    press(editor, 'Delete');
    expect(body(editor)).toBe('One <!--ins b2b2-->two<!--/b2b2--><!--del q4gt  -->three.');
    // The caret is after the deleted space, so Delete goes on to the right.
    expect(head(editor)).toBe(docText(editor).indexOf('three'));
    press(editor, 'Delete');
    expect(body(editor)).toBe('One <!--ins b2b2-->two<!--/b2b2--><!--del q4gt  t-->hree.');
  });

  it('deleting plain text makes a del', () => {
    const editor = load('One two three.\n', { ids: ['q4gt', 'r5tw'] });
    caret(editor, 'One two'.length);
    press(editor, 'Backspace');
    press(editor, 'Backspace');
    press(editor, 'Backspace');
    expect(body(editor)).toBe('One <!--del q4gt two--> three.');
    expect(head(editor)).toBe('One '.length);
    expect(editor.getParsed().ledger.marks['q4gt']).toEqual({ by: 'ada', at: AT });

    // Deleting the text of your own insertion removes it, and its ledger entry.
    type(editor, 'new');
    expect(body(editor)).toBe('One <!--ins r5tw-->new<!--/r5tw--><!--del q4gt two--> three.');
    for (let i = 0; i < 3; i++) press(editor, 'Backspace');
    expect(body(editor)).toBe('One <!--del q4gt two--> three.');
    expect(Object.keys(editor.getParsed().ledger.marks)).toEqual(['q4gt']);
  });

  it('replacing selected text makes a sub', () => {
    const editor = load('One two three.\n', { ids: ['q4gt'] });
    editor.view.dispatch({ selection: { anchor: 4, head: 7 } });
    type(editor, '2');
    expect(body(editor)).toBe('One <!--sub q4gt two-->2<!--/q4gt--> three.');
    // The caret follows the new text.
    type(editor, '!');
    expect(body(editor)).toBe('One <!--sub q4gt two-->2!<!--/q4gt--> three.');
  });

  it('undo restores the exact previous doc', () => {
    // No ledger before the first tracked edit, and CRLF line endings.
    const file = 'One two three.\r\n\r\nFour five.\r\n';
    const editor = load(file, { ids: ['q4gt', 'r5tw'] });
    caret(editor, 'One two'.length);
    type(editor, 'x');
    expect(editor.getDoc()).toContain('<!--ins q4gt-->x<!--/q4gt-->');
    expect(editor.getDoc()).toContain('\r\n<!-- redlines\r\n');
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe(file);

    caret(editor, 'One two'.length);
    press(editor, 'Backspace');
    expect(body(editor)).toContain('<!--del r5tw o-->');
    expect(press(editor, 'Mod-z')).toBe(true);
    expect(editor.getDoc()).toBe(file);
  });

  it('redoes a tracked edit exactly', () => {
    const doc = 'One two three.\n';
    const editor = load(doc, { ids: ['q4gt'] });
    caret(editor, 'One two'.length);
    type(editor, 'x');
    const tracked = editor.getDoc();
    undo(editor.view);
    expect(editor.getDoc()).toBe(doc);
    expect(redo(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe(tracked);
  });

  it('keeps the annotations of the edit it tracks', () => {
    const seen: (string | undefined)[] = [];
    const mine = Annotation.define<string>();
    const editor = load('One two three.\n', {
      ids: ['q4gt'],
      extensions: [
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) if (tr.docChanged) seen.push(tr.annotation(mine));
        }),
      ],
    });
    caret(editor, 'One two'.length);
    editor.view.dispatch(editor.view.state.replaceSelection('x'), {
      userEvent: 'input.type',
      annotations: [mine.of('from an extension'), Transaction.addToHistory.of(false)],
    });
    expect(body(editor)).toBe('One two<!--ins q4gt-->x<!--/q4gt--> three.');
    expect(seen).toEqual(['from an extension']);
    // Not added to the history, as the edit asked.
    expect(undo(editor.view)).toBe(false);
  });

  it('undoes a word typed as one insertion with its ledger entry', () => {
    const doc = withLedger('One <!--ins b2b2-->two<!--/b2b2--> three.', { b2b2: 'bo' });
    const editor = load(doc, { ids: ['q4gt'] });
    caret(editor, doc.indexOf(' three'));
    for (const char of ' four') type(editor, char);
    expect(body(editor)).toBe(
      'One <!--ins b2b2-->two<!--/b2b2--><!--ins q4gt--> four<!--/q4gt--> three.',
    );
    undo(editor.view);
    expect(editor.getDoc()).toBe(doc);
  });

  it('a tracked edit in Clean switches to Redlines', () => {
    const reports: EditorUiState[] = [];
    const editor = load(fixture, {
      view: 'clean',
      ids: ['q4gt'],
      onUiState: (ui) => reports.push(ui),
    });
    expect(editor.getUiState().view).toBe('clean');
    caret(editor, fixture.indexOf(' in <!--sub'));
    type(editor, 'x');
    expect(editor.getUiState().view).toBe('redlines');
    expect(reports.at(-1)).toMatchObject({ view: 'redlines', tracking: true });
  });

  it('accept removes the markers', () => {
    const reports: EditorUiState[] = [];
    const editor = load(fixture, { onUiState: (ui) => reports.push(ui) });
    editor.accept('k3x9');
    expect(editor.getDoc()).not.toContain('k3x9');
    expect(editor.getDoc()).toContain('We will ship the new importer in <!--sub p7qd March-->');
    expect(reports.at(-1)?.changes.map((mark) => mark.id)).toEqual(['p7qd', 'w2rf']);

    editor.reject('p7qd');
    expect(body(editor)).toContain('the new importer in March, after');
    expect(editor.getParsed().ledger.marks['p7qd']).toBeUndefined();

    // Each decision is one step to undo.
    undo(editor.view);
    expect(body(editor)).toContain('<!--sub p7qd March-->April<!--/p7qd-->');
    undo(editor.view);
    expect(editor.getDoc()).toBe(fixture);
  });

  it('keeps a decision apart from the typing after it in the undo history', () => {
    const editor = load(fixture, { tracking: false });
    // Right after the closer, so that the typing touches what the decision changed.
    caret(editor, fixture.indexOf('importer'));
    editor.accept('k3x9');
    const accepted = editor.getDoc();
    type(editor, 'x');
    undo(editor.view);
    expect(editor.getDoc()).toBe(accepted);
  });

  it('accept and reject throw for a change they cannot decide', () => {
    const editor = load(fixture);
    expect(() => editor.accept('zzzz')).toThrow(EditError);
    expect(() => editor.reject('c8d2')).toThrow(EditError);
    expect(editor.getDoc()).toBe(fixture);
  });

  it('with tracking off, typing is a plain edit', () => {
    const editor = load(fixture, { tracking: false });
    const at = fixture.indexOf(' in <!--sub');
    caret(editor, at);
    type(editor, 'x');
    expect(editor.getDoc()).toBe(fixture.slice(0, at) + 'x' + fixture.slice(at));
    expect(editor.getUiState()).toMatchObject({ tracking: false, view: 'redlines' });

    editor.setTracking(true);
    expect(editor.getUiState().tracking).toBe(true);
    editor.setTracking(false);
    type(editor, 'y');
    expect(editor.getDoc()).toBe(fixture.slice(0, at) + 'xy' + fixture.slice(at));
  });

  it('with tracking off, Backspace and Delete next to hidden markers keep them', () => {
    const doc = withLedger('One <!--ins b2b2-->two<!--/b2b2--> three.', { b2b2: 'bo' });
    const editor = load(doc, { tracking: false });
    caret(editor, doc.indexOf('two'));
    press(editor, 'Backspace');
    expect(body(editor)).toBe('One<!--ins b2b2-->two<!--/b2b2--> three.');
    caret(editor, docText(editor).indexOf('<!--/b2b2-->'));
    press(editor, 'Delete');
    expect(body(editor)).toBe('One<!--ins b2b2-->two<!--/b2b2-->three.');

    // A selection across a marker loses its text, and the marker stays.
    const text = docText(editor);
    editor.view.dispatch({ selection: { anchor: text.indexOf('wo'), head: text.indexOf('hree') } });
    press(editor, 'Backspace');
    expect(body(editor)).toBe('One<!--ins b2b2-->t<!--/b2b2-->hree.');
  });

  it('with tracking off, the caret never rests inside hidden markers after an edit', () => {
    const doc = withLedger(
      'One <!--ins b2b2-->two<!--/b2b2--> <!--ins c3c3-->three<!--/c3c3--> four.',
      { b2b2: 'bo', c3c3: 'bo' },
    );
    const editor = load(doc, { tracking: false });
    caret(editor, doc.indexOf('<!--ins c3c3-->'));
    press(editor, 'Backspace');
    expect(body(editor)).toBe(
      'One <!--ins b2b2-->two<!--/b2b2--><!--ins c3c3-->three<!--/c3c3--> four.',
    );
    // The closer and the opener now touch: the caret is at an end of the run, not inside it.
    expect(head(editor)).toBe(body(editor).indexOf('<!--/b2b2-->'));
  });

  it('with tracking on, a reload from disk and changes made by code are not tracked', () => {
    const editor = load('One two three.\n');
    editor.reloadDoc('One two three.\n\nFour.\n');
    expect(editor.getDoc()).toBe('One two three.\n\nFour.\n');
    editor.view.dispatch({ changes: { from: 0, insert: 'Zero. ' } });
    expect(editor.getDoc()).toBe('Zero. One two three.\n\nFour.\n');
  });

  it('refuses a tracked edit inside code, and says why', () => {
    const notices: string[] = [];
    const doc = 'Run `make all` now.\n';
    const editor = load(doc, { ids: ['q4gt'], onNotice: (message) => notices.push(message) });
    caret(editor, doc.indexOf('all'));
    type(editor, 'x');
    expect(editor.getDoc()).toBe(doc);
    expect(notices).toEqual([expect.stringContaining('code')]);
  });

  it('pastes as an insertion', () => {
    const editor = load('One two.\n', { ids: ['q4gt'] });
    caret(editor, 'One'.length);
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', ' and a half');
    editor.view.contentDOM.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    );
    expect(body(editor)).toBe('One<!--ins q4gt--> and a half<!--/q4gt--> two.');
  });

  it('tracks a line break as a change to review, and undoes it exactly', () => {
    const doc = 'One two three.\n';
    const editor = load(doc, { ids: ['q4gt'] });
    caret(editor, 'One tw'.length);
    expect(press(editor, 'Enter')).toBe(true);
    expect(newestView(editor.getDoc()).text).toBe('One tw\no three.\n');
    expect(Object.values(editor.getParsed().ledger.marks)).toEqual([{ by: 'ada', at: AT }]);
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', hasRedlines: true });
    expect(editor.getUiState().changes.map((mark) => mark.kind)).toEqual(['split']);
    undo(editor.view);
    expect(editor.getDoc()).toBe(doc);
  });

  it('puts the caret after text typed at the start of a paragraph', () => {
    // The opener goes on a line of its own above the paragraph (format §3.3).
    const editor = load('One.\n\nTwo three.\n', { ids: ['q4gt'] });
    caret(editor, 'One.\n\n'.length);
    type(editor, 'A');
    expect(body(editor)).toBe('One.\n\n<!--ins q4gt-->\n\nA<!--/q4gt-->Two three.');
    expect(head(editor)).toBe(docText(editor).indexOf('<!--/q4gt-->'));
    type(editor, 'n');
    expect(body(editor)).toBe('One.\n\n<!--ins q4gt-->\n\nAn<!--/q4gt-->Two three.');
  });

  it('makes Raw read-only while Track Changes is on', () => {
    const editor = load(fixture, { view: 'raw' });
    expect(editor.view.state.readOnly).toBe(true);
    caret(editor, fixture.indexOf('new '));
    press(editor, 'Backspace');
    expect(editor.getDoc()).toBe(fixture);

    // With tracking off, Raw edits the source as written.
    editor.setTracking(false);
    expect(editor.view.state.readOnly).toBe(false);
    press(editor, 'Backspace');
    expect(editor.getDoc()).toBe(fixture.replace('k3x9-->new', 'k3x9--new'));
  });

  it('says why Raw takes no edits while Track Changes is on', () => {
    const notices: string[] = [];
    const doc = '- one\n- two\n';
    const editor = load(doc, { view: 'raw', onNotice: (message) => notices.push(message) });
    const said = () => notices.splice(0);
    const dispatch = (event: Event) => editor.view.contentDOM.dispatchEvent(event);
    caret(editor, '- one'.length);
    // A letter typed, which the page would put in and the editor takes back.
    dispatch(new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true }));
    expect(said()).toEqual([RAW_READ_ONLY]);
    // Markdown's Enter and Backspace in a list item, which don't look at the read-only setting.
    press(editor, 'Enter');
    expect(said()).toEqual([RAW_READ_ONLY]);
    caret(editor, '- one\n- '.length);
    press(editor, 'Backspace');
    expect(said()).toEqual([RAW_READ_ONLY]);
    // A paste, a cut, and Undo.
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'pasted');
    dispatch(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    expect(said()).toEqual([RAW_READ_ONLY]);
    press(editor, 'Mod-z');
    expect(said()).toEqual([RAW_READ_ONLY]);
    expect(editor.getDoc()).toBe(doc);

    // With tracking off, Raw takes edits, and says nothing.
    editor.setTracking(false);
    press(editor, 'Backspace');
    expect(editor.getDoc()).not.toBe(doc);
    expect(said()).toEqual([]);
  });
});

describe('typing at the edges of a comment (format §4)', () => {
  const doc = [
    'A <!--cmt c3c3-->note<!--/c3c3--> here.',
    '',
    '<!-- redlines',
    'version: 1',
    'comments:',
    '  c3c3:',
    '    by: bo',
    '    at: 2026-10-31T09:30Z',
    '    text: |-',
    '      Why?',
    '-->',
    '',
  ].join('\n');
  const opener = doc.indexOf('<!--cmt');
  const closer = doc.indexOf('<!--/c3c3-->');

  it.each([
    ['in front of its opener', opener],
    ['after its opener', opener + '<!--cmt c3c3-->'.length],
  ])('does not extend the range at its start, with the caret %s', (_, at) => {
    const tracked = load(doc, { ids: ['q4gt'] });
    caret(tracked, at);
    type(tracked, 'X');
    expect(body(tracked)).toBe(
      'A <!--ins q4gt-->X<!--/q4gt--><!--cmt c3c3-->note<!--/c3c3--> here.',
    );
    const plain = load(doc, { tracking: false });
    caret(plain, at);
    type(plain, 'X');
    expect(body(plain)).toBe('A X<!--cmt c3c3-->note<!--/c3c3--> here.');
  });

  it.each([
    ['in front of its closer', closer],
    ['after its closer', closer + '<!--/c3c3-->'.length],
  ])('extends the range at its end, with the caret %s', (_, at) => {
    const tracked = load(doc, { ids: ['q4gt'] });
    caret(tracked, at);
    type(tracked, 's');
    expect(body(tracked)).toBe(
      'A <!--cmt c3c3-->note<!--ins q4gt-->s<!--/q4gt--><!--/c3c3--> here.',
    );
    const plain = load(doc, { tracking: false });
    caret(plain, at);
    type(plain, 's');
    expect(body(plain)).toBe('A <!--cmt c3c3-->notes<!--/c3c3--> here.');
  });
});

describe('editing with Track Changes off (format §3.10)', () => {
  const doc = withLedger('One <!--ins b2b2-->two<!--/b2b2--> three.', { b2b2: 'bo' });
  /** The time these tests' ledgers give each mark. */
  const OLD = '2026-10-31T09:30Z';

  it('types after an insertion, where the caret rests at its end, and not into it', () => {
    const editor = load(doc, { tracking: false });
    // After "two" the caret is in front of the hidden closer, where the plain edit used to go.
    caret(editor, doc.indexOf('<!--/b2b2-->'));
    type(editor, 's');
    expect(body(editor)).toBe('One <!--ins b2b2-->two<!--/b2b2-->s three.');
    // The caret is right after the typed text, so typing goes on there.
    type(editor, '!');
    expect(body(editor)).toBe('One <!--ins b2b2-->two<!--/b2b2-->s! three.');
    press(editor, 'Mod-z');
    expect(editor.getDoc()).toBe(doc);
  });

  it('types before an insertion at its start', () => {
    const editor = load(doc, { tracking: false });
    caret(editor, doc.indexOf('two'));
    type(editor, 'X');
    expect(body(editor)).toBe('One X<!--ins b2b2-->two<!--/b2b2--> three.');
  });

  it('splits an insertion around text typed in its middle, and Undo gives back the bytes', () => {
    const editor = load(doc, { tracking: false, ids: ['q4gt'] });
    caret(editor, doc.indexOf('wo'));
    type(editor, 'X');
    expect(body(editor)).toBe(
      'One <!--ins b2b2-->t<!--/b2b2-->X<!--ins q4gt-->wo<!--/q4gt--> three.',
    );
    // The second part is Bo's, as the first is.
    expect(editor.getParsed().ledger.marks).toEqual({
      b2b2: { by: 'bo', at: OLD },
      q4gt: { by: 'bo', at: OLD },
    });
    expect(head(editor)).toBe(docText(editor).indexOf('<!--ins q4gt-->'));
    expect(editor.getUiState().tracking).toBe(false);
    press(editor, 'Mod-z');
    expect(editor.getDoc()).toBe(doc);
  });

  it('pastes at the end of an insertion after it', () => {
    const editor = load(doc, { tracking: false });
    caret(editor, doc.indexOf('<!--/b2b2-->'));
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', ' and a half');
    editor.view.contentDOM.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    );
    expect(body(editor)).toBe('One <!--ins b2b2-->two<!--/b2b2--> and a half three.');
  });

  it('removes an insertion whose text Backspace deletes, with its ledger entry', () => {
    const editor = load(doc, { tracking: false });
    caret(editor, doc.indexOf('<!--/b2b2-->'));
    for (let i = 0; i < 3; i++) expect(press(editor, 'Backspace')).toBe(true);
    // No empty insertion is left, and the ledger, with nothing left in it, goes.
    expect(editor.getDoc()).toBe('One  three.\n');
    press(editor, 'Mod-z');
    press(editor, 'Mod-z');
    press(editor, 'Mod-z');
    expect(editor.getDoc()).toBe(doc);
  });

  it('deletes a selection with the marks in it, and keeps a comment as a point', () => {
    const editor = load(fixture, { tracking: false });
    const from = fixture.indexOf('the <!--ins');
    editor.view.dispatch({ selection: { anchor: from, head: fixture.indexOf('.<!--del') } });
    press(editor, 'Delete');
    expect(body(editor)).toBe(
      '# Launch plan\n\nWe will ship <!--cmt c8d2-->.<!--del w2rf  The old exporter stays as it is.-->',
    );
    expect(Object.keys(editor.getParsed().ledger.marks)).toEqual(['w2rf']);
    expect(editor.getParsed().ledger.comments.map((thread) => thread.id)).toEqual(['c8d2']);
  });

  it('replaces all of the text, selected with the keymap: the marks go and the comment stays', () => {
    const editor = load(fixture, { tracking: false });
    expect(press(editor, 'Mod-a')).toBe(true);
    type(editor, 'New text.');
    expect(body(editor)).toBe('New text.<!--cmt c8d2-->');
    expect(editor.getParsed().ledger.marks).toEqual({});
    expect(newestView(editor.getDoc()).text).toBe('New text.\n');
    expect(originalView(editor.getDoc()).text).toBe('New text.\n');
    press(editor, 'Mod-z');
    expect(editor.getDoc()).toBe(fixture);
  });

  it('refuses a line break in front of an insertion, and says why', () => {
    const notices: string[] = [];
    const editor = load(doc, { tracking: false, onNotice: (m) => notices.push(m) });
    caret(editor, doc.indexOf('<!--ins'));
    press(editor, 'Enter');
    expect(editor.getDoc()).toBe(doc);
    expect(notices).toEqual([expect.stringContaining('start of a line')]);
  });
});

describe('line breaks and blocks (format §3.4)', () => {
  const doc = 'Para one.\n\nPara two.\n';
  /** The markers that start a line, which a renderer would read as raw HTML (format §3.2). */
  const lineStarts = (editor: Editor) =>
    editor.getParsed().warnings.filter((w) => w.code === 'line-start-marker');
  /** The visible text before the caret. */
  const beforeCaret = (editor: Editor) => visibleText(editor, head(editor));

  it.each([
    ['a bullet', '- one two\n', '- one'.length],
    ['a numbered item', '1. one two\n2. three\n3. four\n', '1. one t'.length],
    ['a quote', '> Quote one two\n', '> Quote one'.length],
  ])('keeps both breaks of Enter twice in %s, as the keymap types them', (_, text, at) => {
    const plain = load(text, { tracking: false });
    caret(plain, at);
    press(plain, 'Enter');
    press(plain, 'Enter');
    const editor = load(text, { ids: ['k3x9', 'q4gt', 'w8nn', 'b2b2', 'm9tp', 'pf3n'] });
    caret(editor, at);
    press(editor, 'Enter');
    press(editor, 'Enter');
    // With tracking on, Enter keeps the spaces around the break, so only spaces may differ.
    const lines = (doc: string) =>
      doc.split('\n').map((line) => line.replace(/ +/g, ' ').trimEnd());
    expect(lines(newestView(editor.getDoc()).text)).toEqual(lines(plain.getDoc()));
    expect(originalView(editor.getDoc()).text).toBe(text);
    expect(lineStarts(editor)).toEqual([]);
  });

  it.each([
    ['a paragraph', doc, 'Para one.'.length],
    ['a heading', '# Title\n\nPara.\n', '# Title'.length],
    ['a blank line', doc, 'Para one.\n'.length],
  ])('writes Enter at the end of %s as a plain line break', (_, text, at) => {
    const editor = load(text);
    caret(editor, at);
    press(editor, 'Enter');
    expect(editor.getDoc()).toBe(`${text.slice(0, at)}\n${text.slice(at)}`);
    expect(editor.getParsed().marks).toEqual([]);
    expect(beforeCaret(editor)).toBe(`${text.slice(0, at)}\n`);
    // It suggests nothing, so the view stays Clean.
    expect(editor.getUiState()).toMatchObject({ view: 'clean', hasRedlines: false });
  });

  it('continues a list at the end of an item with a new item, in a split', () => {
    const editor = load('- one\n- two\n\nPara.\n', { ids: ['q4gt', 'r5tw', 's6vx'] });
    caret(editor, '- one'.length);
    press(editor, 'Enter');
    expect(body(editor)).toBe('- one<!--split q4gt-->\n- \n- two\n\nPara.');
    expect(beforeCaret(editor)).toBe('- one\n- ');
    type(editor, 'x');
    expect(newestView(editor.getDoc()).text).toBe('- one\n- x\n- two\n\nPara.\n');
    expect(beforeCaret(editor)).toBe('- one\n- x');
  });

  it('keeps the spaces after the caret on Enter, so that no deletion appears', () => {
    const editor = load('One two three.\n', { ids: ['q4gt', 'r5tw', 's6vx'] });
    caret(editor, 'One two'.length);
    press(editor, 'Enter');
    expect(newestView(editor.getDoc()).text).toBe('One two \nthree.\n');
    expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['split']);
    // At the start of the new line.
    expect(beforeCaret(editor)).toBe('One two \n');
    type(editor, 'x');
    expect(newestView(editor.getDoc()).text).toBe('One two \nxthree.\n');
  });

  it('keeps the spaces before the caret when Enter continues a list', () => {
    const editor = load('- one \n- two\n', { ids: ['q4gt', 'r5tw'] });
    caret(editor, '- one '.length);
    press(editor, 'Enter');
    expect(newestView(editor.getDoc()).text).toBe('- one \n- \n- two\n');
    expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['split']);
    expect(beforeCaret(editor)).toBe('- one \n- ');
  });

  it('writes Enter right before an opener after the markers, with the caret on the new line', () => {
    const editor = load(fixture, { ids: ['q4gt'] });
    caret(editor, fixture.indexOf('<!--ins k3x9-->'));
    press(editor, 'Enter');
    expect(body(editor)).toContain('the <!--ins k3x9--><!--split q4gt-->\nnew <!--/k3x9-->');
    expect(lineStarts(editor)).toEqual([]);
    expect(beforeCaret(editor)).toBe('# Launch plan\n\nWe will ship the \n');
  });

  it('makes text typed after Enter twice a block of its own', () => {
    const editor = load(doc, { ids: ['q4gt'] });
    caret(editor, 'Para one.'.length);
    press(editor, 'Enter');
    press(editor, 'Enter');
    for (const char of 'New') type(editor, char);
    expect(body(editor)).toBe('Para one.\n\n<!--ins q4gt-->\n\nNew<!--/q4gt-->\n\nPara two.');
    expect(beforeCaret(editor)).toBe('Para one.\n\nNew');
    expect(head(editor)).toBe(docText(editor).indexOf('<!--/q4gt-->'));
    // The opener's line and the blank line after it don't show.
    expect(editor.getUiState().view).toBe('redlines');
    expect(visibleText(editor)).toBe('Para one.\n\nNew\n\nPara two.\n');
  });

  it('makes text typed after one Enter the next line of the paragraph', () => {
    const editor = load(doc, { ids: ['q4gt'] });
    caret(editor, 'Para one.'.length);
    press(editor, 'Enter');
    for (const char of 'New') type(editor, char);
    expect(body(editor)).toBe('Para one.<!--sub q4gt \\n-->\nNew<!--/q4gt-->\n\nPara two.');
    expect(newestView(editor.getDoc()).text).toBe('Para one.\nNew\n\nPara two.\n');
    expect(head(editor)).toBe(docText(editor).indexOf('<!--/q4gt-->'));
    // The old line break, struck, then the new one.
    expect(visibleText(editor)).toBe('Para one.¶\nNew\n\nPara two.\n');
  });

  it('joins text typed right after your own line break into one insertion with it', () => {
    const editor = load('One two.\n', { ids: ['q4gt', 'r5tw', 's6vx'] });
    caret(editor, 'On'.length);
    press(editor, 'Enter');
    expect(body(editor)).toBe('On<!--split q4gt-->\ne two.');
    expect(beforeCaret(editor)).toBe('On\n');
    type(editor, 'X');
    expect(body(editor)).toBe('On<!--ins r5tw--><!--split s6vx-->\nX<!--/r5tw-->e two.');
    expect(beforeCaret(editor)).toBe('On\nX');
    expect(head(editor)).toBe(docText(editor).indexOf('<!--/r5tw-->'));
  });

  it('cancels your own line break with Backspace', () => {
    const file = 'One two.\n';
    const editor = load(file, { ids: ['q4gt'] });
    caret(editor, 'On'.length);
    press(editor, 'Enter');
    press(editor, 'Backspace');
    expect(editor.getDoc()).toBe(file);
    expect(head(editor)).toBe('On'.length);
  });

  it("deletes someone else's line break with Backspace, drawn as a deletion", () => {
    const file = withLedger('One<!--split b2b2-->\n\ntwo.', { b2b2: 'bo' });
    const editor = load(file, { ids: ['q4gt'] });
    caret(editor, file.indexOf('two'));
    press(editor, 'Backspace');
    expect(body(editor)).toBe('One<!--split b2b2--><!--del q4gt \\n\\n-->two.');
    const deletion = list(editor).find((d) => d.widget?.className.startsWith('rl-del'));
    expect(deletion?.widget).toEqual({ text: '¶¶', className: 'rl-del rl-author-1' });
    expect(visibleText(editor)).toBe('One¶¶two.\n');
    // Before the deleted break, so Backspace goes on to the left.
    expect(head(editor)).toBe('One'.length);
  });

  it.each([
    ['a plain file', '# Title\r\n\r\nFirst para.\r\n\r\nSecond para.\r\n'],
    ['the example', fixture],
  ])('replaces all of %s when everything is selected, and Undo gives it back', (_, file) => {
    const editor = load(file, { ids: ['q4gt', 'r5tw'] });
    selectAll(editor.view);
    for (const char of 'New text') type(editor, char);
    expect(newestView(editor.getParsed().text).text).toBe('# New text\n');
    expect(beforeCaret(editor).endsWith('New text')).toBe(true);
    expect(lineStarts(editor)).toEqual([]);
    undo(editor.view);
    expect(editor.getDoc()).toBe(file);
  });

  it.each([
    ['a plain file', '# Title\r\n\r\nFirst para.\r\n\r\nSecond para.\r\n'],
    ['the example', fixture],
  ])('deletes all of %s when everything is selected, and Undo gives it back', (_, file) => {
    const editor = load(file, { ids: ['q4gt'] });
    selectAll(editor.view);
    press(editor, 'Delete');
    expect(newestView(editor.getParsed().text).text).toBe('\n');
    expect(lineStarts(editor)).toEqual([]);
    // After the deleted text, at the end of the body.
    expect(head(editor)).toBe(editor.getParsed().ledgerRange!.from);
    undo(editor.view);
    expect(editor.getDoc()).toBe(file);
  });
});

describe('where the caret goes after the format changes more than the edit', () => {
  /** The newest text before the caret. */
  const newestBeforeCaret = (editor: Editor) => {
    const view = newestView(editor.getParsed().text);
    return view.text.slice(0, view.map.fromSource(head(editor)));
  };

  it('stays at a deletion that the format widened to a whole link destination', () => {
    const editor = load('See [docs](http://example.com/a/b) now.\n', { ids: ['q4gt', 'r5tw'] });
    caret(editor, 'See [docs](http://example.com/a/'.length);
    press(editor, 'Backspace');
    expect(newestBeforeCaret(editor)).toBe('See [docs](http://example.com/a');
    press(editor, 'Backspace');
    expect(newestView(editor.getParsed().text).text).toBe(
      'See [docs](http://example.com/b) now.\n',
    );
  });

  it('stays at a deletion forward in a link destination', () => {
    const editor = load('See [docs](http://example.com/a/b) now.\n', { ids: ['q4gt', 'r5tw'] });
    caret(editor, 'See [docs](http://example.com/'.length);
    press(editor, 'Delete');
    press(editor, 'Delete');
    expect(newestView(editor.getParsed().text).text).toBe(
      'See [docs](http://example.com/b) now.\n',
    );
    expect(newestBeforeCaret(editor)).toBe('See [docs](http://example.com/');
  });

  it.each([
    ['an item', '- alpha\n- beta\n- gamma\n', '- beta', '- delta', '- alpha\n- delta'],
    ['a heading', '## Install\n\nRun it.\n', '## Install', '## Setup', '## Setup'],
  ])(
    'goes after pasted text that repeats the prefix of %s it replaces',
    (_, doc, old, paste, before) => {
      const editor = load(doc, { ids: ['q4gt'] });
      editor.view.dispatch({
        selection: { anchor: doc.indexOf(old), head: doc.indexOf(old) + old.length },
      });
      editor.view.dispatch(editor.view.state.replaceSelection(paste), { userEvent: 'input.paste' });
      expect(newestBeforeCaret(editor)).toBe(before);
    },
  );

  it('goes after text typed over a whole item, which the next item keeps its bullet in front of', () => {
    const doc = '- alpha\n- beta\n- gamma\n';
    const editor = load(doc, { ids: ['q4gt', 'r5tw'] });
    editor.view.dispatch({
      selection: { anchor: doc.indexOf('- beta'), head: doc.indexOf('- gamma') },
    });
    type(editor, 'x');
    expect(newestView(editor.getParsed().text).text).toBe('- alpha\n- xgamma\n');
    expect(newestBeforeCaret(editor)).toBe('- alpha\n- x');
  });

  it('stays where a letter in front of the same letter was deleted', () => {
    const editor = load('One aab.\n', { ids: ['q4gt'] });
    caret(editor, 'One a'.length);
    press(editor, 'Backspace');
    expect(newestBeforeCaret(editor)).toBe('One ');
  });

  it.each([
    ['no final line break', 'Hello world'],
    ['a final line break', 'Hello world\n'],
    ['a blank line at the end', 'Hello world\n\n'],
  ])('follows typing in a file with %s, whose first tracked edit writes the ledger', (_, doc) => {
    const editor = load(doc, { ids: ['q4gt'] });
    caret(editor, 'Hel'.length);
    type(editor, 'x');
    type(editor, 'y');
    expect(newestView(editor.getParsed().text).text.trimEnd()).toBe('Helxylo world');
    expect(newestBeforeCaret(editor)).toBe('Helxy');
    undo(editor.view);
    expect(editor.getDoc()).toBe(doc);
  });

  it.each([
    ['list items', '- one\n- two\n', ' ', '- one '],
    ['list items, with a comma', '- one\n- two\n', ', ', '- one, '],
    ['list items, with a word', '- one\n- two\n', ' and ', '- one and '],
    ['numbered items', '1. one\n2. two\n', ' ', '1. one '],
    ['quote lines', '> one\n> two\n', ' ', '> one '],
  ])('goes after text typed over the line break between %s', (_, doc, typed, before) => {
    const editor = load(doc, { ids: ['q4gt', 'r5tw'] });
    const at = doc.indexOf('\n');
    editor.view.dispatch({ selection: { anchor: at, head: at + 1 } });
    type(editor, typed);
    expect(newestBeforeCaret(editor)).toBe(before);
  });

  it('goes after pasted line breaks, over the last heading of a file with a ledger', () => {
    // The format keeps the heading's prefix, so the pasted text doesn't follow the text before it.
    const doc = withLedger('Intro <!--ins b2b2-->now<!--/b2b2-->.\n\n## Head', { b2b2: 'bo' });
    const editor = load(doc, { ids: ['q4gt', 'r5tw'] });
    const at = doc.indexOf('## Head');
    editor.view.dispatch({ selection: { anchor: at, head: at + '## Head'.length } });
    editor.view.dispatch(editor.view.state.replaceSelection('x\n\n'), { userEvent: 'input.paste' });
    expect(newestView(editor.getParsed().text).text).toBe('Intro now.\n\n## x\n\n\n');
    expect(newestBeforeCaret(editor)).toBe('Intro now.\n\n## x\n\n');
  });

  it('goes after text typed between a bullet and its space, which the text follows', () => {
    const editor = load('Intro.\n\n- alpha\n- beta\n', { ids: ['q4gt', 'r5tw'] });
    caret(editor, 'Intro.\n\n-'.length);
    type(editor, 'ab');
    expect(newestView(editor.getParsed().text).text).toBe('Intro.\n\n- abalpha\n- beta\n');
    expect(newestBeforeCaret(editor)).toBe('Intro.\n\n- ab');
  });

  it('goes to the next block after a paragraph break pasted in someone’s inserted paragraph', () => {
    // The rest of Bo's paragraph becomes a block of its own, its opener on a line of its own.
    const doc = withLedger('Intro.\n\n<!--ins b2b2-->\n\nA new paragraph.<!--/b2b2-->\n\nEnd.', {
      b2b2: 'bo',
    });
    const editor = load(doc, { ids: ['q4gt', 'r5tw', 's6vx'] });
    caret(editor, doc.indexOf('.<!--/b2b2-->'));
    editor.view.dispatch(editor.view.state.replaceSelection('end.\n\n'), {
      userEvent: 'input.paste',
    });
    expect(newestView(editor.getParsed().text).text).toBe(
      'Intro.\n\nA new paragraphend.\n\n.\n\nEnd.\n',
    );
    expect(newestBeforeCaret(editor)).toBe('Intro.\n\nA new paragraphend.\n\n');
  });

  it('goes after text typed over the break between a paragraph and a heading', () => {
    const editor = load('Intro.\n\n## Head\n', { ids: ['q4gt', 'r5tw'] });
    editor.view.dispatch({ selection: { anchor: 'Intro.'.length, head: 'Intro.\n\n'.length } });
    type(editor, ' ');
    expect(newestBeforeCaret(editor)).toBe('Intro. ');
  });

  it('goes after text ending in a space typed over the end of the text from inside a bullet', () => {
    // The format keeps the bullet, so the typed text doesn't follow the text before the edit.
    const doc = '- alpha\n- beta\n';
    const editor = load(doc, { ids: ['q4gt', 'r5tw'] });
    editor.view.dispatch({
      selection: { anchor: doc.indexOf('- beta') + 1, head: doc.length - 1 },
    });
    type(editor, '- ');
    expect(newestView(editor.getParsed().text).text).toBe('- alpha\n- - \n');
    expect(newestBeforeCaret(editor)).toBe('- alpha\n- - ');
  });

  it('goes after a letter typed in front of the same letter', () => {
    const editor = load('One aab.\n', { ids: ['q4gt'] });
    caret(editor, 'One '.length);
    type(editor, 'a');
    expect(newestBeforeCaret(editor)).toBe('One a');
  });
});

describe('every way to change text', () => {
  const doc = 'One two three.\n\nFour five.\n';

  /** With Track Changes on: rejecting every change gives back the text the edit was made to. */
  function expectTracked(editor: Editor): void {
    expect(editor.getDoc()).not.toBe(doc);
    expect(originalView(editor.getDoc()).text).toBe(doc);
  }

  it('tracks a drop', () => {
    const editor = load(doc, { ids: ['q4gt'] });
    editor.view.dispatch({ changes: { from: 4, insert: 'big ' }, userEvent: 'input.drop' });
    expectTracked(editor);
  });

  it('tracks text moved by dragging it', () => {
    const editor = load(doc, { ids: ['q4gt', 'r5tw'] });
    editor.view.dispatch({
      changes: [
        { from: 4, to: 8 },
        { from: 20, insert: 'two ' },
      ],
      userEvent: 'move.drop',
    });
    expectTracked(editor);
  });

  it('tracks a cut', () => {
    // What CodeMirror's cut handler dispatches, which needs the page's selection in the editor.
    const editor = load(doc, { ids: ['q4gt'] });
    editor.view.dispatch({ changes: { from: 4, to: 8 }, userEvent: 'delete.cut' });
    expectTracked(editor);
  });

  it.each([
    ['indents', 'Mod-]'],
    ['comments out', 'Mod-/'],
  ])('tracks or refuses what a command that %s does', (_, key) => {
    const notices: string[] = [];
    const editor = load(doc, { ids: ['q4gt', 'r5tw'], onNotice: (m) => notices.push(m) });
    caret(editor, 2);
    expect(press(editor, key)).toBe(true);
    // The format can't mark either at the start of a paragraph's line, so both are refused.
    expect(editor.getDoc()).toBe(doc);
    expect(notices).toHaveLength(1);
  });

  it('tracks or refuses re-indenting', () => {
    // What indentSelection dispatches; Markdown's indentation rarely gives it anything to change.
    const notices: string[] = [];
    const editor = load(doc, { ids: ['q4gt'], onNotice: (m) => notices.push(m) });
    editor.view.dispatch({ changes: { from: 0, insert: '  ' }, userEvent: 'indent' });
    expect(editor.getDoc()).toBe(doc);
    expect(notices).toHaveLength(1);
  });

  it('comments out as a plain edit with tracking off', () => {
    const editor = load(doc, { tracking: false });
    caret(editor, 2);
    press(editor, 'Mod-/');
    expect(editor.getDoc()).toBe('<!-- One two three. -->\n\nFour five.\n');
  });
});

describe('the ledger', () => {
  const ledgerStart = parse(fixture).ledgerRange!.from;

  it('keeps the caret off the line after the hidden ledger when Raw is left', () => {
    const editor = load(fixture, { view: 'raw', tracking: false });
    caret(editor, fixture.lastIndexOf('-->'));
    editor.setViewMode('redlines');
    expect(head(editor)).toBe(ledgerStart);
  });

  it('keeps the caret off the empty line after the hidden ledger', () => {
    const editor = load(fixture);
    caret(editor, fixture.length);
    expect(head(editor)).toBe(ledgerStart);
    editor.view.dispatch({ selection: { anchor: 0, head: fixture.length }, userEvent: 'select' });
    expect(editor.view.state.selection.main).toMatchObject({ anchor: 0, head: ledgerStart });
  });

  it('never types after the ledger', () => {
    const editor = load(fixture, { ids: ['q4gt'] });
    caret(editor, ledgerStart);
    type(editor, ' New.');
    expect(body(editor).endsWith('<!--ins q4gt--> New.<!--/q4gt-->')).toBe(true);
    // An edit that reaches past the body, as one from a drop would, stops at it.
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: 'After.' },
      userEvent: 'input.drop',
    });
    expect(editor.getParsed().ledgerRange?.to).toBe(editor.view.state.doc.length - 1);
    expect(body(editor).endsWith('<!--ins q4gt--> New.After.<!--/q4gt-->')).toBe(true);
  });

  it('keeps the ledger when the text up to the end is selected and typed over', () => {
    const editor = load(fixture, { ids: ['q4gt', 'r5tw'] });
    selectAll(editor.view);
    expect(editor.view.state.selection.main).toMatchObject({ anchor: 0, head: ledgerStart });
    editor.view.dispatch({
      selection: { anchor: fixture.indexOf(', after the'), head: fixture.length },
      userEvent: 'select',
    });
    type(editor, ' Hello.');
    const parsed = editor.getParsed();
    expect(parsed.ledgerRange?.to).toBe(editor.view.state.doc.length - 1);
    expect(Object.keys(parsed.ledger.marks)).toEqual(expect.arrayContaining(['p7qd', 'w2rf']));
    expect(newestView(editor.getDoc()).text).toBe(
      '# Launch plan\n\nWe will ship the new importer in April Hello.\n',
    );
  });
});

describe('composition', () => {
  /** What an input method sends while composing. */
  function compose(editor: Editor, from: number, to: number, text: string, first = false): void {
    editor.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: first ? 'input.type.compose.start' : 'input.type.compose',
    });
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  const composing = (editor: Editor, on: boolean) => {
    (editor.view as unknown as { inputState: { composing: number } }).inputState.composing = on
      ? 1
      : -1;
  };

  it('tracks composed text once the composition ends', async () => {
    const doc = 'Gruss aus Kln.\n';
    const at = doc.indexOf('ln.');
    const editor = load(doc, { ids: ['q4gt'] });
    composing(editor, true);
    compose(editor, at, at, '¨', true);
    compose(editor, at, at + 1, 'ö');
    await tick();
    // Untracked while the input method works on it, which rewriting it would break.
    expect(docText(editor)).toBe('Gruss aus Köln.\n');
    composing(editor, false);
    editor.view.contentDOM.dispatchEvent(new Event('compositionend', { bubbles: true }));
    await tick();
    expect(body(editor)).toBe('Gruss aus K<!--ins q4gt-->ö<!--/q4gt-->ln.');
    expect(head(editor)).toBe(body(editor).indexOf('<!--/q4gt-->'));
    undo(editor.view);
    expect(editor.getDoc()).toBe(doc);
  });

  it('switches Clean to Redlines when the composed text is a suggestion', async () => {
    // The file has redlines already, so only the tracked edit can switch the view.
    const doc = withLedger('Gruss aus <!--ins b2b2-->der <!--/b2b2-->Kln.', { b2b2: 'bo' });
    const editor = load(doc, { view: 'clean', ids: ['q4gt'] });
    const at = doc.indexOf('ln.');
    compose(editor, at, at, 'ö', true);
    await tick();
    expect(body(editor)).toContain('K<!--ins q4gt-->ö<!--/q4gt-->ln.');
    expect(editor.getUiState().view).toBe('redlines');
  });

  it('moves text composed at the end of an insertion out of it, with Track Changes off', async () => {
    const doc = withLedger('Gruss <!--ins b2b2-->aus<!--/b2b2--> Koln.', { b2b2: 'bo' });
    const at = doc.indexOf('<!--/b2b2-->');
    const editor = load(doc, { tracking: false });
    composing(editor, true);
    compose(editor, at, at, '¨', true);
    compose(editor, at, at + 1, 'é');
    await tick();
    // As the input method put it while it works on it.
    expect(docText(editor)).toBe(doc.replace('aus<', 'ausé<'));
    composing(editor, false);
    editor.view.contentDOM.dispatchEvent(new Event('compositionend', { bubbles: true }));
    await tick();
    expect(body(editor)).toBe('Gruss <!--ins b2b2-->aus<!--/b2b2-->é Koln.');
    undo(editor.view);
    expect(editor.getDoc()).toBe(doc);
  });

  it('leaves text composed in plain text as it is, with Track Changes off', async () => {
    const doc = 'Gruss aus Kln.\n';
    const at = doc.indexOf('ln.');
    const editor = load(doc, { tracking: false });
    compose(editor, at, at, 'ö', true);
    await tick();
    expect(editor.getDoc()).toBe('Gruss aus Köln.\n');
    undo(editor.view);
    expect(editor.getDoc()).toBe(doc);
  });

  it('puts composed text that Track Changes refuses back as it was', async () => {
    const notices: string[] = [];
    const doc = 'Run `make` now.\n';
    const editor = load(doc, { ids: ['q4gt'], onNotice: (message) => notices.push(message) });
    compose(editor, doc.indexOf('make'), doc.indexOf('make'), 'é', true);
    await tick();
    expect(editor.getDoc()).toBe(doc);
    expect(notices).toHaveLength(1);
  });
});
