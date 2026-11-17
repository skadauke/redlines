// The format's check of a plain edit that a key writes as it stands (Tab and Shift-Tab in an empty
// item): the file must read, to micromark and in every order of decisions, as well as it did
// before the edit. What the edit breaks is what the caller widens to the list (format §3.12).

import {
  EditError,
  acceptAll,
  applyChanges,
  newestView,
  originalView,
  parse,
  rejectAll,
} from '@redlines/format';
import { micromark } from 'micromark';

/** HTML as a reader sees it: comments left out, and white space next to tags. */
const readable = (html: string) =>
  html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ?(<[^>]*>) ?/g, '$1')
    .trim();

const read = (text: string) => readable(micromark(text, { allowDangerousHtml: true }));

/** The text of a file before its ledger. */
function body(file: string): string {
  const range = parse(file).ledgerRange;
  return range ? file.slice(0, range.from) : file;
}

/**
 * What a file reads wrongly, by name: its body as micromark reads it against the newest view, all
 * marks accepted against the newest view, all rejected against the original, and the structural
 * warnings of the parse.
 */
export function readProblems(file: string): Map<string, string> {
  const found = new Map<string, string>();
  const newest = newestView(file).text;
  if (read(body(file)) !== read(newest)) found.set('render', read(body(file)));
  const decided = (changes: () => ReturnType<typeof acceptAll>, view: string, name: string) => {
    try {
      const got = read(body(applyChanges(file, changes())));
      if (got !== read(view)) found.set(name, got);
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      found.set(name, 'refused');
    }
  };
  decided(() => acceptAll(file), newest, 'accepted');
  decided(() => rejectAll(file), originalView(file).text, 'rejected');
  for (const warning of parse(file).warnings)
    found.set(`warning:${warning.code}:${warning.id ?? ''}`, '');
  return found;
}

/** Whether `after` reads wrongly in something that `before` read rightly. */
export function readsWorse(before: string, after: string): boolean {
  const had = readProblems(before);
  // A problem the file had is the same one only where it reads the same.
  for (const [problem, reading] of readProblems(after))
    if (had.get(problem) !== reading) return true;
  return false;
}
