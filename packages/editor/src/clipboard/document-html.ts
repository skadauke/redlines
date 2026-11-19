// A document as clean HTML, with no marks (design §5.10, §6.8): what a printed page, a PDF or a
// file for another program holds. It is the document as it reads now: every pending change accepted
// in the Clean view, every one rejected in the Original, and in both no marker, no comment, no
// ledger and no deleted text. The same Markdown renderer as the clipboard's does the drawing
// (copy-html.ts), with the parts of the language that a selection leaves as text: footnotes,
// alerts, task items and HTML blocks.
//
// YAML front matter is the file's own data, not part of the text, and is left out (the Quick Look
// preview shows it as a table of its own; a printed page does not).
//
// Nothing here is the app's. `documentHtml` takes the file's text and runs anywhere; HTML blocks
// are drawn through the DOM when there is one. `editorDocumentHtml` reads what the host gave the
// editor (its emoji, its way to find a local image, its fonts) from a view.

import type { EditorView } from '@codemirror/view';
import { frontMatterEnd, newestView, originalView } from '@redlines/format';
import { type EmojiLookup, emojiLookup } from '../preview/emoji.ts';
import { renderHtml } from '../preview/html-block.ts';
import { imageResolver, sourceOf } from '../preview/image.ts';
import { type DocumentParts, type FontStacks, markdownToDocumentHtml } from './copy-html.ts';

/** Which text of a file is drawn: every change accepted, or every change rejected. */
export type DocumentViewKind = 'clean' | 'original';

/** What `documentHtml` may be told. */
export interface DocumentHtmlOptions {
  /** The host's emoji for a shortcode; one it doesn't know stays as written. */
  emoji?: EmojiLookup;
  /** The URL for a local image, given its path as `resolveImage` is (`EditorOptions`). */
  resolveImage?: (path: string) => string | null;
  /** The font stacks; by default the document's own CSS variables, which a page defines. */
  fonts?: FontStacks;
  /** Draws HTML blocks as the sanitizer allows. On by default when there is a DOM. */
  htmlBlocks?: boolean;
  /**
   * For a program that pastes, Word or Google Docs, not a page: inline styles instead of the
   * stylesheet's, `<s>` for a strike, borders on table cells, a quote that reads without its rule.
   */
  office?: boolean;
  /** `source` is a selection's text, taken as it is: no front matter, no view, parts as text. */
  clip?: boolean;
  /** Which images (by destination) come out as their alt text. */
  altOnly?: (href: string) => boolean;
  /** An image as a `data:` address, which a program that pastes can't fail to load; else null. */
  embedImage?: (shown: string) => string | null;
}

/** The fonts of the page the HTML goes in, by its CSS variables. */
const PAGE_FONTS: FontStacks = {
  body: 'var(--rl-font-body)',
  heading: 'var(--rl-font-heading)',
  mono: 'var(--rl-font-mono)',
};

/**
 * The text of `source` that the document reads as in `view`, without markers, deleted text, the
 * ledger or YAML front matter.
 */
export function documentText(source: string, view: DocumentViewKind = 'clean'): string {
  let text: string;
  try {
    text = (view === 'original' ? originalView(source) : newestView(source)).text;
  } catch {
    // The format refuses nothing here; a page that can't be made would print nothing at all.
    text = source;
  }
  const end = frontMatterEnd(text);
  return end >= 0 ? text.slice(end) : text;
}

function drawnHtml(source: string, image: (written: string) => string | null): string | null {
  if (typeof document === 'undefined') return null;
  const holder = document.createElement('div');
  holder.appendChild(renderHtml(source, document, image));
  return holder.innerHTML;
}

/**
 * The HTML of the file whose text is `source`, as it reads in `view`: a `div` of headings,
 * paragraphs, lists, tables, code, images and quotes, with no mark of Redlines. Images are the
 * ones `resolveImage` can find, and any other is its alt text.
 */
export function documentHtml(
  source: string,
  view: DocumentViewKind = 'clean',
  options: DocumentHtmlOptions = {},
): string {
  const resolve = options.resolveImage;
  const imageUrl = (written: string): string | null => {
    const found = sourceOf(written);
    if (found.kind === 'remote' || found.kind === 'data') return found.url;
    if (found.kind === 'local') return resolve?.(found.path) ?? null;
    return null;
  };
  const parts: DocumentParts = {
    imageUrl: (written) => {
      const url = imageUrl(written);
      return url !== null && options.embedImage ? (options.embedImage(url) ?? url) : url;
    },
    office: options.office,
    clip: options.clip,
    altOnly: options.altOnly,
    html: options.htmlBlocks === false ? undefined : (source) => drawnHtml(source, imageUrl),
  };
  return markdownToDocumentHtml(
    options.clip ? source : documentText(source, view),
    options.fonts ?? PAGE_FONTS,
    options.emoji,
    parts,
  );
}

/**
 * The HTML of the document that `view` holds, as the window shows it: the Original when the window
 * shows that, the Clean text for every other view, and what the host gave the editor to draw
 * emoji and local images.
 */
export function editorDocumentHtml(view: EditorView, original = false): string {
  const state = view.state;
  return documentHtml(state.doc.toString(), original ? 'original' : 'clean', {
    emoji: state.facet(emojiLookup),
    resolveImage: state.facet(imageResolver) ?? undefined,
  });
}
