// An edit that no fine form writes so that every order of decisions reads alike, written as a
// replacement of the unit that holds it (format §3.12): the edit is made on the newest view, as
// Track Changes off makes it, and `widen` writes that. `trackedEdits` tries it when its own
// writing is refused, in the places whose lane has been built (`widen-scope.ts`).

import { EditError } from './errors.ts';
import { SYNTAX_ONLY } from './inline.ts';
import { tierOfCode } from './refusals.ts';
import type { TrackedEdits } from './track.ts';
import type { EditContext, TextChange } from './types.ts';
import { newestView } from './views.ts';
import { widensEditHere } from './widen-scope.ts';
import { Untrackable, widen } from './widen.ts';

/**
 * `edits`, each in offsets of `text`, as one replacement of the smallest unit that holds them.
 *
 * @throws `first` when it is no refusal that a replacement sets right, an edit is in a place that
 *   is not widened yet, or no unit holds the change.
 */
export function widenedEdits(
  text: string,
  edits: readonly TextChange[],
  ctx: EditContext,
  first: unknown,
): TrackedEdits {
  if (!(first instanceof EditError) || tierOfCode(first.code) !== 'widen') throw first;
  // An edit on a line that is only syntax is the editor's to answer (a key takes another form).
  if (first.message === SYNTAX_ONLY) throw first;
  const done = widenedAtOnce(text, edits, ctx);
  if (!done) throw first;
  return done;
}

/**
 * `edits` as one replacement of the unit that holds them, with no fine write tried first: for a key
 * whose fine form the format accepts though a reader of the file reads it otherwise than the newest
 * view. Undefined where the place is not widened or no unit holds the change.
 */
export function widenedAtOnce(
  text: string,
  edits: readonly TextChange[],
  ctx: EditContext,
): TrackedEdits | undefined {
  if (edits.length === 0) return undefined;
  if (edits.some((edit) => !widensEditHere(text, edit.from, edit.to))) return undefined;
  try {
    const view = newestView(text);
    const made = edits.map((edit) => ({
      ...edit,
      from: view.map.fromSource(edit.from),
      to: view.map.fromSource(edit.to),
    }));
    const done = widen(text, made, ctx);
    // Another person's pending mark in the old text keeps the refusal: some order of decisions
    // would not read as the original (issue #808).
    if (done.heldByOthers.length > 0) return undefined;
    return { changes: done.changes, markIds: [done.id], extendedIds: [] };
  } catch (error) {
    if (error instanceof Untrackable || error instanceof EditError) return undefined;
    throw error;
  }
}

/**
 * A context that remembers the ids it draws, and a way to get one that draws them again first: the
 * replacement that follows a refused fine write takes the ids that write took, as each way of
 * writing an edit does.
 */
export function recordIds(ctx: EditContext): { ctx: EditContext; replay: () => EditContext } {
  const random = ctx.random;
  if (!random) return { ctx, replay: () => ctx };
  const drawn: Uint8Array[] = [];
  return {
    ctx: {
      ...ctx,
      random: (n) => {
        const bytes = random(n);
        drawn.push(Uint8Array.from(bytes));
        return bytes;
      },
    },
    replay: () => {
      let next = 0;
      return {
        ...ctx,
        random: (n) => {
          const bytes = drawn[next++];
          return bytes?.length === n ? bytes : random(n);
        },
      };
    },
  };
}
