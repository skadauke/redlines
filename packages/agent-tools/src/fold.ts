// How an agent's comment is written and shown (design "How agents write"): a short reply, with
// the longer message after a blank line in the same comment, which the app folds behind More.

/** What an agent may write. A longer reply is an error that says to shorten it. */
export const LIMITS = { reply: 200, details: 2000, status: 40, note: 200 } as const;

/** A blank line, in text whose line breaks are `\n`: a line break, then a line of nothing but
 * whitespace of any kind, or none, then a line break. */
const BLANK_LINE = /\n\s*\n/;

/** `s` with every line break, `\r\n`, a lone `\r` and the Unicode ones, as `\n`. Text is checked
 * after this, because readers differ in what they call a line break. */
export function normalizeBreaks(s: string): string {
  return s.replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n');
}

/** How many characters a text has, an emoji or a letter with a surrogate pair as one. */
export function sizeOf(s: string): number {
  return Array.from(s).length;
}

/** Whether `s` holds a blank line. */
export function hasBlankLine(s: string): boolean {
  return BLANK_LINE.test(normalizeBreaks(s));
}

/** The reply, and its details after a blank line when there are any. */
export function joinReply(text: string, details?: string): string {
  const more = details?.trim() ?? '';
  return more === '' ? text : `${text}\n\n${more}`;
}

/** What a comment shows and what folds behind More, for an agent's comment: the first paragraph,
 * and the rest. */
export function foldComment(text: string): { shown: string; more: string | null } {
  // Blank lines at the start are not a paragraph: a comment never shows empty.
  const whole = normalizeBreaks(text).replace(/^\s+/, '');
  const match = BLANK_LINE.exec(whole);
  if (match === null) return { shown: whole, more: null };
  const more = whole.slice(match.index + match[0].length);
  return { shown: whole.slice(0, match.index), more: more.trim() === '' ? null : more };
}

/** `s` cut to at most `max` characters, at a word when there is one, with `…` at the end. */
function cutAtWord(s: string, max: number): { kept: string; rest: string } {
  const chars = Array.from(s);
  if (chars.length <= max) return { kept: s, rest: '' };
  const room = chars.slice(0, max - 1);
  // Cut back to the end of a word, unless that would leave hardly anything of the text.
  let end = room.length;
  if (!/\s/.test(chars[room.length] ?? '')) {
    const space = room.findLastIndex((c) => /\s/.test(c));
    if (space > room.length / 2) end = space;
  }
  const kept = room.slice(0, end).join('').trimEnd();
  return { kept: `${kept}…`, rest: chars.slice(end).join('').trim() };
}

/**
 * A last message as a reply that fits: for an agent that ended without calling `reply`. The first
 * paragraph is the reply, cut at a word if it is over the limit; the rest is the details, cut to
 * theirs.
 */
export function fitReply(message: string): { text: string; details?: string } {
  const whole = normalizeBreaks(message).trim();
  const match = BLANK_LINE.exec(whole);
  const first = match === null ? whole : whole.slice(0, match.index);
  const after = match === null ? '' : whole.slice(match.index + match[0].length);
  const { kept, rest } = cutAtWord(first, LIMITS.reply);
  const tail = [rest, after.trim()].filter((part) => part !== '').join(rest === '' ? '' : ' ');
  if (tail === '') return { text: kept };
  return { text: kept, details: cutAtWord(tail, LIMITS.details).kept };
}
