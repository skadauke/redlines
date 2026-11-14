// Aligning a table's columns (format §3.7): a block format change, `align=SPEC`, with the old
// delimiter row as its value. Redlines writes it as a point: one mark with no closer, at the end of the
// text of the header row's last cell (#281), `<!--fmt k3x9 align=SPEC-->`. Nothing below or above the
// table can share a line with it, so no edit beside the table has to be refused for it. Accepting takes the
// mark away; rejecting writes the old delimiter row back and takes the mark away; neither decision
// changes a byte outside the table's first two lines. With Track Changes off the delimiter row is
// changed as it says, in the change's `align=` too, so that both views have it.
//
// The span form is still read, drawn, carded and decided, and never written: an opener alone on the line
// before the table, as any mark that starts a block does (§3.3), and a closer after one blank line below
// the table and its deletion lines. Other tools wrote it, and the code for it (`closerRange`,
// `checkAlignGap`, the closer in `alignHide`, `alignMarkOf` and `tableOfSegment`) is for that form alone.

import { lineEnd, lineStart, openerRange } from './blocks.ts';
import { changesRun, isAlignPoint, placeReads, readsOtherwise } from './align-point.ts';
import { applyChanges, eolOf } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { addPerson, commitEdit, workingLedger } from './edit-support.ts';
import { encodeValue, isAlignOps, opsOf } from './format-ops.ts';
import type { AlignedColumn } from './format-ops.ts';
import type { FormatReader } from './format-reader.ts';
import { idsIn, newId } from './ids.ts';
import { paragraphRange, visible } from './inline.ts';
import { serializeLedger } from './ledger-write.ts';
import { markerRanges } from './markers.ts';
import { encodePayload } from './payload.ts';
import { parse } from './parse.ts';
import { readDelimiterRow, readRowCells, tablesOfText } from './table.ts';
import type { TableAlign, TableRead } from './table.ts';
import { deletedColCells } from './table-cols.ts';
import { newestView, originalView } from './views.ts';
import type {
  EditContext,
  MarkEntry,
  MarkRange,
  Parsed,
  Range,
  Segment,
  TextChange,
} from './types.ts';

export { isAlignPoint };

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

/** An alignment change of `table`: the point form, a mark with no closer in a row of the table (a
 * merge can leave it in any row; the writer puts it at the end of the header's last cell), or the
 * span form that other tools wrote, a format change whose one operation is `align=`, its opener on the
 * line before the table and its closer below the table and its deletion lines, with nothing but
 * markers and white space between. */
export function alignMarkOf(parsed: Parsed, table: TableRead): MarkRange | undefined {
  const { text } = parsed;
  const point = parsed.marks.find((mark) => {
    const open = isAlignPoint(mark) ? mark.segments[0]?.open : undefined;
    return open !== undefined && table.from <= open.from && open.to <= table.to;
  });
  if (point) return point;
  // The span form, which Redlines no longer writes.
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

/** The range that the closer of an alignment change takes with it: the line break and the blank line
 * before it, back to the end of the table or its last deletion line, when it is alone on its line. A
 * closer with others after it on its line leaves them their line, and one with text on the next
 * line takes its own line only, so that the text is not read as a row. Only the span form that other
 * tools wrote has a closer: Redlines writes the point form, which has none. */
export function closerRange(text: string, close: Range): Range {
  const start = lineStart(text, close.from);
  const end = lineEnd(text, close.to);
  if (start !== close.from || text.slice(close.to, end).trim() !== '') return close;
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

/** The changes that take an alignment change's markers away, with what goes with them: the opener
 * alone for a point, which has no carrier and no closer; for the span form that other tools wrote, the
 * opener with its carrier, and the closer with the blank line before it. */
export function alignHide(text: string, segment: Segment): TextChange[] {
  const changes: TextChange[] = [{ ...openerRange(segment), insert: '' }];
  if (segment.close) changes.push({ ...closerRange(text, segment.close), insert: '' });
  return changes;
}

/** The table that an alignment change's segment belongs to, in the text of `parsed`: the one around
 * which its range form stands, or the one whose rows hold the opener of its point form. A point that
 * no table holds, as the opener of a range whose closer is gone, belongs to none. */
function tableOfSegment(parsed: Parsed, segment: Segment): TableRead | undefined {
  const tables = tablesOfText(parsed.text, parsed);
  const { close } = segment;
  if (!close) {
    const { open } = segment;
    return tables.find((table) => table.from <= open.from && open.to <= table.to);
  }
  // The span form that other tools wrote: the table between the opener's carrier and the closer.
  const head = segment.carrier?.to ?? segment.open.to;
  return tables.find((table) => table.from >= head && table.to <= close.from);
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

/** `pos` after `changes` that lie before it. Text written at `pos` itself stays after it: a caret in
 * front of the mark of an alignment change stays in front of it. */
function mapped(changes: readonly TextChange[], pos: number): number {
  return changes.reduce((at, change) => {
    const before = change.from < change.to ? change.to <= pos : change.to < pos;
    return before ? at + change.insert.length - (change.to - change.from) : at;
  }, pos);
}

/** The words of a refusal to write the mark of an alignment change where the header's last cell ends. */
const MARK_PLACE =
  "A marker can't go at the end of this table's header, where Markdown would read it otherwise. Change the end of its last cell first, then align.";

/**
 * Where the mark of an alignment change goes (format §3.7, #281): the end of the text of the header's
 * last cell, after any marks that end that text and before the cell's padding and its closing pipe; the
 * line's end in a header with no trailing pipe, with any spaces left after it; the stop after the first
 * space of an empty cell. Never added space: a space between the text and the mark would not come back
 * when the mark is decided.
 *
 * @throws EditError when a marker can't stand there: in the text as it reads now, or in the text as it
 * reads with every other change of the file rejected, which brings back what a deletion or a replacement
 * at the end of the cell took out, in front of the mark (a backslash that is deleted, say, would escape it
 * once the deletion is rejected). `placeHolds` looks at the orders of decisions between those two.
 */
function markPlace(text: string, parsed: Parsed, table: TableRead): number {
  const last = table.rows[0]?.cells.at(-1);
  if (!last) throw new EditError('There is no such column in this table.');
  const at = last.textTo;
  if (!placeReads(text, parsed, last.textFrom, at)) throw refused(MARK_PLACE);
  const original = originalView(text);
  const to = original.map.fromSource(at);
  const from = original.map.fromSource(last.textFrom);
  if (readsOtherwise(original.text, [], to) || changesRun(original.text.slice(from, to))) {
    throw refused(MARK_PLACE);
  }
  return at;
}

/** How many changes in the header's last cell are decided in every order before the mark is written. More
 * than that are too many to try, and the mark is refused. */
const CELL_CHANGES = 2;

/** The words of a refusal to write the mark where more than `CELL_CHANGES` changes are pending in the
 * header's last cell. */
const TOO_MANY = "Decide the changes in the last cell of this table's header first, then align.";

/** Where the lines above a table that hold only markers start. A marker can't start the header of a table
 * that has no leading pipe, so the opener of a change that begins in its first cell stands on a line of its
 * own above it, with a blank line after it (format §3.3, §3.7). */
function carriersFrom(text: string, tableFrom: number): number {
  let at = tableFrom;
  while (at > 0) {
    const end = text[at - 2] === '\r' ? at - 2 : at - 1;
    const previous = lineStart(text, end);
    const line = text.slice(previous, end);
    if (line.trim() !== '' && !/^\s*(?:<!--[\s\S]*?-->\s*)+$/.test(line)) break;
    at = previous;
  }
  return at;
}

/** The decidable changes with a marker in the header's last cell of `table`, but the mark `id`: in a header
 * of one cell, whose first cell it is too, those that start on the lines above it count as well. */
function changesIn(text: string, parsed: Parsed, table: TableRead, id: string): MarkRange[] {
  const cell = table.rows[0]?.cells.at(-1);
  if (!cell) return [];
  const from = table.rows[0]?.cells.length === 1 ? carriersFrom(text, table.from) : cell.from;
  return parsed.marks.filter(
    (mark) =>
      mark.id !== id &&
      mark.kind !== 'cmt' &&
      mark.kind !== 'hl' &&
      mark.segments.some((segment) =>
        [openerRange(segment), segment.close].some(
          (range) => range !== undefined && from <= range.from && range.to <= cell.to,
        ),
      ),
  );
}

/** Whether the text of a header slice reads as it does in its file whatever stands below it: nothing in it
 * can go on past its last line, in the newest view or in the original one (a deletion's text is in the
 * original view alone, and a backtick it brings back could be paired with one of the rows). A code span, a
 * link or a comment that is begun and not finished in it could be finished by a row of the table, which
 * the file has and the slice does not. */
function closedSlice(slice: string): boolean {
  return [newestView(slice), originalView(slice)].every((view) => !/[`[]|<!--|-->/.test(view.text));
}

/**
 * The header of the table that starts at `tableFrom`, as a small file of its own: the lines of its paragraph
 * above it (none when a blank line is), the lines above that hold only markers, the header and its
 * delimiter row, and a ledger with the entries of the marks in them. A decision of a change in the header's
 * last cell reads and writes those lines and the ledger, and `placeHolds` walks the orders of decisions in
 * this, where a decision of a whole file costs what the file costs: parsing it, and reading its views, for
 * each of the decisions of every order.
 *
 * It is the header as the whole file reads it, or it is nothing: undefined where a mark stands partly in
 * the lines and partly outside them, where a code span, a link or a comment is left open in them (what the
 * rows below hold could finish it), and where the slice reads any differently than the file does, in its
 * marks and in its table.
 */
export function headerSlice(text: string, tableFrom: number): string | undefined {
  const parsed = parse(text);
  const table = tablesOfText(text, parsed).find((candidate) => candidate.from === tableFrom);
  const header = table?.rows[0];
  if (!table || !header) return undefined;
  const hidden = markerRanges(parsed);
  const to = lineEnd(text, table.delimiter.to);
  const first = lineStart(text, table.from);
  // The lines of the header's paragraph above it: none when a blank line is. The line above the paragraph
  // says nothing of a header, whose line is no underline.
  let start = first;
  if (first > 0) {
    const end = text[first - 2] === '\r' ? first - 2 : first - 1;
    if (!/^[ \t>]*$/.test(visible(text, hidden, lineStart(text, end), end).text)) {
      start = paragraphRange(text.slice(0, to), hidden, table.from).from;
    }
  }
  const from = Math.min(start, carriersFrom(text, table.from));
  const ids = new Set<string>();
  for (const mark of parsed.marks) {
    let inside = 0;
    let outside = 0;
    for (const segment of mark.segments) {
      const lo = segment.open.from;
      const hi = (segment.close ?? segment.content).to;
      if (hi <= from || lo >= to) outside++;
      else if (from <= lo && hi <= to) inside++;
      else return undefined;
    }
    if (inside > 0 && outside > 0) return undefined;
    if (inside > 0) ids.add(mark.id);
  }
  const { ledger } = parsed;
  const kept = {
    ...ledger,
    marks: Object.fromEntries(Object.entries(ledger.marks).filter(([id]) => ids.has(id))),
    comments: ledger.comments.filter((thread) => ids.has(thread.id) || ids.has(thread.about ?? '')),
  };
  delete kept.extra;
  const eol = eolOf(text, parsed.ledgerRange);
  const slice = `${text.slice(from, to)}${eol}${eol}${serializeLedger(kept).replaceAll('\n', eol)}${eol}`;
  const read = parse(slice);
  const again = tablesOfText(slice, read).find((candidate) => candidate.from === table.from - from);
  const same =
    read.marks.length === ids.size &&
    read.marks.every((mark) => ids.has(mark.id)) &&
    again?.rows[0]?.cells.length === header.cells.length &&
    slice.slice(again.delimiter.from, again.delimiter.to) ===
      text.slice(table.delimiter.from, table.delimiter.to);
  return same && closedSlice(slice) ? slice : undefined;
}

/** A state of the walk that the header slice does not stand for: the walk is done on the whole file. */
class LeftSlice extends Error {}

/**
 * Throws unless the mark `id` of `after` is read where it stands in every state that deciding the
 * changes in its cell, one at a time in any order, leaves (`before` is the file without the mark and its
 * change of the delimiter row: the decisions are made in it too), and can be accepted and rejected in each.
 * Rejecting a deletion of the cell's last characters, or accepting a replacement of them, can leave a
 * backslash or a delimiter run right in front of the mark, which reads otherwise there than it does in the
 * two states `markPlace` looks at, with everything accepted or everything rejected; and deciding the
 * changes that are all the text of the cell of a header with no closing pipe can leave no table, where the
 * mark could only be accepted. A decision of another change that the file with the mark refuses and the file
 * without it allows is the mark's doing, and refuses it as well: no decision may be refused (format §3.9).
 *
 * The walk is done on the header slice of each file (`headerSlice`), where a decision costs what a header
 * does and not what a file does, and on the whole files where a slice is not what they read as. `whole`
 * walks the whole files, for a test. The decisions of `before` are made when they are looked at, which is
 * when the file with the mark refuses one.
 *
 * @returns where the walk was done: on the `header` slices, or on the whole `file` (a state of the walk
 * that a slice does not stand for sends it there).
 * @throws EditError when the mark would be read otherwise in some state, or a decision would be refused
 * for it or for the mark, or the cell holds more than `CELL_CHANGES` changes.
 */
export function placeHolds(
  before: string,
  after: string,
  id: string,
  tableFrom: number,
  whole = false,
): 'header' | 'file' {
  const slices = whole
    ? undefined
    : { before: headerSlice(before, tableFrom), after: headerSlice(after, tableFrom) };
  if (slices?.before !== undefined && slices.after !== undefined) {
    try {
      walkDecisions(slices.before, slices.after, id, true);
      return 'header';
    } catch (error) {
      if (!(error instanceof LeftSlice)) throw error;
    }
  }
  walkDecisions(before, after, id, false);
  return 'file';
}

/** The walk of `placeHolds` over `before` and `after`, which are slices when `sliced`. */
function walkDecisions(before: string, after: string, id: string, sliced: boolean): void {
  const seen = new Set<string>();
  const decided = (text: string | undefined, other: string, how: typeof accept) => {
    if (text === undefined) return undefined;
    try {
      return applyChanges(text, how(text, other));
    } catch (error) {
      if (error instanceof EditError) return null;
      throw error;
    }
  };
  /** The file without the mark in the state that `walk` is in, made when it is looked at. */
  const walk = (base: () => string | undefined, current: string): void => {
    if (seen.has(current)) return;
    seen.add(current);
    const parsed = parse(current);
    if (sliced && !closedSlice(current)) throw new LeftSlice();
    const open = parsed.marks.find((mark) => mark.id === id)?.segments[0]?.open;
    if (!open) return;
    const table = tablesOfText(current, parsed).find(
      (candidate) => candidate.from <= open.from && open.to <= candidate.to,
    );
    const cell = table?.rows[0]?.cells.at(-1);
    // Where the table is gone (the cell emptied of its text, and the header with it), the old row has no
    // table to be written back into, and the change could only be accepted.
    if (!table || !cell) throw refused(MARK_PLACE);
    if (!placeReads(current, parsed, cell.textFrom, open.from)) throw refused(MARK_PLACE);
    // Neither decision of the mark is refused in any state.
    for (const how of [accept, reject])
      if (decided(current, id, how) === null) throw refused(MARK_PLACE);
    const others = changesIn(current, parsed, table, id);
    if (seen.size === 1 && others.length > CELL_CHANGES) throw refused(TOO_MANY);
    for (const other of others) {
      for (const how of [accept, reject]) {
        const next = decided(current, other.id, how);
        // Allowed without the mark, refused with it: the mark makes the decision impossible.
        if (next === null && typeof decided(base(), other.id, how) === 'string') {
          throw refused(MARK_PLACE);
        }
        if (typeof next !== 'string') continue;
        let without: string | undefined | null = null;
        walk(() => {
          if (without === null) {
            const done = decided(base(), other.id, how);
            without = typeof done === 'string' ? done : undefined;
          }
          return without;
        }, next);
      }
    }
  };
  walk(() => before, after);
}

/**
 * Aligning columns of a table (format §3.7, rule 5). With `ctx` it is a format change by its author:
 * the delimiter row gets the new alignment, and one mark with no closer, at the end of the text of
 * the header's last cell, keeps the old row; the author's own pending change is changed in place, and
 * goes, with the old row written back as it was, when the old alignments are back. Without `ctx` the
 * delimiter row is changed as it says, and so is the old row of a change that is pending (the span
 * form that another tool wrote included), so that rejecting it keeps what was done.
 *
 * @throws EditError when another person's alignment change is pending, the columns are as asked, or a
 * marker can't stand at the end of the header's last cell.
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

  // The point form: one mark, no closer, and nothing written outside the table's first two lines.
  const at = markPlace(text, parsed, table);
  addPerson(ledger, ctx.author);
  const taken = idsIn(text);
  const id = newId(taken, ctx.random);
  const entry: MarkEntry = { by: ctx.author.handle, at: ctx.time };
  if (ctx.group !== undefined) entry.group = ctx.group;
  if (ctx.note !== undefined) entry.note = ctx.note;
  ledger.marks[id] = entry;
  const opener = `<!--fmt ${id} align=${encodeValue(delimiter)}-->`;
  const edit = done([...row, { from: at, to: at, insert: opener }], {
    parsed,
    created: [id],
    keeps: 'original',
    // A mark that is not read is no change: an unclosed `<!--` or a code span that the scan pairs across
    // the cells of the table takes it in (format §2.1).
    verify: (_after, written) => {
      if (!written.marks.some((mark) => mark.id === id)) throw refused(MARK_PLACE);
    },
  });
  placeHolds(text, applyChanges(text, edit.changes), id, table.from);
  return edit;
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

/**
 * Refuses a tracked edit on the lines between a table's last line and the next block's first character
 * while an alignment change of the table is pending that is the span form another tool wrote (format
 * §3.7, #281): its closer stands there, on a line of its own, and a mark of the edit would share the
 * line, which some order of decisions reads otherwise. An edit at the end of the last row is the cell's,
 * and is not refused. The point form has no closer, no gap and no refusal.
 *
 * @throws EditError naming the person whose change is pending.
 */
export function checkAlignGap(text: string, edits: readonly TextChange[], parsed: Parsed): void {
  const marks = parsed.marks.filter(isAlignMark);
  if (marks.length === 0) return;
  const end = parsed.ledgerRange?.from ?? text.length;
  for (const mark of marks) {
    // The point form has no closer on a line below its table, so it has no gap, and no table is read.
    // What is left is the span form of another tool.
    const segment = mark.segments[0];
    if (!segment?.close) continue;
    const table = tableOfSegment(parsed, segment);
    if (!table) continue;
    let gapEnd = segment.close.to;
    while (gapEnd < end && /\s/.test(text.charAt(gapEnd))) gapEnd++;
    for (const edit of edits) {
      const reaches = edit.from === edit.to ? edit.from > table.to : edit.to > table.to;
      if (!reaches || edit.from > gapEnd) continue;
      const name =
        parsed.ledger.people.find((p) => p.handle === mark.entry.by)?.name ?? mark.entry.by;
      throw refused(
        `${name}'s alignment change to the table above is pending. Decide it first, or turn off Track Changes.`,
      );
    }
  }
}
