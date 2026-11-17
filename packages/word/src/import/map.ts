// The import mapper: a `DocxModel` (what `readDocx` returns) as a Redlines file, with its marks,
// comment threads and ledger, and a report of what Markdown couldn't keep (import.md).
//
// Blocks are written one after the other. Word's revisions on paragraph marks become the format's
// block marks: an inserted mark is a `split` (or the start of an insertion that holds the break and
// the next paragraph), a deleted one is a join (format §3.4). A table that Word changed in its
// structure (rows, cells, properties) is a substitution of the whole table (format §3.12), the
// fallback import.md names.

import { applyChanges, parse, setLedger } from '@redlines/format';
import type { Ledger } from '@redlines/format';
import type { ImportReport } from '../shared/report.ts';
import { Ctx, payload } from './context.ts';
import { InlineWriter, guardLineStarts } from './inline.ts';
import type { View } from './inline.ts';
import type {
  Block,
  Comment,
  DocxModel,
  Inline,
  Paragraph,
  Revision,
  Run,
  Table,
} from './model.ts';

/** What the exporter's source part holds that the mapper needs (`readSourceXml` of the carriers). */
export interface RestoreSource {
  markdown: string;
  blocks: { id: string; type: string; from: number; to: number }[];
  /** The ledger of that Markdown: the people in it keep their handles. */
  ledger?: Ledger;
}

export interface ImportOptions {
  /**
   * The Markdown the .docx was made from. A block whose bookmark survived and that Word left
   * untouched is written as it was there, byte for byte (import.md, "Keeping the Markdown intact").
   */
  source?: RestoreSource;
}

export interface ImportResult {
  /** The Redlines file: body, then the ledger when there is something to keep in it. */
  markdown: string;
  report: ImportReport;
  /** The pictures the Markdown names, by the path it names them by (`media/image1.png`). */
  media: Record<string, Uint8Array>;
}

type Kind = 'para' | 'heading' | 'item' | 'quote' | 'code' | 'table' | 'raw';

interface Chunk {
  kind: Kind;
  /** `## `, `- `, `> `: what stands before the text on its first line. */
  prefix: string;
  /** What stands before the text of a following line of the block. */
  cont: string;
  body: string;
  /** The key of the list an item is in: items of one list are on adjacent lines. */
  list?: string;
  /** The paragraph mark was added / deleted. */
  markIns?: Revision;
  markDel?: Revision;
  /** Every run is one person's insertion / deletion, and this is the text without marks. */
  allIns?: Revision;
  allDel?: Revision;
  plain?: string;
  old?: string;
  insMove?: string;
  delMove?: string;
  /** The bookmark that wraps the block, from the exporter. */
  blockId?: string;
  /** A change of the block's type: the old type. */
  was?: { rev: Revision; type: string };
  /** A table written as a replacement: the old table, in the body the new one. */
  replaces?: { rev: Revision; old: string };
  /** Whether the chunk carries marks of its own. */
  marked: boolean;
  /** The body is the source's, word for word: no line is touched. */
  restored?: boolean;
}

const CODE_STYLES =
  /^(code|source code|html preformatted|preformatted text|macro text|plain text)$/i;
const QUOTE_STYLES = /quote/i;
const OPENER =
  /^<!--(?:ins|del|sub|fmt|hl|cmt) [bcdfghjkmnpqrstvwxz][bcdfghjkmnpqrstvwxz2-9]{3}(?: (?:(?!-->)[^\n])*)?-->/;
const MARKER = /<!--(?:(?!-->)[\s\S])*-->/g;

/** A fenced block whose fence is longer than any run of backticks that starts one of its lines. */
/** The text of a block with nothing at the start of a line that would make another block. */
function guarded(chunk: Chunk, text: string | undefined): string {
  const body = text ?? '';
  if (chunk.kind === 'heading') return body;
  return guardLineStarts(body.replace(/^[ \t]+/, '')).replace(/\n/g, `\n${chunk.cont}`);
}

function fenced(lines: string[]): string {
  const longest = Math.max(
    0,
    ...lines.flatMap((line) => (/^\s*(`+)/.exec(line)?.[1] ?? '').length),
  );
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${lines.join('\n')}\n${fence}`;
}

/** The ids of the comments that end somewhere in some blocks. */
function commentEnds(blocks: Block[]): Set<number> {
  const found = new Set<number>();
  const inlines = (list: Inline[]) => {
    for (const inline of list) {
      if (inline.type === 'commentEnd') found.add(inline.id);
      else if (inline.type === 'link') inlines(inline.children);
    }
  };
  for (const block of blocks) {
    if (block.type === 'paragraph') inlines(block.children);
    else {
      for (const row of block.rows)
        for (const cell of row.cells) {
          for (const id of commentEnds(cell.blocks)) found.add(id);
        }
    }
  }
  return found;
}

function keyOf(rev: Revision): string {
  return `${rev.author}|${rev.at}`;
}

function runsOf(inlines: Inline[]): Run[] {
  return inlines.flatMap((inline) =>
    inline.type === 'run' ? [inline] : inline.type === 'link' ? runsOf(inline.children) : [],
  );
}

function hasMarkers(inlines: Inline[]): boolean {
  return inlines.some(
    (inline) =>
      inline.type === 'commentStart' ||
      inline.type === 'commentEnd' ||
      inline.type === 'commentReference' ||
      (inline.type === 'link' && hasMarkers(inline.children)),
  );
}

function bookmarkOf(inlines: Inline[]): string | undefined {
  for (const inline of inlines) {
    if (inline.type === 'bookmarkStart') {
      const found = /^_rl_(.+)$/.exec(inline.name);
      if (found?.[1]) return found[1];
    }
    if (inline.type === 'link') {
      const inner = bookmarkOf(inline.children);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** Whether a paragraph or table holds a revision of any kind. */
function revised(inlines: Inline[]): boolean {
  return inlines.some((inline) => {
    if (inline.type === 'link') return revised(inline.children);
    if (inline.type === 'run')
      return !!(inline.inserted || inline.deleted || inline.moved || inline.formatChange);
    if (inline.type === 'image' || inline.type === 'note') {
      return !!(inline.inserted || inline.deleted || inline.moved);
    }
    return false;
  });
}

function latest(revisions: Revision[]): Revision {
  const sorted = revisions.toSorted((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return sorted[0] ?? { id: 0, author: '', date: '', at: '', utc: false };
}

/** Every revision under a table. */
function revisionsIn(blocks: Block[]): Revision[] {
  const found: Revision[] = [];
  const inlines = (list: Inline[]) => {
    for (const inline of list) {
      if (inline.type === 'link') inlines(inline.children);
      else if (inline.type === 'run') {
        for (const rev of [
          inline.inserted,
          inline.deleted,
          inline.moved?.revision,
          inline.formatChange?.revision,
        ]) {
          if (rev) found.push(rev);
        }
      } else if (inline.type === 'image' || inline.type === 'note') {
        for (const rev of [inline.inserted, inline.deleted, inline.moved?.revision])
          if (rev) found.push(rev);
      }
    }
  };
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      inlines(block.children);
      for (const rev of [
        block.mark.inserted,
        block.mark.deleted,
        block.mark.moved?.revision,
        block.propsChange?.revision,
      ]) {
        if (rev) found.push(rev);
      }
    } else {
      if (block.propsChange) found.push(block.propsChange);
      for (const row of block.rows) {
        for (const rev of [row.inserted, row.deleted]) if (rev) found.push(rev);
        for (const cell of row.cells) {
          for (const rev of [cell.inserted, cell.deleted, cell.merged]) if (rev) found.push(rev);
          found.push(...revisionsIn(cell.blocks));
        }
      }
    }
  }
  return found;
}

function structural(table: Table): boolean {
  return (
    !!table.propsChange ||
    table.rows.some(
      (row) =>
        row.inserted ||
        row.deleted ||
        row.cells.some((cell) => cell.inserted || cell.deleted || cell.merged),
    )
  );
}

/** An image in a block: `![alt](src "title")`. */
const IMAGE_LINK = /!\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

class Mapper {
  readonly ctx: Ctx;
  readonly writer: InlineWriter;
  readonly chunks: Chunk[] = [];
  private readonly counters = new Map<string, number>();
  private readonly widths: number[] = [];
  private lists = new Map<number, number>();
  private lastList = -1;

  readonly model: DocxModel;
  readonly options: ImportOptions;

  constructor(model: DocxModel, options: ImportOptions) {
    this.model = model;
    this.options = options;
    this.ctx = new Ctx(
      model,
      options.source?.ledger?.people ?? [],
      options.source?.ledger?.comments ?? [],
    );
    this.writer = new InlineWriter(this.ctx);
  }

  run(): ImportResult {
    this.blocks(this.model.blocks);
    this.restore();
    let body = this.assemble();
    body += this.notes();
    body = this.unanchored(body);
    body = body.replace(/\s+$/, '') + '\n';
    this.prune(body);
    this.restoreNotes(body);
    if (this.ctx.people.unkept() > 0) {
      this.ctx.note('people', "Word's account ids for the people in this file were not kept.");
    }
    const ledger = this.ctx.ledger((comment) => this.commentText(comment));
    body = this.withLedger(body, ledger);
    return { markdown: body, report: this.ctx.report(), media: this.ctx.media };
  }

  /** Marks that were drawn for text that another form then wrote have no mark in the file. */
  private prune(body: string): void {
    for (const id of Object.keys(this.ctx.marks)) {
      if (
        !body.includes(`<!--ins ${id}`) &&
        !body.includes(`<!--del ${id} `) &&
        !body.includes(`<!--sub ${id} `) &&
        !body.includes(`<!--fmt ${id} `) &&
        !body.includes(`<!--split ${id}`)
      ) {
        delete this.ctx.marks[id];
      }
    }
    for (const [id, entry] of Object.entries(this.ctx.marks)) {
      if (entry.move && !this.ctx.marks[entry.move]) delete entry.move;
      void id;
    }
  }

  /**
   * Word's revisions have no place for a change's note, so the source part's ledger keeps it
   * (#1081). A change that comes back with the author and time of a source change that had a note
   * gets it again, the n-th with the n-th, when the file and the source hold the same number of
   * changes by that author at that time. When they don't, nothing is guessed and the report says
   * how many notes were not restored.
   */
  private restoreNotes(body: string): void {
    const source = this.options.source;
    if (!source) return;
    const key = (m: { entry: { by: string; at: string } }) => `${m.entry.by} ${m.entry.at}`;
    const inOrder = (text: string, entries?: Record<string, { by: string; at: string }>) =>
      parse(text)
        .marks.map((m) => ({
          id: m.id,
          entry: { ...m.entry, ...entries?.[m.id] },
          from: m.segments[0]?.open.from ?? 0,
        }))
        .toSorted((a, b) => a.from - b.from);
    const before = new Map<string, ReturnType<typeof inOrder>>();
    for (const mark of inOrder(source.markdown)) {
      if (mark.entry.at === '' || mark.entry.by === 'unknown') continue;
      before.set(key(mark), [...(before.get(key(mark)) ?? []), mark]);
    }
    const now = new Map<string, ReturnType<typeof inOrder>>();
    for (const mark of inOrder(body, this.ctx.marks))
      now.set(key(mark), [...(now.get(key(mark)) ?? []), mark]);
    let lost = 0;
    for (const [k, was] of before) {
      const noted = was.filter((m) => m.entry.note !== undefined);
      if (noted.length === 0) continue;
      const found = now.get(k) ?? [];
      if (found.length !== was.length) {
        lost += noted.length;
        continue;
      }
      was.forEach((m, i) => {
        const entry = this.ctx.marks[found[i]?.id ?? ''];
        if (entry && m.entry.note !== undefined) entry.note = m.entry.note;
      });
    }
    if (lost > 0) {
      this.ctx.note(
        'note',
        lost === 1
          ? 'A change note could not be matched to its change, and was not kept.'
          : `${lost} change notes could not be matched to their changes, and were not kept.`,
      );
    }
  }

  private withLedger(body: string, ledger: Ledger): string {
    return applyChanges(body, setLedger(body, ledger));
  }

  private commentText(comment: Comment): string {
    const paragraphs = comment.blocks.flatMap((block) =>
      block.type === 'paragraph' ? [this.writer.render(block.children, 'newest')] : [],
    );
    return paragraphs.filter((text) => text !== '').join('\n\n');
  }

  // ---- blocks

  private blocks(blocks: Block[]): void {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block) continue;
      if (block.type === 'table') {
        this.table(block);
        continue;
      }
      const code = this.codeLines(blocks, i);
      if (code) {
        this.chunks.push({
          kind: 'raw',
          prefix: '',
          cont: '',
          body: fenced(code.lines),
          marked: false,
        });
        i = code.last;
        continue;
      }
      this.paragraph(block);
    }
  }

  /** A run of paragraphs that are code and carry nothing that a fenced block would hide. */
  private codeLines(blocks: Block[], start: number): { lines: string[]; last: number } | null {
    const lines: string[] = [];
    let i = start;
    for (; i < blocks.length; i++) {
      const block = blocks[i];
      if (block?.type !== 'paragraph' || !this.isCode(block) || block.list) break;
      if (
        revised(block.children) ||
        hasMarkers(block.children) ||
        block.mark.inserted ||
        block.mark.deleted
      ) {
        break;
      }
      lines.push(
        runsOf(block.children)
          .map((run) => run.text)
          .join('')
          .replace(/\r?\n/g, '\n'),
      );
    }
    return i > start && i === start + lines.length ? { lines, last: i - 1 } : null;
  }

  private isCode(p: Paragraph): boolean {
    if (p.styleName && CODE_STYLES.test(p.styleName)) return true;
    const runs = runsOf(p.children).filter((run) => run.text !== '');
    return runs.length > 0 && runs.every((run) => run.format.code);
  }

  private paragraph(p: Paragraph): void {
    const boxed = p.other.includes('pBdr') && p.other.includes('ind');
    for (const name of p.other) {
      if (boxed && (name === 'pBdr' || name === 'ind')) continue;
      this.ctx.note('formatting', `Formatting with no Markdown form was dropped: ${name}.`);
    }
    if (p.align && p.align !== 'left') {
      this.ctx.note('formatting', 'Formatting with no Markdown form was dropped: alignment.');
    }
    const runs = runsOf(p.children);
    const text =
      runs.some((run) => run.text !== '') ||
      p.children.some((c) => c.type === 'image' || c.type === 'note');
    const markIns =
      p.mark.inserted ?? (p.mark.moved?.direction === 'to' ? p.mark.moved.revision : undefined);
    const markDel =
      p.mark.deleted ?? (p.mark.moved?.direction === 'from' ? p.mark.moved.revision : undefined);
    if (!text && !markIns && !markDel && !hasMarkers(p.children)) return;

    const quote =
      !p.list && ((p.styleName !== undefined && QUOTE_STYLES.test(p.styleName)) || boxed);
    let kind: Kind = 'para';
    let prefix = '';
    let cont = '';
    let list: string | undefined;
    if (p.headingLevel && !p.list) {
      kind = 'heading';
      prefix = `${'#'.repeat(Math.min(6, p.headingLevel))} `;
    } else if (p.list) {
      kind = 'item';
      ({ prefix, cont, list } = this.item(p));
    } else if (quote) {
      kind = 'quote';
      prefix = '> ';
      cont = '> ';
    }

    // Threads open from an earlier block start again here, and end here when they don't go on.
    const carried = this.writer.openThreads();
    const opening = carried.map((thread) => `<!--cmt ${thread.id}-->`).join('');
    let body = this.writer.render(p.children, 'marked');
    const closing = this.writer
      .openThreads()
      .map((thread) => `<!--/${thread.id}-->`)
      .join('');
    body = opening + body + closing;
    body = body.replace(new RegExp(`<!--cmt (\\w{4})--><!--/\\1-->`, 'g'), '<!--cmt $1-->');
    for (let n = 0; n < 6 && /\\\n<!--/.test(body); n++) {
      body = body.replace(/\\\n((?:<!--(?:(?!-->)[\s\S])*-->)+)/g, '$1\\\n');
    }
    if (kind === 'heading') body = body.replaceAll('\\\n', ' ');

    const chunk: Chunk = {
      kind,
      prefix,
      cont,
      body,
      marked: MARKER.test(body) || /<!--/.test(body),
    };
    if (list !== undefined) chunk.list = list;
    if (markIns) chunk.markIns = markIns;
    if (markDel) chunk.markDel = markDel;
    const blockId = bookmarkOf(p.children);
    if (blockId) chunk.blockId = blockId;

    const live = runs.filter((run) => run.text !== '');
    const insOf = (run: Run) =>
      run.inserted ?? (run.moved?.direction === 'to' ? run.moved.revision : undefined);
    const delOf = (run: Run) =>
      run.deleted ?? (run.moved?.direction === 'from' ? run.moved.revision : undefined);
    const same = (get: (run: Run) => Revision | undefined) =>
      live.length > 0 &&
      live.length === runs.filter((run) => run.text !== '').length &&
      live.every((run) => {
        const rev = get(run);
        const first = get(live[0] as Run);
        return rev && first && keyOf(rev) === keyOf(first) && !(insOf(run) && delOf(run));
      }) &&
      p.children.every(
        (c) => c.type === 'run' || c.type === 'bookmarkStart' || c.type === 'bookmarkEnd',
      );
    if (same(insOf) && !hasMarkers(p.children)) {
      chunk.allIns = live[0] ? insOf(live[0]) : undefined;
      chunk.insMove = live[0]?.moved?.name ?? '';
      chunk.plain = this.writer.render(p.children, 'newest');
    }
    if (same(delOf) && !hasMarkers(p.children)) {
      chunk.allDel = live[0] ? delOf(live[0]) : undefined;
      chunk.delMove = live[0]?.moved?.name ?? '';
      chunk.old = this.writer.render(p.children, 'original');
    }

    if (p.propsChange) this.propsChange(p, chunk);
    this.chunks.push(chunk);
  }

  /** A change of the paragraph's properties: a block type change, when both types are Markdown's. */
  private propsChange(p: Paragraph, chunk: Chunk): void {
    const change = p.propsChange;
    if (!change) return;
    const typeOf = (props: { headingLevel?: number; list?: unknown }): string | null =>
      props.list ? null : props.headingLevel ? `h${Math.min(6, props.headingLevel)}` : 'p';
    const was = typeOf(change.old);
    const now = typeOf(p);
    if (was === null || now === null || chunk.kind === 'item' || chunk.kind === 'quote') {
      this.ctx.note(
        'revision',
        "A change of a paragraph's style or list was kept as its new form only.",
      );
      return;
    }
    if (was === now) return;
    chunk.was = { rev: change.revision, type: was };
  }

  private item(p: Paragraph): { prefix: string; cont: string; list: string } {
    const info = p.list;
    const level = info?.level ?? 0;
    const numId = info?.numId ?? 0;
    if (numId !== this.lastList) {
      this.lists.set(numId, this.lists.get(numId) ?? this.lists.size);
      this.lastList = numId;
      this.widths.length = 0;
    }
    for (const k of [...this.counters.keys()]) {
      const parts = k.split(':');
      if (parts[0] === String(numId) && Number(parts[1]) > level) this.counters.delete(k);
    }
    const indent = Array.from({ length: level }, (_, l) => this.widths[l] ?? 2).reduce(
      (a, b) => a + b,
      0,
    );
    let marker: string;
    if (info?.ordered) {
      const count = (this.counters.get(`${numId}:${level}`) ?? 0) + 1;
      this.counters.set(`${numId}:${level}`, count);
      marker = `${count}. `;
    } else {
      marker = (this.lists.get(numId) ?? 0) % 2 === 0 ? '- ' : '* ';
    }
    this.widths[level] = marker.length;
    this.widths.length = level + 1;
    return {
      prefix: `${' '.repeat(indent)}${marker}`,
      cont: ' '.repeat(indent + marker.length),
      list: `${numId}`,
    };
  }

  // ---- tables

  private table(table: Table): void {
    if (table.rows.length === 0) return;
    const merged = table.rows.some((row) => row.cells.some((cell) => cell.span > 1 || cell.vMerge));
    if (merged) {
      this.ctx.note('table', 'Merged table cells were split: Markdown tables have none.');
    }
    if (structural(table)) {
      const rev = latest(revisionsIn([table]));
      const newest = this.tableText(table, 'newest');
      const old = this.tableText(table, 'original');
      this.chunks.push({
        kind: 'table',
        prefix: '',
        cont: '',
        body: newest,
        replaces: { rev, old },
        marked: true,
      });
      return;
    }
    this.chunks.push({
      kind: 'table',
      prefix: '',
      cont: '',
      body: this.tableText(table, 'marked'),
      marked: false,
    });
  }

  private tableText(table: Table, view: View): string {
    const rows: string[][] = [];
    const width = Math.max(
      1,
      ...table.rows.map((row) => row.cells.reduce((n, cell) => n + Math.max(1, cell.span), 0)),
    );
    const carried = this.ctx.threads.filter((thread) => thread.open);
    for (const thread of carried) thread.open = false;
    for (const row of table.rows) {
      if (view === 'newest' && row.deleted) continue;
      if (view === 'original' && row.inserted) continue;
      const cells: string[] = [];
      for (const cell of row.cells) {
        if (view === 'newest' && cell.deleted) continue;
        if (view === 'original' && cell.inserted) continue;
        const texts = cell.blocks.flatMap((block) =>
          block.type === 'paragraph' ? [this.writer.render(block.children, view)] : [],
        );
        let text = texts.filter((t) => t !== '').join('<br>');
        const open = this.writer.openThreads();
        text += open.map((thread) => `<!--/${thread.id}-->`).join('');
        for (const thread of open) thread.open = false;
        text = text.replace(new RegExp('<!--cmt (\\w{4})--><!--/\\1-->', 'g'), '<!--cmt $1-->');
        if (
          rows.length === 0 &&
          (text.match(/\*\*/g) ?? []).length === 2 &&
          /^\*\*[^]*\*\*$/.test(text)
        ) {
          text = text.slice(2, -2);
        }
        text = text
          .replace(/\\\n/g, '<br>')
          .replace(/\n/g, ' ')
          .replace(/(?<!\\)\|/g, '\\|');
        cells.push(text);
        if (cell.vMerge === 'continue') cells[cells.length - 1] = '';
        for (let s = 1; s < cell.span; s++) cells.push('');
      }
      rows.push(cells);
    }
    const ending = commentEnds([table]);
    for (const thread of carried) thread.open = !ending.has(thread.root.id);
    if (rows.length === 0) return '';
    const header = rows[0] ?? [];
    const pad = (cells: string[]) => Array.from({ length: width }, (_, i) => cells[i] ?? '');
    const line = (cells: string[]) =>
      `| ${pad(cells)
        .map((c) => (c === '' ? ' ' : c))
        .join(' | ')} |`;
    const aligns = this.columnAligns(table, width);
    const lines = [line(header), `| ${aligns.join(' | ')} |`];
    for (const row of rows.slice(1)) lines.push(line(row));
    return lines.join('\n');
  }

  /**
   * The delimiter row's cells: a column's alignment is Word's cell justification where every cell
   * of the column agrees (#1080). Where they differ, or Word's justification has no Markdown form
   * (`both`), the column is left plain and the loss is reported.
   */
  private columnAligns(table: Table, width: number): string[] {
    const seen: Set<string>[] = Array.from({ length: width }, () => new Set<string>());
    for (const row of table.rows) {
      let col = 0;
      for (const cell of row.cells) {
        const first = cell.blocks.find((block) => block.type === 'paragraph');
        const align = first?.type === 'paragraph' ? (first.align ?? 'left') : 'left';
        if (cell.vMerge !== 'continue')
          seen[col]?.add(align === 'start' ? 'left' : align === 'end' ? 'right' : align);
        col += Math.max(1, cell.span);
      }
    }
    let lost = false;
    const out = seen.map((set) => {
      const values = [...set];
      if (values.length === 1 && values[0] === 'right') return '---:';
      if (values.length === 1 && values[0] === 'center') return ':---:';
      if (values.some((v) => v !== 'left')) lost = true;
      return '---';
    });
    if (lost) {
      this.ctx.note('formatting', 'Formatting with no Markdown form was dropped: alignment.');
    }
    return out;
  }

  // ---- the restore of untouched blocks

  private restore(): void {
    const source = this.options.source;
    if (!source) return;
    // Words and punctuation, without the escapes, the emphasis marks and the block's own marker.
    const norm = (s: string) =>
      s
        .replace(/\\(.)/g, '$1')
        .replace(/^\s*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?)/, '')
        .replace(/[*_~`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    for (const chunk of this.chunks) {
      if (!chunk.blockId || chunk.marked || chunk.markIns || chunk.markDel || chunk.was) continue;
      if (chunk.kind === 'table' || chunk.kind === 'raw') continue;
      const block = source.blocks.find((b) => b.id === chunk.blockId);
      if (!block) continue;
      const text = source.markdown.slice(block.from, block.to);
      const sameType = (block.type === 'heading') === (chunk.kind === 'heading');
      // A picture the export couldn't embed was written as its description (`[Image: alt]`), so a
      // block that holds one reads as that when it comes back, and is restored with its link.
      // Only when every picture of the block is one the file shows as a description, and the words
      // are otherwise the same: a block with no picture, or a description Word did not get from a
      // picture here, is not restored by this.
      const pictures = text.match(IMAGE_LINK)?.length ?? 0;
      const described = chunk.body.match(/\[Image: /g)?.length ?? 0;
      const asExported = text.replace(
        IMAGE_LINK,
        (_, alt: string, src: string) => `[Image: ${alt || src || 'no description'}]`,
      );
      const sameWords =
        norm(text) === norm(chunk.body) ||
        (pictures > 0 && pictures === described && norm(asExported) === norm(chunk.body));
      if (/<!--/.test(text) || !sameType || !sameWords) continue;
      const stripped = text.replace(/^\s*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?)/, '');
      chunk.restored = true;
      // The list marker or quote mark the paragraph stood after, as it was written.
      const lineStart = source.markdown.lastIndexOf('\n', block.from - 1) + 1;
      const before = source.markdown.slice(lineStart, block.from);
      if (
        (chunk.kind === 'item' || chunk.kind === 'quote') &&
        /^[ \t>]*(?:[-*+]|\d+[.)])?[ \t>]*$/.test(before) &&
        before !== ''
      ) {
        chunk.prefix = before;
      }
      chunk.body = chunk.kind === 'para' ? text : stripped;
    }
  }

  // ---- putting the blocks together

  private sep(prev: Chunk, cur: Chunk): string {
    if (prev.kind === 'item' && cur.kind === 'item') return prev.list === cur.list ? '\n' : '\n\n';
    if (prev.kind === 'quote' && cur.kind === 'quote') return '\n>\n';
    return '\n\n';
  }

  /** A block's lines, with the openers of marks that start it on lines of their own (format §3.3). */
  private lines(chunk: Chunk): string {
    const { prefix, cont, body, kind } = chunk;
    if (chunk.restored) return `${prefix}${body}`;
    const openers: string[] = [];
    let rest = body;
    for (let found = OPENER.exec(rest); found; found = OPENER.exec(rest)) {
      openers.push(found[0]);
      rest = rest.slice(found[0].length);
    }
    const text =
      kind === 'para' || kind === 'item' || kind === 'quote'
        ? guardLineStarts(rest.replace(/^[ \t]+/, ''))
        : rest;
    const joined = text.replace(/\n/g, `\n${cont}`);
    if (openers.length === 0 || kind === 'heading') {
      return `${prefix}${openers.join('')}${kind === 'heading' ? '' : ''}${kind === 'heading' ? joined : joined}`;
    }
    if (text === '') return `${prefix}${openers.join('')}`;
    if (kind === 'item') return `${prefix}${openers.join(`\n${cont}`)}\n${cont}${joined}`;
    if (kind === 'quote') return `${prefix}${openers.join(`\n${cont}`)}\n>\n${cont}${joined}`;
    return `${openers.join('\n')}\n\n${joined}`;
  }

  private assemble(): string {
    const chunks = this.chunks;
    let out = '';
    let prev: Chunk | undefined;
    let joining: Revision | null = null;
    let splitting: Revision | null = null;
    let ownLine = false;
    let del: { rev: Revision; parts: string[]; move: string } | null = null;
    let ins: { id: string } | null = null;

    const flushDel = () => {
      if (!del) return;
      const id = this.ctx.mark(del.rev);
      this.ctx.moveEnd(del.move, 'from', id);
      out += `<!--del ${id} ${payload(del.parts.join(''))}-->`;
      del = null;
    };

    for (let i = 0; i < chunks.length; i++) {
      const cur = chunks[i] as Chunk;
      const next = chunks[i + 1];
      const attachable = (c: Chunk | undefined) =>
        c !== undefined &&
        (c.kind === 'para' || c.kind === 'heading' || c.kind === 'item' || c.kind === 'quote');

      // A paragraph that is deleted whole, mark and text.
      if (cur.allDel && cur.markDel && !joining && !ins && !cur.was) {
        const sep = prev ? (ownLine ? '\n' : this.sep(prev, cur)) : '';
        if (prev && attachable(prev) && !splitting && !ownLine) {
          if (
            !del ||
            del.move !== (cur.delMove ?? '') ||
            this.ctx.people.handle(del.rev.author) !== this.ctx.people.handle(cur.allDel.author)
          ) {
            flushDel();
            del = { rev: cur.allDel, parts: [], move: cur.delMove ?? '' };
          }
          del.parts.push(`${sep}${cur.prefix}${guarded(cur, cur.old)}`);
        } else {
          flushDel();
          let lead = out === '' ? '' : sep;
          if (splitting) {
            lead = `<!--split ${this.ctx.mark(splitting)}-->${this.sep(prev as Chunk, cur)}`;
            splitting = null;
          }
          const id = this.ctx.mark(cur.allDel);
          this.ctx.moveEnd(cur.delMove, 'from', id);
          out += `${lead}<!--del ${id} ${payload(`${cur.prefix}${guarded(cur, cur.old)}\n\n`)}-->`;
          ownLine = true;
        }
        continue;
      }
      flushDel();

      const sep = prev ? (ownLine ? '\n\n' : this.sep(prev, cur)) : ownLine ? '\n\n' : '';
      ownLine = false;

      if (joining) {
        // The deleted mark of the paragraph before joins it to this one.
        const id = this.ctx.mark(joining);
        const join = prev ? this.sep(prev, cur) : '';
        out += `<!--del ${id} ${payload(`${join}${cur.prefix}`)}-->${cur.body.replace(/\n/g, `\n${cur.cont}`)}`;
      } else if (splitting) {
        if (cur.allIns && cur.plain !== undefined && this.same(splitting, cur.allIns)) {
          // The inserted break and this inserted paragraph are one insertion.
          if (!ins) {
            ins = { id: this.ctx.mark(splitting) };
            this.ctx.moveEnd(cur.insMove, 'to', ins.id);
            out += `<!--ins ${ins.id}-->`;
          }
          out += `${sep}${cur.prefix}${guarded(cur, cur.plain)}`;
          if (!(cur.markIns && next?.allIns && this.same(cur.markIns, next.allIns))) {
            out += `<!--/${ins.id}-->`;
            ins = null;
          }
        } else {
          const id = this.ctx.mark(splitting);
          out += `<!--split ${id}-->${sep}${this.block(cur)}`;
        }
      } else {
        out += sep + this.block(cur);
      }
      prev = cur;
      splitting = cur.markIns && next ? cur.markIns : null;
      joining = null;
      if (cur.markDel && next) {
        if (attachable(next) && attachable(cur)) joining = cur.markDel;
        else
          this.ctx.note(
            'revision',
            'A deleted paragraph break that joined unlike blocks was not kept.',
          );
      }
    }
    flushDel();
    if (ins) out += `<!--/${ins.id}-->`;
    return out;
  }

  private same(a: Revision, b: Revision): boolean {
    return this.ctx.people.handle(a.author) === this.ctx.people.handle(b.author);
  }

  /** A chunk as the lines it takes, with the marks of the block around it. */
  private block(chunk: Chunk): string {
    if (chunk.kind === 'raw') return chunk.body;
    if (chunk.replaces) {
      const id = this.ctx.mark(chunk.replaces.rev);
      return `<!--sub ${id} ${payload(chunk.replaces.old)}-->\n\n${chunk.body}\n<!--/${id}-->`;
    }
    if (chunk.kind === 'table') return chunk.body;
    if (chunk.was) {
      const id = this.ctx.mark(chunk.was.rev);
      const lines = this.lines(chunk);
      const op = `<!--fmt ${id} was=${chunk.was.type}-->`;
      return `${op}\n\n${lines}<!--/${id}-->`;
    }
    return this.lines(chunk);
  }

  // ---- notes and what has no place

  private notes(): string {
    if (this.ctx.notes.size === 0) return '';
    const model = this.model;
    let out = '';
    for (const found of this.ctx.notes.values()) {
      const note = (found.kind === 'footnote' ? model.footnotes : model.endnotes).find(
        (n) => n.id === found.id,
      );
      const paragraphs = (note?.blocks ?? []).flatMap((block) =>
        block.type === 'paragraph' ? [this.writer.render(block.children, 'newest').trim()] : [],
      );
      const text = paragraphs.filter((t) => t !== '').join('\n\n    ');
      out += `\n\n[^${found.label}]: ${text}`;
    }
    return out;
  }

  /** A comment that Word anchored nowhere is a point at the end of the text. */
  private unanchored(body: string): string {
    let extra = '';
    for (const state of this.ctx.threads) {
      if (state.id !== '') continue;
      extra += `<!--cmt ${this.ctx.threadId(state)}-->`;
    }
    if (extra === '') return body;
    const trimmed = body.replace(/\s+$/, '');
    const at = trimmed.search(/\n\n\[\^[^\]]+\]: /);
    if (at >= 0) return `${trimmed.slice(0, at)}${extra}${trimmed.slice(at)}`;
    return `${trimmed}${extra}`;
  }
}

/**
 * The Markdown of a Word file, with the Redlines marks and ledger for its tracked changes and
 * comments, and a report of what it couldn't keep.
 */
export function mapDocx(model: DocxModel, options: ImportOptions = {}): ImportResult {
  const result = new Mapper(model, options).run();
  return result;
}

/** Whether a file's marks read back without a warning: for the tests, and the app's check. */
export function warningsOf(markdown: string): string[] {
  return parse(markdown).warnings.map((warning) => warning.message);
}
