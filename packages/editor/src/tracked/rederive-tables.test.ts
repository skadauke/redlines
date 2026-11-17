// @vitest-environment happy-dom
// Steps and widened-paste intents placed again on newer text (multiuser §4.2): the table is found
// by its header's words, wherever another person's edit moved it, and a table that is gone is said.
import { forceParsing } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { applyChanges, newestView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import {
  anchorPaste,
  createEditor,
  editSourceFacet,
  intentOf,
  rederivePaste,
  rederiveSteps,
} from '../index.ts';
import type { Editor, Intent } from '../index.ts';
import { plainPastes } from './clipboard.ts';

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

function mount(doc: string, caret = 0) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const seen: { before: string; intent: Intent }[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking: true,
    extensions: [
      editSourceFacet.of({ now: () => new Date('2026-11-17T10:00:30Z'), random: source() }),
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          const intent = intentOf(tr);
          if (intent) seen.push({ before: tr.startState.doc.toString(), intent });
        }
      }),
    ],
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: caret } });
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

/** The editor's state with `doc` as its text, as a window holds the newest confirmed text. */
function stateOf(doc: string): EditorState {
  return mount(doc).editor.view.state;
}

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n';

describe('a paste over cells that adds rows and columns (steps), on newer text', () => {
  it('is placed in the table where it moved to', () => {
    const { editor, seen } = mount(TABLE, TABLE.indexOf('2 |'));
    paste(editor, 'p\tq\nr\ts');
    const { before, intent } = seen[0]!;
    expect(intent.kind).toBe('steps');
    if (intent.kind !== 'steps') return;
    const newer = `Intro.\n\nMore.\n\n${before}`;
    const state = stateOf(newer);
    const done = rederiveSteps(state, before, intent);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.notices).toEqual([]);
    const text = applyChanges(
      newer,
      (() => {
        const list: { from: number; to: number; insert: string }[] = [];
        done.changes.iterChanges((from, to, _a, _b, inserted) =>
          list.push({ from, to, insert: inserted.toString() }),
        );
        return list;
      })(),
    );
    expect(parse(text).warnings).toEqual([]);
    expect(text.startsWith('Intro.\n\nMore.\n\n| a |')).toBe(true);
    const shown = newestView(text).text;
    for (const cell of ['p', 'q', 'r', 's']) expect(shown).toContain(cell);
  });
});

describe('a widened paste, on newer text', () => {
  const LEDGER =
    '\n<!-- redlines\nversion: 1\nmarks:\n  g5nb: {by: bo, at: 2026-11-01T10:00Z}\n-->\n';
  const CELL = `| a | c |\n| - | - |\n| 11 | 13 |\n| 21 | 23 |\n\n<!--del g5nb col=2 b\\n-\\n12\\n22-->\n${LEDGER}`;

  function made() {
    const { editor, seen } = mount(CELL, CELL.indexOf('21') + 1);
    paste(editor, 'x\ty\nz\tw\nu\tv');
    const { before, intent } = seen[0]!;
    if (intent.kind !== 'widened-paste') throw new Error(`not a widened paste: ${intent.kind}`);
    return { before, intent };
  }

  it('is made in the table where it moved to', () => {
    const { before, intent } = made();
    const newer = `Intro.\n\n${before}`;
    const done = rederivePaste(stateOf(newer), anchorPaste(before, intent));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.notices).toEqual([]);
    const text = done.changes.apply(stateOf(newer).doc).toString();
    expect(text.startsWith('Intro.\n\n')).toBe(true);
    expect(text).toContain('<!--sub ');
    for (const cell of ['x', 'y', 'z', 'w', 'u', 'v']) expect(text).toContain(cell);
  });

  it('says that the table is gone, and writes nothing', () => {
    const { before, intent } = made();
    const state = stateOf('Someone deleted the table.\n');
    const done = rederivePaste(state, anchorPaste(before, intent));
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.changes.empty).toBe(true);
    expect(done.notices.join(' ')).toMatch(/was not made/);
  });
});
