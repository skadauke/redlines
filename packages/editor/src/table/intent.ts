// Table operations as intents (docs/research/multiuser.md §4.2): insert or delete rows and
// columns, move them, align columns, delete a table, kept as the `TableOp` that was asked, how it
// was written, who, when and the bytes of the ids the format drew. `writeTable` is the one place
// that writes them, for Track Changes on and off; `deriveTable` writes the same again.
//
// A `TableOp` names its table by offset. On the text it was made on that is exact; on newer text
// the caller gives the op as it reads there (`op`), placed by the table's own words.

import { askedTableEdit, fineTableEdit, tableEdit, untrackedTableEdit } from '@redlines/format';
import type { EditContext, Person, TableOp } from '@redlines/format';
import { recording, replaying } from '../tracked/intent.ts';

/** Which of the format's writers wrote a tracked operation. */
export type TableWriter =
  /** `tableEdit`: the table's own rules, else a replacement of the table. */
  | 'tableEdit'
  /** `fineTableEdit`: the table's own rules only, for a caller that goes on to fill the cells. */
  | 'fine'
  /** `askedTableEdit`: as `tableEdit`, else plain and marked `untracked`, for a caller that asks. */
  | 'asked';

export interface TableIntent {
  kind: 'table';
  id: string;
  tracking: boolean;
  op: TableOp;
  writer: TableWriter;
  group?: string;
  author: Person | null;
  /** To the minute. Empty when written without tracking. */
  time: string;
  drawn: readonly (readonly number[])[];
}

export interface TableRequest {
  tracking: boolean;
  op: TableOp;
  writer?: TableWriter;
  group?: string;
  author: Person | null;
  time: string;
  /** Where ids come from; none for the system's. */
  random?: (n: number) => Uint8Array;
}

/** What the format writes for an operation: its changes, caret, and the rows or columns made. */
export type WrittenTable = ReturnType<typeof tableEdit> & { untracked?: true };

/**
 * What the format writes for the operation, and the intent that says how.
 *
 * @throws EditError when the format refuses it.
 */
export function writeTable(
  text: string,
  request: TableRequest,
): { edit: WrittenTable; intent: Omit<TableIntent, 'id'> } {
  const { tracking, op, group, author, time } = request;
  const writer = request.writer ?? 'tableEdit';
  const drawing = recording(request.random);
  let edit: WrittenTable;
  if (tracking) {
    // A tracked intent is always written by someone: a missing author is a bug of the caller's.
    if (!author) throw new TypeError('A tracked table operation needs an author.');
    const ctx: EditContext = {
      author,
      time,
      random: drawing.random,
      ...(group ? { group } : {}),
    };
    const write =
      writer === 'fine' ? fineTableEdit : writer === 'asked' ? askedTableEdit : tableEdit;
    edit = write(text, op, ctx);
  } else {
    edit = untrackedTableEdit(text, op, {
      ...(drawing.random ? { random: drawing.random } : {}),
      ...(author ? { author } : {}),
    });
  }
  return {
    edit,
    intent: {
      kind: 'table',
      tracking,
      op,
      writer,
      ...(group ? { group } : {}),
      author,
      time: tracking ? time : '',
      drawn: drawing.drawn,
    },
  };
}

/**
 * The edit an intent makes on `text`: what it wrote the first time, on the text it was made on. On
 * newer text, `op` is the operation as it reads there.
 *
 * @throws EditError when the format refuses it there.
 */
export function deriveTable(
  text: string,
  intent: TableIntent,
  op: TableOp = intent.op,
): WrittenTable {
  return writeTable(text, {
    tracking: intent.tracking,
    op,
    writer: intent.writer,
    ...(intent.group ? { group: intent.group } : {}),
    author: intent.author,
    time: intent.time,
    random: replaying(intent),
  }).edit;
}
