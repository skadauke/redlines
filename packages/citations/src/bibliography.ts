// A bibliography as the few facts a citation in the text needs: who wrote it, when, and its title.
// BibTeX (`.bib`, `.bibtex`) and CSL JSON (`.json`) are read, the two files Quarto and pandoc take
// most; nothing here prints a list of references.

/** A name as a citation prints it: the family name (or the whole name of an organization). */
export interface Name {
  family: string;
  given?: string;
}

export interface Entry {
  key: string;
  authors: Name[];
  /** Editors, which stand in for authors that a work doesn't have. */
  editors: Name[];
  /** The year, or undefined for "n.d.". */
  year?: string;
  title?: string;
}

export type Bibliography = Map<string, Entry>;

/** LaTeX's accents and letters, as BibTeX files spell them, for the ones names use. */
const ACCENTS: Record<string, Record<string, string>> = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û' },
  '~': { a: 'ã', n: 'ñ', o: 'õ' },
  c: { c: 'ç', s: 'ş' },
  v: { c: 'č', s: 'š', z: 'ž', r: 'ř', e: 'ě', n: 'ň' },
};
const LETTERS: Record<string, string> = {
  ss: 'ß',
  o: 'ø',
  O: 'Ø',
  ae: 'æ',
  AE: 'Æ',
  aa: 'å',
  l: 'ł',
};

/** BibTeX text as plain text: braces dropped, accents and letters written out. */
export function plain(value: string): string {
  return value
    .replace(/\\(['`"^~cv])\s*\{?\\?([A-Za-z])\}?/g, (all, accent: string, letter: string) => {
      const base = letter.toLowerCase();
      const made = ACCENTS[accent]?.[base];
      return made ? (letter === base ? made : made.toUpperCase()) : letter;
    })
    .replace(/\\(ss|ae|AE|aa|o|O|l)\b\s*/g, (_all, letter: string) => LETTERS[letter] ?? letter)
    .replace(/\\&/g, '&')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One name of a BibTeX `author` field: `Last, First`, `First Last` or `{An Organization}`. */
function bibtexName(raw: string): Name | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\{.*\}$/s.test(text) && !/[{}]/.test(text.slice(1, -1))) {
    return { family: plain(text) };
  }
  if (text.includes(',')) {
    const [family = '', ...rest] = text.split(',');
    return { family: plain(family), given: plain(rest.join(' ')) };
  }
  // `First von Last`: the family name starts at the first word in lower case that has a word after
  // it, else it is the last word.
  const words = splitWords(text);
  let start = words.length - 1;
  for (let i = 0; i < words.length - 1; i++) {
    if (/^[a-z]/.test(words[i] ?? '')) {
      start = i;
      break;
    }
  }
  return {
    family: plain(words.slice(start).join(' ')),
    given: plain(words.slice(0, start).join(' ')),
  };
}

/** The words of a text, braced groups kept whole. */
function splitWords(text: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let word = '';
  for (const char of text) {
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (/\s/.test(char) && depth === 0) {
      if (word) words.push(word);
      word = '';
    } else word += char;
  }
  if (word) words.push(word);
  return words;
}

/** The names of an `author` field, which are parted by ` and ` outside braces. */
function bibtexNames(value: string): Name[] {
  const names: Name[] = [];
  let depth = 0;
  let current = '';
  const words = value.split(/(\s+)/);
  for (const piece of words) {
    if (depth === 0 && piece === 'and') {
      const name = bibtexName(current);
      if (name) names.push(name);
      current = '';
      continue;
    }
    for (const char of piece) {
      if (char === '{') depth++;
      if (char === '}') depth--;
    }
    current += piece;
  }
  const last = bibtexName(current);
  if (last) names.push(last);
  return names;
}

/** The value of a field at `at` in a BibTeX entry, and where it ends. */
function fieldValue(body: string, at: number): { value: string; end: number } {
  let i = at;
  let value = '';
  while (i < body.length) {
    while (/\s/.test(body[i] ?? '')) i++;
    const char = body[i];
    if (char === '{') {
      let depth = 0;
      const start = i + 1;
      for (; i < body.length; i++) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}' && --depth === 0) break;
      }
      value += body.slice(start, i);
      i++;
    } else if (char === '"') {
      const start = ++i;
      let depth = 0;
      for (; i < body.length; i++) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}') depth--;
        else if (body[i] === '"' && depth === 0) break;
      }
      value += body.slice(start, i);
      i++;
    } else {
      const found = /^[\w.:-]+/.exec(body.slice(i));
      if (!found) break;
      value += found[0];
      i += found[0].length;
    }
    while (/\s/.test(body[i] ?? '')) i++;
    if (body[i] === '#') i++;
    else break;
  }
  return { value, end: i };
}

/** The entries of a BibTeX file. */
export function parseBibtex(text: string): Bibliography {
  const entries: Bibliography = new Map();
  const start = /@([A-Za-z]+)\s*[{(]/g;
  for (let found = start.exec(text); found; found = start.exec(text)) {
    const type = (found[1] ?? '').toLowerCase();
    // The entry ends at its matching brace.
    const open = found.index + found[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      if (text[end] === '{' || text[end] === '(') depth++;
      else if (text[end] === '}' || text[end] === ')') if (--depth === 0) break;
    }
    start.lastIndex = end;
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;
    const body = text.slice(open + 1, end);
    const comma = body.indexOf(',');
    if (comma < 0) continue;
    const key = body.slice(0, comma).trim();
    const fields = new Map<string, string>();
    const name = /([A-Za-z][\w-]*)\s*=\s*/g;
    name.lastIndex = comma + 1;
    for (let field = name.exec(body); field; field = name.exec(body)) {
      const { value, end: after } = fieldValue(body, field.index + field[0].length);
      fields.set((field[1] ?? '').toLowerCase(), value);
      name.lastIndex = after;
    }
    const date = fields.get('year') ?? /^\d{4}/.exec(fields.get('date') ?? '')?.[0];
    const year = /\d{4}/.exec(date ?? '')?.[0];
    const organization = fields.get('organization') ?? fields.get('institution');
    const authors = fields.has('author') ? bibtexNames(fields.get('author') ?? '') : [];
    entries.set(key, {
      key,
      authors:
        authors.length === 0 && organization && !fields.has('editor')
          ? [{ family: plain(organization) }]
          : authors,
      editors: fields.has('editor') ? bibtexNames(fields.get('editor') ?? '') : [],
      ...(year ? { year } : {}),
      ...(fields.has('title') ? { title: plain(fields.get('title') ?? '') } : {}),
    });
  }
  return entries;
}

interface CslName {
  family?: string;
  given?: string;
  literal?: string;
  'non-dropping-particle'?: string;
  'dropping-particle'?: string;
}
interface CslItem {
  id?: string | number;
  author?: CslName[];
  editor?: CslName[];
  title?: string;
  issued?: { 'date-parts'?: (string | number)[][]; literal?: string; raw?: string };
}

const cslNames = (names: CslName[] | undefined): Name[] =>
  (names ?? []).flatMap((name): Name[] => {
    if (name.literal) return [{ family: name.literal }];
    if (!name.family) return [];
    const family = [name['non-dropping-particle'], name.family].filter(Boolean).join(' ');
    return [{ family, ...(name.given ? { given: name.given } : {}) }];
  });

/** The entries of a CSL JSON file; an array of items, or a file that holds one. */
export function parseCslJson(text: string): Bibliography {
  const entries: Bibliography = new Map();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return entries;
  }
  const items: unknown = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown }).items
      : [];
  for (const item of items as CslItem[]) {
    if (!item || typeof item !== 'object' || item.id === undefined) continue;
    const key = String(item.id);
    const raw = item.issued?.['date-parts']?.[0]?.[0] ?? item.issued?.literal ?? item.issued?.raw;
    const year = /\d{4}/.exec(String(raw ?? ''))?.[0];
    entries.set(key, {
      key,
      authors: cslNames(item.author),
      editors: cslNames(item.editor),
      ...(year ? { year } : {}),
      ...(typeof item.title === 'string' ? { title: item.title } : {}),
    });
  }
  return entries;
}

/** A bibliography file's entries, by what the file's name says it is. */
export function parseBibliography(path: string, text: string): Bibliography {
  return /\.json$/i.test(path) ? parseCslJson(text) : parseBibtex(text);
}
