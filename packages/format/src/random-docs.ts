// A seeded generator of documents that hold every kind of mark, for tests that check what must
// always hold. Not part of the package.

import { newId } from './ids.ts';
import { normalizeLedger } from './ledger-order.ts';
import { serializeLedger } from './ledger-write.ts';
import { encodePayload } from './payload.ts';
import type { Ledger, Thread } from './types.ts';

/** How many random documents a test tries: `fallback`, or the number in REDLINES_FUZZ, for a
 * longer run (`REDLINES_FUZZ=5000 pnpm test`). */
export function fuzzCount(fallback: number): number {
  const wanted = Number(process.env['REDLINES_FUZZ']);
  return Number.isInteger(wanted) && wanted > 0 ? wanted : fallback;
}

/** A small seeded generator (mulberry32): the same seed gives the same numbers. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Words of the body: no backticks (they would pair up and hide marks) and no `--`. Emoji and a
 * letter with a combining accent are there to test offsets. */
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'café', 'éclair', '😀', 'x', '42', 'a-b'];

/** Text that only payloads and comments hold: it needs escapes. */
const AWKWARD = ['q|r', '`c`', 'a--b', '{{y}}', 'back\\slash', 'line\nbreak', 'end-'];

const AUTHORS = ['ada', 'bo', 'claude-ada'];

/** YAML front matter (format §3.8), closed by `---` or `...`, with the first block right under its
 * closing line or after a blank line; some with a YAML block list, as Jekyll and Hugo posts have
 * them, whose lines read as list items. */
const FRONT_MATTER = [
  '---\ntitle: Notes\n---\n',
  '---\ntitle: Notes\ntags: [a, b]\n...\n',
  '---\ntitle: Notes\ntags:\n  - a\n  - b\n---\n',
  '---\ntags:\n- a\n- b\n...\n',
  '---\ntitle: Notes\n---\n\n',
  '---\ntitle: Notes\n...\n\n',
];

/** Inline constructs that take no marker inside them, or only in some places (format §3.1):
 * links, images, URLs, entities, code, emphasis, escapes. */
const CONSTRUCTS: readonly ((pick: <T>(items: readonly T[]) => T) => string)[] = [
  (pick) => `[${pick(WORDS)} ${pick(WORDS)}](https://example.org/a "${pick(WORDS)}")`,
  (pick) => `![${pick(WORDS)}](img/${pick(WORDS)}.png)`,
  () => '<https://example.org/x>',
  () => 'https://example.org/path?q=1',
  () => 'caf&eacute;',
  (pick) => `\`${pick(WORDS)}\``,
  (pick) => `**${pick(WORDS)}**`,
  (pick) => `*${pick(WORDS)}*`,
  (pick) => `_${pick(WORDS)}_`,
  (pick) => `foo**${pick(WORDS)}**baz`,
  () => 'snake_case_name',
  () => '\\*literal\\*',
];

/** Constructs added since the tests that pin a seed were written (`RandomDocumentOptions.legacy`
 * leaves them out). The tags that are formats (format §2.6): subscript and superscript, on their
 * own, around and inside other formats, and around a space; and tags that are not read, which show
 * as written. */
const NEWER_CONSTRUCTS: readonly ((pick: <T>(items: readonly T[]) => T) => string)[] = [
  (pick) => `<sub>${pick(WORDS)}</sub>`,
  (pick) => `<sup>${pick(WORDS)} ${pick(WORDS)}</sup>`,
  (pick) => `**<sub>${pick(WORDS)}</sub>**`,
  (pick) => `<sup>*${pick(WORDS)}*</sup>`,
  (pick) => `H<sub>${pick(WORDS)}</sub>O`,
  (pick) => `x<sup>${pick(WORDS)}</sup>y`,
  (pick) => `<SUB>${pick(WORDS)}</SUB>`,
  (pick) => `<sub class="s">${pick(WORDS)}</sub>`,
  // A tag with no pair, one that a backslash escapes, and a word that ends in a backslash: the
  // tags are text, and a pair written around them must still pair with itself.
  () => '<sub>',
  () => '</sup>',
  (pick) => `\\<sup>${pick(WORDS)}</sup>`,
  (pick) => `${pick(WORDS)}\\\\`,
  // Emoji (#312, format §3.1): shortcodes with a space, a letter or a digit against them (no marker
  // goes between a letter and one), two together, in emphasis, and the times and words with colons
  // that are none; and emoji of several code points, which no marker parts.
  () => ':tent:',
  (pick) => `${pick(WORDS)} :+1: ${pick(WORDS)}`,
  (pick) => `${pick(WORDS)}:smile:`,
  (pick) => `:t-rex:${pick(WORDS)}`,
  () => ':smile::tent:',
  (pick) => `**${pick(WORDS)} :tent:**`,
  () => 'at 10:30:45 and :30: and a :x y: b',
  (pick) => pick(EMOJI_SEQUENCES),
  (pick) => `${pick(WORDS)} ${pick(EMOJI_SEQUENCES)}${pick(WORDS)}`,
];

/** Emoji of several code points: a family, a flag, a skin tone, a keycap, a heart with its variation
 * selector, a person with a tone and a ZWJ, and the flag of a subdivision. */
const EMOJI_SEQUENCES = ['👨‍👩‍👧', '🇩🇪', '👍🏽', '1️⃣', '❤️', '🧑🏽‍💻', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'];

/** The first lines of an alert (#311, format §3.1, §3.3): GitHub's types in capitals and in lowercase,
 * a type that GitHub doesn't have, and a title and a fold mark after the type, which are text to
 * GitHub. */
const ALERT_LINES = [
  '[!NOTE]',
  '[!TIP]',
  '[!IMPORTANT]',
  '[!WARNING]',
  '[!CAUTION]',
  '[!note]',
  '[!tip]',
  '[!info]',
  '[!NOTE]- Folded',
  '[!info] A title',
];

/** Inline constructs of pandoc's dialect that Quarto uses (format §3.1, rule 9, §9.1): citations,
 * cross-references, shortcodes, `~x~` and `^x^` (#1039), spans with attributes and inline code with
 * a language. Marks may stand around them, never inside. Drawn only with `dialect: 'pandoc'`. */
const PANDOC_CONSTRUCTS: readonly ((pick: <T>(items: readonly T[]) => T) => string)[] = [
  () => '@fig-plot',
  () => '@sec-intro.',
  (pick) => `@tbl-${pick(['a', 'b', 'results'])}`,
  () => '@eq-energy',
  () => '[@smith2020, p. 4]',
  () => '[@smith2020; @doe2021]',
  () => '[-@smith2020]',
  (pick) => `see @smith2020 and ${pick(WORDS)}`,
  () => '{{< var version >}}',
  () => '{{< meta title >}}',
  (pick) => `${pick(WORDS)} {{< pagebreak >}}`,
  () => 'H~2~O',
  () => 'x~i~',
  (pick) => `~${pick(['a', 'b1', 'n'])}~`,
  () => 'E = mc^2^',
  (pick) => `^${pick(['th', '3', 'n+1'])}^`,
  (pick) => `[${pick(WORDS)}]{.mark}`,
  () => '`r 1 + 1`',
  () => '`python x`',
];

/** The attribute blocks of divs that Quarto and pandoc know. */
const DIV_ATTRIBUTES = [
  '{.callout-note}',
  '{.callout-tip}',
  '{.callout-warning title="Careful"}',
  '{.callout-important collapse="true"}',
  '{#fig-panel .column width="40%"}',
  '{.panel-tabset}',
  'columns',
  '{.hidden}',
];

/** Fenced code chunks, with and without options, whose lines hold no marker. */
const CHUNKS = [
  '```{r}\nx <- 1:10\nplot(x)\n```',
  '```{r}\n#| label: fig-plot\n#| fig-cap: "A plot"\nplot(1:3)\n```',
  '```{python}\n#| echo: false\nprint(42)\n```',
  '````{r}\n```\nnested\n```\n````',
];

/** What a random document holds besides the blocks every one may have. */
interface RandomDocumentOptions {
  /** The dialect of the file the document is in (format §9.1). In the pandoc dialect the document
   * mixes ordinary Markdown with what Quarto has: `:::` divs and callouts (a nested one too), code
   * chunks, includes, headings with attributes, and, inside the text, citations, cross-references,
   * shortcodes, `~x~` and `^x^`. A document of the default dialect is as it always was. */
  dialect?: 'gfm' | 'pandoc';
  /** Draw only what the generator drew before the forms of #310 and #311, so that a test that pins
   * a seed it found by a long run makes the document it was found with. The other documents of
   * every suite hold the newer forms (`NEWER_CONSTRUCTS`). */
  legacy?: boolean;
  /** Now and then an indented code block of plain words, with a blank line or a line of `>` alone
   * among its lines, at the top level, in a list item or in a quote; and now and then a paragraph
   * or an item whose wrapped lines are indented four columns past its text, which goes on the
   * paragraph and is no code, but would be once a blank line came above it (format §2.1). No
   * marker is in the code. */
  indentedCode?: boolean;
}

/** A document with a ledger, made of blocks (paragraphs, bullet and numbered items, quotes,
 * headings) of plain words, constructs that take no marker inside them, insertions, deletions,
 * substitutions, comments (ranges, points, and ranges that cross an insertion) and highlights,
 * now and then after front matter. Insertions and substitutions hold other people's marks. Every
 * block starts with a plain word, and a line is only wrapped inside a run of plain words, so that
 * no marker starts a line. */
export function randomDocument(random: () => number, options: RandomDocumentOptions = {}): string {
  const taken = new Set<string>();
  const pandoc = options.dialect === 'pandoc';
  const constructs = [
    ...CONSTRUCTS,
    ...(options.legacy === true ? [] : NEWER_CONSTRUCTS),
    ...(pandoc ? PANDOC_CONSTRUCTS : []),
  ];
  const marks: Ledger['marks'] = {};
  const comments: Thread[] = [];
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const bytes = (n: number) => Uint8Array.from({ length: n }, () => below(256));
  const id = () => {
    const value = newId(taken, bytes);
    taken.add(value);
    return value;
  };
  const authorOtherThan = (other?: string) => pick(AUTHORS.filter((a) => a !== other));
  const words = (max: number) =>
    Array.from({ length: 1 + below(max) }, () => pick(WORDS)).join(' ');
  /** The prefix of the lines that follow the first line of the block being made, which plain words
   * may be wrapped onto; null for a heading, which is one line. */
  let wrapPrefix: string | null = '';
  const plain = (max: number) =>
    Array.from({ length: 1 + below(max) }, () => pick(WORDS)).reduce(
      (text, word, i) =>
        i === 0
          ? word
          : `${text}${wrapPrefix !== null && random() < 0.25 ? `\n${wrapPrefix}` : ' '}${word}`,
      '',
    );
  const payload = () => encodePayload(random() < 0.3 ? `${words(2)} ${pick(AWKWARD)}` : words(2));
  const markId = (by: string) => {
    const value = id();
    marks[value] = { by, at: '2026-10-13T22:30Z' };
    return value;
  };
  const threadId = () => {
    const value = id();
    comments.push({
      id: value,
      by: pick(AUTHORS),
      at: '2026-10-13T22:40Z',
      likes: [],
      replies: [],
      text: random() < 0.3 ? `Is this ${pick(AWKWARD)}?` : 'A note.',
      ...(random() < 0.5 ? { quote: words(2) } : {}),
    });
    return value;
  };

  /** `container` is the author of the insertion or substitution around, whose marks are other
   * people's, as in format §3.6. Such a container holds no insertion: it holds deletions and
   * substitutions. */
  function unit(depth: number, container?: string): string {
    if (random() < 0.12) return pick(constructs)(pick);
    const roll = random();
    if (roll < 0.34 || depth > 3) return plain(3);
    if (roll < 0.5 && depth < 3) {
      if (container !== undefined)
        return `<!--del ${markId(authorOtherThan(container))} ${payload()}-->`;
      const by = authorOtherThan(container);
      const value = markId(by);
      return `<!--ins ${value}-->${inline(depth + 1, by)}<!--/${value}-->`;
    }
    if (roll < 0.62) {
      return `<!--del ${markId(authorOtherThan(container))} ${payload()}-->`;
    }
    if (roll < 0.7 && depth < 3) {
      const by = authorOtherThan(container);
      const value = markId(by);
      return `<!--sub ${value} ${payload()}-->${inline(depth + 1, by)}<!--/${value}-->`;
    }
    if (roll < 0.8) {
      const value = threadId();
      return `<!--cmt ${value}-->${inline(depth + 1, container)}<!--/${value}-->`;
    }
    if (roll < 0.85) return `<!--cmt ${threadId()}-->`;
    if (roll < 0.91) {
      const value = markId(authorOtherThan(container));
      return `<!--hl ${value}-->${inline(depth + 1, container)}<!--/${value}-->`;
    }
    if (depth === 0) {
      // A comment or highlight that starts inside an insertion and ends after it, or the reverse.
      const by = authorOtherThan(container);
      const change = markId(by);
      const note = roll < 0.96 ? threadId() : markId(authorOtherThan());
      const kind = comments.some((thread) => thread.id === note) ? 'cmt' : 'hl';
      const [one, two, three] = [words(2), words(2), words(2)];
      return random() < 0.5
        ? `<!--ins ${change}-->${one} <!--${kind} ${note}-->${two}<!--/${change}--> ${three}<!--/${note}-->`
        : `<!--${kind} ${note}-->${one} <!--ins ${change}-->${two}<!--/${note}--> ${three}<!--/${change}-->`;
    }
    return plain(2);
  }

  function inline(depth: number, container?: string): string {
    const count = 1 + below(depth === 0 ? 6 : 3);
    return Array.from({ length: count }, () => unit(depth, container)).join(' ');
  }

  /** The lines of an indented code block, each after `prefix` (the container's, and the four
   * spaces): plain words, with now and then a blank line or a line of `>` alone between them. */
  function code(prefix: string): string {
    const lines = [`${prefix}${words(4)}`];
    for (let n = below(3); n > 0; n--) {
      const roll = below(4);
      if (roll === 0) lines.push(prefix.replace(/ {4}$/, '').trimEnd());
      else if (roll === 1) lines.push(`${prefix}>`);
      lines.push(`${prefix}${words(4)}`);
    }
    return lines.join('\n');
  }

  /** A block of Quarto: a div or callout (with a heading, a list or a quote in it, or another div),
   * an include, a code chunk, or a heading with an attribute. */
  function quarto(line: (prefix: string | null) => string): string {
    const roll = below(10);
    if (roll < 5) {
      const parts = [line('')];
      if (below(3) === 0) parts.push(`- ${line('  ')}\n- ${line('  ')}`);
      if (below(4) === 0) parts.push(`> ${line('> ')}`);
      if (below(4) === 0) parts.unshift(`## ${line(null)}`);
      if (below(4) === 0) parts.push(line(''));
      const gap = below(3) === 0 ? '\n\n' : '\n';
      return `::: ${pick(DIV_ATTRIBUTES)}${gap}${parts.join('\n\n')}${gap}:::`;
    }
    if (roll < 6) {
      const inner = `::: ${pick(DIV_ATTRIBUTES)}\n${line('')}\n:::`;
      return `::::: {.outer}\n${inner}\n\n${line('')}\n:::::`;
    }
    if (roll < 7) return pick(['{{< include _part.qmd >}}', '{{< include "chapters/two.qmd" >}}']);
    if (roll < 9) return pick(CHUNKS);
    return `## ${line(null)} {#sec-${pick(['intro', 'methods', 'a1'])}}`;
  }

  /** A block: its lines, each with the prefix of the block. */
  function block(): string {
    const line = (prefix: string | null) => {
      wrapPrefix = prefix;
      return `${pick(WORDS)} ${inline(0)}`;
    };
    if (pandoc && below(5) < 2) return quarto(line);
    if (options.indentedCode === true && below(4) === 0) {
      const where = below(5);
      if (where === 0) return code('    ');
      if (where === 1) return `- ${line('  ')}\n\n${code('      ')}`;
      if (where === 2) return `> ${line('> ')}\n>\n${code('>     ')}`;
      // Lines indented four columns past the text of the paragraph or item they go on.
      if (where === 3) return line('    ');
      return `- ${line('      ')}`;
    }
    // An alert: a quote that starts with a type in brackets, then a paragraph's lines, and now and
    // then a second paragraph after a blank line of the quote (before #358 a prefix edit of that blank
    // line was written without its line breaks). Not in the documents of a pinned seed (`legacy`),
    // which draw nothing here.
    if (options.legacy !== true && below(7) === 0) {
      const alert = `> ${pick(ALERT_LINES)}\n> ${line('> ')}`;
      return below(3) === 0 ? `${alert}\n>\n> ${line('> ')}` : alert;
    }
    const kind = below(10);
    if (kind < 5) return line('');
    if (kind < 7) {
      return Array.from({ length: 1 + below(3) }, () => `- ${line('  ')}`).join('\n');
    }
    if (kind < 8) {
      return Array.from({ length: 1 + below(2) }, (_, i) => `${i + 1}. ${line('   ')}`).join('\n');
    }
    if (kind < 9) return `> ${line('> ')}`;
    return `## ${line(null)}`;
  }

  const blocks = Array.from({ length: 1 + below(3) }, block).join('\n\n');
  // Now and then front matter, which the first block may follow right under its closing line:
  // drawn last, so that the blocks are those of the document without it.
  const body = (random() < 0.25 ? pick(FRONT_MATTER) : '') + blocks;
  if (Object.keys(marks).length === 0 && comments.length === 0) return `${body}\n`;
  const ledger: Ledger = {
    version: 1,
    people: [
      { handle: 'ada', name: 'Ada Lovelace' },
      { handle: 'bo', name: 'Bo Chen' },
      { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' },
    ],
    marks,
    comments,
  };
  return `${body}\n\n${serializeLedger(normalizeLedger(body, ledger))}\n`;
}

/** Words of a document with no marks. */
const PLAIN = ['alpha', 'beta', 'gamma', 'delta', 'plan', 'ship', 'review', 'note', 'text', 'code'];

/**
 * A document of plain words, with no marks, in the shapes Markdown files take where indented code
 * is near (format §2.1): bullets and numbers, nested two, three or four columns in, at the column
 * of their text, or with tabs; items with a second paragraph (at their text, or a column further
 * in, as Python-Markdown writes numbered steps), with indented code four columns past their text,
 * also at their end, before the next item, and with a quote or a fenced block in them; wrapped
 * lines, indented or not; paragraphs, headings, quotes with lists, indented and fenced code,
 * tables and HTML blocks, with a blank line between them or none.
 */
export function listDocument(random: () => number): string {
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const words = (count: number) => Array.from({ length: count }, () => pick(PLAIN)).join(' ');
  const paragraph = (first: string, wrap: string) => {
    const lines = [first + words(3 + below(5))];
    for (let n = below(3); n > 0; n--) {
      lines.push(wrap + pick(['', '', ' ', '  ', '    ', '      ']) + words(2 + below(4)));
    }
    return lines.join('\n');
  };
  const list = (indent: string, depth: number, unit: string): string => {
    const ordered = below(3) === 0;
    const items: string[] = [];
    for (let i = 0; i < 1 + below(3); i++) {
      const marker = ordered ? `${i + 1}. ` : pick(['- ', '* ', '+ ']);
      const pad = indent + ' '.repeat(marker.length);
      let item = paragraph(indent + marker, below(2) ? pad : indent);
      const roll = below(8);
      if (roll === 0) item += `\n\n${paragraph(pad + pick(['', ' ']), pad)}`;
      if (roll === 1) item += `\n\n${pad}    ${words(3)}\n${pad}    ${words(2)}`;
      if (roll === 2) item += `\n${pad}> ${words(4)}`;
      if (roll === 3) item += `\n\n${pad}\`\`\`\n${pad}    ${words(2)}\n${pad}\`\`\``;
      if (depth < 4 && below(2) === 0) {
        const nested = unit === '\t' ? `${indent}\t` : unit === 'content' ? pad : indent + unit;
        item += (below(4) === 0 ? '\n\n' : '\n') + list(nested, depth + 1, unit);
      }
      items.push(item);
    }
    return items.join(below(4) === 0 ? '\n\n' : '\n');
  };
  const block = (): string => {
    const kind = below(12);
    if (kind < 3) return paragraph('', '');
    if (kind < 6) return list('', 1, pick(['  ', '   ', '    ', '\t', 'content']));
    if (kind === 6) return `## ${words(3)}`;
    if (kind === 7) {
      const lazy = below(2) === 0 ? words(2) : '>';
      return [`> ${words(4)}`, `> ${words(3)}`, lazy, `> - ${words(2)}`, `>   - ${words(2)}`].join(
        '\n',
      );
    }
    if (kind === 8) return `    ${words(3)}\n    ${words(2)}\n\n    ${words(2)}`;
    if (kind === 9) return `\`\`\`\n${words(2)}\n    ${words(3)}\n\`\`\``;
    if (kind === 10) return `| a | b |\n| - | - |\n| ${words(1)} | ${words(1)} |`;
    return `<div>\n${words(3)}\n</div>`;
  };
  return `${Array.from({ length: 8 }, block).join(below(5) === 0 ? '\n' : '\n\n')}\n`;
}

/**
 * Lists of different markers side by side (`-`, `+`, `*`, `1.`, `1)`), at the same and at different
 * depths, with a line of text above or under them or none, and a blank line between them or none:
 * the shapes where one list's end and another's start meet, and an empty item can or can't start a
 * list. Quotes and nested items carry them too.
 */
export function adjacentListsDocument(random: () => number): string {
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const words = (count: number) => Array.from({ length: count }, () => pick(PLAIN)).join(' ');
  const markers = ['- ', '+ ', '* ', '1. ', '1) ', '2. '];
  const run = (indent: string, depth: number): string => {
    const marker = pick(markers);
    const pad = indent + ' '.repeat(marker.length);
    const lines: string[] = [];
    for (let i = 1 + below(3); i > 0; i--) {
      lines.push(`${indent}${marker}${words(2)}`);
      if (below(3) === 0) lines.push(`${pad}${words(2)}`);
      if (depth < 3 && below(3) === 0) {
        if (below(2) === 0) lines.push('');
        lines.push(run(pad, depth + 1));
      }
      if (below(5) === 0) lines.push('');
    }
    return lines.join('\n');
  };
  const block = (): string => {
    const prefix = below(4) === 0 ? '> ' : '';
    const parts: string[] = [];
    if (below(3) === 0) parts.push(words(3));
    for (let i = 1 + below(3); i > 0; i--) {
      parts.push(run('', 1));
      if (below(3) === 0) parts.push(words(3));
    }
    const text = parts.join(below(2) === 0 ? '\n' : '\n\n');
    return prefix ? text.replace(/^/gm, (m) => m + prefix).replace(/^> $/gm, '>') : text;
  };
  return `${Array.from({ length: 6 }, block).join('\n\n')}\n`;
}

/**
 * Lists with bare markers in them (`-`, `*`, `+`, `1.`, `1)` alone on their line, an empty item to
 * Markdown, #580): as the last line of the document, with a line after it, nested in an item or in a
 * quote, after items and after a line of text, in lists of any marker. Plain words, no marks.
 */
export function bareMarkerDocument(random: () => number): string {
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const words = (count: number) => Array.from({ length: count }, () => pick(PLAIN)).join(' ');
  const list = (indent: string): string => {
    const ordered = below(3) === 0;
    const mark = pick(['-', '*', '+']);
    const delimiter = pick(['.', ')']);
    const marker = (i: number) => (ordered ? `${i + 1}${delimiter}` : mark);
    const lines: string[] = [];
    const items = 1 + below(3);
    // One of the items, not the first, has no text and no space after its marker.
    const bare = items > 1 ? 1 + below(items - 1) : -1;
    for (let i = 0; i < items; i++) {
      lines.push(i === bare ? `${indent}${marker(i)}` : `${indent}${marker(i)} ${words(2)}`);
      if (i !== bare && below(4) === 0) {
        // A nested list that ends with a bare marker.
        const inner = indent + ' '.repeat(marker(i).length + 1);
        lines.push(
          `${inner}${pick(['-', '*', '+'])} ${words(1)}`,
          `${inner}${pick(['-', '*', '+'])}`,
        );
      }
    }
    return lines.join('\n');
  };
  const block = (): string => {
    const kind = below(6);
    if (kind === 0) return words(4);
    if (kind === 1) return `${words(3)}\n${list('')}`;
    if (kind === 2) return list('').replace(/^/gm, '> ');
    return list('');
  };
  // The last block ends the document with a bare marker half of the time.
  const blocks = Array.from({ length: 2 + below(3) }, block);
  if (below(2) === 0) {
    blocks.push(`${pick(['- ', '* ', '+ ', '1. ', '1) '])}${words(2)}\n${pick(['-', '*', '+'])}`);
  }
  return `${blocks.join(below(4) === 0 ? '\n' : '\n\n')}\n`;
}
