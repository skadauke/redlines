// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectAll, undo } from '@codemirror/commands';
import { runScopeHandlers } from '@codemirror/view';
import { EditError, newestView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions, type EditorUiState } from '../index.ts';
import { editSourceFacet } from './typing.ts';

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
});

describe('the ledger', () => {
  const ledgerStart = parse(fixture).ledgerRange!.from;

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
      selection: { anchor: fixture.indexOf('We will'), head: fixture.length },
      userEvent: 'select',
    });
    type(editor, 'Hello.');
    const parsed = editor.getParsed();
    expect(parsed.ledgerRange?.to).toBe(editor.view.state.doc.length - 1);
    expect(Object.keys(parsed.ledger.marks)).toEqual(expect.arrayContaining(['p7qd', 'w2rf']));
    expect(newestView(editor.getDoc()).text).toBe('# Launch plan\n\nHello.\n');
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
