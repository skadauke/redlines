// Markdown as the HTML a copy puts on the clipboard (design §5.10), for Google Docs, Mail, Pages
// and Word to paste. The Markdown is the selection's newest text; the HTML says the same, with no
// Redlines markup, no comments and no class a target can't use. Everything is escaped, and raw HTML
// in the source is text, never live.
//
// The fonts are inline, in the order a target that reads only the first name it has works with:
// the font a person opens a document in Word or Google Docs with, then its metric-compatible twin
// that Redlines bundles (design §6.6), then a generic family.

import { GFM, parser } from '@lezer/markdown';

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

const markdown = parser.configure(GFM);

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
function destination(written: string): string {
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

function render(src: string, fonts: FontStacks): string {
  const tree = markdown.parse(src);
  // Reference links take the address of their definition, when the copy has it.
  const definitions = new Map<string, string>();
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'LinkReference') return;
      const label = node.node.getChild('LinkLabel');
      const url = node.node.getChild('URL');
      if (label && url) {
        definitions.set(
          key(src.slice(label.from + 1, label.to - 1)),
          destination(src.slice(url.from, url.to)),
        );
      }
      return false;
    },
  });
  const style = (stack: string) => ` style="font-family:${escape(stack)}"`;
  const slice = (from: number, to: number) => src.slice(from, to);

  /** Text between nodes, as the Markdown it was written. */
  const text = (from: number, to: number) => escape(slice(from, to));

  /** The children of `node` between `from` and `to`, with the text between them. */
  function inlines(node: SyntaxNode, from = node.from, to = node.to): string {
    let pos = from;
    let out = '';
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      out += text(pos, child.from);
      out += inline(child);
      pos = child.to;
    }
    return out + text(pos, to);
  }

  /** The children of `node` that are not marks, with the text between them. */
  function inner(node: SyntaxNode, marks: ReadonlySet<string>): string {
    let pos = node.from;
    let out = '';
    for (let child = node.firstChild; child; child = child.nextSibling) {
      out += text(pos, child.from);
      if (!marks.has(child.name)) out += inline(child);
      pos = child.to;
    }
    return out + text(pos, node.to);
  }

  const wrap = (tag: string, node: SyntaxNode, marks: string) =>
    `<${tag}>${inner(node, new Set([marks]))}</${tag}>`;

  function link(node: SyntaxNode): string {
    const marks = node.getChildren('LinkMark');
    const url = node.getChild('URL');
    if (!marks[0] || !marks[1]) return text(node.from, node.to);
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
    if (href === undefined) return text(node.from, node.to);
    return safe(href) ? `<a href="${escape(href)}">${label}</a>` : label;
  }

  function inline(node: SyntaxNode): string {
    switch (node.name) {
      case 'Emphasis':
        return wrap('em', node, 'EmphasisMark');
      case 'StrongEmphasis':
        return wrap('strong', node, 'EmphasisMark');
      case 'Strikethrough':
        return wrap('del', node, 'StrikethroughMark');
      case 'InlineCode': {
        const marks = node.getChildren('CodeMark');
        const from = marks[0]?.to ?? node.from;
        const to = marks.length > 1 ? marks[marks.length - 1]!.from : node.to;
        return `<code${style(fonts.mono)}>${text(from, to)}</code>`;
      }
      case 'Link':
        return link(node);
      case 'Image': {
        const marks = node.getChildren('LinkMark');
        const url = node.getChild('URL');
        if (!url || !marks[1]) return text(node.from, node.to);
        const alt = slice(marks[0]!.to, marks[1].from);
        const href = destination(slice(url.from, url.to));
        return safe(href) ? `<img src="${escape(href)}" alt="${escape(alt)}">` : escape(alt);
      }
      case 'Autolink':
        return inline(node.getChild('URL') ?? node);
      case 'URL': {
        const href = bare(destination(slice(node.from, node.to)));
        return safe(href)
          ? `<a href="${escape(href)}">${escape(slice(node.from, node.to))}</a>`
          : text(node.from, node.to);
      }
      case 'Escape':
        return escape(slice(node.from + 1, node.to));
      case 'Entity': {
        const entity = slice(node.from, node.to);
        return ENTITY.test(entity) ? entity : escape(entity);
      }
      case 'HardBreak':
        return '<br>';
      case 'Comment':
      case 'ProcessingInstruction':
      case 'QuoteMark':
        return '';
      default:
        // HTML tags and anything else are text, never live.
        return text(node.from, node.to);
    }
  }

  function cells(row: SyntaxNode, tag: string, aligns: string[]): string {
    return (
      '<tr>' +
      row
        .getChildren('TableCell')
        .map((cell, i) => {
          const align = aligns[i];
          return `<${tag}${align ? ` style="text-align:${align}"` : ''}>${inlines(cell)}</${tag}>`;
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
    return (
      '<table>' +
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
    return `<li>${parts.join('')}</li>`;
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
      case 'Paragraph':
        return `<p>${inlines(node)}</p>`;
      case 'Blockquote':
        return `<blockquote>${blocks(node)}</blockquote>`;
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
      case 'HTMLBlock':
        return `<p>${text(node.from, node.to).replace(/\n/g, '<br>')}</p>`;
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

/** The HTML of Markdown `source`, for the clipboard. */
export function markdownToHtml(source: string, fonts: FontStacks = DEFAULT_FONTS): string {
  return render(source, fonts);
}
