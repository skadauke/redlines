// @vitest-environment happy-dom
// Table operations as intents (multiuser §4.2): Tab out of the last cell adds a row, and the
// operation is recorded with how the format wrote it. Deriving the record on the text it was made
// on gives what the key wrote, Track Changes on and off; and the format itself is called with what
// it was before, so the table suites that pin the bytes still hold.
import { forceParsing } from '@codemirror/language';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { applyChanges } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, editSourceFacet, type Editor, intentOf } from '../index.ts';
import type { TableIntent } from './intent.ts';
import { deriveTable, writeTable } from './intent.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** A source with a stream of its own, to give ids that differ. */
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

const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n';

function mount(tracking: boolean) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const seen: { before: string; after: string; intent: TableIntent }[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    extensions: [
      editSourceFacet.of({ now: () => new Date('2026-11-17T10:00:30Z'), random: source() }),
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          const intent = intentOf(tr);
          if (intent?.kind === 'table') {
            seen.push({
              before: tr.startState.doc.toString(),
              after: tr.state.doc.toString(),
              intent,
            });
          }
        }
      }),
    ],
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: doc.indexOf('2 |') + 1 } });
  return { editor, seen };
}

describe.each([true, false])('Tab out of the last cell, Track Changes %s', (tracking) => {
  it('records the operation, and deriving it gives the row the key wrote', () => {
    const { editor, seen } = mount(tracking);
    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      'editor',
    );
    expect(seen).toHaveLength(1);
    const { before, after, intent } = seen[0]!;
    expect(intent.op.kind).toBe('insertRows');
    expect(intent.tracking).toBe(tracking);
    expect(intent.author?.handle).toBe('ada');
    expect(applyChanges(before, deriveTable(before, intent).changes)).toBe(after);
    expect(deriveTable(before, intent).changes).toEqual(deriveTable(before, intent).changes);
  });
});

describe('writing a table operation', () => {
  const ada = { handle: 'ada', name: 'Ada Lovelace' };
  const time = '2026-11-17T10:00Z';
  const op = { kind: 'insertRows', table: 0, after: 1, count: 2 } as const;

  it.each(['tableEdit', 'fine', 'asked'] as const)('derives the %s writer again', (writer) => {
    const first = writeTable(doc, {
      tracking: true,
      op,
      writer,
      author: ada,
      time,
      random: source(),
    });
    const intent = { ...first.intent, id: 'x' };
    expect(deriveTable(doc, intent)).toEqual(first.edit);
  });

  it('writes many rows under one group, and derives them again', () => {
    const first = writeTable(doc, {
      tracking: true,
      op,
      group: 'g3g3',
      author: ada,
      time,
      random: source(),
    });
    expect(first.edit.changes.map((c) => c.insert).join('')).toContain('g3g3');
    expect(deriveTable(doc, { ...first.intent, id: 'x' })).toEqual(first.edit);
  });

  it('derives an untracked operation', () => {
    const first = writeTable(doc, { tracking: false, op, author: ada, time: '', random: source() });
    expect(first.intent.time).toBe('');
    expect(deriveTable(doc, { ...first.intent, id: 'x' })).toEqual(first.edit);
  });

  it('draws past an id that is taken on newer text', () => {
    const first = writeTable(doc, { tracking: true, op, author: ada, time, random: source() });
    const id = /<!--ins (\w+)-->/.exec(first.edit.changes.map((c) => c.insert).join(''))?.[1];
    if (!id) return;
    const newer = `${doc}\nTaken: ${id}\n`;
    const edit = deriveTable(newer, { ...first.intent, id: 'x' });
    expect(edit.changes.map((c) => c.insert).join('')).not.toContain(`<!--ins ${id}-->`);
  });

  it('needs an author when tracked', () => {
    expect(() => writeTable(doc, { tracking: true, op, author: null, time })).toThrow(TypeError);
  });
});
