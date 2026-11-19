// Raw markup in what is drawn (#1207): the scan that the WebKit journey (tests/raw-markup.spec.ts),
// the Word export's check and the Quick Look renderer's check (apps/desktop/src/raw-markup.node.test.ts)
// share. A person reads what a document draws, so markup that the app should have turned into a
// mark, a chip, a box, a bold word, a formula or a line break must never be in that text.
//
// What counts as raw is a list of rules, each with a name. A hit is where one rule found raw markup
// in one place the document is drawn (a surface: Redlines, Clean, Simple, Word, Quick Look). Text
// that is code in the document's own source (a fence, a code span) is allowed to hold anything.
//
// Cases that are open bugs are listed in KNOWN, each with its issue, and the check passes with
// them. It fails on a hit nobody knows (a new one, or a fixed one that came back), and on a known
// case that no longer shows ("fixed: remove it from KNOWN"), the way a `known(...)` journey does.

/** Where a document is drawn. */
export type Surface = 'redlines' | 'clean' | 'simple' | 'word' | 'quicklook';

export const WEBKIT_SURFACES: readonly Surface[] = ['redlines', 'clean', 'simple'];
export const EXPORT_SURFACES: readonly Surface[] = ['word', 'quicklook'];

export interface Rule {
  name: string;
  /** What it looks for, in one line of drawn text. */
  pattern: RegExp;
}

export const RULES: readonly Rule[] = [
  // Redlines' own markers: an insertion, a deletion, a substitution, a split, a comment's span, a
  // format change, and the ledger's block.
  // (A note of the author's own, `<!-- … -->`, is theirs, and not drawn by the app's marks.)
  {
    name: 'marker',
    pattern:
      /<!--\/?(?:ins|del|sub|cmt|fmt|split|redlines)\b|<!--\/?[bcdfghjkmnpqrstvwxz2-9]{4}-->/,
  },
  // Quarto's attributes, on a heading, a figure, a table, an equation or a span.
  { name: 'attributes', pattern: /\{[#.][\w:.#-]+(?:[^}\n]*)\}/ },
  // A line break that was written as the two characters.
  { name: 'literal-newline', pattern: /\\n/ },
  // Emphasis that nobody turned into bold.
  { name: 'bold', pattern: /\*\*[^\s*][^*]*\*\*|__[^\s_][^_]*__/ },
  // Inline and display math that nobody typeset.
  { name: 'math', pattern: /\$\$|\$[^\s$](?:[^$]*[^\s$])?\$/ },
  // Quarto's subscript, superscript and strikethrough, left as they were written.
  { name: 'sub-sup-strike', pattern: /~~?[^\s~][^~]*~~?|\^[^\s^][^^]*\^/ },
  // A cross-reference to a section, figure, table, equation or listing, written as it is typed.
  { name: 'reference', pattern: /@(?:sec|fig|tbl|eq|lst)-[\w-]+/ },
  // A div's fence.
  { name: 'fence', pattern: /^\s*:{3,}/ },
];

export interface Hit {
  rule: string;
  /** The text that matched. */
  text: string;
  /** The drawn line it was in, cut to a length a failure message can hold. */
  line: string;
}

/**
 * What the source holds as code: each line inside a fence, and the inside of each code span. Raw
 * markup that is only ever written as code in the document is the code, drawn as it is.
 */
export function codeOf(source: string): string[] {
  const code: string[] = [];
  let fence: string | null = null;
  for (const line of source.split(/\r?\n/)) {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null && open) {
      fence = open[1]!;
      code.push(line);
    } else if (fence !== null) {
      code.push(line);
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) fence = null;
    } else {
      for (const span of line.matchAll(/(`+)(.+?)\1/g)) code.push(span[2]!);
    }
  }
  return code;
}

/** Zero-width characters, which the editor draws between its widgets. */
const INVISIBLE = new RegExp('[\\u200b\\ufeff]', 'g');

/** The raw markup in drawn lines of text (not code of the source `code` lists). */
export function scanLines(lines: readonly string[], code: readonly string[] = []): Hit[] {
  const hits: Hit[] = [];
  for (const raw of lines) {
    const line = raw.replace(INVISIBLE, '').trim();
    if (line === '') continue;
    for (const rule of RULES) {
      const found = rule.pattern.exec(line);
      if (!found) continue;
      const text = found[0];
      if (code.some((piece) => piece.includes(text))) continue;
      hits.push({
        rule: rule.name,
        text,
        line: line.length > 120 ? `${line.slice(0, 117)}...` : line,
      });
    }
  }
  return hits;
}

/** A known case: raw markup that an open issue is about. */
export interface KnownCase {
  issue: number;
  /** The document's file name, or the names of the files. */
  doc: string | readonly string[];
  /** Where it shows today. */
  surfaces: readonly Surface[];
  rule: string;
  /** The text that matched. */
  text: RegExp;
  why: string;
}

/**
 * The cases that are known today. When an issue's PR fixes its case, this check fails with "no
 * longer shows": delete the entry in that PR (and nothing else). A case that comes back after that
 * is then a failure of this check, with no entry to hide behind.
 */
export const KNOWN: readonly KnownCase[] = [
  {
    issue: 1169,
    doc: 'Build 21.qmd',
    surfaces: ['redlines', 'clean', 'simple'],
    rule: 'marker',
    text: /<!--/,
    why: 'a callout whose title holds an insertion shows its marker',
  },
  {
    issue: 1170,
    doc: 'Build 21.qmd',
    surfaces: ['redlines', 'clean', 'simple'],
    rule: 'attributes',
    text: /\{#sec-/,
    why: 'a heading’s {#sec-…} is drawn as part of the heading',
  },
  {
    issue: 1212,
    doc: 'Build 21.qmd',
    surfaces: ['redlines', 'clean', 'simple'],
    rule: 'attributes',
    text: /\{#tbl-/,
    why: 'a table’s caption line and its {#tbl-…} are drawn as source',
  },
  {
    issue: 1173,
    doc: 'Build 21.qmd',
    surfaces: ['redlines', 'clean', 'simple'],
    rule: 'math',
    text: /\$\$/,
    why: 'the display formula shows as source',
  },
  {
    issue: 1173,
    doc: 'Build 21.qmd',
    surfaces: ['redlines', 'clean', 'simple'],
    rule: 'attributes',
    text: /\{#eq-/,
    why: 'the formula’s {#eq-mass} shows as source',
  },
  {
    issue: 1176,
    doc: 'Build 21.qmd',
    surfaces: ['redlines', 'clean', 'simple'],
    rule: 'sub-sup-strike',
    text: /~2~/,
    why: 'H~2~O shows as source',
  },
  {
    issue: 1172,
    doc: 'Build 21.qmd',
    surfaces: ['redlines', 'clean', 'simple'],
    rule: 'reference',
    text: /@sec-intro/,
    why: 'a reference to a section isn’t drawn as a link',
  },
  {
    issue: 1213,
    doc: 'divs.qmd',
    surfaces: ['redlines', 'clean', 'simple'],
    rule: 'attributes',
    text: /\{\.column/,
    why: 'the fences of a div that isn’t a callout are drawn as source',
  },
  ...([['math', /\$\$/, 'the display formula']] as const).map(([rule, text, what]): KnownCase => ({
    issue: 1216,
    doc: ['Build 21.qmd', 'frontmatter.qmd'],
    surfaces: ['quicklook'],
    rule,
    text,
    why: `the Quick Look page shows ${what} as source`,
  })),
];

export interface Found {
  doc: string;
  surface: Surface;
  hit: Hit;
}

const isKnown = (found: Found, known: KnownCase) =>
  [known.doc].flat().includes(found.doc) &&
  known.surfaces.includes(found.surface) &&
  found.hit.rule === known.rule &&
  known.text.test(found.hit.text);

/** What the check reports: hits nobody knows, and known cases that no longer show. */
export function judge(
  all: readonly Found[],
  surfaces: readonly Surface[],
  docs: readonly string[],
  known: readonly KnownCase[] = KNOWN,
): { unknown: string[]; gone: string[] } {
  const unknown = all
    .filter((found) => !known.some((entry) => isKnown(found, entry)))
    .map(
      ({ doc, surface, hit }) =>
        `${doc} (${surface}): raw ${hit.rule} "${hit.text}" in "${hit.line}"`,
    );
  const gone: string[] = [];
  for (const entry of known) {
    if (![entry.doc].flat().some((name) => docs.includes(name))) continue;
    for (const surface of entry.surfaces.filter((s) => surfaces.includes(s))) {
      if (!all.some((found) => found.surface === surface && isKnown(found, entry))) {
        gone.push(
          `#${entry.issue} no longer shows in ${[entry.doc].flat().join(', ')} (${surface}): delete its entry from KNOWN in raw-markup.ts (${entry.why})`,
        );
      }
    }
  }
  return { unknown: [...new Set(unknown)], gone };
}
