// @vitest-environment happy-dom
// Every write the editor and its plugins make, run on a sample document, records an intent
// (docs/research/multiuser.md §4.2): a command of the registry, every key that edits, typing and
// every kind of paste, Undo and Redo, an agent's edit, a reload, the file's own settings, Accept All
// and Stop Tracking. A session keeps each edit as its intent, so that it can be placed again on
// another window's newer text; an edit with none could only be kept as it is, or taken back. This
// test fails when any of them dispatches a document change with no intent, so that a new command
// can't miss one again. It is the wider sibling of `packages/editor/src/table/intent-gap.test.ts`,
// which pins what each intent derives; here, the plain writes also derive what they made.
//
// Not here: the review plugin's decisions, comments and highlights (their own intents, with the
// review guard), whose commands the test doesn't mount; and the find bar's replace, which is typing
// to Track Changes and takes the typing intent the same way (`input.replace`).
import { forceParsing } from '@codemirror/language';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import {
  createEditor,
  deriveIntent,
  intentOf,
  setImageAlt,
  setImageSrc,
  type Editor,
  type Intent,
} from '@redlines/editor';
import { createEmoji } from '@redlines/emoji';
import { createFind } from '@redlines/find';
import { createFormatting } from '@redlines/formatting';
import { createTables } from '@redlines/tables';
import { afterEach, describe, expect, it } from 'vitest';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: (() => void)[] = [];
afterEach(() => {
  for (const close of open.splice(0)) close();
  document.body.replaceChildren();
});

const DOC = `---
title: T
---

# Title

A paragraph with **bold** text and a [link](https://a.b) and ==mark== and :smile: -- ok "q".

> quoted line

- one
  - two
- three

1. first
2. second

- [ ] task

| a | b |
| - | - |
| 1 | 2 |

\`\`\`js
let x = 1;
\`\`\`

![alt](pic.png)

<img src="a.png" width="40">

Some <!--ins k3x9-->added<!--/k3x9--> and <!--del w2rf gone--> and <!--sub p7qd new-->old<!--/p7qd--> words.

Last paragraph here.

<!-- redlines
version: 1
people:
  ada: {name: Ada}
marks:
  k3x9: {by: ada, at: 2026-11-17T10:00Z}
  w2rf: {by: ada, at: 2026-11-17T10:00Z}
  p7qd: {by: ada, at: 2026-11-17T10:00Z}
-->
`;

function key(editor: Editor, name: string, mods: Partial<KeyboardEventInit> = {}) {
  runScopeHandlers(
    editor.view,
    new KeyboardEvent('keydown', { key: name, bubbles: true, ...mods }),
    'editor',
  );
}

/** The writes whose only intent is plain text changes: each must derive the text it made. */
const PLAIN = new Set([
  'type then undo',
  'type then redo',
  'accept all and stop tracking',
  'recordTracking',
  'recordView',
  'applyAgentEdit',
  'applyAgentEdit with a base',
  'reloadDoc',
]);

type Driver = [name: string, run: (editor: Editor) => void];

function drivers(editor: Editor): Driver[] {
  const out: Driver[] = [];
  // Every command of the registry. The find bar's own are left to its box, which they focus.
  for (const c of editor.commands.list()) {
    if (c.id.startsWith('find.')) continue;
    out.push([`command ${c.id}`, (e) => void e.commands.run(c.id)]);
  }
  const keys: [string, Partial<KeyboardEventInit>][] = [
    ['Enter', {}],
    ['Enter', { shiftKey: true }],
    ['Enter', { metaKey: true }],
    ['Backspace', {}],
    ['Backspace', { altKey: true }],
    ['Backspace', { metaKey: true }],
    ['Delete', {}],
    ['Delete', { altKey: true }],
    ['Tab', {}],
    ['Tab', { shiftKey: true }],
    ['ArrowUp', { altKey: true }],
    ['ArrowDown', { altKey: true }],
  ];
  for (const [k, mods] of keys) {
    out.push([`key ${Object.keys(mods).join('+')}${k}`, (e) => key(e, k, mods)]);
  }
  // Typing, with what each character starts: a list, a quote, a heading, a rule, a code span.
  for (const ch of [
    ' ',
    '-',
    '*',
    '#',
    '>',
    ':',
    '1',
    '.',
    '`',
    '"',
    "'",
    'x',
    '|',
    '_',
    '~',
    '\n',
  ]) {
    out.push([
      `type ${JSON.stringify(ch)}`,
      (e) => {
        const { from, to } = e.view.state.selection.main;
        e.view.dispatch({ changes: { from, to, insert: ch }, userEvent: 'input.type' });
      },
    ]);
  }
  // The other events that put text in or take it out, as the find bar, the emoji list and the
  // clipboard dispatch them.
  for (const event of ['input.complete', 'input.replace', 'input.replace.all', 'delete.line']) {
    out.push([
      `event ${event}`,
      (e) => {
        const { from, to } = e.view.state.selection.main;
        e.view.dispatch({ changes: { from, to, insert: 'swap' }, userEvent: event });
      },
    ]);
  }
  const pastes: [string, string, string][] = [
    ['plain', 'pasted text', ''],
    ['lines', 'a\nb\n\nc', ''],
    ['list', '- a\n- b', ''],
    ['url', 'https://example.com/x', ''],
    ['html', 'x', '<p><b>bold</b> and <a href="https://a.b">l</a></p><ul><li>i</li></ul>'],
    ['cells', 'p\tq\nr\ts', ''],
  ];
  for (const [name, text, html] of pastes) {
    out.push([
      `paste ${name}`,
      (e) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', text);
        if (html) clipboardData.setData('text/html', html);
        e.view.contentDOM.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
        );
      },
    ]);
  }
  out.push([
    'cut',
    (e) =>
      e.view.contentDOM.dispatchEvent(
        new ClipboardEvent('cut', {
          clipboardData: new DataTransfer(),
          bubbles: true,
          cancelable: true,
        }),
      ),
  ]);
  for (const [name, then] of [
    ['undo', (e: Editor) => e.undo()],
    ['redo', (e: Editor) => (e.undo(), e.redo())],
  ] as const) {
    out.push([
      `type then ${name}`,
      (e) => {
        const { from, to } = e.view.state.selection.main;
        e.view.dispatch({ changes: { from, to, insert: 'zz' }, userEvent: 'input.type' });
        e.view.dispatch({ changes: { from, insert: 'Q' }, userEvent: 'input.type' });
        then(e);
      },
    ]);
  }
  out.push(['accept all and stop tracking', (e) => e.acceptAllAndStopTracking()]);
  out.push([
    'recordTracking',
    (e) => {
      e.setTracking(true, { inFile: true });
      e.recordTracking();
    },
  ]);
  out.push([
    'recordView',
    (e) => {
      e.setViewMode('clean');
      e.recordView();
    },
  ]);
  out.push(['setImageAlt', (e) => setImageAlt(e.view, 'new alt')]);
  out.push(['setImageSrc', (e) => setImageSrc(e.view, 'new.png')]);
  out.push([
    'pickCorrection',
    (e) => {
      const { from, to } = e.view.state.selection.main;
      e.pickCorrection({ from, to }, e.view.state.sliceDoc(from, to), 'x');
    },
  ]);
  out.push([
    'applyAgentEdit',
    (e) => e.applyAgentEdit(e.getDoc().replace('Title', 'Title!'), { group: 'g', agent: 'a' }),
  ]);
  out.push([
    'applyAgentEdit with a base',
    (e) => {
      const base = e.getDoc();
      e.applyAgentEdit(base.replace('Title', 'Title!'), { group: 'g', agent: 'a' }, base);
    },
  ]);
  out.push(['reloadDoc', (e) => e.reloadDoc(e.getDoc().replace('Title', 'Title!'))]);
  return out;
}

describe.each([true, false])('every write, Track Changes %s', (tracking) => {
  it('records an intent', () => {
    const missing = new Map<string, string>();
    const plain: { name: string; before: EditorState; after: string; intent: Intent }[] = [];
    let current = '';

    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: DOC,
      author,
      tracking,
      extensions: [
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) {
            if (!tr.docChanged) continue;
            const intent = intentOf(tr);
            const event = String(tr.annotation(Transaction.userEvent));
            if (!intent) {
              missing.set(current, event);
            } else if (PLAIN.has(current)) {
              plain.push({
                name: current,
                before: tr.startState,
                after: tr.state.doc.toString(),
                intent,
              });
            }
          }
        }),
      ],
    });
    const offs = [
      createFormatting(editor, { author, notice: () => undefined }),
      createTables(editor),
      createEmoji(editor),
      createFind(editor),
    ];
    open.push(() => {
      for (const off of offs) off();
      editor.destroy();
    });

    // A few places in each line, and the images, whose commands need one selected.
    const places: [number, number][] = [];
    let at = 0;
    for (const line of DOC.split('\n')) {
      places.push([at, 0], [at + Math.floor(line.length / 2), (at % 3) * 4]);
      at += line.length + 1;
    }
    for (const m of DOC.matchAll(/!\[alt\]\(pic.png\)|<img[^>]*>/g)) {
      places.push([m.index, m[0].length], [m.index + 1, 0]);
    }

    for (const [name, run] of drivers(editor)) {
      current = name;
      for (const [pos, len] of places) {
        editor.setDoc(DOC);
        forceParsing(editor.view, editor.view.state.doc.length, 10_000);
        editor.view.dispatch({
          selection: { anchor: pos, head: Math.min(pos + len, DOC.length) },
        });
        try {
          run(editor);
        } catch {
          // A command with nothing to act on throws or does nothing: it wrote nothing to record.
        }
      }
    }

    expect([...missing].map(([name, event]) => `${name} (${event})`)).toEqual([]);

    // Each plain write did write: a driver that quietly stopped changing the document would
    // leave nothing here to check.
    for (const name of PLAIN)
      expect(
        plain.some((p) => p.name === name),
        name,
      ).toBe(true);

    // The plain writes derive again, on the text they were made on, the document they made.
    const wrong = plain
      .filter(
        ({ before, after, intent }) =>
          intent.kind === 'typing' &&
          deriveIntent(before, intent).apply(before.doc).toString() !== after,
      )
      .map(({ name }) => name);
    expect([...new Set(wrong)]).toEqual([]);
  }, 300_000);
});
