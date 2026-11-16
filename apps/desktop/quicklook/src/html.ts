// The HTML that GitHub draws, in a preview (#686, #691). A preview has no DOM to parse with (it runs
// in JavaScriptCore), and the source is never passed through as HTML: each tag is read as a token,
// and what is drawn is rebuilt from the token alone. An element is kept only if GitHub keeps it
// (`@redlines/format`'s list, the one the editor reads), and an attribute only if GitHub keeps it
// and a static preview has a use for it. Nothing here can make a script, a handler, a style, a
// frame or a request: an address is kept only with GitHub's protocols, and an image is drawn only
// through `markdown.ts`, which asks the host for the local ones.
//
// What is drawn of a tag:
// - an element on GitHub's list: itself, with its allowed attributes (`<details>` folds, and is
//   closed unless it says `open`, as on GitHub);
// - one of GFM's nine escaped tags (`<script>`, `<iframe>`...): its source, as text;
// - an element GitHub drops that has nothing to show (`<video>`, `<svg>`...): a small muted chip with
//   its name, so that nothing in the file is invisible;
// - any other (`<u>`, `<font>`, an unknown name): no tag, the text inside stays.

import {
  htmlHandling,
  isAddressAttribute,
  isAllowedAddress,
  isAllowedAttribute,
  isAllowedElement,
  isEscapedTag,
} from '@redlines/format';
import { escapeHtml } from './page.ts';

/** Elements with no end tag. */
const VOID = new Set(['br', 'hr', 'img', 'wbr', 'source']);

/** The attributes that a static preview draws, of those that GitHub keeps. A reader of the page
 * can't use the others (`id` and `name` would collide with the page's own, `for`, `form` and
 * `tabindex` do nothing without script), so they are left out. `src` and `alt` of an image are read
 * separately. */
const DRAWN = new Set([
  ...['abbr', 'align', 'alt', 'colspan', 'datetime', 'dir', 'height', 'href', 'lang', 'open'],
  ...['rowspan', 'scope', 'span', 'start', 'title', 'valign', 'width'],
]);

/** What each drawn attribute may hold: a number, a keyword, or any text. */
const NUMBER = /^\d{1,5}%?$/;
const WORD = /^[A-Za-z-]{1,20}$/;
const VALUES: Record<string, RegExp | undefined> = {
  align: WORD,
  valign: WORD,
  dir: /^(?:ltr|rtl|auto)$/i,
  width: NUMBER,
  height: NUMBER,
  colspan: NUMBER,
  rowspan: NUMBER,
  span: NUMBER,
  start: /^-?\d{1,6}$/,
  scope: WORD,
};

const MAX_TEXT = 500;
const MAX_DEPTH = 200;
const MAX_PENDING = 2000;

const TAG =
  /^<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** An attribute's value as the author wrote it: the few references that matter, decoded. */
function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Text as HTML text, keeping the character references that the author wrote (`&copy;`): a
 * reference only ever draws a character, as text. */
function text(source: string): string {
  return escapeHtml(source).replace(
    /&amp;((?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});)/g,
    '&$1',
  );
}

/** The attributes of a tag, as a map from name to decoded value (`''` for one with none). */
function attributesOf(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, double, single, bare] of source.matchAll(ATTRIBUTE)) {
    const key = (name ?? '').toLowerCase();
    if (!found.has(key)) found.set(key, decode(double ?? single ?? bare ?? ''));
  }
  return found;
}

/** The attributes of `element` that are drawn, as HTML to follow its name. */
function drawn(element: string, found: Map<string, string>): string {
  let out = '';
  for (const [name, value] of found) {
    if (!DRAWN.has(name) || !isAllowedAttribute(element, name)) continue;
    if (name === 'href') {
      if (element !== 'a' || !isAllowedAddress('a', 'href', value)) continue;
      out += ` href="${escapeHtml(value)}"`;
    } else if (name === 'open') {
      if (element === 'details') out += ' open=""';
    } else {
      const allowed = VALUES[name];
      if (allowed ? !allowed.test(value) : value.length > MAX_TEXT) continue;
      out += ` ${name}="${escapeHtml(value)}"`;
    }
  }
  return out;
}

/** An image: `markdown.ts` draws it as the picture, if the host loaded the file, else as its alt.
 * Its `width` and `height` are kept when they are numbers, as GitHub keeps them (#629). */
function image(found: Map<string, string>): string {
  const alt = escapeHtml((found.get('alt') ?? '').slice(0, MAX_TEXT));
  const src = found.get('src') ?? '';
  if (src === '' || !isAddressAttribute('img', 'src') || !isAllowedAddress('img', 'src', src)) {
    return `<span class="rl-image">${alt}</span>`;
  }
  // A % that starts no escape is a part of the name, as micromark writes it.
  const address = src.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
  const size = ['width', 'height']
    .map((name) => [name, found.get(name) ?? ''] as const)
    .filter(([, value]) => NUMBER.test(value))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('');
  return `<img src="${escapeHtml(address)}" alt="${alt}"${size} />`;
}

/** A piece of the HTML to write: `tag` is markup, which micromark leaves out of an image's alt text
 * (`context.tag`), and the rest is text (`context.raw`). */
export type Part = { tag: boolean; html: string };

/** One document's raw HTML, piece by piece (micromark gives a line of a block, or one inline tag, at
 * a time), with what is open between them. */
export class Html {
  private open: string[] = [];
  private pending = '';

  /** What to draw of `source`, a piece of raw HTML with its comments already gone. `live` is false
   * where the markup is dropped, so that no element is counted as open. */
  piece(source: string, live = true): Part[] {
    let rest = this.pending === '' ? source : `${this.pending} ${source}`;
    this.pending = '';
    const out: Part[] = [];
    while (rest !== '') {
      const at = rest.indexOf('<');
      if (at < 0) {
        out.push({ tag: false, html: text(rest) });
        return out;
      }
      out.push({ tag: false, html: text(rest.slice(0, at)) });
      rest = rest.slice(at);
      const tag = TAG.exec(rest);
      if (tag === null) {
        // A tag that goes on in the next line is held; anything else that starts with < is text.
        if (rest.length < MAX_PENDING && /^<\/?[A-Za-z][^>]*$/.test(rest)) {
          this.pending = rest;
          return out;
        }
        out.push({ tag: false, html: '&lt;' });
        rest = rest.slice(1);
        continue;
      }
      out.push(this.tag(tag[0], tag[1] === '/', (tag[2] ?? '').toLowerCase(), tag[3] ?? '', live));
      rest = rest.slice(tag[0].length);
    }
    return out;
  }

  private tag(
    source: string,
    closing: boolean,
    name: string,
    attributes: string,
    live: boolean,
  ): Part {
    const markup = (html: string): Part => ({ tag: true, html });
    if (isEscapedTag(name)) return { tag: false, html: text(source) };
    if (!isAllowedElement(name)) {
      return markup(
        !closing && htmlHandling(name) === 'chip'
          ? `<span class="rl-chip">${escapeHtml(name)}</span>`
          : '',
      );
    }
    // Where markup is left out (an image's alt text), it opens and closes nothing.
    if (name === 'source' || !live) return markup('');
    if (closing) return markup(this.close(name));
    const found = attributesOf(attributes);
    if (name === 'img') return markup(image(found));
    if (VOID.has(name)) return markup(`<${name}${drawn(name, found)} />`);
    if (this.open.length >= MAX_DEPTH) return markup('');
    this.open.push(name);
    return markup(`<${name}${drawn(name, found)}>`);
  }

  /** The end of `name`, and of what was left open inside it. A stray end tag draws nothing. */
  private close(name: string): string {
    const at = this.open.lastIndexOf(name);
    if (at < 0) return '';
    return this.open
      .splice(at)
      .reverse()
      .map((n) => `</${n}>`)
      .join('');
  }

  /** What is held of a tag that never ended: its source, as text. */
  flush(): string {
    const held = this.pending;
    this.pending = '';
    return text(held);
  }

  /** The ends of every element still open, for the end of the document: on GitHub too, `<details>`
   * left open folds the rest of the document. */
  end(): string {
    const closers = this.open
      .splice(0)
      .reverse()
      .map((n) => `</${n}>`)
      .join('');
    return this.flush() + closers;
  }
}
