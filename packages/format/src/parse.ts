// Parsing a file (format §2, §4, §5): the marks in the body, tied to the ledger. Markup that breaks
// the rules is reported as a warning and left as text, so a file always opens (format §12).

import { CONTAINER_PREFIX, carrierEnd, LineIndex, lineStart, markerEnd } from './blocks.ts';
import { isAlignPayload } from './format-ops.ts';
import { emptyLedger, findLedgers, readSpan } from './ledger-read.ts';
import { idPositions, ledgerAfter, mergeLedgers } from './ledger-join.ts';
import type { LedgerRead } from './ledger-read.ts';
import { MOST_PAYLOAD_DEPTH } from './ledger-order.ts';
import { holdsMarks, scan, scanChanged, scanPayload } from './scan.ts';
import type { Change, Marker, Scan } from './scan.ts';
import type {
  Ledger,
  MarkEntry,
  MarkKind,
  MarkRange,
  Parsed,
  PayloadMarks,
  Range,
  Segment,
  Thread,
  Warning,
  WarningCode,
} from './types.ts';

/**
 * Whether a marker has no closing marker (format §2.2). `alone` is whether it is the only marker its id
 * has in the file: an `align=` format change whose value is a delimiter row, and which nothing else of
 * its id goes with, is the point form of an alignment change, which stands at the end of a table's
 * header row (format §3.7). Any other `align=` opener is read as before: it opens a range, or is
 * unclosed (a value that is no delimiter row, or an id opened twice with no closer).
 */
function isPoint(opener: Extract<Marker, { type: 'open' }>, alone: boolean): boolean {
  return (
    opener.kind === 'del' ||
    opener.kind === 'split' ||
    (opener.kind === 'ins' && (opener.payload === 'row' || opener.payload === 'col')) ||
    (opener.kind === 'fmt' && BOX.test(opener.payload ?? '')) ||
    (opener.kind === 'fmt' && alone && isAlignPayload(opener.payload ?? ''))
  );
}

/** The payload of a checked or unchecked box, a point form of `fmt` (format §2.6). */
const BOX = /^[+-]check(?:=X)?$/;

function rangeOf(marker: Marker): Range {
  return { from: marker.from, to: marker.to };
}

/** A deletion whose payload starts with `row=` or `col=` belongs to a table (format §3.7). */
const TABLE_DELETION = /^(?:row|col)=/;

/** Whether an opener can stand alone on the line before a block (format §3.3), and so has a
 * carrier. A split is followed by the break it stands for, and the table marks sit in a row or
 * below a table; so does the point form of an alignment change (an `align=` opener with no closer),
 * while its range form stands alone before the table. */
function startsBlocks(opener: Extract<Marker, { type: 'open' }>, closer?: Marker): boolean {
  if (opener.kind === 'split') return false;
  if (opener.kind === 'ins' && (opener.payload === 'row' || opener.payload === 'col')) return false;
  if (opener.kind === 'fmt' && !closer && isAlignPayload(opener.payload ?? '')) return false;
  return !(opener.kind === 'del' && TABLE_DELETION.test(opener.payload ?? ''));
}

/**
 * One stretch of a mark. `body` is the file without its ledger. The opener of a mark that starts a
 * block stands alone on its line, and the line break, blank line and prefix that follow it are its
 * `carrier`.
 */
function segmentOf(
  body: string,
  opener: Extract<Marker, { type: 'open' }>,
  closer: Marker | undefined,
  lines: LineIndex,
): Segment {
  const end = startsBlocks(opener, closer)
    ? carrierEnd(body, opener.from, opener.to, lines)
    : opener.to;
  const segment: Segment = {
    open: rangeOf(opener),
    content: { from: opener.to, to: closer ? closer.from : opener.to },
  };
  if (end > opener.to) segment.carrier = { from: opener.to, to: end };
  if (closer) segment.close = rangeOf(closer);
  if (opener.payload !== undefined) segment.payload = opener.payload;
  return segment;
}

/** Whether a marker starts its line and has other text after it. A marker alone on its line is
 * how a mark that starts a block is written (format §3.3), and a line of markers has no text to
 * read as raw HTML. `range` starts at the marker. */
function startsLineWithText(text: string, range: Range, lines: LineIndex): boolean {
  const start = lineStart(text, range.from, lines);
  if (!CONTAINER_PREFIX.test(text.slice(start, range.from))) return false;
  const end = markerEnd(text, range.from);
  const newline = text.indexOf('\n', end);
  const after = text.slice(end, newline === -1 ? text.length : newline);
  return after.replace(/<!--.*?-->/g, '').trim() !== '';
}

/** What the markers of one id make: its kind, its comment thread and its stretches. Undefined when
 * they make none (a closer with no opener, a comment with no thread). `warn` hears what is wrong. */
function segmentsOf(
  body: string,
  lines: LineIndex,
  id: string,
  markers: readonly Marker[],
  threads: ReadonlyMap<string, Thread>,
  warn: (code: WarningCode, message: string, range: Range, id?: string) => void,
): { kind: MarkKind; thread: Thread | undefined; segments: Segment[] } | undefined {
  const first = markers.find((marker) => marker.type === 'open');
  if (!first) {
    for (const marker of markers)
      warn('unopened-close', `The closer for ${id} has no opener`, rangeOf(marker), id);
    return undefined;
  }
  const kind = first.kind;
  const thread = threads.get(id);
  // A comment anchor whose thread isn't in the ledger is ordinary content (format §2.1).
  if (kind === 'cmt' && !thread) return undefined;

  const segments: Segment[] = [];
  let pending: Extract<Marker, { type: 'open' }> | null = null;
  const alone = markers.length === 1;
  for (const marker of markers) {
    if (marker.type === 'close') {
      if (pending) {
        segments.push(segmentOf(body, pending, marker, lines));
        pending = null;
      } else warn('unopened-close', `The closer for ${id} has no opener`, rangeOf(marker), id);
      continue;
    }
    if (marker.kind !== kind) {
      warn(
        'kind-mismatch',
        `${id} is a ${kind} mark, but this opener says ${marker.kind}`,
        rangeOf(marker),
        id,
      );
      continue;
    }
    if (pending) {
      if (kind !== 'cmt') {
        warn('duplicate-id', `${id} is opened again before it is closed`, rangeOf(marker), id);
        continue;
      }
      // A comment opener with no closer before the next one is a point comment.
      segments.push(segmentOf(body, pending, undefined, lines));
    }
    if (isPoint(marker, alone)) {
      segments.push(segmentOf(body, marker, undefined, lines));
      pending = null;
    } else pending = marker;
  }
  if (pending) {
    if (kind === 'cmt') segments.push(segmentOf(body, pending, undefined, lines));
    else warn('unclosed-mark', `The ${kind} mark ${id} is never closed`, rangeOf(pending), id);
  }
  return { kind, thread, segments };
}

/** The ids of the marks in payloads, all depths. */
export function payloadIds(payloads: readonly PayloadMarks[]): string[] {
  return payloads.flatMap((site) => [
    ...site.marks.map((mark) => mark.id),
    ...payloadIds(site.payloads),
  ]);
}

/** A payload that holds markers, as the scan found it, before it is known which are marks. */
interface Site {
  /** The mark that owns the payload, and where its opener is in the text that holds it. */
  ownerId: string;
  opener: Range;
  /** The index of the owner's segment: known for the payloads of the body's marks. */
  segment: number;
  depth: number;
  text: string;
  scanned: Scan;
  /** Where the outermost owner's opener is in the file, which a warning points at. */
  at: Range;
  children: Site[];
}

/**
 * Reads the marks that the payloads of `marks` hold (format §3.12): the old text of a replacement
 * keeps other people's marks, written in the payload's encoding. A marker in a payload is a mark
 * when its id has a ledger entry (a thread, for a comment) and stands nowhere else in the file, all
 * its markers are in the one payload and make a mark by the rules of the body, and the payload is
 * no deeper than `MOST_PAYLOAD_DEPTH`. Otherwise it is text, and the file says so.
 */
function readPayloads(
  marks: readonly MarkRange[],
  scanned: Scan,
  ledger: Ledger,
  threads: ReadonlyMap<string, Thread>,
  warn: (code: WarningCode, message: string, range: Range, id: string) => void,
): PayloadMarks[] {
  const holders = marks.filter((mark) => mark.kind === 'sub' || mark.kind === 'del');
  if (!holders.some((mark) => mark.segments.some((s) => s.payload?.includes('<!--')))) return [];
  // Where each id stands, to see which stand in one place only.
  const where = new Map<string, Set<Site | null>>();
  const note = (id: string, site: Site | null) => {
    const set = where.get(id);
    if (set) set.add(site);
    else where.set(id, new Set([site]));
  };
  for (const marker of scanned.markers) note(marker.id, null);
  const build = (site: Site) => {
    for (const marker of site.scanned.markers) {
      note(marker.id, site);
      if (marker.type !== 'open' || site.depth >= MOST_PAYLOAD_DEPTH || !holdsMarks(marker))
        continue;
      const text = marker.payload ?? '';
      const child: Site = {
        ownerId: marker.id,
        opener: rangeOf(marker),
        segment: -1,
        depth: site.depth + 1,
        text,
        scanned: scanPayload(text),
        at: site.at,
        children: [],
      };
      site.children.push(child);
      build(child);
    }
  };
  const roots: Site[] = [];
  for (const owner of holders) {
    owner.segments.forEach((segment, index) => {
      const payload = segment.payload;
      if (payload === undefined || !payload.includes('<!--') || /^(?:row|col)=/.test(payload)) {
        return;
      }
      const site: Site = {
        ownerId: owner.id,
        opener: segment.open,
        segment: index,
        depth: 1,
        text: payload,
        scanned: scanPayload(payload),
        at: segment.open,
        children: [],
      };
      roots.push(site);
      build(site);
    });
  }

  const read = (site: Site): PayloadMarks => {
    const byId = new Map<string, Marker[]>();
    for (const marker of site.scanned.markers) {
      const group = byId.get(marker.id);
      if (group) group.push(marker);
      else byId.set(marker.id, [marker]);
    }
    const here: MarkRange[] = [];
    const siteLines = new LineIndex(site.text);
    const text = (id: string, why: string) =>
      warn(
        'payload-mark',
        `The mark ${id} in the old text of ${site.ownerId} is read as text: ${why}`,
        site.at,
        id,
      );
    for (const [id, markers] of byId) {
      const first = markers.find((marker) => marker.type === 'open');
      if (first?.kind === 'cmt' ? !threads.has(id) : !Object.hasOwn(ledger.marks, id)) {
        text(id, 'it has no ledger entry');
        continue;
      }
      if ((where.get(id)?.size ?? 0) > 1) {
        text(id, 'its id stands in more than one place');
        continue;
      }
      let problem = '';
      const grouped = segmentsOf(site.text, siteLines, id, markers, threads, (_code, message) => {
        problem ||= message;
      });
      if (!grouped || problem) {
        text(id, problem || 'it makes no mark');
        continue;
      }
      const entry: MarkEntry =
        grouped.kind === 'cmt' && grouped.thread
          ? { by: grouped.thread.by, at: grouped.thread.at }
          : ledger.marks[id]!;
      const payloads = grouped.segments.flatMap((segment) => segment.payload ?? []);
      const mark: MarkRange = { id, kind: grouped.kind, segments: grouped.segments, entry };
      const [firstPayload] = payloads;
      if (firstPayload !== undefined) {
        mark.payload = grouped.kind === 'fmt' ? firstPayload : payloads.join('');
      }
      here.push(mark);
    }
    here.sort((a, b) => (a.segments[0]?.open.from ?? 0) - (b.segments[0]?.open.from ?? 0));
    const deeper: PayloadMarks[] = [];
    for (const mark of here) {
      mark.segments.forEach((segment, index) => {
        const child = site.children.find(
          (candidate) =>
            candidate.ownerId === mark.id && candidate.opener.from === segment.open.from,
        );
        const inner = child ? { ...read(child), segment: index } : undefined;
        if (inner && held(inner)) deeper.push(inner);
      });
    }
    return {
      owner: site.ownerId,
      segment: site.segment,
      depth: site.depth,
      text: site.text,
      marks: here,
      payloads: deeper,
    };
  };
  return roots.map(read).filter(held);
}

/** A payload that holds marks, or payloads that do. */
function held(site: PayloadMarks): boolean {
  return site.marks.length > 0 || site.payloads.length > 0;
}

/** Each parse's ledger, as read, by the parse; for later parses of the same file. */
const ledgerReads = new WeakMap<Parsed, Map<string, LedgerRead>>();

/**
 * Parses a file. Never throws. Given the parse of an earlier version of the same file, a ledger
 * whose text hasn't changed is taken from it rather than read again (an editor parses on every
 * keystroke, and reading the ledger's YAML is most of the work); the two parses then share the
 * ledger object, so treat it as read-only. With `change`, where the text differs from that
 * earlier text, the markers are read again only near the edit (#700): the same parse, found faster.
 */
export function parse(text: string, previous?: Parsed, change?: Change): Parsed {
  // A long text read again as it stands (no earlier parse given) is the same parse: a move or a
  // decision reads one file's text some fifty times, the file written and the views of it, which was
  // 18 of the 45 ms of a block move in 220 KB (#1062). A parse is read-only, with or without an earlier one (above), so it is shared.
  if (previous || change || text.length < RECENT_MIN || text.length > RECENT_MAX) {
    return parseText(text, previous, change);
  }
  const known = recent.get(text);
  if (known) {
    recent.delete(text);
    recent.set(text, known);
    return known;
  }
  parseStats.long++;
  const parsed = parseText(text, previous, change);
  recent.set(text, parsed);
  if (recent.size > RECENT_MOST) recent.delete(recent.keys().next().value!);
  return parsed;
}

/** @internal How many long texts were read in full (not found among the latest), for the cost tests. */
export const parseStats = { long: 0 };

/** The parses of long texts read lately, by text, the latest last. */
const recent = new Map<string, Parsed>();
const RECENT_MOST = 4;
/** Shorter texts parse in less time than it takes to look them up. */
const RECENT_MIN = 20_000;
/** Longer ones are not kept: each parse holds the text, and a lookup hashes all of it. */
const RECENT_MAX = 2_000_000;

function parseText(text: string, previous?: Parsed, change?: Change): Parsed {
  const scanned = (previous && change && scanChanged(previous.text, text, change)) || scan(text);
  const spans = findLedgers(text, scanned);
  const span = spans.at(-1) ?? null;
  const known = spans.length > 0 && previous ? ledgerReads.get(previous) : undefined;
  const reads = new Map<string, LedgerRead>();
  const readOf = spans.map((one) => {
    const before = one.crLines ? undefined : known?.get(one.source);
    // Its warnings point at the whole ledger, which may have moved.
    const read = before
      ? {
          ...before,
          warnings: before.warnings.map((warning) => ({ ...warning, range: one.range })),
        }
      : readSpan(one);
    if (!one.crLines) reads.set(one.source, read);
    return read;
  });
  const read: LedgerRead | null = readOf.at(-1) ?? null;
  const body = span ? text.slice(0, span.range.from) : text;
  // A marker reads the first ledger after it, and the last when none is (format §5.1).
  const starts = spans.map((one) => one.start);
  const positions = spans.length > 1 ? idPositions(scanned) : new Map<string, number>();
  const ledger =
    spans.length > 1
      ? mergeLedgers(
          readOf.map((one) => one.ledger),
          starts,
          positions,
        )
      : (read?.ledger ?? emptyLedger());
  const warnings: Warning[] = readOf.flatMap((one) => one.warnings);
  const warn = (code: WarningCode, message: string, range: Range, id?: string) =>
    warnings.push(id === undefined ? { code, message, range } : { code, message, range, id });

  const threads = new Map(ledger.comments.map((thread) => [thread.id, thread]));
  const byId = new Map<string, Marker[]>();
  for (const marker of scanned.markers) {
    const group = byId.get(marker.id);
    if (group) group.push(marker);
    else byId.set(marker.id, [marker]);
  }

  const marks: MarkRange[] = [];
  const bodyLines = new LineIndex(body);
  const textLines = new LineIndex(text);
  for (const [id, markers] of byId) {
    const grouped = segmentsOf(body, bodyLines, id, markers, threads, warn);
    if (!grouped) continue;
    const { kind, thread, segments } = grouped;
    const [firstSegment] = segments;
    if (!firstSegment) continue;

    let entry: MarkEntry | undefined =
      kind === 'cmt' && thread ? { by: thread.by, at: thread.at } : ledger.marks[id];
    if (!entry) {
      entry = { by: 'unknown', at: '' };
      const reader = spans.length > 1 ? readOf[ledgerAfter(starts, positions.get(id) ?? 0)] : read;
      if (reader?.valid !== false)
        warn('missing-entry', `The mark ${id} has no ledger entry`, firstSegment.open, id);
    }

    const payloads = segments.flatMap((segment) => segment.payload ?? []);
    const mark: MarkRange = { id, kind, segments, entry };
    // Every segment of a format change has its operations; the old text of a deletion is in pieces.
    const [firstPayload] = payloads;
    if (firstPayload !== undefined) {
      mark.payload = kind === 'fmt' ? firstPayload : payloads.join('');
    }
    marks.push(mark);

    for (const segment of segments) {
      for (const range of [segment.open, segment.close]) {
        if (range && startsLineWithText(text, range, textLines)) {
          warn(
            'line-start-marker',
            `A marker for ${id} starts a line that has other text`,
            range,
            id,
          );
        }
      }
    }
  }
  marks.sort((a, b) => (a.segments[0]?.open.from ?? 0) - (b.segments[0]?.open.from ?? 0));

  // The marks in the old text of replacements: read here, and not orphans.
  const payloads = readPayloads(marks, scanned, ledger, threads, (code, message, range, id) =>
    warn(code, message, range, id),
  );
  const markIds = new Set(marks.map((mark) => mark.id));
  for (const id of payloadIds(payloads)) markIds.add(id);
  for (const id of Object.keys(ledger.marks)) {
    if (!markIds.has(id)) {
      warnings.push({ code: 'orphan-entry', message: `The ledger entry ${id} has no mark`, id });
    }
  }
  for (const thread of ledger.comments) {
    if (!markIds.has(thread.id)) {
      warnings.push({
        code: 'orphan-thread',
        message: `The thread ${thread.id} has no anchor`,
        id: thread.id,
      });
    }
  }
  warnings.sort((a, b) => (a.range?.from ?? -1) - (b.range?.from ?? -1));

  const parsed: Parsed = {
    text,
    marks,
    ledger,
    ledgerRange: span?.range ?? null,
    earlierLedgers: spans.slice(0, -1).map((one) => one.range),
    warnings,
    payloads,
  };
  // A ledger with CR line breaks is not read, whatever its YAML, so it gives nothing to keep.
  if (reads.size > 0) ledgerReads.set(parsed, reads);
  return parsed;
}
