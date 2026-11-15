// The marks in the old text of a replacement (format §3.12). The parser reads them (`parse.ts`) with
// offsets in the decoded payload; this file is what the rest of the engine asks of them: the old
// text as the views show it, a mark found by its id, and the payload as a file of its own, so that a
// decision in it is made by the code that decides in a file.

import { eolOf, inEol } from './changes.ts';
import type { Eol } from './changes.ts';
import { CONTAINER_PREFIX } from './blocks.ts';
import { serializeLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { scanPayload } from './scan.ts';
import type { Ledger, MarkRange, Parsed, PayloadMarks, Segment } from './types.ts';
import { newestView, originalView } from './views.ts';

/** The ids of the marks that a payload holds, at every depth, and those of the payloads inside. */
function idsOfSite(site: PayloadMarks, ids = new Set<string>()): Set<string> {
  for (const mark of site.marks) ids.add(mark.id);
  for (const deeper of site.payloads) idsOfSite(deeper, ids);
  return ids;
}

/**
 * The ledger that a payload's file holds, as text with LF line breaks: only the entries of the
 * marks that the payload holds. An id that stands elsewhere in the file has none, so the payload's
 * file reads it as text, as the parser of the whole file does.
 */
export function ledgerFor(parsed: Parsed, ids: ReadonlySet<string>): string {
  const marks: Ledger['marks'] = {};
  for (const [id, entry] of Object.entries(parsed.ledger.marks)) if (ids.has(id)) marks[id] = entry;
  const comments = parsed.ledger.comments.filter((thread) => ids.has(thread.id));
  return serializeLedger({ ...parsed.ledger, marks, comments }).replace(/[\r\n]+$/, '');
}

/**
 * The ledger for one payload: the entries of the marks it holds, and of the markers in it that are
 * too deep to be read as marks of the file, which become marks when the replacement above them is
 * rejected (so the views, which show the file after that, read them as the marks they will be).
 * An id that stands in the body, or twice in the payloads, has none: it is text.
 */
export function ledgerForSite(parsed: Parsed, site: PayloadMarks): string {
  const ids = idsOfSite(site);
  const top = new Set(parsed.marks.map((mark) => mark.id));
  const seen = new Map<string, number>();
  const count = (text: string, depth: number) => {
    if (depth > 8 || !text.includes('<!--')) return;
    for (const marker of scanPayload(text).markers) {
      if (marker.type !== 'open') continue;
      seen.set(marker.id, (seen.get(marker.id) ?? 0) + 1);
      if (marker.payload !== undefined) count(marker.payload, depth + 1);
    }
  };
  count(site.text, 0);
  for (const [id, times] of seen) if (times === 1 && !top.has(id)) ids.add(id);
  return ledgerFor(parsed, ids);
}

/**
 * What stands before a payload's opener on its line when the line starts with a container's prefix
 * (`> `, `- `, indentation): the payload's file starts with it, so that what is decided in it sees
 * the lines as they stand in the file. `whole` is the text that holds the opener, with its own
 * prefix, and `from` where the opener starts in it.
 */
export function prefixBefore(whole: string, from: number): string {
  const before = whole
    .slice(whole.lastIndexOf('\n', from - 1) + 1, from)
    .replace(/<!--.*?-->/g, '');
  return CONTAINER_PREFIX.test(before) ? before : '';
}

/** The prefix of each payload in a chain, outermost first. */
export function prefixesOf(text: string, parsed: Parsed, chain: readonly PayloadMarks[]): string[] {
  const prefixes: string[] = [];
  let whole = text;
  let offset = 0;
  for (const [depth, site] of chain.entries()) {
    const holder =
      depth === 0
        ? parsed.marks.find((mark) => mark.id === site.owner)
        : chain[depth - 1]?.marks.find((mark) => mark.id === site.owner);
    const open = holder?.segments[site.segment]?.open;
    const prefix = open ? prefixBefore(whole, open.from + offset) : '';
    prefixes.push(prefix);
    whole = prefix + site.text;
    offset = prefix.length;
  }
  return prefixes;
}

/**
 * A payload as a file: a line break to stand after something, as the text of a unit does in a
 * file, the prefix and the payload, and a ledger. The first line break keeps a payload that starts
 * with `---` from being read as front matter. Nothing in it is the ledger's but the end.
 */
export function payloadFile(payload: string, ledger: string): string {
  return `\n${payload}\n\n${ledger}`;
}

/** The payload, from the file made by `payloadFile` or one that a decision made of it. */
export function payloadOfFile(proxy: string, parsed: Parsed): string {
  const body = parsed.ledgerRange ? proxy.slice(0, parsed.ledgerRange.from) : proxy;
  return body.replace(/^\n/, '');
}

/** What a view of a payload's file leaves of the payload: without the line break in front, and
 * without the prefix. Where the view has lost the prefix, as it does not, the text as it is. */
function withoutPrefix(view: string, prefix: string): string {
  const text = view.replace(/^\n/, '');
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * Whether the ledger stands where `payloadFile` put it. A payload that ends inside a comment or a
 * code fence that it never closes takes the ledger into it, and what is decided in such a file
 * would write the ledger into the old text.
 */
export function intact(proxy: string, payload: string): boolean {
  const read = parse(proxy);
  return read.ledgerRange !== null && payloadOfFile(proxy, read) === payload;
}

/** The old text of a payload as the original view shows it: its own marks rejected. Where the
 * payload takes the ledger into itself (`intact`), the old text as it is. */
export function originalOfPayload(payload: string, ledger: string, prefix = ''): string {
  const proxy = payloadFile(prefix + payload, ledger);
  if (!intact(proxy, prefix + payload)) return payload;
  return withoutPrefix(originalView(proxy).text, prefix);
}

/** The old text of a payload as the newest view shows it: its own marks accepted. */
export function newestOfPayload(payload: string, ledger: string, prefix = ''): string {
  const proxy = payloadFile(prefix + payload, ledger);
  if (!intact(proxy, prefix + payload)) return payload;
  return withoutPrefix(newestView(proxy).text, prefix);
}

/** The payload of one segment of a mark that holds marks, if it does. */
export function payloadAt(
  parsed: Parsed,
  mark: MarkRange,
  segment: Segment,
): PayloadMarks | undefined {
  const index = mark.segments.indexOf(segment);
  return parsed.payloads.find((site) => site.owner === mark.id && site.segment === index);
}

/** The text a segment's payload restores when the mark is rejected, in the file's line breaks:
 * the old text, with the marks it holds live again (format §3.12). */
export function restoredText(segment: Segment, eol: Eol): string {
  return inEol(segment.payload ?? '', eol);
}

/** What the original view brings back for a segment of a deletion or a substitution: the old text
 * with the marks it holds rejected, in the file's line breaks. */
export function originalText(
  text: string,
  parsed: Parsed,
  mark: MarkRange,
  segment: Segment,
): string {
  const payload = segment.payload ?? '';
  const eol = eolOf(text, parsed.ledgerRange);
  const site = payloadAt(parsed, mark, segment);
  // A payload that holds no mark is the old text as it is.
  const old = site
    ? originalOfPayload(payload, ledgerForSite(parsed, site), prefixBefore(text, segment.open.from))
    : payload;
  return inEol(old, eol);
}

/** Every mark that payloads hold, with the chain of payloads it is in, outermost first. */
export interface PayloadFound {
  mark: MarkRange;
  chain: PayloadMarks[];
}

/** The marks that payloads hold, at every depth, in the order of the body. */
export function payloadMarksOf(parsed: Parsed): PayloadFound[] {
  const found: PayloadFound[] = [];
  const walk = (sites: readonly PayloadMarks[], chain: PayloadMarks[]) => {
    for (const site of sites) {
      const here = [...chain, site];
      for (const mark of site.marks) found.push({ mark, chain: here });
      walk(site.payloads, here);
    }
  };
  walk(parsed.payloads, []);
  return found;
}

/** The mark with this id that a payload holds, and the payloads it is in. */
export function findInPayload(parsed: Parsed, id: string): PayloadFound | undefined {
  if (parsed.payloads.length === 0) return undefined;
  return payloadMarksOf(parsed).find((found) => found.mark.id === id);
}

/** The ids of the marks in the payloads of a mark, at every depth. */
export function payloadIdsOf(parsed: Parsed, mark: MarkRange): string[] {
  const own = parsed.payloads.filter((site) => site.owner === mark.id);
  const ids: string[] = [];
  const walk = (sites: readonly PayloadMarks[]) => {
    for (const site of sites) {
      ids.push(...site.marks.map((held) => held.id));
      walk(site.payloads);
    }
  };
  walk(own);
  return ids;
}
