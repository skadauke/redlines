// Images the person adds by pasting or dropping them (#308): the editor finds the image files in a
// paste or a drop and hands them to the host, which saves them where the document can reach them and
// says what to link; the links go in at the paste's caret or the drop's point, as the person's own
// insertion (a tracked one while Track Changes is on), which Undo takes back in one step. The
// editor knows nothing of where files are kept: that is the host's (`EditorOptions.onImageFiles`).

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { ImageSpot } from './api.ts';
import { freshImageEffect, freshImageField } from './preview/fresh.ts';
import { rectOf } from './table/cells.ts';
import { untrackedAskFacet } from './tracked/ask.ts';
import { RAW_READ_ONLY, rawIsReadOnly, refusedEditEffect } from './tracked/typing.ts';

/** Why an image doesn't go where the caret is in code, which would show the link as it is. */
export const IMAGE_IN_CODE = 'An image can’t go inside code.';

/** Why an image doesn't go where it would never be drawn: front matter, HTML, a comment, display math, the inside of a link's address or of another image. */
export const IMAGE_NOT_DRAWN = 'An image can’t go here: it wouldn’t be drawn.';

/**
 * What is said when the document was replaced while the images were being saved, so that their
 * links have nowhere to go: they stay where they were saved, and the person is told.
 */
export const DOCUMENT_CHANGED =
  'The document changed before the images were added, so their links weren’t written.';

const ENCODER = new TextEncoder();

/** The characters of a path that a link destination holds as they are: the rest is percent-coded. */
const AS_WRITTEN = /[A-Za-z0-9\-._~!$*+,;=@/]/;

/**
 * A path as a link destination: letters of any language stay as they are, and anything that could
 * end the destination or mean something else in it is a percent code (a space, parentheses, `#` and
 * `?`, `%` itself, `:`, which would make the first name a scheme, and `&`, which could begin a
 * character reference). The preview reads it back the same way (`preview/image.ts`).
 */
function destination(path: string): string {
  return Array.from(path, (char) => {
    if (AS_WRITTEN.test(char) || (char.codePointAt(0)! > 0x7f && !/\s/.test(char))) return char;
    // A percent code for each byte of the character: one for ASCII, more for a space of another kind.
    return Array.from(
      ENCODER.encode(char),
      (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`,
    ).join('');
  }).join('');
}

/** The link of an image at `path`, which is relative to the document: no alt text, as `![](…)`. */
export function imageLink(path: string): string {
  return `![](${destination(path)})`;
}

/** A place the links of images are written. Its ends follow the document as it is edited. */
interface Spot {
  from: number;
  to: number;
  /** The text the spot covers, as it was when it was taken: it is replaced only while it is all there. */
  text: string;
  /** For a spot that covers nothing: whether text written at it goes before the spot or after it. */
  after: boolean;
}

/**
 * The spots that are held, and how they follow the document. One for each editor. Text written at
 * the ends of a spot stays outside it: a spot that covers text takes in none of what is typed at its
 * edges, and one that covers none goes before what is typed at it, as a paste goes before what is
 * typed after it.
 */
const spots = ViewPlugin.define(() => ({
  held: new Set<Spot>(),
  update(update: ViewUpdate) {
    if (!update.docChanged) return;
    for (const spot of this.held) {
      if (spot.from === spot.to && spot.text === '') {
        spot.from = spot.to = update.changes.mapPos(spot.from, spot.after ? 1 : -1);
      } else {
        spot.from = update.changes.mapPos(spot.from, 1);
        spot.to = Math.max(spot.from, update.changes.mapPos(spot.to, -1));
      }
    }
  },
}));

/** What stands for the links in the probe that asks whether the document takes them. */
const PROBE = imageLink('image.png');

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** Whether the syntax at `pos`, looking to its `side`, is in a node called one of `names`. */
function within(state: EditorState, pos: number, side: -1 | 1, names: readonly string[]): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
  for (; node; node = node.parent) if (names.includes(node.name)) return true;
  return false;
}

/**
 * Whether a link at `pos` would be in code, which shows it as it is. In inline code that is between
 * its backticks: right before it or after it is outside, where an image goes. In a code block, at
 * the edge of its fences, and in the indent before its first line or its fence, none of which is in
 * the block's node and all of which a link would break.
 */
function inCode(state: EditorState, pos: number): boolean {
  if (within(state, pos, -1, ['InlineCode']) && within(state, pos, 1, ['InlineCode'])) return true;
  const blocks = ['FencedCode', 'CodeBlock'];
  if (within(state, pos, -1, blocks) || within(state, pos, 1, blocks)) return true;
  const line = state.doc.lineAt(pos);
  const indent = /^[ \t]*/.exec(line.text.slice(pos - line.from))![0].length;
  return indent > 0 && within(state, pos + indent, 1, blocks);
}

/** The nodes a link to an image is never drawn inside of. */
const UNDRAWN = [
  'FrontMatter',
  'HTMLBlock',
  'CommentBlock',
  'Comment',
  'HTMLTag',
  'ProcessingInstruction',
  'Autolink',
  'URL',
  'LinkTitle',
  'Image',
];

/**
 * Whether a link at `pos` is where none is drawn: strictly inside front matter, an HTML block or
 * tag, a comment, the address or title of a link or the alt text or source of another image (its
 * edges are outside it), or inside display math, which the parse doesn't know (`$$` before it an odd
 * number of times, on its lines and in its own).
 */
function undrawn(state: EditorState, pos: number): boolean {
  const node = undrawnNodeAt(state, pos);
  if (node && !(BLOCKS.has(node.name) && markerLed(state, node, pos))) return true;
  return insideMath(state, pos);
}

/** The nodes that are whole blocks, which a tracked change's marker at a line's start makes of a paragraph. */
const BLOCKS = new Set(['HTMLBlock', 'CommentBlock']);

/** A pending change's marker, as docs/format.md §2.1 writes it. */
const MARKER =
  /<!--(?:\/[bcdfghjkmnpqrstvwxz][bcdfghjkmnpqrstvwxz2-9]{3}|(?:ins|del|sub|fmt|hl|cmt|split) [bcdfghjkmnpqrstvwxz][bcdfghjkmnpqrstvwxz2-9]{3}(?: (?:(?!-->).)*)?)-->/g;

/**
 * The node, of the kinds in `UNDRAWN`, that `pos` is strictly inside: the same one on both sides of
 * it, so that the gap between two images or two tags, or between a comment's closer and the next
 * marker, is inside neither.
 */
function undrawnNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  const around = (side: -1 | 1) => {
    for (
      let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      if (UNDRAWN.includes(node.name)) return node;
    }
    return null;
  };
  const before = around(-1);
  const after = around(1);
  return before && after && before.from === after.from && before.to === after.to ? before : null;
}

/**
 * Whether the block `node`, which holds `pos`, is a paragraph that a pending change's marker at its
 * start made an HTML block (a line that begins `<!--` is one to the `-->`), and `pos` is outside the
 * markers in it: an image goes there, as in any paragraph.
 */
function markerLed(state: EditorState, node: SyntaxNode, pos: number): boolean {
  const text = state.sliceDoc(node.from, node.to);
  const first = new RegExp(MARKER.source, 'y').exec(text);
  if (!first) return false;
  for (const found of text.matchAll(MARKER)) {
    const from = node.from + found.index;
    if (pos > from && pos < from + found[0].length) return false;
  }
  return true;
}

/**
 * Whether `pos` is inside display math, which the parse doesn't know: the `$$` before it, counted
 * outside fenced code and inline code, are odd in number.
 */
function insideMath(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  const count = (text: string) => (text.replace(/`+[^`]*`+/g, '').match(/\$\$/g) ?? []).length;
  let opened = count(line.text.slice(0, pos - line.from));
  let fence = false;
  for (let n = 1; n < line.number; n++) {
    const text = state.doc.line(n).text;
    if (/^\s*(?:```|~~~)/.test(text)) fence = !fence;
    else if (!fence) opened += count(text);
  }
  return opened % 2 === 1;
}

/**
 * Why the document takes no image in `from`–`to`, or null when it does: in code, where none is
 * drawn, or by what the edit would be refused for, asked of the editing rules themselves so that none is repeated here.
 */
function refusal(state: EditorState, from: number, to: number): string | null {
  if (inCode(state, from)) return IMAGE_IN_CODE;
  if (undrawn(state, from)) return IMAGE_NOT_DRAWN;
  const probe = state.update({
    changes: { from, to, insert: PROBE },
    userEvent: 'input.image',
  });
  const refused = probe.effects.find((effect) => effect.is(refusedEditEffect));
  if (refused) return refused.value;
  return probe.docChanged ? null : IMAGE_IN_CODE;
}

/**
 * The position of the text under the client point `at`, or null when the point is over none: over
 * the sidebar, the title bar or a card, or below the end of the document. CodeMirror gives a position
 * for any point, the start or the end of the document for one above or below the text and the
 * nearest on a line for one beside it, so what is under the point is asked first. That holds for a
 * scrolled document too, whose text goes on under the title bar.
 */
function textAt(view: EditorView, at: { x: number; y: number }): number | null {
  const hit = view.root.elementFromPoint(at.x, at.y);
  return hit && view.contentDOM.contains(hit) ? view.posAtCoords(at) : null;
}

/**
 * A spot for the links of images: where the client point `at` is in the text, if given and over
 * some, else the selection, which a paste replaces and a drop leaves. A point that is over no text,
 * in a margin, the sidebar or below the text, is no place: the caret is. Null when the document
 * takes no image there, which `notice` then says.
 */
export function imageSpot(
  view: EditorView,
  at: { x: number; y: number } | undefined,
  notice: ((message: string) => void) | undefined,
): ImageSpot | null {
  const plugin = view.plugin(spots);
  if (!plugin) return null;
  const { state } = view;
  const { main } = state.selection;
  const point = at ? textAt(view, at) : null;
  // Cells selected are no one place for a link, and replacing them would take the table apart.
  const range =
    point != null
      ? { from: point, to: point }
      : at || main.empty || rectOf(state)
        ? { from: main.head, to: main.head }
        : { from: main.from, to: main.to };
  const reason = refusal(state, range.from, range.to);
  if (reason !== null) {
    notice?.(reason);
    return null;
  }
  const spot: Spot = { ...range, text: state.sliceDoc(range.from, range.to), after: false };
  plugin.held.add(spot);
  /** Used, let go, or lost with its document: nothing more is written. */
  let spent = false;
  const letGo = () => {
    spent = true;
    return view.plugin(spots)?.held.delete(spot) ?? false;
  };
  return {
    insert: (paths) => {
      if (spent || !paths.length) return false;
      const held = view.plugin(spots)?.held;
      if (!held?.has(spot)) {
        // The document was replaced since, and the spot went with it.
        spent = true;
        notice?.(DOCUMENT_CHANGED);
        return false;
      }
      const before = view.state.doc;
      const { selection } = view.state;
      // The text the spot covers is replaced only while it is all there: what was typed or written
      // in it since stays, and the links go after it.
      const replaces = before.sliceString(spot.from, spot.to) === spot.text;
      const from = replaces ? spot.from : spot.to;
      // The caret goes with the links only if it is still where they came, not if the person has
      // moved on while they were saved.
      const atSpot =
        selection.ranges.length === 1 &&
        selection.main.from >= spot.from &&
        selection.main.to <= spot.to;
      // Where the links end, once Track Changes has put its markers around them.
      const end: Spot = { from: spot.to, to: spot.to, text: '', after: true };
      held.add(end);
      try {
        view.dispatch({
          changes: { from, to: spot.to, insert: paths.map(imageLink).join(' ') },
          userEvent: 'input.image',
        });
      } finally {
        letGo();
        held.delete(end);
      }
      // The editing rules refused it, and said why through `onNotice`: nothing was written.
      if (view.state.doc === before) return false;
      if (atSpot) {
        // The caret is at the end of the links, as a paste leaves it, where the preview draws the
        // image all the same (`freshImageField`).
        view.dispatch({ selection: { anchor: end.to }, scrollIntoView: true });
        // Where the caret rests: the end of the links, or in front of the hidden closer that ends
        // the body's text when that is where the end is (#393).
        view.dispatch({ effects: freshImageEffect.of(view.state.selection.main.head) });
      }
      return true;
    },
    release: () => void letGo(),
  };
}

/** The image files on a clipboard or in a drop, unless it holds web content (design §5.10). */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data || data.getData('text/html')) return [];
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

/**
 * The spots that images being added will be written at, and, when the host takes images, the
 * paste and drop of image files: they go to the host with their spot, and the page does nothing
 * with them itself, not even where there is no spot to give.
 */
export function images(
  onImageFiles: ((files: File[], spot: ImageSpot, pasted: boolean) => void) | undefined,
  notice: ((message: string) => void) | undefined,
): Extension {
  if (!onImageFiles) return [spots, freshImageField];
  const take = (
    event: Event,
    view: EditorView,
    files: File[],
    pasted: boolean,
    at?: { x: number; y: number },
  ) => {
    if (!files.length) return false;
    event.preventDefault();
    // Raw while edits are tracked takes no file: a file holds no text to ask about, so this says why
    // (the text of a paste or a drop is the sheet's, or `rawEditsRefused`'s where nothing asks).
    if (rawIsReadOnly(view.state)) {
      // Where nothing asks, `rawEditsRefused` has said it.
      if (view.state.facet(untrackedAskFacet)) notice?.(RAW_READ_ONLY);
      return true;
    }
    const spot = imageSpot(view, at, notice);
    if (spot) onImageFiles(files, spot, pasted);
    return true;
  };
  return [
    spots,
    freshImageField,
    EditorView.domEventHandlers({
      paste: (event, view) => take(event, view, imageFiles(event.clipboardData), true),
      drop: (event, view) =>
        take(event, view, imageFiles(event.dataTransfer), false, {
          x: event.clientX,
          y: event.clientY,
        }),
    }),
  ];
}
