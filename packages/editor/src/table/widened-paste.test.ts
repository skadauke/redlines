// @vitest-environment happy-dom
// A paste over cells that the format widens, as an intent (multiuser §4.2): where another person's
// change is pending in the table, the rows and columns the paste needs can't be added by the
// table's own rules, and the table is replaced with the paste made in it. The widened write is
// recorded as what it was, and deriving the record again on the text it was made on gives the same
// document, ids and all; recording changes nothing in the document.
import { forceParsing } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { applyChanges } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEditor,
  deriveWidenedPaste,
  editSourceFacet,
  type Editor,
  type Intent,
  intentOf,
} from '../index.ts';
import { plainPastes } from '../tracked/clipboard.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const source = () => {
  let a = 20261117;
  return (n: number) =>
    Uint8Array.from({ length: n }, () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) & 0xff;
    });
};

const LEDGER =
  '\n<!-- redlines\nversion: 1\nmarks:\n  g5nb: {by: bo, at: 2026-11-01T10:00Z}\n-->\n';
// A column that Bo deleted: the table's own rules can't add rows beside it.
const CELL = `| a | c |\n| - | - |\n| 11 | 13 |\n| 21 | 23 |\n\n<!--del g5nb col=2 b\\n-\\n12\\n22-->\n${LEDGER}`;

function mount(doc: string, record = true) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const seen: { before: string; after: string; intent: Intent }[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking: true,
    extensions: [
      editSourceFacet.of({ now: () => new Date('2026-11-17T10:00:30Z'), random: source() }),
      ...(record
        ? [
            EditorView.updateListener.of((update) => {
              for (const tr of update.transactions) {
                const intent = intentOf(tr);
                if (intent) {
                  seen.push({
                    before: tr.startState.doc.toString(),
                    after: tr.state.doc.toString(),
                    intent,
                  });
                }
              }
            }),
          ]
        : []),
    ],
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: doc.indexOf('21') + 1 } });
  seen.length = 0;
  return { editor, seen };
}

function paste(editor: Editor, text: string) {
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
  plainPastes.delete(event);
  editor.view.contentDOM.dispatchEvent(event);
}

describe('a paste that needs rows while another person has deleted a column', () => {
  const pasted = 'x\ty\nz\tw\nu\tv';

  it('records the widened write, and deriving it again gives the document', () => {
    const { editor, seen } = mount(CELL);
    paste(editor, pasted);
    expect(seen).toHaveLength(1);
    const { before, after, intent } = seen[0]!;
    expect(intent.kind).toBe('widened-paste');
    if (intent.kind !== 'widened-paste') return;
    expect(after).not.toBe(before);
    expect(intent.author.handle).toBe('ada');
    expect(intent.time).toBe('2026-11-17T10:00Z');
    expect(intent.paste.range).toEqual([
      ['x', 'y'],
      ['z', 'w'],
      ['u', 'v'],
    ]);
    expect(after).toContain('<!--sub ');
    expect(applyChanges(before, deriveWidenedPaste(before, intent))).toBe(after);
    expect(deriveWidenedPaste(before, intent)).toEqual(deriveWidenedPaste(before, intent));
  });

  it('leaves the same text as a run that records nothing', () => {
    const recorded = mount(CELL);
    paste(recorded.editor, pasted);
    const plain = mount(CELL, false);
    paste(plain.editor, pasted);
    expect(recorded.editor.getDoc()).toBe(plain.editor.getDoc());
  });
});
