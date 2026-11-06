// Who wrote what, and when, as notes and cards show it (design §5.5): a dot in the person's author
// color, their name, whom an agent acts for, and the time.

import type { EditorState } from '@codemirror/state';
import { colorsOf, type Author } from '@redlines/editor';
import type { Handle, Parsed, Time } from '@redlines/format';
import { element } from './shared.ts';

/**
 * The class that draws in a person's author color, the editor's `rl-author-N`, which sets
 * `--rl-color` and `--rl-color-tint`. The editor decides the colors (it knows the people this
 * machine has met), so that a note, a card and the text itself agree. You have the first color; an
 * unknown author is gray.
 */
export function colorClass(state: EditorState, handle: Handle): string {
  return `rl-author-${colorsOf(state).get(handle) ?? 0}`;
}

/** How a person is named: by their name, and an agent also by whom it acts for. */
export interface Byline {
  name: string;
  /** The first name of the person an agent acts for, as in "Claude for Ada". */
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
  const principal = find(person.for)?.name.trim();
  return { name, for: principal?.split(/\s+/)[0] || person.for };
}

/**
 * A ledger time as people read it: the time of day for today, the date and time for this year, and
 * the date for earlier years. `short` leaves out the time of day on other days, for where there is
 * little room. Empty when there is no time.
 */
export function formatTime(at: Time, now: Date = new Date(), short = false): string {
  const date = new Date(at);
  if (!at || Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  if (date.getFullYear() !== now.getFullYear()) {
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return short ? day : `${day}, ${time}`;
}

/**
 * The line that says who and when: the dot, the name, whom an agent acts for and the time. Its
 * classes start with `prefix`, such as `rl-note`. A `short` time has the full time as its hint.
 */
export function authorLine(prefix: string, who: Byline, at: Time, short = false): HTMLElement {
  const line = element('div', `${prefix}-head`);
  line.append(element('span', 'rl-dot'), element('span', `${prefix}-name`, who.name));
  if (who.for) line.append(element('span', `${prefix}-for`, `for ${who.for}`));
  const shown = formatTime(at, new Date(), short);
  if (shown) {
    const time = element('time', `${prefix}-time`, shown);
    time.dateTime = at;
    if (short) time.title = formatTime(at);
    line.append(time);
  }
  return line;
}
