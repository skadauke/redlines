// @vitest-environment happy-dom
// A selection that covers exactly one whole table (#471): ⌫, ⌦ and Cut delete it with Delete Table's
// rules (format §3.7, rule 6), as the operation does: another person's pending change in it is named
// in the refusal, your own are folded into the deletion, a comment becomes a point comment.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { deleteTable } from './ops.ts';

const open: Editor[] = [];
const notices: string[] = [];
afterEach(() => {
  notices.length = 0;
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, tracking: boolean): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    onNotice: (message) => notices.push(message),
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}
const press = (editor: Editor, key: string) => {
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return runScopeHandlers(
    editor.view,
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    'editor',
  );
};

const TABLE = '| a | b |\n| - | - |\n| 11 | 12 |\n| 21 | 22 |';
const LEDGER = (body: string) =>
  `\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\n${body}-->\n`;
const MARKS = '  m2bd: {by: bo, at: 2026-11-01T10:00Z}\n';
const marks = (body: string) => LEDGER(`marks:\n${body}`);

/** The file with the ids that were made at random numbered in the order they appear. */
function numbered(doc: string): string {
  const ids = [...doc.matchAll(/<!--(?:del|ins|sub|\/ins|\/del|\/sub) ([a-z0-9]{4})\b/g)].map(
    (m) => m[1] as string,
  );
  let out = doc;
  [...new Set(ids)].forEach((id, n) => {
    out = out.replaceAll(id, `id${n}`);
  });
  return out;
}

interface Shape {
  name: string;
  doc: string;
}
const shapes: Shape[] = [
  { name: 'a plain table', doc: `Intro.\n\n${TABLE}\n\nAfter.\n` },
  {
    name: 'Bo’s inserted row',
    doc: `Intro.\n\n${TABLE}\n| <!--ins m2bd row-->31 | 32 |\n\nAfter.\n${marks(MARKS)}`,
  },
  {
    name: 'Bo’s typed cell',
    doc: `Intro.\n\n| a | b |\n| - | - |\n| 11 | 1<!--ins m2bd-->x<!--/ins m2bd-->2 |\n\nAfter.\n${marks(MARKS)}`,
  },
  {
    name: 'Ada’s own pending row',
    doc: `Intro.\n\n${TABLE}\n| <!--ins m2ad row-->31 | 32 |\n\nAfter.\n${marks('  m2ad: {by: ada, at: 2026-11-01T10:00Z}\n')}`,
  },
  {
    name: 'a comment',
    doc: `Intro.\n\n| a | b |\n| - | - |\n| 11 | <!--cmt c8d2-->12 |\n\nAfter.\n${LEDGER('comments:\n  c8d2:\n    by: bo\n    at: 2026-11-01T10:00Z\n    text: |-\n      Why?\n')}`,
  },
];

describe('a selection over exactly one whole table', () => {
  for (const tracking of [false, true]) {
    for (const key of ['Backspace', 'Delete', 'Cut']) {
      for (const shape of shapes) {
        it(`${key} does what Delete Table does: ${shape.name}, Track Changes ${tracking ? 'on' : 'off'}`, () => {
          const start = shape.doc.indexOf('| a');
          const table = shape.doc.slice(start).split('\n\n')[0] as string;
          const reference = mount(shape.doc, tracking);
          reference.view.dispatch({ selection: { anchor: start + 2 } });
          deleteTable(reference.view);
          const wanted = { doc: numbered(reference.getDoc()), notices: [...notices] };
          notices.length = 0;
          const editor = mount(shape.doc, tracking);
          editor.view.dispatch({ selection: { anchor: start, head: start + table.length } });
          if (key === 'Cut') {
            // What the browser's cut makes of the selection.
            const { from, to } = editor.view.state.selection.main;
            editor.view.dispatch({ changes: { from, to }, userEvent: 'delete.cut' });
          } else press(editor, key);
          expect({ doc: numbered(editor.getDoc()), notices }).toEqual(wanted);
          expect(editor.getDoc()).not.toBe(shape.doc);
        });
      }
    }
  }
});
