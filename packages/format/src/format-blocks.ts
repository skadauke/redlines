// Block format changes (format §2.6): the type of a block, the indentation of a list item, and the
// box of a task item.
//
// - A change of type is a mark that starts the block where §3.3 puts one: alone on the line before
//   a paragraph or a heading, after the bullet of a list item, after the `> ` of a quote. Its payload
//   is `was=TYPE`, with the old syntax after the type when the serializer writes it otherwise, so
//   that rejecting gives back the bytes. A heading's `#`s are inside the mark; a bullet, a box and a
//   `> ` are in front of it, and a quote's `> ` starts each of its lines.
// - An indent is a mark after the bullet that covers the item and the lines under it, `was=indent=N`.
// - A box is a point mark at the end of the item's first line, `+check` or `-check`.
// - A block that Markdown would read into the block next to it once changed is refused, not
//   repaired: one that changes into another kind of block stands on its own, between blank lines.
// - A block change of the author's own is changed in place, or goes when the block goes back.

import { CONTAINER_PREFIX, lineEnd, lineStart } from './blocks.ts';
import { EditError } from './errors.ts';
import { encodeValue, opsOf, readWas } from './format-ops.ts';
import type { BlockType, FormatOp, ParsedFormatOp } from './format-ops.ts';
import type { FormatReader } from './format-reader.ts';
import { DELIMITER_ROW, paragraphRange } from './inline.ts';
import type { MarkRange, Parsed, Range, Segment, TextChange } from './types.ts';

const refused = (reason: string) => new EditError(reason, 'no-legal-placement');

const NOT_A_TYPE =
  "This block can't change type: Markdown writes it in a way a change couldn't give back. Change it in Raw.";
const INSIDE =
  "A block inside a list or a quote can't change type. Change the list item or the quote it is in.";
const ON_ITS_OWN =
  'Only a block with a blank line before and after it can change into another kind of block: Markdown would read it into the block next to it.';
const ONE_LINE = 'A heading is one line. Join the lines of this paragraph first.';
const NEXT_ITEM =
  "This item can't change its list type: the numbered item after it would then be read as part of it.";
const UNDER_IT =
  "This item can't get a wider bullet: the lines under it would no longer be indented enough to be its own.";
const AT_START =
  'A pending change or a comment starts this block, and would have to move. Decide it first.';
const OWN_FIRST = 'Accept or reject your other change to this block first.';
const NOT_ITEM = 'Only a list item can be indented or outdented.';
const FIRST_ITEM = "The first item of a list can't be indented: there is no item to put it under.";
const NO_PARENT = "This item can't be outdented: it isn't under another item.";
const TABS = "Lines indented with tabs can't be moved. Indent them with spaces first.";
const NO_ROOM = "This item can't be outdented: a line under it isn't indented far enough.";
const LOST =
  "This format change can't be rejected, because its block no longer has that syntax. Accept it, or change the text in Raw with Track Changes off.";

/** The syntax that the serializer writes for each type. */
const SYNTAX: Record<BlockType, string> = {
  p: '',
  h1: '# ',
  h2: '## ',
  h3: '### ',
  h4: '#### ',
  h5: '##### ',
  h6: '###### ',
  ul: '- ',
  ol: '1. ',
  task: '- [ ] ',
  quote: '> ',
};

const isList = (type: BlockType) => type === 'ul' || type === 'ol' || type === 'task';
const isContainer = (type: BlockType) => isList(type) || type === 'quote';
const isHeading = (type: BlockType) => /^h[1-6]$/.test(type);

/** A list item's marker and the spaces after it, then its box. */
const ITEM = /^((?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$))(\[[ xX]\](?:[ \t]+|$))?/;
const HEADING = /^#{1,6}(?:[ \t]+|$)/;
/** A line that would make the paragraph above it a setext heading. */
const UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

/** What reading a block needs: the file read, and who is changing it. */
export interface BlockReader extends FormatReader {
  parsed: Parsed;
  /** The author of the change, whose own pending changes are changed in place. */
  owner: string | undefined;
}

/** A block as a change of its type sees it. Positions are in the file. */
interface Block {
  type: BlockType;
  /** The start of the line its syntax is on. */
  line: number;
  /** Where the syntax of its container starts, after the line's indentation, and where it ends. */
  indent: number;
  prefix: number;
  /** Where the text starts after the container syntax, or the carrier of the author's own mark. */
  head: number;
  /** Where the text starts after a heading's syntax. */
  start: number;
  /** The end of its last line. */
  end: number;
  /** The starts of its lines after the first. */
  lines: number[];
  /** Its syntax as written: the container's, or the heading's. */
  syntax: string;
  /** The start of the first line it takes, with the opener of its own mark. */
  top: number;
  /** The author's pending block change on it. */
  own?: { mark: MarkRange; segment: Segment; ops: ParsedFormatOp[] };
}

/** The text of a line, without its line break. */
const lineAt = (text: string, at: number) => text.slice(at, lineEnd(text, at));
const isBlank = (text: string, at: number) => lineAt(text, at).trim() === '';

/** The start of the run of lines that are not blank, which the line at `at` is in. */
function runStart(text: string, at: number): number {
  let start = lineStart(text, at);
  while (start > 0 && !isBlank(text, lineStart(text, start - 1)))
    start = lineStart(text, start - 1);
  return start;
}

/** The start of the line after the one that holds `at`, or undefined at the end of the body. */
function nextLine(reader: BlockReader, at: number): number | undefined {
  const limit = reader.parsed.ledgerRange?.from ?? reader.text.length;
  const newline = reader.text.indexOf('\n', at);
  return newline === -1 || newline + 1 >= limit ? undefined : newline + 1;
}

/** Whether a line has nothing but a blank before it, or is the first. */
function standsAfterBlank(text: string, top: number): boolean {
  return top === 0 || isBlank(text, lineStart(text, top - 1));
}

/** The container syntax at the start of the line at `line`: its indentation, and a `> ` or a
 * list item's marker with its box. */
function containerAt(
  text: string,
  line: number,
): { type: BlockType; lead: number; syntax: string } {
  const raw = lineAt(text, line);
  const lead = /^[ \t]*/.exec(raw)?.[0].length ?? 0;
  const rest = raw.slice(lead);
  const quote = /^>[ \t]?/.exec(rest)?.[0];
  if (quote !== undefined) return { type: 'quote', lead, syntax: quote };
  const item = ITEM.exec(rest);
  if (!item) return { type: 'p', lead, syntax: '' };
  const type = item[2] === undefined ? (/^\d/.test(item[0]) ? 'ol' : 'ul') : 'task';
  return { type, lead, syntax: item[0] };
}

/** The block of `paragraph`, as the lines of a paragraph range it. */
function readBlock(reader: BlockReader, paragraph: Range): Block {
  const { text, parsed } = reader;
  let line = lineStart(text, paragraph.from);
  let container = containerAt(text, line);
  // A mark that starts the block: after its container syntax, or alone on the line before it, which
  // has the container's syntax then (format §3.3).
  let own: Block['own'];
  let head = line + container.lead + container.syntax.length;
  for (const mark of parsed.marks) {
    for (const segment of mark.segments) {
      const opener = segment.open.from;
      const after = segment.carrier?.to ?? segment.open.to;
      const starts = opener === head || (segment.carrier !== undefined && after === head);
      if (!starts) continue;
      const ops = mark.kind === 'fmt' ? opsOf(mark, segment) : [];
      if (!ops.some((op) => op.name === 'was') || mark.entry.by !== reader.owner) {
        throw refused(AT_START);
      }
      own = { mark, segment, ops };
      if (opener < line) {
        line = lineStart(text, opener);
        container = containerAt(text, line);
        if (line + container.lead + container.syntax.length !== opener) throw refused(AT_START);
      }
      head = after;
    }
  }
  if (head < text.length && /^<!--/.test(text.slice(head))) throw refused(AT_START);
  let { type, syntax } = container;
  const indent = line + container.lead;
  const prefix = indent + syntax.length;
  const top = line;
  let start = head;
  if (syntax === '') {
    const heading = HEADING.exec(text.slice(head, lineEnd(text, head)))?.[0];
    if (heading !== undefined) {
      type = `h${heading.trimEnd().length}` as BlockType;
      syntax = heading;
      start = head + heading.length;
    }
  }
  // An opener alone after a bullet ends a line of its own: the block goes on to the end of the
  // paragraph its text is in, which its own mark closes, and a quote to its last line of `> `.
  let end = Math.max(paragraph.to, paragraphRange(text, reader.hidden, head).to);
  if (own) end = Math.max(end, lineEnd(text, own.segment.content.to));
  if (type === 'quote') {
    for (let at = nextLine(reader, end); at !== undefined && /^> ?\S/.test(lineAt(text, at));) {
      end = lineEnd(text, at);
      at = nextLine(reader, at);
    }
  }
  const lines: number[] = [];
  for (let at = nextLine(reader, head); at !== undefined && at <= end;) {
    lines.push(at);
    at = nextLine(reader, at);
  }
  const block: Block = {
    type,
    line,
    indent,
    prefix,
    head,
    start,
    end,
    lines,
    syntax,
    top,
  };
  if (own) block.own = own;
  return block;
}

/** Throws unless the block's type can be read and written back: the forms Markdown has other ways
 * of writing, which a change could not give back, are refused. */
function assertTypable(reader: BlockReader, block: Block): void {
  const { text } = reader;
  const lead = block.indent - block.line;
  const first = lineAt(text, block.start);
  if (first.replace(/<!--.*?-->/g, '').trim() === '' && block.lines.length === 0) {
    throw refused(NOT_A_TYPE);
  }
  if (isHeading(block.type) && /(?:^|[ \t])#+[ \t]*$/.test(first)) throw refused(NOT_A_TYPE);
  // A row of a table, with the rows next to it.
  const row = lineAt(text, block.line).includes('|');
  for (
    let at: number | undefined = row ? runStart(text, block.line) : undefined;
    at !== undefined;
    at = nextLine(reader, at)
  ) {
    const line = lineAt(text, at);
    if (line.trim() === '') break;
    if (line.includes('|') && DELIMITER_ROW.test(line)) throw refused(NOT_A_TYPE);
  }
  // A heading, a quote or a list in a list item or a quote is a block of its own in there.
  if (block.syntax !== '' && !isHeading(block.type)) {
    if (
      /^(?:>|#{1,6}(?:[ \t]|$)|(?:[-*+]|\d{1,9}[.)])[ \t])/.test(
        text.slice(block.head, lineEnd(text, block.head)),
      )
    ) {
      throw refused(INSIDE);
    }
  }
  if (block.type === 'quote') {
    if (lead > 0 || block.syntax !== '> ') throw refused(lead > 0 ? INSIDE : NOT_A_TYPE);
    for (const at of block.lines) if (!text.startsWith('> ', at)) throw refused(NOT_A_TYPE);
  }
}

/** The `was=` operation of the block as it stands. */
function wasOp(block: Block): string {
  const { type, syntax } = block;
  return syntax === SYNTAX[type] ? `was=${type}` : `was=${type}=${encodeValue(syntax)}`;
}

/** Zero-width changes at one place, and a change from there, written as one, in their order. */
function merged(changes: readonly TextChange[]): TextChange[] {
  const result: TextChange[] = [];
  for (const change of changes) {
    const last = result.at(-1);
    if (last && last.from === last.to && last.to === change.from) {
      result[result.length - 1] = { ...change, insert: last.insert + change.insert };
    } else result.push(change);
  }
  return result.filter((change) => change.from < change.to || change.insert !== '');
}

/** The width of the content column of a list item's syntax: its marker and the spaces after it. A
 * box is the text's, as continuationPrefix has it. */
const columnOf = (syntax: string) => ITEM.exec(syntax)?.[1]?.length ?? syntax.length;

/** What a block change comes to. `write` gives its changes with the markers given; with none, the
 * syntax alone, as Track Changes off types it. `edit` is a change of the author's own block change:
 * `kept` when the mark stays, written by `write`, or else taken away by `changes`. */
export type BlockPlan =
  | {
      kind: 'mark';
      at: number;
      extent: Range;
      write: (open: string, close: string) => TextChange[];
    }
  | { kind: 'edit'; at: number; extent: Range; id: string; kept: boolean; changes: TextChange[] };

/** The lines a list item takes, past its paragraph: those indented more than its bullet, and the
 * blank lines among them. Returns the end of the last. */
function subtreeEnd(reader: BlockReader, block: Block): number {
  const { text } = reader;
  const lead = block.indent - block.line;
  let end = block.end;
  for (let at = nextLine(reader, block.end); at !== undefined; at = nextLine(reader, at)) {
    const line = lineAt(text, at);
    if (line.trim() === '') continue;
    const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
    if (indent <= lead) break;
    end = lineEnd(text, at);
  }
  return end;
}

/** The starts of the lines that are not blank in `(from, to]`. */
function linesIn(reader: BlockReader, from: number, to: number): number[] {
  const starts: number[] = [];
  for (let at = nextLine(reader, from); at !== undefined && at <= to; at = nextLine(reader, at)) {
    if (!isBlank(reader.text, at)) starts.push(at);
  }
  return starts;
}

/**
 * The plan of a change of a block's type, or undefined where the block has that type already.
 *
 * @throws EditError where the block can't change to it.
 */
function planType(
  reader: BlockReader,
  block: Block,
  to: BlockType,
  tracked: boolean,
): BlockPlan | undefined {
  const { text } = reader;
  const { own } = block;
  const lead = block.indent - block.line;
  const extent = { from: block.top, to: block.end };
  let was = wasOp(block);
  if (own) {
    if (!tracked) throw refused(OWN_FIRST);
    const [old] = own.ops;
    const read = readWas(old?.value);
    if (!read || own.ops.length !== 1) throw refused(OWN_FIRST);
    if (read.type === to) {
      return {
        kind: 'edit',
        at: block.top,
        extent,
        id: own.mark.id,
        kept: false,
        changes: blockUndo(reader, own.segment, own.ops),
      };
    }
    was = old?.source ?? was;
  }
  // A setext heading reads as a paragraph here, and is no type that can be written back.
  const under = nextLine(reader, block.end);
  if (block.type === 'p' && under !== undefined && UNDERLINE.test(lineAt(text, under))) {
    throw refused(NOT_A_TYPE);
  }
  if (to === block.type) return undefined;
  assertTypable(reader, block);
  if (isList(block.type) && isList(to)) {
    // Between the types of list, an item changes where it stands.
    const children = subtreeEnd(reader, block) > block.end;
    const width = to === 'ol' ? 3 : 2;
    if (children && width > columnOf(block.syntax)) throw refused(UNDER_IT);
    const after = nextLine(reader, block.end);
    if (after !== undefined) {
      const next = lineAt(text, after);
      const nextLead = /^[ \t]*/.exec(next)?.[0].length ?? 0;
      const sibling = ITEM.exec(next.slice(nextLead));
      if (sibling && nextLead === lead && to !== 'ol' && /^\d/.test(sibling[0])) {
        if (!/^0*1[.)]/.test(sibling[0])) throw refused(NEXT_ITEM);
      }
    }
  } else {
    if (lead > 0) throw refused(INSIDE);
    if (isHeading(to) && block.lines.length > 0) throw refused(ONE_LINE);
    const after = nextLine(reader, block.end);
    if (!standsAfterBlank(text, block.top) || (after !== undefined && !isBlank(text, after))) {
      throw refused(ON_ITS_OWN);
    }
    if (isList(block.type) && subtreeEnd(reader, block) > block.end) throw refused(ON_ITS_OWN);
  }
  const quoted = block.type === 'quote';
  const write = (open: string, close: string): TextChange[] => {
    const changes: TextChange[] = [];
    const container = isContainer(to) ? SYNTAX[to] : '';
    changes.push({ from: block.indent, to: block.prefix, insert: container });
    if (own) {
      changes.push({ from: own.segment.open.from, to: block.head, insert: '' });
    }
    changes.push({
      from: block.head,
      to: block.start,
      insert: open + (isHeading(to) ? SYNTAX[to] : ''),
    });
    for (const at of block.lines) {
      if (quoted && to !== 'quote') changes.push({ from: at, to: at + 2, insert: '' });
      if (!quoted && to === 'quote') changes.push({ from: at, to: at, insert: '> ' });
    }
    if (own?.segment.close) changes.push({ ...own.segment.close, insert: '' });
    changes.push({ from: block.end, to: block.end, insert: close });
    return merged(changes.toSorted((a, b) => a.from - b.from || a.to - b.to));
  };
  if (own) {
    const { id } = own.mark;
    return {
      kind: 'edit',
      at: block.top,
      extent,
      id,
      kept: true,
      changes: write(`<!--fmt ${id} ${was}-->`, `<!--/${id}-->`),
    };
  }
  return {
    kind: 'mark',
    at: block.top,
    extent,
    write: (open, close) => write(open.replace('{op}', was), close),
  };
}

/** The box of a task item on the line at `line`: where its mark goes is the character in it. */
function boxAt(text: string, line: number): number | undefined {
  const match = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\]/.exec(lineAt(text, line));
  return match ? line + match[0].length - 2 : undefined;
}

function planCheck(
  reader: BlockReader,
  block: Block,
  checked: boolean,
  tracked: boolean,
): BlockPlan | undefined {
  const { text, parsed } = reader;
  if (block.type !== 'task') return undefined;
  const box = boxAt(text, block.line);
  if (box === undefined) return undefined;
  const now = text[box] ?? ' ';
  const end = lineEnd(text, block.line);
  const extent = { from: block.line, to: block.end };
  // The author's own box change goes when the box goes back.
  const mine = parsed.marks.find(
    (mark) =>
      mark.kind === 'fmt' &&
      mark.segments.some((segment) => segment.open.to === end && segment.close === undefined),
  );
  if (mine && tracked) {
    const [segment] = mine.segments;
    const ops = segment ? opsOf(mine, segment) : [];
    if (!segment || mine.entry.by !== reader.owner || !ops.every((op) => op.name === 'check')) {
      throw refused(OWN_FIRST);
    }
    if ((now === ' ') === !checked) return undefined;
    return {
      kind: 'edit',
      at: block.line,
      extent,
      id: mine.id,
      kept: false,
      changes: blockUndo(reader, segment, ops),
    };
  }
  if ((now === ' ') === !checked) return undefined;
  if (block.own) throw refused(OWN_FIRST);
  // The first line ends in text: an opener there would lose its carrier.
  if (
    lineAt(text, block.line)
      .slice(box - block.line + 2)
      .replace(/<!--.*?-->/g, '')
      .trim() === ''
  ) {
    throw refused(AT_START);
  }
  const op = checked ? '+check' : now === 'X' ? '-check=X' : '-check';
  return {
    kind: 'mark',
    at: block.line,
    extent,
    write: (open) => [
      { from: box, to: box + 1, insert: checked ? 'x' : ' ' },
      ...(open === '' ? [] : [{ from: end, to: end, insert: open.replace('{op}', op) }]),
    ],
  };
}

function planIndent(
  reader: BlockReader,
  block: Block,
  by: 1 | -1,
  tracked: boolean,
): BlockPlan | undefined {
  const { text } = reader;
  if (!isList(block.type)) throw refused(NOT_ITEM);
  const lead = block.indent - block.line;
  const last = subtreeEnd(reader, block);
  const lines = [...block.lines, ...linesIn(reader, block.end, last)];
  const spaces = (at: number) => /^[ \t]*/.exec(lineAt(text, at))?.[0] ?? '';
  if ([block.line, ...lines].some((at) => spaces(at).includes('\t'))) throw refused(TABS);
  const { own } = block;
  if (own) {
    if (!tracked) throw refused(OWN_FIRST);
    if (own.ops.length !== 1 || !own.ops[0]?.value?.startsWith('indent=')) throw refused(OWN_FIRST);
  }
  // The item before it at its indentation, of the same list, or the item it is under.
  let target: number | undefined;
  const marker = (syntax: string) =>
    /^\d/.test(syntax) ? syntax.replace(/^\d+/, '').trim() : syntax.trim()[0];
  for (let at = block.line; at > 0;) {
    at = lineStart(text, at - 1);
    const line = lineAt(text, at);
    if (line.trim() === '') continue;
    const indent = spaces(at).length;
    const item = ITEM.exec(line.slice(indent));
    if (by === 1) {
      if (indent > lead) continue;
      if (indent < lead || !item || marker(item[0]) !== marker(block.syntax)) break;
      target = indent + columnOf(item[0]);
      break;
    }
    if (indent >= lead) continue;
    if (item) target = indent;
    break;
  }
  if (target === undefined) throw refused(by === 1 ? FIRST_ITEM : NO_PARENT);
  const delta = target - lead;
  if (delta < 0 && lines.some((at) => spaces(at).length < -delta)) throw refused(NO_ROOM);
  let n = lead;
  let id: string | undefined;
  if (own) {
    n = Number(own.ops[0]?.value?.slice('indent='.length));
    id = own.mark.id;
    if (target === n) {
      const changes = blockUndo(reader, own.segment, own.ops);
      return {
        kind: 'edit',
        at: block.line,
        extent: { from: block.top, to: last },
        id,
        kept: false,
        changes,
      };
    }
  }
  const write = (open: string, close: string): TextChange[] => {
    const changes: TextChange[] = [];
    for (const at of [block.line, ...lines]) {
      changes.push(
        delta > 0
          ? { from: at, to: at, insert: ' '.repeat(delta) }
          : { from: at, to: at - delta, insert: '' },
      );
      if (at === block.line) {
        if (own) changes.push({ from: own.segment.open.from, to: block.head, insert: '' });
        changes.push({ from: block.head, to: block.head, insert: open });
      }
    }
    if (own?.segment.close) changes.push({ ...own.segment.close, insert: '' });
    changes.push({ from: last, to: last, insert: close });
    return merged(changes.toSorted((a, b) => a.from - b.from || a.to - b.to));
  };
  const op = `was=indent=${n}`;
  const extent = { from: block.top, to: last };
  if (id !== undefined) {
    return {
      kind: 'edit',
      at: block.line,
      extent,
      id,
      kept: true,
      changes: write(`<!--fmt ${id} ${op}-->`, `<!--/${id}-->`),
    };
  }
  return {
    kind: 'mark',
    at: block.line,
    extent,
    write: (open, close) => write(open.replace('{op}', op), close),
  };
}

/** Whether an operation is one of a block format change. */
export const isBlockOp = (op: FormatOp): boolean =>
  op.kind === 'block' || op.kind === 'check' || op.kind === 'indent';

/**
 * What a block format change does to the block of `paragraph`: undefined where it has what is asked
 * already. An opener given to `write` has `{op}` where its operations go.
 *
 * @throws EditError where the block can't be changed so.
 */
export function planBlock(
  reader: BlockReader,
  paragraph: Range,
  op: FormatOp,
  tracked: boolean,
): BlockPlan | undefined {
  const block = readBlock(reader, paragraph);
  switch (op.kind) {
    case 'block':
      return planType(reader, block, op.to, tracked);
    case 'check':
      return planCheck(reader, block, op.checked, tracked);
    case 'indent':
      return planIndent(reader, block, op.by, tracked);
    default:
      return undefined;
  }
}

/**
 * The changes that reject one segment of a block format change: its markers go, and the block gets
 * the syntax back that it had.
 *
 * @throws EditError when the block no longer has the syntax that rejecting takes away.
 */
export function blockUndo(
  reader: FormatReader,
  segment: Segment,
  ops: readonly ParsedFormatOp[],
): TextChange[] {
  const { text } = reader;
  const [op] = ops;
  if (!op) return [];
  const opener = segment.open;
  const line = lineStart(text, opener.from);
  if (op.name === 'check') {
    const box = boxAt(text, line);
    if (box === undefined) throw refused(LOST);
    const old = op.sign === '+' ? ' ' : (op.value ?? 'x');
    return [
      { from: box, to: box + 1, insert: old },
      { from: opener.from, to: opener.to, insert: '' },
    ];
  }
  const head = segment.carrier?.to ?? opener.to;
  const end = segment.content.to;
  const close = segment.close ?? { from: end, to: end };
  // The lines of the block after the line its text starts on.
  const lines: number[] = [];
  for (let at = text.indexOf('\n', head); at !== -1 && at < end; at = text.indexOf('\n', at + 1)) {
    lines.push(at + 1);
  }
  const changes: TextChange[] = [];
  if (op.value?.startsWith('indent=')) {
    const n = Number(op.value.slice('indent='.length));
    const lead = /^ */.exec(lineAt(text, line))?.[0].length ?? 0;
    const delta = lead - n;
    for (const at of [line, ...lines]) {
      if (at !== line && isBlank(text, at)) continue;
      if (delta > 0 && !text.startsWith(' '.repeat(delta), at)) throw refused(LOST);
      changes.push(
        delta > 0
          ? { from: at, to: at + delta, insert: '' }
          : { from: at, to: at, insert: ' '.repeat(-delta) },
      );
    }
    changes.push({ from: opener.from, to: head, insert: '' }, { ...close, insert: '' });
    return merged(changes.toSorted((a, b) => a.from - b.from || a.to - b.to));
  }
  const read = readWas(op.value);
  if (!read) throw refused(LOST);
  const was = { type: read.type, syntax: read.syntax ?? SYNTAX[read.type] };
  const raw = text.slice(line, opener.from);
  // A block change stands where a mark that starts the block does, after the container's syntax.
  if (!CONTAINER_PREFIX.test(raw.replace(/<!--.*?-->/g, ''))) throw refused(LOST);
  const lead = /^[ \t]*/.exec(raw)?.[0].length ?? 0;
  const rest = raw.slice(lead);
  const container = /^>[ \t]?/.exec(rest)?.[0] ?? ITEM.exec(rest)?.[0] ?? '';
  const quoted = container.startsWith('>');
  const heading =
    container === '' ? (HEADING.exec(text.slice(head, lineEnd(text, head)))?.[0] ?? '') : '';
  changes.push({
    from: line + lead,
    to: line + lead + container.length,
    insert: isContainer(was.type) ? was.syntax : '',
  });
  changes.push({ from: opener.from, to: head, insert: '' });
  changes.push({
    from: head,
    to: head + heading.length,
    insert: isHeading(was.type) ? was.syntax : '',
  });
  for (const at of lines) {
    if (quoted) {
      if (!text.startsWith('> ', at)) throw refused(LOST);
      changes.push({ from: at, to: at + 2, insert: was.type === 'quote' ? '> ' : '' });
    } else if (was.type === 'quote') changes.push({ from: at, to: at, insert: '> ' });
  }
  changes.push({ ...close, insert: '' });
  return merged(changes.toSorted((a, b) => a.from - b.from || a.to - b.to));
}
