// Author colors (design §5.5, §6.6). Color means a person, and people keep their colors: you take
// the first of the theme's eight author colors, and everyone else the color that their handle
// leads to, which stays theirs when changes are decided and is the same in every document. Two
// people whose handles lead to the same color are told apart: the one later in the order of
// handles takes the next color that nobody has. Past seven other people, colors repeat. An author
// nobody recorded is gray.

import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Handle, Parsed } from '@redlines/format';
import { authorFacet, parsedField } from './field.ts';

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

/**
 * Each person's author color: 1 for `me`, 0, gray, for `unknown`, and 2 to 8 for everyone else in
 * the document, which are its people (who stay in the ledger), the authors of its marks, and those
 * of its threads and their replies. In the order of their handles, each takes the color their
 * handle leads to, or when someone took that, the next color nobody has; once all seven are taken,
 * they are given out again.
 */
export function assignColors(parsed: Parsed, me: Handle): Map<Handle, number> {
  const people = new Set<Handle>(parsed.ledger.people.map(({ handle }) => handle));
  for (const mark of parsed.marks) people.add(mark.entry.by);
  for (const thread of parsed.ledger.comments) {
    people.add(thread.by);
    for (const reply of thread.replies) people.add(reply.by);
  }
  const colors = new Map<Handle, number>([[me, 1]]);
  let taken = new Set<number>();
  for (const handle of [...people].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (colors.has(handle)) continue;
    if (handle === 'unknown') {
      colors.set(handle, 0);
      continue;
    }
    if (taken.size === OTHERS) taken = new Set();
    let color = colorOfHandle(handle);
    while (taken.has(color)) color = 2 + ((color - 1) % OTHERS);
    taken.add(color);
    colors.set(handle, color);
  }
  return colors;
}

const assigned = new WeakMap<Parsed, { me: Handle; colors: Map<Handle, number> }>();

/** The author colors of a state's document, for its editing author. */
export function colorsOf(state: EditorState): Map<Handle, number> {
  const parsed = state.field(parsedField);
  const me = state.facet(authorFacet)?.handle ?? '';
  let found = assigned.get(parsed);
  if (found?.me !== me) assigned.set(parsed, (found = { me, colors: assignColors(parsed, me) }));
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
