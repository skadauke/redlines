// Ids for marks, comments, replies and groups (format-changes §2). An id is four characters: a
// consonant, then three consonants or digits. No vowels, so no words; no 0, 1, l or o; and
// nothing that YAML reads as a number, boolean, date or null.

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';

/** 19 × 27³ = 373,977 */
const ID_COUNT = FIRST.length * REST.length ** 3;

const ID_PATTERN = new RegExp(`^[${FIRST}][${REST}]{3}$`);

/** An id standing alone: not part of a longer word or number. */
const ID_IN_TEXT = new RegExp(`(?<![A-Za-z0-9])[${FIRST}][${REST}]{3}(?![A-Za-z0-9])`, 'g');

/** Whether `s` has the form of an id. */
export function isId(s: string): boolean {
  return ID_PATTERN.test(s);
}

/**
 * Every string in `text` that has the form of an id and stands alone. Markers, the ledger and
 * history blocks all count, so the result is what `newId` should treat as taken (format §2.3: the
 * id is drawn again "while the id is used anywhere in the document"). It may hold a few strings
 * that are only words; avoiding them costs nothing.
 */
export function idsIn(text: string): Set<string> {
  return new Set(text.match(ID_IN_TEXT) ?? []);
}

/**
 * Draws a random id that isn't in `taken`, which should hold every id used in the document.
 *
 * @param random Returns `n` random bytes. Defaults to `crypto.getRandomValues`; tests pass their
 *   own.
 */
export function newId(
  taken: ReadonlySet<string>,
  random: (n: number) => Uint8Array = randomBytes,
): string {
  if (taken.size >= ID_COUNT && [...taken].filter(isId).length === ID_COUNT) {
    throw new Error(`All ${ID_COUNT} ids are taken`);
  }
  for (;;) {
    let id = pick(FIRST, random);
    for (let i = 1; i < 4; i++) id += pick(REST, random);
    if (!taken.has(id)) return id;
  }
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * Picks a character of `alphabet` with equal odds. A byte picks `alphabet[byte % length]`; bytes
 * at or above the largest multiple of the length would favor the first characters, so they are
 * drawn again (rejection sampling).
 */
function pick(alphabet: string, random: (n: number) => Uint8Array): string {
  const limit = 256 - (256 % alphabet.length);
  for (;;) {
    const [byte] = random(1);
    if (byte === undefined) throw new Error('random(1) returned no bytes');
    if (byte < limit) return alphabet.charAt(byte % alphabet.length);
  }
}
