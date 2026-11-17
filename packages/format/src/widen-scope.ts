// Which lane of the widening an edit belongs to (format §3.12): the place it is made in. A table's
// cell is the table's (R2), a list item or a block in one is the list's (R3), code is the code's
// (R5), and every other block is the block's (R4). `WIDEN_SCOPES` says which are written as a
// replacement; an edit in another place keeps the refusal it has.

import { parse } from './parse.ts';
import { unitsOf } from './widen-units.ts';
import type { Unit } from './widen-units.ts';

export type WidenScope = 'cell' | 'code' | 'list' | 'block';

/** The places whose format changes are widened when no fine form writes them. */
export const WIDEN_SCOPES: ReadonlySet<WidenScope> = new Set<WidenScope>(['cell', 'list', 'block']);

/** The places whose typed, pasted and key edits are widened. The table's own edits go through its
 * operations (`table-widen.ts`), and a cell's typing keeps the rules of the table. */
export const WIDEN_EDIT_SCOPES: ReadonlySet<WidenScope> = new Set<WidenScope>(['list', 'block']);

/** Where the source range `[from, to]` is: by the innermost unit that holds it. */
export function scopeOfUnits(units: readonly Unit[], from: number, to: number): WidenScope {
  let level: readonly Unit[] = units;
  let scope: WidenScope = 'block';
  for (;;) {
    const hit = level.filter((unit) => unit.lineFrom <= to && from <= unit.to);
    const [only] = hit;
    if (hit.length !== 1 || !only) {
      // Several blocks that are the items of a list, or the blocks of one item, are the list's.
      return hit.length > 1 && (hit[0]?.parent?.kind === 'item' || hit[0]?.parent?.kind === 'list')
        ? 'list'
        : scope;
    }
    if (only.kind === 'table') return 'cell';
    if (only.kind === 'code') return 'code';
    if (only.kind === 'item' || only.kind === 'list') scope = 'list';
    if (only.children.length === 0 || only.atomic) return scope;
    level = only.children;
  }
}

/** The scope of a range of the source of `text`. */
export function scopeOf(text: string, from: number, to: number): WidenScope {
  const scope = scopeOfUnits(unitsOf(text, parse(text)), from, to);
  // Display math is the code lane's (R5), as raw HTML and fences are.
  if (scope === 'block' && inDisplayMath(text, from, to)) return 'code';
  return scope;
}

/** Whether a format change in the source range is widened. */
export function widensHere(text: string, from: number, to: number): boolean {
  return WIDEN_SCOPES.has(scopeOf(text, from, to));
}

/** Whether a typed, pasted or key edit in the source range is widened. */
export function widensEditHere(text: string, from: number, to: number): boolean {
  return WIDEN_EDIT_SCOPES.has(scopeOf(text, from, to));
}

/** Whether the range is in a `$$` pair. */
function inDisplayMath(text: string, from: number, to: number): boolean {
  const fences = [...text.matchAll(/^[ \t>]*\$\$/gm)].map((m) => m.index!);
  for (let i = 0; i + 1 < fences.length; i += 2) {
    const open = fences[i]!;
    const end = text.indexOf('\n', fences[i + 1]!);
    if (from <= (end < 0 ? text.length : end) && open <= to) return true;
  }
  return fences.length % 2 === 1 && (fences.at(-1) ?? 0) <= to;
}
