// What a Quarto document draws that Markdown doesn't (design §6.4), for the preview of a `.qmd` or
// `.Rmd` file: the page's HTML is changed after micromark has written it, so that
//
// - the attributes at the end of a heading, a figure or a formula (`{#sec-intro}`) are a small gray
//   chip, as the editor draws them;
// - a table's caption (`: Who owns what {#tbl-owners}`, the paragraph beside a table) is a caption,
//   with its label ("Table 1:");
// - a cross-reference (`@fig-plot`) is its target's label ("Figure 1") with a fine dotted underline,
//   and stays as written where the file has no such target;
// - `H~2~O` and `x^2^` are a subscript and a superscript, by Pandoc's rule: no space between the
//   marks, `~~` is strikethrough, and a mark in code or math is none.
//
// Code is never changed: what is in `<pre>` and `<code>` is skipped, and only the text between the
// tags is read.

const KINDS: Readonly<Record<string, string>> = {
  fig: 'Figure',
  tbl: 'Table',
  eq: 'Equation',
  lst: 'Listing',
  sec: 'Section',
};

const ATTRIBUTE_ID = /\{[^}\n]*?#((?:fig|tbl|eq|lst|sec)-[\w][\w:.-]*)(?<![:.-])[^}\n]*\}/g;
const CHUNK_LABEL = /^#\|\s*label:\s*((?:fig|tbl|eq|lst)-[\w][\w:.-]*)\s*$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const UNNUMBERED = /\{[^}]*(?:\.unnumbered|\s-)[^}]*\}[ \t]*$/;
const HEADING_ATTRIBUTES = /[ \t]*\{[^}]*\}[ \t]*$/;

/** The labels of a Quarto document's targets: `fig-plot` to "Figure 1". */
export function targetsOf(source: string): Map<string, string> {
  const targets = new Map<string, string>();
  const lines = source.split(/\r?\n/);
  const counts: Record<string, number> = {};
  const levels = [0, 0, 0, 0, 0, 0];
  let numbered = false;
  let n = 0;
  if (/^---[ \t]*$/.test(lines[0] ?? '')) {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
        n = i + 1;
        break;
      }
      if (/^number-sections:\s*true\b/.test(line)) numbered = true;
    }
    if (n === 0) numbered = false;
  }
  const next = (kind: string) => (counts[kind] = (counts[kind] ?? 0) + 1);
  let code: string | null = null;
  for (; n < lines.length; n++) {
    const line = lines[n] ?? '';
    const fence = FENCE.exec(line);
    if (code !== null) {
      if (fence?.[1] && fence[1][0] === code[0] && fence[1].length >= code.length) code = null;
      else {
        const label = CHUNK_LABEL.exec(line)?.[1];
        if (label) {
          const kind = label.slice(0, label.indexOf('-'));
          if (!targets.has(label)) targets.set(label, `${KINDS[kind]} ${next(kind)}`);
        }
      }
      continue;
    }
    if (fence?.[1]) {
      code = fence[1];
      continue;
    }
    const heading = HEADING.exec(line);
    let sectionNumber = '';
    if (heading?.[1] && numbered && !UNNUMBERED.test(line)) {
      const depth = heading[1].length - 1;
      levels[depth] = (levels[depth] ?? 0) + 1;
      for (let i = depth + 1; i < levels.length; i++) levels[i] = 0;
      sectionNumber = levels.slice(0, depth + 1).join('.');
    }
    for (const found of line.matchAll(ATTRIBUTE_ID)) {
      const label = found[1] ?? '';
      const kind = label.slice(0, label.indexOf('-'));
      if (targets.has(label)) continue;
      if (kind === 'sec') {
        // A section is numbered only where the file asks for it; otherwise it is named by its title.
        const title = heading?.[2]?.replace(HEADING_ATTRIBUTES, '').trim();
        if (sectionNumber !== '') targets.set(label, `Section ${sectionNumber}`);
        else if (title) targets.set(label, title);
      } else targets.set(label, `${KINDS[kind]} ${next(kind)}`);
    }
  }
  return targets;
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An `@label` of a kind that Quarto numbers, in HTML text. */
const REFERENCE = /(?<![\w@])@((?:fig|tbl|eq|lst|sec)-[\w][\w:.-]*)(?<![:.-])/g;
/** `~sub~` (not `~~`), and `^sup^` (not `^[`): no space, no mark and no backslash between. */
const SCRIPT = /(?<![~\\])~([^\s~\\]+)~(?!~)|(?<![\^\\])\^([^\s^\\[][^\s^\\]*)\^/g;
const MATH = /\$[^$\n]+\$/g;

/** HTML text (no tags), with its references and scripts drawn. */
function drawText(text: string, targets: ReadonlyMap<string, string>): string {
  let out = text;
  if (out.includes('@')) {
    out = out.replace(REFERENCE, (whole, label: string) => {
      const shown = targets.get(label);
      return shown === undefined
        ? whole
        : `<span class="rl-xref">${escape(unescape(shown))}</span>`;
    });
  }
  if (out.includes('~') || out.includes('^')) {
    const math = [...out.matchAll(MATH)].map((m) => [m.index, m.index + m[0].length] as const);
    out = out.replace(
      SCRIPT,
      (whole, sub: string | undefined, sup: string | undefined, at: number) => {
        if (math.some(([a, b]) => at >= a && at < b)) return whole;
        return sub === undefined ? `<sup>${sup}</sup>` : `<sub>${sub}</sub>`;
      },
    );
  }
  return out;
}

const unescape = (text: string): string => text.replace(/&amp;/g, '&');

/** The elements whose text is code or is not read. */
const SKIPPED = /^<(pre|code|script|style)\b/i;
const CLOSING = /^<\/(pre|code|script|style)\b/i;

/** `html` with `change` applied to each stretch of text outside the code and the tags. */
function mapText(html: string, change: (text: string) => string): string {
  let depth = 0;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (SKIPPED.test(part)) depth++;
        else if (CLOSING.test(part)) depth = Math.max(0, depth - 1);
        return part;
      }
      return depth > 0 || part === '' ? part : change(part);
    })
    .join('');
}

/** Attributes at the very end of a block's text: `{#id .class key=value}`, or `{-}`. */
const TRAILING = /[ \t]*\{((?:[#.][^{}]*?|-))\}(?=<\/(?:h[1-6]|p)>)/g;
/** A caption: a paragraph that starts with a colon, beside a table. */
const CAPTION_BEFORE = /(<\/table><\/div>\n)<p>:[ \t]+(.*?)<\/p>/g;
const CAPTION_AFTER = /<p>:[ \t]+(.*?)<\/p>(\n<div class="rl-tbl-scroll">)/g;

function chip(inner: string): string {
  return ` <span class="rl-attr-chip">${inner.trim()}</span>`;
}

function captionOf(text: string, targets: ReadonlyMap<string, string>): string {
  const id = /\{[^{}]*#(tbl-[\w:.-]*[\w])[^{}]*\}\s*$/.exec(text)?.[1];
  const label = id === undefined ? undefined : targets.get(id);
  return `<p class="rl-caption">${label === undefined ? '' : `<span class="rl-caption-label">${escape(unescape(label))}:</span> `}${text}</p>`;
}

/** The HTML of a Quarto document's preview, with what Quarto draws drawn. `source` is the file's
 * text, front matter and all, which the numbers of its targets are read from. */
export function quartoHtml(html: string, source: string): string {
  const targets = targetsOf(source);
  const captioned = html
    .replace(CAPTION_BEFORE, (_, table: string, text: string) => table + captionOf(text, targets))
    .replace(CAPTION_AFTER, (_, text: string, table: string) => captionOf(text, targets) + table);
  return mapText(
    captioned.replace(TRAILING, (_, inner: string) => chip(inner)),
    (text) => drawText(text, targets),
  );
}
