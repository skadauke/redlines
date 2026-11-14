// What an answer to an Ask holds (issue #324): the prose, and the passages of the document it
// cites, which the prompt asks the agent to mark as [1], [2] and list under a line that says
// "Sources:", each as the exact words. A citation is a link to a range of the document, found by
// those words in the text as a reader sees it (the newest view), exactly as an agent's `comment`
// finds its quote: no line number, which would count lines a reader never sees. A quote that isn't
// in the document is no link, which tells a citation that was made up from one that was read.
//
// The answer is an agent's, steered by a document that may be hostile, and the page must not freeze
// on it: every pass over it is linear. A line longer than `LINE_LIMIT` is plain text, never a
// Sources line or an entry; Sources are looked for in the last `SOURCES_WINDOW` characters only; a
// pattern that could backtrack is run on a line with its white space gathered, or isn't one.

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

/** The longest line that is read for Sources: a quote is at most 25 words, so this is generous. */
const LINE_LIMIT = 2000;
/** How far from the end of an answer its Sources are looked for. */
const SOURCES_WINDOW = 20_000;

/**
 * The line that opens the list: "Sources:", on a line of its own, maybe in bold. Matched against a
 * line whose white space is gathered into single spaces (`gathered`), so that no two parts of the
 * pattern can share a run of it.
 */
const SOURCES_LINE = /^(?:\*\*|__)? ?sources? ?:? ?(?:\*\*|__)? ?:?$/i;
/**
 * An entry: a bullet or a number, maybe in brackets, then the words. Matched against a trimmed
 * line, and it always matches, so that it never backtracks.
 */
const ENTRY = /^(?:[-*•–]\s+)?(?:(?:\[(\d+)\]|(\d+)[.)])\s*)?(.*)$/;
/** The marks of a quotation around the words, of any kind. */
const QUOTE_MARKS = '"“”\'‘’`';
/** Every kind of line break an agent's text may hold, which all end a line here. */
const BREAKS = /\r\n?|[\u0085\u2028\u2029]/g;

/** `line` with its white space gathered into single spaces, and trimmed. */
const gathered = (line: string) => line.replace(/\s+/g, ' ').trim();

function isSourcesLine(line: string): boolean {
  return line.length <= LINE_LIMIT && SOURCES_LINE.test(gathered(line));
}

/** Where the last Sources line is, in the end of the answer's `lines`, or -1. */
function sourcesAt(lines: readonly string[]): number {
  let reach = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    reach += line.length + 1;
    if (reach > SOURCES_WINDOW) break;
    if (isSourcesLine(line)) return i;
  }
  return -1;
}

/**
 * `words` without the quotation marks around them, if there are marks on both sides. Marks only:
 * a quote that is itself all marks is nothing.
 */
function unquoted(words: string): string {
  let lead = 0;
  while (lead < words.length && QUOTE_MARKS.includes(words.charAt(lead))) lead++;
  let trail = 0;
  while (trail < words.length && QUOTE_MARKS.includes(words.charAt(words.length - 1 - trail))) {
    trail++;
  }
  if (lead === 0 || trail === 0) return words;
  // A single mark is no pair; marks and nothing between them hold nothing.
  if (lead === words.length) return words.length > 1 ? '' : words;
  return words.slice(lead, words.length - trail);
}

/** Splits an answer into its prose and the passages it cites. */
export function parseAnswer(text: string): ParsedAnswer {
  const lines = text.replace(BREAKS, '\n').split('\n');
  const at = sourcesAt(lines);
  if (at < 0) return { body: lines.join('\n').trim(), sources: [] };
  const sources: Source[] = [];
  let last = 0;
  for (const line of lines.slice(at + 1)) {
    if (line.length > LINE_LIMIT) continue;
    const match = ENTRY.exec(line.trim());
    const words = (match?.[3] ?? '').trim();
    if (!match || words === '') continue;
    const given = match[1] ?? match[2];
    const n = given === undefined ? last + 1 : Number(given);
    const quote = unquoted(words).trim();
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

/** A letter, a digit, or a mark that belongs to one: what a word is made of. */
const WORD_CHAR = /^[\p{L}\p{N}\p{M}]$/u;

/** The character that ends `text` before `at`, whole when it is two UTF-16 units. */
const endingAt = (text: string, at: number): string | undefined =>
  [...text.slice(Math.max(0, at - 2), at)].at(-1);
/** The character that starts `text` at `at`. */
const startingAt = (text: string, at: number): string | undefined =>
  [...text.slice(at, at + 2)].at(0);

/**
 * Every place `quote` is in `haystack`, in order, as indexes into it, where it stands as words: a
 * side that begins or ends in a letter or a digit must not run on into another, so that "lien" is
 * not found in "alien", and one that begins or ends in anything else needs no such edge.
 */
function scan(haystack: string, quote: string): Range[] {
  // Nothing is everywhere, and `indexOf` of it never says there is no more.
  if (quote === '') return [];
  const first = startingAt(quote, 0);
  const last = endingAt(quote, quote.length);
  const openEdge = first !== undefined && WORD_CHAR.test(first);
  const closeEdge = last !== undefined && WORD_CHAR.test(last);
  const places: Range[] = [];
  for (let at = haystack.indexOf(quote); at >= 0; at = haystack.indexOf(quote, at + 1)) {
    const to = at + quote.length;
    const before = endingAt(haystack, at);
    const after = startingAt(haystack, to);
    if (openEdge && before !== undefined && WORD_CHAR.test(before)) continue;
    if (closeEdge && after !== undefined && WORD_CHAR.test(after)) continue;
    places.push({ from: at, to });
  }
  return places;
}

/**
 * Where `quote` is in `haystack`, as indexes into it, every place in order: exactly, or else with
 * any white space the same and curly quotes straight.
 */
function places(haystack: string, quote: string): Range[] {
  const exact = scan(haystack, quote);
  if (exact.length > 0) return exact;
  const wanted = squash(quote).text.trim();
  if (wanted === '') return [];
  const hay = squash(haystack);
  return scan(hay.text, wanted).flatMap(({ from, to }) => {
    const start = hay.index[from];
    const end = hay.index[to - 1];
    return start === undefined || end === undefined ? [] : [{ from: start, to: end + 1 }];
  });
}

/** Of `found`, the place that starts nearest `near`, the earlier of two as near; the first without it. */
function nearest(found: readonly Range[], near: number | undefined): Range | null {
  let best: Range | null = null;
  for (const place of found) {
    if (near === undefined) return place;
    if (best === null || Math.abs(place.from - near) < Math.abs(best.from - near)) best = place;
  }
  return best;
}

/** The fewest characters a quote may have to be found: a single letter is in every word. */
const LEAST = 2;

/**
 * A finder of quotes in the document `text`, which reads the text as a reader sees it once, for
 * all the quotes asked of it: a quote is found in the text without the markers of changes and
 * comments, and without deleted words. A quote with an ellipsis between its parts reaches from the
 * first part to the last. A quote stands where it is words: "lien" is not in "alien", and a
 * quote of one character is nowhere. Where a quote is in several places, the one that starts
 * nearest `near`, a position of the document, is found, and the earlier of two equally near; with
 * no `near`, the first. The range is the document's, markers between its ends included; null when
 * the words are not there.
 */
export function quoteFinder(text: string): (quote: string, near?: number) => Range | null {
  const newest = newestView(text);
  return (quote, near) => {
    const words = quote.trim();
    if ([...words].length < LEAST) return null;
    const around = near === undefined ? undefined : newest.map.fromSource(near);
    let found = nearest(places(newest.text, words), around);
    if (!found) {
      const parts = words
        .split(/…|\.\.\./)
        .map((part) => part.trim())
        .filter((part) => part !== '');
      const first = parts[0];
      const lastPart = parts.at(-1);
      if (parts.length > 1 && first !== undefined && lastPart !== undefined) {
        // From each place of the first part to the first place of the last part after it.
        const ends = places(newest.text, lastPart);
        let next = 0;
        const spans = places(newest.text, first).flatMap((start) => {
          let end = ends[next];
          while (end !== undefined && end.from < start.to) end = ends[++next];
          return end === undefined ? [] : [{ from: start.from, to: end.to }];
        });
        found = nearest(spans, around);
      }
    }
    if (!found) return null;
    return { from: newest.map.toSource(found.from, 1), to: newest.map.toSource(found.to, -1) };
  };
}

/** Where `quote` is in the document `text` (see `quoteFinder`). */
export function findQuote(text: string, quote: string, near?: number): Range | null {
  return quoteFinder(text)(quote, near);
}

/** The text of `range` as a reader sees it: what the person selected, without any markers. */
export function selectionText(text: string, range: Range): string {
  const newest = newestView(text);
  return newest.text.slice(newest.map.fromSource(range.from), newest.map.fromSource(range.to));
}
