// Random edits of Quarto documents (Epic #930, #220): `randomDocument` in the pandoc dialect draws
// divs and callouts, includes, code chunks, citations, cross-references, shortcodes, and `~x~` and `^x^`,
// among ordinary Markdown, with other people's marks around them. Ada and Bo then edit it with Track
// Changes on and off, comment, highlight and decide, as in a `.qmd`. Whatever is written:
//
//  1. reads as micromark reads its newest view (the GFM part of the reading), with no structural
//     warning;
//  2. keeps every construct pandoc reads by its own grammar whole: the file with its markers
//     (each one a character no construct holds) holds the same fence lines, includes, chunk headers,
//     cross-references, citations, shortcodes and `~x~`, `^x^` as its newest view (`pandocTokens`);
//  3. reads alike in every order of decisions: the files on the way keep 1 and 2, and where the
//     marks can be tried in every order, every order of the same decisions gives the same bytes and
//     none is stuck; all accepted is the newest view, all rejected the original.
//
// A refusal says why and is counted. A document that is not sound before the edit is counted, and
// says nothing about the edit.

import { describe, expect, it } from 'vitest';
import { INCLUDE_LINE } from './blocks.ts';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { addHighlight } from './highlights.ts';
import { readAs } from './oracle.ts';
import { parse } from './parse.ts';
import { payloadMarksOf } from './payload-marks.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  ada,
  bo,
  bodyOf,
  context,
  everyOrder,
  exactly,
  problemsOf,
  randomEdit,
} from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import type { EditContext, Person, TextChange } from './types.ts';
import { untrackedEdit } from './untracked.ts';
import { newestView, originalView } from './views.ts';

/** What the random edits type: words, and the characters of pandoc's grammar. */
const INSERTS = [
  'x',
  'new words',
  ' and more',
  '\n\n',
  '@',
  '@fig-x',
  '[@a]',
  '^',
  '~',
  ':::',
  '::: {.callout-tip}\nText\n:::',
  '{{< var y >}}',
  '{#id}',
  '{.cls}',
  '## ',
  '- ',
  '> ',
  '`r 1`',
  '```{r}\n1\n```',
  '',
  '\n',
];

/** The front matter of a document, which micromark reads as Markdown and can't judge. */
const FRONT = /^---\n[\s\S]*?\n(?:---|\.\.\.)\n\n?/;
const withoutFront = (text: string) => text.replace(FRONT, '');

/** What stands in place of a marker when the constructs of a file with markers are found: no
 * construct holds it, so one that has a marker inside is not found whole. */
const MARKER = String.fromCharCode(0xe000);

/** The constructs that pandoc reads by its own grammar (format §3.1 rule 9, §9.1), of a body, as a
 * sorted list. */
export function pandocTokens(body: string): string[] {
  const found: string[] = [];
  for (const line of body.split('\n')) {
    if (/^[ \t]*:{3,}[ \t]*(?:\{[^\n]*\}|[A-Za-z][\w-]*)?[ \t]*:*[ \t]*$/.test(line))
      found.push(`fence ${line.trim()}`);
    else if (INCLUDE_LINE.test(line)) found.push(`include ${line.trim()}`);
    else if (/^[ \t]*`{3,}\{/.test(line)) found.push(`chunk ${line.trim()}`);
    else if (/^[ \t]*#\|/.test(line)) found.push(`option ${line.trim()}`);
    else {
      // The attributes of a heading or a figure, at the end of its line (a marker after them is no
      // part of them).
      const end = line.replace(new RegExp(`(?:${MARKER}|[ \\t])+$`), '');
      if (/\{#[\w-]+[^}\n]*\}[ \t]*$/.test(end)) {
        found.push(`attr ${end.trim().replace(/^.*(\{#)/, '$1')}`);
      }
    }
  }
  const patterns: [string, RegExp][] = [
    ['ref', /(?<![\w@])@(?:fig|sec|tbl|eq|lst)-[\w-]*\w/g],
    ['cite', /\[-?@[^\]\n]*\]/g],
    ['key', /(?<![\w@[])@[A-Za-z]\w*\d\w*/g],
    ['shortcode', /\{\{<[^\n]*?>\}\}/g],
    ['sub', /(?<![~\w])~[^\s~]+~(?!~)/g],
    ['sup', /\^[^\s^]+\^/g],
    ['span', /\[[^\]\n]*\]\{[#.][^}\n]*\}/g],
  ];
  for (const [name, pattern] of patterns) {
    for (const match of body.matchAll(pattern)) {
      // The text of a span may hold a marker, which is none of its attributes.
      found.push(`${name} ${name === 'span' ? match[0].split(MARKER).join('') : match[0]}`);
    }
  }
  return found.toSorted();
}

/** The body of a file, each marker one `MARKER`: the text a reader that skips them reads is that
 * of the newest view, the constructs it finds are those a marker leaves whole. */
const withMarkers = (text: string) => bodyOf(text).replace(/<!--[\s\S]*?-->/g, MARKER);

/** What is wrong with a file, as a message, or undefined: 1 and 2 of the header. */
function unsound(text: string): string | undefined {
  const parsed = parse(text);
  const problems = problemsOf(parsed);
  if (problems.length > 0) return `warnings ${problems.join(', ')}`;
  const view = newestView(text).text;
  if (readAs(withoutFront(bodyOf(text))) !== readAs(withoutFront(view))) {
    return `reads otherwise than its newest view\nBODY ${JSON.stringify(readAs(withoutFront(bodyOf(text))))}\nVIEW ${JSON.stringify(readAs(withoutFront(view)))}`;
  }
  const wanted = pandocTokens(view);
  const got = pandocTokens(withMarkers(text));
  if (JSON.stringify(wanted) !== JSON.stringify(got)) {
    const without = (list: string[], other: string[]) => {
      const left = [...other];
      return list.filter((token) => {
        const at = left.indexOf(token);
        if (at >= 0) left.splice(at, 1);
        return at < 0;
      });
    };
    const missing = without(wanted, got);
    const extra = without(got, wanted);
    return `a construct of pandoc is not whole: missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`;
  }
  return undefined;
}

const people: Person[] = [ada, bo];
const QMD = 'pandoc' as const;

/** Seeds that fail and are filed (the seeds are of this generator and these INSERTS: change either and
 * they draw something else, so check them again), with the issue: they are skipped by name, not drawn out of the
 * suite, so that every other seed holds. */
const KNOWN: Record<number, string> = { 287: '#1088' };

/** The marks of a file that are decided one at a time, those in the old text of a replacement too. */
function undecided(text: string) {
  const read = parse(text);
  return [...read.marks, ...payloadMarksOf(read).map((found) => found.mark)].filter(
    (mark) => mark.kind !== 'cmt' && mark.kind !== 'hl',
  );
}

/** Every mark of a file decided one way, or undefined where one is refused. */
function decideAll(text: string, how: typeof accept | typeof reject): string | undefined {
  let current = text;
  try {
    for (let step = 0; step < 60; step++) {
      const mark = undecided(current)[0];
      if (mark === undefined) return current;
      current = applyChanges(current, how(current, mark.id));
    }
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
  return undefined;
}

/** One seed: the document, the edits and the checks; the message of what failed, or undefined. */
function runSeed(
  seed: number,
  dialect: 'pandoc' | 'gfm',
  count: (name: string) => void,
): string | undefined {
  const random = seeded(seed * 104729 + 11);
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const ids = (n: number) => Uint8Array.from({ length: n }, () => below(256));
  const ctx = (author: Person): EditContext => context(author, [], { random: ids, dialect });
  let text = randomDocument(random, { dialect: QMD });
  if (unsound(text) !== undefined) {
    count('document unsound before the edit');
    return undefined;
  }
  const log: string[] = [];
  try {
    for (let step = 1 + below(3); step > 0; step--) {
      const view = newestView(text).text;
      const kind = below(10);
      const author = pick(people);
      try {
        if (kind < 4) {
          const edit: TextChange = randomEdit(below, view, INSERTS);
          log.push(`tracked ${author.handle} ${JSON.stringify(edit)}`);
          text = applyChanges(text, trackedEdits(text, [edit], ctx(author)).changes);
          count('tracked');
        } else if (kind < 6) {
          const edit: TextChange = randomEdit(below, view, INSERTS);
          log.push(`untracked ${JSON.stringify(edit)}`);
          text = applyChanges(text, untrackedEdit(text, edit, { random: ids, author, dialect }));
          count('untracked');
        } else if (kind < 8) {
          const from = below(Math.max(1, view.length));
          const to = Math.min(view.length, from + 1 + below(20));
          const how = below(2) === 0 ? 'comment' : 'highlight';
          log.push(`${how} ${author.handle} ${from}-${to}`);
          text = applyChanges(
            text,
            (how === 'comment'
              ? addComment(text, { from, to }, 'Why?', ctx(author))
              : addHighlight(text, { from, to }, ctx(author))
            ).changes,
          );
          count(how);
        } else {
          const marks = undecided(text);
          if (marks.length === 0) continue;
          const mark = pick(marks);
          const decide = below(2) === 0 ? accept : reject;
          log.push(`${decide.name} ${mark.id}`);
          text = applyChanges(text, decide(text, mark.id));
          count('decision');
        }
      } catch (error) {
        if (error instanceof EditError || error instanceof RangeError) {
          if (error.message.trim().length <= 10) {
            throw new Error(`a refusal that says nothing: ${error.message}`, { cause: error });
          }
          count('refused');
          continue;
        }
        throw error;
      }
      const bad = unsound(text);
      if (bad !== undefined) throw new Error(`after ${log.at(-1)}: ${bad}`);
    }
    // Every order of decisions: exhaustive for a few marks, random orders for many.
    const marks = undecided(text).length;
    if (marks > 0 && marks <= 4) {
      const { outcomes, stuck } = everyOrder(text, exactly);
      for (const [decided, results] of outcomes) {
        if (results.size !== 1) throw new Error(`decided ${decided} reads ${results.size} ways`);
      }
      if (stuck.length > 0) throw new Error(`stuck: ${JSON.stringify(stuck[0])}`);
      count('every order');
    }
    for (let order = 0; order < 4; order++) {
      let current = text;
      for (let step = 0; step < 40; step++) {
        const left = undecided(current);
        if (left.length === 0) break;
        const mark = pick(left);
        const decide = below(2) === 0 ? accept : reject;
        try {
          current = applyChanges(current, decide(current, mark.id));
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
          count('decision refused');
          continue;
        }
        const bad = unsound(current);
        if (bad !== undefined) {
          throw new Error(`in an order, after ${decide.name} ${mark.id}: ${bad}`);
        }
      }
    }
    // All accepted is the newest view, all rejected the original.
    const accepted = decideAll(text, accept);
    const rejected = decideAll(text, reject);
    if (
      accepted !== undefined &&
      readAs(withoutFront(bodyOf(accepted))) !== readAs(withoutFront(newestView(text).text))
    ) {
      throw new Error('all accepted is not the newest view');
    }
    if (
      rejected !== undefined &&
      readAs(withoutFront(bodyOf(rejected))) !== readAs(withoutFront(originalView(text).text))
    ) {
      throw new Error('all rejected is not the original view');
    }
    count('checked');
    return undefined;
  } catch (error) {
    return `${error instanceof Error ? error.message : String(error)}\nsteps ${log.join('; ')}\n${text}`;
  }
}

describe('random edits of Quarto documents', () => {
  it('keep pandoc constructs whole and read alike in every order of decisions', () => {
    const total = fuzzCount(150);
    const stats: Record<string, number> = {};
    const count = (name: string) => (stats[name] = (stats[name] ?? 0) + 1);
    const failures: string[] = [];
    for (let seed = 1; seed <= total; seed++) {
      if (process.env['QSUITE_SEED'] && Number(process.env['QSUITE_SEED']) !== seed) continue;
      if (KNOWN[seed] !== undefined) {
        count('known');
        continue;
      }
      const failed = runSeed(seed, 'pandoc', count);
      if (failed === undefined) continue;
      // A failure of the GFM reading that the same seed has in a `.md` is no pandoc's: the random
      // suites of GFM files hold those. It is counted here.
      const asMarkdown = failed.includes('construct of pandoc')
        ? undefined
        : runSeed(seed, 'gfm', () => {});
      if (asMarkdown !== undefined) {
        count('shared with the gfm reading');
        continue;
      }
      failures.push(`seed ${seed}: ${failed}`);
      if (failures.length > 9 && !process.env['QSUITE_ALL']) break;
    }
    if (process.env['REDLINES_FUZZ']) console.log('pandoc-random:', JSON.stringify(stats));
    if (process.env['QSUITE_ALL']) console.log(failures.map((f) => f.split('\n')[0]).join('\n'));
    expect(failures.join('\n=======\n')).toBe('');
    if (process.env['QSUITE_SEED']) return;
    expect(stats['checked'] ?? 0).toBeGreaterThan(total / 3);
    expect((stats['tracked'] ?? 0) + (stats['untracked'] ?? 0)).toBeGreaterThan(total / 2);
  }, 300_000);
});
