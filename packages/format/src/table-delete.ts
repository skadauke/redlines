// Deleting a whole table (format §3.4, §3.7 rule 6), moved out of `table-ops.ts` (#985): the comments that go to
// points where the table was, the words for what stands next to it, and `deleteTable` itself.

import { applyChanges } from './changes.ts';
import { rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { changesBetween, commitEdit, workingLedger } from './edit-support.ts';
import { SYNTAX_ONLY } from './inline.ts';
import { parse } from './parse.ts';
import { readTables } from './table.ts';
import type { TableRead } from './table.ts';
import {
  annotationsIn,
  commentCrossesTable,
  commentHasNoPlace,
  foldedMarks,
  neighboursOf,
  NEXT_TO_WORDS,
  pendingInTable,
  pointPlaces,
  ruleSix,
  straddlingMarks,
} from './table-rules.ts';
import { plainRange } from './table-rows.ts';
import { SELF_CHECK, fineEdit as trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import type { UntrackedContext } from './untracked.ts';
import { newestView } from './views.ts';
import type { EditContext, MarkRange, Parsed, TextChange } from './types.ts';
import type { TableEdit } from './table-ops.ts';

/** Why a point comment's place is refused by the edit that writes it, which the next place is tried for. */
const NO_PLACE = new Set(['no-legal-placement', 'inside-code', 'would-hide-marks', 'unclosed-end']);

/**
 * The comments and highlights in `table`'s rows taken out of them, and the comments written as point
 * comments where the table was (format §3.7, rule 6): at the start of the text of the block after the
 * table, or at the end of the text of the block before it. The text as it is after. With Track
 * Changes off a comment that can't be written so is left to the edit that takes the table's text out,
 * which keeps a point where the text was.
 *
 * @throws EditError, with Track Changes on, when a comment runs from the table into the text around
 *   it, or no text next to the table can keep a point.
 */
function commentsToPoints(
  text: string,
  parsed: Parsed,
  table: TableRead,
  tracked: boolean,
): string {
  const { removals, points, crossing } = annotationsIn(parsed, table);
  if (crossing) {
    if (!tracked) return text;
    throw new EditError(commentCrossesTable(parsed, crossing.by), 'no-legal-placement');
  }
  if (removals.length === 0) return text;
  const ledger = workingLedger(parsed.ledger);
  const ids = points.map((point) => point.id);
  const insert = ids.map((id) => `<!--cmt ${id}-->`).join('');
  for (const at of ids.length > 0 ? pointPlaces(text, parsed, table) : [null]) {
    const body = at === null ? removals : [...removals, { from: at, to: at, insert }];
    try {
      const changes = commitEdit(text, body, ledger, {
        parsed,
        created: ids,
        removes: true,
        // A point that no one reads, in code, say, would leave its thread with no anchor.
        verify: (_after, read) => {
          if (ids.some((id) => !read.marks.some((mark) => mark.id === id))) {
            throw new EditError(commentHasNoPlace(parsed, points[0]?.by ?? ''), 'inside-code');
          }
        },
      });
      return applyChanges(text, changes);
    } catch (error) {
      if (!(error instanceof EditError) || !NO_PLACE.has(error.code ?? '')) throw error;
    }
  }
  if (!tracked) return text;
  throw new EditError(commentHasNoPlace(parsed, points[0]?.by ?? ''), 'no-legal-placement');
}

/** Where the caret goes after a table is gone: at the start of the text that follows it, or at the end
 * of the text before it when none follows. `from` is where the table started in `before`. */
function caretAfterTable(before: string, from: number, after: string): number {
  const wanted = newestView(before).map.fromSource(from);
  const view = newestView(after);
  const end = view.text.replace(/\s+$/, '').length;
  return wanted >= end ? view.map.toSource(end, -1) : view.map.toSource(wanted, 1);
}

/**
 * The words of a refusal of the deletion of the table `table` that say what stands in the way and what
 * to do (format §3.7, rule 6), or null when the refusal is for another reason. The deletion's marker
 * can't stand in front of a code fence, nor behind a code block or a rule where the table ends the
 * text, and the block's deletion needs a break in front of the table's first line.
 */
function wordsNextTo(
  error: EditError,
  text: string,
  parsed: Parsed,
  table: TableRead,
): string | null {
  const next = neighboursOf(text, parsed, table);
  if (error.code === 'unclosed-end' && next.fenceAfter) {
    return next.fenceUnclosed ? NEXT_TO_WORDS.codeAfterUnclosed : NEXT_TO_WORDS.codeAfter;
  }
  if (
    next.endsText &&
    ((error.code === 'inside-code' && next.indentedAbove) ||
      (error.message === SYNTAX_ONLY && next.fenceOrRuleAbove))
  ) {
    return NEXT_TO_WORDS.codeBefore;
  }
  if (error.code === 'inside-code' && next.indentedAbove && next.indentedBelow) {
    return NEXT_TO_WORDS.codeBetween;
  }
  if (error.message.startsWith("A heading's closing #s") && next.headingAbove) {
    return NEXT_TO_WORDS.underHeading;
  }
  if (error.message === SELF_CHECK) {
    if (next.underText) return NEXT_TO_WORDS.underText;
    if (next.htmlBelow) return NEXT_TO_WORDS.htmlBelow;
  }
  return null;
}

/**
 * Deleting a table (format §3.4, §3.7 rule 6): a deletion of the block, in the form of §3.4, with the
 * table as it reads with your own pending changes rejected as its payload. With Track Changes on,
 * another person's pending change in the table refuses it; your own are folded in, as rejecting them
 * would (your inserted row is removed outright, a row you deleted is in the payload), its comments
 * become point comments where it was and its highlights go. With it off the table goes as text, with
 * what was pending in it. `ctx` is null for plain.
 */
export function deleteTable(
  text: string,
  parsed: Parsed,
  table: TableRead,
  ctx: EditContext | null,
  plain: UntrackedContext = {},
): TableEdit {
  if (ctx) {
    const refusal = ruleSix(text, table, parsed, ctx.author);
    if (refusal) throw new EditError(refusal, 'no-legal-placement');
  }
  const tables = readTables(text, parsed);
  const index = tables.findIndex((t) => t.from === table.from);
  const handle = ctx ? ctx.author.handle : null;
  // A change of yours that runs from the table into the text around it can't be undone with the table.
  const straddling = ctx ? straddlingMarks(text, table, parsed, ctx.author.handle)[0] : undefined;
  if (straddling) throw new EditError(pendingInTable(parsed, straddling), 'no-legal-placement');
  // The changes in it that go with it are undone first, as deciding them would: what is left is a
  // table with nothing pending, which the ordinary deletion of a block writes (`trackedEdit`).
  let current = text;
  const folded = foldedMarks(text, table, parsed, handle);
  if (folded.length > 0) {
    const wanted = new Set(folded.map((mark) => mark.id));
    current = applyChanges(
      text,
      rejectAll(text, (mark) => wanted.has(mark.id)),
    );
  }
  let read = current === text ? parsed : parse(current);
  const left = readTables(current, read);
  if (left.length < tables.length) {
    // The table was nothing but your own pending insertion, and undoing it took it away with no trace;
    // or undoing the changes in it left what the file no longer reads as a table, which is not that.
    const shown = (view: string) => readTables(view, parse(view)).length;
    if (shown(newestView(current).text) >= shown(newestView(text).text)) {
      throw new EditError(pendingInTable(read, folded[0] as MarkRange), 'no-legal-placement');
    }
    return {
      changes: changesBetween(text, current),
      caret: caretAfterTable(text, table.from, current),
    };
  }
  let here = left[index] as TableRead;
  if (ctx) {
    // A change of yours that can't be undone (a format change that a later edit altered) stays.
    const stuck = foldedMarks(current, here, read, handle)[0];
    if (stuck) throw new EditError(pendingInTable(read, stuck), 'no-legal-placement');
  }
  const pointed = commentsToPoints(current, read, here, ctx !== null);
  if (pointed !== current) {
    current = pointed;
    read = parse(current);
    here = readTables(current, read)[index] as TableRead;
  }
  let asked: TextChange[];
  try {
    asked = ctx
      ? trackedEdit(current, { from: here.from, to: here.to, insert: '' }, ctx)
      : untrackedEdit(current, { ...plainRange(current, read, here), insert: '' }, plain);
  } catch (error) {
    // The ordinary deletion of a block words its refusals for blocks in general, and some are not so of
    // a table (it speaks of a code block to close, or of a change to make smaller). When what stands
    // next to the table is in the way, say so.
    const words =
      ctx && error instanceof EditError ? wordsNextTo(error, current, read, here) : null;
    throw words === null ? error : new EditError(words, 'no-legal-placement');
  }
  const after = applyChanges(current, asked);
  return {
    changes: current === text ? asked : changesBetween(text, after),
    caret: caretAfterTable(current, here.from, after),
  };
}
