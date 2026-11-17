// A deletion of all the text of an inline format (`**a**`, `~~a~~`, a code span) takes the format's
// delimiters too, from the outermost format it empties: what a fine write leaves, `****`, is no
// format and no text, and read again it is something else (#584). Who applies it: the editor's
// tracking filter, for a key (its own `emptiedFormats`), and the harness's library writer
// (`packages/collab-sim`), which gives `trackedEdits` what the editor's filter would. `trackedEdits`
// itself does not: it writes the edit it is given, and `formatting.test.ts` holds that a format
// change keeps its syntax when its word is deleted, so that accepting both reads as the newest view.
// An agent's `str_replace` needs no step: it compares the newest view, where the delimiters are
// text, and so deletes them with the word (tests in the agent tools, the command line and the
// editor's `applyAgentEdit` hold it).

import { micromark } from 'micromark';
import { gfmStrikethrough, gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';
import { newestView } from './views.ts';
import type { TextChange } from './types.ts';

/** The delimiters of an inline format, the longest first, and the element that micromark writes. */
const FORMATS: readonly (readonly [string, string])[] = [
  ['**', 'strong'],
  ['__', 'strong'],
  ['~~', 'del'],
  ['*', 'em'],
  ['_', 'em'],
  ['`', 'code'],
];

const OPTIONS = {
  extensions: [gfmStrikethrough()],
  htmlExtensions: [gfmStrikethroughHtml()],
};

/** Whether the delimiters stand against `view[from, to)` and make one format around exactly it. */
function wraps(view: string, from: number, to: number, tag: string): boolean {
  const blank = view.lastIndexOf('\n\n', from);
  const start = blank < 0 ? 0 : blank + 2;
  const next = view.indexOf('\n\n', to);
  const paragraph = view.slice(start, next < 0 ? view.length : next);
  // The text as it reads on its own, inside a format of the kind.
  const inner = micromark(view.slice(from, to), OPTIONS).replace(/^<p>([^]*)<\/p>\n?$/, '$1');
  return micromark(paragraph, OPTIONS).includes(`<${tag}>${inner}</${tag}>`);
}

/**
 * `edits` with each deletion that empties an inline format taking the format's delimiters too.
 * Only deletions of text that stands whole in the file, with the delimiters against it.
 */
export function emptiedFormats(text: string, edits: readonly TextChange[]): readonly TextChange[] {
  if (!edits.some((edit) => edit.insert === '' && edit.from < edit.to)) return edits;
  if (!/[*_~`]/.test(text)) return edits;
  let view: ReturnType<typeof newestView> | undefined;
  const widened = edits.map((edit) => {
    if (edit.insert !== '' || edit.from >= edit.to) return edit;
    let { from, to } = edit;
    for (let moved = true; moved;) {
      moved = false;
      for (const [delimiter, tag] of FORMATS) {
        const n = delimiter.length;
        if (text.slice(from - n, from) !== delimiter || text.slice(to, to + n) !== delimiter) {
          continue;
        }
        view ??= newestView(text);
        const vFrom = view.map.fromSource(from);
        const vTo = view.map.fromSource(to);
        if (view.text.slice(vFrom, vTo) !== text.slice(from, to)) continue;
        if (!wraps(view.text, vFrom, vTo, tag)) continue;
        from -= n;
        to += n;
        moved = true;
        break;
      }
    }
    return from === edit.from && to === edit.to ? edit : { ...edit, from, to };
  });
  // Edits that now overlap are one.
  const merged: TextChange[] = [];
  for (const edit of widened) {
    const previous = merged.at(-1);
    if (previous && edit.from < previous.to) {
      merged[merged.length - 1] = {
        ...previous,
        to: Math.max(previous.to, edit.to),
        insert: previous.insert + edit.insert,
      };
    } else merged.push(edit);
  }
  return merged;
}
