// Parsing a file (format §2, §4, §5): the marks in the body, tied to the ledger. Markup that breaks
// the rules is reported as a warning and left as text, so a file always opens (format §12).

import { CONTAINER_PREFIX, carrierEnd, markerEnd } from './blocks.ts';
import { emptyLedger, findLedger, readLedger } from './ledger-read.ts';
import type { LedgerRead } from './ledger-read.ts';
import { scan } from './scan.ts';
import type { Marker } from './scan.ts';
import type {
  MarkEntry,
  MarkRange,
  Parsed,
  Range,
  Segment,
  Warning,
  WarningCode,
} from './types.ts';

/** Whether a marker of this kind has no closing marker (format §2.2). */
function isPoint(opener: Extract<Marker, { type: 'open' }>): boolean {
  return (
    opener.kind === 'del' ||
    opener.kind === 'split' ||
    (opener.kind === 'ins' && (opener.payload === 'row' || opener.payload === 'col')) ||
    (opener.kind === 'fmt' && BOX.test(opener.payload ?? ''))
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
 * below a table. */
function startsBlocks(opener: Extract<Marker, { type: 'open' }>): boolean {
  if (opener.kind === 'split') return false;
  if (opener.kind === 'ins' && (opener.payload === 'row' || opener.payload === 'col')) return false;
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
  closer?: Marker,
): Segment {
  const end = startsBlocks(opener) ? carrierEnd(body, opener.from, opener.to) : opener.to;
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
function startsLineWithText(text: string, range: Range): boolean {
  const lineStart = text.lastIndexOf('\n', range.from - 1) + 1;
  if (!CONTAINER_PREFIX.test(text.slice(lineStart, range.from))) return false;
  const end = markerEnd(text, range.from);
  const newline = text.indexOf('\n', end);
  const after = text.slice(end, newline === -1 ? text.length : newline);
  return after.replace(/<!--.*?-->/g, '').trim() !== '';
}

/** Each parse's ledger, as read, by the parse; for later parses of the same file. */
const ledgerReads = new WeakMap<Parsed, { source: string; read: LedgerRead }>();

/**
 * Parses a file. Never throws. Given the parse of an earlier version of the same file, a ledger
 * whose text hasn't changed is taken from it rather than read again (an editor parses on every
 * keystroke, and reading the ledger's YAML is most of the work); the two parses then share the
 * ledger object, so treat it as read-only.
 */
export function parse(text: string, previous?: Parsed): Parsed {
  const scanned = scan(text);
  const span = findLedger(text, scanned);
  const known = span && previous ? ledgerReads.get(previous) : undefined;
  let read: LedgerRead | null = null;
  if (span && known?.source === span.source) {
    // Its warnings point at the whole ledger, which may have moved.
    const warnings = known.read.warnings.map((warning) => ({ ...warning, range: span.range }));
    read = { ...known.read, warnings };
  } else if (span) read = readLedger(span.source, span.range);
  const body = span ? text.slice(0, span.range.from) : text;
  const ledger = read?.ledger ?? emptyLedger();
  const warnings: Warning[] = read ? [...read.warnings] : [];
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
  for (const [id, markers] of byId) {
    const first = markers.find((marker) => marker.type === 'open');
    if (!first) {
      for (const marker of markers)
        warn('unopened-close', `The closer for ${id} has no opener`, rangeOf(marker), id);
      continue;
    }
    const kind = first.kind;
    const thread = threads.get(id);
    // A comment anchor whose thread isn't in the ledger is ordinary content (format §2.1).
    if (kind === 'cmt' && !thread) continue;

    const segments: Segment[] = [];
    let pending: Extract<Marker, { type: 'open' }> | null = null;
    for (const marker of markers) {
      if (marker.type === 'close') {
        if (pending) {
          segments.push(segmentOf(body, pending, marker));
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
        segments.push(segmentOf(body, pending));
      }
      if (isPoint(marker)) {
        segments.push(segmentOf(body, marker));
        pending = null;
      } else pending = marker;
    }
    if (pending) {
      if (kind === 'cmt') segments.push(segmentOf(body, pending));
      else warn('unclosed-mark', `The ${kind} mark ${id} is never closed`, rangeOf(pending), id);
    }
    const [firstSegment] = segments;
    if (!firstSegment) continue;

    let entry: MarkEntry | undefined =
      kind === 'cmt' && thread ? { by: thread.by, at: thread.at } : ledger.marks[id];
    if (!entry) {
      entry = { by: 'unknown', at: '' };
      if (read?.valid !== false)
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
        if (range && startsLineWithText(text, range)) {
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

  const markIds = new Set(marks.map((mark) => mark.id));
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

  const parsed: Parsed = { text, marks, ledger, ledgerRange: span?.range ?? null, warnings };
  if (span && read) ledgerReads.set(parsed, { source: span.source, read });
  return parsed;
}
