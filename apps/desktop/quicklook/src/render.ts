// The preview of a Markdown, R Markdown or Quarto file in the Clean view (design §5.3): the file
// with every pending change accepted, drawn in the Default theme, under one line that says what is
// waiting in it and points to the app. The markers and the ledger never show. The Swift extension
// calls `redlinesPreview` in JavaScriptCore (entry.ts), and this runs nothing but the language.

import { frontMatterEnd, newestView } from '@redlines/format';
import { markdownImages, markdownToHtml, type LoadedImages } from './markdown.ts';
import { page } from './page.ts';
import { noticeOf } from './summary.ts';

/** The most of a document that a preview draws, in characters, after its changes are accepted. A
 * longer one is drawn as far as its last paragraph under this, and says so. Quick Look gives an
 * extension seconds, and micromark in JavaScriptCore draws this much in a second or so (0.5 s on an
 * Apple silicon Mac, with the compiler that the extension's entitlements allow; 5 to 8 times that
 * without it). */
export const MAX_CHARS = 300_000;

const CUT_SHORT =
  'This preview shows the first part of a long document. Open it in Redlines to read all of it.';

/** A blank line, in a file with LF or CRLF line breaks. */
const BLANK_LINE = /\r?\n[ \t]*\r?\n/g;

/** `text` cut short at the last blank line under `limit`, or at `limit` when there is none in its
 * second half. */
export function firstPart(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let blank = -1;
  for (const found of text.slice(0, limit).matchAll(BLANK_LINE)) blank = found.index;
  return text.slice(0, blank > limit / 2 ? blank : limit);
}

/** What of a file's text a preview draws, and what goes round it. */
interface Prepared {
  notice: string | null;
  frontMatter: string | null;
  /** The part of the document that is drawn, in the Clean view. */
  shown: string;
  /** Whether it is cut short. */
  more: boolean;
}

function prepare(source: string, cut: boolean): Prepared {
  let text = source;
  try {
    text = newestView(source).text;
  } catch {
    // The format refuses nothing here, but a preview that fails shows nothing at all. What is left
    // draws as the same words: the markers are comments, which are not shown (markdown.ts).
  }
  let notice: string | null = null;
  if (!cut) {
    try {
      notice = noticeOf(source);
    } catch {
      notice = null;
    }
  }
  const end = frontMatterEnd(text);
  const frontMatter = end >= 0 ? text.slice(0, end) : null;
  const rest = end >= 0 ? text.slice(end) : text;
  const shown = firstPart(rest, MAX_CHARS);
  return { notice, frontMatter, shown, more: cut || shown.length < rest.length };
}

/**
 * The local images that the page for a file would draw, as the document wrote their paths: what the
 * host (the extension) may load from beside the file, to give back to `renderPreview`. None, and
 * quickly, for a document with no image in it.
 */
export function previewImages(source: string, cut = false): string[] {
  const { shown } = prepare(source, cut);
  return shown.includes('![') ? markdownImages(shown) : [];
}

/**
 * The page for the file `name`, whose text is `source`. `cut` says that the host gave only the start
 * of a long file: its ledger is not in `source`, so who changed what can't be said. `images` are
 * the local images that the host loaded, which the page draws; any other is its alt text.
 */
export function renderPreview(
  source: string,
  name: string,
  cut = false,
  images: LoadedImages = new Map(),
): string {
  const { notice, frontMatter, shown, more } = prepare(source, cut);
  return page({
    title: name,
    notice,
    frontMatter,
    body: markdownToHtml(shown, images),
    after: more ? CUT_SHORT : null,
  });
}
