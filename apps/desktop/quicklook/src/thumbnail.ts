// What a Finder thumbnail of a Markdown file draws (#345): the first blocks of the document in the
// Clean view (design §5.3), every pending change accepted, as plain data for the Swift extension to
// draw (swift/ThumbnailPage.swift). A thumbnail is a few lines of small text, so this does not parse
// the Markdown: it scans the start of the text by lines, as far as a page holds, and says what each
// block is. It never fails on what it is given; what it doesn't know is a paragraph.

import { frontMatterEnd, newestView } from '@redlines/format';

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'item'; depth: number; marker: string; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }
  | { kind: 'table'; rows: string[][] };

/** The most blocks, and the most characters of text in them, that a thumbnail asks for: a page holds
 * a good deal less, and the scan stops when it has this much. */
export const MAX_BLOCKS = 40;
export const MAX_TEXT = 4000;
/** The most of a paragraph, of a quote, of an item and of a cell that is kept, in characters. */
const MAX_PARAGRAPH = 360;
const MAX_CELL = 40;
/** The most lines of a code block, and rows and columns of a table, that are kept. */
const MAX_CODE_LINES = 6;
const MAX_ROWS = 5;
const MAX_COLUMNS = 4;

/** Where the escaped marks go while the rules of `plain` are applied: the private use area. */
const ESCAPED = 0xe000;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
};

/** `text` cut short at a space under `limit` characters, with an ellipsis. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The words of some Markdown as a person reads them: its marks are gone, an image is its alt text
 * and a link is its text. */
export function plain(markdown: string): string {
  return (
    markdown
      // An escaped mark is a character and not a mark: it goes out of the way of the rules below, as
      // a character of the private use area, and comes back at the end.
      .replace(/\\([!-/:-@[-`{-~])/g, (_, mark: string) =>
        String.fromCharCode(ESCAPED + mark.charCodeAt(0)),
      )
      // The markers that a document keeps (comments' anchors, the ledger) are comments.
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
      .replace(/<\/?[A-Za-z][^>]*>/g, '')
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
      .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '$1')
      // An underscore marks emphasis only at the edge of a word: snake_case_names are words.
      .replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?=$|[^\w])/g, '$1$2')
      .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name] ?? '')
      .replace(/[\ue021-\ue07e]/g, (mark) => String.fromCharCode(mark.charCodeAt(0) - ESCAPED))
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** The cells of a table's row. */
function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner
    .split(/(?<!\\)\|/)
    .slice(0, MAX_COLUMNS)
    .map((cell) => clip(plain(cell), MAX_CELL));
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/**
 * The blocks at the start of Markdown `text`, as far as a thumbnail draws: headings, paragraphs,
 * list items, quotes, code, rules and tables. Comments are not blocks (they are the markers and the
 * ledger, which no view shows), and nothing is read past what is asked for.
 */
export function blocksOf(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let used = 0;
  const full = () => blocks.length >= MAX_BLOCKS || used >= MAX_TEXT;
  const push = (block: Block, size: number) => {
    blocks.push(block);
    used += size;
  };

  let paragraph: string[] = [];
  let quote: string[] = [];
  const flushParagraph = () => {
    const words = plain(paragraph.join(' '));
    paragraph = [];
    if (words) push({ kind: 'paragraph', text: clip(words, MAX_PARAGRAPH) }, words.length);
  };
  const flushQuote = () => {
    const words = plain(quote.join(' '));
    quote = [];
    if (words) push({ kind: 'quote', text: clip(words, MAX_PARAGRAPH) }, words.length);
  };
  const flush = () => {
    flushParagraph();
    flushQuote();
  };

  for (let i = 0; i < lines.length && !full(); i++) {
    let line = lines[i] ?? '';

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marks = fence[1] ?? '```';
      const closing = new RegExp(
        `^ {0,3}${marks[0] === '`' ? '`' : '~'}{${marks.length},}[ \\t]*$`,
      );
      const code: string[] = [];
      for (i += 1; i < lines.length && !closing.test(lines[i] ?? ''); i++) {
        if (code.length < MAX_CODE_LINES) code.push((lines[i] ?? '').trimEnd());
      }
      const body = code.join('\n').trimEnd();
      if (body) push({ kind: 'code', text: body }, body.length);
      continue;
    }

    // A comment is nothing a view shows. One that is closed on its line goes from it, and what is
    // left of the line is read; one that runs over lines, as the ledger does, goes with them.
    if (line.includes('<!--')) {
      const rest = line.replace(/<!--[\s\S]*?-->/g, '');
      if (rest.includes('<!--')) {
        flush();
        while (i < lines.length && !(lines[i] ?? '').includes('-->')) i += 1;
        continue;
      }
      if (rest.trim() === '') {
        flush();
        continue;
      }
      line = rest;
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const words = plain(heading[2] ?? '');
      if (words)
        push({ kind: 'heading', level: (heading[1] ?? '#').length, text: words }, words.length);
      continue;
    }

    // A line of = or - under a paragraph makes it a heading.
    const setext = SETEXT.exec(line);
    if (setext && paragraph.length > 0) {
      const words = plain(paragraph.join(' '));
      paragraph = [];
      if (words) {
        push(
          { kind: 'heading', level: setext[1]?.startsWith('=') ? 1 : 2, text: words },
          words.length,
        );
      }
      continue;
    }

    if (RULE.test(line)) {
      flush();
      push({ kind: 'rule' }, 0);
      continue;
    }

    // A table: a row with a pipe, and under it the row of dashes that says so.
    if (
      line.includes('|') &&
      DELIMITER.test(lines[i + 1] ?? '') &&
      (lines[i + 1] ?? '').includes('-')
    ) {
      flush();
      const rows = [cellsOf(line)];
      for (i += 2; i < lines.length && (lines[i] ?? '').includes('|'); i++) {
        if (rows.length < MAX_ROWS) rows.push(cellsOf(lines[i] ?? ''));
      }
      // The line that ended the table is read again, as the one that follows it.
      i -= 1;
      push({ kind: 'table', rows }, rows.flat().join('').length);
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      flushParagraph();
      quote.push(quoted[1]?.replace(/^(?:>[ \t]?)+/, '') ?? '');
      continue;
    }
    flushQuote();

    const item = ITEM.exec(line);
    if (item) {
      flushParagraph();
      const mark = item[2] ?? '-';
      let words = item[3] ?? '';
      let marker = /\d/.test(mark) ? mark.replace(')', '.') : '•';
      const task = /^\[([ xX])\][ \t]+/.exec(words);
      if (task) {
        marker = task[1] === ' ' ? '☐' : '☑';
        words = words.slice(task[0].length);
      }
      // What is indented under an item goes on with it.
      while (
        i + 1 < lines.length &&
        /^ {2,}\S/.test(lines[i + 1] ?? '') &&
        !ITEM.test(lines[i + 1] ?? '')
      ) {
        i += 1;
        words += ` ${(lines[i] ?? '').trim()}`;
      }
      const text = plain(words);
      push(
        {
          kind: 'item',
          depth: Math.min(3, Math.floor((item[1] ?? '').length / 2)),
          marker,
          text: clip(text, MAX_PARAGRAPH),
        },
        text.length,
      );
      continue;
    }

    paragraph.push(line);
  }
  if (!full()) flush();
  return blocks;
}

/** The blocks of a file's text: the Clean view of it, without its front matter. */
export function thumbnailBlocks(source: string): Block[] {
  let text = source;
  try {
    text = newestView(source).text;
  } catch {
    // The format refuses nothing here, but a thumbnail that fails shows nothing at all. What is left
    // draws as the same words: the markers are comments, which are not shown.
  }
  const end = frontMatterEnd(text);
  return blocksOf(end >= 0 ? text.slice(end) : text);
}
