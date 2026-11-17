// @vitest-environment happy-dom
// Intents of the typing family (multiuser §4.2): the tracking filter records what it was given
// beside what it wrote, and deriving the record on the text it was made on gives the same changes,
// ids and all. Recording changes no document: the existing typing suites pin its bytes, and the
// golden below pins one by hand.
import type { ChangeSet, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { intentOf, type Intent, type TypingIntent } from './intent.ts';
import { deriveIntent, editSourceFacet } from './typing.ts';

/** A random source that gives the bytes of the id `b2b2`, over and over. */
const randomFor = (id: string) => {
  const first = 'bcdfghjkmnpqrstvwxz';
  const rest = 'bcdfghjkmnpqrstvwxz23456789';
  const bytes = [...id].map((char, i) => (i === 0 ? first : rest).indexOf(char));
  let at = 0;
  return (n: number) => Uint8Array.from({ length: n }, () => bytes[at++ % bytes.length] ?? 0);
};

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** One edit as the tracking filter saw it: the state it started from, its intent, its changes. */
interface Seen {
  start: EditorState;
  intent: Intent;
  changes: ChangeSet;
}

function made(
  doc: string,
  tracking: boolean,
  random: ((n: number) => Uint8Array) | null = randomFor('b2b2'),
) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const seen: Seen[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    extensions: [
      editSourceFacet.of({
        now: () => new Date('2026-11-01T10:00:30Z'),
        ...(random ? { random } : {}),
      }),
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          const intent = intentOf(tr);
          if (intent) seen.push({ start: tr.startState, intent, changes: tr.changes });
        }
      }),
    ],
  });
  open.push(editor);
  return { editor, seen };
}

const type = (editor: Editor, from: number, to: number, insert: string) =>
  editor.view.dispatch({ changes: { from, to, insert }, userEvent: 'input.type' });

const json = (changes: ChangeSet) => JSON.stringify(changes.toJSON());
const typing = (intent: Intent): TypingIntent => {
  if (intent.kind !== 'typing') throw new Error(`a ${intent.kind} intent`);
  return intent;
};

describe('a recorded edit', () => {
  it('leaves the document as the format writes it, byte for byte', () => {
    const { editor } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    // Golden: the marker, then the ledger the first tracked edit writes (format §2, §5).
    expect(editor.view.state.doc.toString()).toBe(
      [
        'Hello<!--ins b2b2--> there<!--/b2b2--> world',
        '',
        '<!-- redlines',
        "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.",
        'version: 1',
        'people:',
        '  ada: {name: Ada Lovelace}',
        'marks:',
        '  b2b2: {by: ada, at: 2026-11-01T10:00Z}',
        '-->',
        '',
      ].join('\n'),
    );
  });

  it('carries who, when, the edits and the bytes of the ids', () => {
    const { editor, seen } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    expect(seen).toHaveLength(1);
    const intent = typing(seen[0]!.intent);
    expect(intent.kind).toBe('typing');
    expect(intent.tracking).toBe(true);
    expect(intent.author?.handle).toBe('ada');
    expect(intent.time).toBe('2026-11-01T10:00Z');
    expect(intent.edits.map(({ from, to, insert }) => ({ from, to, insert }))).toEqual([
      { from: 5, to: 5, insert: ' there' },
    ]);
    expect(intent.drawn.length).toBeGreaterThan(0);
  });

  it('is recorded with Track Changes off too, with no time', () => {
    const { editor, seen } = made('Hello world\n', false);
    type(editor, 5, 11, ' there');
    expect(seen).toHaveLength(1);
    const intent = typing(seen[0]!.intent);
    expect(intent.tracking).toBe(false);
    expect(intent.time).toBe('');
    expect(deriveIntent(seen[0]!.start, intent).empty).toBe(false);
  });
});

describe('text composed by an input method', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  const composing = (editor: Editor, on: boolean) => {
    (editor.view as unknown as { inputState: { composing: number } }).inputState.composing = on
      ? 1
      : -1;
  };

  it.each([true, false])(
    'is recorded when it ends, Track Changes %s, and derives',
    async (tracking) => {
      const doc = 'Gruss aus Kln.\n';
      const at = doc.indexOf('ln.');
      const { editor, seen } = made(doc, tracking);
      composing(editor, true);
      editor.view.dispatch({
        changes: { from: at, to: at, insert: '¨' },
        selection: { anchor: at + 1 },
        userEvent: 'input.type.compose.start',
      });
      editor.view.dispatch({
        changes: { from: at, to: at + 1, insert: 'ö' },
        selection: { anchor: at + 1 },
        userEvent: 'input.type.compose',
      });
      await tick();
      composing(editor, false);
      editor.view.contentDOM.dispatchEvent(new Event('compositionend', { bubbles: true }));
      await tick();
      const one = seen.find((s) => typing(s.intent).revert);
      // With Track Changes off the text goes in as composed, and no step is written to record.
      if (!tracking) {
        expect(one).toBeUndefined();
        expect(editor.view.state.doc.toString()).toBe('Gruss aus Köln.\n');
        return;
      }
      expect(one).toBeDefined();
      expect(json(deriveIntent(one!.start, typing(one!.intent)))).toBe(json(one!.changes));
    },
  );
});

describe('deriving an intent', () => {
  const steps: [string, number, number, string][] = [
    ['typing', 5, 5, ' there'],
    ['deleting', 0, 5, ''],
    ['replacing', 6, 11, 'moon'],
    ['a line break', 5, 5, '\n'],
  ];

  it.each([true, false])('gives the changes the filter wrote, Track Changes %s', (tracking) => {
    for (const [, from, to, insert] of steps) {
      const { editor, seen } = made('Hello world\n', tracking);
      type(editor, from, to, insert);
      const one = seen.at(-1)!;
      expect(json(deriveIntent(one.start, typing(one.intent)))).toBe(json(one.changes));
    }
  });

  it('gives the same changes each time, and the same ids', () => {
    const { editor, seen } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const { start, intent } = seen[0]!;
    const first = json(deriveIntent(start, typing(intent)));
    expect(json(deriveIntent(start, typing(intent)))).toBe(first);
    expect(first).toContain('b2b2');
  });

  it('draws past an id that is taken on newer text, the same way each time', () => {
    const { editor, seen } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const { intent } = seen[0]!;
    // The id the edit drew is in the newer text already, as someone else's.
    const { editor: other } = made('Hello world b2b2\n', true);
    const state = other.view.state;
    const a = json(deriveIntent(state, typing(intent)));
    expect(json(deriveIntent(state, typing(intent)))).toBe(a);
    expect(a).not.toContain('<!--ins b2b2-->');
  });

  it('derives an edit made with the system source, the same each time', () => {
    const { editor, seen } = made('Hello world\n', true, null);
    type(editor, 5, 5, ' there');
    const { start, intent } = seen[0]!;
    expect(typing(intent).drawn).toEqual([]);
    const a = json(deriveIntent(start, typing(intent)));
    expect(json(deriveIntent(start, typing(intent)))).toBe(a);
    expect(a).toContain('<!--ins ');
  });

  it('covers every edit of random typing, tracked and not', () => {
    // A few hundred edits at seeded places in two documents.
    let a = 20261117;
    const next = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const bytes = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(next() * 256));
    const typings = ['x', 'ab', ' ', ', ', 'new text', '', ''];
    let checked = 0;
    for (const tracking of [true, false]) {
      for (const doc of [
        'One two three.\n\n- alpha\n- beta\n',
        '# Title\n\nFirst para, with words.\n\n> a quote\n',
      ]) {
        for (let session = 0; session < 10; session++) {
          const { editor, seen } = made(doc, tracking, bytes);
          for (let step = 0; step < 6; step++) {
            const length = editor.view.state.doc.length;
            const x = Math.floor(next() * (length + 1));
            const y = Math.min(length, x + Math.floor(next() * 4));
            const text = typings[Math.floor(next() * typings.length)]!;
            if (x === y && text === '') continue;
            const before = seen.length;
            type(editor, x, y, text);
            if (seen.length === before) continue; // Refused, or not rewritten: nothing recorded.
            const one = seen.at(-1)!;
            expect(json(deriveIntent(one.start, typing(one.intent)))).toBe(json(one.changes));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
