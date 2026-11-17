// The model that `readDocx` returns: a .docx as blocks and runs, with every revision and comment
// kept where Word put it. It is Word's document, read, and not yet Markdown: the mapper (the next
// lane) decides what becomes a mark, and the Google Docs differences (`src/google/`) are handled
// there or in what `readDocx` normalizes (see "Normalized here" in `read.ts`).
//
// Where revisions sit, as in the file:
//   - on runs: `inserted`, `deleted`, `moved` (a run can be inserted and deleted at once);
//   - on paragraph marks: `Paragraph.mark` (the mark is what joins this paragraph to the next);
//   - on rows and cells: `TableRow.inserted` / `deleted`, `TableCell.inserted` / `deleted`;
//   - on properties: `Run.formatChange`, `Paragraph.propsChange`, `Table.propsChange`.

import type { ReportEntry } from '../shared/report.ts';

/** A tracked change's stamp: who, and when. */
export interface Revision {
  /** `w:id`. Word renumbers these on every save: never keep one. */
  id: number;
  /** `w:author`, a display name only. `Document.people` may know more. */
  author: string;
  /** `w:date` as written: local time with a false `Z`, when Word for Mac wrote it. */
  date: string;
  /** `w16du:dateUtc`, when the file has it. */
  dateUtc?: string;
  /**
   * The best time, in the ledger's form (`2026-10-13T22:30Z`, minutes): `dateUtc` when there is
   * one, else `date`; empty when neither parses.
   */
  at: string;
  /** Whether `at` came from `dateUtc` (true), and so is certain, or from `w:date` (false). */
  utc: boolean;
}

/** What a run, image or note reference inside a revision is. */
export interface Tracked {
  /** Inside `w:ins`. */
  inserted?: Revision;
  /** Inside `w:del`. */
  deleted?: Revision;
  /**
   * Inside `w:moveFrom` (`direction: 'from'`, the text is gone from here) or `w:moveTo`. `name`
   * is the `w:name` of the move's range, which links the two ends.
   */
  moved?: { direction: 'from' | 'to'; revision: Revision; name?: string };
}

/** The character formatting that Markdown has a form for, and the names of what it hasn't. */
export interface RunFormat {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  underline: boolean;
  superscript: boolean;
  subscript: boolean;
  /** A monospace font, or a character style called code. */
  code: boolean;
  /** Properties with no Markdown form (`color`, `sz`, `rFonts`...), by element name. */
  other: string[];
}

/** A run of text with one formatting and one set of revisions. */
export interface Run extends Tracked {
  type: 'run';
  /** Tabs are `\t`, line breaks `\n`. Text of deleted runs (`w:delText`) is here too. */
  text: string;
  format: RunFormat;
  /** `w:rStyle`. */
  style?: string;
  /**
   * A formatting change on this run (`w:rPrChange`): the formatting it had before. Left out when
   * the change changes nothing that matters (Google Docs writes one on every suggestion).
   */
  formatChange?: { revision: Revision; old: RunFormat };
}

export interface ImageRun extends Tracked {
  type: 'image';
  /** The part's path in the zip, `word/media/image1.png`; empty when the file is linked. */
  path: string;
  alt: string;
  /** In EMU, 914400 to the inch; 0 when not given. */
  width: number;
  height: number;
}

export interface NoteReference extends Tracked {
  type: 'note';
  kind: 'footnote' | 'endnote';
  /** The `w:id` of the note in `Document.footnotes` / `endnotes`. */
  id: number;
}

/** A hyperlink; `href` is an address, `anchor` a bookmark in this document. */
export interface Link {
  type: 'link';
  href?: string;
  anchor?: string;
  children: Inline[];
}

/** The places a comment starts, ends and is referenced from, inside a paragraph. */
export interface CommentMarker {
  type: 'commentStart' | 'commentEnd' | 'commentReference';
  /** The `w:id` of the comment, in `Document.comments`. */
  id: number;
  /** For a reference mark: the revisions it sits in (a deleted mark deletes its comment). */
  inserted?: Revision;
  deleted?: Revision;
}

export interface BookmarkMarker {
  type: 'bookmarkStart' | 'bookmarkEnd';
  /** `w:name` for a start; the `w:id` links a start to its end. */
  name: string;
  id: number;
}

export type Inline = Run | ImageRun | NoteReference | Link | CommentMarker | BookmarkMarker;

/** The revisions on a paragraph mark. */
export type ParagraphMark = Tracked;

export interface ListInfo {
  numId: number;
  /** 0 is the outermost level. */
  level: number;
  /** `w:numFmt` of the level: `bullet`, `decimal`, `lowerLetter`... Empty when unknown. */
  format: string;
  /** Anything but a bullet or none. */
  ordered: boolean;
}

/** What a paragraph is, as far as Markdown has forms for it. */
export interface ParagraphProps {
  /** `w:pStyle`. */
  styleId?: string;
  /** The style's name (`heading 1`, `Quote`); empty when `styles.xml` doesn't have it. */
  styleName?: string;
  /** 1 to 9, from the style or an outline level. */
  headingLevel?: number;
  list?: ListInfo;
  /** `w:jc`: `left`, `center`, `right`, `both`. */
  align?: string;
  /** Properties with no Markdown form (`ind`, `spacing`, `shd`...), by element name. */
  other: string[];
}

export interface Paragraph extends ParagraphProps {
  type: 'paragraph';
  /** The paragraph mark's revisions. */
  mark: ParagraphMark;
  /** A change of the paragraph's properties (`w:pPrChange`), with what they were. */
  propsChange?: { revision: Revision; old: ParagraphProps };
  children: Inline[];
}

export interface TableCell {
  blocks: Block[];
  /** `w:gridSpan`, 1 when not merged across. */
  span: number;
  /** `w:vMerge`: `restart` starts a vertical merge, `continue` is inside one. */
  vMerge?: 'restart' | 'continue';
  /** `w:cellIns`: this cell was added with its column. */
  inserted?: Revision;
  /** `w:cellDel`. */
  deleted?: Revision;
  /** `w:cellMerge`. */
  merged?: Revision;
}

export interface TableRow {
  cells: TableCell[];
  /** `w:trPr/w:ins`: the row was added. */
  inserted?: Revision;
  /** `w:trPr/w:del`: the row was deleted. */
  deleted?: Revision;
  /** `w:tblHeader`. */
  header: boolean;
}

export interface Table {
  type: 'table';
  /** The column widths of `w:tblGrid`, in twentieths of a point. */
  grid: number[];
  rows: TableRow[];
  /** `w:tblPrChange` or `w:tblGridChange` (a column added or removed by hand). */
  propsChange?: Revision;
}

export type Block = Paragraph | Table;

/** The author and when of a comment, and its text. */
export interface Comment {
  /** `w:id`: what the markers in the body name. */
  id: number;
  author: string;
  initials: string;
  /** `w:date`, as written. */
  date: string;
  /** From `commentsExtensible.xml` (`w16cex:dateUtc`), the true time. */
  dateUtc?: string;
  /** In the ledger's form, best known (`dateUtc` first), as `Revision.at`. */
  at: string;
  utc: boolean;
  /** The comment's own paragraphs. */
  blocks: Block[];
  /** The text of the paragraphs, joined by blank lines, deleted text left out. */
  text: string;
  /** `w14:paraId` of the comment's last paragraph: what `commentsExtended.xml` points at. */
  paraId?: string;
  /** `w16cid:durableId`, which Word keeps across saves. */
  durableId?: string;
  /** The `w:id` of the comment this one replies to, when `commentsExtended.xml` says. */
  parentId?: number;
  /** `w15:done`. */
  done: boolean;
  /** What the body has for it: the range's two ends and the reference mark. */
  anchor: { start: boolean; end: boolean; reference: boolean };
}

/** A comment and its replies, in file order. Replies are flat: Word has no deeper threads. */
export interface CommentThread {
  root: Comment;
  replies: Comment[];
  /** The root's `done`. */
  resolved: boolean;
}

/** A person `people.xml` knows, with the account Word signed them in with. */
export interface Person {
  name: string;
  providerId?: string;
  userId?: string;
}

export interface Note {
  id: number;
  blocks: Block[];
}

export interface StyleInfo {
  id: string;
  name: string;
  basedOn?: string;
  type: string;
}

export interface DocxModel {
  blocks: Block[];
  comments: Comment[];
  threads: CommentThread[];
  people: Person[];
  footnotes: Note[];
  endnotes: Note[];
  /** `styles.xml` by id. */
  styles: Record<string, StyleInfo>;
  /** Whether Track Changes was on (`w:trackRevisions` in `settings.xml`). */
  trackRevisions: boolean;
  /** The images, by path in the zip (`word/media/...`). */
  media: Record<string, Uint8Array>;
  /**
   * The text of `customXml/redlines-source.xml`, when the file has one: the original Markdown and
   * ledger of an export. Not parsed here.
   */
  sourcePart?: string;
  /** What the reader couldn't keep: text boxes, equations, tables it can't read. */
  report: ReportEntry[];
}
