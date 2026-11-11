// What a run of emphasis delimiters can do, from the characters on either side of it (CommonMark's
// left- and right-flanking runs, as micromark reads them, with GFM's `~`): the one reading that
// formats (§2.6) and the places of markers (§3.1) share.

export const isSpace = (c: string | undefined): boolean => c === undefined || /\s/u.test(c);
/** CommonMark's punctuation since 0.31, which has the symbols, such as emoji. */
export const isPunctuation = (c: string | undefined): boolean =>
  c !== undefined && /[\p{P}\p{S}]/u.test(c);
/** Punctuation as GitHub still reads it: an emoji is not. A change must read right either way. */
export const isOlderPunctuation = (c: string | undefined): boolean =>
  c !== undefined && /[\p{P}$+<=>^`|~]/u.test(c);

/** Whether a run of `char` with `before` and `after` next to it can open an emphasis, and can close
 * one. micromark reads a `*` or `_` next to a `~` as if the `~` were a letter on the far side: a run
 * before a `~` can open, and a run after a `~` can close (#238). */
export function runRole(
  char: string,
  before: string | undefined,
  after: string | undefined,
  punctuation: (c: string | undefined) => boolean,
): { open: boolean; close: boolean } {
  const left =
    (!isSpace(after) && (!punctuation(after) || isSpace(before) || punctuation(before))) ||
    (char !== '~' && after === '~');
  const right =
    (!isSpace(before) && (!punctuation(before) || isSpace(after) || punctuation(after))) ||
    (char !== '~' && before === '~');
  return {
    open: char === '_' ? left && (!right || punctuation(before)) : left,
    close: char === '_' ? right && (!left || punctuation(after)) : right,
  };
}
