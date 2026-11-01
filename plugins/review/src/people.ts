// Who wrote what, and when, as notes and cards show it (design §5.5): a dot in the person's author
// color, their name, whom an agent acts for, and the time.

import { assignColors, type Author } from '@redlines/editor';
import type { Handle, Parsed, Time } from '@redlines/format';
import { element } from './shared.ts';

const assigned = new WeakMap<Parsed, { me: Handle; colors: Map<Handle, number> }>();

/**
 * The class that draws in a person's author color, the editor's `rl-author-N`, which sets
 * `--rl-color` and `--rl-color-tint`. You have the first color; an unknown author is gray.
 */
export function colorClass(parsed: Parsed, me: Handle, handle: Handle): string {
  let found = assigned.get(parsed);
  if (found?.me !== me) assigned.set(parsed, (found = { me, colors: assignColors(parsed, me) }));
  return `rl-author-${found.colors.get(handle) ?? 0}`;
}

/** How a person is named: by their name, and an agent also by whom it acts for. */
export interface Byline {
  name: string;
  /** The name of the person an agent acts for. */
  for?: string;
}

/** How the person with `handle` is named, from the ledger's people, or you when you aren't in it. */
export function byline(parsed: Parsed, handle: Handle, me: Author): Byline {
  const find = (wanted: Handle) =>
    parsed.ledger.people.find((person) => person.handle === wanted) ??
    (wanted === me.handle ? me : undefined);
  const person = find(handle);
  const name = person?.name || (handle === 'unknown' ? 'Unknown' : handle);
  if (!person?.agent || !person.for) return { name };
  return { name, for: find(person.for)?.name || person.for };
}

/**
 * A ledger time as people read it: the time of day for today, the date and time for this year, and
 * the date for earlier years. Empty when there is no time.
 */
export function formatTime(at: Time, now: Date = new Date()): string {
  const date = new Date(at);
  if (!at || Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  if (date.getFullYear() !== now.getFullYear()) {
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * The line that says who and when: the dot, the name, whom an agent acts for and the time. Its
 * classes start with `prefix`, such as `rl-note`.
 */
export function authorLine(prefix: string, who: Byline, at: Time): HTMLElement {
  const line = element('div', `${prefix}-head`);
  line.append(element('span', 'rl-dot'), element('span', `${prefix}-name`, who.name));
  if (who.for) line.append(element('span', `${prefix}-for`, `for ${who.for}`));
  const shown = formatTime(at);
  if (shown) {
    const time = element('time', `${prefix}-time`, shown);
    time.dateTime = at;
    line.append(time);
  }
  return line;
}
