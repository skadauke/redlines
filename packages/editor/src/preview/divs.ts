// Fenced divs of pandoc and Quarto, as the preview reads them (docs/research/quarto.md): a line of
// three or more colons and attributes opens one, a line of colons alone closes the innermost. The
// lezer tree has no node for a div, so this reads the lines. Only a `.qmd` or `.Rmd` file has them
// (the dialect, format §9.1); in code, in front matter and in the ledger a `:::` line is text.

import type { Text } from '@codemirror/state';

/** The five kinds of Quarto's callouts. */
export const QUARTO_CALLOUTS = ['note', 'tip', 'important', 'warning', 'caution'] as const;

/** A fenced div: the lines of its fences, and its attributes. */
interface Div {
  /** The line numbers (1-based) of the opening and closing fences; `close` is 0 for an unclosed div. */
  open: number;
  close: number;
  /** The depth, 0 for a div at the top level. */
  depth: number;
  /** The classes, ids and key-value pairs of the opening fence's attributes. */
  classes: string[];
  attributes: Record<string, string>;
}

/** A callout, which is a div with a class `callout-TYPE`. */
export interface QuartoCallout extends Div {
  type: (typeof QUARTO_CALLOUTS)[number];
  /** The title from `title="…"`, or the first line after the fence when it is a heading. */
  title: string;
  /** `collapse="true"` folds the body at first, `"false"` is open but can be folded. */
  collapse: boolean | null;
}

const OPEN = /^( {0,3})(:{3,})[ \t]*(.*?)[ \t]*:*[ \t]*$/;
const CLOSE = /^ {0,3}:{3,}[ \t]*$/;
// A code fence may be indented, as in a list item.
const CODE_FENCE = /^[ \t]*(`{3,}|~{3,})/;
const MAY_MATTER = /^[ \t]*[`~:]/;

/** The attributes of an opening fence: `{.class #id key="value"}`, or one bare class (`::: warning`). */
function readAttributes(text: string): {
  classes: string[];
  attributes: Record<string, string>;
} {
  const classes: string[] = [];
  const attributes: Record<string, string> = {};
  const braced = /^\{(.*)\}$/.exec(text);
  const body = braced ? (braced[1] ?? '') : text;
  if (!braced) {
    if (/^[\w-]+$/.test(body)) classes.push(body);
    return { classes, attributes };
  }
  for (const m of body.matchAll(
    /\.([\w-]+)|#([\w:.-]+)|([\w-]+)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"'}]+))/g,
  )) {
    if (m[1] !== undefined) classes.push(m[1]);
    else if (m[2] !== undefined) attributes['id'] = m[2];
    else if (m[3] !== undefined) attributes[m[3]] = m[4] ?? m[5] ?? m[6] ?? '';
  }
  return { classes, attributes };
}

const kept = new WeakMap<Text, Div[]>();

/** The line after the front matter that a document starts with, or 1 when it has none. */
function bodyStart(doc: Text): number {
  if (doc.lines < 2 || !/^---[ \t]*$/.test(doc.line(1).text)) return 1;
  for (let n = 2; n <= doc.lines; n++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(doc.line(n).text)) return n + 1;
  }
  // Front matter that is never closed is not front matter.
  return 1;
}

/** The divs of a document, in the order of their opening lines. */
export function divsOf(doc: Text): Div[] {
  const known = kept.get(doc);
  if (known) return known;
  const divs: Div[] = [];
  const open: Div[] = [];
  let code: string | null = null;
  const last = doc.lines;
  for (let n = bodyStart(doc); n <= last; n++) {
    const text = doc.line(n).text;
    if (!MAY_MATTER.test(text)) continue;
    const fence = CODE_FENCE.exec(text);
    if (code !== null) {
      if (
        fence?.[1] &&
        fence[1][0] === code[0] &&
        fence[1].length >= code.length &&
        /^[ \t]*$/.test(text.slice(fence[0].length))
      ) {
        code = null;
      }
      continue;
    }
    if (fence?.[1]) {
      code = fence[1];
      continue;
    }
    if (CLOSE.test(text)) {
      const div = open.pop();
      if (div) div.close = n;
      continue;
    }
    const found = OPEN.exec(text);
    if (!found?.[3]) continue;
    const { classes, attributes } = readAttributes(found[3]);
    const div: Div = { open: n, close: 0, depth: open.length, classes, attributes };
    divs.push(div);
    open.push(div);
  }
  kept.set(doc, divs);
  return divs;
}

/** The callouts among `divs`, with their titles read from `doc`. */
export function calloutsOf(doc: Text, divs: readonly Div[]): QuartoCallout[] {
  const out: QuartoCallout[] = [];
  for (const div of divs) {
    const type = QUARTO_CALLOUTS.find((kind) => div.classes.includes(`callout-${kind}`));
    if (!type || div.close === 0) continue;
    let title = div.attributes['title'] ?? '';
    // Without `title=`, the first heading of the body is the title (Quarto's own rule).
    if (title === '' && div.open + 1 < div.close) {
      const heading = /^#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*(?:\{[^}]*\})?$/.exec(
        doc.line(div.open + 1).text,
      );
      if (heading?.[1]) title = heading[1];
    }
    const collapse = div.attributes['collapse'];
    out.push({
      ...div,
      type,
      title,
      collapse: collapse === 'true' ? true : collapse === 'false' ? false : null,
    });
  }
  return out;
}
