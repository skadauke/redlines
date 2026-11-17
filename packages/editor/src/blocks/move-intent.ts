// A move of blocks as an intent (docs/research/multiuser.md §4.2): the run of blocks and the gap
// they were moved to, as the format names them, with who, when, the bytes of the ids the format
// drew, and the change that took back the empty paragraph Return opened (`asFile`), which the step
// made first. `writeMove` is the one place that writes the tracked move; `deriveMove` writes it
// again, on the text it was made on or, with the run and the gap as they read there, on newer text.
//
// Only the tracked write is a `MoveIntent`. A move made without tracking is plain edits, which are
// a typing intent of their own (`untrackedWrite`), and the same `revert`.

import { ChangeSet } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { trackedBlockMove } from '@redlines/format';
import type {
  BlockGap,
  BlockRun,
  EditContext,
  MarkdownDialect,
  Person,
  Range,
  TextChange,
} from '@redlines/format';
import { recording, replaying } from '../tracked/intent.ts';

export interface MoveIntent {
  kind: 'move';
  id: string;
  run: BlockRun;
  gap: BlockGap;
  /**
   * The change that took the open paragraph back, which the transaction's start text has composed
   * in: the run and the gap are of the text it leaves, and the transaction's changes are this one
   * followed by what the move wrote.
   */
  revert?: readonly TextChange[];
  author: Person;
  /** The dialect of the file it was written for (format §9.1). */
  dialect?: MarkdownDialect;
  /** To the minute. */
  time: string;
  drawn: readonly (readonly number[])[];
}

export interface MoveRequest {
  run: BlockRun;
  gap: BlockGap;
  revert?: readonly TextChange[];
  author: Person;
  time: string;
  dialect?: MarkdownDialect;
  /** Where ids come from; none for the system's. */
  random?: (n: number) => Uint8Array;
}

/**
 * The tracked move of the request on `text`, and the intent that says how. Undefined when the run is
 * no longer there.
 *
 * @throws Untrackable when not even the widened write holds it.
 */
export function writeMove(
  text: string,
  request: MoveRequest,
): { changes: TextChange[]; moved: Range; intent: Omit<MoveIntent, 'id'> } | undefined {
  const { run, gap, author, time } = request;
  const drawing = recording(request.random);
  const ctx: EditContext = {
    author,
    time,
    random: drawing.random,
    ...(request.dialect === undefined ? {} : { dialect: request.dialect }),
  };
  const done = trackedBlockMove(text, run, gap, ctx);
  if (!done) return undefined;
  return {
    ...done,
    intent: {
      kind: 'move',
      run,
      gap,
      ...(request.revert?.length ? { revert: request.revert } : {}),
      author,
      ...(request.dialect === undefined ? {} : { dialect: request.dialect }),
      time,
      drawn: drawing.drawn,
    },
  };
}

/**
 * The changes an intent makes on `state`'s text: what it wrote the first time, on the text it was
 * made on, with the paragraph taken back first. On newer text, `run` and `gap` are the blocks and the
 * place as they read there. Nothing, when the run is gone.
 *
 * @throws Untrackable when not even the widened write holds it there.
 */
export function deriveMove(
  state: EditorState,
  intent: MoveIntent,
  run: BlockRun = intent.run,
  gap: BlockGap = intent.gap,
): ChangeSet {
  const revert = intent.revert
    ? ChangeSet.of(
        intent.revert.map(({ from, to, insert }) => ({ from, to, insert })),
        state.doc.length,
      )
    : null;
  const text = revert ? revert.apply(state.doc).toString() : state.doc.toString();
  const done = writeMove(text, {
    run,
    gap,
    author: intent.author,
    time: intent.time,
    ...(intent.dialect === undefined ? {} : { dialect: intent.dialect }),
    random: replaying(intent),
  });
  const made = ChangeSet.of(
    (done?.changes ?? []).map(({ from, to, insert }) => ({ from, to, insert })),
    text.length,
  );
  return revert ? revert.compose(made) : made;
}
