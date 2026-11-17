// @vitest-environment happy-dom
// Per-person undo (multiuser plan, PR 6): a step knows whose it is. Undo takes back what is left of
// your own step and keeps what others did since; it never refuses and never takes another person's
// work with it. Their changes come in as remote changes.
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { acceptMarks, parse, rejectMarks, trackedEdit, type TextChange } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { createEditor, type Editor } from '../index.ts';
import { intentAnnotation } from '../tracked/intent.ts';
import { refusedEditEffect, setTrackingEffect } from '../tracked/typing.ts';
import { redoSayingWhy, undoSayingWhy } from './guard.ts';
import { history, historyField, remoteStep, undoDepth } from './history.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function made(doc: string, tracking: boolean) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const said: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    extensions: [
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions)
          for (const effect of tr.effects)
            if (effect.is(refusedEditEffect)) said.push(effect.value);
      }),
    ],
  });
  open.push(editor);
  return { editor, said };
}

const type = (editor: Editor, from: number, to: number, insert: string) =>
  editor.view.dispatch({ changes: { from, to, insert }, userEvent: 'input.type' });

const fromBo = [Transaction.addToHistory.of(false), remoteStep.of({ person: 'bo', name: 'Bo' })];

/** Bo's edit, as the session delivers it: outside the history, with its author. */
const remote = (editor: Editor, from: number, to: number, insert: string) =>
  editor.view.dispatch({ changes: { from, to, insert }, annotations: fromBo, filter: false });

/** Bo's edit as the format writes it with Track Changes on. */
const remoteTracked = (editor: Editor, from: number, to: number, insert: string) => {
  const changes = trackedEdit(
    editor.view.state.doc.toString(),
    { from, to, insert },
    { author: { handle: 'bo', name: 'Bo' }, time: '2026-11-17T10:00Z' },
  );
  editor.view.dispatch({ changes, annotations: fromBo, filter: false });
};

/** Bo decides every mark of the file. */
const decide = (editor: Editor, how: typeof acceptMarks) => {
  const text = editor.view.state.doc.toString();
  const changes: TextChange[] = how(
    text,
    parse(text).marks.map((mark) => mark.id),
  );
  editor.view.dispatch({ changes, annotations: fromBo, filter: false });
};

const track = (editor: Editor, on: boolean) =>
  editor.view.dispatch({ effects: setTrackingEffect.of(on) });

/** The file as the ledger and the marks tell it: one ledger, and an entry for every mark and no more. */
const sound = (editor: Editor) => {
  const text = editor.view.state.doc.toString();
  const parsed = parse(text);
  expect(parsed.warnings).toEqual([]);
  expect(text.split('<!-- redlines').length - 1).toBeLessThanOrEqual(1);
  expect(Object.keys(parsed.ledger.marks).sort()).toEqual(
    parsed.marks.map((mark) => mark.id).sort(),
  );
};

/** What the history keeps of its steps, as it saves it. */
const savedSteps = (state: EditorState) =>
  (
    state.toJSON({ history: historyField }) as {
      history: {
        done: { meta?: { person?: string; marks: string[]; touchedBy: string | null } }[];
      };
    }
  ).history.done;

const bodyOf = (editor: Editor) => editor.view.state.doc.toString().split('\n\n<!-- redlines')[0];
const parsedOf = (editor: Editor) => parse(editor.view.state.doc.toString());

describe('undo, per person', () => {
  it('takes back an untracked step that nobody touched, though others edited elsewhere', () => {
    const { editor } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remote(editor, 0, 0, 'Oh. ');
    expect(bodyOf(editor)).toBe('Oh. Hello there world\n');
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Oh. Hello world\n');
  });

  it('takes your text from an untracked step that Bo typed inside, and keeps his typing', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remote(editor, 8, 8, 'X');
    expect(bodyOf(editor)).toBe('Hello thXere world\n');
    expect(undoSayingWhy(editor.view)).toBe(true);
    expect(bodyOf(editor)).toBe('HelloX world\n');
    expect(said).toEqual([]);
    // Redo brings back what Undo took, with his typing where it is.
    redoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello thXere world\n');
  });

  it('keeps Bo’s tracked deletion over part of your untracked text, and takes the rest', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remoteTracked(editor, 7, 10, '');
    expect(parsedOf(editor).marks.map((mark) => mark.entry.by)).toEqual(['bo']);
    undoSayingWhy(editor.view);
    const after = parsedOf(editor);
    expect(said).toEqual([]);
    expect(after.warnings).toEqual([]);
    expect(after.marks.map((mark) => [mark.kind, mark.entry.by, mark.payload])).toEqual([
      ['del', 'bo', 'her'],
    ]);
    expect(bodyOf(editor)).not.toContain('there');
    expect(Object.keys(after.ledger.marks)).toEqual(after.marks.map((mark) => mark.id));
  });

  it('does not count text typed beside the step as touching it', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 5, 5, ' there');
    remote(editor, 11, 11, '!');
    // Beside the step: it is not marked as touched, and Undo takes it back whole.
    expect(savedSteps(editor.view.state)[0]!.meta!.touchedBy).toBeNull();
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).toBe('Hello! world\n');
  });

  it('takes back a tracked step by rejecting its marks, though Bo edited inside it', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const at = editor.view.state.doc.toString().indexOf('there');
    // Bo deletes a letter inside the inserted text: it touches the step, adds nothing to it.
    remote(editor, at + 2, at + 3, '');
    expect(undoSayingWhy(editor.view)).toBe(true);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).not.toContain('<!--ins');
    expect(parsedOf(editor).warnings).toEqual([]);
  });

  it('takes your marks and text from a tracked step Bo typed inside, and keeps his typing', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const at = editor.view.state.doc.toString().indexOf('there');
    remote(editor, at + 2, at + 2, 'X');
    undoSayingWhy(editor.view);
    const after = parsedOf(editor);
    expect(said).toEqual([]);
    expect(after.warnings).toEqual([]);
    expect(after.marks).toEqual([]);
    expect(bodyOf(editor)).toBe('HelloX world\n');
    expect(after.ledger.marks).toEqual({});
  });

  it('keeps Bo’s own tracked typing, under his mark, inside a tracked step of yours', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const at = editor.view.state.doc.toString().indexOf('there');
    remoteTracked(editor, at + 2, at + 2, 'X');
    expect(parsedOf(editor).warnings).toEqual([]);
    undoSayingWhy(editor.view);
    const after = parsedOf(editor);
    expect(said).toEqual([]);
    expect(after.warnings).toEqual([]);
    expect(after.marks.length).toBeGreaterThan(0);
    expect(after.marks.every((mark) => mark.entry.by === 'bo')).toBe(true);
    expect(bodyOf(editor)).toContain('X');
    expect(bodyOf(editor)).not.toContain('there');
    expect(Object.keys(after.ledger.marks)).toEqual(after.marks.map((mark) => mark.id));
  });

  it('writes the take-back of a step Bo accepted as a tracked deletion, with Track Changes on', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    decide(editor, acceptMarks);
    expect(bodyOf(editor)).toBe('Hello there world\n');
    undoSayingWhy(editor.view);
    const after = parsedOf(editor);
    expect(said).toEqual([]);
    expect(after.warnings).toEqual([]);
    expect(after.marks.map((mark) => [mark.kind, mark.entry.by, mark.payload])).toEqual([
      ['del', 'ada', ' there'],
    ]);
    // Redo brings the text back.
    redoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello there world\n');
    expect(parsedOf(editor).marks).toEqual([]);
  });

  it('writes the take-back of a step Bo accepted plain, with Track Changes off', () => {
    const { editor } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    decide(editor, acceptMarks);
    track(editor, false);
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello world\n');
    expect(parsedOf(editor).marks).toEqual([]);
  });

  it('brings back the text of a deletion Bo accepted, as a tracked insertion', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 11, '');
    expect(parsedOf(editor).marks.map((mark) => mark.kind)).toEqual(['del']);
    decide(editor, acceptMarks);
    expect(bodyOf(editor)).toBe('Hello\n');
    undoSayingWhy(editor.view);
    const after = parsedOf(editor);
    expect(said).toEqual([]);
    expect(after.warnings).toEqual([]);
    expect(after.marks.map((mark) => [mark.kind, mark.entry.by])).toEqual([['ins', 'ada']]);
    expect(bodyOf(editor)).toContain(' world');
    redoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello\n');
  });

  it('brings back an accepted deletion plain with Track Changes off', () => {
    const { editor } = made('Hello world\n', true);
    type(editor, 5, 11, '');
    decide(editor, acceptMarks);
    track(editor, false);
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('Hello world\n');
    expect(parsedOf(editor).marks).toEqual([]);
  });

  it('has nothing to write for a step Bo rejected, and goes to the step below, with no message', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 0, 0, 'A');
    track(editor, true);
    editor.view.dispatch({
      changes: { from: 6, to: 6, insert: ' there' },
      userEvent: 'input.type',
      annotations: Transaction.time.of(Date.now() + 5000),
    });
    decide(editor, rejectMarks);
    expect(bodyOf(editor)).toBe('AHello world\n');
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).toBe('Hello world\n');
  });

  it('writes nothing back for a deletion Bo rejected', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 11, '');
    decide(editor, rejectMarks);
    expect(bodyOf(editor)).toBe('Hello world\n');
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).toBe('Hello world\n');
    expect(undoDepth(editor.view.state)).toBe(0);
  });

  it('goes on to the step below after a tracked step it took back around Bo’s typing', () => {
    const { editor, said } = made('Hello world\n', false);
    type(editor, 0, 0, 'A');
    track(editor, true);
    editor.view.dispatch({
      changes: { from: 6, to: 6, insert: ' there' },
      userEvent: 'input.type',
      annotations: Transaction.time.of(Date.now() + 5000),
    });
    const at = editor.view.state.doc.toString().indexOf('there');
    remote(editor, at + 2, at + 2, 'Q');
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('AHelloQ world\n');
    sound(editor);
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    expect(bodyOf(editor)).toBe('HelloQ world\n');
  });

  it('puts the caret where it took your text out, when it takes back around Bo’s edit', () => {
    const { editor } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const at = editor.view.state.doc.toString().indexOf('there');
    remote(editor, at + 2, at + 2, 'X');
    undoSayingWhy(editor.view);
    const caret = editor.view.state.selection.main;
    expect(bodyOf(editor)).toBe('HelloX world\n');
    expect(caret.empty).toBe(true);
    expect(editor.view.state.doc.sliceString(0, caret.head)).toBe('Hello');
  });

  it('keeps Bo’s tracked deletion inside your tracked step and leaves a sound file (undo, redo)', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 0, 0, 'A');
    type(editor, 6, 6, ' there');
    editor.view.dispatch({ changes: { from: 0, to: 0, insert: '' } });
    const a = editor.view.state.doc.toString().indexOf('there');
    remoteTracked(editor, a + 1, a + 3, '');
    sound(editor);
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    sound(editor);
    expect(bodyOf(editor)).not.toContain('there');
    redoSayingWhy(editor.view);
    expect(said).toEqual([]);
    sound(editor);
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    sound(editor);
  });

  it('does the same when Bo’s tracked deletion spans the edge of your insertion', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    const a = editor.view.state.doc.toString().indexOf(' there');
    remoteTracked(editor, a - 2, a + 3, '');
    sound(editor);
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    sound(editor);
    expect(bodyOf(editor)).not.toContain('there');
  });

  it('redoes a tracked step after Bo made a tracked edit elsewhere', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    undoSayingWhy(editor.view);
    remoteTracked(editor, 0, 1, 'J');
    redoSayingWhy(editor.view);
    expect(said).toEqual([]);
    sound(editor);
    expect(bodyOf(editor)).toContain(' there');
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    sound(editor);
  });

  it('redoes a take-back that wrote tracked marks after Bo made a tracked edit', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 5, 5, ' there');
    decide(editor, acceptMarks);
    undoSayingWhy(editor.view);
    remoteTracked(editor, 0, 1, 'J');
    redoSayingWhy(editor.view);
    expect(said).toEqual([]);
    sound(editor);
    expect(bodyOf(editor)).toContain('there');
  });

  it('takes back what is left of a replacement Bo accepted half of, plain', () => {
    const { editor: other, said } = made('Hello world\n', true);
    type(other, 6, 11, '');
    const at2 = other.view.state.doc.toString().indexOf('-->') + 3;
    type(other, at2, at2, 'moon');
    const text = other.view.state.doc.toString();
    const ins = parse(text)
      .marks.filter((mark) => mark.kind === 'ins')
      .map((mark) => mark.id);
    other.view.dispatch({
      changes: acceptMarks(text, ins),
      annotations: fromBo,
      filter: false,
    });
    track(other, false);
    undoSayingWhy(other.view);
    expect(bodyOf(other)).toBe('Hello world\n');
    sound(other);
    expect(said).toEqual([]);
  });

  it('takes back what is left of a replacement Bo accepted half of, tracked', () => {
    const { editor, said } = made('Hello world\n', true);
    type(editor, 6, 11, '');
    const at = editor.view.state.doc.toString().indexOf('-->') + 3;
    type(editor, at, at, 'moon');
    const text = editor.view.state.doc.toString();
    const ins = parse(text)
      .marks.filter((mark) => mark.kind === 'ins')
      .map((mark) => mark.id);
    editor.view.dispatch({ changes: acceptMarks(text, ins), annotations: fromBo, filter: false });
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    sound(editor);
    const after = parsedOf(editor);
    expect(after.marks.map((mark) => [mark.kind, mark.payload])).toEqual([['del', 'moon']]);
    expect(bodyOf(editor)).toContain('world');
  });

  /** Ada replaces "world" with "moon" (a del mark and an ins mark); Bo types X inside "moon". */
  const replaced = () => {
    const made1 = made('Hello world\n', true);
    const { editor } = made1;
    type(editor, 6, 11, '');
    const at = editor.view.state.doc.toString().indexOf('-->') + 3;
    type(editor, at, at, 'moon');
    const ix = editor.view.state.doc.toString().indexOf('moon') + 2;
    remote(editor, ix, ix, 'X');
    const marks = parsedOf(editor).marks;
    return {
      ...made1,
      ids: (kind: string) => marks.filter((m) => m.kind === kind).map((m) => m.id),
    };
  };

  it('takes back an accepted insertion Bo typed inside as your tracked deletion, rejecting the pending deletion (#967)', () => {
    const { editor, said, ids } = replaced();
    const text = editor.view.state.doc.toString();
    editor.view.dispatch({
      changes: acceptMarks(text, ids('ins')),
      annotations: fromBo,
      filter: false,
    });
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    sound(editor);
    const after = parsedOf(editor);
    expect(after.marks.map((m) => [m.kind, m.entry.by]).sort()).toEqual([
      ['del', 'ada'],
      ['del', 'ada'],
    ]);
    expect(after.marks.map((m) => m.payload).sort()).toEqual(['mo', 'on']);
    // "world" is back in the text, and X stays, plain.
    expect(bodyOf(editor)).toContain('world');
    expect(bodyOf(editor)).toContain('X');
    expect(bodyOf(editor)).not.toMatch(/<!--del [a-z0-9]{4} world-->/);
  });

  it('with some marks still there and typed inside and others decided, writes the decided part as your own', () => {
    const { editor, said, ids } = replaced();
    const text = editor.view.state.doc.toString();
    // Bo accepts the deletion only: "world" is gone for good, and "moon" still has his X inside.
    editor.view.dispatch({
      changes: acceptMarks(text, ids('del')),
      annotations: fromBo,
      filter: false,
    });
    expect(bodyOf(editor)).toBe(
      'Hello <!--ins ' + ids('ins')[0] + '-->moXon<!--/' + ids('ins')[0] + '-->',
    );
    undoSayingWhy(editor.view);
    expect(said).toEqual([]);
    sound(editor);
    const after = parsedOf(editor);
    // Your text goes (plain, as a rejection is), "world" comes back as your tracked insertion, X stays.
    expect(after.marks.map((m) => [m.kind, m.entry.by])).toEqual([['ins', 'ada']]);
    expect(bodyOf(editor)).toContain('world');
    expect(bodyOf(editor)).toContain('X');
    expect(bodyOf(editor)).not.toContain('moon');
    expect(bodyOf(editor)).not.toContain('mo');
  });

  it('knows whose a step is that a group of steps made (a table paste)', () => {
    const { editor } = made('Hello world\n', false);
    const edit = { from: 5, to: 5, insert: ' there', main: true };
    editor.view.dispatch({
      changes: { from: 5, insert: ' there' },
      userEvent: 'input.type',
      annotations: intentAnnotation.of({
        kind: 'steps',
        id: 'grp1',
        steps: [
          {
            kind: 'typing',
            id: 'one1',
            tracking: false,
            edits: [edit],
            backward: false,
            grouped: false,
            widening: false,
            author: { handle: 'ada', name: 'Ada Lovelace' },
            time: '',
            drawn: [],
          },
        ],
      }),
    });
    expect(savedSteps(editor.view.state)[0]!.meta!.person).toBe('ada');
    remote(editor, 8, 8, 'X');
    undoSayingWhy(editor.view);
    expect(bodyOf(editor)).toBe('HelloX world\n');
  });

  it('keeps what it knows of a step through the history’s JSON, and uses it after fromJSON', () => {
    const extensions = [
      history({
        stepInfo: () => ({
          person: 'ada',
          marks: ['k3x9'],
          deleted: [{ id: 'k3x9', at: 2, text: 'ab' }],
          entries: { k3x9: { entry: { by: 'ada', at: '2026-11-17T10:00Z' } } },
        }),
      }),
    ];
    const first = EditorState.create({ doc: 'Hello', extensions });
    const made1 = first.update({
      changes: { from: 0, insert: 'X' },
      userEvent: 'input.type',
    }).state;
    const saved: unknown = made1.toJSON({ history: historyField });
    const restored = EditorState.fromJSON(saved, { extensions }, { history: historyField });
    const again = savedSteps(restored);
    expect(again).toEqual(savedSteps(made1));
    expect(again[0]!.meta).toMatchObject({
      person: 'ada',
      marks: ['k3x9'],
      deleted: [{ id: 'k3x9', at: 2, text: 'ab' }],
      entries: { k3x9: { entry: { by: 'ada' } } },
    });
    expect(undoDepth(restored)).toBe(1);
  });
});
