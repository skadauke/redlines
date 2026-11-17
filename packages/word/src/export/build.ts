// A Redlines file as a Word file: its text as paragraphs, its insertions, deletions and
// substitutions as `w:ins` and `w:del`, and its comment threads as Word comments with their
// replies (README, "Mapping rules for the exporter").
//
// The marks come from `parse` in @redlines/format, the blocks and their inline atoms from
// micromark (blocks.ts). An atom lies in a mark when its source offsets lie in the mark's content,
// since every marker is a token of its own and so ends an atom.

import { parse } from '@redlines/format';
import type { Ledger, MarkRange, Segment, Thread } from '@redlines/format';
import {
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  InsertedTextRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { FileChild, ICommentOptions, ParagraphChild } from 'docx';
import { wordDate } from '../shared/dates.ts';
import { durableId, WordIds } from '../shared/ids.ts';
import { authorsOf } from '../shared/people.ts';
import { markdownBlocks } from './blocks.ts';
import type { Atom, Block, Fmt, Leaf } from './blocks.ts';

/** The children of one paragraph, and the deletion of its mark when a deleted break ends it. */
interface Para {
  children: ParagraphChild[];
  deleted: Revision | null;
}

/** A change by someone, as `docx` wants it. */
interface Revision {
  id: number;
  author: string;
  date: string;
}

/** A stretch of text that a mark inserts. */
interface Inserted {
  from: number;
  to: number;
  by: string;
  at: string;
}

/** Something to put in a paragraph at a place in the source, and where it goes among the others
 * at that place: the end of a range, then deleted text, then the start of a range, then text. */
type Item =
  | { pos: number; order: 0; type: 'end'; thread: Thread }
  | { pos: number; order: 1; type: 'deleted'; atoms: Atom[]; by: string; at: string }
  | { pos: number; order: 2; type: 'start'; thread: Thread }
  | { pos: number; order: 2; type: 'point'; thread: Thread }
  | { pos: number; order: 3; type: 'atom'; atom: Atom };

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const CODE_FONT = 'Courier New';
const INDENT = 720;
const BULLETS = 'redlines-bullets';
const NUMBERS = 'redlines-numbers';

/** A table mark (`row`, `col`) is no text change; those marks are for the tables of a later step. */
const TABLE_MARK = /^(?:row|col)(?:=|$)/;

/** The text of a deletion's old text, as atoms that keep its emphasis. Spaces that Markdown would
 * trim off the ends are kept: they are words of the old text. */
function deletedAtoms(old: string): Atom[] {
  const lead = /^\s*/.exec(old)?.[0] ?? '';
  const trail = old.length > lead.length ? (/\s*$/.exec(old)?.[0] ?? '') : '';
  const middle = old.slice(lead.length, old.length - trail.length);
  const plain = (text: string): Atom => ({
    kind: 'text',
    text,
    from: 0,
    to: 0,
    exact: false,
    fmt: { bold: false, italic: false, strike: false, code: false },
    link: null,
  });
  const atoms: Atom[] = [];
  if (lead) atoms.push(plain(lead));
  let first = true;
  for (const block of middle === '' ? [] : markdownBlocks(middle)) {
    const rows = block.type === 'table' ? block.rows.flatMap((row) => row.cells) : [block];
    for (const part of rows) {
      if (!first) atoms.push({ kind: 'break', from: 0, to: 0, para: true });
      first = false;
      atoms.push(...part.atoms);
    }
  }
  if (first && middle !== '') atoms.push(plain(middle));
  if (trail) atoms.push(plain(trail));
  return atoms;
}

/** The newest text's tracked insertions: the content of every insertion and substitution. */
function insertions(marks: MarkRange[]): Inserted[] {
  const found: Inserted[] = [];
  for (const mark of marks) {
    if (mark.kind !== 'ins' && mark.kind !== 'sub') continue;
    if (TABLE_MARK.test(mark.payload ?? '') && mark.kind === 'ins') continue;
    for (const segment of mark.segments) {
      if (segment.content.to > segment.content.from) {
        found.push({
          from: segment.content.from,
          to: segment.content.to,
          by: mark.entry.by,
          at: mark.entry.at,
        });
      }
    }
  }
  return found;
}

/** The first and last offsets of a mark's segments' content, or its opener's point. */
function spanOf(mark: MarkRange): { from: number; to: number; point: boolean } {
  const first = mark.segments[0] as Segment;
  const last = mark.segments[mark.segments.length - 1] as Segment;
  const point = !last.close;
  return point
    ? { from: first.open.from, to: first.open.from, point }
    : { from: first.content.from, to: last.content.to, point };
}

/** Plain runs for a comment's Markdown text. */
function commentParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const block of markdownBlocks(markdown)) {
    const cells = block.type === 'table' ? block.rows.flatMap((row) => row.cells) : [block];
    for (const part of cells) {
      paragraphs.push(
        new Paragraph({
          children: part.atoms.map((atom) =>
            atom.kind === 'break'
              ? new TextRun({ break: 1 })
              : new TextRun(runOptions(atom.fmt, atom.text)),
          ),
        }),
      );
    }
  }
  return paragraphs.length > 0 ? paragraphs : [new Paragraph(markdown)];
}

function runOptions(fmt: Fmt, text: string) {
  return {
    text,
    bold: fmt.bold || undefined,
    italics: fmt.italic || undefined,
    strike: fmt.strike || undefined,
    font: fmt.code ? CODE_FONT : undefined,
  };
}

export interface ExportOptions {
  /** The program that wrote the file, for its properties. */
  creator?: string;
}

/** A Redlines file as the bytes of a .docx. */
export async function exportDocx(text: string, options: ExportOptions = {}): Promise<Uint8Array> {
  const parsed = parse(text);
  const ledger: Ledger = parsed.ledger;
  const author = authorsOf(ledger);
  const ids = new WordIds();
  const inserted = insertions(parsed.marks);

  const revision = (by: string, at: string): Revision => ({
    id: ids.fresh(),
    author: author(by).name,
    date: wordDate(at),
  });

  // The innermost insertion that holds a source range.
  const insertionOf = (from: number, to: number): Inserted | undefined => {
    let best: Inserted | undefined;
    for (const found of inserted) {
      if (found.from <= from && to <= found.to) {
        if (!best || found.to - found.from < best.to - best.from) best = found;
      }
    }
    return best;
  };
  // Whether an insertion goes on past the end of a block, so that its paragraph mark is inserted.
  // Or when it holds the whole paragraph, which then goes with its mark when it is rejected.
  const marksInserted = (leaf: Leaf): Inserted | undefined => {
    const first = leaf.atoms[0];
    const last = leaf.atoms[leaf.atoms.length - 1];
    return inserted.find(
      (found) =>
        (found.from <= leaf.to && found.to > leaf.to) ||
        (first && last && found.from <= first.from && found.to >= last.to),
    );
  };

  // Comments: a thread and each of its replies has its own id, range and reference mark.
  const spans = new Map<string, { from: number; to: number; point: boolean }>();
  for (const mark of parsed.marks) {
    if (mark.kind === 'cmt') spans.set(mark.id, spanOf(mark));
  }
  const markById = new Map(parsed.marks.map((mark) => [mark.id, mark]));
  const comments: ICommentOptions[] = [];
  const wordIds = new Map<string, number[]>();
  const items: Item[] = [];
  for (const thread of ledger.comments) {
    const root = ids.fresh();
    const replyIds = thread.replies.map(() => ids.fresh());
    wordIds.set(thread.id, [root, ...replyIds]);
    const who = author(thread.by);
    comments.push({
      id: root,
      author: who.name,
      initials: who.initials,
      date: new Date(wordDate(thread.at)),
      children: commentParagraphs(thread.text),
      resolved: thread.resolved ? true : undefined,
      durableId: durableId(thread.id),
    });
    thread.replies.forEach((reply, i) => {
      const replier = author(reply.by);
      comments.push({
        id: replyIds[i] as number,
        author: replier.name,
        initials: replier.initials,
        date: new Date(wordDate(reply.at)),
        children: commentParagraphs(reply.text),
        parentId: root,
        durableId: durableId(thread.id, reply.id),
      });
    });
    let span = spans.get(thread.id);
    if (!span && thread.about) {
      const about = markById.get(thread.about);
      if (about) span = spanOf(about);
    }
    span ??= { from: 0, to: 0, point: true };
    if (span.point || span.from === span.to) {
      items.push({ pos: span.from, order: 2, type: 'point', thread });
    } else {
      items.push({ pos: span.from, order: 2, type: 'start', thread });
      items.push({ pos: span.to, order: 0, type: 'end', thread });
    }
  }

  // Deleted text, at the place of its marker.
  for (const mark of parsed.marks) {
    if (mark.kind !== 'del' && mark.kind !== 'sub') continue;
    if (mark.kind === 'del' && TABLE_MARK.test(mark.payload ?? '')) continue;
    for (const segment of mark.segments) {
      const old = segment.payload ?? mark.payload ?? '';
      if (old === '') continue;
      items.push({
        pos: segment.open.from,
        order: 1,
        type: 'deleted',
        atoms: deletedAtoms(old),
        by: mark.entry.by,
        at: mark.entry.at,
      });
    }
  }

  // One run for an atom, tracked when an insertion holds it.
  const runOf = (atom: Atom, tracked: Revision | null, deleted: boolean): ParagraphChild => {
    if (atom.kind === 'break') {
      const base = { break: 1 };
      if (deleted && tracked) return new DeletedTextRun({ ...base, ...tracked });
      return tracked ? new InsertedTextRun({ ...base, ...tracked }) : new TextRun(base);
    }
    const options = runOptions(atom.fmt, atom.text);
    if (atom.link) Object.assign(options, { style: 'Hyperlink' });
    if (deleted && tracked) return new DeletedTextRun({ ...options, ...tracked });
    return tracked ? new InsertedTextRun({ ...options, ...tracked }) : new TextRun(options);
  };

  const referencesOf = (thread: Thread): ParagraphChild[] =>
    (wordIds.get(thread.id) ?? []).map(
      (id) => new TextRun({ children: [new CommentReference(id)] }),
    );

  // The children of a paragraph: its items in order.
  const childrenOf = (own: Item[], split = false): Para[] => {
    let children: ParagraphChild[] = [];
    const paras: Para[] = [];
    let group: { link: string; runs: ParagraphChild[] } | null = null;
    const flush = () => {
      if (group) {
        children.push(new ExternalHyperlink({ link: group.link, children: group.runs }));
      }
      group = null;
    };
    own.sort((a, b) => a.pos - b.pos || a.order - b.order);
    for (const item of own) {
      if (item.type === 'atom') {
        const atom = item.atom;
        const holder = insertionOf(atom.from, atom.to);
        const run = runOf(atom, holder ? revision(holder.by, holder.at) : null, false);
        const link = atom.kind === 'text' ? atom.link : null;
        if (link) {
          if (group && (group as { link: string }).link !== link) flush();
          group ??= { link, runs: [] };
          group.runs.push(run);
        } else {
          flush();
          children.push(run);
        }
        continue;
      }
      flush();
      if (item.type === 'deleted') {
        const tracked = revision(item.by, item.at);
        for (const atom of item.atoms) {
          if (split && atom.kind === 'break' && atom.para) {
            // A deleted break between blocks: the paragraph's mark is deleted, so that Word joins
            // the two paragraphs when the change is accepted.
            flush();
            paras.push({ children, deleted: { ...tracked, id: ids.fresh() } });
            children = [];
          } else {
            children.push(runOf(atom, { ...tracked, id: ids.fresh() }, true));
          }
        }
      } else {
        const threadIds = wordIds.get(item.thread.id) ?? [];
        if (item.type === 'end' || item.type === 'point') {
          if (item.type === 'point') {
            for (const id of threadIds) children.push(new CommentRangeStart(id));
          }
          for (const id of threadIds) children.push(new CommentRangeEnd(id));
          children.push(...referencesOf(item.thread));
        } else {
          for (const id of threadIds) children.push(new CommentRangeStart(id));
        }
      }
    }
    flush();
    paras.push({ children, deleted: null });
    return paras;
  };

  // Items go to the first paragraph that reaches them; the end of a range goes with the paragraph
  // it ends in, not the one after it.
  let pending = items;
  const take = (to: number, nextFrom: number): Item[] => {
    const mine: Item[] = [];
    const rest: Item[] = [];
    for (const item of pending) {
      if (item.pos <= to || (item.type === 'end' && item.pos < nextFrom)) mine.push(item);
      else rest.push(item);
    }
    pending = rest;
    return mine;
  };

  const paragraphsFor = (leaf: Leaf, nextFrom: number): Paragraph[] => {
    const own: Item[] = take(leaf.to, nextFrom);
    for (const atom of leaf.atoms) own.push({ pos: atom.from, order: 3, type: 'atom', atom });
    const mark = marksInserted(leaf);
    const paras = childrenOf(own, true);
    const shape: Record<string, unknown> = {};
    if (leaf.type === 'heading') shape.heading = HEADINGS[Math.min(5, leaf.level - 1)];
    if (leaf.type === 'rule') {
      shape.border = { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } };
    }
    if (leaf.type === 'code') {
      shape.shading = { fill: 'F2F2F2' };
      shape.spacing = { after: 0 };
    }
    let left = leaf.quote * INDENT;
    if (leaf.list) {
      if (leaf.list.first) {
        shape.numbering = {
          reference: leaf.list.ordered ? NUMBERS : BULLETS,
          level: Math.min(8, leaf.list.level),
          instance: leaf.list.instance,
        };
      } else {
        left += (leaf.list.level + 1) * INDENT;
      }
    }
    if (leaf.quote > 0) {
      shape.border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } };
    }
    if (left > 0 && !shape.numbering) shape.indent = { left };
    return paras.map((para, i) => {
      const last = i === paras.length - 1;
      const run = para.deleted
        ? { deletion: para.deleted }
        : last && mark
          ? { insertion: revision(mark.by, mark.at) }
          : undefined;
      return new Paragraph({ children: para.children, run, ...(i === 0 ? shape : {}) });
    });
  };

  // Deleted text that stands alone between two blocks is a deleted paragraph, with its mark.
  const deletedParagraphs = (before: number): Paragraph[] => {
    const alone = pending.filter((item) => item.type === 'deleted' && item.pos < before);
    pending = pending.filter((item) => !alone.includes(item));
    return alone.flatMap((item) => {
      if (item.type !== 'deleted') return [];
      const atoms: Atom[] = [...item.atoms, { kind: 'break', from: 0, to: 0, para: true }];
      return childrenOf([{ ...item, atoms }], true)
        .filter((para) => para.deleted)
        .map(
          (para) => new Paragraph({ children: para.children, run: { deletion: para.deleted! } }),
        );
    });
  };

  const tableFor = (block: Extract<Block, { type: 'table' }>, nextFrom: number): Table => {
    const line = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
    const cellCount = block.rows.reduce((most, row) => Math.max(most, row.cells.length), 1);
    const rows = block.rows.map((row, r) => {
      const last = r === block.rows.length - 1;
      return new TableRow({
        tableHeader: row.header || undefined,
        children: row.cells.map((cell, c) => {
          const own: Item[] = take(
            cell.to,
            last && c === row.cells.length - 1 ? nextFrom : cell.to,
          );
          for (const atom of cell.atoms) {
            own.push({
              pos: atom.from,
              order: 3,
              type: 'atom',
              atom:
                row.header && atom.kind === 'text'
                  ? { ...atom, fmt: { ...atom.fmt, bold: true } }
                  : atom,
            });
          }
          return new TableCell({
            children: [
              new Paragraph({ children: childrenOf(own).flatMap((para) => para.children) }),
            ],
          });
        }),
      });
    });
    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: Array.from({ length: cellCount }, () => Math.floor(9000 / cellCount)),
      borders: {
        top: line,
        bottom: line,
        left: line,
        right: line,
        insideHorizontal: line,
        insideVertical: line,
      },
    });
  };

  const blocks = markdownBlocks(text);
  const children: FileChild[] = [];
  blocks.forEach((block, i) => {
    const nextFrom = blocks[i + 1]?.from ?? Infinity;
    children.push(...deletedParagraphs(block.from));
    if (block.type === 'table') children.push(tableFor(block, nextFrom));
    else children.push(...paragraphsFor(block, nextFrom));
  });
  if (children.length === 0)
    children.push(
      new Paragraph({
        children: childrenOf(take(Infinity, Infinity)).flatMap((para) => para.children),
      }),
    );
  else if (pending.length > 0) {
    // Items past the last block (a marker after it): they end its last paragraph.
    const last = children[children.length - 1];
    if (!(last instanceof Table)) {
      children.push(
        new Paragraph({
          children: childrenOf(take(Infinity, Infinity)).flatMap((para) => para.children),
        }),
      );
    }
  }

  const levels = (
    format: (typeof LevelFormat)[keyof typeof LevelFormat],
    text: (n: number) => string,
  ) =>
    Array.from({ length: 9 }, (_, level) => ({
      level,
      format,
      text: text(level),
      alignment: 'left' as const,
      style: { paragraph: { indent: { left: INDENT * (level + 1), hanging: 360 } } },
    }));

  const document = new Document({
    creator: options.creator ?? 'Redlines',
    features: ledger.tracking === 'everyone' ? { trackRevisions: true } : undefined,
    compatibility: { version: 15 },
    comments: { children: comments },
    numbering: {
      config: [
        { reference: BULLETS, levels: levels(LevelFormat.BULLET, () => '•') },
        { reference: NUMBERS, levels: levels(LevelFormat.DECIMAL, (level) => `%${level + 1}.`) },
      ],
    },
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
