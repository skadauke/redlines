// @vitest-environment happy-dom
// Format commands as intents (multiuser §4.2): Bold, a heading and a list indent each record what
// was asked, and deriving the record on the text it was made on gives the changes the command
// wrote, byte for byte. Recording changes no document: the formatting suites pin the bytes.
import { forceParsing } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import {
  createEditor,
  deriveFormat,
  editSourceFacet,
  type Editor,
  type FormatIntent,
  intentOf,
} from '@redlines/editor';
import { applyChanges } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: (() => void)[] = [];

afterEach(() => {
  for (const close of open.splice(0)) close();
  document.body.replaceChildren();
});

/** An editor with formatting, and the format intents its transactions carry, with their text. */
function mount(doc: string, tracking: boolean) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const seen: { before: string; after: string; intent: FormatIntent }[] = [];
  const editor = createEditor(parent, {
    doc,
    author,
    tracking,
    extensions: [
      editSourceFacet.of({ now: () => new Date(), random: source() }),
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          const intent = intentOf(tr);
          if (intent?.kind === 'format') {
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
  const remove = createFormatting(editor, { author, notice: () => undefined });
  open.push(() => {
    remove();
    editor.destroy();
  });
  return { editor, seen };
}

/** A seeded source of random bytes, so that the ids of a write can be written again. */
function source() {
  let a = 20261117;
  return (n: number) =>
    Uint8Array.from({ length: n }, () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) & 0xff;
    });
}

function select(editor: Editor, anchor: number, head = anchor): void {
  editor.view.dispatch({ selection: { anchor, head } });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
}

describe.each([true, false])('a format command, Track Changes %s', (tracking) => {
  it.each([
    ['bold', 'One two three.\n', 4, 7, 'format.bold'],
    ['a heading', 'One two three.\n\nNext.\n', 2, 2, 'block.h2'],
    ['a quote', 'One two three.\n\nNext.\n', 18, 18, 'block.quote'],
  ])('records %s, and deriving it gives what the command wrote', (_, doc, from, to, command) => {
    const { editor, seen } = mount(doc, tracking);
    select(editor, from, to);
    expect(editor.commands.run(command)).toBe(true);
    expect(seen).toHaveLength(1);
    const { before, after, intent } = seen[0]!;
    expect(intent.tracking).toBe(tracking);
    expect(intent.author?.handle).toBe('ada');
    expect(applyChanges(before, deriveFormat(before, intent))).toBe(after);
  });
});

describe('a format intent', () => {
  it('carries its target, not a toggle', () => {
    const { editor, seen } = mount('One two three.\n', true);
    select(editor, 4, 7);
    editor.commands.run('format.bold');
    expect(seen[0]!.intent.op).toEqual({ kind: 'inline', format: 'bold', on: true });
    expect(seen[0]!.intent.ranges).toEqual([{ from: 4, to: 7 }]);
  });

  it('is derived the same each time, ids and all', () => {
    const { editor, seen } = mount('One two three.\n', true);
    select(editor, 4, 7);
    editor.commands.run('format.bold');
    const { before, intent } = seen[0]!;
    const a = deriveFormat(before, intent);
    expect(deriveFormat(before, intent)).toEqual(a);
  });

  it('is derived again on newer text, over the words it was asked of', () => {
    const { editor, seen } = mount('One two three.\n', true);
    select(editor, 4, 7);
    editor.commands.run('format.bold');
    const { intent } = seen[0]!;
    // Someone added a word before: the same words are at other offsets.
    const newer = 'Zero One two three.\n';
    const changes = deriveFormat(newer, intent, [{ from: 9, to: 12 }]);
    expect(applyChanges(newer, changes)).toMatch(/<!--fmt \w+ \+bold-->\*\*two\*\*<!--\/\w+-->/);
  });

  it('is recorded for a list item indented with Tab', () => {
    const { editor, seen } = mount('- one\n- two\n', true);
    select(editor, 8);
    editor.commands.run('block.indent');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.intent.op).toEqual({ kind: 'indent', by: 1 });
    const { before, after, intent } = seen[0]!;
    expect(applyChanges(before, deriveFormat(before, intent))).toBe(after);
  });
});
