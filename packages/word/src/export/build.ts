// A Redlines file as a Word file: its text as paragraphs, its insertions, deletions and
// substitutions as `w:ins` and `w:del`, and its comment threads as Word comments with their
// replies (README, "Mapping rules for the exporter").
//
// The marks come from `parse` in @redlines/format, the blocks and their inline atoms from
// micromark (blocks.ts). An atom lies in a mark when its source offsets lie in the mark's content,
// since every marker is a token of its own and so ends an atom.

import { parse, plainPayload } from '@redlines/format';
import type { Ledger, MarkRange, Segment, Thread } from '@redlines/format';
import {
  AlignmentType,
  BookmarkEnd,
  BookmarkStart,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  ImageRun,
  HeadingLevel,
  InsertedTextRun,
  LevelFormat,
  Packer,
  ShadingType,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  commentIdToParaId,
} from 'docx';
import type { FileChild, ICommentOptions, ParagraphChild } from 'docx';
import { addCarriers, bookmarkName } from '../carriers/index.ts';
import type { CommentCarrier, SourceBlock } from '../carriers/index.ts';
import { wordDate } from '../shared/dates.ts';
import { durableId, WordIds } from '../shared/ids.ts';
import { authorsOf } from '../shared/people.ts';
import { partText, readParts, setPartText, writeParts } from '../shared/zip.ts';
import type { ReportEntry } from '../shared/report.ts';
import { markdownBlocks, PLAIN } from './blocks.ts';
import type { Atom, Block, Fmt, Leaf } from './blocks.ts';
import { alignsOf, blockWas, completeChanges, oldFormat, opsOf } from './changes.ts';
import { drawnSize, loadImage } from './images.ts';
import type { ImageSource, LoadedImage } from './images.ts';
import { movesOf, patchMoves } from './moves.ts';
import { openClean } from './open-clean.ts';
import type { MoveHalf, MoveRevision } from './moves.ts';

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
  /** Set when the insertion is the landing of a moved block. */
  move?: MoveHalf;
}

/** Something to put in a paragraph at a place in the source, and where it goes among the others
 * at that place: the end of a range, then deleted text, then the start of a range, then text. */
type Item =
  | { pos: number; order: number; type: 'end' | 'dend'; thread: Thread }
  | {
      pos: number;
      order: number;
      type: 'deleted';
      atoms: Atom[];
      by: string;
      at: string;
      move?: MoveHalf;
    }
  | { pos: number; order: number; type: 'start' | 'dstart'; thread: Thread }
  | { pos: number; order: number; type: 'point'; thread: Thread }
  | { pos: number; order: number; type: 'atom'; atom: Atom };

/** The id of the block at an index of the file's blocks: `b1`, `b2`, … The bookmark's name is
 * made from it, and the source part lists them. */
function blockId(index: number): string {
  return `b${index + 1}`;
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const CODE_FONT = 'Courier New';
/** The light gray behind code, in a block and in a run (#1179). */
const CODE_FILL = 'F2F2F2';
/** The space, in twips, that Word's own styles put between blocks (the document's `after`). */
const BLOCK_GAP = 120;
const INDENT = 720;
const BULLETS = 'redlines-bullets';
const NUMBERS = 'redlines-numbers';

/** A table mark (`row`, `col`) is no text change; those marks are for the tables of a later step. */
const TABLE_MARK = /^(?:row|col)(?:=|$)/;
const TABLE_DELETION = /^(row|col)=(\d+)(?: ([\s\S]*))?$/;

const ALIGNMENT = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const;

/** The text of a deletion's old text, as atoms that keep its emphasis. Spaces that Markdown would
 * trim off the ends are kept: they are words of the old text. */
function pieceAtoms(old: string): Atom[] {
  const lead = /^\s*/.exec(old)?.[0] ?? '';
  const trail = old.length > lead.length ? (/\s*$/.exec(old)?.[0] ?? '') : '';
  const middle = old.slice(lead.length, old.length - trail.length);
  const plain = (text: string): Atom => ({
    kind: 'text',
    text,
    from: 0,
    to: 0,
    exact: false,
    fmt: { ...PLAIN },
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

/** Block syntax alone, or nothing: what is left of a block when its text is not in the deletion. */
const PREFIX_ONLY = /^\s*(?:(?:#{1,6}|[-*+]|\d+[.)]|>)\s*)*$/;

/** The old text of a deletion as atoms. A gap of blank lines in it is a break between blocks, so
 * that a deletion across blocks, or of the break alone (a join), deletes paragraph marks. */
function deletedAtoms(old: string): Atom[] {
  const pieces = old.split(/\n[ \t]*\n\s*/);
  if (pieces.length === 1) return pieceAtoms(old);
  const atoms: Atom[] = [];
  pieces.forEach((piece, i) => {
    if (i > 0) atoms.push({ kind: 'break', from: 0, to: 0, para: true });
    if (!PREFIX_ONLY.test(piece)) atoms.push(...pieceAtoms(piece));
  });
  return atoms;
}

/** The newest text's tracked insertions: the content of every insertion and substitution. */
function insertions(marks: MarkRange[], moves: Map<string, MoveHalf>): Inserted[] {
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
          move: moves.get(mark.id),
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
              : atom.kind === 'image'
                ? new TextRun({ text: `[Image: ${atom.alt}]`, italics: true })
                : new TextRun(runOptions(atom.fmt, atom.text)),
          ),
        }),
      );
    }
  }
  return paragraphs.length > 0 ? paragraphs : [new Paragraph(markdown)];
}

function formatProps(fmt: Fmt) {
  return {
    bold: fmt.bold || undefined,
    italics: fmt.italic || undefined,
    strike: fmt.strike || undefined,
    font: fmt.code ? CODE_FONT : undefined,
    shading: fmt.code ? { type: ShadingType.CLEAR, fill: CODE_FILL, color: 'auto' } : undefined,
    subScript: fmt.sub || undefined,
    superScript: fmt.sup || undefined,
  };
}

/** Run options for a text; with `change`, the formatting the run had before (`w:rPrChange`). */
/** A cell's atoms without the padding at its ends: a marker at the start of a cell (a row's) leaves
 * the space after it in the text. */
function trimmedCell(atoms: Atom[]): Atom[] {
  const out = [...atoms];
  const first = out[0];
  if (first && first.kind === 'text' && first.exact) {
    const cut = first.text.length - first.text.trimStart().length;
    if (cut > 0) out[0] = { ...first, text: first.text.slice(cut), from: first.from + cut };
  }
  const last = out[out.length - 1];
  if (last && last.kind === 'text' && last.exact && out.length > 0) {
    const cut = last.text.length - last.text.trimEnd().length;
    if (cut > 0) {
      out[out.length - 1] = { ...last, text: last.text.slice(0, -cut), to: last.to - cut };
    }
  }
  return out.filter((atom) => atom.kind !== 'text' || atom.text !== '');
}

function runOptions(fmt: Fmt, text: string, change?: { old: Fmt; revision: Revision } | null) {
  return {
    text,
    ...formatProps(fmt),
    ...(change ? { revision: { ...change.revision, ...formatProps(change.old) } } : {}),
  };
}

/** The old properties of a paragraph that was another kind of block (`w:pPrChange`). */
function oldParagraph(was: { type: string; indent?: number }): Record<string, unknown> {
  const heading = /^h([1-6])$/.exec(was.type);
  if (heading) return { style: `Heading${heading[1]}` };
  if (was.type === 'ul' || was.type === 'task')
    return { numbering: { reference: BULLETS, level: 0 } };
  if (was.type === 'ol') return { numbering: { reference: NUMBERS, level: 0 } };
  if (was.type === 'quote') {
    return {
      indent: { left: INDENT },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } },
    };
  }
  if (was.type === 'indent') return { indent: { left: (was.indent ?? 0) * 360 + INDENT } };
  return {};
}

const BODY_FONT = 'Arial';
const TEXT_COLOR = '222222';

/** The styles of the file, written here so that Word and Docs don't fall back on their defaults:
 * a plain face for the text, headings in the text's color sized by level, a quote with a bar. */
function documentStyles() {
  const sizes = [32, 28, 26, 24, 22, 22]; // half-points
  const heading = (level: number) => ({
    run: { font: BODY_FONT, size: sizes[level - 1], bold: true, color: TEXT_COLOR },
    paragraph: { spacing: { before: level === 1 ? 360 : 280, after: 120 } },
  });
  return {
    default: {
      document: {
        run: { font: BODY_FONT, size: 22, color: TEXT_COLOR },
        paragraph: { spacing: { after: 120, line: 276 } },
      },
      heading1: heading(1),
      heading2: heading(2),
      heading3: heading(3),
      heading4: heading(4),
      heading5: heading(5),
      heading6: heading(6),
    },
    paragraphStyles: [
      {
        id: 'Quote',
        name: 'Quote',
        basedOn: 'Normal',
        quickFormat: true,
        run: { italics: true, color: '555555' },
        paragraph: {
          indent: { left: INDENT },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } },
        },
      },
    ],
  };
}

export interface ExportOptions {
  /** The program that wrote the file, for its properties. */
  creator?: string;
  /** Whether to write the carriers of a round trip: the source part, the block bookmarks, the
   * comments' durable ids and the revisions' UTC times. On unless `false`. */
  carriers?: boolean;
  /** The bytes of an image by its address. Images with a `data:` address need no help; any other
   * that this does not give is written as its description. */
  images?: ImageSource;
  /** Receives what the file can't hold of the Markdown, for the person who exports it. */
  report?: ReportEntry[];
}

/** A Redlines file as the bytes of a .docx. */
export async function exportDocx(text: string, options: ExportOptions = {}): Promise<Uint8Array> {
  const parsed = parse(text);
  const ledger: Ledger = parsed.ledger;
  const author = authorsOf(ledger);
  const ids = new WordIds();
  const report = options.report ?? [];
  const moves = movesOf(parsed.marks, text);
  const inserted = insertions(parsed.marks, moves);
  const blocks = markdownBlocks(text);

  // A half of a move is written as an insertion or a deletion, and its id is remembered, so that
  // the part can be patched into `w:moveTo` and `w:moveFrom` once `docx` has written it.
  const moveRevisions: MoveRevision[] = [];
  const rangeIds = new Map<string, number>();
  const track = (id: number, move: MoveHalf) => {
    const key = `${move.name}:${move.side}`;
    let rangeId = rangeIds.get(key);
    if (rangeId === undefined) {
      rangeId = ids.fresh();
      rangeIds.set(key, rangeId);
    }
    moveRevisions.push({ ...move, id, rangeId });
  };
  const revision = (by: string, at: string, move?: MoveHalf): Revision => {
    const id = ids.fresh();
    if (move) track(id, move);
    return { id, author: author(by).name, date: wordDate(at) };
  };
  /** The same revision with an id of its own, as every run and mark of a deletion needs. */
  const again = (rev: Revision, move?: MoveHalf): Revision => {
    const id = ids.fresh();
    if (move) track(id, move);
    return { ...rev, id };
  };

  // Images: their bytes are loaded first, since the runs are written in one go.
  const loaded = new Map<string, LoadedImage | string>();
  {
    const wanted = new Set<string>();
    const collect = (list: Block[]) => {
      for (const block of list) {
        const atoms =
          block.type === 'table'
            ? block.rows.flatMap((r) => r.cells.flatMap((c) => c.atoms))
            : block.atoms;
        for (const atom of atoms) if (atom.kind === 'image' && atom.src) wanted.add(atom.src);
      }
    };
    collect(blocks);
    for (const mark of parsed.marks) {
      if (mark.kind !== 'del' && mark.kind !== 'sub') continue;
      if (mark.kind === 'del' && TABLE_MARK.test(mark.payload ?? '')) continue;
      for (const segment of mark.segments)
        collect(markdownBlocks(plainPayload(segment.payload ?? mark.payload ?? '')));
    }
    for (const src of wanted) {
      const got = await loadImage(src, options.images);
      loaded.set(src, got);
      if (typeof got === 'string') {
        const shown = src.startsWith('data:') ? 'a data address' : src;
        report.push({
          kind: 'image',
          message: `An image is written as its description, since ${got} (${shown}).`,
        });
      }
    }
  }

  // Format changes: the operations of every `fmt` mark's segments.
  const fmtMarks = parsed.marks
    .filter((mark) => mark.kind === 'fmt')
    .map((mark) => ({
      mark,
      segments: mark.segments.map((segment) => ({ segment, ops: opsOf(mark, segment) })),
    }));
  const inlineChange = (atom: Atom) => {
    if (atom.kind !== 'text') return null;
    for (const { mark, segments } of fmtMarks) {
      for (const { segment, ops } of segments) {
        if (segment.content.from <= atom.from && atom.to <= segment.content.to) {
          const old = oldFormat(atom.fmt, ops);
          if (old) return { old, revision: revision(mark.entry.by, mark.entry.at) };
        }
      }
    }
    return null;
  };
  const blockChange = (leaf: Leaf) => {
    for (const { mark, segments } of fmtMarks) {
      for (const { segment, ops } of segments) {
        if (segment.content.from < leaf.to && segment.content.to > leaf.from) {
          const was = blockWas(ops.find((op) => op.name === 'was' && op.sign === '')?.value);
          if (was) return { mark, was };
        }
      }
    }
    return null;
  };
  // A task box checked or unchecked: a point at the end of the item's first line.
  const checks = fmtMarks.flatMap(({ mark, segments }) =>
    segments.flatMap(({ segment, ops }) => {
      const op = ops.find((o) => o.name === 'check' && o.sign !== '');
      return op ? [{ pos: segment.open.from, mark, checked: op.sign === '+' }] : [];
    }),
  );
  const checkFor = (atom: Extract<Atom, { kind: 'text' }>) =>
    checks.find((c) => c.pos >= atom.to && !text.slice(atom.to, c.pos).includes('\n'));

  // Splits: an inserted break, which is an inserted paragraph mark in Word.
  const splits = parsed.marks
    .filter((mark) => mark.kind === 'split')
    .map((mark) => ({
      from: (mark.segments[0] as Segment).open.from,
      by: mark.entry.by,
      at: mark.entry.at,
    }));

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
  const marksInserted = (
    leaf: Leaf,
    nextFrom: number,
  ): { by: string; at: string; move?: MoveHalf } | undefined => {
    const first = leaf.atoms[0];
    const last = leaf.atoms[leaf.atoms.length - 1];
    return (
      inserted.find(
        (found) =>
          (found.from <= leaf.to && found.to > leaf.to) ||
          (first && last && found.from <= first.from && found.to >= last.to),
      ) ?? splits.find((split) => split.from >= leaf.from && split.from < nextFrom)
    );
  };

  // Comments: a thread and each of its replies has its own id, range and reference mark.
  const spans = new Map<string, { from: number; to: number; point: boolean }>();
  for (const mark of parsed.marks) {
    if (mark.kind === 'cmt') spans.set(mark.id, spanOf(mark));
  }
  const markById = new Map(parsed.marks.map((mark) => [mark.id, mark]));
  const comments: ICommentOptions[] = [];
  const carried: CommentCarrier[] = [];
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
    carried.push({
      paraId: commentIdToParaId(root),
      resolved: Boolean(thread.resolved),
      durableId: durableId(thread.id),
      dateUtc: wordDate(thread.at),
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
      carried.push({
        paraId: commentIdToParaId(replyIds[i] as number),
        parentParaId: commentIdToParaId(root),
        resolved: Boolean(thread.resolved),
        durableId: durableId(thread.id, reply.id),
        dateUtc: wordDate(reply.at),
      });
    });
    let span = spans.get(thread.id);
    if (!span && thread.about) {
      const about = markById.get(thread.about);
      const old = about?.segments[0];
      if (
        about &&
        (about.kind === 'del' || about.kind === 'sub') &&
        old &&
        !TABLE_MARK.test(about.payload ?? '')
      ) {
        // A comment on deleted text: Word's range goes around the deleted runs.
        items.push({ pos: old.open.from, order: 1, type: 'dstart', thread });
        items.push({ pos: old.open.from, order: 1.5, type: 'dend', thread });
        continue;
      }
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
      const old = plainPayload(segment.payload ?? mark.payload ?? '');
      if (old === '') continue;
      items.push({
        pos: segment.open.from,
        order: 1,
        type: 'deleted',
        atoms: deletedAtoms(old),
        by: mark.entry.by,
        at: mark.entry.at,
        move: moves.get(mark.id),
      });
    }
  }

  // One run for an atom, tracked when an insertion holds it.
  const runOf = (
    atom: Atom,
    tracked: Revision | null,
    deleted: boolean,
    change?: { old: Fmt; revision: Revision } | null,
  ): ParagraphChild => {
    if (atom.kind === 'break') {
      const base = { break: 1 };
      if (deleted && tracked) return new DeletedTextRun({ ...base, ...tracked });
      return tracked ? new InsertedTextRun({ ...base, ...tracked }) : new TextRun(base);
    }
    if (atom.kind === 'image') {
      const got = atom.src ? loaded.get(atom.src) : undefined;
      if (got && typeof got !== 'string') {
        return new ImageRun({
          type: got.type,
          data: got.data,
          transformation: drawnSize(got),
          altText: { name: 'Image', description: atom.alt, title: atom.title ?? undefined },
          ...(deleted && tracked ? { deletion: tracked } : tracked ? { insertion: tracked } : {}),
        });
      }
      // No picture to draw: its description stands in, as Markdown shows it with no picture.
      const label = `[Image: ${atom.alt || atom.src || 'no description'}]`;
      const options = { text: label, italics: true };
      if (deleted && tracked) return new DeletedTextRun({ ...options, ...tracked });
      return tracked ? new InsertedTextRun({ ...options, ...tracked }) : new TextRun(options);
    }
    const options = runOptions(atom.fmt, atom.text, change);
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
        const check = !holder && atom.kind === 'text' && atom.task ? checkFor(atom) : undefined;
        if (check && atom.kind === 'text') {
          // A box checked or unchecked: Word has no such change, so the old box is deleted and
          // the new one inserted.
          flush();
          const rev = revision(check.mark.entry.by, check.mark.entry.at);
          const old = { ...atom, text: atom.text === '☒' ? '☐' : '☒' };
          children.push(runOf(old, rev, true), runOf(atom, again(rev), false));
          continue;
        }
        const run = runOf(
          atom,
          holder ? revision(holder.by, holder.at, holder.move) : null,
          false,
          holder ? null : inlineChange(atom),
        );
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
            paras.push({ children, deleted: again(tracked, item.move) });
            children = [];
          } else {
            children.push(runOf(atom, again(tracked, item.move), true));
          }
        }
      } else {
        const threadIds = wordIds.get(item.thread.id) ?? [];
        if (item.type === 'end' || item.type === 'dend' || item.type === 'point') {
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
      if (
        item.pos <= to ||
        ((item.type === 'end' || item.type === 'dend') && item.pos < nextFrom)
      ) {
        mine.push(item);
      } else rest.push(item);
    }
    pending = rest;
    return mine;
  };

  // The hidden bookmark that wraps a block, so that an import can tell which blocks Word left alone.
  const bookmark = (index: number) => {
    const id = ids.fresh();
    const name = bookmarkName(blockId(index));
    return {
      start: new BookmarkStart(name, id) as unknown as ParagraphChild,
      end: new BookmarkEnd(id) as unknown as ParagraphChild,
    };
  };

  const paragraphsFor = (leaf: Leaf, nextFrom: number, index: number): Paragraph[] => {
    const wrap = options.carriers === false ? null : bookmark(index);
    const own: Item[] = take(leaf.to, nextFrom);
    for (const atom of leaf.atoms) own.push({ pos: atom.from, order: 3, type: 'atom', atom });
    const mark = marksInserted(leaf, nextFrom);
    const paras = childrenOf(own, true);
    const shape: Record<string, unknown> = {};
    if (leaf.type === 'heading') shape.heading = HEADINGS[Math.min(5, leaf.level - 1)];
    if (leaf.type === 'rule') {
      shape.border = { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } };
    }
    if (leaf.type === 'code') {
      shape.shading = { fill: CODE_FILL };
    }
    // The lines of a code block touch, and the block, a quote and a table stand apart from what is
    // around them: a table has no space of its own, so the block after it takes it as `before`
    // (#1179).
    const before = blocks[index - 1]?.type === 'table' ? BLOCK_GAP : undefined;
    const next = blocks[index + 1];
    const joinsNext =
      leaf.type === 'code' && next?.type === 'code' && next.codeBlock === leaf.codeBlock;
    if (before !== undefined || leaf.type === 'code') {
      shape.spacing = { before, after: joinsNext ? 0 : BLOCK_GAP };
    }
    // A task item shows its box, not a bullet.
    const task = leaf.atoms.some((atom) => atom.kind === 'text' && atom.task);
    let left = leaf.quote * INDENT;
    if (leaf.list) {
      if (leaf.list.first && !task) {
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
      shape.style = 'Quote';
      shape.border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } };
    }
    if (left > 0 && !shape.numbering) shape.indent = { left };
    // A block that was another kind: Word's paragraph property change holds the old kind.
    const changed = blockChange(leaf);
    if (changed) {
      shape.revision = {
        ...revision(changed.mark.entry.by, changed.mark.entry.at),
        ...oldParagraph(changed.was),
      };
    }
    return paras.map((para, i) => {
      const last = i === paras.length - 1;
      const run = para.deleted
        ? { deletion: para.deleted }
        : last && mark
          ? { insertion: revision(mark.by, mark.at, 'move' in mark ? mark.move : undefined) }
          : undefined;
      const children =
        wrap && (i === 0 || last)
          ? [...(i === 0 ? [wrap.start] : []), ...para.children, ...(last ? [wrap.end] : [])]
          : para.children;
      return new Paragraph({ children, run, ...(i === 0 ? shape : {}) });
    });
  };

  // Deleted text that stands alone between two blocks is a deleted paragraph, with its mark.
  const deletedParagraphs = (before: number): Paragraph[] => {
    const alone = pending.filter((item) => item.type === 'deleted' && item.pos < before);
    // A comment on that text: its range goes around the deleted paragraphs.
    const aboutAlone = pending.filter(
      (item) =>
        (item.type === 'dstart' || item.type === 'dend') &&
        alone.some((found) => found.pos === item.pos),
    );
    pending = pending.filter((item) => !alone.includes(item) && !aboutAlone.includes(item));
    return alone.flatMap((item) => {
      if (item.type !== 'deleted') return [];
      const tail = item.atoms[item.atoms.length - 1];
      const ended = tail?.kind === 'break' && tail.para;
      const atoms: Atom[] = ended
        ? item.atoms
        : [...item.atoms, { kind: 'break', from: 0, to: 0, para: true }];
      const paras = childrenOf([{ ...item, atoms }], true).filter((para) => para.deleted);
      const mine = aboutAlone.filter((found) => found.pos === item.pos);
      const first = paras[0];
      const last = paras[paras.length - 1];
      for (const found of mine) {
        if (!('thread' in found) || !first || !last) continue;
        const threadIds = wordIds.get(found.thread.id) ?? [];
        if (found.type === 'dstart') {
          first.children.unshift(...threadIds.map((id) => new CommentRangeStart(id)));
        } else {
          last.children.push(
            ...threadIds.map((id) => new CommentRangeEnd(id)),
            ...referencesOf(found.thread),
          );
        }
      }
      return paras.map(
        (para) => new Paragraph({ children: para.children, run: { deletion: para.deleted! } }),
      );
    });
  };

  // What a table's marks say, read before its cells are written.
  type TableBlock = Extract<Block, { type: 'table' }>;
  interface TableDeletion {
    axis: 'row' | 'col';
    position: number;
    text: string;
    mark: MarkRange;
  }
  interface TableFacts {
    aligns: ('' | 'left' | 'center' | 'right')[];
    /** The old alignment of each column, when an alignment change is pending. */
    oldAligns: ('' | 'left' | 'center' | 'right')[] | null;
    alignMark: MarkRange | null;
    /** The mark of each inserted row, by row. */
    rowIns: (MarkRange | null)[];
    deletions: TableDeletion[];
  }
  const tableBlocks = blocks.filter((block): block is TableBlock => block.type === 'table');
  const facts = new Map<TableBlock, TableFacts>();
  const tableDeletionMarks = new Set<MarkRange>();
  const lineStart = (at: number) => text.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = (at: number) => {
    const end = text.indexOf('\n', at);
    return end === -1 ? text.length : end;
  };
  for (const table of tableBlocks) {
    const first = table.rows[0];
    const delimiterLine = text.slice(table.from, table.to).split('\n')[1] ?? '';
    const aligns = alignsOf(delimiterLine);
    let oldAligns: TableFacts['oldAligns'] = null;
    let alignMark: MarkRange | null = null;
    for (const { mark, segments } of fmtMarks) {
      const open = (mark.segments[0] as Segment).open.from;
      if (open < table.from || open > table.to) continue;
      for (const { ops } of segments) {
        const op = ops.find((o) => o.name === 'align');
        if (op?.value !== undefined) {
          oldAligns = alignsOf(op.value);
          alignMark = mark;
        }
      }
    }
    const rowIns = table.rows.map((row) => {
      const a = row.cells[0];
      const z = row.cells[row.cells.length - 1];
      if (!a || !z) return null;
      const from = lineStart(a.from);
      const to = lineEnd(z.to);
      const mark = parsed.marks.find((m) => {
        const open = (m.segments[0] as Segment).open.from;
        return m.kind === 'ins' && m.payload === 'row' && open >= from && open <= to;
      });
      if (mark) inserted.push({ from, to, by: mark.entry.by, at: mark.entry.at });
      return mark ?? null;
    });
    // Inserted columns: Word can't track a new column, so the cells' text is tracked instead.
    for (const mark of parsed.marks) {
      if (mark.kind !== 'ins' || mark.payload !== 'col' || !first) continue;
      const open = (mark.segments[0] as Segment).open.from;
      const head = first.cells[0];
      if (!head || open < lineStart(head.from) || open > lineEnd(head.to)) continue;
      const before = text.slice(lineStart(open), open).replace(/\\\|/g, '');
      const pipes = [...before].filter((c) => c === '|').length;
      const col = text.slice(lineStart(open)).trimStart().startsWith('|') ? pipes - 1 : pipes;
      for (const row of table.rows) {
        const cell = row.cells[col];
        if (cell) {
          inserted.push({ from: cell.from, to: cell.to, by: mark.entry.by, at: mark.entry.at });
        }
      }
      report.push({
        kind: 'column',
        message:
          'Word cannot track an inserted column: its cells are shown as inserted text, and rejecting them leaves the empty column.',
      });
    }
    facts.set(table, { aligns, oldAligns, alignMark, rowIns, deletions: [] });
  }
  // A deleted row or column is kept in a deletion below its table, after a blank line.
  for (const mark of parsed.marks) {
    if (mark.kind !== 'del') continue;
    const found = TABLE_DELETION.exec(mark.payload ?? '');
    if (!found) continue;
    const open = (mark.segments[0] as Segment).open.from;
    const table = [...tableBlocks].reverse().find((block) => block.to <= open);
    if (!table) continue;
    tableDeletionMarks.add(mark);
    facts.get(table)?.deletions.push({
      axis: found[1] as 'row' | 'col',
      position: Number(found[2]),
      text: found[3] ?? '',
      mark,
    });
  }
  // The paragraph that holds only such marks is no text.
  const isDeletionHolder = (block: Block) => {
    if (block.type !== 'paragraph' || block.atoms.length > 0) return false;
    const inside = parsed.marks.filter((mark) => {
      const open = (mark.segments[0] as Segment).open.from;
      return open >= block.from && open <= block.to;
    });
    return inside.length > 0 && inside.every((mark) => tableDeletionMarks.has(mark));
  };

  /** The cells of a row as written in a deletion: `| a | b |`. */
  const cellsOfRow = (row: string): string[] => {
    const cells: string[] = [];
    let current = '';
    for (let i = 0; i < row.length; i++) {
      const c = row[i] as string;
      if (c === '\\' && row[i + 1] === '|') {
        current += '|';
        i++;
      } else if (c === '|') {
        cells.push(current);
        current = '';
      } else current += c;
    }
    cells.push(current);
    const trimmed = row.trim();
    if (trimmed.startsWith('|')) cells.shift();
    if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) cells.pop();
    return cells.map((cell) => cell.trim());
  };

  const deletedCell = (cellText: string, by: string, at: string): TableCell => {
    const rev = revision(by, at);
    const atoms = cellText === '' ? [] : deletedAtoms(cellText);
    return new TableCell({
      children: [new Paragraph({ children: atoms.map((atom) => runOf(atom, again(rev), true)) })],
    });
  };

  interface RowSpec {
    header: boolean;
    cells: TableCell[];
    insertion: Revision | undefined;
    deletion: Revision | undefined;
  }

  const tableFor = (block: TableBlock, nextFrom: number, index: number): Table => {
    const wrap = options.carriers === false ? null : bookmark(index);
    let started = false;
    const line = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
    const about = facts.get(block) as TableFacts;
    const live: RowSpec[] = block.rows.map((row, r) => {
      const last = r === block.rows.length - 1;
      const cells = row.cells.map((cell, c) => {
        const own: Item[] = take(cell.to, last && c === row.cells.length - 1 ? nextFrom : cell.to);
        const edge = trimmedCell(cell.atoms);
        for (const atom of edge) {
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
        const aligned = about.aligns[c] ?? '';
        const was = about.oldAligns?.[c] ?? '';
        const change =
          about.alignMark && was !== aligned
            ? {
                ...revision(about.alignMark.entry.by, about.alignMark.entry.at),
                ...(was ? { alignment: ALIGNMENT[was] } : {}),
              }
            : undefined;
        const first = !started;
        started = true;
        const end = last && c === row.cells.length - 1;
        return new TableCell({
          children: [
            new Paragraph({
              alignment: aligned ? ALIGNMENT[aligned] : undefined,
              revision: change,
              children: [
                ...(first && wrap ? [wrap.start] : []),
                ...childrenOf(own).flatMap((para) => para.children),
                ...(end && wrap ? [wrap.end] : []),
              ],
            }),
          ],
        });
      });
      const mark = about.rowIns[r];
      return {
        header: row.header,
        cells,
        insertion: mark ? revision(mark.entry.by, mark.entry.at) : undefined,
        deletion: undefined,
      };
    });
    // Deleted columns: Word tracks none, so each row gets a cell of deleted text, and the header's
    // has a comment that says so.
    let extra = 0;
    for (const found of about.deletions.filter((d) => d.axis === 'col')) {
      const old = found.text.split('\n');
      extra++;
      const who = author(found.mark.entry.by);
      // The old cells are the table with every pending change rejected: no inserted row has one.
      let seen = 0;
      live.forEach((row, r) => {
        const index = r === 0 ? 0 : about.rowIns[r] ? -1 : ++seen + 1;
        const cellText = (old[index] ?? '').trim();
        let cell = deletedCell(cellText, found.mark.entry.by, found.mark.entry.at);
        if (r === 0) {
          const id = ids.fresh();
          comments.push({
            id,
            author: who.name,
            initials: who.initials,
            date: new Date(wordDate(found.mark.entry.at)),
            children: [
              new Paragraph(
                'Redlines: this column was deleted. Word cannot track a deleted column, so its text is struck through here. Delete the column after accepting.',
              ),
            ],
            durableId: durableId(found.mark.id),
          });
          const rev = revision(found.mark.entry.by, found.mark.entry.at);
          const atoms = cellText === '' ? [] : deletedAtoms(cellText);
          cell = new TableCell({
            children: [
              new Paragraph({
                children: [
                  new CommentRangeStart(id),
                  ...atoms.map((atom) => runOf(atom, again(rev), true)),
                  new CommentRangeEnd(id),
                  new TextRun({ children: [new CommentReference(id)] }),
                ],
              }),
            ],
          });
        }
        row.cells.splice(Math.min(found.position - 1, row.cells.length), 0, cell);
      });
      report.push({
        kind: 'column',
        message:
          'Word cannot track a deleted column: its text is struck through and a comment says to delete it.',
      });
    }
    // Deleted rows go back where they stood (the header is row 0, the body counts from 1).
    const rows: RowSpec[] = [];
    const gone = about.deletions
      .filter((d) => d.axis === 'row')
      .sort((a, b) => a.position - b.position);
    const deletedRow = (d: TableDeletion): RowSpec => ({
      header: false,
      cells: cellsOfRow(d.text).map((cell) => deletedCell(cell, d.mark.entry.by, d.mark.entry.at)),
      insertion: undefined,
      deletion: revision(d.mark.entry.by, d.mark.entry.at),
    });
    live.forEach((row, i) => {
      for (const d of gone.filter((found) => found.position === i)) rows.push(deletedRow(d));
      rows.push(row);
    });
    for (const d of gone.filter((found) => found.position >= live.length)) rows.push(deletedRow(d));
    const cellCount = Math.max(
      1,
      block.rows.reduce((most, row) => Math.max(most, row.cells.length), 1) + extra,
    );
    return new Table({
      rows: rows
        .filter((row) => row.cells.length > 0)
        .map(
          (row) =>
            new TableRow({
              tableHeader: row.header || undefined,
              insertion: row.insertion,
              deletion: row.deletion,
              children: row.cells,
            }),
        ),
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

  const children: FileChild[] = [];
  blocks.forEach((block, i) => {
    const nextFrom = blocks[i + 1]?.from ?? Infinity;
    children.push(...deletedParagraphs(block.from));
    if (block.type === 'table') children.push(tableFor(block, nextFrom, i));
    else if (!isDeletionHolder(block)) children.push(...paragraphsFor(block, nextFrom, i));
  });
  if (children.length === 0)
    children.push(
      new Paragraph({
        children: childrenOf(take(Infinity, Infinity)).flatMap((para) => para.children),
      }),
    );
  else if (pending.length > 0 || children[children.length - 1] instanceof Table) {
    // Items past the last block (a marker after it) get a paragraph of their own; Word wants a
    // paragraph after a table in any case.
    children.push(
      new Paragraph({
        children: childrenOf(take(Infinity, Infinity)).flatMap((para) => para.children),
      }),
    );
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
    styles: documentStyles(),
    comments: { children: comments },
    numbering: {
      config: [
        { reference: BULLETS, levels: levels(LevelFormat.BULLET, () => '•') },
        { reference: NUMBERS, levels: levels(LevelFormat.DECIMAL, (level) => `%${level + 1}.`) },
      ],
    },
    sections: [{ children }],
  });
  const bytes = new Uint8Array(await Packer.toArrayBuffer(document));
  const parts = readParts(bytes);
  openClean(parts);
  const xml = partText(parts, 'word/document.xml');
  if (xml !== undefined) {
    const moved = moveRevisions.length > 0 ? patchMoves(xml, moveRevisions) : xml;
    const patched = completeChanges(moved);
    if (patched !== xml) {
      setPartText(parts, 'word/document.xml', patched);
    }
  }
  if (options.carriers === false) {
    // Word's revisions have no place for a change's note; the source part keeps it (#1081).
    const notes = Object.values(ledger.marks).filter((mark) => mark.note !== undefined).length;
    if (notes > 0) {
      report.push({
        kind: 'note',
        message:
          notes === 1
            ? 'One change note is not in the Word file.'
            : `${notes} change notes are not in the Word file.`,
      });
    }
    return writeParts(parts);
  }
  const sourceBlocks: SourceBlock[] = blocks.map((block, i) => ({
    id: blockId(i),
    type: block.type,
    from: block.from,
    to: block.to,
  }));
  addCarriers(parts, { markdown: text, ledger, blocks: sourceBlocks, comments: carried });
  return writeParts(parts);
}
