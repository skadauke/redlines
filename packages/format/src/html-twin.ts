// HTML with a Markdown twin (#690, design: "Markdown twins"): the shapes of HTML that have an exact
// form in Markdown, and the converter that writes it. A heading, a blockquote, a simple list, a
// simple table, a rule, and a pre with code are drawn and edited as the HTML they are; a command
// that changes the block's structure (a heading's level, Tab, a row) converts it to its twin first.
//
// Exact means the twin renders as the HTML did in GitHub's renderer (micromark 4.0.2 with GFM, the
// project's reference): `html-twin.check.test.ts` renders both and compares them. The converter
// is written to be sure of that, not to be clever: text is carried over only when no character in
// it means anything to Markdown (no `*`, `_`, `[`, a backtick, a backslash, `|`, `~`, `$`, `<` that
// is not a plain inline tag, `@`, an address that Markdown would link, a number or a bullet at the
// start of a line), and a shape that has more than the twin has (an attribute, a span, a caption,
// a comment, markup of a pending change) is no twin. In that case the answer says why in a
// sentence, which a disabled command shows as its hint.

/** The twin of a block of HTML. */
export type TwinKind = 'heading' | 'rule' | 'code' | 'quote' | 'list' | 'table';

export interface Twin {
  kind: TwinKind;
  /** The Markdown block, with no line break at its end. */
  markdown: string;
  /** What the HTML was, for a card: `<h2> heading`, `list`, `table`, `quote`, `rule`, `code block`. */
  what: string;
}

export type TwinRead = { twin: Twin } | { reason: string; kind?: TwinKind };

/** What the block is placed after: a line of text above it changes what some Markdown means. */
export interface TwinPlace {
  /** The line above the block holds text (no blank line between). */
  afterText?: boolean;
}

export const NO_TWIN = "This HTML has no exact Markdown form, so it can't be changed as Markdown.";
type Twinned = { twin: Omit<Twin, 'kind'> } | { reason: string };
const reason = (text: string): { reason: string } => ({ reason: text });
const notExact = (what: string): { reason: string } =>
  reason(
    `This ${what} has more in it than Markdown can say exactly, so it can't be changed as Markdown.`,
  );

/** Text that means nothing to Markdown: letters, numbers, spaces and plain punctuation, and entities. */
const PLAIN =
  /^(?:[\p{L}\p{N}\p{M} .,;:'"?!%()+\-/=^{}…–—’“”#]|&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});)*$/u;
/** An address that Markdown would turn into a link by itself. */
const AUTOLINK = /(?:www\.|https?:|ftp:|mailto:)/i;
/** The tags that pass through Markdown as raw HTML and read the same there. */
const INLINE_TAGS = new Set([
  ...['b', 'strong', 'i', 'em', 'code', 'tt', 'kbd', 'samp', 'var', 's', 'strike', 'del', 'ins'],
  ...['sub', 'sup', 'mark', 'small', 'abbr', 'dfn', 'cite', 'q', 'time', 'span', 'bdo', 'a', 'br'],
]);
const VOID_TAGS = new Set(['br']);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*?)(\/?)>/y;
/** Attributes of an inline tag: none that Markdown would read. */
const TAG_ATTRIBUTES = /^(?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"|\\`\n]*"|'[^'|\\`\n]*'))?)*\s*$/;

interface InlineOptions {
  /** The text starts a line of Markdown (a heading's, an item's, a quote's): its first character
   * must not start another block. A cell's does not. */
  lead: boolean;
  /** An empty text is a twin of an empty text (a cell). */
  allowEmpty: boolean;
}

/**
 * Inline HTML content as the same text in Markdown, or null when it isn't the same there. Plain
 * text and plain inline tags carry over as they are.
 */
function inlineOf(source: string, { lead, allowEmpty }: InlineOptions): string | null {
  const content = source.trim();
  if (content === '') return allowEmpty ? '' : null;
  if (/[\n\r\t]/.test(content)) return null;
  const stack: string[] = [];
  let text = '';
  let at = 0;
  while (at < content.length) {
    if (content[at] === '<') {
      TAG.lastIndex = at;
      const found = TAG.exec(content);
      if (!found) return null;
      const [whole, slash, rawName, attributes, selfClose] = found as unknown as [
        string,
        string,
        string,
        string,
        string,
      ];
      const name = rawName.toLowerCase();
      if (!INLINE_TAGS.has(name)) return null;
      if (slash) {
        if (attributes.trim() !== '' || selfClose || stack.pop() !== name) return null;
      } else {
        if (!TAG_ATTRIBUTES.test(attributes)) return null;
        if (VOID_TAGS.has(name)) {
          if (name !== 'br' || attributes.trim() !== '') return null;
        } else if (selfClose) return null;
        else stack.push(name);
      }
      at += whole.length;
      continue;
    }
    let end = content.indexOf('<', at);
    if (end < 0) end = content.length;
    const part = content.slice(at, end);
    if (!PLAIN.test(part) || AUTOLINK.test(part)) return null;
    text += part;
    at = end;
  }
  if (stack.length > 0) return null;
  if (!/[\p{L}\p{N}]/u.test(text)) return allowEmpty && text.trim() === '' ? content : null;
  // A line of Markdown that starts with these is another block's start.
  if (lead && (/^[#=\-+>]/.test(content) || /^\d{1,9}[.)]/.test(content))) return null;
  // The closing run of a heading, and a trailing `#`.
  if (/#$/.test(content)) return null;
  return content;
}

// The structure of a block's HTML: its tags and text, in order.
type Token =
  | { kind: 'open'; name: string; attributes: string; selfClose: boolean }
  | { kind: 'close'; name: string }
  | { kind: 'text'; text: string };

/** The attributes of a tag as pairs, or null if anything is left that isn't a plain attribute. */
function attributesOf(text: string): Record<string, string> | null {
  const found: Record<string, string> = {};
  const rest = text.replace(
    /\s+([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g,
    (_all, name: string, a: string | undefined, b: string | undefined) => {
      found[name.toLowerCase()] = a ?? b ?? '';
      return '';
    },
  );
  return rest.trim() === '' ? found : null;
}

/** Drops the white space between tags, which HTML ignores. */
function squeeze(tokens: Token[]): Token[] {
  return tokens.filter((token) => token.kind !== 'text' || token.text.trim() !== '');
}

/** Reads tokens one at a time. */
class Reader {
  at = 0;
  readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }
  peek(): Token | undefined {
    return this.tokens[this.at];
  }
  next(): Token | undefined {
    return this.tokens[this.at++];
  }
  done(): boolean {
    return this.at >= this.tokens.length;
  }
  /** The next token if it is the opening tag `name`, with no attributes unless `allowed`. */
  open(name: string, allowed: readonly string[] = []): Record<string, string> | null {
    const token = this.peek();
    if (token?.kind !== 'open' || token.name !== name || token.selfClose) return null;
    const attributes = attributesOf(token.attributes);
    if (!attributes || Object.keys(attributes).some((key) => !allowed.includes(key))) return null;
    this.at++;
    return attributes;
  }
  close(name: string): boolean {
    const token = this.peek();
    if (token?.kind !== 'close' || token.name !== name) return false;
    this.at++;
    return true;
  }
  /** The text up to the next tag, as written. */
  text(): string {
    const token = this.peek();
    if (token?.kind !== 'text') return '';
    this.at++;
    return token.text;
  }
}

/** Content between two tags, tags and all, up to the closing tag `name` of the same depth. */
function innerOf(source: string, name: string): string | null {
  const close = new RegExp(`</${name}\\s*>\\s*$`, 'i').exec(source);
  const open = new RegExp(`^\\s*<${name}(?:\\s[^<>]*)?>`, 'i').exec(source);
  if (!close || !open || open[0].length > close.index) return null;
  return source.slice(open[0].length, close.index);
}

function heading(source: string, level: number): Twinned {
  const name = `h${level}`;
  if (!new RegExp(`^<${name}>`, 'i').test(source)) return notExact(`<${name}> heading`);
  const inner = innerOf(source, name);
  const text = inner === null ? null : inlineOf(inner, { lead: true, allowEmpty: false });
  if (text === null) return notExact(`<${name}> heading`);
  return { twin: { markdown: `${'#'.repeat(level)} ${text}`, what: `<${name}> heading` } };
}

function rule(source: string, place: TwinPlace): Twinned {
  if (!/^<hr\s*\/?>$/i.test(source)) return notExact('rule');
  // Under a line of text, `---` would make that line a heading.
  return { twin: { markdown: place.afterText ? '***' : '---', what: '<hr> rule' } };
}

const ENTITY_FREE = /&(?!(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});)/;

function pre(source: string): Twinned {
  const found = /^<pre><code>([^]*)<\/code><\/pre>$/i.exec(source);
  if (!found) return notExact('code block');
  const body = found[1] as string;
  // Anything else than the five entities of a code's text would be shown as the markup it is.
  if (/</.test(body) || ENTITY_FREE.test(body)) return notExact('code block');
  if (/&(?!amp;|lt;|gt;|quot;|#39;)/.test(body)) return notExact('code block');
  if (body.endsWith('\n') || body.includes('\r') || /<!--/.test(body))
    return notExact('code block');
  const code = body
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  if (code === '') return notExact('code block');
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  // A fence's own line can't have an info string made of the code's first line, which is on the
  // next line: nothing to guard. Code that begins with a blank line keeps it.
  return { twin: { markdown: `${fence}\n${code}\n${fence}`, what: 'code block' } };
}

function blockquote(source: string): Twinned {
  const inner = innerOf(source, 'blockquote');
  if (inner === null || !/^<blockquote>/i.test(source)) return notExact('quote');
  const paragraphs = /^\s*<p>/i.test(inner);
  const parts: string[] = [];
  if (paragraphs) {
    const pattern = /<p>([^]*?)<\/p>/gi;
    let match: RegExpExecArray | null;
    let consumed = 0;
    while ((match = pattern.exec(inner)) !== null) {
      if (inner.slice(consumed, match.index).trim() !== '') return notExact('quote');
      const line = inlineOf(match[1] as string, { lead: true, allowEmpty: false });
      if (line === null) return notExact('quote');
      parts.push(`> ${line}`);
      consumed = match.index + match[0].length;
    }
    if (inner.slice(consumed).trim() !== '' || parts.length === 0) return notExact('quote');
    return { twin: { markdown: parts.join('\n>\n'), what: 'quote' } };
  }
  const lines = inner
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return notExact('quote');
  for (const line of lines) {
    const text = inlineOf(line, { lead: true, allowEmpty: false });
    if (text === null) return notExact('quote');
    parts.push(`> ${text}`);
  }
  return { twin: { markdown: parts.join('\n'), what: 'quote' } };
}

/** The items of a list at the reader's place, as lines of Markdown, or null. */
function listLines(reader: Reader, indent: string): string[] | null {
  const ordered =
    reader.peek()?.kind === 'open' && (reader.peek() as { name: string }).name === 'ol';
  const name = ordered ? 'ol' : 'ul';
  const attributes = reader.open(name, ordered ? ['start'] : []);
  if (!attributes) return null;
  let number = 1;
  if (ordered && attributes['start'] !== undefined) {
    if (!/^\d{1,8}$/.test(attributes['start'])) return null;
    number = Number(attributes['start']);
  }
  const lines: string[] = [];
  let items = 0;
  while (reader.open('li')) {
    const marker = ordered ? `${number + items}. ` : '- ';
    const first = reader.text();
    const text = inlineOf(first, { lead: true, allowEmpty: false });
    if (text === null) return null;
    lines.push(`${indent}${marker}${text}`);
    const next = reader.peek();
    if (next?.kind === 'open' && (next.name === 'ul' || next.name === 'ol')) {
      const nested = listLines(reader, indent + ' '.repeat(marker.length));
      // A numbered list under a line of text is a list only when it starts with 1.
      if (!nested || !/^\s*(?:-|1\.) /.test(nested[0] as string)) return null;
      lines.push(...nested);
    }
    if (!reader.close('li')) return null;
    items++;
  }
  if (items === 0 || !reader.close(name)) return null;
  return lines;
}

function list(source: string, place: TwinPlace): Twinned {
  const ordered = /^<ol[\s>]/i.test(source);
  // Inline tags in an item are read by position: tokens keep each item's text with its tags, so
  // an item is read from the source between its `<li>` and the next tag that is not inline.
  const lines = readList(source);
  if (!lines) return notExact('list');
  // A numbered list that doesn't start with 1 can't interrupt a line of text.
  if (ordered && place.afterText && !lines[0]?.startsWith('1. ')) {
    return reason('Put a blank line above this list first, so that Markdown reads it as a list.');
  }
  return {
    twin: { markdown: lines.join('\n'), what: ordered ? 'numbered list' : 'bulleted list' },
  };
}

/**
 * A list's lines. Items hold inline HTML (tags among their text), so the source is cut into the
 * list's own tags (`ul`, `ol`, `li`) and the text between them, which keeps each item's text whole.
 */
function readList(source: string): string[] | null {
  const tokens: Token[] = [];
  const pattern = /<(\/?)(ul|ol|li)((?:\s[^<>]*)?)>/gi;
  let at = 0;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(source)) !== null) {
    if (found.index > at) tokens.push({ kind: 'text', text: source.slice(at, found.index) });
    const name = (found[2] as string).toLowerCase();
    if (found[1]) tokens.push({ kind: 'close', name });
    else tokens.push({ kind: 'open', name, attributes: found[3] as string, selfClose: false });
    at = found.index + found[0].length;
  }
  if (at < source.length) tokens.push({ kind: 'text', text: source.slice(at) });
  const reader = new Reader(squeeze(tokens));
  const lines = listLines(reader, '');
  return lines && reader.done() ? lines : null;
}

interface Cell {
  tag: 'th' | 'td';
  align: string;
  text: string;
}

const ALIGNS = new Set(['left', 'right', 'center']);

function table(source: string, place: TwinPlace): Twinned {
  if (/<(?:caption|tfoot|colgroup|col)[\s>/]/i.test(source)) return notExact('table');
  const tokens: Token[] = [];
  const pattern = /<(\/?)(table|thead|tbody|tr|th|td)((?:\s[^<>]*)?)>/gi;
  let at = 0;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(source)) !== null) {
    if (found.index > at) tokens.push({ kind: 'text', text: source.slice(at, found.index) });
    const name = (found[2] as string).toLowerCase();
    if (found[1]) tokens.push({ kind: 'close', name });
    else tokens.push({ kind: 'open', name, attributes: found[3] as string, selfClose: false });
    at = found.index + found[0].length;
  }
  if (at < source.length) tokens.push({ kind: 'text', text: source.slice(at) });
  // Cell text is read whole, tags and all: a cell's tokens are folded into one text.
  const reader = new Reader(tokens);
  const skipSpace = () => {
    const token = reader.peek();
    if (token?.kind === 'text' && token.text.trim() === '') reader.at++;
  };
  const rows: Cell[][] = [];
  const bad = notExact('table');
  skipSpace();
  if (!reader.open('table')) return bad;
  skipSpace();
  let grouped = 0;
  const readRows = (group: string | null): boolean => {
    skipSpace();
    while (reader.open('tr')) {
      const row: Cell[] = [];
      skipSpace();
      for (;;) {
        const token = reader.peek();
        if (token?.kind !== 'open' || (token.name !== 'th' && token.name !== 'td')) break;
        const tag = token.name;
        const attributes = reader.open(tag, ['align']);
        if (!attributes) return false;
        const align = attributes['align']?.toLowerCase() ?? '';
        if (align !== '' && !ALIGNS.has(align)) return false;
        const content = reader.text();
        const cell = inlineOf(content, { lead: false, allowEmpty: true });
        if (cell === null || !reader.close(tag)) return false;
        row.push({ tag, align, text: cell });
        skipSpace();
      }
      if (row.length === 0 || !reader.close('tr')) return false;
      rows.push(row);
      skipSpace();
    }
    return group === null || reader.close(group);
  };
  for (;;) {
    skipSpace();
    const token = reader.peek();
    if (token?.kind === 'open' && (token.name === 'thead' || token.name === 'tbody')) {
      const group = token.name;
      if (!reader.open(group) || !readRows(group)) return bad;
      grouped++;
    } else if (token?.kind === 'open' && token.name === 'tr') {
      if (grouped > 0 || !readRows(null)) return bad;
    } else break;
  }
  skipSpace();
  if (!reader.close('table')) return bad;
  skipSpace();
  if (!reader.done() || rows.length === 0) return bad;
  const [head, ...body] = rows as [Cell[], ...Cell[][]];
  const width = head.length;
  if (!head.every((cell) => cell.tag === 'th')) return bad;
  if (!body.every((row) => row.length === width && row.every((cell) => cell.tag === 'td'))) {
    return bad;
  }
  const aligns = head.map((cell, i) => {
    const same = body.every((row) => (row[i] as Cell).align === cell.align);
    return same ? cell.align : null;
  });
  if (aligns.includes(null)) return bad;
  // The header row of a table can't be the line under a line of text.
  if (place.afterText) {
    return reason('Put a blank line above this table first, so that Markdown reads it as a table.');
  }
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`.replace(/ {2}/g, ' ');
  const markdown = [
    line(head.map((cell) => cell.text)),
    line(
      aligns.map((align) =>
        align === 'center'
          ? ':---:'
          : align === 'left'
            ? ':---'
            : align === 'right'
              ? '---:'
              : '---',
      ),
    ),
    ...body.map((row) => line(row.map((cell) => cell.text))),
  ].join('\n');
  return { twin: { markdown, what: 'table' } };
}

/** The tags of an HTML block that have a twin of some shape. */
const NAME = /^<(h[1-6]|blockquote|ul|ol|table|hr|pre)(?=[\s>/])/i;

/**
 * The Markdown twin of an HTML block's source, as the block's lines (from the start of its first
 * line to the end of its last), or why it has none. Source that isn't HTML of a shape with a twin
 * gets the general reason.
 */
export function htmlTwin(block: string, place: TwinPlace = {}): TwinRead {
  const source = block.replace(/^ {0,3}/, '').trimEnd();
  const name = NAME.exec(source)?.[1]?.toLowerCase();
  if (!name || /\r/.test(source)) return reason(NO_TWIN);
  if (/<!--|-->/.test(source)) {
    return reason(
      'This HTML holds the marks of a change. Accept or reject it first, then it can be changed as Markdown.',
    );
  }
  let kind: TwinKind;
  let read: Twinned;
  if (/^h[1-6]$/.test(name)) {
    kind = 'heading';
    read = heading(source, Number(name[1]));
  } else if (name === 'hr') {
    kind = 'rule';
    read = rule(source, place);
  } else if (name === 'pre') {
    kind = 'code';
    read = pre(source);
  } else if (name === 'blockquote') {
    kind = 'quote';
    read = blockquote(source);
  } else if (name === 'ul' || name === 'ol') {
    kind = 'list';
    read = list(source, place);
  } else {
    kind = 'table';
    read = table(source, place);
  }
  return 'twin' in read ? { twin: { ...read.twin, kind } } : { reason: read.reason, kind };
}
