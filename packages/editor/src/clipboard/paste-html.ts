// Pasted HTML as Markdown (design §5.10, docs/research/paste.md): Google Docs, web pages, Mail,
// Pages and Word. The page is read whole, then its formatting, whether set by tags or by CSS, is
// turned into Markdown in one consistent style: ATX headings, `-` bullets, `*` emphasis, fenced
// code, pipe tables with the first row as the header. Escapes are kept to what would otherwise
// change the meaning.
//
// Nothing in the clipboard's HTML can become Redlines markup. Every comment is dropped, and the
// text that reads like a marker (`<!--ins k3x9-->`) comes out with its `<` written as `&lt;`, so
// that it reads as text, never as a comment.

import { GFM, parser } from '@lezer/markdown';
import { readRowCells } from '@redlines/format';

/** What formats a run of text. */
interface Format {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  sup: boolean;
  sub: boolean;
  code: boolean;
  href: string;
}

const PLAIN: Format = {
  bold: false,
  italic: false,
  strike: false,
  sup: false,
  sub: false,
  code: false,
  href: '',
};

type Run =
  | { type: 'text'; text: string; format: Format }
  | { type: 'image'; src: string; alt: string; href: string }
  | { type: 'break' };

/** Where a conversion is: in a table cell, which has one line, or stripping the bold of a header. */
interface Context {
  cell: boolean;
  noBold: boolean;
}

const SKIPPED = new Set([
  'script',
  'style',
  'meta',
  'link',
  'head',
  'title',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'button',
  'select',
  'textarea',
  'audio',
  'video',
  'canvas',
  'xml',
]);

const BLOCKS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'nav',
  'aside',
  'figure',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'blockquote',
  'pre',
  'table',
  'hr',
  'form',
  'fieldset',
  'details',
  'summary',
  'address',
  'center',
  'body',
  'tr',
  'thead',
  'tbody',
  'tfoot',
  'caption',
]);

const BLOCK_SELECTOR = [...BLOCKS].join(',');
const MONOSPACE = /courier|consolas|monaco|menlo|monospace|cousine|lucida console|source code/i;
const UNSAFE = /^\s*(?:javascript|vbscript|data):/i;
const HIDDEN = /display\s*:\s*none|visibility\s*:\s*hidden/i;
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/g;

const isElement = (node: Node): node is Element => node.nodeType === 1;
const isText = (node: Node): node is Text => node.nodeType === 3;

/** An element's inline style as property and value. */
function css(el: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (const declaration of (el.getAttribute('style') ?? '').split(';')) {
    const at = declaration.indexOf(':');
    if (at > 0)
      map.set(
        declaration.slice(0, at).trim().toLowerCase(),
        declaration
          .slice(at + 1)
          .trim()
          .toLowerCase(),
      );
  }
  return map;
}

/** The five types of GitHub's alerts, which the callouts of other pages are read as. */
const GITHUB_ALERTS = new Set(['note', 'tip', 'important', 'warning', 'caution']);

/** Sphinx's admonitions, by their class, as the nearest of GitHub's types. */
const ADMONITIONS = new Map([
  ['note', 'NOTE'],
  ['seealso', 'NOTE'],
  ['tip', 'TIP'],
  ['hint', 'TIP'],
  ['important', 'IMPORTANT'],
  ['warning', 'WARNING'],
  ['attention', 'WARNING'],
  ['caution', 'CAUTION'],
  ['danger', 'CAUTION'],
  ['error', 'CAUTION'],
]);

/** MDN's notes, by their class. Its other cards (deprecated, experimental, …) are no alert. */
const NOTE_CARDS = new Map([
  ['note', 'NOTE'],
  ['warning', 'WARNING'],
]);

/** A callout of a web page that is an alert (docs/research/paste.md): GitHub's own, Sphinx's
 * admonition, MDN's note card. `kind` is the word the page's class gives it, which its title says too
 * when the page wrote no title of its own; `titleClass` is the class of that title's paragraph. */
interface WebAlert {
  type: string;
  kind: string;
  titleClass: string | null;
  /** MDN writes the title in bold at the start of the first paragraph, `Note:`. */
  label: boolean;
}

function webAlert(el: Element): WebAlert | null {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/);
  const find = <T>(read: (name: string) => T | undefined): T | undefined =>
    classes.map(read).find((found) => found !== undefined);
  if (classes.includes('markdown-alert')) {
    const kind = find((name) => {
      const word = /^markdown-alert-(\w+)$/.exec(name)?.[1];
      return word !== undefined && GITHUB_ALERTS.has(word) ? word : undefined;
    });
    return kind
      ? { type: kind.toUpperCase(), kind, titleClass: 'markdown-alert-title', label: false }
      : null;
  }
  if (classes.includes('admonition')) {
    const kind = find((name) => (ADMONITIONS.has(name) ? name : undefined));
    return kind
      ? { type: ADMONITIONS.get(kind)!, kind, titleClass: 'admonition-title', label: false }
      : null;
  }
  if (classes.includes('notecard')) {
    const kind = find((name) => (NOTE_CARDS.has(name) ? name : undefined));
    return kind ? { type: NOTE_CARDS.get(kind)!, kind, titleClass: null, label: true } : null;
  }
  return null;
}

function hidden(el: Element): boolean {
  return (
    SKIPPED.has(el.tagName.toLowerCase()) ||
    el.hasAttribute('hidden') ||
    el.getAttribute('aria-hidden') === 'true' ||
    HIDDEN.test(el.getAttribute('style') ?? '')
  );
}

/** A link's address, or nothing for one that isn't one: Google's redirects are followed. */
function address(href: string | null): string {
  const value = (href ?? '').trim();
  if (!value || UNSAFE.test(value)) return '';
  try {
    const url = new URL(value);
    const target = url.searchParams.get('q');
    if (/(?:^|\.)google\.com$/.test(url.hostname) && url.pathname === '/url' && target) {
      return UNSAFE.test(target) ? '' : target;
    }
  } catch {
    // A relative address is kept as it is.
  }
  return value;
}

/** The format of an element, given its parent's: tags set it, and CSS overrides the tag. */
function formatOf(el: Element, parent: Format): Format {
  const tag = el.tagName.toLowerCase();
  const style = css(el);
  const format = { ...parent };
  const weight = style.get('font-weight');
  if (weight) format.bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
  else if (tag === 'b' || tag === 'strong') format.bold = true;
  const slant = style.get('font-style');
  if (slant) format.italic = slant === 'italic' || slant === 'oblique';
  else if (tag === 'i' || tag === 'em') format.italic = true;
  const decoration = `${style.get('text-decoration') ?? ''} ${style.get('text-decoration-line') ?? ''}`;
  if (tag === 's' || tag === 'del' || tag === 'strike' || decoration.includes('line-through')) {
    format.strike = true;
  }
  const align = style.get('vertical-align');
  if (tag === 'sup' || align === 'super') format.sup = true;
  if (tag === 'sub' || align === 'sub') format.sub = true;
  const family = style.get('font-family');
  const codeTag = ['code', 'kbd', 'samp', 'tt'].includes(tag);
  if (family) {
    // A font that isn't monospace turns code off, unless the tag says it is code.
    if ((MONOSPACE.test(family) && !BLOCKS.has(tag)) || codeTag) format.code = true;
    else format.code = false;
  } else if (codeTag) format.code = true;
  if (tag === 'a') format.href = address(el.getAttribute('href')) || parent.href;
  return format;
}

/** The runs of text, images and breaks under `node`. */
function collect(node: Node, format: Format, runs: Run[]): void {
  if (isText(node)) {
    const raw = (node.nodeValue ?? '').replace(INVISIBLE, '');
    const text = format.code
      ? raw.replace(/\s+/g, ' ')
      : raw.replace(/\u00a0/g, ' ').replace(/[ \t\r\n\f]+/g, ' ');
    if (text) runs.push({ type: 'text', text, format });
    return;
  }
  if (!isElement(node) || hidden(node)) return;
  const tag = node.tagName.toLowerCase();
  if (tag === 'br') {
    runs.push({ type: 'break' });
    return;
  }
  if (tag === 'img') {
    const lazy = node.getAttribute('data-src') ?? node.getAttribute('data-original') ?? '';
    const src = (node.getAttribute('src') ?? '').startsWith('data:')
      ? lazy
      : (node.getAttribute('src') ?? lazy);
    if (src && !UNSAFE.test(src)) {
      runs.push({
        type: 'image',
        src: src.trim(),
        alt: node.getAttribute('alt') ?? '',
        href: format.href,
      });
    }
    return;
  }
  if (tag === 'a' && /^[¶#§]?$/.test((node.textContent ?? '').trim()) && !node.querySelector('img'))
    return;
  const own = formatOf(node, format);
  for (const child of Array.from(node.childNodes)) collect(child, own, runs);
}

const sameStyle = (a: Format, b: Format) =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.strike === b.strike &&
  a.sup === b.sup &&
  a.sub === b.sub &&
  a.code === b.code &&
  a.href === b.href;

/** Text with the characters that would change its meaning escaped, and no more. */
function escapeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const prev = text[i - 1];
    const next = text[i + 1];
    if (c === '\\') out += next === undefined || /[!-/:-@[-`{-~]/.test(next) ? '\\\\' : c;
    else if (c === '`' || c === '[' || c === ']') out += `\\${c}`;
    else if (c === '*') out += prev === ' ' && next === ' ' ? c : '\\*';
    else if (c === '_') {
      const word = prev !== undefined && next !== undefined && /\w/.test(prev) && /\w/.test(next);
      out += word || (prev === ' ' && next === ' ') ? c : '\\_';
    } else if (c === '<') {
      // `<!` and `<?` start comments and instructions: written as an entity, so that no comment,
      // and no Redlines marker, can be in the text.
      out +=
        next === '!' || next === '?'
          ? '&lt;'
          : next === undefined || /[A-Za-z/]/.test(next)
            ? '\\<'
            : c;
    } else if (c === '&')
      out += /^&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i.test(text.slice(i)) ? '&amp;' : c;
    else if (c === '~') out += prev === '~' || next === '~' ? '\\~' : c;
    else out += c;
  }
  return out;
}

/** A line that would start a block when it is text, escaped so that it doesn't. */
function guardLines(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
        .replace(/^>/, '\\>')
        .replace(/^([-+])(?=\s|$)/, '\\$1')
        .replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
        .replace(/^(?=[-=_*]+\s*$)([-=_*])/, '\\$1')
        .replace(/^(\s*)(~~~)/, '$1\\~~'),
    )
    .join('\n');
}

const MARKERS = {
  strike: ['~~', '~~'],
  bold: ['**', '**'],
  italic: ['*', '*'],
  sup: ['<sup>', '</sup>'],
  sub: ['<sub>', '</sub>'],
} as const;
type Flag = keyof typeof MARKERS;
const FLAGS = Object.keys(MARKERS) as Flag[];

type Item =
  | { type: 'space' }
  | { type: 'text'; text: string; format: Format; space?: boolean }
  | { type: 'image'; src: string; alt: string; href: string }
  | { type: 'raw'; text: string }
  | { type: 'break' };

const hrefOf = (item: Item | undefined) =>
  item?.type === 'text' ? item.format.href : item?.type === 'image' ? item.href : '';

/** Runs as items: spaces apart from the text beside them, and spaces that mean nothing gone. */
function itemsOf(runs: Run[], noBold: boolean): Item[] {
  const items: Item[] = [];
  for (const run of runs) {
    if (run.type !== 'text') {
      items.push(run);
      continue;
    }
    const format = noBold ? { ...run.format, bold: false } : run.format;
    const match = /^( *)(.*?)( *)$/s.exec(run.text)!;
    if (match[1]) items.push({ type: 'space' });
    if (match[2]) items.push({ type: 'text', text: match[2], format });
    if (match[3]) items.push({ type: 'space' });
  }
  // One space between things, none at the ends or beside a break.
  const tidy: Item[] = [];
  for (const item of items) {
    const last = tidy[tidy.length - 1];
    if (item.type === 'space' && (!last || last.type === 'space' || last.type === 'break'))
      continue;
    if (last?.type === 'space' && item.type === 'break') tidy.pop();
    tidy.push(item);
  }
  while (tidy[tidy.length - 1]?.type === 'space') tidy.pop();
  return tidy;
}

/** The flags two formats share, which a space between them takes. */
function shared(a: Item | undefined, b: Item | undefined): Format {
  if (a?.type !== 'text' || b?.type !== 'text') return PLAIN;
  const x = a.format;
  const y = b.format;
  return {
    ...PLAIN,
    bold: x.bold && y.bold,
    italic: x.italic && y.italic,
    strike: x.strike && y.strike,
    sup: x.sup && y.sup,
    sub: x.sub && y.sub,
    href: x.href === y.href ? x.href : '',
  };
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return longest || /^ | $/.test(text) ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

const PUNCTUATION = /[\p{P}\p{S}]/u;
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isPunctuation = (c: string | undefined) => c !== undefined && PUNCTUATION.test(c);

/** The first and last character an item writes, as far as emphasis next to it can tell. */
function edge(item: Item | undefined, last: boolean): string | undefined {
  if (!item || item.type === 'break' || item.type === 'space') return undefined;
  if (item.type === 'image') return last ? ')' : '!';
  if (item.type === 'raw') return last ? '>' : '<';
  if (item.format.code) return '`';
  return item.text[last ? item.text.length - 1 : 0];
}

/** Whether emphasis markers can open before `next` after `prev`, and close after `prev` before `next`. */
const canOpen = (prev: string | undefined, next: string | undefined) =>
  !isSpace(next) && (!isPunctuation(next) || isSpace(prev) || isPunctuation(prev));
const canClose = (prev: string | undefined, next: string | undefined) =>
  !isSpace(prev) && (!isPunctuation(prev) || isSpace(next) || isPunctuation(next));

const EMPHASIS = ['strike', 'bold', 'italic'] as const;

/** Items without the emphasis whose markers CommonMark would show as text where they stand. */
function checkEmphasis(items: Item[]): Item[] {
  const out = [...items];
  for (const flag of EMPHASIS) {
    const on = (item: Item | undefined) => item?.type === 'text' && item.format[flag];
    for (let i = 0; i < out.length;) {
      if (!on(out[i])) {
        i++;
        continue;
      }
      let end = i;
      while (on(out[end])) end++;
      const fits =
        canOpen(edge(out[i - 1], true), edge(out[i], false)) &&
        canClose(edge(out[end - 1], true), edge(out[end], false));
      if (!fits) {
        for (let k = i; k < end; k++) {
          const item = out[k];
          if (item?.type === 'text')
            out[k] = { ...item, format: { ...item.format, [flag]: false } };
        }
      }
      i = end;
    }
  }
  return out;
}

/** What opens and closes around items: a format, or a link to an address. */
const isLink = (key: string) => key.startsWith('link:');
const opening = (key: string) => (isLink(key) ? '[' : MARKERS[key as Flag][0]);
const closing = (key: string) =>
  isLink(key) ? `](${encodeUrl(key.slice(5))})` : MARKERS[key as Flag][1];

function keysOf(item: Item): string[] {
  if (item.type === 'break' || item.type === 'raw' || item.type === 'space') return [];
  const keys: string[] = item.type === 'text' ? FLAGS.filter((flag) => item.format[flag]) : [];
  const href = hrefOf(item);
  if (href) keys.push(`link:${href}`);
  return keys;
}

/** Items as Markdown: formats and links open and close around them, in one nesting. */
function emitItems(items: Item[]): string {
  // Spaces take what their neighbors share, so that they stay inside a link and its formatting.
  const formatted = checkEmphasis(
    items.map((item, i): Item =>
      item.type === 'space'
        ? { type: 'text', text: ' ', format: shared(items[i - 1], items[i + 1]), space: true }
        : item,
    ),
  );
  // Adjacent text with one format is one run.
  const merged: Item[] = [];
  for (const item of formatted) {
    const last = merged[merged.length - 1];
    if (
      item.type === 'text' &&
      last?.type === 'text' &&
      !item.space &&
      !last.space &&
      sameStyle(last.format, item.format)
    ) {
      merged[merged.length - 1] = { ...last, text: last.text + item.text };
    } else merged.push(item);
  }
  // A link whose text is its address is that address in angle brackets.
  for (let i = 0; i < merged.length; i++) {
    const item = merged[i]!;
    if (
      item.type === 'text' &&
      item.format.href === item.text &&
      keysOf(item).length === 1 &&
      !item.format.code &&
      encodeUrl(item.text) === item.text &&
      hrefOf(merged[i - 1]) !== item.text &&
      hrefOf(merged[i + 1]) !== item.text
    ) {
      merged[i] = { type: 'raw', text: `<${item.text}>` };
    }
  }
  const extent = (from: number, key: string) => {
    let n = 0;
    while (merged[from + n] && keysOf(merged[from + n]!).includes(key)) n++;
    return n;
  };
  const stack: string[] = [];
  let out = '';
  const closeTo = (n: number) => {
    while (stack.length > n) out += closing(stack.pop()!);
  };
  merged.forEach((item, i) => {
    let wanted = keysOf(item);
    if (item.type === 'text' && item.space) {
      // A space opens nothing and keeps only what is open, outermost first, that it shares.
      const cut = stack.findIndex((key) => !wanted.includes(key));
      wanted = cut < 0 ? [...stack] : stack.slice(0, cut);
    }
    const broken = stack.findIndex((key) => !wanted.includes(key));
    const reopen = broken < 0 ? [] : stack.slice(broken).filter((key) => wanted.includes(key));
    if (broken >= 0) closeTo(broken);
    // What lasts longest goes outside; a link before a format when they last as long.
    const fresh = wanted
      .filter((key) => !stack.includes(key) && !reopen.includes(key))
      .sort((a, b) => extent(i, b) - extent(i, a) || Number(isLink(b)) - Number(isLink(a)));
    for (const key of [...reopen, ...fresh]) {
      stack.push(key);
      out += opening(key);
    }
    if (item.type === 'break') out += '\\\n';
    else if (item.type === 'raw') out += item.text;
    else if (item.type === 'text')
      out += item.format.code ? codeSpan(item.text) : escapeText(item.text);
    else if (item.type === 'image') {
      const alt = escapeText(item.alt.replace(/\s+/g, ' ').trim());
      out += `![${alt}](${encodeUrl(item.src)})`;
    }
  });
  closeTo(0);
  return out;
}

/** An address as it may stand in a link: nothing in it can end the link or start markup. */
function encodeUrl(url: string): string {
  const bytes = new TextEncoder();
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is encoded
  return url.replace(/[\s<>()\\"`\u0000-\u001f\u007f]/g, (c) =>
    Array.from(bytes.encode(c), (b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(
      '',
    ),
  );
}

/** Runs as inline Markdown. */
function inline(runs: Run[], noBold: boolean, guard = true): string {
  const text = emitItems(itemsOf(runs, noBold));
  return guard ? guardLines(text) : text;
}

/** The paragraphs of a block's runs: two breaks in a row, or a break at an end, are not hard breaks. */
function paragraphsOf(runs: Run[]): Run[][] {
  const groups: Run[][] = [[]];
  let breaks = 0;
  for (const run of runs) {
    const blank = run.type === 'text' && !run.text.trim();
    if (run.type === 'break') {
      breaks++;
      continue;
    }
    if (blank) {
      groups[groups.length - 1]!.push(run);
      continue;
    }
    const group = groups[groups.length - 1]!;
    if (
      breaks >= 2 &&
      group.some((r) => r.type !== 'break' && !(r.type === 'text' && !r.text.trim()))
    ) {
      groups.push([run]);
    } else {
      // A single break between things stays, and a break at the start is dropped.
      if (breaks === 1 && group.some((r) => r.type !== 'text' || r.text.trim()))
        group.push({ type: 'break' });
      group.push(run);
    }
    breaks = 0;
  }
  return groups;
}

/**
 * Whether a block is code by its own style, as an editor's copy is: its text keeps its spaces, or
 * is monospace and holds nothing but lines.
 */
function codeBlockStyle(el: Element, tag: string): boolean {
  if (!['div', 'p', 'section', 'article', 'main'].includes(tag)) return false;
  const style = css(el);
  const pre = /^(?:pre|pre-wrap|break-spaces)$/.test(style.get('white-space') ?? '');
  const family = style.get('font-family');
  const mono = !!family && MONOSPACE.test(family);
  // A font that isn't monospace makes preserved lines prose, as a chat app's are.
  if (pre && family && !mono) return false;
  if (!pre && !mono) return false;
  // Both signals are an editor's: the styling of its spans is highlighting, not meaning.
  return onlyLines(el, pre && mono);
}

/** Whether `el` holds text, breaks, and spans and divs with no formatting meaning: lines of code. */
function onlyLines(el: Element, highlighted: boolean): boolean {
  return Array.from(el.children).every((child) => {
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') return true;
    if (tag !== 'span' && tag !== 'div') return false;
    if (highlighted) return onlyLines(child, true);
    const style = css(child);
    const weight = style.get('font-weight');
    const meaning =
      (weight && (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600)) ||
      /italic|oblique/.test(style.get('font-style') ?? '') ||
      /underline|line-through/.test(
        `${style.get('text-decoration') ?? ''}${style.get('text-decoration-line') ?? ''}`,
      ) ||
      /super|sub/.test(style.get('vertical-align') ?? '');
    const font = style.get('font-family');
    return !meaning && (!font || MONOSPACE.test(font)) && onlyLines(child, false);
  });
}

/** A paragraph Word makes a list item of: its list, its level, and the marker it draws. */
interface WordItem {
  list: string;
  level: number;
  marker: string;
}

const markerSpans = (el: Element) =>
  Array.from(el.querySelectorAll('[style]')).filter((s) => css(s).get('mso-list') === 'ignore');

/** The list a Word paragraph belongs to (`mso-list:l0 level2 lfo1`), or nothing for other blocks. */
function wordItem(el: Element): WordItem | null {
  if (el.tagName.toLowerCase() !== 'p') return null;
  const spans = markerSpans(el);
  const value = css(el).get('mso-list') ?? '';
  const level = /\blevel(\d+)\b/.exec(value)?.[1];
  const named = /(?:^|\s)MsoListParagraph/.test(el.getAttribute('class') ?? '') && spans.length > 0;
  if (!level && !named) return null;
  return {
    list: /^l\d+/.exec(value)?.[0] ?? 'l0',
    level: Math.max(1, Number.parseInt(level ?? '1', 10) || 1),
    marker: (spans[0]?.textContent ?? '').replace(/[\s\u00a0]+/g, ''),
  };
}

/** What a Word marker says: a bullet (Symbol, Wingdings and Courier glyphs), or a number. */
function wordMarker(marker: string): { ordered: boolean; start: number } {
  const match = /^\(?([0-9]+|[a-zA-Z]+)[.)]$/.exec(marker);
  if (!match) return { ordered: false, start: 1 };
  const label = match[1]!;
  if (/^\d+$/.test(label)) return { ordered: true, start: Number.parseInt(label, 10) };
  // A single letter counts from a; `i` and its kin are Roman numerals, which start at 1.
  const letter = label.length === 1 && !/^[ivxlcdmIVXLCDM]$/.test(label);
  return { ordered: true, start: letter ? label.toLowerCase().charCodeAt(0) - 96 : 1 };
}

interface WordList {
  id: string;
  ordered: boolean;
  start: number;
  items: { blocks: string[]; kids: WordList[] }[];
}

/** The lists being built from Word paragraphs in a row, and the list open at each level. */
interface WordLists {
  roots: WordList[];
  stack: { level: number; list: WordList }[];
}

/** Word's `Title` and `Heading N` styles, as the level of a heading. */
function wordHeading(el: Element): number {
  const classes = el.getAttribute('class') ?? '';
  if (/(?:^|\s)MsoTitle(?:\s|$)/.test(classes)) return 1;
  const match = /(?:^|\s)(?:Mso)?Heading\s?([1-6])(?:\s|$)/.exec(classes);
  return match ? Number(match[1]) : 0;
}

const hasBlock = (el: Element) => !!el.querySelector(BLOCK_SELECTOR);

class Converter {
  /** The blocks under `parent`, as Markdown. */
  blocks(parent: Element, format: Format, ctx: Context): string[] {
    const out: string[] = [];
    let pending: Run[] = [];
    // The Word list paragraphs in a row, and the lists open at each level.
    let word: WordLists | null = null;
    const endList = () => {
      if (word) for (const root of word.roots) out.push(this.wordList(root, ctx));
      word = null;
    };
    const flush = () => {
      for (const group of paragraphsOf(pending)) {
        const text = inline(group, ctx.noBold, !ctx.cell);
        if (text.trim()) out.push(ctx.cell ? text.replace(/\\\n/g, '<br>') : text);
      }
      pending = [];
    };
    for (const child of Array.from(parent.childNodes)) {
      if (isText(child)) {
        if (word && !(child.nodeValue ?? '').trim()) continue;
        endList();
        collect(child, format, pending);
        continue;
      }
      if (!isElement(child) || hidden(child)) continue;
      const tag = child.tagName.toLowerCase();
      const own = formatOf(child, format);
      const entry = wordItem(child);
      if (entry) {
        flush();
        word = this.wordEntry(word, child, entry, own, ctx);
        continue;
      }
      endList();
      if (codeBlockStyle(child, tag)) {
        flush();
        out.push(...this.pre(child, ctx));
        continue;
      }
      if (!BLOCKS.has(tag) && !hasBlock(child)) {
        collect(child, format, pending);
        continue;
      }
      flush();
      out.push(...this.block(child, tag, own, ctx));
    }
    endList();
    flush();
    return out;
  }

  /** Adds a Word list paragraph to the lists being built, nested by its level. */
  wordEntry(
    open: WordLists | null,
    p: Element,
    entry: WordItem,
    format: Format,
    ctx: Context,
  ): WordLists {
    const { ordered, start } = wordMarker(entry.marker);
    const made = (): WordList => ({ id: entry.list, ordered, start, items: [] });
    // The text is the paragraph without the marker Word draws.
    const copy = p.cloneNode(true) as Element;
    markerSpans(copy).forEach((span) => span.remove());
    const blocks = this.blocks(copy, format, ctx);
    const state: WordLists = open ?? { roots: [], stack: [] };
    const { stack } = state;
    // A list of another number at the top level is another list; deeper levels nest.
    const first = stack[0];
    if (first && entry.level <= first.level && first.list.id !== entry.list) stack.length = 0;
    while (stack.length > 1 && stack[stack.length - 1]!.level > entry.level) stack.pop();
    if (!stack.length) {
      const list = made();
      state.roots.push(list);
      stack.push({ level: entry.level, list });
    }
    const top = stack[stack.length - 1]!;
    if (top.level < entry.level) {
      // A level below the last item opens inside it (or inside an empty item, if there is none).
      const list = made();
      const parent = top.list.items[top.list.items.length - 1];
      if (parent) parent.kids.push(list);
      else top.list.items.push({ blocks: [], kids: [list] });
      stack.push({ level: entry.level, list });
    }
    stack[stack.length - 1]!.list.items.push({ blocks, kids: [] });
    return state;
  }

  wordList(list: WordList, ctx: Context): string {
    const lines = list.items.map((item, i) => {
      const kids = item.kids.map((kid) => this.wordList(kid, ctx));
      if (ctx.cell) return [...item.blocks.map((b) => `• ${b}`), ...kids].join('\n');
      const marker = list.ordered ? `${list.start + i}. ` : '- ';
      const body = [...item.blocks, ...kids].join(item.blocks.length > 1 ? '\n\n' : '\n');
      return body
        .split('\n')
        .map((line, j) =>
          j === 0 ? marker + line : line ? ' '.repeat(marker.length) + line : line,
        )
        .join('\n');
    });
    return lines.join('\n');
  }

  block(el: Element, tag: string, format: Format, ctx: Context): string[] {
    const alert = this.alert(el, format, ctx);
    if (alert) return [alert];
    const level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : tag === 'p' ? wordHeading(el) : 0;
    if (level) {
      const runs: Run[] = [];
      collect(el, { ...format, bold: false }, runs);
      const flat = runs.map((run): Run =>
        run.type === 'break' ? { type: 'text', text: ' ', format } : run,
      );
      const text = inline(flat, true, false).replace(/\n/g, ' ').trim();
      return text ? [`${'#'.repeat(level)} ${text}`] : [];
    }
    switch (tag) {
      case 'ul':
      case 'ol':
        return [this.list(el, tag === 'ol', format, ctx)].filter(Boolean);
      case 'blockquote': {
        const inner = this.blocks(el, format, ctx).join('\n\n');
        return inner
          ? [
              inner
                .split('\n')
                .map((line) => (line ? `> ${line}` : '>'))
                .join('\n'),
            ]
          : [];
      }
      case 'pre':
        return this.pre(el, ctx);
      case 'table':
        return this.table(el, format, ctx);
      case 'hr':
        return ['---'];
      case 'th':
      case 'td':
        return this.blocks(el, format, ctx);
      default:
        return this.blocks(el, format, ctx);
    }
  }

  /**
   * A callout of a web page as a GitHub alert, `> [!NOTE]` and the body quoted, or null where it is
   * none, or would be read as none here: GitHub reads an alert only at the left edge, not in a quote,
   * a list item or a table cell, and not without a body. A title the page wrote itself stays as the
   * first paragraph of the body: an alert has no title of its own.
   */
  alert(el: Element, format: Format, ctx: Context): string | null {
    if (ctx.cell || el.parentElement?.closest('blockquote, li, dd, td, th')) return null;
    const found = webAlert(el);
    if (!found) return null;
    const copy = el.cloneNode(true) as Element;
    const title = Array.from(copy.children).find((child) =>
      found.titleClass ? child.classList.contains(found.titleClass) : false,
    );
    // The page's title is the type's name; one that says more is the author's, and stays.
    if (title && (title.textContent ?? '').replace(/\s+/g, '').toLowerCase() === found.kind) {
      title.remove();
    }
    const blocks = this.blocks(copy, format, ctx);
    if (found.label && blocks[0]) {
      blocks[0] = blocks[0].replace(/^\*\*(?:Note|Warning)(?::\*\*|\*\*:)\s*/i, '');
    }
    const body = blocks.filter(Boolean).join('\n\n').trim();
    if (!body) return null;
    const quoted = body.split('\n').map((line) => (line ? `> ${line}` : '>'));
    return [`> [!${found.type}]`, ...quoted].join('\n');
  }

  pre(el: Element, ctx: Context): string[] {
    let text = '';
    const walk = (node: Node) => {
      if (isText(node)) text += node.nodeValue ?? '';
      else if (isElement(node) && !hidden(node)) {
        const tag = node.tagName.toLowerCase();
        if (tag === 'br') text += '\n';
        else {
          const before = text.length;
          node.childNodes.forEach(walk);
          // The lines of an editor's copy are blocks, an empty one a blank line.
          if (node !== el && BLOCKS.has(tag) && (text.length === before || !text.endsWith('\n'))) {
            text += '\n';
          }
        }
      }
    };
    walk(el);
    text = text
      .replace(INVISIBLE, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/\n+$/, '');
    if (!text.trim()) return [];
    if (ctx.cell) return [codeSpan(text.replace(/\n/g, ' '))];
    const source = [el, ...Array.from(el.querySelectorAll('code'))];
    const lang =
      source
        .map(
          (node) =>
            /(?:^|\s)(?:language|lang|highlight-source)-([\w+#.-]+)/.exec(
              node.getAttribute('class') ?? '',
            )?.[1],
        )
        .find(Boolean) ??
      el.getAttribute('data-lang') ??
      '';
    const language = /^[\w+#.-]+$/.test(lang) ? lang : '';
    const fence = '`'.repeat(
      Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)),
    );
    return [`${fence}${language}\n${text}\n${fence}`];
  }

  list(el: Element, ordered: boolean, format: Format, ctx: Context): string {
    const items: string[][] = [];
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'li') items.push(this.item(child, format, ctx));
      // Google Docs nests a list as a sibling of the item it belongs to.
      else if (tag === 'ul' || tag === 'ol') {
        const nested = this.list(child, tag === 'ol', formatOf(child, format), ctx);
        if (!nested) continue;
        const last = items[items.length - 1];
        if (last) last.push(nested);
        else items.push([nested]);
      }
    }
    const start = ordered ? Number.parseInt(el.getAttribute('start') ?? '1', 10) || 1 : 0;
    const lines = items.map((blocks, i) => {
      if (ctx.cell) return `• ${blocks.join(' ').replace(/\n/g, ' ')}`;
      const marker = ordered ? `${start + i}. ` : '- ';
      const body = blocks.some((block, j) => j > 0 && !/^(?:[-•]|\d+\.) /.test(block))
        ? blocks.join('\n\n')
        : blocks.join('\n');
      return body
        .split('\n')
        .map((line, j) =>
          j === 0 ? marker + line : line ? ' '.repeat(marker.length) + line : line,
        )
        .join('\n');
    });
    return lines.join('\n');
  }

  item(li: Element, format: Format, ctx: Context): string[] {
    const own = formatOf(li, format);
    const box = li.querySelector('input[type="checkbox" i]');
    const task =
      box && box.closest('li') === li ? (box.hasAttribute('checked') ? '[x] ' : '[ ] ') : '';
    const blocks = this.blocks(li, own, ctx);
    // A box drawn as a glyph, as a copy from Redlines writes it.
    const glyph = !task && blocks[0] ? /^([\u2610\u2611\u2612])\s*/.exec(blocks[0]) : null;
    if (glyph) {
      blocks[0] = (glyph[1] === '\u2610' ? '[ ] ' : '[x] ') + blocks[0]!.slice(glyph[0].length);
    }
    if (task) {
      if (blocks.length && !/^(?:#|>|```|- |\d+\. )/.test(blocks[0]!)) blocks[0] = task + blocks[0];
      else blocks.unshift(task.trim());
    }
    return blocks.length ? blocks : [''];
  }

  table(el: Element, format: Format, ctx: Context): string[] {
    // A hidden row (Excel's spacer row, `display:none`) is not a row of the table.
    const rows = Array.from(el.querySelectorAll('tr')).filter(
      (tr) => tr.closest('table') === el && !hidden(tr),
    );
    const grid: string[][] = [];
    const aligns: string[][] = [];
    const carried = new Map<number, number>();
    const firstRowCells = rows[0]
      ? Array.from(rows[0].children).filter((c) => /^t[dh]$/i.test(c.tagName))
      : [];
    const headerBold =
      firstRowCells.length > 0 &&
      firstRowCells.every((cell) => {
        const runs: Run[] = [];
        collect(cell, format, runs);
        const texts = runs.filter((run) => run.type === 'text' && run.text.trim());
        return texts.every((run) => run.type === 'text' && run.format.bold);
      });
    rows.forEach((tr, r) => {
      const row: string[] = [];
      const align: string[] = [];
      const place = () => {
        while ((carried.get(row.length) ?? 0) > 0) {
          carried.set(row.length, carried.get(row.length)! - 1);
          row.push('');
          align.push('');
        }
      };
      place();
      for (const cell of Array.from(tr.children)) {
        const tag = cell.tagName.toLowerCase();
        if (tag !== 'td' && tag !== 'th') continue;
        place();
        const strip = tag === 'th' || (r === 0 && headerBold);
        const blocks = this.blocks(cell, formatOf(cell, format), {
          cell: true,
          noBold: strip || ctx.noBold,
        });
        const text = blocks.join('<br>').replace(/\n/g, '<br>').replace(/\|/g, '\\|');
        const style = css(cell);
        const a = (cell.getAttribute('align') ?? style.get('text-align') ?? '').toLowerCase();
        const span = Math.max(1, Number.parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1);
        const down = Math.max(1, Number.parseInt(cell.getAttribute('rowspan') ?? '1', 10) || 1);
        for (let k = 0; k < Math.min(span, 50); k++) {
          if (down > 1) carried.set(row.length, down - 1);
          row.push(k === 0 ? text : '');
          align.push(a);
        }
      }
      place();
      grid.push(row);
      aligns.push(align);
    });
    const width = Math.max(0, ...grid.map((row) => row.length));
    if (!width || !grid.length) return [];
    const columns = Array.from({ length: width }, (_, c) => {
      const votes = aligns.map((row) => row[c] ?? '');
      const count = (name: string) => votes.filter((v) => v === name).length;
      const best = count('right') >= count('center') ? 'right' : 'center';
      return count(best) * 2 > votes.length ? best : '';
    });
    const line = (row: string[]) =>
      `| ${Array.from({ length: width }, (_, c) => row[c] ?? '').join(' | ')} |`;
    const delimiter = `| ${columns.map((a) => (a === 'right' ? '---:' : a === 'center' ? ':---:' : '---')).join(' | ')} |`;
    const caption = el.querySelector('caption');
    const title =
      caption && caption.closest('table') === el ? this.blocks(caption, format, ctx) : [];
    return [...title, [line(grid[0]!), delimiter, ...grid.slice(1).map(line)].join('\n')];
  }
}

const RAW_HTML = new Set([
  'HTMLBlock',
  'HTMLTag',
  'Comment',
  'CommentBlock',
  'ProcessingInstruction',
  'ProcessingInstructionBlock',
]);
const WRITTEN = /^<\/?(?:sup|sub|br)>/i;
const markdown = parser.configure(GFM);

/**
 * Markdown with no live HTML, no comment and so no Redlines marker outside code, whatever the
 * page put in an attribute: the Markdown is read again, as the editor reads it, and each `<` of
 * raw HTML in it, other than the few tags this converter writes, becomes `&lt;`.
 */
function withoutRawHtml(text: string): string {
  let result = text;
  for (let round = 0; round < 4; round++) {
    const spots: number[] = [];
    markdown.parse(result).iterate({
      enter: (node) => {
        if (!RAW_HTML.has(node.name)) return;
        for (const found of result.slice(node.from, node.to).matchAll(/</g)) {
          const at = node.from + found.index;
          if (!WRITTEN.test(result.slice(at, at + 6))) spots.push(at);
        }
        return false;
      },
    });
    if (!spots.length) return result;
    for (const at of spots.sort((a, b) => b - a))
      result = `${result.slice(0, at)}&lt;${result.slice(at + 1)}`;
  }
  return result;
}

/** Markdown for the HTML of a clipboard. Empty when the HTML has no content. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = new Converter().blocks(doc.body, PLAIN, { cell: false, noBold: false });
  return withoutRawHtml(
    blocks
      .join('\n\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

/**
 * The cells of the one table in a clipboard's HTML (Sheets, Excel, Numbers, Word, Docs, the web), as
 * the Markdown each is written in (a pipe `\|`, a line break `<br>`), row by row; the first row is a
 * row like the others. Null when the HTML holds no table, or holds more than the table (a range is
 * only the cells).
 */
export function htmlToRange(html: string): string[][] | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const blocks = htmlToMarkdown(html).split(/\n{2,}/);
  const last = blocks.at(-1) ?? '';
  const lines = last.split('\n');
  // Anything but the table, other than a caption in front of it, is more than a range.
  if (blocks.length > 2 || (blocks.length === 2 && /^\|/.test(blocks[0] ?? ''))) return null;
  if (lines.length < 2 || !lines.every((line) => line.startsWith('|'))) return null;
  if (!/^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[1] ?? '')) return null;
  const rows = [lines[0] ?? '', ...lines.slice(2)].map((line) =>
    readRowCells(line, 0, line.length).cells.map((cell) => line.slice(cell.textFrom, cell.textTo)),
  );
  return rows;
}
