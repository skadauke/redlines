// @vitest-environment happy-dom
import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { acceptAll, applyChanges, parse, rejectAll, reply, trackedEdit } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { lineChanges } from './diff.ts';
import { agentStep, history, redo, undo } from './history/index.ts';
import { createEditor, type Editor } from './index.ts';
import { fileText, type LoadedFile, loadFile } from './line-breaks.ts';
import { parsedField } from './tracked/field.ts';
import { editSourceFacet } from './tracked/typing.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, onChange?: (doc: string) => void): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, onChange });
  open.push(editor);
  return editor;
}

/** Inserts text as typing does; a line break arrives as LF, from a command or the browser. */
const type = (editor: Editor, at: number, text: string) =>
  editor.view.dispatch({ changes: { from: at, insert: text } });

describe('line endings', () => {
  it('keeps CRLF', () => {
    const editor = load('a\r\nb\r\n');
    expect(editor.getDoc()).toBe('a\r\nb\r\n');
    expect(editor.view.state.doc.toString()).toBe('a\nb\n');
    expect(editor.getParsed().text).toBe('a\nb\n');
  });

  it('writes CRLF for a line break typed in a CRLF file', () => {
    const changes: string[] = [];
    const editor = load('# Title\r\n\r\nPara text\r\n', (doc) => changes.push(doc));
    type(editor, '# Title\n\nPara'.length, '\n');
    expect(editor.getDoc()).toBe('# Title\r\n\r\nPara\r\n text\r\n');
    expect(changes).toEqual([editor.getDoc()]);
    expect(editor.view.state.doc.lines).toBe(5);
  });

  it('returns an untouched mixed-ending file byte for byte', () => {
    const file = '# Title\r\n\r\nIntro\n\n## Part\r\nlast\rline';
    const editor = load(file);
    expect(editor.getDoc()).toBe(file);

    type(editor, 0, 'x');
    editor.view.dispatch({ changes: { from: 0, to: 1 } });
    expect(editor.getDoc()).toBe(file);
  });

  it("keeps an edited mixed-ending file's line breaks and gives new ones its first break's", () => {
    const crlfFirst = load('one\r\ntwo\nthree\n');
    type(crlfFirst, 'one\ntwo'.length, '!');
    expect(crlfFirst.getDoc()).toBe('one\r\ntwo!\nthree\n');
    type(crlfFirst, 'one'.length, '\n');
    expect(crlfFirst.getDoc()).toBe('one\r\n\r\ntwo!\nthree\n');

    const lfFirst = load('line one\nline two\r\n');
    const second = lfFirst.view.state.doc.line(2);
    expect(second.text).toBe('line two');
    type(lfFirst, second.to, 'Z');
    expect(lfFirst.getDoc()).toBe('line one\nline twoZ\r\n');

    const joined = load('a\r\nb\nc');
    joined.view.dispatch({ changes: { from: 'a\nb'.length, to: 'a\nb\n'.length } });
    expect(joined.getDoc()).toBe('a\r\nbc');
  });

  it('writes the text that replaces a kept line break', () => {
    const changes: string[] = [];
    const single = load('a\r\nb\nc', (doc) => changes.push(doc));
    single.view.dispatch({ changes: { from: 'a\nb'.length, to: 'a\nb\n'.length, insert: 'x' } });
    expect(single.view.state.doc.toString()).toBe('a\nbxc');
    expect(single.getDoc()).toBe('a\r\nbxc');
    expect(changes).toEqual(['a\r\nbxc']);

    const multi = load('a\r\nb\nc');
    multi.view.dispatch({
      changes: { from: 'a\nb'.length, to: 'a\nb\n'.length, insert: 'one\ntwo' },
    });
    expect(multi.getDoc()).toBe('a\r\nbone\r\ntwoc');
  });

  it('never writes a lone CR right before a lone LF, which would read back as one break', () => {
    const editor = load('x\rA\ny');
    editor.view.dispatch({ changes: { from: 'x\n'.length, to: 'x\nA'.length } });
    expect(editor.view.state.doc.toString()).toBe('x\n\ny');
    expect(editor.getDoc()).toBe('x\r\n\ny');
  });

  it('takes the line break of a document set later', () => {
    const editor = load('a\nb');
    editor.setDoc('x\r\ny');
    expect(editor.getDoc()).toBe('x\r\ny');
    type(editor, 1, '\n');
    expect(editor.getDoc()).toBe('x\r\n\r\ny');

    editor.setDoc('p\nq');
    type(editor, 1, '\n');
    expect(editor.getDoc()).toBe('p\n\nq');
  });

  it("gives pasted text the document's line breaks", () => {
    const editor = load('a\r\nb');
    editor.view.dispatch({ selection: { anchor: 0 } });
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'x\ny\n');
    editor.view.contentDOM.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    );
    expect(editor.getDoc()).toBe('x\r\ny\r\na\r\nb');
  });
});

describe('a file whose change is decided (format §5.1, #56)', () => {
  const NOW = new Date('2026-11-05T10:00:30Z');
  const FIRST = 'bcdfghjkmnpqrstvwxz';
  const REST = 'bcdfghjkmnpqrstvwxz23456789';
  /** Random bytes that make the ids given, one after the other. */
  const idBytes = (...ids: string[]) => {
    const bytes = ids.flatMap((id) => [...id].map((c, i) => (i === 0 ? FIRST : REST).indexOf(c)));
    let at = 0;
    return (n: number) => Uint8Array.from(bytes.slice(at, (at += n)));
  };
  const k3x9 = () => idBytes('k3x9');

  /** An editor with Track Changes on, whose new marks are `k3x9` and then `ids`. */
  function tracked(doc: string, ...ids: string[]): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const source = editSourceFacet.of({ now: () => NOW, random: idBytes('k3x9', ...ids) });
    const editor = createEditor(parent, { doc, author, tracking: true, extensions: [source] });
    open.push(editor);
    return editor;
  }

  /** Types `there` over `world`, as the keyboard does. */
  function typeThere(editor: Editor): void {
    const from = editor.view.state.doc.toString().indexOf('world');
    editor.view.dispatch({ selection: { anchor: from, head: from + 5 } });
    editor.view.dispatch(editor.view.state.replaceSelection('there'), { userEvent: 'input.type' });
  }

  it.each([
    ['no final line break', 'Hello world.\n\nSecond line here.'],
    ['a final LF after CRLF', 'Hello world.\r\n\r\nSecond line here.\n'],
    ['a final CR after LF', 'Hello world.\n\nSecond line here.\r'],
    ['CRLF', 'Hello world.\r\n\r\nSecond line here.\r\n'],
    ['a blank line at the end', 'Hello world.\n\n'],
    // The ledger takes the format's line breaks, not those of the file's first line break.
    ['an LF first and a CRLF later', 'Hello world.\nTwo\nThree\r\n'],
    ['a CR first', 'Hello world.\rSecond line here.\n'],
    ['CRs only', 'Hello world.\r\rSecond line here.\r'],
    ['CRs only and no final line break', 'Hello world.\r\rSecond line here.'],
    ['CRs only and a blank line at the end', 'Hello world.\r\r'],
    ['a CR in front of the final CRLF', 'A\nHello world.\r\r\n'],
  ])('gives back a file with %s, as the command line does', (_, file) => {
    const newest = file.replace('world', 'there');
    // What the command line writes for the same change, and gives back when it decides it.
    const ctx = { author, time: '2026-11-05T10:00Z', random: k3x9() };
    const at = file.indexOf('world');
    const written = applyChanges(
      file,
      trackedEdit(file, { from: at, to: at + 5, insert: 'there' }, ctx),
    );
    expect(applyChanges(written, rejectAll(written))).toBe(file);
    expect(applyChanges(written, acceptAll(written))).toBe(newest);

    const rejecting = tracked(file);
    typeThere(rejecting);
    // The editor writes the command line's bytes, the ledger's included, which the format reads.
    const saved = rejecting.getDoc();
    expect(saved).toBe(written);
    expect(parse(saved).warnings).toEqual([]);
    expect(applyChanges(saved, rejectAll(saved))).toBe(file);
    expect(applyChanges(saved, acceptAll(saved))).toBe(newest);
    rejecting.reject('k3x9');
    expect(rejecting.getDoc()).toBe(file);
    const accepting = tracked(file);
    typeThere(accepting);
    accepting.accept('k3x9');
    expect(accepting.getDoc()).toBe(newest);

    // The file the command line wrote, decided in the editor.
    const opened = tracked(written);
    opened.reject('k3x9');
    expect(opened.getDoc()).toBe(file);
    const reopened = tracked(written);
    reopened.accept('k3x9');
    expect(reopened.getDoc()).toBe(newest);
  });

  it('writes again, as the format does, a ledger that it wrote with CRs alone before', () => {
    // What this editor wrote before (build 10) for `Hello world.\r\rSecond line here.\r`, which
    // the format can't read (format §5.1).
    const ledger = [
      '<!-- redlines',
      "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.",
      'version: 1',
      'people:',
      '  ada: {name: Ada Lovelace}',
      'marks:',
      '  k3x9: {by: ada, at: 2026-11-05T10:00Z}',
      '-->',
    ].join('\r');
    const old = `Hello <!--sub k3x9 world-->there<!--/k3x9-->.\r\rSecond line here.\r\r${ledger}\r`;
    expect(parse(old).warnings.map((w) => w.code)).toContain('bad-ledger');
    const editor = tracked(old, 'w8nn');
    expect(editor.getDoc()).toBe(old);
    const from = editor.view.state.doc.toString().indexOf('Second');
    editor.view.dispatch({ selection: { anchor: from, head: from + 6 } });
    editor.view.dispatch(editor.view.state.replaceSelection('Third'), { userEvent: 'input.type' });
    const saved = editor.getDoc();
    expect(parse(saved).warnings).toEqual([]);
    expect(Object.keys(parse(saved).ledger.marks)).toEqual(['k3x9', 'w8nn']);
    expect(saved.slice(saved.indexOf('here.'))).toMatch(/^here\.\n\n<!-- redlines\n[^\r]*-->\r$/);
    expect(applyChanges(saved, rejectAll(saved))).toBe('Hello world.\r\rSecond line here.\r');
  });

  it.each([
    // A tool left one line break of the blank line (format §9.5).
    ['a blank line of one LF, and CRLF lines', '.\r\nTwo\r\nThree\n', '\r\n', '\r\n'],
    ['CRLF lines and a blank line of LFs', '.\r\nTwo\r\nThree\n\n', '\r\n', '\r\n'],
    // As the editor wrote it before (build 10): the blank line in the style of the first line
    // break.
    ['an LF first, a CRLF later and a blank line of LFs', '.\nTwo\r\nThree\n\n', '\n', '\n'],
    // The body's CRLFs since taken away.
    ['a blank line of CRLFs over a body of LFs', '.\nTwo\nThree\r\n\r\n', '\r\n', '\n'],
  ])('leaves a blank line in front of the ledger as it is: %s', (_, front, eol, last) => {
    // The ledger is written again for the edit, in place; its blank line is untouched bytes, which
    // the command line's rewrite leaves too (format §9.2).
    const ledger = [
      '<!-- redlines',
      "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.",
      'version: 1',
      'people:',
      '  ada: {name: Ada Lovelace}',
      'marks:',
      '  k3x9: {by: ada, at: 2026-11-05T10:00Z}',
      '-->',
    ].join(eol);
    const file = `Hello <!--sub k3x9 world-->there<!--/k3x9-->${front}${ledger}${last}`;
    const at = file.indexOf('Two');
    const ctx = { author, time: '2026-11-05T10:00Z', random: idBytes('w8nn') };
    const written = applyChanges(
      file,
      trackedEdit(file, { from: at, to: at + 3, insert: 'Deux' }, ctx),
    );
    // The command line keeps the blank line, and writes the ledger's lines in the body's style.
    const blank = front.slice(front.indexOf('Three') + 'Three'.length);
    expect(written.slice(0, written.indexOf('<!-- redlines')).endsWith(`Three${blank}`)).toBe(true);
    const editor = tracked(file, 'w8nn');
    const from = editor.view.state.doc.toString().indexOf('Two');
    editor.view.dispatch({ selection: { anchor: from, head: from + 3 } });
    editor.view.dispatch(editor.view.state.replaceSelection('Deux'), { userEvent: 'input.type' });
    expect(editor.getDoc()).toBe(written);
  });
});

describe('undo and line breaks', () => {
  it('gives back the exact text when your undo brings back a line break of the other style', () => {
    // Typed first, so that the undo doesn't go all the way back to the file as it was given.
    const crlfFirst = load('one\r\ntwo\nthree\n');
    type(crlfFirst, 'one'.length, '!');
    const lf = 'one!\ntwo'.length;
    crlfFirst.view.dispatch({ changes: { from: lf, to: lf + 1 }, userEvent: 'delete.backward' });
    expect(crlfFirst.getDoc()).toBe('one!\r\ntwothree\n');
    expect(undo(crlfFirst.view)).toBe(true);
    expect(crlfFirst.getDoc()).toBe('one!\r\ntwo\nthree\n');
    expect(redo(crlfFirst.view)).toBe(true);
    expect(crlfFirst.getDoc()).toBe('one!\r\ntwothree\n');
    expect(undo(crlfFirst.view)).toBe(true);
    expect(crlfFirst.getDoc()).toBe('one!\r\ntwo\nthree\n');

    const lfFirst = load('one\ntwo\r\nthree\n');
    type(lfFirst, 'one'.length, '!');
    const crlf = 'one!\ntwo'.length;
    lfFirst.view.dispatch({ changes: { from: crlf, to: crlf + 1 }, userEvent: 'delete.backward' });
    expect(lfFirst.getDoc()).toBe('one!\ntwothree\n');
    expect(undo(lfFirst.view)).toBe(true);
    expect(lfFirst.getDoc()).toBe('one!\ntwo\r\nthree\n');
    expect(redo(lfFirst.view)).toBe(true);
    expect(lfFirst.getDoc()).toBe('one!\ntwothree\n');
  });

  const claude = { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' };

  /** A file with a thread, its lines joined by LF. */
  const BASE = [
    '# Plan',
    '',
    'We ship in <!--cmt c8d2-->spring<!--/c8d2-->.',
    '',
    'Notes:',
    'first',
    'second',
    '',
    'Then we rest.',
    '',
    '<!-- redlines',
    'version: 1',
    'people:',
    '  ada: {name: Ada Lovelace}',
    'comments:',
    '  c8d2:',
    '    by: ada',
    '    at: 2026-11-01T09:00Z',
    '    text: Which spring?',
    '-->',
    '',
  ].join('\n');
  const ledgerAt = BASE.indexOf('<!-- redlines');
  const files: [string, string][] = [
    ['LF', BASE],
    ['CRLF', BASE.replaceAll('\n', '\r\n')],
    ['mixed', BASE.replace('# Plan\n', '# Plan\r\n').replace('first\n', 'first\r\n')],
    ['a CR alone', BASE.replace('first\nsecond', 'first\rsecond')],
    [
      'a ledger after a CRLF blank line',
      `${BASE.slice(0, ledgerAt - 1)}\r\n${BASE.slice(ledgerAt)}`,
    ],
  ];

  /** `file` with a line added after its first line, in CRLF, and Claude's reply to the thread. */
  function added(file: string, line: string, text: string): string {
    const end = file.search(/\r\n?|\n/);
    const breakLength = file.startsWith('\r\n', end) ? 2 : 1;
    const withLine = `${file.slice(0, end + breakLength)}${line}\r\n${file.slice(end + breakLength)}`;
    return applyChanges(
      withLine,
      reply(withLine, 'c8d2', text, { author: claude, time: '2026-11-01T10:00Z' }),
    );
  }

  /** A state with the history and `file` loaded, and a way to step it on. */
  function editing(file: LoadedFile) {
    let state = EditorState.create({
      doc: file.doc,
      extensions: [history(), parsedField, file.extension],
    });
    const dispatch = (tr: Transaction) => (state = tr.state);
    return {
      get text() {
        return fileText(state);
      },
      /** Makes the document `next`'s, as a reload or an agent's edit does. */
      change(next: LoadedFile, spec: TransactionSpec = {}) {
        const changes = lineChanges(state.doc.toString(), next.doc.toString());
        state = state.update({ changes, effects: next.effects }, spec).state;
      },
      undo: () => undo({ state, dispatch }),
      redo: () => redo({ state, dispatch }),
    };
  }

  it('takes back a change of file with its line breaks, and brings it back', () => {
    const a = loadFile(files[2]![1]);
    const b = loadFile(added(a.text, 'Added.', 'Spring of 2027.'));
    expect(b.text).not.toBe(a.text);
    const editor = editing(a);
    editor.change(b);
    expect(editor.text).toBe(b.text);
    expect(editor.undo()).toBe(true);
    expect(editor.text).toBe(a.text);
    expect(editor.redo()).toBe(true);
    expect(editor.text).toBe(b.text);
  });

  /** `a` to `b` to `c`, joined into one step of Claude's: undone and redone, exactly. */
  function joinedChanges(file: string): void {
    const a = loadFile(file);
    const b = loadFile(added(a.text, 'Added.', 'Spring of 2027.'));
    const c = loadFile(added(b.text, 'Added again.', 'Or the one after.'));
    const editor = editing(a);
    const step = agentStep.of({ group: 'run-1', agent: 'Claude' });
    editor.change(b, { annotations: step });
    expect(editor.text).toBe(b.text);
    editor.change(c, { annotations: step });
    expect(editor.text).toBe(c.text);
    expect(editor.undo()).toBe(true);
    expect(editor.text).toBe(a.text);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.text).toBe(c.text);
    expect(editor.redo()).toBe(false);
  }

  it('gives back the file from before the first of two joined changes of file', () => {
    joinedChanges(files[2]![1]);
  });

  it.each(files)('is exact for %s', (_, file) => {
    expect(parse(file).ledger.comments).toHaveLength(1);
    joinedChanges(file);
  });
});
