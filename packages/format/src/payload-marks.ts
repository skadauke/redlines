// The marks in the old text of a replacement (format §3.12). The parser reads them (`parse.ts`) with
// offsets in the decoded payload; this file is what the rest of the engine asks of them: the old
// text as the views show it, a mark found by its id, and the payload as a file of its own, so that a
// decision in it is made by the code that decides in a file.

import { eolOf, inEol } from './changes.ts';
import type { Eol } from './changes.ts';
import type { MarkRange, Parsed, PayloadMarks, Segment } from './types.ts';
import { newestView, originalView } from './views.ts';

/** The ledger of a file as a payload's own file holds it: with LF line breaks, or empty. */
export function ledgerTextOf(text: string, parsed: Parsed): string {
  const range = parsed.ledgerRange;
  if (!range) return '';
  return text
    .slice(range.from)
    .replace(/^[\r\n]+|[\r\n]+$/g, '')
    .replaceAll('\r\n', '\n');
}

/**
 * A payload as a file: a line break to stand after something, as the text of a unit does in a
 * file, the payload, and the ledger of the file it is in. The first line break keeps a payload that
 * starts with `---` from being read as front matter. Nothing in it is the ledger's but the end.
 */
export function payloadFile(payload: string, ledger: string): string {
  return `\n${payload}\n\n${ledger}`;
}

/** The payload, from the file made by `payloadFile` or one that a decision made of it. */
export function payloadOfFile(proxy: string, parsed: Parsed): string {
  const body = parsed.ledgerRange ? proxy.slice(0, parsed.ledgerRange.from) : proxy;
  return body.replace(/^\n/, '');
}

/** The old text of a payload as the original view shows it: its own marks rejected. */
export function originalOfPayload(payload: string, ledger: string): string {
  const view = originalView(payloadFile(payload, ledger)).text;
  return view.replace(/^\n/, '');
}

/** The old text of a payload as the newest view shows it: its own marks accepted. */
export function newestOfPayload(payload: string, ledger: string): string {
  const view = newestView(payloadFile(payload, ledger)).text;
  return view.replace(/^\n/, '');
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
  const old = site ? originalOfPayload(payload, ledgerTextOf(text, parsed)) : payload;
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
