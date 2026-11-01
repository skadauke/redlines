// Parsing a file (format §2, §4, §5): the marks in the body, tied to the ledger. Markup that breaks
// the rules is reported as a warning and left as text, so a file always opens (format §12).

import { emptyLedger, findLedger, readLedger } from './ledger-read.ts';
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
    (opener.kind === 'ins' && (opener.payload === 'row' || opener.payload === 'col'))
  );
}

function rangeOf(marker: Marker): Range {
  return { from: marker.from, to: marker.to };
}

function segmentOf(opener: Extract<Marker, { type: 'open' }>, closer?: Marker): Segment {
  const segment: Segment = {
    open: rangeOf(opener),
    content: { from: opener.to, to: closer ? closer.from : opener.to },
  };
  if (closer) segment.close = rangeOf(closer);
  if (opener.payload !== undefined) segment.payload = opener.payload;
  return segment;
}

/** What may come before a marker on its line without the marker starting a block: indentation,
 * block quote markers, list bullets and checkboxes (format §3.2). */
const CONTAINER_PREFIX =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])|\[[ xX]\](?=[ \t])))*[ \t]*$/;

/** Whether a marker starts its line and has other text after it. A marker alone on its line is
 * how a mark that starts a block is written (format §3.3). */
function startsLineWithText(text: string, range: Range): boolean {
  const lineStart = text.lastIndexOf('\n', range.from - 1) + 1;
  if (!CONTAINER_PREFIX.test(text.slice(lineStart, range.from))) return false;
  const newline = text.indexOf('\n', range.to);
  const after = text.slice(range.to, newline === -1 ? text.length : newline);
  return after.trim() !== '';
}

/** Parses a file. Never throws. */
export function parse(text: string): Parsed {
  const scanned = scan(text);
  const span = findLedger(text, scanned);
  const read = span ? readLedger(span.source, span.range) : null;
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
          segments.push(segmentOf(pending, marker));
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
        segments.push(segmentOf(pending));
      }
      if (isPoint(marker)) {
        segments.push(segmentOf(marker));
        pending = null;
      } else pending = marker;
    }
    if (pending) {
      if (kind === 'cmt') segments.push(segmentOf(pending));
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
    if (payloads.length > 0) mark.payload = payloads.join('');
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

  return { text, marks, ledger, ledgerRange: span?.range ?? null, warnings };
}
