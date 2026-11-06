// Copy, cut and paste (design §5.10). In Clean and Redlines, what is copied or cut is the newest
// text of the selection (format §8): what it reads with every change accepted, without markers,
// deleted text or the ledger. Raw copies the source as written.
//
// A paste never creates marks from the clipboard's content. In Clean and Redlines, pasted text that
// holds Redlines markup becomes its newest text before it goes in, so it is plain text of the
// paster's own, an insertion of theirs while Track Changes is on. Raw, where markup is edited by
// hand, pastes the text as it is.
//
// Rich text goes both ways outside Raw. A copy also puts the same newest text on the clipboard as
// HTML (clipboard/copy-html.ts), and a paste whose clipboard has HTML that says more than its plain
// text is turned into Markdown (clipboard/paste-html.ts), which then goes in as a plain-text paste
// does, through the guard above. Paste as Plain Text never reads HTML: it sends the text alone.

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import {
  newestView,
  parse,
  type Range,
  serializeLedger,
  type Thread,
  type WarningCode,
} from '@redlines/format';
import { type FontStacks, destination, fontStack, markdownToHtml } from '../clipboard/copy-html.ts';
import { htmlToMarkdown } from '../clipboard/paste-html.ts';
import { place } from '../clipboard/place.ts';
import { heldRemoteImages } from '../preview/image.ts';
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
  return ranges
    .map(({ from, to }) => shown.slice(map.fromSource(from), map.fromSource(to)))
    .join(state.lineBreak);
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

/** Whether this editor wrote the clipboard's HTML: its wrapper says so. */
const OWN_WRAPPER = /<div\s[^>]*\bdata-redlines[\s=>/]/i;

/** The Markdown of a paste's HTML, or nothing when the plain text is what to paste. */
function pastedMarkdown(data: DataTransfer, ownText: string | null): string | null {
  const html = data.getData('text/html');
  if (!html) return null;
  // Redlines' own copy is Markdown already: its plain text is the source, and the HTML would only
  // lose what Markdown has and HTML hasn't (references, footnotes, comments, raw HTML). A page
  // could forge the attribute, and gets what plain text gets.
  if (OWN_WRAPPER.test(html) || (ownText !== null && data.getData('text/plain') === ownText)) {
    return null;
  }
  const markdown = htmlToMarkdown(html);
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

/** Copy, cut, drag and paste of the newest text, outside Raw. */
export function clipboard(): Extension {
  // The text this editor last put on the clipboard, which it knows again when it is pasted.
  let lastCopied: string | null = null;
  // The remote images of the selection that the preview doesn't fetch, found when the text is
  // taken, which is before a cut removes it: those come out as alt text.
  let held: Set<string> | null = new Set();
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
        data.setData('text/html', markdownToHtml(text, fontsOf(view), altOnly));
      };
      view.dom.addEventListener('copy', copied);
      view.dom.addEventListener('cut', copied);
      return {
        destroy: () => {
          view.dom.removeEventListener('copy', copied);
          view.dom.removeEventListener('cut', copied);
        },
      };
    }),
    EditorView.clipboardOutputFilter.of((text, state) => {
      if (raw(state)) return text;
      held = heldRemoteImages(state);
      return copiedText(text, state);
    }),
    EditorView.domEventHandlers({
      paste(event, view) {
        const data = event.clipboardData;
        if (!data || raw(view.state) || inCode(view.state, view.state.selection.main.head)) {
          return false;
        }
        const markdown = pastedMarkdown(data, lastCopied);
        if (markdown === null) return false;
        event.preventDefault();
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
          return true;
        }
        // The Markdown goes in as plain text does, in a paste event of its own with no HTML.
        const converted = new DataTransfer();
        converted.setData('text/plain', placed.text);
        view.contentDOM.dispatchEvent(
          new ClipboardEvent('paste', {
            clipboardData: converted,
            bubbles: true,
            cancelable: true,
          }),
        );
        return true;
      },
    }),
    EditorView.clipboardInputFilter.of((text, state) => (raw(state) ? text : plainText(text))),
  ];
}
