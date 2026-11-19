// Finds the places in the sources where an edit is refused (format §3.12, hardening.md: never add a
// refusal), so that `refusals.node.test.ts` can hold each to a tier in `refusals.ts`. A refusal is
// thrown as `new EditError(message, code)`, handed to the editor as a key plan's `refusal:`, or shown
// as a notice (`notice(message)`). The key of a site is the file and the first words of its message,
// or the name of the constant that holds it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** A place in the sources that refuses (or may refuse) an edit. */
interface RefusalSite {
  /** The path from the repository's root. */
  file: string;
  /** The line it is on, from 1. */
  line: number;
  /** How it is written. */
  how: 'error' | 'plan' | 'notice' | 'effect' | 'constant';
  /** The first words of its message, or the name of the constant that holds it. */
  key: string;
  /** The error code, where it is given as a literal. */
  code: string | undefined;
}

/** The directories whose sources are read, from the repository's root. */
const SCANNED = ['packages/format/src', 'packages/editor/src'];

const PLUGINS = 'plugins';

function sourcesIn(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules') continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) sourcesIn(path, found);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|test-helpers|\.node\.ts$/.test(name))
      found.push(path);
  }
  return found;
}

/** The source of the first argument of the call that starts at `at` (just after its `(`), and where
 * the argument ends. A string or template is read to its end, and any other expression to the first
 * comma or closing bracket outside brackets. */
function firstArgument(source: string, at: number): { text: string; end: number } {
  let i = at;
  while (/\s/.test(source[i] ?? '')) i++;
  const start = i;
  const quote = source[i];
  if (quote === "'" || quote === '"' || quote === '`') {
    i++;
    while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1;
    i++;
    // A string joined to another with `+`, or a literal followed by more of an expression.
    const rest = /^\s*\+/.exec(source.slice(i));
    if (!rest) return { text: source.slice(start, i), end: i };
  }
  let depth = 0;
  for (i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) break;
    else if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
    }
  }
  return { text: source.slice(start, i), end: i };
}

/** The first words of a message literal, or the name that holds it. */
function keyOf(argument: string): string {
  const text = argument.trim();
  const literal = /^(['"`])([^]*)\1$/.exec(text);
  if (literal) return (literal[2] ?? '').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').slice(0, 48);
  const first = /^(['"`])((?:\\.|(?!\1)[^\\])*)/.exec(text);
  if (first) return (first[2] ?? '').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').slice(0, 48);
  return text.replace(/\s+/g, ' ').slice(0, 60);
}

/** Every site that refuses in the sources under `root`, in the order of the files. */
export function refusalSites(root: string): RefusalSite[] {
  const files = [
    ...SCANNED.flatMap((directory) => sourcesIn(join(root, directory))),
    ...readdirSync(join(root, PLUGINS))
      .map((name) => join(root, PLUGINS, name, 'src'))
      .filter((directory) => {
        try {
          return statSync(directory).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap((directory) => sourcesIn(directory)),
  ];
  const sites: RefusalSite[] = [];
  for (const path of files.sort()) {
    const source = readFileSync(path, 'utf8');
    const file = relative(root, path);
    const lineOf = (index: number) => source.slice(0, index).split('\n').length;
    const patterns: [RegExp, RefusalSite['how']][] = [
      [/new EditError\(/g, 'error'],
      [/\brefusal:\s*/g, 'plan'],
      [/\bnotice\(/g, 'notice'],
      [/\brefusedEditEffect\.of\(/g, 'effect'],
    ];
    // A message that a constant holds, which is shown where the constant is used: `const NAME =
    // "A comment can't be added in Plain."`. The words that make it a refusal are the ones every
    // refusal of the interface says.
    for (const match of source.matchAll(
      /^(?:export )?const ([A-Z][A-Z_]+)\s*=\s*(?:\n\s*)?(['"`])((?:\\.|(?!\2)[^\\])*)\2/gm,
    )) {
      const words = match[3] ?? '';
      if (!/can't|can’t|can not|first\.|Decide it|isn't a|aren't/i.test(words)) continue;
      sites.push({
        file,
        line: lineOf(match.index),
        how: 'constant',
        key: match[1] ?? '',
        code: undefined,
      });
    }
    for (const [pattern, how] of patterns) {
      for (const match of source.matchAll(pattern)) {
        // A mention in a comment is no refusal.
        const lineStart = source.lastIndexOf('\n', match.index) + 1;
        if (/^\s*(?:\/\/|\*|\/\*)/.test(source.slice(lineStart, match.index))) continue;
        const at = match.index + match[0].length;
        const { text, end } = firstArgument(source, at);
        // A type (`refusal: string`, `notice(message: string)`) and a pass-through of a variable are
        // no message of their own.
        if (text === '' || text === 'undefined' || /^(?:string|\w+: string)$/.test(text)) continue;
        // The code is the argument after the message, when it is a literal.
        const code = /^\s*,\s*'([a-z-]+)'/.exec(source.slice(end))?.[1];
        sites.push({ file, line: lineOf(match.index), how, key: keyOf(text), code });
      }
    }
  }
  return sites;
}
