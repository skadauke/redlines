// The headings of a document, as the outline lists them (design §5.12): from the syntax tree, with
// the text as it reads with every pending change accepted (an insertion kept, a deletion gone, a
// substitution's new text) and without Markdown's marks.

import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export interface Heading {
  /** Where the heading's line starts: the caret and the scroll go there. */
  from: number;
  /** 1 to 6. */
  level: number;
  text: string;
}

/** The blocks whose children may be headings. Every other block is passed over whole. */
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);

/** The marks of inline syntax, which read as nothing: its text is what stays. */
const MARKS = new Set([
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'LinkMark',
  'LinkLabel',
  'LinkTitle',
]);

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** An entity as the character it stands for, or itself when it is not one this knows. */
function entity(written: string): string {
  const body = written.slice(1, -1);
  const named = NAMED[body.toLowerCase()];
  if (named !== undefined) return named;
  const hex = /^#x([\da-f]{1,6})$/i.exec(body)?.[1];
  const decimal = /^#(\d{1,7})$/.exec(body)?.[1];
  const code = hex ? Number.parseInt(hex, 16) : decimal ? Number(decimal) : 0;
  return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : written;
}

/** A heading's text between `from` and `to`, with the marks of its inline syntax left out. */
function textBetween(state: EditorState, from: number, to: number): string {
  let text = '';
  let at = from;
  const take = (upTo: number) => {
    if (upTo > at) text += state.sliceDoc(at, upTo);
    at = Math.max(at, upTo);
  };
  syntaxTree(state).iterate({
    from,
    to,
    enter(inner) {
      if (inner.from < from || inner.to > to) return;
      const { name } = inner;
      // The destination of a link or an image is not its text; a bare address is.
      const destination =
        name === 'URL' && ['Link', 'Image'].includes(inner.node.parent?.name ?? '');
      if (MARKS.has(name) || destination) {
        take(inner.from);
        at = Math.max(at, inner.to);
      } else if (name === 'Escape') {
        take(inner.from);
        at = Math.max(at, inner.from + 1);
      } else if (name === 'Entity') {
        take(inner.from);
        text += entity(state.sliceDoc(inner.from, inner.to));
        at = Math.max(at, inner.to);
      }
    },
  });
  take(to);
  // The markers of pending changes are comments, deleted text with them: what is left reads as the
  // newest text does.
  return text
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The headings of the document, in order. A heading with no text is left out. */
export function headingsOf(state: EditorState): Heading[] {
  const found: Heading[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      const atx = /^ATXHeading([1-6])$/.exec(ref.name);
      const setext = /^SetextHeading([12])$/.exec(ref.name);
      if (!atx && !setext) return CONTAINERS.has(ref.name);
      const level = Number((atx ?? setext)?.[1]);
      const marks = ref.node.getChildren('HeaderMark');
      let from = ref.from;
      let to = ref.to;
      if (atx) {
        // `## Text ##`: the text lies between the opening mark and the closing one, if there is one.
        const [open, close] = marks;
        if (!open) return false;
        from = open.to;
        to = close ? close.from : ref.to;
      } else if (marks[0]) {
        // The text runs up to the line of `===` or `---` under it.
        to = marks[0].from;
      }
      const text = textBetween(state, from, to);
      if (text) found.push({ from: ref.from, level, text });
      return false;
    },
  });
  return found;
}
