// Author colors (design §5.5, §6.6). Color means a person: you take the first of the theme's
// eight author colors, and everyone else takes the next one in order of first appearance, starting
// again at the second past the eighth. An author nobody recorded is gray.

import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Handle, Parsed } from '@redlines/format';
import { authorFacet, parsedField } from './field.ts';

/** Colors 2 to 8 go to other people. */
const OTHERS = 7;

/**
 * Each person's author color: 1 for `me`, then 2 to 8 in order of first appearance, repeating, and
 * 0, gray, for `unknown`. People appear with their marks in document order, comment replies after
 * their thread, and the authors of detached threads last.
 */
export function assignColors(parsed: Parsed, me: Handle): Map<Handle, number> {
  const colors = new Map<Handle, number>([[me, 1]]);
  let others = 0;
  const add = (handle: Handle) => {
    if (!colors.has(handle)) colors.set(handle, handle === 'unknown' ? 0 : 2 + (others++ % OTHERS));
  };
  const threads = new Map(parsed.ledger.comments.map((thread) => [thread.id, thread]));
  for (const mark of parsed.marks) {
    add(mark.entry.by);
    for (const reply of threads.get(mark.id)?.replies ?? []) add(reply.by);
    threads.delete(mark.id);
  }
  for (const thread of threads.values()) {
    add(thread.by);
    for (const reply of thread.replies) add(reply.by);
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
