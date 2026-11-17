// Copy, cut and paste (design §5.10). In Clean and Redlines, what is copied or cut is the newest
// text of the selection (format §8): what it reads with every change accepted, without markers,
// deleted text or the ledger. Plain copies the source as written.
//
// A paste never creates marks from the clipboard's content. In Clean and Redlines, pasted text that
// holds Redlines markup becomes its newest text before it goes in, so it is plain text of the
// paster's own, an insertion of theirs while Track Changes is on. Plain, where markup is edited by
// hand, pastes the text as it is.
//
// Rich text goes both ways outside Plain. A copy also puts the same newest text on the clipboard as
// HTML (clipboard/copy-html.ts), and a paste whose clipboard has HTML that says more than its plain
// text is turned into Markdown (clipboard/paste-html.ts), which then goes in as a plain-text paste
// does, through the guard above. Paste as Plain Text never reads HTML: it sends the text alone.

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import type { ImageSpot } from '../api.ts';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  newestView,
  parse,
  type Range,
  serializeLedger,
  type Thread,
  type WarningCode,
  plainPayload,
} from '@redlines/format';
import { type FontStacks, destination, fontStack } from '../clipboard/copy-html.ts';
import { documentHtml } from '../clipboard/document-html.ts';
import { imageReader, imageResolver, sourceOf } from '../preview/image.ts';
import {
  type PictureSink,
  htmlToMarkdown,
  htmlToRange,
  withPictureLinks,
} from '../clipboard/paste-html.ts';
import { noticeFacet } from '../image-size.ts';
import { destination as pathDestination, imageSaverFacet } from '../images.ts';
import { place } from '../clipboard/place.ts';
import { pasteListItems } from '../blocks/keys.ts';
import { LOOKS_LIKE_ITEMS } from '../blocks/paste.ts';
import { emojiLookup } from '../preview/emoji.ts';
import { heldRemoteImages } from '../preview/image.ts';
import { headCell, rectOf } from '../table/cells.ts';
import {
  cellFromPlain,
  copyOfCells,
  partsToHtml,
  type TableCopy,
  tsvToRange,
} from '../table/clipboard.ts';
import { pasteRange } from '../table/paste.ts';
import { viewModeField } from './field.ts';

/** The warnings the format gives a marker that makes no mark, with the marker's range. */
const STRAY: ReadonlySet<WarningCode> = new Set([
  'unclosed-mark',
  'unopened-close',
  'kind-mismatch',
  'duplicate-id',
]);

/** A comment's anchor, whose thread may be in another file's ledger. */
const ANCHOR = /<!--cmt ([a-z0-9]{4})(?: [^\r\n]*?)?-->/g;

/**
 * The newest text of `text`. Comment anchors whose threads are not in its own ledger are content to
 * the format; given threads of their own, they are marks too, which the newest text leaves out.
 */
function newest(text: string): string {
  const own = newestView(text).text;
  const ids = [...new Set(Array.from(own.matchAll(ANCHOR), ([, id]) => id!))];
  if (!ids.length) return own;
  const threads = ids.map((id): Thread => ({
    id,
    by: 'unknown',
    at: '',
    likes: [],
    replies: [],
    text: '',
  }));
  const ledger = serializeLedger({ version: 1, people: [], marks: {}, comments: threads });
  const result = newestView(`${own}\n\n${ledger}`).text;
  // In code, such as an unclosed fence, the ledger is text too, and the anchors make no marks.
  return result.includes(ledger) ? own : result;
}

/** `text` without the markers that make no mark in it. */
function withoutStrays(text: string): string {
  const strays: Range[] = parse(text)
    .warnings.flatMap(({ code, range }) => (STRAY.has(code) && range ? [range] : []))
    .sort((a, b) => b.from - a.from);
  let result = text;
  let end = Infinity;
  for (const { from, to } of strays) {
    if (to > end) continue;
    result = result.slice(0, from) + result.slice(to);
    end = from;
  }
  return result;
}

/**
 * Text as plain text, for a paste: its newest text (format §8), without the markers of its marks,
 * the text they deleted or its ledger, and without the markers that make no mark in it alone but
 * would where it is pasted, such as an opener whose closer was left behind, or the anchor of a
 * thread in another file's ledger. Text without markup comes back as it is, as does markup in code.
 */
export function plainText(text: string): string {
  let plain = text;
  // Taking markers out can bring the halves of another together; a few rounds are plenty.
  for (let round = 0; round < 4 && plain.includes('<!--'); round++) {
    const next = withoutStrays(newest(plain));
    if (next === plain) break;
    plain = next;
  }
  return plain;
}

/** What CodeMirror copies: the selected text, or with nothing selected the lines of the carets. */
function copiedRanges(state: EditorState): Range[] {
  const selected = state.selection.ranges.filter((range) => !range.empty);
  if (selected.length) return selected;
  const lines: Range[] = [];
  let last = -1;
  for (const { from } of state.selection.ranges) {
    const line = state.doc.lineAt(from);
    if (line.number > last) lines.push({ from: line.from, to: line.to });
    last = line.number;
  }
  return lines;
}

/** The text to copy, given as written: the newest text of what is copied. */
function copiedText(text: string, state: EditorState): string {
  const ranges = copiedRanges(state);
  const written = ranges.map(({ from, to }) => state.sliceDoc(from, to)).join(state.lineBreak);
  // Text from elsewhere than the selection, such as a dragged widget, is read on its own.
  if (written !== text) return plainText(text);
  const { text: shown, map } = newestView(state.doc.toString());
  const newestText = ranges
    .map(({ from, to }) => shown.slice(map.fromSource(from), map.fromSource(to)))
    .join(state.lineBreak);
  // A selection of nothing but pending deleted text copies what is seen: the struck text, as plain
  // text, with no marks (#35). Clean shows no deletion, and copies nothing.
  if (newestText === '' && state.field(viewModeField) !== 'clean') {
    return struckText(state, ranges) ?? newestText;
  }
  return newestText;
}

/**
 * The old text of the pending deletions that `ranges` hold, in order, as plain text; null when they
 * hold none.
 */
function struckText(state: EditorState, ranges: readonly Range[]): string | null {
  const { marks } = parse(state.doc.toString());
  const parts: string[] = [];
  for (const { from, to } of ranges) {
    for (const mark of marks) {
      if (mark.kind !== 'del') continue;
      const open = mark.segments[0]?.open;
      if (open && open.from < to && from < open.to) parts.push(plainPayload(mark.payload ?? ''));
    }
  }
  return parts.length ? parts.join(state.lineBreak) : null;
}

const raw = (state: EditorState) => state.field(viewModeField) === 'raw';

/** The document fonts the editor is showing, as stacks for a target that may not have them. */
function fontsOf(view: EditorView): FontStacks {
  const read = (name: string) =>
    view.dom.style.getPropertyValue(name).trim() ||
    (typeof getComputedStyle === 'function'
      ? getComputedStyle(view.dom).getPropertyValue(name).trim()
      : '');
  const body = read('--rl-font-body');
  return {
    body: fontStack(body),
    heading: fontStack(read('--rl-font-heading') || body),
    mono: fontStack(read('--rl-font-mono') || 'Cousine'),
  };
}

/** The files of a selection's local images, read ahead by the host: the URL they show at, as data. */
const fetched = new WeakMap<EditorView, Map<string, string>>();
const IMAGE_MARKUP = /!\[[^\]]*\]\(\s*(<[^>\n]*>|[^\s)]+)|\bsrc="([^"\n]*)"/g;
/** The most text of a selection that is searched for images, and the images read for one. */
const SEARCHED = 400_000;
const MOST_IMAGES = 12;

/**
 * Reads the local images of the selection through the host, while the person reaches for the copy
 * key, so that the copy (which can only write the clipboard before its event ends) has the bytes.
 * An image not read in time is copied by its address.
 */
function readAhead(view: EditorView): void {
  const reader = view.state.facet(imageReader);
  const resolve = view.state.facet(imageResolver);
  if (!reader || !resolve) return;
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  const text = view.state.sliceDoc(from, Math.min(to, from + SEARCHED));
  // Each selection reads its images again, so that a file saved since is not copied as it was, and
  // nothing outlives the selection it was read for.
  const known = new Map<string, string>();
  fetched.set(view, known);
  const seen = new Set<string>();
  for (const match of text.matchAll(IMAGE_MARKUP)) {
    const found = sourceOf(destination(match[1] ?? match[2] ?? ''));
    if (found.kind !== 'local' || seen.size >= MOST_IMAGES) continue;
    const shown = resolve(found.path);
    if (shown === null || seen.has(shown)) continue;
    seen.add(shown);
    reader(found.path)
      .then((file) => {
        // A newer selection has its own map by now; this one is dropped.
        if (file && fetched.get(view) === known) {
          known.set(shown, `data:${file.mimeType};base64,${file.data}`);
        }
      })
      .catch(() => undefined);
  }
}

/**
 * An image the editor has drawn, as a `data:` address, which Word and Google Docs load where they
 * fail a remote or local one. Null when it isn't loaded here or the page may not read its pixels.
 */
function embedded(view: EditorView, shown: string): string | null {
  if (shown.startsWith('data:') || typeof document === 'undefined') return shown;
  const read = fetched.get(view)?.get(shown);
  if (read) return read;
  for (const img of Array.from(view.dom.querySelectorAll('img'))) {
    if (img.src !== shown && img.getAttribute('src') !== shown) continue;
    if (!img.complete || !img.naturalWidth) return null;
    // A picture too large to copy in a keystroke stays an address.
    if (img.naturalWidth * img.naturalHeight > 12_000_000) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(img, 0, 0);
      const url = canvas.toDataURL('image/png');
      return url.startsWith('data:image') && url.length < 8_000_000 ? url : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether `pos` is in code, where a paste is text as it is. */
function inCode(state: EditorState, pos: number): boolean {
  for (
    let node = syntaxTree(state).resolveInner(pos, -1) as { name: string; parent: unknown } | null;
    node;
  ) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode')
      return true;
    node = node.parent as typeof node;
  }
  return false;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The paste events of Paste as Plain Text, which never read HTML and put anything in as text. */
export const plainPastes = new WeakSet<Event>();

/** Whether this editor wrote the clipboard's HTML: its wrapper says so. */
const OWN_WRAPPER = /<div\s[^>]*\bdata-redlines[\s=>/]/i;

/** The Markdown of a paste's HTML, or nothing when the plain text is what to paste. */
function pastedMarkdown(
  data: DataTransfer,
  ownText: string | null,
  pictures?: PictureSink,
): string | null {
  const html = data.getData('text/html');
  if (!html) return null;
  // Redlines' own copy is Markdown already: its plain text is the source, and the HTML would only
  // lose what Markdown has and HTML hasn't (references, footnotes, comments, raw HTML). A page
  // could forge the attribute, and gets what plain text gets.
  // Cells copied here, pasted outside a table, are a table (a range), not the tab-separated text.
  const cells = /<table[\s>]/i.test(html) && data.getData('text/plain').includes('\t');
  if (
    !cells &&
    (OWN_WRAPPER.test(html) || (ownText !== null && data.getData('text/plain') === ownText))
  ) {
    return null;
  }
  const markdown = htmlToMarkdown(html, pictures);
  const plain = squash(data.getData('text/plain'));
  // A single link to its own address, or markup around the same words, adds nothing.
  if (
    !markdown ||
    squash(markdown) === plain ||
    squash(markdown.replace(/^<(.*)>$/, '$1')) === plain
  ) {
    return null;
  }
  return markdown;
}

/**
 * A paste into a table's cells, which is the table's to place: a range (an HTML table, or text with
 * tabs) over the cells, one value into each selected cell, Paste as Plain Text as text with its tabs
 * as spaces. False for a paste the text way suits (a value at a caret in a cell, anything outside a
 * table).
 */
function pasteInCells(view: EditorView, event: ClipboardEvent, ownText: string | null): boolean {
  const data = event.clipboardData;
  const { state } = view;
  if (!data || (!rectOf(state) && !headCell(state))) return false;
  // As every paste: the newest text of what is on the clipboard, never a live marker (design §5.10).
  const text = plainText(data.getData('text/plain')).replace(/(?:\r?\n)+$/, '');
  if (plainPastes.has(event)) {
    if (!text) return false;
    if (rectOf(state)) return pasteRange(view, [[cellFromPlain(text)]]);
    view.dispatch({
      ...state.replaceSelection(text.replace(/\t/g, ' ')),
      userEvent: 'input.paste',
      scrollIntoView: true,
    });
    return true;
  }
  const html = data.getData('text/html');
  const range = (html ? htmlToRange(html) : null) ?? tsvToRange(text);
  if (range)
    return pasteRange(
      view,
      range.map((row) => row.map(plainText)),
    );
  // One value onto selected cells: into every one of them.
  const rect = rectOf(state);
  if (!rect) return false;
  const markdown = pastedMarkdown(data, ownText);
  const value = cellFromPlain(markdown === null ? text : plainText(markdown));
  return pasteRange(view, [[value]]);
}

/** A paste of list items into a list item, made; false for any other paste. */
function listPaste(view: EditorView, text: string): boolean {
  if (!LOOKS_LIKE_ITEMS.test(text)) return false;
  const plain = plainText(text);
  return plain !== '' && pasteListItems(view, plain);
}

/** Pastes Markdown at the selection, as the person's own insertion, through a paste of plain text. */
function pasteMarkdown(view: EditorView, markdown: string): void {
  const { from, to } = view.state.selection.main;
  const placed = place(view.state, plainText(markdown), from, to);
  // After a `<` of the document's own, a paste must not begin a tag or a comment.
  if (from > 0 && view.state.sliceDoc(from - 1, from) === '<') {
    placed.text = placed.text.replace(/^[!?/]|^[A-Za-z]/, (c) =>
      /[A-Za-z]/.test(c) ? `&#${c.charCodeAt(0)};` : `\\${c}`,
    );
  }
  if ('rest' in placed) {
    // The first paragraph joins a heading's or a link's line, the rest follows the line.
    view.dispatch({
      changes: [
        { from, to, insert: placed.text },
        { from: placed.at, insert: plainText(placed.rest) },
      ],
      selection: { anchor: from + placed.text.length },
      userEvent: 'input.paste',
      scrollIntoView: true,
    });
    return;
  }
  // The Markdown goes in as plain text does, in a paste event of its own with no HTML.
  const converted = new DataTransfer();
  converted.setData('text/plain', placed.text);
  view.contentDOM.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: converted, bubbles: true, cancelable: true }),
  );
}

/**
 * Saves one picture through the host, as a pasted screenshot is saved, and resolves to the path its
 * link goes by, or null when the host said no (it says why through its own notice).
 */
function savePicture(
  save: (files: File[], spot: ImageSpot, pasted: boolean) => void,
  picture: PictureSink['pictures'][number],
): Promise<string | null> {
  return new Promise((resolve) => {
    const file = new File([picture.bytes], `image.${picture.extension}`, { type: picture.type });
    let settled = false;
    const spot: ImageSpot = {
      insert: (paths) => {
        if (settled) return false;
        settled = true;
        resolve(paths[0] ?? null);
        return true;
      },
      release: () => {
        if (settled) return;
        settled = true;
        resolve(null);
      },
    };
    try {
      save([file], spot, true);
    } catch {
      spot.release();
    }
  });
}

/**
 * A paste whose HTML holds pictures (Word's come with their bytes): each is saved through the host,
 * one after another, and the Markdown goes in with links to the saved files. A picture that can't be
 * saved is left out, and the person is told, never silently: the pictures that stay linked to a web
 * address are said to be so too.
 */
async function pasteWithPictures(
  view: EditorView,
  markdown: string,
  found: PictureSink,
): Promise<void> {
  const notice = view.state.facet(noticeFacet);
  const save = view.state.facet(imageSaverFacet);
  const paths: (string | null)[] = [];
  if (save) for (const picture of found.pictures) paths.push(await savePicture(save, picture));
  if (!view.dom.isConnected) return;
  const left = found.pictures.length - paths.filter((path) => path !== null).length;
  const parts: string[] = [];
  if (left || found.unreadable) {
    const count = left + found.unreadable;
    parts.push(
      save
        ? `${count === 1 ? 'A picture' : `${count} pictures`} couldn’t be added from the paste.`
        : `${count === 1 ? 'A picture' : `${count} pictures`} in the paste ${count === 1 ? 'wasn’t' : 'weren’t'} added: this window can’t save pictures.`,
    );
  }
  if (found.linked) {
    parts.push(
      `${found.linked === 1 ? 'A picture stays' : `${found.linked} pictures stay`} linked to ${found.linked === 1 ? 'its' : 'their'} web address: ${found.linked === 1 ? 'it isn’t' : 'they aren’t'} saved in the document’s images folder.`,
    );
  }
  const text = withPictureLinks(markdown, (index) => {
    const path = paths[index];
    return path ? pathDestination(path) : null;
  });
  if (text) pasteMarkdown(view, text);
  if (parts.length) notice?.(parts.join(' '));
}

/** Copy, cut, drag and paste of the newest text, outside Plain. */
export function clipboard(): Extension {
  // The text this editor last put on the clipboard, which it knows again when it is pasted.
  let lastCopied: string | null = null;
  // The remote images of the selection that the preview doesn't fetch, found when the text is
  // taken, which is before a cut removes it: those come out as alt text.
  let held: Set<string> | null = new Set();
  // Cells being copied: the tab-separated text goes out as the plain text, and the HTML is made from
  // the cells themselves, not from that text.
  let cells: TableCopy | null = null;
  return [
    // On the editor's root, whose listeners run after CodeMirror's on its content, which clears the
    // clipboard before it writes the text. The HTML is made from the text that was just written.
    ViewPlugin.define((view) => {
      const copied = (event: Event) => {
        const data = (event as ClipboardEvent).clipboardData;
        if (!data || !event.defaultPrevented || raw(view.state)) return;
        const text = data.getData('text/plain');
        if (!text) return;
        lastCopied = text;
        const holding = held;
        const altOnly = (href: string) =>
          holding === null || [...holding].some((url) => destination(url) === href);
        const lookup = view.state.facet(emojiLookup);
        const own = cells && cells.text === text ? cells : null;
        cells = null;
        data.setData(
          'text/html',
          own
            ? partsToHtml(own.parts, fontsOf(view), altOnly, lookup)
            : documentHtml(text, 'clean', {
                office: true,
                clip: true,
                fonts: fontsOf(view),
                emoji: lookup,
                altOnly,
                resolveImage: view.state.facet(imageResolver) ?? ((path) => path),
                embedImage: (shown) => embedded(view, shown),
              }),
        );
      };
      view.dom.addEventListener('copy', copied);
      view.dom.addEventListener('cut', copied);
      return {
        update: (update: ViewUpdate) => {
          if (update.selectionSet && !raw(update.state)) readAhead(view);
        },
        destroy: () => {
          view.dom.removeEventListener('copy', copied);
          view.dom.removeEventListener('cut', copied);
        },
      };
    }),
    EditorView.clipboardOutputFilter.of((text, state) => {
      if (raw(state)) return text;
      held = heldRemoteImages(state);
      cells = copyOfCells(state);
      return cells ? cells.text : copiedText(text, state);
    }),
    EditorView.domEventHandlers({
      paste(event, view) {
        const data = event.clipboardData;
        if (!data || raw(view.state) || inCode(view.state, view.state.selection.main.head)) {
          return false;
        }
        if (pasteInCells(view, event, lastCopied)) {
          event.preventDefault();
          return true;
        }
        const pictures: PictureSink = {
          pictures: [],
          unreadable: 0,
          linked: 0,
          read: new Map(),
        };
        const markdown = pastedMarkdown(data, lastCopied, pictures);
        // List items into a list item are items of that list, whether they came as Markdown or as
        // plain text; one step to undo (blocks/paste.ts).
        if (
          !plainPastes.has(event) &&
          !pictures.pictures.length &&
          listPaste(view, markdown ?? data.getData('text/plain'))
        ) {
          event.preventDefault();
          return true;
        }
        if (markdown === null) return false;
        event.preventDefault();
        if (!pictures.pictures.length && !pictures.unreadable && !pictures.linked) {
          pasteMarkdown(view, markdown);
          return true;
        }
        void pasteWithPictures(view, markdown, pictures);
        return true;
      },
    }),
    EditorView.clipboardInputFilter.of((text, state) => (raw(state) ? text : plainText(text))),
  ];
}
