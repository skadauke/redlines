// What GitHub draws of the HTML in a Markdown file (#686, #687): the one list that every drawing of
// HTML in Redlines reads, so that the editor and Quick Look can share it. It is GitHub's own: the
// elements, attributes and protocols html-pipeline's `SanitizationFilter` allows, and the nine tags
// GFM escapes (spec §6.11). What the editor draws of a file is held to it by the check against
// GitHub (`github-html.check.test.ts` in `packages/editor`). Nothing here parses HTML: it only
// answers what a name, an attribute or an address is.

/** The elements GitHub keeps. */
export const GITHUB_ELEMENTS: ReadonlySet<string> = new Set([
  ...['a', 'abbr', 'b', 'bdo', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del'],
  ...['details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4'],
  ...['h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture', 'pre', 'q'],
  ...['rp', 'rt', 'ruby', 's', 'samp', 'small', 'source', 'span', 'strike', 'strong', 'sub'],
  ...['summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'ul'],
  ...['var', 'wbr'],
]);

/** The nine tags GFM escapes: they show as text (GFM §6.11, "disallowed raw HTML"). */
export const GFM_ESCAPED_TAGS: ReadonlySet<string> = new Set([
  ...['title', 'textarea', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'script', 'plaintext'],
]);

/** The attributes GitHub keeps on every element it keeps. Never `style` or `class`. */
export const GITHUB_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...[
    'abbr',
    'accept',
    'accept-charset',
    'accesskey',
    'action',
    'align',
    'alt',
    'aria-describedby',
  ],
  ...['aria-hidden', 'aria-label', 'aria-labelledby', 'axis', 'border', 'char', 'charoff'],
  ...['charset', 'checked', 'clear', 'cols', 'colspan', 'compact', 'coords', 'datetime', 'dir'],
  ...['disabled', 'enctype', 'for', 'frame', 'headers', 'height', 'hreflang', 'hspace', 'id'],
  ...['ismap', 'itemprop', 'label', 'lang', 'maxlength', 'media'],
  ...['method', 'multiple', 'name', 'nohref', 'noshade', 'nowrap', 'open', 'progress', 'prompt'],
  ...['readonly', 'rel', 'rev', 'role', 'rows', 'rowspan', 'rules', 'scope', 'selected', 'shape'],
  ...['size', 'span', 'start', 'summary', 'tabindex', 'title', 'type', 'usemap'],
  ...['valign', 'value', 'width'],
]);

/** The attributes GitHub keeps on one element only, beyond `GITHUB_ATTRIBUTES`. */
export const GITHUB_ELEMENT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ['href'],
  img: ['src', 'longdesc', 'loading'],
  source: ['srcset'],
  div: ['itemscope', 'itemtype'],
  blockquote: ['cite'],
  del: ['cite'],
  ins: ['cite'],
  q: ['cite'],
};

const WEB = ['http', 'https'];

/** The protocols of an address, by the element and attribute that hold it. A relative one is fine. */
const GITHUB_PROTOCOLS: Readonly<Record<string, readonly string[]>> = {
  'a href': [...WEB, 'mailto'],
  'img src': WEB,
  'img longdesc': WEB,
  'blockquote cite': WEB,
  'del cite': WEB,
  'ins cite': WEB,
  'q cite': WEB,
};

/** Whether GitHub keeps the element. `name` is lowercase. */
export function isAllowedElement(name: string): boolean {
  return GITHUB_ELEMENTS.has(name);
}

/** Whether GFM escapes the tag, so that it shows as text. `name` is lowercase. */
export function isEscapedTag(name: string): boolean {
  return GFM_ESCAPED_TAGS.has(name);
}

/** Whether GitHub keeps the attribute on the element. Both names are lowercase. */
export function isAllowedAttribute(element: string, attribute: string): boolean {
  if (!GITHUB_ELEMENTS.has(element)) return false;
  return (
    GITHUB_ATTRIBUTES.has(attribute) ||
    (GITHUB_ELEMENT_ATTRIBUTES[element]?.includes(attribute) ?? false)
  );
}

/** Whether the attribute holds an address, so that `isAllowedAddress` answers for it. */
export function isAddressAttribute(element: string, attribute: string): boolean {
  return `${element} ${attribute}` in GITHUB_PROTOCOLS;
}

/**
 * Whether an address in an attribute is one GitHub keeps: relative, or with one of the protocols
 * its attribute allows. The value is read as a browser reads it: spaces and controls at its ends go,
 * and a tab or a newline inside is ignored, so that `java\nscript:` is a protocol.
 */
export function isAllowedAddress(element: string, attribute: string, value: string): boolean {
  const allowed = GITHUB_PROTOCOLS[`${element} ${attribute}`];
  if (!allowed) return false;
  const address = value
    // eslint-disable-next-line no-control-regex
    .replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')
    .replace(/[\t\n\r]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(address);
  if (!scheme) return true;
  return allowed.includes((scheme[1] as string).toLowerCase());
}

/**
 * How Redlines draws an element (#686). `inline` is text with its tags hidden and edited in place;
 * `container` holds blocks of Markdown; `twin` has an exact Markdown form; `block` is an HTML block
 * drawn rendered; `text` is an escaped tag; `unwrap` drops its tags and keeps its text; `chip` is
 * dropped by GitHub and has no text, so it shows as a small muted chip.
 */
export type HtmlHandling = 'inline' | 'container' | 'twin' | 'block' | 'text' | 'unwrap' | 'chip';

const INLINE = [
  ...['b', 'strong', 'i', 'em', 'code', 'tt', 'kbd', 'samp', 'var', 's', 'strike', 'del', 'ins'],
  ...['sub', 'sup', 'mark', 'small', 'abbr', 'dfn', 'cite', 'q', 'time', 'span', 'bdo', 'ruby'],
  ...['rt', 'rp', 'a', 'br', 'wbr'],
];
const CONTAINERS = ['details', 'summary', 'div', 'blockquote'];
const TWINS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody'];
const BLOCKS = ['p', 'pre', 'hr', 'figure', 'figcaption', 'picture', 'source', 'img', 'dl', 'dt'];
const MORE_BLOCKS = ['dd', 'caption', 'tr', 'td', 'th', 'tfoot'];
// An element GitHub drops that has no text of its own to keep.
const CHIPS = ['video', 'audio', 'svg', 'input', 'button', 'embed', 'object', 'canvas', 'select'];

const HANDLING = new Map<string, HtmlHandling>([
  ...INLINE.map((n): [string, HtmlHandling] => [n, 'inline']),
  ...CONTAINERS.map((n): [string, HtmlHandling] => [n, 'container']),
  ...TWINS.map((n): [string, HtmlHandling] => [n, 'twin']),
  ...[...BLOCKS, ...MORE_BLOCKS].map((n): [string, HtmlHandling] => [n, 'block']),
  ...CHIPS.map((n): [string, HtmlHandling] => [n, 'chip']),
]);

/** How an element is drawn. `name` is lowercase; an unknown name, and `u`, drop their tags. */
export function htmlHandling(name: string): HtmlHandling {
  if (GFM_ESCAPED_TAGS.has(name)) return 'text';
  return HANDLING.get(name) ?? 'unwrap';
}
