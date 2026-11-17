// The words of the simulated documents. Every word is a unique token, so that the oracle can say
// which text survived. A token never has the form of an id (it starts with a vowel), and a typed
// token names its author: `eb007` was typed by the second client.

import { newestView, originalView } from '@redlines/format';
import type { Range } from '@redlines/format';

/** No word boundary: two words that have been joined are still two tokens, and `joined` says so. */
export const TOKEN = /u\d{3,}|e[a-e]\d{3,}/g;

/** The people of a session, in order. */
export const PEOPLE = [
  { handle: 'ada', name: 'Ada', letter: 'a' },
  { handle: 'bo', name: 'Bo', letter: 'b' },
  { handle: 'cy', name: 'Cy', letter: 'c' },
  { handle: 'di', name: 'Di', letter: 'd' },
  { handle: 'ed', name: 'Ed', letter: 'e' },
] as const;

export type Actor = { handle: string; name: string };

export const handleOfLetter = (letter: string): string | undefined =>
  PEOPLE.find((person) => person.letter === letter)?.handle;

/** The letter of the person who typed a typed token; undefined for a token of the first text. */
export const typistOf = (token: string): string | undefined =>
  token.startsWith('e') ? token[1] : undefined;

export function tokensOf(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

export interface VisibleToken extends Range {
  token: string;
}

/** The tokens of a text, with their offsets in it. */
export function tokenRanges(text: string): VisibleToken[] {
  const out: VisibleToken[] = [];
  for (const match of text.matchAll(TOKEN)) {
    out.push({ token: match[0], from: match.index, to: match.index + match[0].length });
  }
  return out;
}

/** Pairs of tokens with nothing between them: two words that read as one. */
export function joined(text: string): string[] {
  const out: string[] = [];
  let last: VisibleToken | undefined;
  for (const t of tokenRanges(text)) {
    if (last && last.to === t.from) out.push(`${last.token}${t.token}`);
    last = t;
  }
  return out;
}

/** How many times each token stands in a text. */
export function tokenCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokensOf(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

export const newestTokens = (text: string): Map<string, number> =>
  tokenCounts(newestView(text).text);
export const originalTokens = (text: string): Map<string, number> =>
  tokenCounts(originalView(text).text);

/** The first text of a session: a heading and `paragraphs` paragraphs of `words` words each. */
export function baseDocument(paragraphs: number, words: number): string {
  let n = 0;
  const word = () => `u${String(n++).padStart(3, '0')}`;
  const blocks = [`# ${word()} ${word()}`];
  for (let p = 0; p < paragraphs; p++) {
    blocks.push(Array.from({ length: words }, word).join(' '));
  }
  return blocks.join('\n\n') + '\n';
}

/** The time of a moment `ms` into a session, to the minute, as the ledger writes it. */
export function timeAt(ms: number): string {
  return new Date(Date.UTC(2026, 10, 16, 9, 0) + ms).toISOString().slice(0, 16) + 'Z';
}
