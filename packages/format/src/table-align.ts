// Aligning a table's columns (format §3.7): a block format change around the table, `align=SPEC`,
// with the old delimiter row as its value. The opener stands alone on the line before the table, as
// any mark that starts a block does (§3.3), and the closer after one blank line below the table and
// its deletion lines. Accepting takes the markers away; rejecting writes the old delimiter row back.
// With Track Changes off the delimiter row is changed as it says, in the change's `align=` too, so
// that both views have it.

import { lineEnd, lineStart, openerRange } from './blocks.ts';
import { eolOf } from './changes.ts';
import { EditError } from './errors.ts';
import { addPerson, commitEdit, workingLedger } from './edit-support.ts';
import { encodeValue, isAlignOps, opsOf } from './format-ops.ts';
import type { AlignedColumn } from './format-ops.ts';
import type { FormatReader } from './format-reader.ts';
import { idsIn, newId } from './ids.ts';
import { encodePayload } from './payload.ts';
import { parse } from './parse.ts';
import { readDelimiterRow, readRowCells, tablesOfText } from './table.ts';
import type { TableAlign, TableRead } from './table.ts';
import { deletedColCells } from './table-cols.ts';
import { closersBelow, deletionLine, tableEnd } from './table-rows.ts';
import type {
  EditContext,
  MarkEntry,
  MarkRange,
  Parsed,
  Range,
  Segment,
  TextChange,
} from './types.ts';

const refused = (reason: string) => new EditError(reason, 'no-legal-placement');

const LOST =
  "This alignment change can't be rejected, because its table no longer has the columns it had. Accept it, or change the text in Raw with Track Changes off.";

/** The words of an alignment, in a card: `column Count centered (was left)`. */
const WORDS: Record<TableAlign, string> = {
  '': 'default',
  left: 'left',
  center: 'centered',
  right: 'right',
};

/** A delimiter cell for `align`, as wide as `old`: dashes, with a colon at the ends the alignment
 * asks for. A cell of one dash grows by the colons. */
export function delimiterCell(old: string, align: TableAlign): string {
  const left = align === 'left' || align === 'center' ? ':' : '';
  const right = align === 'right' || align === 'center' ? ':' : '';
  const dashes = Math.max(1, old.length - left.length - right.length);
  return left + '-'.repeat(dashes) + right;
}

/** The changes of a delimiter row `line` (starting at `base` in its text) that give columns `cols`
 * the alignment `align`. */
function cellChanges(line: string, base: number, cols: readonly number[], align: TableAlign) {
  const read = readRowCells(line, 0, line.length);
  const changes: TextChange[] = [];
  for (const col of cols) {
    const cell = read.cells[col];
    if (!cell) throw new EditError('There is no such column in this table.');
    changes.push({
      from: base + cell.textFrom,
      to: base + cell.textTo,
      insert: delimiterCell(line.slice(cell.textFrom, cell.textTo), align),
    });
  }
  return changes;
}

/** Whether a mark is an alignment change of a table (format §3.7). */
export function isAlignMark(mark: MarkRange): boolean {
  return mark.kind === 'fmt' && mark.segments.some((s) => isAlignOps(opsOf(mark, s)));
}

/** The alignments an alignment change's old delimiter row has, for a table of `columns` columns, or
 * null when it has none for them. */
export function alignWas(mark: MarkRange, columns: number): TableAlign[] | null {
  const segment = mark.segments[0];
  const kept = segment ? specOf(mark, segment) : undefined;
  return kept ? alignsOf(kept.spec, columns) : null;
}

/** The old delimiter row of an alignment change: the value of its `align=`, and where it is written
 * in the opener. */
function specOf(mark: MarkRange, segment: Segment): { spec: string; source: string } | undefined {
  const [op] = opsOf(mark, segment);
  return op?.value === undefined ? undefined : { spec: op.value, source: op.source };
}

/** An alignment change of `table`, as it stands around it: a format change whose one operation is
 * `align=`, its opener on the line before the table and its closer below the table and its
 * deletion lines, with nothing but markers and white space between. */
export function alignMarkOf(parsed: Parsed, table: TableRead): MarkRange | undefined {
  const { text } = parsed;
  return parsed.marks.find((mark) => {
    if (mark.kind !== 'fmt' || mark.segments.length !== 1) return false;
    const segment = mark.segments[0];
    if (!segment?.close || !isAlignOps(opsOf(mark, segment))) return false;
    const head = segment.carrier?.to ?? segment.open.to;
    if (head > table.from || segment.close.from < table.to) return false;
    const bare = (s: string) => s.replace(/<!--(?:[^-]|-(?!->))*-->/g, '').trim() === '';
    return bare(text.slice(head, table.from)) && bare(text.slice(table.to, segment.close.from));
  });
}

/** What may follow a closer on its line and leave it its blank line: openers of other marks. */
const OPENERS_ONLY = /^(?:<!--(?!\/)(?:[^-]|-(?!->))*-->)*[ \t]*$/;

/** A deletion of just the blank line in front of a closer, as a payload writes it (`\n\n`). */
const LEAD_DELETED = /<!--del [a-z0-9]{4} \\n\\n-->$/;

/** The range that the closer of an alignment change takes with it: the line break and the blank line
 * before it, back to the end of the table or its last deletion line, when it is alone on its line. A
 * closer with others after it on its line leaves them their line, and one with text on the next
 * line takes its own line only, so that the text is not read as a row. */
export function closerRange(text: string, close: Range): Range {
  const start = lineStart(text, close.from);
  const end = lineEnd(text, close.to);
  // The blank line in front of it, which a tracked deletion of the paragraph below the table took as
  // deleted text (the break stands in front of the hidden closer, and the deletion goes in two pieces
  // around it): the piece goes with the closer, as the blank line does when nothing took it, so that
  // deciding the deletion and the alignment change in either order writes the same bytes.
  const taken = LEAD_DELETED.exec(text.slice(Math.max(0, close.from - 40), close.from));
  if (taken && OPENERS_ONLY.test(text.slice(close.to, end))) {
    return { from: close.from - taken[0].length, to: close.to };
  }
  // Alone on its line, or with only the openers of other marks after it (a deletion that starts right
  // behind it, of the paragraph below the table): a closer after it keeps the blank line for its own.
  if (start !== close.from || !OPENERS_ONLY.test(text.slice(close.to, end))) return close;
  const after = text.indexOf('\n', close.to);
  if (after !== -1) {
    const next = lineEnd(text, after + 1);
    if (text.slice(after + 1, next).trim() !== '') return { from: start, to: after + 1 };
  }
  let at = start;
  let blanks = 0;
  while (at > 0) {
    const breakFrom = text[at - 2] === '\r' ? at - 2 : at - 1;
    const previous = lineStart(text, breakFrom);
    const blank = text.slice(previous, breakFrom).trim() === '';
    if (blank && ++blanks > 1) break;
    at = breakFrom;
    if (!blank) break;
  }
  return { from: at, to: close.to };
}

/** The changes that take an alignment change's markers away, with what goes with them. */
export function alignHide(text: string, segment: Segment): TextChange[] {
  const changes: TextChange[] = [{ ...openerRange(segment), insert: '' }];
  if (segment.close) changes.push({ ...closerRange(text, segment.close), insert: '' });
  return changes;
}

/** The table that an alignment change's segment is around, in the text of `parsed`. */
function tableOfSegment(parsed: Parsed, segment: Segment): TableRead | undefined {
  const head = segment.carrier?.to ?? segment.open.to;
  const to = segment.close?.from ?? head;
  return tablesOfText(parsed.text, parsed).find((table) => table.from >= head && table.to <= to);
}

/** The alignments of a delimiter row `line` for `columns` columns, or null when it is none. */
const alignsOf = (line: string, columns: number): TableAlign[] | null =>
  readDelimiterRow(line, 0, line.length, columns);

/**
 * The changes that decide one segment of an alignment change: its markers go, and rejecting writes
 * the old delimiter row back.
 *
 * @throws EditError when the table no longer has the columns the old row has.
 */
export function alignDecision(
  reader: FormatReader,
  mark: MarkRange,
  segment: Segment,
  action: 'accept' | 'reject',
): TextChange[] {
  const hide = alignHide(reader.text, segment);
  if (action === 'accept') return hide;
  const kept = specOf(mark, segment);
  const parsed = reader.parsed ?? parse(reader.text);
  const table = tableOfSegment(parsed, segment);
  if (!kept || !table || alignsOf(kept.spec, table.aligns.length) === null) throw refused(LOST);
  return [{ ...table.delimiter, insert: kept.spec }, ...hide].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );
}

/** What an alignment change did to each column: where the delimiter row now differs from the old. */
export function alignChange(parsed: Parsed, mark: MarkRange): AlignedColumn[] {
  const segment = mark.segments[0];
  const kept = segment ? specOf(mark, segment) : undefined;
  const table = segment ? tableOfSegment(parsed, segment) : undefined;
  if (!kept || !table) return [];
  const was = alignsOf(kept.spec, table.aligns.length);
  if (!was) return [];
  const header = table.rows[0];
  const columns: AlignedColumn[] = [];
  table.aligns.forEach((now, col) => {
    const before = was[col] ?? '';
    if (now === before) return;
    const cell = header?.cells[col];
    const name = cell ? parsed.text.slice(cell.textFrom, cell.textTo).trim() : '';
    columns.push({ col, name, now, was: before });
  });
  return columns;
}

/** An alignment change in the words of a card: `column Count centered (was left)`. */
export function alignLabel(columns: readonly AlignedColumn[]): string {
  if (columns.length === 0) return 'alignment';
  return columns
    .map(({ col, name, now, was }) => {
      const who = name === '' ? `${col + 1}` : name;
      return `column ${who} ${WORDS[now]} (was ${WORDS[was]})`;
    })
    .join(', ');
}

/** Where a closer for a table goes, and what is written there: after one blank line below the
 * table and its deletion lines, in front of the closers that are there already. */
function closerSlot(text: string, table: TableRead, eol: string, marker: string): TextChange {
  const last = table.deletions.at(-1);
  const base = last ? deletionLine(text, last).to : tableEnd(table);
  const closers = closersBelow(text, base);
  if (closers !== -1) return { from: closers, to: closers, insert: marker };
  return { from: base, to: base, insert: eol + eol + marker };
}

/**
 * The changes that give the kept copy of a moved column its new delimiter cell: with Track Changes off
 * an edit in a pending move's copy is written in both halves of the move (format §3.7, §3.10), and the
 * kept copy has the column's delimiter cell as its second line.
 */
function movedCopies(
  text: string,
  table: TableRead,
  cols: readonly number[],
  align: TableAlign,
): TextChange[] {
  const changes: TextChange[] = [];
  for (const col of cols) {
    const marked = table.colMarks.find((c) => c.col === col)?.mark;
    if (marked?.entry.move === undefined) continue;
    const twin = table.deletions.find((d) => d.mark.id === marked.entry.move);
    const open = twin?.mark.segments[0]?.open;
    const payload = twin?.mark.payload;
    if (!twin || !open || payload === undefined) continue;
    const prefix = /^col=\d+ ?/.exec(payload)?.[0] ?? '';
    const lines = deletedColCells(payload);
    const cell = lines[1];
    if (cell === undefined) continue;
    const found = /^( *)(.*?)( *)$/.exec(cell);
    if (!found) continue;
    lines[1] = `${found[1]}${delimiterCell(found[2] ?? '', align)}${found[3]}`;
    const head = text.slice(open.from, open.to).indexOf(' col=');
    if (head === -1) continue;
    changes.push({
      from: open.from + head + 1,
      to: open.to - 3,
      insert: encodePayload(prefix + lines.join('\n')),
    });
  }
  return changes;
}

/** What aligning columns gives: the changes, and where the caret goes in the new text. */
export interface AlignEdit {
  changes: TextChange[];
  caret: number;
  cols: number[];
}

/** An alignment of columns. */
export interface AlignOp {
  cols: readonly number[];
  align: TableAlign;
}

/** `pos` after `changes` that lie before it. */
function mapped(changes: readonly TextChange[], pos: number): number {
  return changes.reduce(
    (at, change) => (change.to <= pos ? at + change.insert.length - (change.to - change.from) : at),
    pos,
  );
}

/**
 * Aligning columns of a table (format §3.7, rule 5). With `ctx` it is a format change by its author:
 * the delimiter row gets the new alignment and an `align=` keeps the old row around the table; the
 * author's own pending change is changed in place, and goes when the old alignments are back.
 * Without it the delimiter row is changed as it says, and so is the old row of a change that is
 * pending, so that rejecting it keeps what was done.
 *
 * @throws EditError when another person's alignment change is pending, or the columns are as asked.
 */
export function alignEdit(
  text: string,
  parsed: Parsed,
  table: TableRead,
  op: AlignOp,
  ctx: EditContext | null,
): AlignEdit {
  const cols = [...new Set(op.cols)].sort((a, b) => a - b);
  const targets = cols.filter((col) => table.aligns[col] !== op.align);
  if (targets.length === 0) throw refused('The columns are already aligned that way.');
  const delimiter = text.slice(table.delimiter.from, table.delimiter.to);
  const row = cellChanges(delimiter, table.delimiter.from, targets, op.align);
  const mark = alignMarkOf(parsed, table);
  const segment = mark?.segments[0];
  const kept = mark && segment ? specOf(mark, segment) : undefined;
  const eol = eolOf(text, parsed.ledgerRange);
  const ledger = workingLedger(parsed.ledger);
  const caretAt = (changes: readonly TextChange[]) =>
    mapped(changes, table.rows[0]?.cells[cols[0] ?? 0]?.textFrom ?? table.from);
  const done = (changes: TextChange[], options: Parameters<typeof commitEdit>[3]): AlignEdit => {
    const finished = commitEdit(text, changes, ledger, options);
    return { changes: finished, caret: caretAt(finished), cols };
  };

  if (mark && segment && ctx && mark.entry.by !== ctx.author.handle) {
    const name =
      parsed.ledger.people.find((p) => p.handle === mark.entry.by)?.name ?? mark.entry.by;
    throw refused(`${name}'s alignment change is pending. Decide it first.`);
  }

  if (mark && segment && kept) {
    // The new row, as the delimiter row reads once changed.
    const now = alignsOf(applyLine(delimiter, row, table.delimiter.from), table.aligns.length);
    const was = alignsOf(kept.spec, table.aligns.length);
    const same = now !== null && was !== null && now.every((a, i) => a === was[i]);
    if (ctx === null) {
      // Plain: the old row is changed the same, so that rejecting the change keeps what was done.
      const old = applyLine(kept.spec, cellChanges(kept.spec, 0, targets, op.align), 0);
      const oldNow = alignsOf(old, table.aligns.length);
      if (now !== null && oldNow !== null && oldNow.every((a, i) => a === now[i])) {
        // Nothing is left to decide.
        delete ledger.marks[mark.id];
        return done([...row, ...alignHide(text, segment)], { parsed, removes: true });
      }
      const at =
        segment.open.from + text.slice(segment.open.from, segment.open.to).indexOf(kept.source);
      return done(
        [
          ...row,
          ...movedCopies(text, table, targets, op.align),
          { from: at, to: at + kept.source.length, insert: `align=${encodeValue(old)}` },
        ],
        { parsed, keepLedger: true },
      );
    }
    if (same) {
      // Your own change is undone by the new alignment: the old row comes back as it was.
      delete ledger.marks[mark.id];
      return done([{ ...table.delimiter, insert: kept.spec }, ...alignHide(text, segment)], {
        parsed,
        removes: true,
      });
    }
    return done(row, { parsed, keepLedger: true });
  }

  if (ctx === null) {
    return done([...row, ...movedCopies(text, table, targets, op.align)], {
      parsed,
      keepLedger: true,
    });
  }

  addPerson(ledger, ctx.author);
  const taken = idsIn(text);
  const id = newId(taken, ctx.random);
  const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
  if (ctx.group !== undefined) entry.group = ctx.group;
  if (ctx.note !== undefined) entry.note = ctx.note;
  ledger.marks[id] = entry;
  const opener = `<!--fmt ${id} align=${encodeValue(delimiter)}-->${eol}${eol}`;
  return done(
    [
      { from: table.from, to: table.from, insert: opener },
      ...row,
      closerSlot(text, table, eol, `<!--/${id}-->`),
    ],
    { parsed, created: [id], keeps: 'original' },
  );
}

/** `line` (which starts at `base` in the text) with `changes` of the text made in it. */
function applyLine(line: string, changes: readonly TextChange[], base: number): string {
  let out = '';
  let at = 0;
  for (const change of changes.toSorted((a, b) => a.from - b.from)) {
    out += line.slice(at, change.from - base) + change.insert;
    at = change.to - base;
  }
  return out + line.slice(at);
}
