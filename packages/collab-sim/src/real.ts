// The real writers: an intent derived by the code the editor itself runs (multiuser §6). Typing,
// deleting and replacing go through a headless editor's tracking filter, as a keystroke does; a
// format change, a comment, a reply and a decision go through the editor's own writers
// (`writeFormat`, `writeReview`, `guardDecision`). The first simulations called the format library
// directly, and so never saw the editor's anchors, ids, guard or filter.
//
// The editor needs a DOM: this file is for Vitest's happy-dom environment, and is no part of the
// command line's workers.

import { EditorSelection, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  createEditor,
  editSourceFacet,
  guardDecision,
  markSignature,
  writeFormat,
  writeReview,
} from '@redlines/editor';
import type { Editor } from '@redlines/editor';
import type { EditContext, FormatOp, MarkRange, Range, TextChange } from '@redlines/format';
import type { Writers } from './intents.ts';

/** The tracked changes of a transaction, as changes of the text it was made on. */
function changesOf(tr: {
  changes: {
    iterChanges: (
      f: (a: number, b: number, c: number, d: number, i: { toString(): string }) => void,
    ) => void;
  };
}): TextChange[] {
  const changes: TextChange[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    changes.push({ from, to, insert: inserted.toString() });
  });
  return changes;
}

export interface RealWriters extends Writers {
  /** Takes the headless editor away. */
  destroy(): void;
}

/** Writers that go through a headless editor. Needs `document`. */
export function realWriters(): RealWriters {
  // What the editor's edit source reads: the intent being derived, set before each write.
  let time = '2026-11-01T10:00Z';
  let random: ((n: number) => Uint8Array) | undefined;
  const source: Extension = editSourceFacet.of({
    now: () => new Date(time),
    random: (n) => (random ? random(n) : crypto.getRandomValues(new Uint8Array(n))),
  });
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor: Editor = createEditor(parent, {
    doc: '',
    author: { handle: 'sim', name: 'Sim' },
    tracking: true,
    extensions: [source],
  });
  const withContext = <T>(text: string, ctx: EditContext, run: () => T): T => {
    time = ctx.time;
    random = ctx.random;
    editor.setDoc(text);
    editor.setAuthor({ handle: ctx.author.handle, name: ctx.author.name });
    editor.setTracking(true, { inFile: false });
    return run();
  };

  const writers: RealWriters = {
    edits(text, edits, ctx, how) {
      return withContext(text, ctx, () => {
        // A replacement is typed over a selection of the text it replaces, as a person types it.
        const replaced = edits.filter((edit) => edit.from < edit.to);
        if (replaced.length) {
          editor.view.dispatch({
            selection: EditorSelection.single(
              Math.min(...replaced.map((edit) => edit.from)),
              Math.max(...replaced.map((edit) => edit.to)),
            ),
          });
        }
        const state: EditorState = editor.view.state;
        const tr = state.update({
          changes: edits,
          userEvent: how === 'delete' ? 'delete.selection' : 'input.type',
        });
        return changesOf(tr);
      });
    },
    format(text: string, runs: Range[], op: FormatOp, ctx: EditContext) {
      return writeFormat(text, {
        tracking: true,
        ranges: runs,
        op,
        author: ctx.author,
        time: ctx.time,
        ...(ctx.random ? { random: ctx.random } : {}),
      }).changes;
    },
    comment(text, range, note, ctx) {
      return writeReview(
        text,
        { op: 'comment', range, body: note },
        { author: ctx.author, time: ctx.time, ...(ctx.random ? { random: ctx.random } : {}) },
      ).changes;
    },
    reply(text, thread, body, ctx) {
      return writeReview(
        text,
        { op: 'reply', thread, body },
        { author: ctx.author, time: ctx.time, ...(ctx.random ? { random: ctx.random } : {}) },
      ).changes;
    },
    decide(text: string, decision, mark: MarkRange, seen, guard) {
      const op = { op: 'decide' as const, decision, ids: [mark.id], seen: [seen] };
      if (guard && guardDecision(text, op).apply.length === 0) return null;
      return writeReview(
        text,
        { ...op },
        { author: { handle: 'sim', name: 'Sim' }, time: '2026-11-01T10:00Z' },
      ).changes;
    },
    signature: (text, mark) => markSignature(text, mark),
    destroy() {
      editor.destroy();
      parent.remove();
    },
  };
  return writers;
}
