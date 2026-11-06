// What the break of a `split` reads, whatever is decided about the changes next to it (format
// §3.4). A split's break is not written down: it is read from the text after the marker when the
// split is decided, and rejecting the split takes that much away. Where markers of other changes
// stand in the text that reading looks at, deciding them can make the break read more, or less, so
// that the same decisions in different orders give different text (issue #101). No edit may leave
// such a split where the file had none.

import {
  CONTAINER_PREFIX,
  breakEnd,
  continuationPrefix,
  breakLength,
  lineEnd,
  lineStart,
  linePrefixAt,
  withoutMarkers,
} from './blocks.ts';
import { inEol, eolOf, markerRanges, nameOf } from './edit-support.ts';
import type { MarkerRange } from './edit-support.ts';
import type { Ledger, MarkKind, Parsed, Person } from './types.ts';

/** A marker of a mark, as the reading of a break needs it. */
export interface MarkerAt {
  id: string;
  kind: MarkKind;
  role: 'open' | 'close';
  /** Where the marker ends, with the carrier of an opener: what deciding the mark takes away. */
  end: number;
  /** For the opener of an insertion or a substitution: where its closer ends, since rejecting it
   * takes its text away. */
  through?: number;
  /** What rejecting the mark puts back in place of its opener: the old text of a deletion or a
   * substitution. */
  restores?: string;
  /** For a split: where its break ends, which rejecting it takes away. */
  breakEnd?: number;
  /** For the closer of an insertion or a substitution: where its opener starts, since rejecting it
   * takes the text from there to the closer away. */
  opens?: number;
}

/** A line that has nothing but its prefix in it. */
const isBlank = (line: string) => /^[ \t>]*$/.test(line);

/** The syntax of a hard break and a line break, at the start of a text. */
const STARTS_BREAK = /^(?:[ \t]*|\\)\r?\n/;

/** How many readings of a run of markers are looked at before giving up and calling it unsafe. */
const READINGS = 64;

/** A line as a reading of it has it: the text in front of the next marker that stays, and the
 * text from there on. `joined` when rejecting an insertion whose closer stood on the line took its
 * text away from its opener on, so that the line goes on from where the opener was. */
interface Reading {
  before: string;
  rest: string;
  joined: boolean;
  /** What follows the line: the rest of the text, or of text that a decision brings back and that
   * ends the line, with the text after it. */
  following: string;
}

/** Characters that a line's prefix is made of: quote markers, bullets, numbers, boxes, `#`s. */
const PREFIX_CHARS = /^[ \t>*+\-\d.)[\]xX#]*/;

/** Whether the split `id` stands between `from` and `to`. */
function holds(
  text: string,
  from: number,
  to: number,
  id: string,
  markerAt: (position: number) => MarkerAt | undefined,
): boolean {
  for (
    let at = text.indexOf('<!--split ', from);
    at !== -1 && at < to;
    at = text.indexOf('<!--split ', at + 1)
  ) {
    if (markerAt(at)?.id === id) return true;
  }
  return false;
}

/**
 * The ways the line through `at` can read once the markers there are decided, each way they can be:
 * left as they are, removed, or the change rejected, which takes an insertion's text away or brings
 * a deletion's back. Markers are looked for at `at`, and behind characters a prefix is made of,
 * which the text the decisions leave can make more prefix of. `before` is the line's text in front
 * of `at`. The marker of the split itself, `id`, stays. Undefined where that can't be told: a format
 * change, which undoes its own operations.
 */
function readings(
  text: string,
  at: number,
  id: string,
  markerAt: (position: number) => MarkerAt | undefined,
  budget: { left: number; limit: number },
  before = text.slice(lineStart(text, at), at),
  joined = false,
): Reading[] | undefined {
  const end = lineEnd(text, at);
  const following = text.slice(end, Math.min(end + 400, budget.limit));
  const lead = PREFIX_CHARS.exec(text.slice(at, end))?.[0] ?? '';
  const marker = markerAt(at + lead.length);
  if (!marker || marker.id === id)
    return [{ before, rest: text.slice(at, end), joined, following }];
  if (lead !== '') {
    return readings(text, at + lead.length, id, markerAt, budget, before + lead, joined);
  }
  if (--budget.left < 0 || marker.kind === 'fmt') return undefined;
  const found: Reading[] = [{ before, rest: text.slice(at, end), joined, following }];
  const then = (from: number, restored = '', ahead = before, join = joined): boolean => {
    const newline = /\r?\n/.exec(restored);
    if (newline) {
      const line = ahead + restored.slice(0, newline.index);
      const rest =
        restored.slice(newline.index) + text.slice(from, Math.min(from + 400, budget.limit));
      found.push({ before: line, rest: '', joined: join, following: rest });
      return true;
    }
    const after = readings(text, from, id, markerAt, budget, ahead + restored, join);
    if (!after) return false;
    found.push(...after);
    return true;
  };
  let known = then(marker.end);
  if (marker.role === 'open' && marker.kind === 'split') {
    known &&= then(marker.breakEnd ?? marker.end);
  } else if (marker.role === 'open' && (marker.kind === 'ins' || marker.kind === 'sub')) {
    // An insertion that holds the split takes it away with it: then there is no break to read.
    const through = marker.through ?? marker.end;
    if (!holds(text, at, through, id, markerAt)) {
      known &&= then(through, marker.restores);
    }
  } else if (marker.role === 'open' && marker.kind === 'del') {
    known &&= then(marker.end, marker.restores);
  } else if (marker.role === 'close' && marker.opens !== undefined) {
    const { opens } = marker;
    known &&= then(marker.end, marker.restores, text.slice(lineStart(text, opens), opens), true);
  }
  return known ? found : undefined;
}

/**
 * Whether a line break can come to follow `at` with nothing but the syntax of a hard break before
 * it (`syntax` so far), once the markers there are decided: each removed, or its change rejected,
 * which takes an insertion's text away or brings a deletion's back. The markers of `stays` stay,
 * and the deletion `joined` is only accepted. True or false; undefined where that can't be told.
 */
function breakAhead(
  text: string,
  at: number,
  syntax: string,
  stays: ReadonlySet<string>,
  joined: string | undefined,
  markerAt: (position: number) => MarkerAt | undefined,
  limit: number,
  budget: { left: number },
): boolean | undefined {
  /** What text that a decision brings back makes of it: a line break, other text, or nothing yet. */
  const through = (restored: string, so: string): boolean | string => {
    for (const char of restored) {
      if (char === '\n' || char === '\r') return /^(?:[ \t]*|\\)$/.test(so);
      if (!/[ \t\\]/.test(char)) return false;
      so += char;
    }
    return so;
  };
  let position = at;
  for (;;) {
    const char = text[position];
    if (char === undefined || position >= limit) return false;
    if (char === '\n' || char === '\r') {
      return /^(?:[ \t]*|\\)$/.test(syntax) && STARTS_BREAK.test(text.slice(position, limit));
    }
    if (/[ \t\\]/.test(char)) {
      syntax += char;
      position++;
      continue;
    }
    const marker = markerAt(position);
    if (!marker || stays.has(marker.id)) return false;
    if (--budget.left < 0 || marker.kind === 'fmt') return undefined;
    const then = (from: number, restored = ''): boolean | undefined => {
      const so = through(restored, syntax);
      if (typeof so === 'boolean') return so;
      return breakAhead(text, from, so, stays, joined, markerAt, limit, budget);
    };
    const ways = [then(marker.end)];
    if (marker.id !== joined && marker.role === 'open') {
      if (marker.kind === 'split') ways.push(then(marker.breakEnd ?? marker.end));
      if (marker.kind === 'ins' || marker.kind === 'sub') {
        ways.push(then(marker.through ?? marker.end, marker.restores));
      }
      if (marker.kind === 'del') ways.push(then(marker.end, marker.restores));
    }
    if (ways.includes(true)) return true;
    return ways.includes(undefined) ? undefined : false;
  }
}

/**
 * The splits whose breaks end in front of `from` on the line that starts at `home`, one after the
 * other up the text, other than `id`: the split whose break ends on that line, then the split whose
 * break ends on the line of its marker, and so on. Rejecting the first k of them takes their line
 * breaks away, and the line goes on from the line of the kth one's marker. Gives the nearest of
 * them, and the prefixes the line can so come to have, as the lines of a list item go on
 * (`continuationPrefix`), which is all of a prefix that a break reads. A split's marker is on the
 * line above the line its break ends on, or on the one above that when its break has a blank line.
 *
 * Where the line of one of them has text in front of its marker, every line further up goes on
 * from a line with that text, whose prefix does not depend on what follows: the prefixes from
 * there on are those of that split's own line, which `known` keeps for each split by its marker,
 * but for a walk that passed over a marker of the split's own mark, which goes with it.
 */
function splitsInFront(
  text: string,
  home: number,
  from: number,
  id: string,
  markerAt: (position: number) => MarkerAt | undefined,
  known?: Map<number, ReadonlySet<string>>,
): { nearest: string | undefined; prefixes: Set<string> } {
  const prefixes = new Set<string>();
  let nearest: string | undefined;
  // The line goes on from `start`, with the text from there to `end` and then `tail`.
  let start = home;
  let end = from;
  let tail = '';
  // A marker of the split's own mark was passed over: what the walk found is its own.
  let own = false;
  while (start > 0) {
    const above = lineStart(text, start - 1);
    const top = above === 0 ? 0 : lineStart(text, above - 1);
    let next: { at: number; breakEnd: number; id: string } | undefined;
    for (
      let position = text.lastIndexOf('<!--split ', start - 1);
      position !== -1 && position >= top;
      position = position === 0 ? -1 : text.lastIndexOf('<!--split ', position - 1)
    ) {
      const marker = markerAt(position);
      const breakEnd = marker?.breakEnd;
      if (!marker || marker.role !== 'open' || breakEnd === undefined) continue;
      if (breakEnd < start || breakEnd > end) continue;
      if (marker.id === id) {
        own = true;
        continue;
      }
      next = { at: position, breakEnd, id: marker.id };
      break;
    }
    if (!next) break;
    nearest ??= next.id;
    const head = lineStart(text, next.at);
    const prefix = linePrefixAt(text, next.at);
    if (prefix.length < next.at - head) {
      prefixes.add(continuationPrefix(prefix));
      const further = known?.get(next.at);
      if (further) {
        for (const line of further) prefixes.add(line);
        break;
      }
      tail = '';
    } else {
      tail = text.slice(next.breakEnd, end) + tail;
      const line = text.slice(head, next.at) + tail;
      prefixes.add(continuationPrefix(linePrefixAt(line, line.length)));
    }
    end = next.at;
    start = head;
  }
  if (!own) known?.set(from, prefixes);
  return { nearest, prefixes };
}

/**
 * The mark whose decision can change the break of the split whose marker is `[from, at)`, if there
 * is one: the reading of the break looks at a place where its marker stands. That is
 *
 * - right after the split, before the line break: other changes, as the deletion of the split's
 *   break, with only the syntax of a hard break between them and a line break after them, which
 *   the split would take once they went; or the deletion of its break, which, rejected, would give
 *   the split back a longer break than the one it deleted;
 * - at the start of the line after a break of one line, behind its quote markers and indentation:
 *   a line of nothing but markers, which becomes blank once they go, and the break takes it in. A
 *   split with text in front of it on its line is refused that outright: rejecting it would join
 *   that line to the text, where the opener of a block would no longer stand alone. A split alone
 *   on its line has every way of deciding the markers read: they must give the break it has now;
 * - behind the characters a prefix is made of, on the line the break reads its prefix from (the
 *   line after it, or the line after its blank line), where the change may leave white space or
 *   syntax that the break would read;
 * - behind the characters a prefix is made of, on the split's own line in front of it, where the
 *   change may leave white space or syntax: that line's prefix tells the break how much of the next
 *   line's indentation is its own;
 * - the break of another split in front of the split's own line, which rejecting it takes away:
 *   the line then goes on from the line of that split's marker, and has that line's prefix; and
 *   so on up, where that line starts after the break of another split in turn.
 *
 * `markerAt` gives the marker that starts at a position, if one does; the markers of the split's
 * own mark, `id`, go with it.
 */
export function breakDependsOn(
  text: string,
  from: number,
  at: number,
  id: string,
  markerAt: (position: number) => MarkerAt | undefined,
  limit = text.length,
  /** The prefixes that the lines of the splits looked at so far can come to have, by marker. */
  known?: Map<number, ReadonlySet<string>>,
): string | undefined {
  const other = (position: number) => {
    const marker = markerAt(position);
    return marker && marker.id !== id ? marker : undefined;
  };
  const first = STARTS_BREAK.exec(text.slice(at, Math.min(at + 4096, limit)));
  if (!first) {
    // No line break right after the split: the deletion of its break, as when someone joined the
    // two lines, or other changes. Once those are decided, a line break behind them, with nothing
    // but the syntax of a hard break between, would be the split's. The deletion of the split's
    // break belongs to it: rejecting it gives the split its break back, which rejecting the split
    // takes away as it takes the deletion, so that is no other reading.
    const join = markerAt(at);
    const own =
      join?.kind === 'del' &&
      join.restores !== undefined &&
      breakLength(linePrefixAt(text, at), join.restores) === join.restores.length
        ? join.id
        : undefined;
    let ahead = at;
    while (/[ \t\\]/.test(text[ahead] ?? '')) ahead++;
    const named = markerAt(ahead)?.id;
    const grows = breakAhead(text, at, '', new Set([id]), own, markerAt, limit, {
      left: READINGS,
    });
    if (grows !== false && named !== id) return named;
    // Rejected, the deletion gives the split its break back, read with what follows it now.
    if (own !== undefined && join) {
      const restored = join.restores ?? '';
      const lines = readings(text, join.end, id, markerAt, { left: READINGS, limit }, '');
      const linePrefix = linePrefixAt(text, at);
      const reads = (line: Reading) =>
        breakLength(linePrefix, restored + line.before + line.rest + line.following) ===
        restored.length;
      if (!lines || !lines.every(reads)) return markerAt(join.end)?.id ?? own;
    }
    return undefined;
  }
  // The first marker of another change on a line, where only characters that a prefix is made of
  // come before it: deciding the change can leave white space or syntax that, with them, reads as
  // more prefix.
  const inPrefix = (start: number, end: number) => {
    let position = start;
    while (position < end && /[ \t>*+\-\d.)[\]xX#]/.test(text[position] ?? '')) position++;
    return position < end ? other(position) && position : undefined;
  };
  // The prefix of the split's own line, which tells its break how much of the next line's
  // indentation is its own: what deciding the changes in front of the split leaves of it must give
  // the break it has now.
  const home = lineStart(text, from);
  const ahead = inPrefix(home, from);
  if (ahead !== undefined) {
    // White space that other changes put in front of a split, with nothing else on its line: the
    // line of a split that stands alone on it, which white space typed there would indent once
    // accepted, and the markers around it would start the line.
    const shown = withoutMarkers(text.slice(home, from));
    if (/^[ \t>]*$/.test(shown) && shown !== linePrefixAt(text, from)) return other(ahead)?.id;
    const lines = readings(text, home, id, markerAt, { left: READINGS, limit }, '');
    const rest = text.slice(at, Math.min(at + 4096, limit));
    const now = breakLength(linePrefixAt(text, from), rest);
    const reads = (read: Reading) => {
      const whole = read.before + read.rest;
      return breakLength(linePrefixAt(whole, whole.length), rest) === now;
    };
    if (!lines || !lines.every(reads)) return other(ahead)?.id;
  }
  // The line after the break, and the line after its blank line.
  const after = at + first[0].length;
  const end = Math.min(lineEnd(text, after), limit);
  let line = after;
  if (isBlank(text.slice(after, end))) {
    line = end < limit ? text.indexOf('\n', end) + 1 : limit;
    if (line <= 0 || line >= limit) return undefined;
  } else {
    let position = after;
    while (position < end && /[ \t>]/.test(text[position] ?? '')) position++;
    // Markers of the split's own mark go with it.
    let marker = markerAt(position);
    while (marker?.id === id) {
      position = marker.end;
      marker = markerAt(position);
    }
    // A line of nothing but markers can become blank. Rejecting the split joins it to the line in
    // front of the split, where the opener of a change that starts a block, alone on its line,
    // would no longer be: that is read as a whole only when the split stands alone on its line.
    if (marker && !CONTAINER_PREFIX.test(withoutMarkers(text.slice(home, from)))) return marker.id;
  }
  // The breaks of other splits in front of the split's line, one line up after the other:
  // rejecting them takes their line breaks away, and the line then goes on from the line of the
  // furthest of them, whose prefix must give the break it has now. The nearest is decided first.
  // That prefix tells the break only how much of the indentation of the line it reads its prefix
  // from is its own: a line that starts with no white space reads alike.
  if (/^[ \t]/.test(text.slice(line, Math.min(lineEnd(text, line), limit)))) {
    const joined = splitsInFront(text, home, from, id, markerAt, known);
    if (joined.nearest !== undefined) {
      const rest = text.slice(at, Math.min(at + 4096, limit));
      const now = breakLength(linePrefixAt(text, from), rest);
      for (const prefix of joined.prefixes) {
        if (breakLength(prefix, rest) !== now) return joined.nearest;
      }
    }
  }
  // The line the break reads its prefix from, and on the line after the break, whether it is
  // blank: every reading of the markers there must give the break that it has now. An insertion
  // that a closer there ends holds the split too, and rejecting it takes the split away with it.
  const start = inPrefix(line, Math.min(lineEnd(text, line), limit));
  if (start === undefined) return undefined;
  const named = other(start)?.id;
  const lines = readings(text, line, id, markerAt, { left: READINGS, limit }, '');
  if (!lines) return named;
  const linePrefix = linePrefixAt(text, at);
  const now = text.slice(at, breakEnd(text, at, limit));
  for (const read of lines) {
    if (read.joined) continue;
    const rest = text.slice(at, line) + read.before + read.rest + read.following;
    if (rest.slice(0, breakLength(linePrefix, rest)) !== now) return named;
  }
  return undefined;
}

/** A split whose break could read otherwise once another change is decided, and that change. */
export interface DependentBreak {
  split: string;
  other: string;
}

/**
 * The splits of a file whose breaks could read otherwise once other changes are decided
 * (`breakDependsOn`), with how many of each id's breaks do, and the first change in the way.
 */
function dependentBreaks(
  text: string,
  parsed: Parsed,
  markers?: readonly MarkerRange[],
): Map<string, { count: number; other: string }> {
  const found = new Map<string, { count: number; other: string }>();
  const limit = parsed.ledgerRange?.from;
  const eol = eolOf(text);
  const known = new Map<number, ReadonlySet<string>>();
  let starts: Map<number, MarkerAt> | undefined;
  const markerAt = (position: number) => {
    if (!text.startsWith('<!--', position)) return undefined;
    starts ??= new Map(
      (markers ?? markerRanges(parsed)).flatMap(({ mark, segment, role, from, to }) => {
        if (!mark || !segment || role === 'ledger') return [];
        const at: MarkerAt = { id: mark.id, kind: mark.kind, role, end: to };
        const { close, payload } = segment;
        if (role === 'open' && (mark.kind === 'ins' || mark.kind === 'sub') && close) {
          at.through = close.to;
        }
        if (role === 'open' && (mark.kind === 'del' || mark.kind === 'sub') && payload) {
          at.restores = inEol(payload, eol);
        }
        if (role === 'open' && mark.kind === 'split') at.breakEnd = breakEnd(text, to, limit);
        if (role === 'close' && (mark.kind === 'ins' || mark.kind === 'sub')) {
          at.opens = segment.open.from;
          if (mark.kind === 'sub' && payload) at.restores = inEol(payload, eol);
        }
        return [[from, at] as const];
      }),
    );
    return starts.get(position);
  };
  for (const mark of parsed.marks) {
    if (mark.kind !== 'split') continue;
    for (const { open } of mark.segments) {
      const other = breakDependsOn(text, open.from, open.to, mark.id, markerAt, limit, known);
      if (other === undefined) continue;
      const was = found.get(mark.id);
      found.set(mark.id, { count: (was?.count ?? 0) + 1, other: was?.other ?? other });
    }
  }
  return found;
}

/**
 * The split, and the change in the way, when an edit from `before` to `after` leaves a split whose
 * break could read otherwise once other changes are decided, where `before` had no such break of
 * that split. A file that has such a break already, as an older one may, keeps it, and edits
 * elsewhere are not refused for it.
 */
export function breakComesToDepend(
  before: string,
  parsedBefore: Parsed,
  after: string,
  parsedAfter: Parsed,
  markersBefore?: readonly MarkerRange[],
): DependentBreak | undefined {
  const now = dependentBreaks(after, parsedAfter);
  if (now.size === 0) return undefined;
  const was = dependentBreaks(before, parsedBefore, markersBefore);
  for (const [split, { count, other }] of now) {
    if (count > (was.get(split)?.count ?? 0)) return { split, other };
  }
  return undefined;
}

/**
 * How a refusal names a dependent break: the two changes ("your line break right next to Bo Chen's
 * line break"), and the one to decide first: another person's where one is, and not one the edit
 * itself makes (`made`). `ledger` has the entries of the marks the edit made, which the text's own
 * ledger does not have yet.
 */
export function pairWords(
  parsed: Parsed,
  found: DependentBreak,
  author: Person | undefined,
  ledger: Ledger = parsed.ledger,
  made: readonly string[] = [],
): { pair: string; first: string } {
  const read = { ...parsed, ledger };
  const byId = (id: string) => {
    const mark = parsed.marks.find((candidate) => candidate.id === id);
    const entry = mark && ledger.marks[id];
    return mark && entry ? { ...mark, entry } : mark;
  };
  const split = byId(found.split);
  const other = byId(found.other);
  const a = split ? nameOf(read, split, author) : 'a line break';
  const b = other ? nameOf(read, other, author) : 'another change';
  if (a === b) return { pair: `${a} right next to another`, first: 'one of them' };
  const ranked = [
    { name: b, id: found.other, by: other?.entry.by },
    { name: a, id: found.split, by: split?.entry.by },
  ].filter((mark) => !made.includes(mark.id));
  const theirs = ranked.find((mark) => mark.by !== undefined && mark.by !== author?.handle);
  return { pair: `${a} right next to ${b}`, first: (theirs ?? ranked[0])?.name ?? a };
}
