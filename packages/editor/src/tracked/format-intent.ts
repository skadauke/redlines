// Format changes as intents (docs/research/multiuser.md §4.2): a toggle, a block's type, a link, a
// check, an indent, kept as what the person asked for (`FormatOp` carries its target: "bold on",
// not "toggle bold"), over the ranges they asked it of, with who, when and the bytes of the ids the
// format drew. `writeFormat` is the one place that writes them; `deriveFormat` writes the same
// again, on the text it was made on or on newer text, and gives what the first time gave.
//
// The ops of two people at once compose as Docs does: bold and italic both apply, and the last
// block type set wins, because each is derived again from its target on the newest text.

import {
  applyChanges,
  fineFormat,
  trackedFormat,
  trackedFormatRanges,
  untrackedFormat,
} from '@redlines/format';
import type { EditContext, FormatOp, Person, Range, TextChange } from '@redlines/format';
import { ChangeSet } from '@codemirror/state';
import { recording, replaying } from './intent.ts';

/** Which of the format's writers an intent used with Track Changes on. */
export type FormatWriter =
  /** `trackedFormat`: the fine form, else the unit that holds it. */
  | 'tracked'
  /** `fineFormat`: the fine form only; a block's keys try the unit next, as their own step. */
  | 'fine'
  /** `trackedFormatRanges`: many ranges at once, as the cells of a rectangle. */
  | 'ranges';

export interface FormatIntent {
  kind: 'format';
  id: string;
  tracking: boolean;
  ranges: readonly Range[];
  op: FormatOp;
  writer: FormatWriter;
  compose?: boolean;
  /** The group of the marks of several ranges, decided together. */
  group?: string;
  author: Person | null;
  /** To the minute. Empty when the format was written without tracking. */
  time: string;
  drawn: readonly (readonly number[])[];
}

/** What a caller says of a format change it asks for. */
export interface FormatRequest {
  tracking: boolean;
  /** In the order of the text, apart. */
  ranges: readonly Range[];
  op: FormatOp;
  writer?: FormatWriter;
  /** Write even one range as several are (each on the text before it, composed), as the Format
   * menu's commands over a selection of cells always did. */
  compose?: boolean;
  group?: string;
  author: Person | null;
  time: string;
  /** Where ids come from; none for the system's. */
  random?: (n: number) => Uint8Array;
}

/**
 * The changes the format writes for the request, and the intent that says how. One range is one
 * write of the format; several are written from the last to the first, each on the text the ones
 * after it left, and composed, as the Format and Paragraph menus do.
 *
 * @throws EditError when the format refuses it.
 */
export function writeFormat(
  text: string,
  request: FormatRequest,
): { changes: TextChange[]; intent: Omit<FormatIntent, 'id'> } {
  const { tracking, ranges, op, group, author, time } = request;
  const writer = request.writer ?? 'tracked';
  const drawing = recording(request.random);
  const ctx = (): EditContext => ({
    author: needAuthor(author, tracking),
    time,
    random: drawing.random,
    ...(group === undefined ? {} : { group }),
  });
  const made = (() => {
    if (tracking && writer === 'ranges')
      return trackedFormatRanges(text, ranges, op, ctx()).changes;
    if (ranges.length === 1)
      return one(text, ranges[0]!, op, tracking, writer, ctx, author, drawing);
    let doc = text;
    let total = ChangeSet.empty(text.length);
    for (const found of ranges.toReversed()) {
      const range = { from: total.mapPos(found.from, -1), to: total.mapPos(found.to, 1) };
      const step = one(doc, range, op, tracking, writer, ctx, author, drawing);
      const set = ChangeSet.of(
        step.map(({ from, to, insert }) => ({ from, to, insert })),
        doc.length,
      );
      doc = applyChanges(doc, step);
      total = total.compose(set);
    }
    const changes: TextChange[] = [];
    total.iterChanges((from, to, _a, _b, inserted) =>
      changes.push({ from, to, insert: inserted.toString() }),
    );
    return changes;
  })();
  return {
    changes: made,
    intent: {
      kind: 'format',
      tracking,
      ranges,
      op,
      writer,
      ...(request.compose ? { compose: true } : {}),
      ...(group === undefined ? {} : { group }),
      author,
      time: tracking ? time : '',
      drawn: drawing.drawn,
    },
  };
}

function needAuthor(author: Person | null, tracking: boolean): Person {
  // A tracked intent is always written by someone: a missing author is a bug of the caller's.
  if (!author && tracking) throw new TypeError('A tracked format needs an author.');
  return author as Person;
}

function one(
  text: string,
  range: Range,
  op: FormatOp,
  tracking: boolean,
  writer: FormatWriter,
  ctx: () => EditContext,
  author: Person | null,
  drawing: { random: ((n: number) => Uint8Array) | undefined },
): TextChange[] {
  if (!tracking) {
    return untrackedFormat(text, range, op, {
      ...(drawing.random ? { random: drawing.random } : {}),
      ...(author ? { author } : {}),
    });
  }
  return (writer === 'fine' ? fineFormat : trackedFormat)(text, range, op, ctx()).changes;
}

/**
 * The changes an intent makes on `text`: what it wrote the first time, on the text it was made on.
 * On newer text, `ranges` are the places of its words there (`rederive.ts` places them), and ids
 * that are taken are drawn past.
 *
 * @throws EditError when the format refuses it there.
 */
export function deriveFormat(
  text: string,
  intent: FormatIntent,
  ranges: readonly Range[] = intent.ranges,
): TextChange[] {
  // Words that are gone have nothing to format: nothing is done, and nothing said.
  if (!ranges.length) return [];
  return writeFormat(text, {
    tracking: intent.tracking,
    ranges,
    op: intent.op,
    writer: intent.writer,
    ...(intent.compose ? { compose: true } : {}),
    ...(intent.group === undefined ? {} : { group: intent.group }),
    author: intent.author,
    time: intent.time,
    random: replaying(intent),
  }).changes;
}
