// Whether a file reads its emphasis alike in every order of decisions: the exact judge of a change
// that touches another mark, where the markers of both read as punctuation to the delimiters between
// them, and deciding either mark changes which delimiters stand next to which (format §3.1, rule 5).

import { lineEnd, lineStart, nextLineStart } from './blocks.ts';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { visibleText } from './edit-support.ts';
import { EditError } from './errors.ts';
import { sameReading } from './format-reader.ts';
import { hitsIn } from './inline.ts';
import { markerRanges } from './markers.ts';
import { parse } from './parse.ts';
import type { MarkRange, Parsed, Range } from './types.ts';

/**
 * The text with the delimiters that are no emphasis left out, in the same places: an escaped
 * character is punctuation, and nothing in a code span, an autolink, a URL or a tag is a delimiter.
 */
export function unreadDelimiters(s: string): string {
  const escaped = s.replace(/\\[!-/:-@[-`{-~]/g, '\\.');
  const { hits, code } = hitsIn(escaped, '');
  const ranges: Range[] = [
    ...hits.filter((h) => h.kind === 'autolink' || h.kind === 'url' || h.kind === 'tag'),
    ...code,
  ];
  let masked = escaped;
  for (const { from, to } of ranges) {
    masked =
      masked.slice(0, from) + masked.slice(from, to).replace(/[*_~]/g, 'x') + masked.slice(to);
  }
  return masked;
}

/** The most states of decisions that are read; a file with more is refused. */
const MOST_STATES = 40;
/** How many lines on either side of a marker belong to its paragraph. */
const MOST_LINES = 30;

/** The marks that `seeds` touch, through the marks that stand against them with no text between
 * or are around or inside them, and the marks that stand against those: deciding any of them puts other delimiters beside theirs. */
function clusterOf(parsed: Parsed, seeds: ReadonlySet<string>): Set<string> {
  // Where each mark has its markers, and its text: another mark joins by a marker that stands
  // against one of these, or inside the text of one.
  const markers = markerRanges(parsed).filter(
    (m) => m.mark && m.mark.kind !== 'fmt' && m.mark.kind !== 'split',
  );
  const texts = new Map<string, Range[]>();
  for (const mark of parsed.marks) {
    if (mark.kind !== 'ins' && mark.kind !== 'sub') continue;
    for (const segment of mark.segments) {
      if (!segment.close) continue;
      const list = texts.get(mark.id) ?? [];
      list.push({ from: segment.open.to, to: segment.close.from });
      texts.set(mark.id, list);
    }
  }
  const joins = (a: string, b: string) =>
    markers.some(
      (x) =>
        x.mark?.id === a &&
        markers.some(
          (y) =>
            y.mark?.id === b &&
            (x.to === y.from ||
              y.to === x.from ||
              (texts.get(a) ?? []).some((r) => r.from <= y.from && y.to <= r.to) ||
              (texts.get(b) ?? []).some((r) => r.from <= x.from && x.to <= r.to)),
        ),
    );
  const ids = [...new Set(markers.map((m) => m.mark?.id ?? ''))];
  const cluster = new Set([...seeds].filter((id) => ids.includes(id)));
  // The marks that stand against theirs, or are inside them; and one more step, the marks that
  // stand against those, which a decision puts next to the change.
  for (let step = 0; step < 2; step++) {
    const now = [...cluster];
    for (const id of ids) {
      if (!cluster.has(id) && now.some((other) => joins(other, id))) cluster.add(id);
    }
  }
  return cluster;
}

/** Whether the paragraphs that hold the markers of `ids` in `text` read their emphasis as they do
 * without those markers (and with no others). */
function paragraphsRead(text: string, parsed: Parsed, ids: ReadonlySet<string>): boolean {
  const limit = parsed.ledgerRange?.from ?? text.length;
  const all = markerRanges(parsed).filter((m) => m.role !== 'ledger' && m.from < limit);
  const mine = all.filter((m) => m.mark && ids.has(m.mark.id));
  const blank = (at: number) =>
    visibleText(text, all, lineStart(text, at), lineEnd(text, at)).trim() === '';
  const done = new Set<number>();
  for (const marker of mine) {
    let start = lineStart(text, marker.from);
    for (let n = 0; n < MOST_LINES && start > 0; n++) {
      const before = lineStart(text, start - 1);
      if (blank(before)) break;
      start = before;
    }
    if (done.has(start)) continue;
    done.add(start);
    let end = lineEnd(text, marker.from);
    for (let n = 0; n < MOST_LINES; n++) {
      const next = nextLineStart(text, end);
      if (next >= limit || blank(next)) break;
      end = lineEnd(text, next);
    }
    // The text of the paragraph without any marker, and the places of the markers of `ids` in it.
    let s = '';
    let cursor = start;
    const joints = new Set<number>();
    for (const m of all) {
      if (m.from < start || m.to > end) continue;
      s += text.slice(cursor, m.from);
      if (m.mark && ids.has(m.mark.id)) joints.add(s.length);
      cursor = m.to;
    }
    s += text.slice(cursor, end);
    if (!sameReading(unreadDelimiters(s), joints)) return false;
  }
  return true;
}

/**
 * Whether the marks `created` of an edit, with the marks they stand against, leave the emphasis of
 * their paragraphs as it reads in the newest view, in the file and after each decision of those
 * marks, accepted or rejected, in every order. A decision that is refused is not read. False where
 * there are more states than are read.
 */
export function emphasisReadsAlike(after: string, created: ReadonlySet<string>): boolean {
  const cluster = clusterOf(parse(after), created);
  if (cluster.size === 0) return true;
  const seen = new Set<string>();
  const walk = (text: string): boolean => {
    if (seen.has(text)) return true;
    seen.add(text);
    if (seen.size > MOST_STATES) return false;
    const parsed = parse(text);
    const pending: MarkRange[] = parsed.marks.filter((mark) => cluster.has(mark.id));
    if (pending.length === 0) return true;
    if (!paragraphsRead(text, parsed, new Set(pending.map((mark) => mark.id)))) return false;
    for (const mark of pending) {
      if (mark.kind !== 'ins' && mark.kind !== 'sub' && mark.kind !== 'del') continue;
      for (const decide of [accept, reject]) {
        let next: string;
        try {
          next = applyChanges(text, decide(text, mark.id));
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
          continue;
        }
        if (!walk(next)) return false;
      }
    }
    return true;
  };
  return walk(after);
}

/** The marks that stand against the `created` ones, which a refusal names. */
export function neighbours(after: string, created: ReadonlySet<string>): MarkRange[] {
  const parsed = parse(after);
  const cluster = clusterOf(parsed, created);
  return parsed.marks.filter((mark) => cluster.has(mark.id) && !created.has(mark.id));
}
