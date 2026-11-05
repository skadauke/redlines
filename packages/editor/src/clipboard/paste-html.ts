// Pasted HTML as Markdown (design §5.10, docs/research/paste.md): Google Docs, web pages, Mail,
// Pages and Word. The page is read whole, then its formatting, whether set by tags or by CSS, is
// turned into Markdown in one consistent style: ATX headings, `-` bullets, `*` emphasis, fenced
// code, pipe tables with the first row as the header. Escapes are kept to what would otherwise
// change the meaning.
//
// Nothing in the clipboard's HTML can become Redlines markup. Every comment is dropped, and the
// text that reads like a marker (`<!--ins k3x9-->`) comes out with its `<` written as `&lt;`, so
// that it reads as text, never as a comment.

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
  if (
    ['code', 'kbd', 'samp', 'tt'].includes(tag) ||
    MONOSPACE.test(style.get('font-family') ?? '')
  ) {
    format.code = true;
  }
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
  | { type: 'break' };

const hrefOf = (item: Item | undefined) =>
  item && item.type !== 'space' && item.type !== 'break'
    ? 'format' in item
      ? item.format.href
      : item.href
    : '';

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

/** Items with the same address as one link, or as text when they have none. */
function emitItems(items: Item[]): string {
  // Spaces take what their neighbors share, so that they stay inside a link and its formatting.
  const formatted = items.map((item, i): Item =>
    item.type === 'space'
      ? { type: 'text', text: ' ', format: shared(items[i - 1], items[i + 1]), space: true }
      : item,
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
  let out = '';
  for (let i = 0; i < merged.length;) {
    const href = hrefOf(merged[i]);
    let end = i;
    while (end < merged.length && merged[end]!.type !== 'break' && hrefOf(merged[end]) === href)
      end++;
    if (end === i) {
      out += '\\\n';
      i++;
      continue;
    }
    const group = merged.slice(i, end);
    const inner = emitGroup(group);
    const only = group[0];
    if (!href) out += inner;
    else if (group.length === 1 && only?.type === 'text' && only.text === href) out += `<${href}>`;
    else if (inner) out += `[${inner}](${encodeUrl(href)})`;
    i = end;
  }
  return out;
}

const encodeUrl = (url: string) =>
  url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

/** The markers of formats open around a group of items, closed and reopened as they change. */
function emitGroup(group: Item[]): string {
  const stack: Flag[] = [];
  let out = '';
  const close = (to: number) => {
    while (stack.length > to) out += MARKERS[stack.pop()!][1];
  };
  for (const item of group) {
    const has = new Set<Flag>(
      item.type === 'text' ? FLAGS.filter((flag) => item.format[flag]) : [],
    );
    // A space opens nothing and keeps only what is open, outermost first, that it shares.
    const open = stack.findIndex((flag) => !has.has(flag));
    const wanted =
      item.type === 'text' && item.space ? new Set(open < 0 ? stack : stack.slice(0, open)) : has;
    const broken = stack.findIndex((flag) => !wanted.has(flag));
    const reopen = broken < 0 ? [] : stack.slice(broken).filter((flag) => wanted.has(flag));
    if (broken >= 0) close(broken);
    for (const flag of [
      ...reopen,
      ...FLAGS.filter((f) => wanted.has(f) && !stack.includes(f) && !reopen.includes(f)),
    ]) {
      stack.push(flag);
      out += MARKERS[flag][0];
    }
    if (item.type === 'text') out += item.format.code ? codeSpan(item.text) : escapeText(item.text);
    else if (item.type === 'image')
      out += `![${item.alt.replace(/[[\]\\]/g, '\\$&')}](${encodeUrl(item.src)})`;
  }
  close(0);
  return out;
}

/** Runs as inline Markdown. */
function inline(runs: Run[], noBold: boolean): string {
  return guardLines(emitItems(itemsOf(runs, noBold)));
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

const hasBlock = (el: Element) => !!el.querySelector(BLOCK_SELECTOR);

class Converter {
  /** The blocks under `parent`, as Markdown. */
  blocks(parent: Element, format: Format, ctx: Context): string[] {
    const out: string[] = [];
    let pending: Run[] = [];
    const flush = () => {
      for (const group of paragraphsOf(pending)) {
        const text = inline(group, ctx.noBold);
        if (text.trim()) out.push(ctx.cell ? text.replace(/\\\n/g, '<br>') : text);
      }
      pending = [];
    };
    for (const child of Array.from(parent.childNodes)) {
      if (isText(child)) {
        collect(child, format, pending);
        continue;
      }
      if (!isElement(child) || hidden(child)) continue;
      const tag = child.tagName.toLowerCase();
      const own = formatOf(child, format);
      if (!BLOCKS.has(tag) && !hasBlock(child)) {
        collect(child, format, pending);
        continue;
      }
      flush();
      out.push(...this.block(child, tag, own, ctx));
    }
    flush();
    return out;
  }

  block(el: Element, tag: string, format: Format, ctx: Context): string[] {
    if (/^h[1-6]$/.test(tag)) {
      const runs: Run[] = [];
      collect(el, { ...format, bold: false }, runs);
      const flat = runs.map((run): Run =>
        run.type === 'break' ? { type: 'text', text: ' ', format } : run,
      );
      const text = inline(flat, true).replace(/\n/g, ' ').trim();
      return text ? [`${'#'.repeat(Number(tag[1]))} ${text}`] : [];
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

  pre(el: Element, ctx: Context): string[] {
    let text = '';
    const walk = (node: Node) => {
      if (isText(node)) text += node.nodeValue ?? '';
      else if (isElement(node) && !hidden(node)) {
        if (node.tagName.toLowerCase() === 'br') text += '\n';
        else node.childNodes.forEach(walk);
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
    const fence = '`'.repeat(
      Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)),
    );
    return [`${fence}${lang}\n${text}\n${fence}`];
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
    if (task) {
      if (blocks.length && !/^(?:#|>|```|- |\d+\. )/.test(blocks[0]!)) blocks[0] = task + blocks[0];
      else blocks.unshift(task.trim());
    }
    return blocks.length ? blocks : [''];
  }

  table(el: Element, format: Format, ctx: Context): string[] {
    const rows = Array.from(el.querySelectorAll('tr')).filter((tr) => tr.closest('table') === el);
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

/** Markdown for the HTML of a clipboard. Empty when the HTML has no content. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = new Converter().blocks(doc.body, PLAIN, { cell: false, noBold: false });
  return blocks
    .join('\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
