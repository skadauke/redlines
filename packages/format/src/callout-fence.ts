// Quarto's callouts (docs/research/quarto.md, Q7): a div whose opening fence has the class
// `callout-note`, `-tip`, `-important`, `-warning` or `-caution`, in a pandoc file. Like an alert's, its
// type is syntax, and its title may be too (`title="…"`); changing either is a block format change,
// `was=fence=ATTRIBUTES`, a mark that covers the whole div with its opener alone on the line before
// the opening fence and its closer alone on the line after the closing fence, so that no marker is
// on a `:::` line (§3.1, rule 9). This file reads and writes the attribute text of a fence; nothing
// in it reads a document but the lines it is given.

/** Quarto's five kinds of callout. */
export const FENCE_TYPES: readonly string[] = ['note', 'tip', 'important', 'warning', 'caution'];

/** An opening fence with attributes: the colons and the blank after them, the attribute text, and
 * the closing colons that pandoc allows after it. */
const OPENING = /^(:{3,}[ \t]*)(\S.*?)([ \t]*:*[ \t]*)$/;
const CLOSING = /^ {0,3}:{3,}[ \t]*$/;
const CODE_FENCE = /^[ \t]*(`{3,}|~{3,})/;
const TOKEN = /\.([\w-]+)|#([\w:.-]+)|([\w-]+)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"'}]+))/g;

/** A callout's opening fence, as the text of one line shows it. */
export interface FenceLine {
  /** Where the attribute text starts in the line, and where it ends. */
  from: number;
  to: number;
  text: string;
  /** The type: `note`, `tip`, `important`, `warning` or `caution`. */
  type: string;
}

/** The attribute text of a line that opens a callout, or undefined for any other line. */
export function readFenceLine(line: string): FenceLine | undefined {
  const found = OPENING.exec(line);
  if (!found) return undefined;
  const text = found[2] ?? '';
  const type = typeIn(text);
  if (type === undefined) return undefined;
  const from = (found[1] ?? '').length;
  return { from, to: from + text.length, text, type };
}

/** The tokens of attribute text, with where each is. */
function tokensOf(text: string): { at: number; end: number; match: RegExpMatchArray }[] {
  const inner = text.startsWith('{') && text.endsWith('}') ? text.slice(1, -1) : text;
  const base = inner === text ? 0 : 1;
  return [...inner.matchAll(TOKEN)].map((match) => ({
    at: base + (match.index ?? 0),
    end: base + (match.index ?? 0) + match[0].length,
    match,
  }));
}

function typeIn(text: string): string | undefined {
  if (!text.startsWith('{')) {
    const bare = /^callout-([a-z]+)$/.exec(text)?.[1];
    return bare !== undefined && FENCE_TYPES.includes(bare) ? bare : undefined;
  }
  for (const { match } of tokensOf(text)) {
    const kind = /^callout-([a-z]+)$/.exec(match[1] ?? '')?.[1];
    if (kind !== undefined && FENCE_TYPES.includes(kind)) return kind;
  }
  return undefined;
}

/** The title that attribute text sets with `title="…"`, or null where it sets none. */
export function titleOf(text: string): string | null {
  for (const { match } of tokensOf(text)) {
    if (match[3] !== 'title') continue;
    return (match[4] ?? match[5] ?? match[6] ?? '').replace(/\\(.)/g, '$1');
  }
  return null;
}

/** A title as a quoted value. A line break in it is a blank, and a quote or a backslash is escaped. */
const quoted = (title: string) =>
  `"${title.replace(/[\r\n]+/g, ' ').replace(/[\\"]/g, (c) => `\\${c}`)}"`;

/**
 * Attribute text with another type, and another title: undefined leaves it as it is, null takes the
 * title away. Everything else in it, an id, other classes, `collapse="true"`, stays as written. A
 * bare class (`::: callout-note`) becomes a braced one where a title is added.
 */
export function rewriteFence(
  text: string,
  change: { type?: string; title?: string | null },
): string {
  let result = text;
  if (change.type !== undefined) {
    if (!result.startsWith('{')) result = `callout-${change.type}`;
    else {
      const token = tokensOf(result).find(({ match }) => {
        const kind = /^callout-([a-z]+)$/.exec(match[1] ?? '')?.[1];
        return kind !== undefined && FENCE_TYPES.includes(kind);
      });
      if (token) {
        result = `${result.slice(0, token.at)}.callout-${change.type}${result.slice(token.end)}`;
      }
    }
  }
  if (change.title !== undefined) {
    if (!result.startsWith('{')) result = `{.${result}}`;
    const token = tokensOf(result).find(({ match }) => match[3] === 'title');
    if (change.title === null) {
      if (token) {
        // The blank before it goes with it.
        const before = result.slice(0, token.at).replace(/[ \t]+$/, '');
        result = `${before}${result.slice(token.end)}`;
      }
    } else if (token) {
      result = `${result.slice(0, token.at)}title=${quoted(change.title)}${result.slice(token.end)}`;
    } else {
      result = `${result.slice(0, -1).replace(/[ \t]+$/, '')} title=${quoted(change.title)}}`;
    }
  }
  return result;
}

/** What a `was=` value is, when it is the attribute text a fence had: `fence=…`. */
export function readFenceWas(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith('fence=')) return undefined;
  const text = value.slice('fence='.length);
  // Only what a fence could have had is written back.
  return readFenceLine(`::: ${text}`) ? text : undefined;
}

/** The line starts of the callout that opens at `open` (a line number of `lines`) and the line that
 * closes it, or undefined for a div that is never closed. Code fences hide the colons in them. */
export function closeOfDiv(lines: readonly string[], open: number): number | undefined {
  let depth = 0;
  let code: string | null = null;
  for (let n = open + 1; n < lines.length; n++) {
    const line = lines[n] ?? '';
    const fence = CODE_FENCE.exec(line);
    if (code !== null) {
      if (
        fence?.[1] &&
        fence[1][0] === code[0] &&
        fence[1].length >= code.length &&
        /^[ \t]*$/.test(line.slice(fence[0].length))
      ) {
        code = null;
      }
      continue;
    }
    if (fence?.[1]) {
      code = fence[1];
      continue;
    }
    if (CLOSING.test(line)) {
      if (depth === 0) return n;
      depth--;
    } else if (OPENING.test(line.replace(/^ {0,3}/, ''))) depth++;
  }
  return undefined;
}
