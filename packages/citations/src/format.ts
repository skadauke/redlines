// A citation as the text prints it. Pandoc's default is the Chicago author-date style: `(Knuth 1984)`,
// `Knuth (1984)` for a citation that is part of the sentence, `(Lamport 1994, 4)` with a page and
// `(Knuth 1984; Lamport 1994)` for several. Two more styles are read from a CSL file's name and
// title: APA's author-date (`(Knuth, 1984)`) and numbers (`[1]`). Any other style is drawn as the
// default, which a caller can say (`styleOfCsl` answers `undefined` for it).

import type { Bibliography, Entry } from './bibliography.ts';

export type StyleName = 'chicago-author-date' | 'apa' | 'numeric';

/** What a CSL file says it is: its title and id, which name the styles that are known. */
export function styleOfCsl(csl: string): StyleName | undefined {
  const head = [
    /<id>([^<]*)<\/id>/.exec(csl)?.[1],
    /<title>([^<]*)<\/title>/.exec(csl)?.[1],
    /<title-short>([^<]*)<\/title-short>/.exec(csl)?.[1],
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/chicago[^ ]*author-date|chicago.*author-date/.test(head)) return 'chicago-author-date';
  if (/\bapa\b|american-psychological/.test(head)) return 'apa';
  if (/ieee|vancouver|nature|numeric|\bamerican-medical/.test(head)) return 'numeric';
  if (/citation-format="numeric"/.test(csl)) return 'numeric';
  return undefined;
}

/** One cited work of a citation: `see @knuth1984, p. 4`, or `-@knuth1984`. */
export interface Item {
  key: string;
  prefix: string;
  /** What follows the key, after its comma: `p. 4`. */
  suffix: string;
  /** `-@key`: the author is left out. */
  suppress: boolean;
}

const KEY = /(-)?@([\w][\w:.#$%&+?<>~/-]*)(?<![:.#$%&+?<>~/-])/;

/** The items of a citation in brackets, `[see @a, p. 4; @b]`, or undefined where it names none. */
export function parseBracket(bracket: string): Item[] | undefined {
  const items: Item[] = [];
  for (const part of bracket.slice(1, -1).split(';')) {
    const found = KEY.exec(part);
    if (!found || found.index === undefined) continue;
    items.push({
      key: found[2] ?? '',
      prefix: part.slice(0, found.index).trim(),
      suffix: part
        .slice(found.index + found[0].length)
        .trim()
        .replace(/^,\s*/, ''),
      suppress: found[1] === '-',
    });
  }
  return items.length > 0 ? items : undefined;
}

/** What a document's citations are formatted with. */
export interface Context {
  bib: Bibliography;
  style: StyleName;
  /** The letter after a year that tells two works of one author and year apart. */
  suffixes: Map<string, string>;
  /** The number of each work in the order it is first cited, for numbers. */
  numbers: Map<string, number>;
}

function authorsOf(entry: Entry, style: StyleName): string {
  const names = (entry.authors.length > 0 ? entry.authors : entry.editors).map((n) => n.family);
  if (names.length === 0) return entry.title ?? entry.key;
  if (style === 'apa') {
    if (names.length === 1) return names[0] ?? '';
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names[0]} et al.`;
  }
  if (names.length === 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `${names[0]} et al.`;
}

/** The context for citing `cited` (every key of the document, in order) from `bib`. */
export function makeContext(bib: Bibliography, style: StyleName, cited: string[]): Context {
  const numbers = new Map<string, number>();
  const groups = new Map<string, Entry[]>();
  for (const key of cited) {
    const entry = bib.get(key);
    if (!entry || numbers.has(key)) continue;
    numbers.set(key, numbers.size + 1);
    const same = `${authorsOf(entry, style)}|${entry.year ?? ''}`;
    groups.set(same, [...(groups.get(same) ?? []), entry]);
  }
  const suffixes = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    [...group]
      .sort((a, b) => (a.title ?? '').toLowerCase().localeCompare((b.title ?? '').toLowerCase()))
      .forEach((entry, i) => suffixes.set(entry.key, String.fromCharCode(97 + (i % 26))));
  }
  return { bib, style, suffixes, numbers };
}

const year = (entry: Entry, ctx: Context) =>
  `${entry.year ?? 'n.d.'}${ctx.suffixes.get(entry.key) ?? ''}`;

/** A locator as the style prints it: Chicago leaves the label of a page out, APA keeps it. */
function locator(suffix: string, style: StyleName): string {
  const text = suffix.trim();
  if (!text) return '';
  const page = /^(pp?|pages?)\.?\s*(.+)$/i.exec(text);
  if (!page) return text;
  const value = (page[2] ?? '').replace(/(\d)\s*-+\s*(\d)/g, '$1–$2');
  if (style === 'apa') return `${/–|,/.test(value) ? 'pp.' : 'p.'} ${value}`;
  return value;
}

/**
 * A citation in brackets as printed, `(Knuth 1984)`; undefined where a key is not in the
 * bibliography, which the caller shows as the key.
 */
export function formatBracket(items: Item[], ctx: Context): string | undefined {
  const entries = items.map((item) => ctx.bib.get(item.key));
  if (entries.some((entry) => entry === undefined)) return undefined;
  if (ctx.style === 'numeric') {
    const numbers = items.map((item) => ctx.numbers.get(item.key) ?? 0).sort((a, b) => a - b);
    return `[${numbers.join(', ')}]`;
  }
  const comma = ctx.style === 'apa' ? ', ' : ' ';
  const parts: string[] = [];
  items.forEach((item, i) => {
    const entry = entries[i] as Entry;
    const prefix = item.prefix ? `${item.prefix} ` : '';
    const where = locator(item.suffix, ctx.style);
    const tail = where ? `, ${where}` : '';
    const author = authorsOf(entry, ctx.style);
    const last = items[i - 1];
    const lastEntry = entries[i - 1];
    // The same author again, with nothing before it: the year only (`Knuth 1984, 1986`).
    if (
      last &&
      lastEntry &&
      !item.suppress &&
      !item.prefix &&
      !last.suppress &&
      authorsOf(lastEntry, ctx.style) === author &&
      parts.length > 0
    ) {
      const same = lastEntry.year === entry.year;
      parts[parts.length - 1] +=
        `, ${same ? (ctx.suffixes.get(entry.key) ?? year(entry, ctx)) : year(entry, ctx)}${tail}`;
      return;
    }
    parts.push(
      item.suppress
        ? `${prefix}${year(entry, ctx)}${tail}`
        : `${prefix}${author}${comma}${year(entry, ctx)}${tail}`,
    );
  });
  return `(${parts.join('; ')})`;
}

/** A citation that is part of the sentence, `Knuth (1984)`; undefined where the key isn't known. */
export function formatNarrative(key: string, ctx: Context): string | undefined {
  const entry = ctx.bib.get(key);
  if (!entry) return undefined;
  if (ctx.style === 'numeric') return `[${ctx.numbers.get(key) ?? 0}]`;
  return `${authorsOf(entry, ctx.style)} (${year(entry, ctx)})`;
}
