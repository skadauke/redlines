// The units a widened edit replaces (format §3.12): a block, a list item, a list, a code block, a
// table, a quote. This reads the lines of a file into those units, with the markers of other people's
// changes in them: a line that holds only an opener goes with the block after it (§3.3), a line that
// holds only closers with the block before it. It is not a Markdown parser: it knows quotes, list
// items by their indentation, fenced and indented code, raw-text HTML, tables and the rest as
// paragraphs, and the gate of `widen.ts` looks at what a replacement of a unit makes of the file.

import { bodyStart } from './blocks.ts';
import { scan } from './scan.ts';
import { tablesOfText } from './table.ts';
import type { Parsed, Range } from './types.ts';

export type UnitKind = 'block' | 'code' | 'table' | 'item' | 'list' | 'quote';

/** A piece of a file that can be replaced whole. Offsets are in the source. */
export interface Unit {
  kind: UnitKind;
  /** Where the line that the unit starts on starts. */
  lineFrom: number;
  /** Where the unit's own text starts: after the prefix of its container on that line, and after
   * the bullet, for an item. */
  from: number;
  /** The end of its last line, before the line break. */
  to: number;
  /** What stands between `lineFrom` and `from`. */
  prefix: string;
  /** In a list that has no blank line between its items or the blocks of an item. */
  tight: boolean;
  parent: Unit | undefined;
  children: Unit[];
  /** Fenced, display math, raw text and indented code have no marks inside. */
  atomic: boolean;
}

/** A line of the body as a container sees it: `contentFrom` is past the prefixes it holds. */
interface Line {
  lineFrom: number;
  contentFrom: number;
  to: number;
  text: string;
}

const BULLET = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/;
const QUOTE = /^( {0,3})>( ?)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const RULE = /^ {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})$/;
const MARKER = /<!--.*?-->/g;
const CLOSER_ONLY = /^(?:<!--\/[a-z0-9]{4}-->)+$/;

const blank = (line: Line) => line.text.trim() === '';
const bare = (line: Line) => line.text.replace(MARKER, '').trim();
/** A line with markers and nothing else: its opener goes with the block after it. */
const glueOpen = (line: Line) =>
  !blank(line) && bare(line) === '' && !CLOSER_ONLY.test(line.text.trim());
/** A line with closers and nothing else: it goes with the block before it. */
const glueClose = (line: Line) => !blank(line) && CLOSER_ONLY.test(line.text.trim());

/** The units of the body of a file: its top-level blocks, with the containers in them. */
export function unitsOf(text: string, parsed: Parsed, region?: Range): Unit[] {
  const stop = region?.to ?? parsed.ledgerRange?.from ?? text.length;
  const lines: Line[] = [];
  for (let at = region?.from ?? bodyStart(text); at <= stop;) {
    const newline = text.indexOf('\n', at);
    let to = newline === -1 || newline >= stop ? Math.min(stop, text.length) : newline;
    if (text[to - 1] === '\r' && to > at) to--;
    if (to < at) break;
    lines.push({ lineFrom: at, contentFrom: at, to, text: text.slice(at, to) });
    if (newline === -1 || newline + 1 > stop) break;
    at = newline + 1;
  }
  const verbatim = scan(text).verbatim.filter((v) => v.kind === 'fence' || v.kind === 'raw');
  const read = reader(text, verbatim);
  const units = read(lines, undefined, false);
  // A table is a block that the file's table reader finds, with its deletion lines.
  const tables = tablesOfText(text, parsed).map((table) => ({
    from: table.from,
    to: Math.max(
      table.to,
      ...table.deletions.map(({ mark }) => {
        const last = mark.segments.at(-1);
        return (last?.close ?? last?.open)?.to ?? table.to;
      }),
    ),
  }));
  if (tables.length > 0) markTables(text, units, tables);
  withPrefixes(text, units);
  return units;
}

function markTables(text: string, units: Unit[], tables: readonly Range[]): void {
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    const table = tables.find(
      (found) =>
        unit.kind === 'block' &&
        found.from >= unit.from &&
        found.from <= unit.to &&
        text.slice(unit.from, found.from).replace(MARKER, '').trim() === '',
    );
    if (table) {
      unit.kind = 'table';
      unit.atomic = false;
      // The deletion lines under the table are its own: blocks that start inside it go.
      while (units[i + 1] && units[i + 1]!.from < table.to) {
        unit.to = Math.max(unit.to, units[i + 1]!.to);
        units.splice(i + 1, 1);
      }
      unit.to = Math.max(unit.to, table.to);
    }
    markTables(text, unit.children, tables);
  }
}

function reader(text: string, verbatim: readonly { from: number; to: number }[]) {
  const read = (lines: readonly Line[], parent: Unit | undefined, tight: boolean): Unit[] => {
    const units: Unit[] = [];
    let i = 0;
    while (i < lines.length) {
      const first = lines[i];
      if (!first) break;
      if (blank(first)) {
        i++;
        continue;
      }
      // Lines that hold only closers belong to the block before.
      if (glueClose(first) && units.length > 0) {
        const last = units[units.length - 1];
        if (last) last.to = first.to;
        i++;
        continue;
      }
      // Lines of openers, and the blank lines after them, belong to the block that follows.
      let at = i;
      while (lines[at] && (glueOpen(lines[at]!) || (blank(lines[at]!) && at > i))) at++;
      const head = lines[at];
      const start = lines[i]!;
      if (!head) {
        // Openers and nothing after them: a block of their own.
        units.push(unit('block', start, lines[at - 1] ?? start, parent, tight));
        i = at;
        continue;
      }
      const make = (kind: UnitKind, end: Line, atomic = false, from = start.contentFrom) => {
        const made = unit(kind, start, end, parent, tight, from);
        made.atomic = atomic;
        return made;
      };
      const quote = QUOTE.exec(head.text);
      const bullet = BULLET.exec(head.text);
      const fence = FENCE.exec(head.text);
      const rawEnd = verbatim.find(
        (v) => v.from === head.lineFrom && text.slice(v.from, v.from + 1) !== '`',
      );
      if (fence) {
        const end = closeFence(lines, at, fence[1] ?? '```');
        units.push(make('code', lines[end] ?? head, true));
        i = end + 1;
      } else if (rawEnd && /^ {0,3}<(?:script|pre|style|textarea|title)/i.test(head.text)) {
        let end = at;
        while (lines[end] && lines[end]!.to < rawEnd.to) end++;
        units.push(make('code', lines[Math.min(end, lines.length - 1)] ?? head, true));
        i = end + 1;
      } else if (quote) {
        let end = at;
        const inner: Line[] = [];
        for (let k = at; k < lines.length; k++) {
          const line = lines[k]!;
          const q = QUOTE.exec(line.text);
          if (q) {
            inner.push({
              ...line,
              contentFrom: line.contentFrom + q[0].length,
              text: line.text.slice(q[0].length),
            });
            end = k;
          } else if (
            !blank(line) &&
            !startsBlock(line.text) &&
            k === end + 1 &&
            !blank(lines[k - 1]!)
          ) {
            // A lazy line: it goes on the paragraph above.
            inner.push(line);
            end = k;
          } else break;
        }
        const quoted = unit('quote', start, lines[end]!, parent, tight);
        quoted.children = read(inner, quoted, false);
        units.push(quoted);
        i = end + 1;
      } else if (bullet) {
        const { list, next } = readList(lines, at, i, parent, read);
        units.push(list);
        i = next;
      } else if (/^( {4}|\t)/.test(head.text) && !paragraphAbove(units, start)) {
        let end = at;
        while (
          lines[end + 1] &&
          (/^( {4}|\t)/.test(lines[end + 1]!.text) || blank(lines[end + 1]!))
        )
          end++;
        while (blank(lines[end]!) && end > at) end--;
        units.push(make('code', lines[end]!, true));
        i = end + 1;
      } else {
        // A paragraph, a heading, a rule, an HTML block: lines up to a blank line.
        let end = at;
        if (!ATX.test(head.text) && !RULE.test(head.text.trim())) {
          while (lines[end + 1] && !blank(lines[end + 1]!) && !startsBlock(lines[end + 1]!.text))
            end++;
        }
        while (lines[end + 1] && glueClose(lines[end + 1]!)) end++;
        units.push(make('block', lines[end]!));
        i = end + 1;
      }
    }
    return units;
  };
  return read;
}

function paragraphAbove(units: readonly Unit[], start: Line): boolean {
  const last = units.at(-1);
  return last !== undefined && last.kind === 'block' && last.to + 1 === start.lineFrom;
}

/** A line that starts a block even in the middle of a paragraph. */
function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    ATX.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line.trim()) ||
    /^ {0,3}(?:[-*+]|1[.)])(?: |$)/.test(line)
  );
}

function closeFence(lines: readonly Line[], at: number, open: string): number {
  const char = open.charAt(0);
  for (let k = at + 1; k < lines.length; k++) {
    const text = lines[k]!.text.trim();
    if (text.length >= open.length && text.split('').every((c) => c === char)) return k;
  }
  return lines.length - 1;
}

function unit(
  kind: UnitKind,
  first: Line,
  last: Line,
  parent: Unit | undefined,
  tight: boolean,
  from = first.contentFrom,
): Unit {
  return {
    kind,
    lineFrom: first.lineFrom,
    from,
    to: last.to,
    prefix: '',
    tight,
    parent,
    children: [],
    atomic: false,
  };
}

/** The items of the list that starts at `lines[at]`, and where the list ends. */
function readList(
  lines: readonly Line[],
  at: number,
  start: number,
  parent: Unit | undefined,
  read: (lines: readonly Line[], parent: Unit | undefined, tight: boolean) => Unit[],
): { list: Unit; next: number } {
  const head = lines[at]!;
  const first = BULLET.exec(head.text)!;
  const ordered = /\d/.test(first[2] ?? '');
  const delimiter = ordered ? (first[2] ?? '').slice(-1) : (first[2] ?? '');
  const list = unit(
    'list',
    lines[start]!,
    head,
    parent,
    false,
    head.contentFrom + (first[1]?.length ?? 0),
  );
  const items: { first: number; last: number; width: number; marker: string }[] = [];
  let k = at;
  while (k < lines.length) {
    const line = lines[k]!;
    const m = BULLET.exec(line.text);
    const sameKind =
      m &&
      (ordered
        ? /\d/.test(m[2] ?? '') && (m[2] ?? '').slice(-1) === delimiter
        : m[2] === delimiter);
    if (!sameKind || !m) break;
    const marker = (m[1] ?? '') + (m[2] ?? '');
    const spaces = (m[3] ?? '').length;
    const width = marker.length + (spaces > 4 || spaces === 0 ? 1 : spaces);
    let last = k;
    for (let j = k + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (blank(next)) {
        // A blank line holds on when an indented line follows.
        let after = j + 1;
        while (lines[after] && blank(lines[after]!)) after++;
        const follow = lines[after];
        if (follow && indentOf(follow.text) >= width) {
          last = after;
          j = after;
          continue;
        }
        break;
      }
      if (indentOf(next.text) >= width) {
        last = j;
        continue;
      }
      // A lazy line goes on the paragraph above, unless it starts a block.
      if (!startsBlock(next.text) && !blank(lines[j - 1]!) && !BULLET.test(next.text)) {
        last = j;
        continue;
      }
      break;
    }
    items.push({ first: k, last, width, marker });
    k = last + 1;
    // Blank lines between items keep the list going when another item follows.
    let after = k;
    while (lines[after] && blank(lines[after]!)) after++;
    if (lines[after] && BULLET.test(lines[after]!.text)) k = after;
    else break;
  }
  list.to = lines[items.at(-1)?.last ?? at]!.to;
  const loose = items.some((item, index) => {
    if (index > 0 && blank(lines[item.first - 1]!)) return true;
    for (let j = item.first; j < item.last; j++) {
      if (blank(lines[j]!) && lines[j + 1] && !blank(lines[j + 1]!)) {
        // A blank line inside an item between its blocks loosens the list.
        const inner = lines.slice(j + 1, item.last + 1);
        if (inner.length > 0) return true;
      }
    }
    return false;
  });
  list.tight = !loose;
  for (const item of items) {
    const itemFirst = lines[item.first]!;
    const m = BULLET.exec(itemFirst.text)!;
    const content =
      (m[1]?.length ?? 0) +
      (m[2]?.length ?? 0) +
      ((m[3] ?? '').length > 4 ? 1 : (m[3] ?? '').length);
    const lastLine = lines[item.last]!;
    const element = unit(
      'item',
      itemFirst,
      lastLine,
      list,
      list.tight,
      itemFirst.contentFrom + content,
    );
    const inner: Line[] = [];
    for (let j = item.first; j <= item.last; j++) {
      const line = lines[j]!;
      const strip = j === item.first ? content : Math.min(indentOf(line.text), item.width);
      inner.push({ ...line, contentFrom: line.contentFrom + strip, text: line.text.slice(strip) });
    }
    element.children = read(inner, element, list.tight);
    list.children.push(element);
  }
  return { list, next: k };
}

function indentOf(text: string): number {
  let columns = 0;
  for (const c of text) {
    if (c === ' ') columns++;
    else if (c === '\t') columns += 4 - (columns % 4);
    else break;
  }
  return columns;
}

/** Fills `prefix` of every unit: what stands before its text on its first line. */
export function withPrefixes(text: string, units: readonly Unit[]): void {
  for (const unit of units) {
    unit.prefix = text.slice(unit.lineFrom, unit.from);
    withPrefixes(text, unit.children);
  }
}

/**
 * Which lists a file has, and whether each is tight, with the lists in them: what a blank line in a
 * tight list changes, and what a reader that does not know the markers reads differently from the
 * newest view. A replacement must leave the shape that the newest view has: the gate of `widen.ts`
 * compares the two.
 */
export function shapeOf(units: readonly Unit[]): string {
  return units
    .flatMap((unit) =>
      unit.kind === 'list'
        ? [`${unit.tight ? 'T' : 'L'}(${shapeOf(unit.children)})`]
        : [shapeOf(unit.children)],
    )
    .filter((shape) => shape !== '')
    .join(',');
}
