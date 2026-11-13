// Images the person adds by pasting or dropping them (#308): the editor finds the image files in a
// paste or a drop and hands them to the host, which saves them where the document can reach them and
// says what to link; the links go in at the paste's caret or the drop's point, as the person's own
// insertion (a tracked one while Track Changes is on), which Undo takes back in one step. The
// editor knows nothing of where files are kept: that is the host's (`EditorOptions.onImageFiles`).

import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { ImageSpot } from './api.ts';
import { rectOf } from './table/cells.ts';
import { inCode } from './tracked/clipboard.ts';
import { rawIsReadOnly, refusedEditEffect } from './tracked/typing.ts';

/** Why an image doesn't go where the caret is in code, which would show the link as it is. */
export const IMAGE_IN_CODE = 'An image can’t go inside code.';

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
}

/** The spots that are held, and how they follow the document. One for each editor. */
const spots = ViewPlugin.define(() => ({
  held: new Set<Spot>(),
  update(update: ViewUpdate) {
    if (!update.docChanged) return;
    for (const spot of this.held) {
      spot.from = update.changes.mapPos(spot.from, -1);
      spot.to = update.changes.mapPos(spot.to, 1);
    }
  },
}));

/** What stands for the links in the probe that asks whether the document takes them. */
const PROBE = imageLink('image.png');

/**
 * Why the document takes no image in `from`–`to`, or null when it does: in code, or by what the
 * edit would be refused for, asked of the editing rules themselves so that none is repeated here.
 */
function refusal(state: EditorState, from: number, to: number): string | null {
  if (inCode(state, from)) return IMAGE_IN_CODE;
  const probe = state.update({
    changes: { from, to, insert: PROBE },
    userEvent: 'input.image',
  });
  const refused = probe.effects.find((effect) => effect.is(refusedEditEffect));
  if (refused) return refused.value;
  return probe.docChanged ? null : IMAGE_IN_CODE;
}

/**
 * A spot for the links of images: where the client point `at` is in the text, if given and over
 * some, else the selection, which a paste replaces and a drop leaves. Null when the document takes
 * no image there, which `notice` then says.
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
  const point = at && view.posAtCoords(at, false);
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
  const spot: Spot = { ...range };
  plugin.held.add(spot);
  const letGo = () => view.plugin(spots)?.held.delete(spot) ?? false;
  return {
    insert: (paths) => {
      // Used already, let go, or of a document that was replaced since.
      const held = view.plugin(spots)?.held;
      if (!paths.length || !held?.has(spot)) return false;
      const before = view.state.doc;
      const next = before.sliceString(spot.to, spot.to + 1);
      // The links that end the document get a line break of their own, so that the caret has a
      // place off them.
      const text = paths.map(imageLink).join(' ') + (next === '' ? '\n' : '');
      // Where the links end, once Track Changes has put its markers around them.
      const end: Spot = { from: spot.to, to: spot.to };
      held.add(end);
      try {
        view.dispatch({
          changes: { from: spot.from, to: spot.to, insert: text },
          userEvent: 'input.image',
        });
      } finally {
        letGo();
        held.delete(end);
      }
      // The editing rules refused it, and said why through `onNotice`: nothing was written.
      if (view.state.doc === before) return false;
      // The preview draws an image only while the caret is off its link, so that it shows at once:
      // the caret goes past the space or line break that follows the links, when one does.
      const caret =
        end.to + (/[ \t\n]/.test(view.state.doc.sliceString(end.to, end.to + 1)) ? 1 : 0);
      view.dispatch({ selection: { anchor: caret }, scrollIntoView: true });
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
  if (!onImageFiles) return spots;
  const take = (
    event: Event,
    view: EditorView,
    files: File[],
    pasted: boolean,
    at?: { x: number; y: number },
  ) => {
    if (!files.length) return false;
    event.preventDefault();
    // Raw while it is read-only says why for every paste and drop (`rawEditsRefused`).
    if (rawIsReadOnly(view.state)) return true;
    const spot = imageSpot(view, at, notice);
    if (spot) onImageFiles(files, spot, pasted);
    return true;
  };
  return [
    spots,
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
