// Inline HTML as GitHub draws it (#686, #687): the tags GitHub keeps, read as pairs, so that the
// preview hides the tags and draws the text as the element (`<kbd>`, `<mark>`, `<abbr>` and the
// others), as it does for `<sub>` and `<sup>` (script.ts). The list is `@redlines/format`'s
// (`github-html.ts`), the one that the check against GitHub holds the editor to.
//
// What the parse makes of a tag (`sub` and `sup` stay with script.ts, which is read first):
// - an inline element's opening and closing tags, paired as emphasis is, are the marks
//   (`HtmlTagMark`) of an `HtmlElement`; a tag with no pair is text, as `<sub>` with no pair is;
// - `<br>` is an `HtmlBreak` and `<wbr>` an `HtmlWbr`, each one unit for the caret;
// - the tags of an element GitHub drops, `<u>` and any tag it doesn't know, are an `HtmlDropped`:
//   the tag goes and its text stays;
// - the open tag of an element GitHub drops that has no text of its own (a video, an svg) is an
//   `HtmlChip`, and its closing tag an `HtmlDropped`;
// - the nine tags GFM escapes, and the elements drawn as blocks (later phases of #686), stay the
//   parse's own `HTMLTag`, shown as written.

import { htmlHandling, isAllowedAttribute } from '@redlines/format';
import type { DelimiterType, MarkdownConfig } from '@lezer/markdown';

/** A tag as CommonMark reads it (§6.6): the attribute values may hold `>`. */
const ATTRIBUTE = String.raw`(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>\`]+|'[^']*'|"[^"]*"))?)`;
const OPENING = new RegExp(String.raw`^<([a-zA-Z][a-zA-Z0-9-]*)(${ATTRIBUTE}*)\s*(/?)>`);
const CLOSING = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/;

/** A tag that is read: its lowercase name, whether it closes, and the text of its attributes. */
interface HtmlTag {
  name: string;
  closing: boolean;
  attributes: string;
  selfClosing: boolean;
  length: number;
}

/** Reads the tag at the start of `text`, or null. */
export function readTag(text: string): HtmlTag | null {
  const closing = CLOSING.exec(text);
  if (closing) {
    return {
      name: (closing[1] as string).toLowerCase(),
      closing: true,
      attributes: '',
      selfClosing: false,
      length: closing[0].length,
    };
  }
  const opening = OPENING.exec(text);
  if (!opening) return null;
  return {
    name: (opening[1] as string).toLowerCase(),
    closing: false,
    attributes: opening[2] as string,
    selfClosing: opening[3] === '/',
    length: opening[0].length,
  };
}

/** The attributes of a tag that GitHub keeps on the element, as written. */
export function keptAttributes(name: string, attributes: string): Record<string, string> {
  const kept: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const found of attributes.matchAll(pattern)) {
    const attribute = (found[1] as string).toLowerCase();
    if (!isAllowedAttribute(name, attribute) || attribute in kept) continue;
    kept[attribute] = found[2] ?? found[3] ?? found[4] ?? '';
  }
  return kept;
}

const delimiters = new Map<string, DelimiterType>();

/** One type of delimiter for each name, so that a closing tag pairs only with an opening one of its name. */
function delimiterOf(name: string): DelimiterType {
  let type = delimiters.get(name);
  if (!type) delimiters.set(name, (type = { resolve: 'HtmlElement', mark: 'HtmlTagMark' }));
  return type;
}

/** The tags `script.ts` reads, which are not read twice. */
const SCRIPT = new Set(['sub', 'sup']);
/** Void elements: no closing tag. */
const BREAKS = new Set(['br', 'wbr']);

export const htmlInline: MarkdownConfig = {
  defineNodes: [
    { name: 'HtmlElement' },
    { name: 'HtmlTagMark' },
    { name: 'HtmlBreak' },
    { name: 'HtmlWbr' },
    { name: 'HtmlDropped' },
    { name: 'HtmlChip' },
  ],
  parseInline: [
    {
      name: 'HtmlInlineTag',
      before: 'HTMLTag',
      parse(cx, next, pos) {
        if (next !== 60 /* '<' */) return -1;
        // A tag starts with a letter or a slash and a letter: most `<` are neither.
        const after = cx.char(pos + 1);
        if (!(after >= 65 && after <= 122) && after !== 47) return -1;
        // The text to the end of the line is enough for a tag, but one may run on.
        const tag = readTag(cx.slice(pos, Math.min(cx.end, pos + 2000)));
        if (!tag) return -1;
        const { name } = tag;
        if (SCRIPT.has(name)) return -1;
        const end = pos + tag.length;
        if (BREAKS.has(name)) {
          if (tag.closing) return cx.addElement(cx.elt('HtmlDropped', pos, end));
          return cx.addElement(cx.elt(name === 'br' ? 'HtmlBreak' : 'HtmlWbr', pos, end));
        }
        switch (htmlHandling(name)) {
          case 'inline':
            // A self-closing `<kbd/>` is no pair: it stays text.
            if (tag.selfClosing) return -1;
            return cx.addDelimiter(delimiterOf(name), pos, end, !tag.closing, tag.closing);
          case 'unwrap':
            return cx.addElement(cx.elt('HtmlDropped', pos, end));
          case 'chip':
            return cx.addElement(cx.elt(tag.closing ? 'HtmlDropped' : 'HtmlChip', pos, end));
          default:
            return -1;
        }
      },
    },
  ],
};
