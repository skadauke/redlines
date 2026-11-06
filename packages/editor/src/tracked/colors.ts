// Author colors (design §5.5, §6.6). Color means a person, and people keep their colors: you take
// the first of the theme's eight author colors, and everyone else the color that their handle
// leads to, which stays theirs when changes are decided and is the same in every document. Two
// people whose handles lead to the same color are told apart: the one later in the order of
// handles takes the next color that nobody has. Past seven other people, colors repeat. An author
// nobody recorded is gray.
//
// A host that keeps a record of the people this machine has met (`MetPerson`, in the order they
// were met) gives each person the color they were given when first met, in every document. The
// editor only reads the record, and tells the host whom it has no color for (`unmetIn`).

import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Handle, Parsed } from '@redlines/format';
import { authorFacet, parsedField, peopleFacet } from './field.ts';
import type { MetPerson } from '../api.ts';

/** Colors 2 to 8 go to other people. */
const OTHERS = 7;

/** The color a handle leads to, 2 to 8, from its FNV-1a hash. */
function colorOfHandle(handle: Handle): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < handle.length; i++) {
    hash = Math.imul(hash ^ handle.charCodeAt(i), 0x01000193);
  }
  return 2 + ((hash >>> 0) % OTHERS);
}

/** The people of a document: its ledger's, its marks' authors, its threads' and their replies'. */
function peopleOf(parsed: Parsed): Set<Handle> {
  const people = new Set<Handle>(parsed.ledger.people.map(({ handle }) => handle));
  for (const mark of parsed.marks) people.add(mark.entry.by);
  for (const thread of parsed.ledger.comments) {
    people.add(thread.by);
    for (const reply of thread.replies) people.add(reply.by);
  }
  return people;
}

const byHandle = (a: Handle, b: Handle) => (a < b ? -1 : a > b ? 1 : 0);

/** Whether someone is given a color of the palette's others: not you, and not an unknown author. */
const colored = (handle: Handle, me: Handle) => handle !== me && handle !== 'unknown';

/** The color of the `n`th person met (from 0): 2 to 8, then around again. */
const colorOfNth = (n: number) => 2 + (n % OTHERS);

/**
 * The record with `handles` added, each with the next color in the order of meeting. Without
 * anyone new (not counting an unknown author), the record itself.
 */
export function meetPeople(met: readonly MetPerson[], handles: readonly Handle[]): MetPerson[] {
  const next = [...met];
  const known = new Set(met.map(({ handle }) => handle));
  for (const handle of handles) {
    if (handle === 'unknown' || known.has(handle)) continue;
    known.add(handle);
    next.push({ handle, color: colorOfNth(next.length) });
  }
  return next.length === met.length ? (met as MetPerson[]) : next;
}

/** The people of a document, other than you, whom the record has no color for, in handle order. */
export function unmetIn(parsed: Parsed, me: Handle, met: readonly MetPerson[]): Handle[] {
  const known = new Set(met.map(({ handle }) => handle));
  return [...peopleOf(parsed)]
    .filter((handle) => colored(handle, me) && !known.has(handle))
    .sort(byHandle);
}

/**
 * Each person's author color: 1 for `me`, 0, gray, for `unknown`, and 2 to 8 for everyone else in
 * the document.
 *
 * Without a record of people, in the order of their handles, each takes the color their handle
 * leads to, or when someone took that, the next color nobody has; once all seven are taken, they
 * are given out again.
 *
 * With one, each takes the color the record gave them, in the order they were met, and someone it
 * lacks (whom the host is about to record) the next color in order. Two people with one color
 * (the record repeats colors past seven) are told apart for this document alone: the later-met
 * takes the next color nobody here has.
 */
export function assignColors(
  parsed: Parsed,
  me: Handle,
  met?: readonly MetPerson[] | null,
): Map<Handle, number> {
  const people = peopleOf(parsed);
  const colors = new Map<Handle, number>([[me, 1]]);
  let taken = new Set<number>();
  const give = (handle: Handle, wanted: number) => {
    if (taken.size === OTHERS) taken = new Set();
    let color = wanted;
    while (taken.has(color)) color = 2 + ((color - 1) % OTHERS);
    taken.add(color);
    colors.set(handle, color);
  };
  if (people.has('unknown')) colors.set('unknown', 0);
  if (!met) {
    for (const handle of [...people].sort(byHandle)) {
      if (!colored(handle, me)) continue;
      give(handle, colorOfHandle(handle));
    }
    return colors;
  }
  const order = new Map<Handle, number>();
  for (const { handle, color } of met) {
    if (colored(handle, me) && !order.has(handle)) order.set(handle, color);
  }
  for (const [handle, color] of order) {
    if (people.has(handle)) give(handle, color >= 2 && color <= 8 ? color : colorOfNth(0));
  }
  let count = order.size;
  for (const handle of unmetIn(parsed, me, met)) give(handle, colorOfNth(count++));
  return colors;
}

const assigned = new WeakMap<
  Parsed,
  { me: Handle; met: readonly MetPerson[] | null; colors: Map<Handle, number> }
>();

/** The author colors of a state's document, for its editing author. */
export function colorsOf(state: EditorState): Map<Handle, number> {
  const parsed = state.field(parsedField);
  const me = state.facet(authorFacet)?.handle ?? '';
  const met = state.facet(peopleFacet);
  let found = assigned.get(parsed);
  if (found?.me !== me || found.met !== met) {
    assigned.set(parsed, (found = { me, met, colors: assignColors(parsed, me, met) }));
  }
  return found.colors;
}

/** The class that draws in an author color, by setting `--rl-color` and `--rl-color-tint`. */
export function colorClass(color: number): string {
  return `rl-author-${color}`;
}

export const colorTheme = EditorView.baseTheme({
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [
      `.${colorClass(n)}`,
      { '--rl-color': `var(--rl-author-${n})`, '--rl-color-tint': `var(--rl-author-${n}-tint)` },
    ]),
  ),
  // Gray for an unknown author. Its text is in the second ink, which, unlike the change bars'
  // --rl-mixed, keeps the contrast of an author color.
  [`.${colorClass(0)}`]: {
    '--rl-color': 'var(--rl-ink-2)',
    '--rl-color-tint': 'color-mix(in srgb, var(--rl-ink-2) 17%, transparent)',
  },
});
