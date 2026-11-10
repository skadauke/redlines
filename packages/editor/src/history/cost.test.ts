// @vitest-environment happy-dom
// What the history costs a keystroke: the module against CodeMirror's own history, in one process,
// on the same keystrokes (a keystroke costs what it costs on main).
import { history as codeMirrorHistory } from '@codemirror/commands';
import { type ChangeSet, EditorState, type Extension } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, parsedField } from '../index.ts';
import { loadFile } from '../line-breaks.ts';
import { longDocument } from '../test-documents.ts';
import { history } from './index.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const KEYSTROKES = 1000;

/**
 * The change sets of typing `KEYSTROKES` characters in the middle of `doc`, in an editor's state:
 * Track Changes and the typing filter make them, and nothing needs drawing.
 */
function keystrokes(doc: string, tracking: boolean): ChangeSet[] {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, tracking });
  open.push(editor);
  let state = editor.view.state;
  const marks = state.field(parsedField).marks.length;
  // The middle of a paragraph's words, away from any marker.
  const mid = state.doc.toString().indexOf('lazy dog', Math.floor(state.doc.length / 2));
  state = state.update({ selection: { anchor: mid } }).state;
  const recorded: ChangeSet[] = [];
  for (let i = 0; i < KEYSTROKES; i++) {
    const tr = state.update(state.replaceSelection('x'), { userEvent: 'input.type' });
    recorded.push(tr.changes);
    state = tr.state;
  }
  // Tracked, the keystrokes make one insertion of Ada's; untracked, none.
  expect(state.field(parsedField).marks.length).toBe(tracking ? marks + 1 : marks);
  return recorded;
}

/** Milliseconds to replay `changes` on a bare state with `history`. */
function replay(doc: string, changes: readonly ChangeSet[], history: Extension): number {
  const loaded = loadFile(doc);
  let state = EditorState.create({ doc: loaded.doc, extensions: [loaded.extension, history] });
  const start = performance.now();
  for (const change of changes)
    state = state.update({ changes: change, userEvent: 'input.type' }).state;
  return performance.now() - start;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

/**
 * The long document with mixed line breaks: LF first, and every fourth paragraph break CRLF, so
 * that the file has breaks of the other style and the history looks at them at every step.
 */
function mixedDocument(doc: string): string {
  let n = 0;
  return doc.replace(/\n\n/g, (breaks) => (n++ % 4 === 3 ? '\r\n\r\n' : breaks));
}

// The slack: twice CodeMirror's time plus 10 ms, for a replay of about 2 to 3 ms. Anything that
// does real work per keystroke (a parse, a diff, a walk of the ledger) costs at least 0.1 ms each,
// 100 ms or more for the 1,000, and fails it by far; a loaded CI machine's noise, a GC pause or a
// few ms of descheduling in one replay, can't reach it, the more so as the replays alternate and
// the median of 5 is taken.
const SLACK_FACTOR = 2;
const SLACK_MS = 10;

describe('the history’s cost', () => {
  const { doc } = longDocument();
  const mixed = mixedDocument(doc);
  // A long timeout: recording is the slow part, the editor's own work for 1,000 keystrokes on the
  // long document, several seconds under happy-dom.
  it.each([
    ['LF, Track Changes on', doc, true],
    ['LF, Track Changes off', doc, false],
    ['mixed line breaks, Track Changes on', mixed, true],
  ] as const)(
    'costs what CodeMirror’s history costs, on 1,000 keystrokes: %s',
    (_, file, tracking) => {
      // The mixed file's first break is an LF, so its CRLFs are breaks of the other style.
      if (file === mixed) expect(file.indexOf('\n')).toBeLessThan(file.indexOf('\r\n'));
      else expect(file.includes('\r')).toBe(false);
      const changes = keystrokes(file, tracking);
      // Once each first, to warm up.
      replay(file, changes, codeMirrorHistory());
      replay(file, changes, history());
      const theirs: number[] = [];
      const ours: number[] = [];
      for (let i = 0; i < 5; i++) {
        theirs.push(replay(file, changes, codeMirrorHistory()));
        ours.push(replay(file, changes, history()));
      }
      expect(median(ours)).toBeLessThan(SLACK_FACTOR * median(theirs) + SLACK_MS);
    },
    120_000,
  );
});
