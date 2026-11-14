// Alerts (#311, format §2.6): `> [!NOTE]` and its kin. A quote whose first line is a type in brackets
// is a GitHub alert, which the editor draws as a box; its type is changed by a block format change,
// `was=callout-TYPE`, that is written as a mark around the whole alert. This file has what knows no
// text of a file: the types and how they are written. Nothing in it reads a document.

/** GitHub's five types, which the serializer writes in capitals (`[!NOTE]`). Any other type is
 * written in lowercase (`[!info]`), and is offered only where a file has it already. */
export const GITHUB_TYPES: readonly string[] = ['note', 'tip', 'important', 'warning', 'caution'];

/** A type, as a `was=` operation and a command have it: lowercase letters, digits and hyphens, from
 * a letter. */
export const CALLOUT_TYPE = /^[a-z][a-z0-9-]*$/;

/** The type of an alert as written in the file, in the brackets after `[!`: any case. */
const WORD = /^[A-Za-z][A-Za-z0-9-]*$/;

/** The first line of an alert, after its quote's `> `: the type in brackets, where it starts. A
 * title or a fold mark after it is another editor's, and is kept as it is. */
export const ALERT_LINE = /^\[!([A-Za-z][A-Za-z0-9-]*)\]/;

/** How the serializer writes a type in the brackets. */
export const calloutWord = (type: string): string =>
  GITHUB_TYPES.includes(type) ? type.toUpperCase() : type;

/** What an alert was: its type, and the word it was written with. */
export interface CalloutWas {
  type: string;
  word: string;
}

/**
 * The type and the old syntax of a `was=callout-TYPE` value (`callout-note` is an alert written
 * `[!NOTE]`, as the serializer writes it; `callout-note=note` one written `[!note]`). Undefined for
 * anything else, and for a word that spells another type than the one named: rejecting writes
 * back only what the type could have been written with.
 */
export function readCalloutWas(value: string | undefined): CalloutWas | undefined {
  if (value === undefined || !value.startsWith('callout-')) return undefined;
  const equals = value.indexOf('=');
  const type = value.slice('callout-'.length, equals === -1 ? undefined : equals);
  if (!CALLOUT_TYPE.test(type)) return undefined;
  if (equals === -1) return { type, word: calloutWord(type) };
  const word = value.slice(equals + 1);
  return WORD.test(word) && word.toLowerCase() === type ? { type, word } : undefined;
}

/** The type that the word in an alert's brackets names. */
export const typeOfWord = (word: string): string => word.toLowerCase();

/** The `was=` operation of an alert with the type written as `word`. */
export function calloutWas(word: string, encode: (value: string) => string): string {
  const type = typeOfWord(word);
  return word === calloutWord(type) ? `was=callout-${type}` : `was=callout-${type}=${encode(word)}`;
}
