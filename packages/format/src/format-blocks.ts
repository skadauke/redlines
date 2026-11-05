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
import { encodeValue, isInlineFormat, opsOf, readWas } from './format-ops.ts';
import type { BlockType, FormatOp, ParsedFormatOp } from './format-ops.ts';
import type { FormatReader } from './format-reader.ts';
import { DELIMITER_ROW, inspectPlace, paragraphRange } from './inline.ts';
import type { DocView, MarkRange, Parsed, Range, Segment, TextChange } from './types.ts';

const refused = (reason: string) => new EditError(reason, 'no-legal-placement');

const NOT_A_TYPE =
  "This block can't change type: Markdown writes it in a way a change couldn't give back. Change it in Raw.";
const INSIDE =
  "A block inside a list or a quote can't change type. Change the list item or the quote it is in.";
const ON_ITS_OWN =
  'Only a block with a blank line before and after it can change into another kind of block: Markdown would read it into the block next to it.';
const ONE_LINE = 'A heading is one line. Join the lines of this paragraph first.';
const BREAK_PENDING =
  'A heading is one line, and a pending change in this paragraph adds or takes away a line break. Decide it first.';
const STARTS_BLOCK =
  "This block can't change type: a line of it would start a block of its own in the new one, as a list item or a heading.";
const PULLS_IN =
  "This block can't become a list item: the indented block after it would become part of the item.";
const NUMBERED_UNDER =
  "This numbered item can't move there: right after the text above it, Markdown would read it as part of that text. Put a blank line before it, or number it 1.";
const QUOTE_BLOCKS = "A quote that holds a list or another quote can't change type.";
const INDENTED =
  "A paragraph indented by spaces can't change type. Take the spaces away first, or change the list item it is in.";
const PLACE = "A marker can't go at the end of this line, where Markdown would read it otherwise.";
const NEXT_ITEM =
  "This item can't change its list type: the numbered item after it would then be read as part of it. Turn off Track Changes to renumber this list.";
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
const STACKED =
  "This change of a block's type can't be rejected while another change starts the block. Decide that one first.";
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

/** The start of a line that can start a block of its own: a list item, a quote, an ATX heading, a
 * fence, a thematic break or an HTML block. In a list item or a quote it would not go on with the
 * paragraph, as a lazy line does in a paragraph of its own. */
const BLOCK_START =
  /^ {0,3}(?:[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|>|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$|<[A-Za-z/!?])/;

/** What reading a block needs: the file read, and who is changing it. */
export interface BlockReader extends FormatReader {
  parsed: Parsed;
  /** The author of the change, whose own pending changes are changed in place. */
  owner: string | undefined;
  /** The original view, every pending change rejected, when the file has changes of its text: the
   * lines of a block there must pass the same checks. */
  original?: DocView;
}

/** The lines around and in a block as they are with every pending change rejected: those after its
 * first line, without a quote's `> `, and the lines just before and after it. */
function linesBefore(
  reader: BlockReader,
  block: Block,
): { inside: string[]; previous: string | undefined; next: string | undefined } | undefined {
  const { original } = reader;
  if (!original) return undefined;
  const text = original.text;
  const from = lineStart(text, original.map.fromSource(block.top));
  const to = lineEnd(text, original.map.fromSource(block.end));
  const inside: string[] = [];
  for (let at = text.indexOf('\n', from) + 1; at > 0 && at <= to; at = text.indexOf('\n', at) + 1) {
    const line = lineAt(text, at);
    inside.push(block.type === 'quote' ? line.replace(/^> ?/, '') : line);
  }
  const previous = from > 0 ? lineAt(text, lineStart(text, from - 1)) : undefined;
  const after = text.indexOf('\n', to);
  const next = after === -1 || after + 1 >= text.length ? undefined : lineAt(text, after + 1);
  return { inside, previous, next };
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
  if (text.startsWith('<!--', head)) throw refused(AT_START);
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
    const goesOn = (at: number) => {
      const line = lineAt(text, at);
      return /^> ?\S/.test(line) && !BLOCK_START.test(line.replace(/^> ?/, ''));
    };
    for (let at = nextLine(reader, end); at !== undefined && goesOn(at);) {
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
    const next = nextLine(reader, block.end);
    if (next !== undefined && /^ {0,3}>/.test(lineAt(text, next))) throw refused(QUOTE_BLOCKS);
  }
}

/** Whether a line indented by `lead` is in a list item: the nearest line above it that is indented
 * less is an item's. */
function inItem(reader: BlockReader, line: number, lead: number): boolean {
  const { text } = reader;
  for (let at = line; at > 0;) {
    at = lineStart(text, at - 1);
    const above = lineAt(text, at);
    if (above.trim() === '') continue;
    const indent = /^[ \t]*/.exec(above)?.[0].length ?? 0;
    if (indent < lead) return ITEM.test(above.slice(indent));
  }
  return false;
}

/** Throws unless a marker can go at `position`: not where it would be read as text after a
 * backslash, between a hard break and the line end, or inside a link, a tag or other construct
 * (format §3.1). */
function assertPlace(reader: BlockReader, position: number): void {
  const { text, hidden } = reader;
  if (text[position - 1] === '\\') throw refused(PLACE);
  const place = inspectPlace(text, hidden, position);
  if (place.kind === 'refuse' || place.kind === 'construct' || place.kind === 'flank') {
    throw refused(PLACE);
  }
}

/** Whether a pending change in the block, of anyone's, adds or takes away a line break. */
function breaksPending(reader: BlockReader, block: Block): boolean {
  const { text, parsed } = reader;
  return parsed.marks.some(
    (mark) =>
      mark.kind !== 'fmt' &&
      mark.kind !== 'cmt' &&
      mark.kind !== 'hl' &&
      mark.segments.some((segment) => {
        if (segment.open.to <= block.top || segment.open.from >= block.end) return false;
        if (mark.kind === 'split' || (segment.payload ?? '').includes('\n')) return true;
        return (
          segment.close !== undefined &&
          text.slice(segment.open.to, segment.close.from).includes('\n')
        );
      }),
  );
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
  range: Range,
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
  // A line of the block that can start a block of its own would split off in a list item or a
  // quote, or go on in one, as a lazy line no longer does; and a heading's text as the first line
  // of a paragraph or an item can start one too, as `1. Intro` does.
  const inside = (line: string) => (block.type === 'quote' ? line.replace(/^> ?/, '') : line);
  if (block.lines.some((at) => BLOCK_START.test(inside(lineAt(text, at))))) {
    throw refused(STARTS_BLOCK);
  }
  // The same with every pending change rejected, which can bring a line back.
  const before = linesBefore(reader, block);
  if (before?.inside.some((line) => BLOCK_START.test(line))) throw refused(STARTS_BLOCK);
  const firstText = text.slice(block.start, lineEnd(text, block.start)).replace(/^<!--.*?-->/, '');
  if (!isHeading(to) && BLOCK_START.test(firstText)) throw refused(STARTS_BLOCK);
  // A box at the start of an item's text makes it a task.
  if ((to === 'ul' || to === 'ol') && /^\[[ xX]\](?:[ \t]|$)/.test(firstText)) {
    throw refused(STARTS_BLOCK);
  }
  if (isHeading(to) && breaksPending(reader, block)) throw refused(BREAK_PENDING);
  assertPlace(reader, block.end);
  if (isList(to) && !isList(block.type)) {
    // The block after the blank line, indented to the item's text or more, would be the item's.
    let next = nextLine(reader, block.end);
    while (next !== undefined && isBlank(text, next)) next = nextLine(reader, next);
    const indent = next === undefined ? 0 : (/^ */.exec(lineAt(text, next))?.[0].length ?? 0);
    if (next !== undefined && indent >= (to === 'ol' ? 3 : 2)) throw refused(PULLS_IN);
  }
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
      // A numbered item after it that doesn't start at 1 is text of this one, a lazy line, until
      // this one is numbered too: then it would be the next item.
      const lazy = sibling && /^\d/.test(sibling[0]) && !/^0*1[.)]/.test(sibling[0]);
      if (lazy && to === 'ol' && block.type !== 'ol' && nextLead <= lead) {
        throw refused(STARTS_BLOCK);
      }
    }
    // The next item of its list, past the lines under it: numbered, and not from 1, it can't
    // start a list of its own right after text, so it would be read into the text above it.
    const last = subtreeEnd(reader, block);
    const following = nextLine(reader, last);
    if (following !== undefined && to !== 'ol') {
      const next = lineAt(text, following);
      const nextLead = /^[ \t]*/.exec(next)?.[0].length ?? 0;
      const sibling = ITEM.exec(next.slice(nextLead));
      // With Track Changes off, the item after it changes with it when the range takes it too.
      const together = !tracked && following <= range.to;
      const numbered = sibling && /^\d/.test(sibling[0]) && !/^0*1[.)]/.test(sibling[0]);
      if (numbered && nextLead === lead && !together) throw refused(NEXT_ITEM);
    }
    // And with every pending change rejected, which can bring the next item back.
    const next = before?.next;
    if (next !== undefined && to !== 'ol') {
      const nextLead = /^[ \t]*/.exec(next)?.[0].length ?? 0;
      const sibling = ITEM.exec(next.slice(nextLead));
      const numbered = sibling && /^\d/.test(sibling[0]) && !/^0*1[.)]/.test(sibling[0]);
      if (numbered && nextLead === lead) throw refused(NEXT_ITEM);
    }
  } else {
    if (lead > 0) throw refused(inItem(reader, block.line, lead) ? INSIDE : INDENTED);
    if (isHeading(to) && block.lines.length > 0) throw refused(ONE_LINE);
    const after = nextLine(reader, block.end);
    if (!standsAfterBlank(text, block.top) || (after !== undefined && !isBlank(text, after))) {
      throw refused(ON_ITS_OWN);
    }
    const blankOr = (line: string | undefined) => line === undefined || line.trim() === '';
    if (before && !(blankOr(before.previous) && blankOr(before.next))) throw refused(ON_ITS_OWN);
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
  assertPlace(reader, end);
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
  // An ordered item that doesn't start at 1 can't interrupt a paragraph: right after the text of
  // the item it moves under or out of, it would be read as part of that text.
  const above = block.line > 0 ? lineStart(text, block.line - 1) : undefined;
  const numbered = /^\d+[.)]/.exec(block.syntax)?.[0];
  if (numbered && !/^0*1[.)]$/.test(numbered) && above !== undefined && !isBlank(text, above)) {
    throw refused(NUMBERED_UNDER);
  }
  assertPlace(reader, last);
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
 * already. An opener given to `write` has `{op}` where its operations go. `range` is the range of
 * the whole change.
 *
 * @throws EditError where the block can't be changed so.
 */
export function planBlock(
  reader: BlockReader,
  paragraph: Range,
  op: FormatOp,
  tracked: boolean,
  range: Range,
): BlockPlan | undefined {
  const block = readBlock(reader, paragraph);
  switch (op.kind) {
    case 'block':
      return planType(reader, block, op.to, tracked, range);
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
  // Another opener alone on its line after this one takes its carrier from the line's syntax, which
  // the old syntax would change: that change is decided first.
  if (text.startsWith('<!--', head)) throw refused(STACKED);
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
    // Moved back, the item must still be an item: indented by four more than the text of the item
    // above it, or by four at the top level, it would be code.
    let room = 3;
    for (let at = line; at > 0;) {
      at = lineStart(text, at - 1);
      const above = lineAt(text, at);
      if (above.trim() === '') continue;
      const indent = /^ */.exec(above)?.[0].length ?? 0;
      if (indent >= n) continue;
      const item = ITEM.exec(above.slice(indent));
      if (item) room = indent + columnOf(item[0]) + 3;
      break;
    }
    if (n > room) throw refused(LOST);
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

/**
 * What a format change did, as what a person would ask for to make it again: the operations of all
 * its segments, each once, turned forward, as `+bold` is bold on and `was=p` is the type its block
 * has now. For views, which name a change by them. Operations it can't read are left out.
 */
export function formatChange(parsed: Parsed, mark: MarkRange): FormatOp[] {
  if (mark.kind !== 'fmt') return [];
  const seen = new Set<string>();
  const done: FormatOp[] = [];
  for (const segment of mark.segments) {
    for (const op of segmentChange(parsed.text, mark, segment)) {
      const key = JSON.stringify(op);
      if (seen.has(key)) continue;
      seen.add(key);
      done.push(op);
    }
  }
  return done;
}

/** What one segment of a format change did, as `formatChange` gives it. */
function segmentChange(text: string, mark: MarkRange, segment: Segment): FormatOp[] {
  const done: FormatOp[] = [];
  for (const op of opsOf(mark, segment)) {
    if (isInlineFormat(op.name) && op.sign !== '') {
      done.push({ kind: 'inline', format: op.name, on: op.sign === '+' });
    } else if (op.name === 'link') {
      done.push({ kind: 'link', url: op.sign === '-' ? null : '' });
    } else if (op.name === 'check' && op.sign !== '') {
      done.push({ kind: 'check', checked: op.sign === '+' });
    } else if (op.name === 'was' && op.value?.startsWith('indent=')) {
      const line = lineStart(text, segment.open.from);
      const lead = /^ */.exec(lineAt(text, line))?.[0].length ?? 0;
      const was = Number(op.value.slice('indent='.length));
      if (lead !== was) done.push({ kind: 'indent', by: lead > was ? 1 : -1 });
    } else if (op.name === 'was' && readWas(op.value)) {
      done.push({ kind: 'block', to: typeAt(text, segment) });
    }
  }
  return done;
}

/** The type of the block that a block format change's segment starts, as it stands now. */
function typeAt(text: string, segment: Segment): BlockType {
  const line = lineStart(text, segment.open.from);
  const { type } = containerAt(text, line);
  if (type !== 'p') return type;
  const head = segment.carrier?.to ?? segment.open.to;
  const heading = HEADING.exec(text.slice(head, lineEnd(text, head)))?.[0];
  return heading === undefined ? 'p' : (`h${heading.trimEnd().length}` as BlockType);
}
