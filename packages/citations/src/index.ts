export { parseBibliography, parseBibtex, parseCslJson } from './bibliography.ts';
export type { Bibliography, Entry, Name } from './bibliography.ts';
export { formatBracket, formatNarrative, makeContext, parseBracket, styleOfCsl } from './format.ts';
export type { Context, Item, StyleName } from './format.ts';

/** The bibliography files and style that a document's front matter names. */
export interface BibliographyRefs {
  files: string[];
  csl?: string;
}

/** What the front matter (the YAML between the first two `---` lines) says of its bibliography. */
export function bibliographyRefs(text: string): BibliographyRefs | undefined {
  if (!/^---[ \t]*\r?\n/.test(text)) return undefined;
  const end = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text.slice(3));
  if (!end) return undefined;
  const lines = text.slice(text.indexOf('\n') + 1, 3 + end.index).split(/\r?\n/);
  const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, '$2');
  const files: string[] = [];
  let csl: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const found = /^(bibliography|csl)\s*:\s*(.*)$/.exec(lines[i] ?? '');
    if (!found) continue;
    const rest = (found[2] ?? '').trim();
    const values: string[] = [];
    if (rest.startsWith('[')) {
      values.push(
        ...rest
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map(unquote),
      );
    } else if (rest) values.push(unquote(rest));
    else {
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s*-\s+(.*)$/.exec(lines[j] ?? '');
        if (!item) break;
        values.push(unquote(item[1] ?? ''));
      }
    }
    const names = values.filter(Boolean);
    if (found[1] === 'csl') csl = names[0];
    else files.push(...names);
  }
  return files.length > 0 ? { files, ...(csl ? { csl } : {}) } : undefined;
}
