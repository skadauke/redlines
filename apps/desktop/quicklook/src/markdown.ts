// Markdown as the HTML of a preview: micromark with GitHub's extensions, the reader that the format's
// tests hold every file to (packages/format/src/oracle.ts), and the same rules as a copy (design
// §5.10): everything is escaped and raw HTML in the source is text, never live. A preview has no
// script and no network, so it also draws no image. A link keeps its address, which only a click
// would load, and a `javascript:` address is gone.
//
// Four things are changed from micromark's own HTML:
//
// - An HTML comment is not shown: the markers of a file that Redlines wrote are such comments, and
//   so is any note an author left in the text (GitHub and a copy hide them too).
// - An image is its alt text. Its file, here or on a server, is not loaded.
// - A chunk of R Markdown or Quarto, a fence whose info string is written in braces
//   (```` ```{r setup, include=FALSE} ````), keeps what is in the braces as a plain line over its code,
//   where micromark would take the first word for the language and drop the rest.
// - A table sits in a box that scrolls, so that a wide one doesn't widen the page.
// - A list item says whether it starts with a task's box, and whether its list is loose, in classes:
//   the style sheet doesn't have to find that out with a selector that an engine may not know.

import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import type { CompileContext, HtmlExtension } from 'micromark-util-types';

/** Whether a fence's info string is written in braces, as a chunk's is, and Pandoc's attributes. */
export const isBraced = (info: string): boolean => info.startsWith('{');

/** The engine of a chunk's info string, `r` for `{r setup}`, or null when it names none, as
 * Pandoc's attributes (`{.python .numberLines}`) don't. Quarto's literal `{{r}}` has one too. */
export function chunkEngine(info: string): string | null {
  return /^\{+\s*([A-Za-z][\w.+-]*)/.exec(info)?.[1] ?? null;
}

/** The line shown over a chunk's code: the info string without its braces, as the file has it. */
export function chunkHeader(info: string): string {
  return info
    .replace(/^\{+\s*/, '')
    .replace(/\s*\}+\s*$/, '')
    .trim();
}

/** What of a piece of raw HTML is left when its comments are taken out. `inside` says whether the
 * piece starts inside a comment that an earlier piece opened; the state after it is returned. */
export function withoutComments(html: string, inside: boolean): { text: string; inside: boolean } {
  let text = '';
  let rest = html;
  while (rest !== '') {
    if (inside) {
      const close = rest.indexOf('-->');
      if (close < 0) return { text, inside: true };
      rest = rest.slice(close + 3);
      inside = false;
    } else {
      const open = rest.indexOf('<!--');
      if (open < 0) return { text: text + rest, inside: false };
      text += rest.slice(0, open);
      rest = rest.slice(open + 4);
      inside = true;
    }
  }
  return { text, inside };
}

/** The changes to micromark's HTML, with the state they keep for one document. */
function extension(): HtmlExtension {
  // Whether the raw HTML being written is inside a comment: a comment can run over several lines.
  let inComment = false;
  // A chunk's info string, and what follows it on the fence's line.
  let chunk: string | null = null;
  let options = '';

  function rawHtml(context: CompileContext, text: string) {
    const shown = withoutComments(text, inComment);
    inComment = shown.inside;
    context.raw(context.encode(shown.text));
  }

  return {
    enter: {
      htmlFlow() {
        this.lineEndingIfNeeded();
        inComment = false;
      },
      htmlText() {
        inComment = false;
      },
    },
    exit: {
      htmlFlow() {
        inComment = false;
      },
      htmlText() {
        inComment = false;
      },
      htmlFlowData(token) {
        rawHtml(this, this.sliceSerialize(token));
      },
      htmlTextData(token) {
        rawHtml(this, this.sliceSerialize(token));
      },

      codeFencedFenceInfo(token) {
        const language = this.resume();
        const info = this.sliceSerialize(token);
        const engine = chunkEngine(info);
        chunk = isBraced(info) ? info : null;
        options = '';
        if (isBraced(info) && engine === null) return;
        this.tag(` class="language-${engine === null ? language : this.encode(engine)}"`);
      },
      codeFencedFenceMeta(token) {
        this.resume();
        if (chunk !== null) options = this.sliceSerialize(token);
      },
      // micromark's own handler of a fence's end: the first fence closes the tag, and every fence,
      // the closing one too, is counted, which is how the end of the block tells whether it was closed.
      codeFencedFence() {
        const count = this.getData('fencesCount') ?? 0;
        if (count === 0) {
          if (chunk !== null) {
            this.tag(` data-chunk="${this.encode(chunkHeader(`${chunk} ${options}`))}"`);
          }
          chunk = null;
          options = '';
          this.tag('>');
          this.setData('slurpOneLineEnding', true);
        }
        this.setData('fencesCount', count + 1);
      },
    },
  };
}

/** An image as its alt text, in `<span class="rl-image">`. micromark writes an image as
 * `<img src="…" alt="…"( title="…")? />`, with every quote and bracket inside escaped, and nothing
 * else makes the tag: raw HTML is text. */
const IMAGE = /<img src="[^"]*" alt="([^"]*)"(?: title="[^"]*")? \/>/g;

/** `<li>` with the classes that say what it holds: `rl-task` when it starts with a task's box, and
 * `rl-loose` when its first block is a paragraph, as every item of a loose list's is. micromark writes
 * an item as `<li>`, then `\n<p>` when it is loose, then the box (`<input type="checkbox"`). */
const ITEM = /<li>(\n<p>)?(<input type="checkbox")?/g;

function classOfItems(html: string): string {
  return html.replace(ITEM, (item: string, loose?: string, box?: string) => {
    const classes = [...(loose ? ['rl-loose'] : []), ...(box ? ['rl-task'] : [])];
    return classes.length === 0 ? item : `<li class="${classes.join(' ')}">${item.slice(4)}`;
  });
}

/** The HTML of Markdown `source`, to go inside the page's document. */
export function markdownToHtml(source: string): string {
  const html = micromark(source, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml(), extension()],
  });
  return classOfItems(html)
    .replace(IMAGE, '<span class="rl-image">$1</span>')
    .replaceAll('<table>', '<div class="rl-tbl-scroll"><table>')
    .replaceAll('</table>', '</table></div>');
}
