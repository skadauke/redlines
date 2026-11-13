// Subscript and superscript as the HTML tags `<sub>` and `<sup>` (#310, format §2.6), the first of a
// short list of tags the editor reads as formats. A pair is a node of the parse (`Subscript`,
// `Superscript`) whose tags are its marks, so that the preview hides the tags and draws the text
// lowered or raised, and the Format menu knows where the caret is. Only the tags as the serializer
// writes them are read: lowercase, with no attributes. Any other tag stays an `HTMLTag`, and shows
// as written. Lezer's own extensions of these names are for pandoc's `~x~` and `^x^`, which Redlines
// keeps as written and doesn't read; they would define the same nodes.

import { tags } from '@lezer/highlight';
import type { DelimiterType, MarkdownConfig } from '@lezer/markdown';

const SUBSCRIPT: DelimiterType = { resolve: 'Subscript', mark: 'SubscriptMark' };
const SUPERSCRIPT: DelimiterType = { resolve: 'Superscript', mark: 'SuperscriptMark' };

/** The tags the format reads: `<sub>`, `</sub>`, `<sup>` and `</sup>`, written exactly so. */
const TAG = /^<(\/?)(sub|sup)>/;

/**
 * `<sub>` and `<sup>` pairs as nodes. The parser pairs each closing tag with the nearest opening tag
 * of its name before it, within the text of a link or a cell, as the format's reader does, and a tag
 * with no pair is text.
 */
export const scriptTags: MarkdownConfig = {
  defineNodes: [
    { name: 'Subscript', style: tags.special(tags.content) },
    { name: 'SubscriptMark', style: tags.processingInstruction },
    { name: 'Superscript', style: tags.special(tags.content) },
    { name: 'SuperscriptMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'ScriptTag',
      // Before the parser that reads every tag as an `HTMLTag`.
      before: 'HTMLTag',
      parse(cx, next, pos) {
        if (next !== 60 /* '<' */) return -1;
        const found = TAG.exec(cx.slice(pos, pos + 6));
        if (!found) return -1;
        const closing = found[1] === '/';
        const type = found[2] === 'sub' ? SUBSCRIPT : SUPERSCRIPT;
        return cx.addDelimiter(type, pos, pos + found[0].length, !closing, closing);
      },
    },
  ],
};
