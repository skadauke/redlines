// @vitest-environment happy-dom
// Copy and paste in the welcome document (design §5.10). What is copied in Clean and Redlines is
// the text as it reads, and a paste never creates marks from the clipboard's content: pasted text
// is the paster's own, whether Track Changes is on or off.

import { createEditor, type Editor } from '@redlines/editor';
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import sample from './sample.md?raw';

const ada = { handle: 'ada', name: 'Ada Lovelace', email: 'ada@example.org' };
const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function open(tracking: boolean, notices: string[] = []): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: sample,
    author: ada,
    tracking,
    onNotice: (message) => notices.push(message),
  });
  editors.push(editor);
  return editor;
}

/** What ⌘C puts on the clipboard for the text from `from` to `to`. */
async function copy(editor: Editor, from: number, to: number): Promise<string> {
  editor.view.dispatch({ selection: { anchor: from, head: to } });
  // CodeMirror copies its own selection, once the page's is in the editor.
  document.getSelection()?.selectAllChildren(editor.view.contentDOM);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const clipboardData = new DataTransfer();
  editor.view.contentDOM.dispatchEvent(
    new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }),
  );
  return clipboardData.getData('text/plain');
}

/** ⌘V of `text` at `at`. */
function paste(editor: Editor, at: number, text: string): void {
  editor.view.dispatch({ selection: { anchor: at } });
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  editor.view.contentDOM.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
  );
}

const segmentsOf = (editor: Editor, id: string) =>
  editor.getParsed().marks.find((mark) => mark.id === id)?.segments.length;
const newest = (editor: Editor) => newestView(editor.getDoc()).text;

describe('copy and paste in the welcome document', () => {
  for (const tracking of [true, false]) {
    it(`copies text across a change as it reads, and pastes it with Track Changes ${tracking ? 'on' : 'off'}`, async () => {
      const notices: string[] = [];
      const editor = open(tracking, notices);
      const text = editor.view.state.doc.toString();
      const copied = await copy(editor, text.indexOf('The changes'), text.indexOf(' live inside'));
      expect(copied).toBe('The changes and comments');

      paste(editor, editor.view.state.doc.toString().indexOf('Each person'), `${copied} `);
      expect(notices).toEqual([]);
      expect(newest(editor)).toContain('\n\nThe changes and comments Each person’s changes');
      // The copied change keeps its one segment: the paste joined nothing.
      expect(segmentsOf(editor, 'k3x9')).toBe(1);
      expect(editor.getParsed().warnings).toEqual([]);
    });
  }

  it('pastes text copied with its markers as plain text, which rejecting the change leaves', () => {
    const editor = open(false);
    const text = editor.view.state.doc.toString();
    // What the clipboard held before: the source, with the change's hidden markers.
    const copied = text.slice(text.indexOf('The changes'), text.indexOf(' live inside'));
    expect(copied).toContain('<!--ins k3x9-->');
    paste(editor, text.indexOf('## Try it'), `${copied}\n\n`);
    expect(segmentsOf(editor, 'k3x9')).toBe(1);
    editor.reject('k3x9');
    expect(newest(editor)).toContain('\n\nThe changes and comments\n\n## Try it');
  });

  it('leaves the text a change deleted out of a copy in Clean', async () => {
    const editor = open(false);
    editor.setViewMode('clean');
    const text = editor.view.state.doc.toString();
    const copied = await copy(editor, text.indexOf('anywhere'), text.indexOf('Each person'));
    expect(copied).toBe('anywhere and merges in git.\n\n');
    expect(copied).not.toContain('nothing else to install');
  });
});
