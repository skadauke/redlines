// @vitest-environment happy-dom
// Clear, type over, format, cut and paste over a rectangle that holds another person's pending marks
// (an insertion, a deletion), that crosses an inserted row, and in a file with CRLF line breaks:
// with Track Changes on and off, every order of decisions reads alike (the script harness holds each
// row to it), and what is refused leaves the file as it was.
import { forceParsing } from '@codemirror/language';
import { acceptAll, applyChanges, newestView, originalView, rejectAll } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, scriptRows, type Step } from '../blocks/script.ts';
import { createFormatting } from '../../../../plugins/formatting/src/index.ts';
import { createEditor, type Editor } from '../index.ts';

const LEDGER =
  '⏎⏎<!-- redlines⏎version: 1⏎people:⏎  bo: {name: Bo Chen}⏎marks:⏎  k3x9: {by: bo, at: 2026-11-01T10:00Z}⏎  m2bd: {by: bo, at: 2026-11-01T10:00Z}⏎  p7qd: {by: bo, at: 2026-11-01T10:00Z}⏎-->⏎';
const LEDGER_ROW =
  '⏎⏎<!-- redlines⏎version: 1⏎people:⏎  bo: {name: Bo Chen}⏎marks:⏎  m2bd: {by: bo, at: 2026-11-01T10:00Z}⏎-->⏎';
const H = '| a | b | c |⏎| - | - | - |⏎';
/** Bo's insertion in 12, Bo's inserted row 21–23, Bo's deletion in 33. */
const rows = (r1: string, r2: string, r3: string, ledger = LEDGER) =>
  `${H}${r1}⏎${r2}⏎${r3}${ledger}`;
const R2 = '| <!--ins m2bd row--> 21 | 22 | 23 |';
const SELECTED = rows(
  '| 11 | [1<!--ins k3x9-->2<!--/k3x9--> | 13 |',
  R2,
  '| 31 | 32 | 33<!--del p7qd  x-->] |',
);

interface Row {
  name: string;
  keys: Step[];
  doc?: string;
}

/** Each row with Track Changes off and on; the script holds every order of decisions alike. */
const both = (rowsOf: Row[], expectation: Script['expect'] = {}): Script[] =>
  rowsOf.flatMap((row) =>
    [false, true].map((tc) => ({
      name: `${row.name}, Track Changes ${tc ? 'on' : 'off'}`,
      doc: row.doc ?? SELECTED,
      keys: row.keys,
      tc,
      others: 'bo',
      expect: expectation,
    })),
  );

describe('keys over a rectangle with another person’s marks, across their inserted row', () => {
  scriptRows(
    both([
      { name: '⌫ clears the cells', keys: ['Backspace'] },
      { name: '⌦ clears the cells', keys: ['Delete'] },
      { name: 'typing clears the cells and types in the first', keys: [{ type: 'z' }] },
    ]),
  );

  // The format library refuses to format text with another person's pending change in it, as in a
  // paragraph: the key says why and writes nothing.
  scriptRows(
    both(
      [
        { name: '⌘B is refused', keys: ['Mod-b'] },
        { name: '⌘I is refused', keys: ['Mod-i'] },
      ],
      { refusal: 'Accept or reject the changes in this paragraph first.' },
    ),
  );
});

describe('formatting over a rectangle that crosses Bo’s inserted row', () => {
  const crossing = rows(
    '| 11 | [12 | 13 |',
    '| <!--ins m2bd row--> 21 | 22 | 23 |',
    '| 31 | 32 | 33] |',
    LEDGER_ROW,
  );
  // A pending row of another person is a pending change in the paragraph, as the format reads it.
  scriptRows(
    both(
      [
        { name: '⌘B is refused', keys: ['Mod-b'], doc: crossing },
        { name: '⌘I is refused', keys: ['Mod-i'], doc: crossing },
      ] satisfies Row[],
      { refusal: 'Accept or reject the changes in this paragraph first.' },
    ),
  );

  for (const tracking of [false, true]) {
    it(`leaves the file as it was, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      const editor = load(crossing, tracking);
      const before = editor.getDoc();
      editor.view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, metaKey: true, bubbles: true }),
      );
      expect(editor.getDoc()).toBe(before);
    });
  }
});

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

const plain = (text: string) => text.replaceAll('⏎', '\n');

const notices: string[] = [];

function load(doc: string, tracking: boolean, crlf = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const text = plain(doc.replace(/\[|\]/g, ''));
  const editor = createEditor(parent, {
    doc: crlf ? text.replaceAll('\n', '\r\n') : text,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    onNotice: (message) => notices.push(message),
  });
  open.push(editor);
  createFormatting(editor, {
    author: { handle: 'ada', name: 'Ada Lovelace' },
    notice: (m) => notices.push(m),
  });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  // The state holds the text with LF breaks only, the same offsets for either file.
  const marked = plain(doc);
  editor.view.dispatch({
    selection: { anchor: marked.indexOf('['), head: marked.indexOf(']') - 1 },
  });
  return editor;
}

/** What every decision gives: all accepted, all rejected, against the views. */
function decisions(editor: Editor) {
  const file = editor.getDoc();
  return {
    file,
    accepted: applyChanges(file, acceptAll(file)),
    rejected: applyChanges(file, rejectAll(file)),
    newest: newestView(file).text,
    original: originalView(file).text,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function copyOrCut(editor: Editor, type: 'copy' | 'cut') {
  document.getSelection()?.selectAllChildren(editor.view.contentDOM);
  await tick();
  const clipboardData = new DataTransfer();
  editor.view.contentDOM.dispatchEvent(
    new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true }),
  );
  return clipboardData;
}

function paste(editor: Editor, text: string): void {
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  editor.view.contentDOM.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
  );
}

describe('cut and paste over a rectangle with another person’s marks', () => {
  for (const tracking of [false, true]) {
    it(`cut copies the newest text and clears the cells, Track Changes ${tracking ? 'on' : 'off'}`, async () => {
      const editor = load(SELECTED, tracking);
      const before = editor.getDoc();
      const data = await copyOrCut(editor, 'cut');
      // The newest text: Bo's insertion in, his deletion out, his inserted row there.
      expect(data.getData('text/plain')).toBe('12\t13\n22\t23\n32\t33');
      expect(data.getData('text/html')).not.toContain('<!--');
      const done = decisions(editor);
      expect(done.file).not.toBe(before);
      if (tracking) expect(done.rejected).toBe(decisions(load(SELECTED, true)).rejected);
      expect(done.accepted).toBe(done.newest);
    });

    it(`paste over it reads alike in every decision, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      const editor = load(SELECTED, tracking);
      const before = editor.getDoc();
      notices.length = 0;
      paste(editor, 'x\ty\nz\tw');
      if (!tracking) {
        // Plain text can't replace another person's pending changes: refused whole, with its reason.
        expect(editor.getDoc()).toBe(before);
        expect(notices.at(-1)).toMatch(/Track Changes off/);
        return;
      }
      const done = decisions(editor);
      expect(done.newest).toContain('| 11 | x | y |');
      expect(done.accepted).toBe(done.newest);
      expect(done.rejected).toBe(done.original);
    });
  }
});

describe('in a file with CRLF line breaks', () => {
  // Four cells: tracked formatting is refused past a handful of pending changes in a table.
  const doc = rows('| 11 | [12 | 13 |', '| 21 | 22 | 23] |', '| 31 | 32 | 33 |', '⏎');
  const lf = (text: string) => text.replaceAll('\r\n', '\n');

  for (const tracking of [false, true]) {
    const label = `Track Changes ${tracking ? 'on' : 'off'}`;
    it(`clears, types over and formats with the file's own breaks, ${label}`, () => {
      for (const act of ['clear', 'type', 'bold'] as const) {
        const editor = load(doc, tracking, true);
        const start = editor.getDoc();
        const view = editor.view;
        const key = (name: string, init: KeyboardEventInit = {}) =>
          view.contentDOM.dispatchEvent(
            new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }),
          );
        if (act === 'clear') key('Backspace');
        else if (act === 'bold')
          expect(editor.commands.run('format.bold'), notices.join()).toBe(true);
        else view.dispatch(view.state.replaceSelection('z'), { userEvent: 'input.type' });
        const after = editor.getDoc();
        expect(after, act).not.toBe(start);
        // Every line break is the file's own, a CR and an LF.
        expect(after.replace(/\r\n/g, ''), act).not.toMatch(/[\r\n]/);
        const done = decisions(editor);
        expect(done.accepted, act).toBe(done.newest);
        if (tracking) expect(done.rejected, act).toBe(start);
        expect(lf(after)).toBeTruthy();
      }
    });

    it(`cuts and pastes with the file's own breaks, ${label}`, async () => {
      const editor = load(doc, tracking, true);
      const start = editor.getDoc();
      const data = await copyOrCut(editor, 'cut');
      expect(data.getData('text/plain')).toBe('12\t13\n22\t23');
      paste(editor, 'x\ty\nz\tw\nu\tv\nq\tr');
      const after = editor.getDoc();
      expect(after.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      const done = decisions(editor);
      expect(done.accepted).toBe(done.newest);
      if (tracking) expect(done.rejected).toBe(start);
    });
  }
});
