// What an answer to an Ask holds (issue #324): the prose, and the passages of the document it
// cites, which the prompt asks the agent to mark as [1], [2] and list under a line that says
// "Sources:", each as the exact words. A citation is a link to a range of the document, found by
// those words in the text as a reader sees it (the newest view), exactly as an agent's `comment`
// finds its quote: no line number, which would count lines a reader never sees. A quote that isn't
// in the document is no link, which tells a citation that was made up from one that was read.

import { newestView, type Range } from '@redlines/format';

/** One passage the answer cites. */
export interface Source {
  n: number;
  /** The words, as the agent copied them. */
  quote: string;
}

export interface ParsedAnswer {
  /** The answer's prose, with its [1] markers, without the Sources. */
  body: string;
  sources: Source[];
}

/** The line that opens the list: "Sources:", on a line of its own, maybe in bold. */
const SOURCES_LINE = /^\s*(?:\*\*|__)?\s*sources?\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;
/** An entry: a bullet or a number, maybe in brackets, then the words. */
const ENTRY = /^\s*(?:[-*•–]\s+)?(?:\[(\d+)\]|(\d+)[.)])?\s*(.*?)\s*$/;
/** Quotes around the words, of any kind. */
const QUOTED = /^(?:["“”'‘’`]+)([\s\S]*?)(?:["“”'‘’`]+)$/;

/** Splits an answer into its prose and the passages it cites. */
export function parseAnswer(text: string): ParsedAnswer {
  const lines = text.replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n').split('\n');
  const at = lines.findLastIndex((line) => SOURCES_LINE.test(line));
  if (at < 0) return { body: lines.join('\n').trim(), sources: [] };
  const sources: Source[] = [];
  let last = 0;
  for (const line of lines.slice(at + 1)) {
    const match = ENTRY.exec(line);
    if (!match || (match[3] ?? '') === '') continue;
    const given = match[1] ?? match[2];
    const n = given === undefined ? last + 1 : Number(given);
    const words = (match[3] ?? '').trim();
    const quote = QUOTED.exec(words)?.[1]?.trim() ?? words;
    if (quote === '') continue;
    sources.push({ n, quote });
    last = n;
  }
  return { body: lines.slice(0, at).join('\n').trim(), sources };
}

/** A character as it is compared: curly quotes are straight, and any white space one space. */
function plain(char: string): string {
  if (/[“”]/.test(char)) return '"';
  if (/[‘’]/.test(char)) return "'";
  return /\s/.test(char) ? ' ' : char;
}

/** `text` with its white space gathered and its quotes straightened, and where each character was. */
function squash(text: string): { text: string; index: number[] } {
  let out = '';
  const index: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const next = plain(text[i] ?? '');
    if (next === ' ' && out.endsWith(' ')) continue;
    out += next;
    index.push(i);
  }
  return { text: out, index };
}

/**
 * Where `quote` is in `haystack`, as indexes into it: exactly, or with any white space the same and
 * curly quotes straight. Null when it isn't there.
 */
function locate(haystack: string, quote: string): { from: number; to: number } | null {
  const exact = haystack.indexOf(quote);
  if (exact >= 0) return { from: exact, to: exact + quote.length };
  const wanted = squash(quote).text.trim();
  if (wanted === '') return null;
  const hay = squash(haystack);
  const found = hay.text.indexOf(wanted);
  if (found < 0) return null;
  const from = hay.index[found];
  const last = hay.index[found + wanted.length - 1];
  return from === undefined || last === undefined ? null : { from, to: last + 1 };
}

/**
 * A finder of quotes in the document `text`, which reads the text as a reader sees it once, for
 * all the quotes asked of it: a quote is found in the text without the markers of changes and
 * comments, and without deleted words. A quote with an ellipsis between its parts reaches from the
 * first part to the last. Several places are the first. The range is the document's, markers
 * between its ends included; null when the words are not there.
 */
export function quoteFinder(text: string): (quote: string) => Range | null {
  const newest = newestView(text);
  return (quote) => {
    const words = quote.trim();
    if (words === '') return null;
    let found = locate(newest.text, words);
    if (!found) {
      const parts = words
        .split(/\s*(?:…|\.\.\.)\s*/)
        .map((part) => part.trim())
        .filter((part) => part !== '');
      const first = parts[0];
      const lastPart = parts.at(-1);
      if (parts.length > 1 && first !== undefined && lastPart !== undefined) {
        const start = locate(newest.text, first);
        const end = start ? locate(newest.text.slice(start.to), lastPart) : null;
        if (start && end) found = { from: start.from, to: start.to + end.to };
      }
    }
    if (!found) return null;
    return { from: newest.map.toSource(found.from, 1), to: newest.map.toSource(found.to, -1) };
  };
}

/** Where `quote` is in the document `text` (see `quoteFinder`). */
export function findQuote(text: string, quote: string): Range | null {
  return quoteFinder(text)(quote);
}

/** The text of `range` as a reader sees it: what the person selected, without any markers. */
export function selectionText(text: string, range: Range): string {
  const newest = newestView(text);
  return newest.text.slice(newest.map.fromSource(range.from), newest.map.fromSource(range.to));
}
