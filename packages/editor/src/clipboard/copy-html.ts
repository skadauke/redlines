// Markdown as the HTML a copy puts on the clipboard (design §5.10), for Google Docs, Mail, Pages
// and Word to paste. The Markdown is the selection's newest text; the HTML says the same, with no
// Redlines markup, no comments and no class a target can't use. Everything is escaped, and raw HTML
// in the source is text, never live. The tags `<sub>` and `<sup>` are formats, not raw HTML: a pair
// is copied as the element.
//
// The fonts are inline, in the order a target that reads only the first name it has works with:
// the font a person opens a document in Word or Google Docs with, then its metric-compatible twin
// that Redlines bundles (design §6.6), then a generic family.

import { GFM, parser } from '@lezer/markdown';
import { readTag } from '../image-size.ts';
import { emojiCodes, type EmojiLookup } from '../preview/emoji.ts';
import { scriptTags } from '../preview/script.ts';

/** The font stacks of a copy. */
export interface FontStacks {
  body: string;
  heading: string;
  mono: string;
}

const STACKS: Record<string, string> = {
  carlito: 'Calibri, Carlito, sans-serif',
  gelasio: 'Georgia, Gelasio, serif',
  cousine: '"Courier New", Cousine, monospace',
};

/** The stack for a CSS `font-family` value such as `'Gelasio', serif`: its first font's twins. */
export function fontStack(family: string): string {
  // A program that pastes can't resolve a CSS variable: a value that still holds one is no font.
  if (/\bvar\(/.test(family)) return STACKS.carlito!;
  const first =
    family
      .split(',')[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, '') ?? '';
  return STACKS[first.toLowerCase()] ?? (first ? `${first}, ${STACKS.carlito}` : STACKS.carlito!);
}

export const DEFAULT_FONTS: FontStacks = {
  body: STACKS.carlito!,
  heading: STACKS.carlito!,
  mono: STACKS.cousine!,
};

// The tags of subscript and superscript are read as pairs, so that they are copied as live tags.
const markdown = parser.configure([GFM, scriptTags, emojiCodes]);

/** A reference label as definitions and uses agree on it. */
const key = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();
type SyntaxNode = ReturnType<typeof markdown.parse>['topNode'];

/** `text` escaped for HTML text, and for an attribute in double quotes. */
const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The entities that stay entities; any other `&…;` is text, as in Markdown. */
const ENTITY =
  /^&(?:#\d{1,7}|#x[\da-f]{1,6}|amp|lt|gt|quot|apos|nbsp|copy|reg|trade|mdash|ndash|hellip);$/i;

/** A link address a page may open; `javascript:` and its kin become plain text. */
const SAFE_URL = /^(?:[a-z][a-z\d+.-]*:|[^:]*$)/i;
const UNSAFE_SCHEME = /^\s*(?:javascript|vbscript|data):/i;
const safe = (url: string) => !UNSAFE_SCHEME.test(url) && SAFE_URL.test(url.trim());

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/** A link destination as the reader of the Markdown has it: unescaped, with its entities decoded. */
export function destination(written: string): string {
  return written
    .replace(/^<(.*)>$/s, '$1')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(
      /&(?:#(\d{1,7})|#x([\da-f]{1,6})|(amp|lt|gt|quot|apos|nbsp));/gi,
      (all: string, dec?: string, hex?: string, name?: string) => {
        if (name) return NAMED[name.toLowerCase()] ?? all;
        const code = dec ? Number(dec) : Number.parseInt(hex ?? '', 16);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
      },
    );
}

/** The address of a link written bare, which a reader's app would add a scheme to. */
function bare(address: string): string {
  if (/^www\./i.test(address)) return `https://${address}`;
  if (/^[^\s@/:]+@[^\s@/:]+$/.test(address)) return `mailto:${address}`;
  return address;
}

/**
 * What a document (not a selection) is drawn with, for a page or a file: the parts of the language
 * that a clip leaves as text. Everything here is off for a copy.
 */
export interface DocumentParts {
  /** The address an image is loaded from, for the written one; null draws its alt text only. */
  imageUrl?: (written: string) => string | null;
  /** A block of HTML as the sanitized HTML that is drawn of it; null leaves it as text. */
  html?: (source: string) => string | null;
  /**
   * Draw for a program that pastes (Word, Google Docs): `<s>` for a strike, a code color of its own,
   * borders and widths on every table cell, a quote that reads without its rule, and no class.
   */
  office?: boolean;
  /** A selection of a document, not a whole one: footnotes, alerts and HTML blocks stay text. */
  clip?: boolean;
  /** Which images (by destination) come out as their alt text. */
  altOnly?: (href: string) => boolean;
}

/** The widest a picture goes on a page of Word or Docs: 6.5 in at 96 dpi. */
const COLUMN_PX = 624;

/** The size in px of an image given as a `data:` address, read from its header; null if unknown. */
export function dataImageSize(url: string): { width: number; height: number } | null {
  const comma = url.indexOf(',');
  if (!/^data:image\/[\w+.-]+;base64$/i.test(url.slice(0, comma))) return null;
  let bytes: Uint8Array;
  try {
    const binary = atob(url.slice(comma + 1, comma + 1 + 262_144).replace(/=+$/, ''));
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const u16 = (i: number) => (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8);
  const be16 = (i: number) => ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
  const be32 = (i: number) => be16(i) * 65536 + be16(i + 2);
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  let size: { width: number; height: number } | null = null;
  if (ascii(1, 3) === 'PNG') size = { width: be32(16), height: be32(20) };
  else if (ascii(0, 3) === 'GIF') size = { width: u16(6), height: u16(8) };
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') {
      size = {
        width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
        height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)),
      };
    } else if (kind === 'VP8 ') size = { width: u16(26) & 0x3fff, height: u16(28) & 0x3fff };
    else if (kind === 'VP8L') {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      size = { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let turned = false;
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      // Fill bytes, and markers with no length.
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0 || marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        size = turned ? null : { height: be16(i + 5), width: be16(i + 7) };
        break;
      }
      // EXIF orientation 5 to 8 turns the picture a quarter: its stored size isn't how it shows.
      if (marker === 0xe1 && ascii(i + 4, 4) === 'Exif') {
        const t = i + 10;
        const little = ascii(t, 2) === 'II';
        const w16 = (j: number) => (little ? u16(j) : be16(j));
        const w32 = (j: number) => (little ? u16(j) + u16(j + 2) * 65536 : be32(j));
        const ifd = t + w32(t + 4);
        for (let n = 0, count = w16(ifd); n < count && n < 64; n++) {
          if (w16(ifd + 2 + n * 12) === 0x0112 && w16(ifd + 2 + n * 12 + 8) >= 5) turned = true;
        }
      }
      i += 2 + be16(i + 2);
    }
  }
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/**
 * The `width` and `height` attributes of a picture for a program that pastes, so it doesn't guess:
 * the width set in the document, else the file's own, kept inside the column, aspect kept.
 */
function pictureSize(shown: string, set: number | null): string {
  const natural = dataImageSize(shown);
  let width = set ?? natural?.width ?? null;
  if (width === null) return '';
  width = Math.min(width, COLUMN_PX);
  if (!natural) return ` width="${Math.round(width)}"`;
  return ` width="${Math.round(width)}" height="${Math.max(1, Math.round((width * natural.height) / natural.width))}"`;
}

const OFFICE_CODE = 'background:#f2f2f2;color:#24292f;';
const OFFICE_CELL = 'border:1px solid #8c8c8c;padding:4px 8px;';
const OFFICE_QUOTE =
  'margin:0 0 0 1.5em;padding:0 0 0 1em;border-left:3px solid #b0b0b0;color:#555555';

/** A footnote's mark in prose: `[^1]`, not followed by the colon of its definition. */
const FOOTNOTE_MARK = /\[\^([^\]\s&]+)\](?!:)/g;

function render(
  src: string,
  fonts: FontStacks,
  keepAsText: (href: string) => boolean,
  emoji: EmojiLookup = () => undefined,
  doc?: DocumentParts,
): string {
  const office = doc?.office === true;
  // The parts of the language that a whole page draws and a selection leaves as text.
  const page = doc && !doc.clip ? doc : undefined;
  // A picture as data is what a program that pastes can always draw.
  const pictureOk = (href: string) =>
    safe(href) || (office && /^data:image\/(?:png|jpe?g|gif|webp);base64,[\w+/=]+$/i.test(href));
  if (doc?.altOnly) {
    const first = keepAsText;
    const also = doc.altOnly;
    keepAsText = (href) => first(href) || also(href);
  }
  const tree = markdown.parse(src);
  // Reference links take the address of their definition, when the copy has it.
  const definitions = new Map<string, string>();
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'LinkReference') return;
      const label = node.node.getChild('LinkLabel');
      const url = node.node.getChild('URL');
      // `[^1]: note` is a footnote, which stays text.
      if (label && url && src[label.from + 1] !== '^') {
        definitions.set(
          key(src.slice(label.from + 1, label.to - 1)),
          destination(src.slice(url.from, url.to)),
        );
      }
      return false;
    },
  });
  const style = (stack: string) => ` style="font-family:${escape(stack)}"`;
  /**
   * An `<img>` tag (an image with a size, format §3.5.1) as the element a target can paste: its
   * address, alt text and width. Null for anything else, and for an image kept as text.
   */
  function tagPicture(tag: string): string | null {
    const attributes = readTag(tag);
    if (!attributes) return null;
    const value = (name: string) => attributes.find((a) => a.name === name)?.value ?? null;
    const href = value('src') ?? '';
    if (!href) return null;
    if (!pictureOk(href) || keepAsText(href)) return escape(value('alt') ?? '');
    const shown = doc?.imageUrl ? doc.imageUrl(href) : href;
    if (shown === null) return escape(value('alt') ?? '');
    const width = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value('width') ?? '')?.[1];
    const set = width && Number(width) > 0 ? Number(width) : null;
    return `<img src="${escape(shown)}" alt="${escape(value('alt') ?? '')}"${
      office ? pictureSize(shown, set) : set ? ` width="${Math.round(set)}"` : ''
    }>`;
  }

  /** Whether a table cell is being written. */
  let inCell = false;
  const slice = (from: number, to: number) => src.slice(from, to);

  /** Text between nodes, as the Markdown it was written. */
  const text = (from: number, to: number) => escape(slice(from, to));

  /** Text of a document's prose, in which a footnote's mark is a superscript. */
  const prose = (from: number, to: number) =>
    page ? text(from, to).replace(FOOTNOTE_MARK, '<sup>$1</sup>') : text(from, to);

  /** The children of `node` between `from` and `to`, with the text between them. */
  function inlines(node: SyntaxNode, from = node.from, to = node.to): string {
    let pos = from;
    let out = '';
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      out += prose(pos, child.from);
      out += inline(child);
      pos = child.to;
    }
    return out + prose(pos, to);
  }

  /** The children of `node` that are not marks, with the text between them. */
  function inner(node: SyntaxNode, marks: ReadonlySet<string>): string {
    let pos = node.from;
    let out = '';
    for (let child = node.firstChild; child; child = child.nextSibling) {
      out += prose(pos, child.from);
      if (!marks.has(child.name)) out += inline(child);
      pos = child.to;
    }
    return out + prose(pos, node.to);
  }

  const wrap = (tag: string, node: SyntaxNode, marks: string) =>
    `<${tag}>${inner(node, new Set([marks]))}</${tag}>`;

  function link(node: SyntaxNode): string {
    const marks = node.getChildren('LinkMark');
    const url = node.getChild('URL');
    if (!marks[0] || !marks[1]) return prose(node.from, node.to);
    const label = inlines(node, marks[0].to, marks[1].from);
    let href: string | undefined;
    if (url) href = destination(slice(url.from, url.to));
    else {
      const named = node.getChild('LinkLabel');
      const inside = slice(
        named ? named.from + 1 : marks[0].to,
        named ? named.to - 1 : marks[1].from,
      );
      href = definitions.get(key(inside.trim() ? inside : slice(marks[0].to, marks[1].from)));
    }
    if (href === undefined) return prose(node.from, node.to);
    return safe(href) ? `<a href="${escape(href)}">${label}</a>` : label;
  }

  function inline(node: SyntaxNode): string {
    switch (node.name) {
      case 'Emphasis':
        return wrap('em', node, 'EmphasisMark');
      case 'StrongEmphasis':
        return wrap('strong', node, 'EmphasisMark');
      case 'Strikethrough':
        return wrap(office ? 's' : 'del', node, 'StrikethroughMark');
      case 'Subscript':
        return wrap('sub', node, 'SubscriptMark');
      case 'Superscript':
        return wrap('sup', node, 'SuperscriptMark');
      case 'InlineCode': {
        const marks = node.getChildren('CodeMark');
        const from = marks[0]?.to ?? node.from;
        const to = marks.length > 1 ? marks[marks.length - 1]!.from : node.to;
        return `<code style="font-family:${escape(fonts.mono)}${office ? `;${OFFICE_CODE}` : ''}">${text(from, to)}</code>`;
      }
      case 'Link':
        return link(node);
      case 'Image': {
        const marks = node.getChildren('LinkMark');
        const url = node.getChild('URL');
        if (!url || !marks[1]) return text(node.from, node.to);
        const alt = slice(marks[0]!.to, marks[1].from);
        const href = destination(slice(url.from, url.to));
        // An image the preview doesn't fetch is not one a target should: its alt text only.
        const shown = doc?.imageUrl ? doc.imageUrl(href) : href;
        return pictureOk(href) && !keepAsText(href) && shown !== null
          ? `<img src="${escape(shown)}" alt="${escape(alt)}"${office ? pictureSize(shown, null) : ''}>`
          : escape(alt);
      }
      case 'Autolink':
        return inline(node.getChild('URL') ?? node);
      case 'URL': {
        const href = bare(destination(slice(node.from, node.to)));
        return safe(href)
          ? `<a href="${escape(href)}">${escape(slice(node.from, node.to))}</a>`
          : text(node.from, node.to);
      }
      case 'Emoji': {
        // A shortcode the host knows is its character, as the editor draws it.
        const char = emoji(slice(node.from + 1, node.to - 1));
        return char === undefined ? text(node.from, node.to) : escape(char);
      }
      case 'Escape':
        return escape(slice(node.from + 1, node.to));
      case 'Entity': {
        const entity = slice(node.from, node.to);
        return ENTITY.test(entity) ? entity : escape(entity);
      }
      case 'HardBreak':
        return '<br>';
      case 'HTMLTag': {
        const picture = tagPicture(slice(node.from, node.to));
        if (picture !== null) return picture;
        // A line break in a table cell is written `<br>`; elsewhere HTML stays text.
        return inCell && /^<br\s*\/?>$/i.test(slice(node.from, node.to))
          ? '<br>'
          : text(node.from, node.to);
      }
      case 'Comment':
      case 'ProcessingInstruction':
      case 'QuoteMark':
        return '';
      default:
        // HTML tags and anything else are text, never live.
        return text(node.from, node.to);
    }
  }

  let columns = 1;
  function cells(row: SyntaxNode, tag: string, aligns: string[]): string {
    inCell = true;
    try {
      return cellsOf(row, tag, aligns);
    } finally {
      inCell = false;
    }
  }

  function cellsOf(row: SyntaxNode, tag: string, aligns: string[]): string {
    return (
      '<tr>' +
      row
        .getChildren('TableCell')
        .map((cell, i) => {
          const align = aligns[i];
          const css =
            (office
              ? `${OFFICE_CELL}font-family:${escape(fonts.body)};width:${Math.floor(100 / columns)}%;${tag === 'th' ? 'background:#f2f2f2;font-weight:bold;' : ''}`
              : '') + (align ? `text-align:${align}` : '');
          return `<${tag}${css ? ` style="${css}"` : ''}>${inlines(cell)}</${tag}>`;
        })
        .join('') +
      '</tr>'
    );
  }

  function table(node: SyntaxNode): string {
    const delimiter = node
      .getChildren('TableDelimiter')
      .find(
        (d) => /^[\s|:-]*-[\s|:-]*$/.test(slice(d.from, d.to)) && slice(d.from, d.to).length > 1,
      );
    const aligns = (delimiter ? slice(delimiter.from, delimiter.to) : '')
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((spec) => {
        const s = spec.trim();
        return s.startsWith(':')
          ? s.endsWith(':')
            ? 'center'
            : 'left'
          : s.endsWith(':')
            ? 'right'
            : '';
      });
    const head = node.getChild('TableHeader');
    const rows = node.getChildren('TableRow');
    columns = Math.max(1, aligns.length, head?.getChildren('TableCell').length ?? 0);
    return (
      (office ? '<table style="border-collapse:collapse;width:100%">' : '<table>') +
      (head ? `<thead>${cells(head, 'th', aligns)}</thead>` : '') +
      (rows.length
        ? `<tbody>${rows.map((row) => cells(row, 'td', aligns)).join('')}</tbody>`
        : '') +
      '</table>'
    );
  }

  function listItem(node: SyntaxNode): string {
    const parts: string[] = [];
    const prose = node.getChildren('Paragraph').length + node.getChildren('Task').length;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'ListMark') continue;
      if (child.name === 'Task') {
        const marker = child.getChild('TaskMarker');
        const checked = marker ? /x/i.test(slice(marker.from, marker.to)) : false;
        const body = inner(child, new Set(['TaskMarker'])).replace(/^\s+/, '');
        parts.push(`${checked ? '\u2611' : '\u2610'} ${body}`);
      } else if (child.name === 'Paragraph' && prose === 1) {
        parts.push(inlines(child));
      } else {
        parts.push(block(child));
      }
    }
    const task = doc && parts.some((part) => /^[\u2610\u2611]/.test(part));
    // A task item is its box alone, with no bullet (Word and Docs draw one beside it otherwise).
    const mark = !task ? '' : office ? ' style="list-style-type:none"' : ' class="rl-task"';
    return `<li${mark}>${parts.join('')}</li>`;
  }

  function list(node: SyntaxNode): string {
    if (node.name === 'BulletList') {
      return `<ul>${node.getChildren('ListItem').map(listItem).join('')}</ul>`;
    }
    const first = node.getChild('ListItem')?.getChild('ListMark');
    const start = first ? Number.parseInt(slice(first.from, first.to), 10) : 1;
    return `<ol${start > 1 ? ` start="${start}"` : ''}>${node.getChildren('ListItem').map(listItem).join('')}</ol>`;
  }

  function code(node: SyntaxNode): string {
    const parts = node.getChildren('CodeText');
    const body = parts.length ? slice(parts[0]!.from, parts[parts.length - 1]!.to) : '';
    const info = node.getChild('CodeInfo');
    const lang = info ? slice(info.from, info.to).trim().split(/\s+/)[0] : '';
    const className = lang && /^[\w+#.-]+$/.test(lang) ? ` class="language-${escape(lang)}"` : '';
    return `<pre${style(fonts.mono)}><code${className}>${escape(body)}</code></pre>`;
  }

  function heading(node: SyntaxNode, level: number): string {
    const marks = node.getChildren('HeaderMark');
    let body: string;
    if (node.name.startsWith('Setext')) {
      body = inlines(node, node.from, marks[0]?.from ?? node.to).trim();
    } else {
      const trailing = marks.length > 1 ? marks[marks.length - 1]!.from : node.to;
      body = inlines(node, marks[0]?.to ?? node.from, trailing).trim();
    }
    const stack = fonts.heading === fonts.body ? '' : style(fonts.heading);
    return `<h${level}${stack}>${body}</h${level}>`;
  }

  function block(node: SyntaxNode): string {
    const level = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name)?.[1];
    if (level) return heading(node, Number(level));
    switch (node.name) {
      case 'Paragraph': {
        const note = page ? /^\[\^([^\]\s]+)\]:[ \t]*/.exec(slice(node.from, node.to)) : null;
        if (note) {
          const body = inlines(node, node.from + note[0].length);
          return `<p class="rl-footnote"><sup>${escape(note[1]!)}</sup> ${body}</p>`;
        }
        return `<p>${inlines(node)}</p>`;
      }
      case 'Blockquote': {
        const body = blocks(node);
        const alert = page ? /^<p>\[!([A-Za-z][A-Za-z0-9-]*)\][ \t]*/.exec(body) : null;
        if (!alert) {
          return `<blockquote${office ? ` style="${OFFICE_QUOTE}"` : ''}>${body}</blockquote>`;
        }
        const type = alert[1]!.toLowerCase();
        const title = type.charAt(0).toUpperCase() + type.slice(1);
        return `<blockquote class="rl-callout rl-callout-${escape(type)}"><p class="rl-callout-title">${escape(title)}</p><p>${body.slice(alert[0].length)}</blockquote>`;
      }
      case 'BulletList':
      case 'OrderedList':
        return list(node);
      case 'FencedCode':
      case 'CodeBlock':
        return code(node);
      case 'HorizontalRule':
        return '<hr>';
      case 'Table':
        return table(node);
      case 'LinkReference': {
        const note = page
          ? /^\[\^([^\]\s]+)\]:[ \t]*([\s\S]*)$/.exec(slice(node.from, node.to))
          : null;
        if (note) {
          return `<p class="rl-footnote"><sup>${escape(note[1]!)}</sup> ${escape(note[2]!.trim())}</p>`;
        }
        return `<p>${text(node.from, node.to)}</p>`;
      }
      case 'HTMLBlock': {
        const picture = tagPicture(slice(node.from, node.to));
        if (picture !== null) return `<p>${picture}</p>`;
        if (page) {
          // A comment is not shown; other HTML is drawn as the sanitizer allows.
          const source = slice(node.from, node.to);
          if (/^\s*<!--(?:(?!-->)[\s\S])*-->\s*$/.test(source)) return '';
          const drawn = page.html?.(source);
          if (drawn !== null && drawn !== undefined) return `<div class="rl-html">${drawn}</div>`;
        }
        return `<p>${text(node.from, node.to).replace(/\n/g, '<br>')}</p>`;
      }
      default:
        return '';
    }
  }

  function blocks(node: SyntaxNode): string {
    let out = '';
    for (let child = node.firstChild; child; child = child.nextSibling) out += block(child);
    return out;
  }

  return `<div data-redlines${style(fonts.body)}>${blocks(tree.topNode)}</div>`;
}

/**
 * The HTML of a whole document's Markdown, for a page or a file: `markdownToHtml` and the parts of
 * the language that a copy leaves as text (footnotes, alerts, task items, HTML blocks, the images
 * the host resolves). `documentHtml` (document-html.ts) reads the document first.
 */
export function markdownToDocumentHtml(
  source: string,
  fonts: FontStacks,
  emoji: EmojiLookup | undefined,
  parts: DocumentParts,
): string {
  return render(source, fonts, () => false, emoji, parts);
}

/**
 * The HTML of Markdown `source`, for the clipboard. `altOnly` says which images (by destination)
 * come out as their alt text: the ones the preview doesn't load, such as a pending change's.
 */
export function markdownToHtml(
  source: string,
  fonts: FontStacks = DEFAULT_FONTS,
  altOnly: (href: string) => boolean = () => false,
  emoji?: EmojiLookup,
): string {
  return render(source, fonts, altOnly, emoji);
}

/**
 * The HTML table of cells of Markdown text (each cell as written, a pipe as `\|`, a line break as
 * `<br>`), the first row `th` when `header`. Alignments are per column: `''`, `left`, `center` or
 * `right`.
 */
export function cellsToHtml(
  rows: readonly (readonly string[])[],
  header: boolean,
  aligns: readonly string[] = [],
  fonts: FontStacks = DEFAULT_FONTS,
  altOnly: (href: string) => boolean = () => false,
  emoji?: EmojiLookup,
): string {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const line = (row: readonly string[]) =>
    `| ${Array.from({ length: width }, (_, i) => (row[i] ?? '').replace(/\r?\n/g, ' ')).join(' | ')} |`;
  const delimiter = `| ${Array.from({ length: width }, (_, i) => {
    const align = aligns[i];
    return align === 'center' ? ':-:' : align === 'left' ? ':-' : align === 'right' ? '-:' : '-';
  }).join(' | ')} |`;
  const first = rows[0] ?? [];
  const html = render(
    [line(first), delimiter, ...rows.slice(1).map(line)].join('\n'),
    fonts,
    altOnly,
    emoji,
  );
  const table = /<table>.*<\/table>/s.exec(html)?.[0] ?? '<table></table>';
  const open = /^<div[^>]*>/.exec(html)?.[0] ?? '<div data-redlines>';
  if (header) return `${open}${table}</div>`;
  // No header in the copy: the first row is a row of the body.
  const head = /<thead>(.*?)<\/thead>/s.exec(table)?.[1] ?? '';
  const body = /<tbody>(.*?)<\/tbody>/s.exec(table)?.[1] ?? '';
  const data = head.replace(/<th(?=[ >])/g, '<td').replace(/<\/th>/g, '</td>');
  return `${open}<table><tbody>${data}${body}</tbody></table></div>`;
}
