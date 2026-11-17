// The blocks of a Markdown file, read with micromark's own events (GFM's too), flattened to what a
// Word file has: paragraphs, headings, code lines, rules and tables, each with its inline atoms.
//
// Every atom keeps the offsets of the source it came from. That is what lets the exporter tell which
// marks cover it: it never reads a marker itself, `parse` from @redlines/format does, and an atom is
// covered by a mark when it lies in the mark's content.

import { frontMatterEnd } from '@redlines/format';
import { gfm } from 'micromark-extension-gfm';
import { parse, postprocess, preprocess } from 'micromark';
import type { Event, Token } from 'micromark-util-types';

export interface Fmt {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
}

export type Atom =
  | {
      kind: 'text';
      text: string;
      /** The source range the text was read from. */
      from: number;
      to: number;
      /** Whether `text` is the source's characters one for one, so that it may be cut anywhere. */
      exact: boolean;
      fmt: Fmt;
      link: string | null;
    }
  /** `para`: the break between two blocks of a deleted text, not a line break in one. */
  | { kind: 'break'; from: number; to: number; para?: boolean };

export interface ListContext {
  ordered: boolean;
  /** 0 for an item of a list at the top. */
  level: number;
  /** Tells one ordered list from another, so each one numbers from 1. */
  instance: number;
  /** The first block of its item: the one that shows the bullet or the number. */
  first: boolean;
}

export interface Leaf {
  type: 'paragraph' | 'heading' | 'code' | 'rule';
  /** 1 to 6, of a heading. */
  level: number;
  atoms: Atom[];
  from: number;
  to: number;
  list: ListContext | null;
  /** How many block quotes it is in. */
  quote: number;
}

export interface TableCell {
  atoms: Atom[];
  from: number;
  to: number;
}

export interface TableBlock {
  type: 'table';
  from: number;
  to: number;
  rows: { header: boolean; cells: TableCell[] }[];
}

export type Block = Leaf | TableBlock;

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

/** The text of a character reference, `&amp;` or `&#8212;`; the reference itself when unknown. */
export function decodeReference(reference: string): string {
  const body = reference.slice(1, -1);
  const numeric = /^#(?:[xX]([0-9a-fA-F]+)|(\d+))$/.exec(body);
  if (numeric) {
    const code = numeric[1] ? parseInt(numeric[1], 16) : parseInt(numeric[2] ?? '0', 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�';
  }
  return NAMED[body] ?? reference;
}

const PLAIN: Fmt = { bold: false, italic: false, strike: false, code: false };

/** The events of a text, with GitHub's extensions. */
function eventsOf(text: string): Event[] {
  return postprocess(
    parse({ extensions: [gfm()] })
      .document()
      .write(preprocess()(text, undefined, true)),
  );
}

/** The address of the link that is entered at `start`, which only its end knows. */
function linkAddress(events: Event[], start: number, text: string): string | null {
  let depth = 0;
  let images = 0;
  let found: string | null = null;
  for (let i = start; i < events.length; i++) {
    const [kind, token] = events[i] as Event;
    if (token.type === 'link') {
      depth += kind === 'enter' ? 1 : -1;
      if (depth === 0) return found;
    } else if (token.type === 'image') {
      images += kind === 'enter' ? 1 : -1;
    } else if (token.type === 'resourceDestinationString' && kind === 'enter' && images === 0) {
      found = text.slice(token.start.offset, token.end.offset);
    }
  }
  return found;
}

/** The HTML comments in a piece of raw HTML take no text; what is between them does (a line that
 * starts with a marker is an HTML block, and its words are text). */
function outsideComments(html: string, from: number): { text: string; from: number }[] {
  const pieces: { text: string; from: number }[] = [];
  let at = 0;
  for (const found of html.matchAll(/<!--[\s\S]*?-->/g)) {
    if (found.index > at) pieces.push({ text: html.slice(at, found.index), from: from + at });
    at = found.index + found[0].length;
  }
  if (at < html.length) pieces.push({ text: html.slice(at), from: from + at });
  return pieces;
}

/** The blocks of `text`, front matter left out. */
export function markdownBlocks(text: string): Block[] {
  const events = eventsOf(text);
  const frontEnd = Math.max(0, frontMatterEnd(text));
  const blocks: Block[] = [];

  let bold = 0;
  let italic = 0;
  let strike = 0;
  let code = 0;
  const links: (string | null)[] = [];
  let sink: Atom[] | null = null;
  let leaf: Leaf | null = null;
  let table: TableBlock | null = null;
  let header = false;
  let row: TableBlock['rows'][number] | null = null;
  let cell: TableCell | null = null;
  const lists: { ordered: boolean; instance: number }[] = [];
  let instances = 0;
  let quote = 0;
  let newItem = false;
  let inCode = false;
  let breakFollows = false;

  const fmt = (): Fmt => ({
    bold: bold > 0,
    italic: italic > 0,
    strike: strike > 0,
    code: code > 0,
  });
  const context = (): ListContext | null => {
    const list = lists[lists.length - 1];
    if (!list) return null;
    const first = newItem;
    newItem = false;
    return { ordered: list.ordered, level: lists.length - 1, instance: list.instance, first };
  };
  const startLeaf = (type: Leaf['type'], token: Token): Leaf => ({
    type,
    level: 1,
    atoms: [],
    from: token.start.offset,
    to: token.end.offset,
    list: context(),
    quote,
  });
  const push = (block: Block) => {
    if (block.from >= frontEnd) blocks.push(block);
  };

  events.forEach(([kind, token, ctx], index) => {
    const slice = () => ctx.sliceSerialize(token);
    if (kind === 'enter') {
      switch (token.type as string) {
        case 'blockQuote':
          quote++;
          break;
        case 'listOrdered':
        case 'listUnordered':
          lists.push({
            ordered: token.type === 'listOrdered',
            instance: token.type === 'listOrdered' ? ++instances : 0,
          });
          break;
        case 'listItemPrefix':
          newItem = true;
          break;
        case 'paragraph':
          leaf = startLeaf('paragraph', token);
          sink = leaf.atoms;
          break;
        case 'atxHeading':
        case 'setextHeading':
          leaf = startLeaf('heading', token);
          sink = leaf.atoms;
          break;
        case 'atxHeadingSequence':
          if (leaf) leaf.level = Math.min(6, slice().length);
          break;
        case 'setextHeadingLineSequence':
          if (leaf) leaf.level = slice().startsWith('=') ? 1 : 2;
          break;
        case 'thematicBreak':
          push(startLeaf('rule', token));
          break;
        case 'codeFenced':
        case 'codeIndented':
          inCode = true;
          break;
        case 'codeFlowValue': {
          const line = startLeaf('code', token);
          line.atoms.push({
            kind: 'text',
            text: slice(),
            from: token.start.offset,
            to: token.end.offset,
            exact: true,
            fmt: { ...PLAIN, code: true },
            link: null,
          });
          push(line);
          break;
        }
        case 'htmlFlow': {
          const raw = slice();
          const words = outsideComments(raw, token.start.offset).filter(
            (piece) => piece.text.trim() !== '',
          );
          if (words.length > 0) {
            const para = startLeaf('paragraph', token);
            for (const piece of words) {
              para.atoms.push({
                kind: 'text',
                text: piece.text,
                from: piece.from,
                to: piece.from + piece.text.length,
                exact: true,
                fmt: fmt(),
                link: null,
              });
            }
            push(para);
          }
          break;
        }
        case 'table':
          table = { type: 'table', from: token.start.offset, to: token.end.offset, rows: [] };
          break;
        case 'tableHead':
          header = true;
          break;
        case 'tableBody':
          header = false;
          break;
        case 'tableRow':
          row = { header, cells: [] };
          table?.rows.push(row);
          break;
        case 'tableHeader':
        case 'tableData':
          cell = { atoms: [], from: token.start.offset, to: token.end.offset };
          row?.cells.push(cell);
          sink = cell.atoms;
          break;
        case 'emphasis':
          italic++;
          break;
        case 'strong':
          bold++;
          break;
        case 'strikethrough':
          strike++;
          break;
        case 'codeText':
          code++;
          break;
        case 'link':
          links.push(linkAddress(events, index, text));
          break;
        case 'taskListCheck':
          sink?.push({
            kind: 'text',
            text: /[xX]/.test(slice()) ? '☒' : '☐',
            from: token.start.offset,
            to: token.end.offset,
            exact: false,
            fmt: fmt(),
            link: null,
          });
          break;
        case 'data':
        case 'codeTextData':
          if (sink && !inCode) {
            sink.push({
              kind: 'text',
              text: slice(),
              from: token.start.offset,
              to: token.end.offset,
              exact: true,
              fmt: fmt(),
              link: links[links.length - 1] ?? null,
            });
          }
          break;
        case 'characterEscapeValue':
          sink?.push({
            kind: 'text',
            text: slice(),
            from: token.start.offset,
            to: token.end.offset,
            exact: true,
            fmt: fmt(),
            link: links[links.length - 1] ?? null,
          });
          break;
        case 'characterReference':
          sink?.push({
            kind: 'text',
            text: decodeReference(slice()),
            from: token.start.offset,
            to: token.end.offset,
            exact: false,
            fmt: fmt(),
            link: links[links.length - 1] ?? null,
          });
          break;
        case 'hardBreakEscape':
        case 'hardBreakTrailing':
          sink?.push({ kind: 'break', from: token.start.offset, to: token.end.offset });
          breakFollows = true;
          break;
        case 'lineEnding':
          if (sink && !inCode) {
            if (breakFollows) breakFollows = false;
            else {
              sink.push({
                kind: 'text',
                text: ' ',
                from: token.start.offset,
                to: token.end.offset,
                exact: false,
                fmt: fmt(),
                link: links[links.length - 1] ?? null,
              });
            }
          }
          break;
        default:
          break;
      }
    } else {
      switch (token.type as string) {
        case 'blockQuote':
          quote--;
          break;
        case 'listOrdered':
        case 'listUnordered':
          lists.pop();
          break;
        case 'paragraph':
        case 'atxHeading':
        case 'setextHeading':
          if (leaf) {
            leaf.to = token.end.offset;
            push(leaf);
          }
          leaf = null;
          sink = null;
          break;
        case 'codeFenced':
        case 'codeIndented':
          inCode = false;
          break;
        case 'table':
          if (table) push(table);
          table = null;
          row = null;
          break;
        case 'tableHeader':
        case 'tableData':
          cell = null;
          sink = null;
          break;
        case 'emphasis':
          italic--;
          break;
        case 'strong':
          bold--;
          break;
        case 'strikethrough':
          strike--;
          break;
        case 'codeText':
          code--;
          break;
        case 'link':
          links.pop();
          break;
        default:
          break;
      }
    }
  });
  return blocks;
}
