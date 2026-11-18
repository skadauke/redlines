// @vitest-environment happy-dom
// #924: a line break of the other kind that a tracked change takes out keeps its kind in the
// change's payload, and rejecting gives it back as it was.
import { acceptAll, applyChanges, parse, rejectAll, trackedEdit } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from './index.ts';
import { undo } from './history/index.ts';
import { editSourceFacet } from './tracked/typing.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const NOW = new Date('2026-11-05T10:00:30Z');
const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';
const idBytes = (...ids: string[]) => {
  const bytes = ids.flatMap((id) => [...id].map((c, i) => (i === 0 ? FIRST : REST).indexOf(c)));
  let at = 0;
  return (n: number) => Uint8Array.from(bytes.slice(at, (at += n)));
};
const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function tracked(doc: string): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const source = editSourceFacet.of({ now: () => NOW, random: idBytes('k3x9', 'w8nn') });
  const editor = createEditor(parent, { doc, author, tracking: true, extensions: [source] });
  open.push(editor);
  return editor;
}

const MIXED = [
  ['an LF in a CRLF file', 'Alpha\r\nbeta\ngamma\r\ndelta\r\n'],
  ['a CRLF in an LF file', 'Alpha\nbeta\r\ngamma\ndelta\n'],
  ['a CR alone in a CRLF file', 'Alpha\r\nbeta\rgamma\r\ndelta\r\n'],
  ['a CR alone among CRLFs and an LF', 'Alpha\r\nbeta\rgamma\ndelta\r\n'],
  ['an LF in a file of CRs', 'Alpha\rbeta\ngamma\rdelta\r'],
] as const;

describe.each(MIXED)('%s (#924)', (_, file) => {
  const from = file.indexOf('beta') + 2;
  const to = file.indexOf('gamma') + 2;
  const ctx = { author, time: '2026-11-05T10:00Z', random: idBytes('k3x9') };
  // What the command line writes, which reads the file's bytes.
  const written = applyChanges(file, trackedEdit(file, { from, to, insert: 'X' }, ctx));
  const lf = file.replace(/\r\n?/g, '\n');
  const docFrom = lf.indexOf('beta') + 2;
  const docTo = lf.indexOf('gamma') + 2;

  function replaced(): Editor {
    const editor = tracked(file);
    editor.view.dispatch({ selection: { anchor: docFrom, head: docTo } });
    editor.view.dispatch(editor.view.state.replaceSelection('X'), { userEvent: 'input.type' });
    return editor;
  }

  it('writes the break in its own kind when typing replaces it', () => {
    const editor = replaced();
    expect(editor.getDoc()).toBe(written);
    expect(applyChanges(written, rejectAll(written))).toBe(file);
    expect(parse(written).warnings).toEqual([]);
  });

  it('gives the file back byte for byte when the change is rejected, and accepts alike', () => {
    const editor = replaced();
    const accepted = applyChanges(written, acceptAll(written));
    editor.reject('k3x9');
    expect(editor.getDoc()).toBe(file);
    const other = replaced();
    other.accept('k3x9');
    expect(other.getDoc()).toBe(accepted);
  });

  /** An unrelated edit first, so that the editor's text is no longer the file as it was given. */
  const touched = (): Editor => {
    const editor = tracked(file);
    editor.view.dispatch({ changes: { from: 0, insert: 'Z' } });
    return editor;
  };
  const withZ = 'Z' + file;

  it('gives the break back in its own kind after an unrelated edit', () => {
    const editor = touched();
    editor.view.dispatch({ selection: { anchor: docFrom + 1, head: docTo + 1 } });
    editor.view.dispatch(editor.view.state.replaceSelection('X'), { userEvent: 'input.type' });
    const saved = editor.getDoc();
    expect(applyChanges(saved, rejectAll(saved))).toBe(withZ);
    editor.reject('k3x9');
    expect(editor.getDoc()).toBe(withZ);
    // Undo takes the rejection back, and the break's kind with the change, and the change back.
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe(saved);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDoc()).toBe(withZ);
  });

  it('writes the kind when Delete takes the break out, as the command line does', () => {
    const ctx2 = { author, time: '2026-11-05T10:00Z', random: idBytes('k3x9') };
    const breakAt = file.indexOf('beta') + 4;
    const len = file.startsWith('\r\n', breakAt) ? 2 : 1;
    const cli = applyChanges(
      file,
      trackedEdit(file, { from: breakAt, to: breakAt + len, insert: '' }, ctx2),
    );
    const editor = tracked(file);
    const at = lf.indexOf('beta') + 4;
    editor.view.dispatch({ changes: { from: at, to: at + 1 }, userEvent: 'delete.forward' });
    expect(editor.getDoc()).toBe(cli);
    editor.reject('k3x9');
    expect(editor.getDoc()).toBe(file);
  });

  it('writes the kind for pasted text over the break', () => {
    const editor = tracked(file);
    editor.view.dispatch({ selection: { anchor: docFrom, head: docTo } });
    const data = new DataTransfer();
    data.setData('text/plain', 'X');
    editor.view.contentDOM.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
    expect(editor.getDoc()).toBe(written);
  });

  it('keeps the kind through an agent edit written on the file, and its rejection', () => {
    const editor = tracked(file);
    editor.applyAgentEdit(written, { group: 'run-1', agent: 'Claude' });
    expect(editor.getDoc()).toBe(written);
    editor.reject('k3x9');
    expect(editor.getDoc()).toBe(file);
  });
});

describe('many deletions at once (#1057)', () => {
  // Eight or more deletions with room between them are written together, as a column of cells is.
  it.each([
    ['an LF in a CRLF file', '\r\n', '\n'],
    ['a CRLF in an LF file', '\n', '\r\n'],
  ])('names the kind of a break that one of them takes out: %s', (_, eol, other) => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i} here`);
    const file = lines.map((line, i) => line + (i === 3 ? other : eol)).join('');
    const lf = file.replace(/\r\n?/g, '\n');
    const ranges: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const at = lf.indexOf(`line ${i} here`);
      // Line 3's range runs from its end across the break into line 4.
      ranges.push(i === 3 ? [at + 10, at + 15] : [at + 1, at + 4]);
    }
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: file, author, tracking: true });
    open.push(editor);
    editor.view.dispatch({
      changes: ranges.filter((_, i) => i !== 4).map(([from, to]) => ({ from, to })),
      userEvent: 'delete.selection',
    });
    const saved = editor.getDoc();
    expect(saved).toContain('<!--del');
    expect(parse(saved).warnings).toEqual([]);
    expect(applyChanges(saved, rejectAll(saved))).toBe(file);
  });
});
