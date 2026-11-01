// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from './index.ts';

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
