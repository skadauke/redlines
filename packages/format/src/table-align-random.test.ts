// Random tables with a tracked alignment change, a point mark at the end of the header's last cell
// (format §3.7, #281), and other people's typing, deleting, replacing, commenting and formatting in
// that cell, edits in the cells and rows around it and in the paragraphs beside the table, with Track
// Changes on and off. The change is made before the others, so that they are written beside it (typing
// at the end of the cell lands in front of the mark), or after them, so that it is written beside them.
// The file is then decided in every order: every order reads alike, judged exactly and by micromark
// 4.0.2 with GFM tables, no single decision is refused, and all accepted or all rejected is the newest or
// the original view.
//
// The property is that the mark never makes a sound file unsound. Each state is run through the checks
// (`failedChecks`), and, where one fails, again with the mark cut out (the control). A state that fails the
// same check first without the mark is older than the mark, and is left out only if its shape is one of
// `OLDER`, each with its issue: a bare header's last cell emptied under a marker, by an edit or a decision
// (#428), typing over a delimiter of a pending bold (#299), a delimiter run typed next to another person's
// marks (#265), a comment over a backtick, which makes decisions refused as hiding changes in code (#376),
// and an entity, a tag or a link that deletions cut beside a comment (#467). A state of a shape that none of them
// says fails the suite, and so does one where the mark makes another check fail first: an edit written
// after the mark is held to the walk of every order of decisions that the writer makes (#466), so no state
// that the mark alone makes unsound is left to draw. A tracked `_` or `*` typed at the start of a bare
// header makes no valid change (#429), and a key that the mark shapes into a write over a row's pipe is
// refused (#449): the first leaves the walk (counted: "unwritable"), and the file has no such state for the
// second. What is left out as older, with the walks that leave, stays under a twentieth of the states.
// `REDLINES_FUZZ` sets how many tables (6000 before a stage merges), `REDLINES_SEED` the seed, and
// `REDLINES_FUZZ_STATS` prints the counts by issue.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { expectEveryOrderRead, readAs } from './oracle.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
// (the fine rules: this suite is about a point mark beside other changes, and a replacement of the
// table, which a plain edit can break apart, is written and held to account in the suites of lane R2)
import { fineTableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import {
  ada,
  blockLeaves,
  bo,
  bodyOf,
  claudeAda,
  context,
  exactly,
  expectEveryOrderAlike,
  expectInOrder,
  expectNoDecisionRefused,
  file,
  thread,
  withoutPoints,
} from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { TextChange } from './types.ts';
import { untrackedEdit } from './untracked.ts';
import { newestView, originalView } from './views.ts';

/** What the last header cell can end in: words, and what Markdown reads as syntax. */
const ENDS = [
  'b',
  'alpha',
  'x y',
  'café',
  '11',
  '',
  '_b_',
  'b_',
  'b\\',
  'b\\\\',
  '*b*',
  'b*',
  '**b**',
  '`b`',
  '[b](c)',
  'https://example.org/a',
  'b~~',
  '<b>',
  '&amp;',
  'a\\|b',
  '`x\\|y`',
];
const WORDS = ['alpha', 'b', 'café', 'x y', '11', ''];
const TYPED = ['q', 'é', 'ab', '_', '*', '\\', ' ', '\\|'];
const DASHES = ['---', ':--', '--:', ':-:', '-----', ':----', '----:'];
const PEOPLE = [ada, bo, claudeAda];
const POOL = [
  'k3x9',
  'w8nn',
  'p5qm',
  'q6rs',
  'c2dd',
  'f3gg',
  'h4jj',
  'm5nn',
  'b7cd',
  'd8fg',
  'g9hj',
  'j2kl',
  'n3pq',
  'r4st',
  't5vw',
  'v6xz',
];

const tablesOf = (text: string) => blockLeaves(text).filter((leaf) => leaf.kind === 'table');
const tidy = (view: string) => view.replace(/\s+$/, '');
const firstLine = (error: unknown) => String(error).split('\n')[0] ?? '';

/** Every state of every order of decisions has newest and original views that are one table. */
function expectEveryStateATable(text: string): void {
  const seen = new Set<string>();
  const visit = (current: string, path: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const view of [newestView(current).text, originalView(current).text]) {
      const found = tablesOf(view);
      expect(found, `[${path}]: a view is a table`).toHaveLength(1);
      const width = found[0]?.rows?.[0]?.length;
      expect(
        found[0]?.rows?.every((row) => row.length === width),
        `[${path}]: a view's rows are as wide as its header`,
      ).toBe(true);
    }
    for (const { id, kind } of parse(current).marks) {
      if (kind === 'cmt' || kind === 'hl') continue;
      for (const [how, decide] of [
        ['a', accept],
        ['r', reject],
      ] as const) {
        try {
          visit(applyChanges(current, decide(current, id)), `${path} ${how}${id}`);
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
      }
    }
  };
  visit(text, '');
}

/**
 * The checks that a file with a table is held to, in this order, each by what it says, with the first line of how
 * it failed: its views are one table each, as wide in every row as the header; it reads as its newest view as it
 * is; every order of decisions reads alike, with no decision refused (but where the file without the change
 * allows it too), and reads as its view; every state of every order is a table; and deciding all of it gives the
 * newest and the original view. A check that fails does not stop the others, and the first to fail says what
 * went wrong first, which the later ones follow from.
 */
function failedChecks(label: string, text: string): Map<string, string> {
  const failed = new Map<string, string>();
  const run = (name: string, check: () => void) => {
    try {
      check();
    } catch (error) {
      failed.set(name, firstLine(error));
    }
  };
  run('a view is not a table', () => {
    for (const view of [newestView(text).text, originalView(text).text]) {
      const found = tablesOf(view);
      expect(found, `${label}: the view is a table`).toHaveLength(1);
      const width = found[0]?.rows?.[0]?.length;
      expect(
        found[0]?.rows?.every((row) => row.length === width),
        `${label}: the view's rows are as wide as its header`,
      ).toBe(true);
    }
  });
  const marks = parse(text).marks.filter((mark) => mark.kind !== 'cmt');
  const apart = !/row-->|row=\d/.test(text);
  const asWritten = () =>
    expect(readAs(bodyOf(text)), `${label}: as written`).toBe(readAs(newestView(text).text));
  // The file as it stands, with no change decided: the first reading, which a file with many changes, or none,
  // is held to alone.
  if (apart) run('the file reads otherwise than its newest view', asWritten);
  if (marks.length > 5 || marks.length === 0) return failed;
  if (parse(text).marks.length > 0) {
    run('the comments are out of order', () =>
      expectInOrder(
        label,
        parse(text).ledger.comments.map((thread) => thread.id),
        text,
      ),
    );
  }
  run('the orders of decisions differ', () => expectEveryOrderAlike(label, text, exactly));
  run('a decision is refused', () => expectNoDecisionRefused(label, text, { unlessWithout: true }));
  if (apart) run('an order reads otherwise than its view', () => expectEveryOrderRead(label, text));
  run('a state is not a table', () => expectEveryStateATable(text));
  run('accepting all is not the newest view', () => {
    const accepted = applyChanges(text, acceptAll(text));
    expect(tidy(newestView(accepted).text), `${label}: accept all`).toBe(
      tidy(newestView(text).text),
    );
  });
  run('rejecting all is not the original view', () => {
    const rejected = applyChanges(text, rejectAll(text));
    // A format change that a plain edit has altered can't be undone and stays (format §2.6).
    if (parse(rejected).marks.every((mark) => mark.kind !== 'fmt')) {
      expect(tidy(originalView(rejected).text), `${label}: reject all`).toBe(
        tidy(originalView(text).text),
      );
    }
  });
  return failed;
}

/** A state that fails checks, as the suite found it. */
interface Found {
  /** The file, with the mark. */
  text: string;
  /** The same file with the mark cut out. */
  control: string;
  /** The checks that the file fails, the first to fail first. */
  failed: string[];
  /** The first line of how each of them failed, by name. */
  said: ReadonlyMap<string, string>;
  /** The checks that the file without its mark fails. */
  checks: string[];
  /** A step of the walk is a plain edit, with Track Changes off. */
  plain: boolean;
}

/** The delimiters of emphasis, next to the end or the start of a marker, or in the old text that a marker keeps. */
const DELIMITER_BY_MARKER = /[*_~]<!--|-->[*_~]|<!--(?:del|sub) \w{4} [^>]*[*_~]/;
/** The checks that fail where Markdown reads the text otherwise than the view does. */
const READS_OTHERWISE = [
  'the file reads otherwise than its newest view',
  'an order reads otherwise than its view',
];
/** The start of an HTML tag (a `<` and a letter, or a `/`) in the old text that a pending deletion or replacement
 * keeps, up to the end of its marker. */
const TAG_IN_OLD_TEXT = /<!--(?:del|sub) \w{4} (?:(?!-->).)*<[a-z/]/i;
/** The `]` of a link in the old text that a pending deletion or replacement keeps, and a comment that opens right after
 * it, in front of the `(` that the link needs there: rejecting the deletion leaves the comment's marker between the two. */
const LINK_IN_OLD_TEXT =
  /<!--(?:del|sub) \w{4} (?:(?!-->).)*\]-->(?:<!--(?!cmt)[^>]*-->)*<!--cmt \w{4}-->\(/;

/**
 * Where a state that fails without the mark comes from. The mark never makes a sound file unsound, and a
 * file that is not sound without it is older than the mark, and is left out of the check: but only a shape
 * that is known, with the issue that it is, and only where the file without the mark fails the same check
 * first. A shape that none of these says is new, and fails the suite: file an issue for it, and add it here.
 */
const OLDER: { issue: string; why: string; shape: (found: Found) => boolean }[] = [
  {
    issue: '#265',
    why: 'a delimiter run next to another person’s pending change, or a change over their deletion of a backslash, reads otherwise in some order of decisions',
    // (not for a walk that made a plain edit: with Track Changes off the edit beside such a delimiter is
    // held until the other person's changes are accepted, and the file is not left that way, #265)
    shape: ({ control, checks, plain }) =>
      !plain &&
      READS_OTHERWISE.includes(checks[0] ?? '') &&
      (DELIMITER_BY_MARKER.test(control) || /<!--(?:del|sub) \w{4} [^>]*\\/.test(control)),
  },
  {
    issue: '#467',
    why: 'rejecting deletions that cut an HTML entity (an `&` and a letter), beside a comment, leaves a marker inside the entity, and the same holds of the start of an HTML tag (a `<` and a letter) that a pending deletion or replacement keeps, and of a link whose `]` it keeps, a comment right after it and the `(` of the link after that: the file reads otherwise in some order of decisions',
    shape: ({ control, checks }) =>
      READS_OTHERWISE.includes(checks[0] ?? '') &&
      /<!--cmt /.test(control) &&
      (/&[a-z]/i.test(control) || TAG_IN_OLD_TEXT.test(control) || LINK_IN_OLD_TEXT.test(control)),
  },
];

/** Whether `edit`, by `who` (not a plain edit), types `_` or `*` at the start of the first cell of a header that
 * has no pipe at its row start: a tracked one writes a change that is out of order (#429, which names the `_`
 * after a `**`; a `*` does the same). */
function unwritableDelimiter(text: string, who: string, edit: TextChange | null): boolean {
  const table = readTables(text, parse(text))[0];
  const cell = table?.rows[0]?.cells[0];
  return (
    who !== 'plain' &&
    (edit?.insert === '_' || edit?.insert === '*') &&
    cell !== undefined &&
    edit.from === cell.textFrom &&
    !/^[ \t]*\|/.test(text.slice(table?.from ?? 0))
  );
}

describe('a point alignment change with changes beside it, random', () => {
  it('is decided in every order beside them, wherever it was made', () => {
    const random = seeded(Number(process.env['REDLINES_SEED'] ?? 2029));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    let checked = 0;
    let after = 0;
    let before = 0;
    /** The states that fail without the mark, by the issue that their shape is (`OLDER`). */
    const older: Record<string, number> = {};
    /** The states left out for a tracked `_` or `*` typed at the start of a bare header, which writes no valid change. */
    let unwritable = 0;
    const failures: string[] = [];
    const unmapped: string[] = [];
    for (let n = 0; n < fuzzCount(120); n++) {
      const columns = 1 + Math.floor(random() * 3);
      const lead = random() < 0.7;
      const trail = columns === 1 && !lead ? true : random() < 0.7;
      const pad = pick(['', ' ', ' ', '  ']);
      const heads = Array.from({ length: columns }, (_, i) =>
        i === columns - 1 ? pick(ENDS) : pick(WORDS.slice(0, 4)).trim() || 'h',
      );
      // An empty cell at a bare edge would read as the pipe of that edge: it holds text there.
      const line = (words: string[]) =>
        `${lead ? '|' : ''}${words
          .map((word, i) => {
            const bare = (i === 0 && !lead) || (i === words.length - 1 && !trail);
            return `${pad}${word.trim() === '' && bare ? 'x' : word}${pad}`;
          })
          .join('|')}${trail ? '|' : ''}`.replace(/ {3,}/g, '  ');
      const delimiter = `${lead ? '|' : ''}${Array.from({ length: columns }, () => ` ${pick(DASHES)} `).join('|')}${trail ? '|' : ''}`;
      const rows = Array.from({ length: 2 }, () =>
        line(Array.from({ length: columns }, () => pick(WORDS))),
      );
      const header = line(heads);
      const around = random() < 0.4;
      const joined = [header, delimiter, ...rows].join('\n');
      let text = file(around ? `Intro words.\n\n${joined}\n\nOutro words.` : joined);
      if (random() < 0.2) text = text.replace(/\n/g, '\r\n');
      if (tablesOf(text).length !== 1) continue;
      const steps: string[] = [];
      const ids = () => [...POOL].sort(() => random() - 0.5);
      const first = random() < 0.5;
      /** Somebody aligns columns with Track Changes on: false when it is refused. */
      const align = (): boolean => {
        const aligner = pick(PEOPLE);
        const table = readTables(text, parse(text))[0];
        if (!table) return false;
        const one = Math.floor(random() * columns);
        const cols = random() < 0.3 ? [one, Math.floor(random() * columns)] : [one];
        const to = pick(['left', 'center', 'right', ''] as const);
        steps.push(`${aligner.handle} align ${JSON.stringify(cols)} ${to}`);
        try {
          const op: TableOp = { kind: 'align', table: table.from, cols, align: to };
          text = applyChanges(text, fineTableEdit(text, op, context(aligner, ids())).changes);
          return true;
        } catch (error) {
          if (error instanceof EditError) return false;
          throw error;
        }
      };
      if (first && !align()) continue;
      let broken = false;
      for (let step = 0; step < 1 + Math.floor(random() * 3); step++) {
        const table = readTables(text, parse(text))[0];
        if (!table) break;
        const who = pick(['ada', 'bo', 'claude-ada', 'plain'] as const);
        const person = PEOPLE.find((candidate) => candidate.handle === who) ?? ada;
        const cell = table.rows[0]?.cells[columns - 1];
        const kind = pick([
          'endEdit',
          'endEdit',
          'endEdit',
          'endDelete',
          'endReplace',
          'endBold',
          'endComment',
          'cell',
          'rowOp',
          'outside',
        ] as const);
        let edit: TextChange | null = null;
        let over: { from: number; to: number; kind: 'bold' | 'comment' } | null = null;
        let op: TableOp | null = null;
        if (kind.startsWith('end') && cell) {
          // Positions are those of the newest view, as an editor has them, mapped into the file.
          const view = newestView(text);
          const start = view.map.fromSource(cell.textFrom);
          const end = view.map.fromSource(cell.textTo);
          const size = end - start;
          const source = (position: number, assoc: 1 | -1) => view.map.toSource(position, assoc);
          if (kind === 'endEdit') {
            const place = random() < 0.6 ? end : start + Math.floor(random() * (size + 1));
            const where = source(place, -1);
            edit = { from: where, to: where, insert: pick(TYPED) };
          } else {
            if (size < 1) continue;
            const a = start + Math.floor(random() * size);
            const b = random() < 0.5 ? end : Math.min(end, a + 1 + Math.floor(random() * 3));
            const from = source(a, 1);
            const to = Math.max(from, source(b, -1));
            if (kind === 'endDelete') edit = { from, to, insert: '' };
            else if (kind === 'endReplace') edit = { from, to, insert: pick(['q', 'é', 'ab']) };
            else over = { from, to, kind: kind === 'endBold' ? 'bold' : 'comment' };
          }
        } else if (kind === 'cell') {
          const target = pick(table.rows);
          const one = pick(target.cells.slice(0, columns));
          const size = one.textTo - one.textFrom;
          const from = one.textFrom + Math.floor(random() * (size + 1));
          const to = size === 0 ? from : Math.min(one.textTo, from + Math.floor(random() * 3));
          edit = { from, to, insert: pick(['q', 'é', '']) };
          if (from === to && edit.insert === '') continue;
        } else if (kind === 'rowOp') {
          const count = table.rows.length;
          const body = () => 1 + Math.floor(random() * (count - 1));
          const t = Math.floor(random() * 3);
          op =
            t === 0
              ? {
                  kind: 'insertRows',
                  table: table.from,
                  after: Math.floor(random() * count),
                  count: 1,
                }
              : t === 1
                ? { kind: 'deleteRows', table: table.from, rows: [body()] }
                : {
                    kind: 'moveRows',
                    table: table.from,
                    rows: [body()],
                    to: 1 + Math.floor(random() * count),
                  };
        } else if (kind === 'outside') {
          if (!around) continue;
          const view = newestView(text);
          const word = pick(['Intro', 'Outro'] as const);
          const place = view.text.indexOf(word);
          if (place === -1) continue;
          const where = view.map.toSource(place + word.length, 1);
          edit = { from: where, to: where, insert: 'q' };
        }
        steps.push(`${who} ${kind} ${JSON.stringify(op ?? edit ?? over)}`);
        try {
          let changes: TextChange[] | undefined;
          if (op) {
            changes =
              who === 'plain'
                ? untrackedTableEdit(text, op).changes
                : fineTableEdit(text, op, context(person, ids())).changes;
          } else if (over) {
            const ctx = context(person, ids());
            const bold = { kind: 'inline', format: 'bold', on: true } as const;
            if (over.kind === 'bold') {
              changes =
                who === 'plain'
                  ? untrackedFormat(text, over, bold)
                  : trackedFormat(text, over, bold, ctx).changes;
            } else if (who !== 'plain') changes = addComment(text, over, 'A note.', ctx).changes;
          } else if (edit) {
            changes =
              who === 'plain'
                ? untrackedEdit(text, edit)
                : trackedEdit(text, edit, context(person, ids()));
          }
          try {
            text = applyChanges(text, changes ?? []);
          } catch (error) {
            // A tracked `_` or `*` typed at the start of a header with no pipe at its row starts makes no
            // valid change (#429): the walk goes no further with it. Nothing else may throw.
            if (!(error instanceof RangeError) || !unwritableDelimiter(text, who, edit))
              throw error;
            unwritable++;
            broken = true;
            break;
          }
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
      }
      if (broken || (!first && !align())) continue;
      const label = `${JSON.stringify(header)} ${JSON.stringify(delimiter)} ${steps.join(' / ')}`;
      checked++;
      if (first) before++;
      else after++;
      const failed = failedChecks(label, text);
      if (failed.size === 0) continue;
      const cut = withoutPoints(text);
      const control = failedChecks(label, cut);
      const body = text.replace(/\n<!-- redlines[\s\S]*$/, '');
      const found: Found = {
        text,
        control: cut,
        failed: [...failed.keys()],
        said: failed,
        checks: [...control.keys()],
        plain: steps.some((step) => step.startsWith('plain ')),
      };
      // The first check that fails says what went wrong first, and the later ones follow from it.
      if (found.failed[0] === found.checks[0]) {
        // The file without the mark fails the same one: older than the mark, and left out if its shape is known.
        const known = OLDER.find(({ shape }) => shape(found));
        if (known) older[known.issue] = (older[known.issue] ?? 0) + 1;
        else unmapped.push(`${found.checks.join(', ')}\n${steps.join(' / ')}\n${body}`);
        continue;
      }
      // The mark changes what fails first, or the file is sound without it: its doing.
      failures.push(
        `${[...failed].map(([name, said]) => `${name}: ${said}`).join('\n')}\nwithout the mark it fails: ${found.checks.join(', ') || 'nothing'}\n${body}`,
      );
    }
    const total = (counts: Record<string, number>) =>
      Object.values(counts).reduce((sum, count) => sum + count, 0);
    const by = (counts: Record<string, number>) =>
      Object.entries(counts)
        .map(([issue, count]) => `${issue} ${count}`)
        .join(', ');
    if (process.env['REDLINES_FUZZ_STATS']) {
      process.stderr.write(
        `tables ${checked} (mark first ${before}, last ${after}), older than the mark ${total(older)} (${by(older)}), unwritable ${unwritable}, caused by it ${failures.length}, in no known shape ${unmapped.length}\n`,
      );
      for (const state of unmapped)
        process.stderr.write(`NO KNOWN SHAPE ${JSON.stringify(state)}\n`);
    }
    expect(failures, 'a file that is sound without its mark is not with it').toEqual([]);
    expect(
      unmapped,
      'a file that is not sound without its mark, in a shape that no issue says',
    ).toEqual([]);
    expect(checked).toBeGreaterThan(10);
    // The states left out as older, and the walks that go no further, are few: the walk goes on drawing.
    expect(total(older) + unwritable).toBeLessThan((checked + unwritable) / 20);
  }, 3_600_000);

  /** What a state that the suite found looks like to a shape, with what is not looked at left empty. */
  const found = (over: Partial<Found>): Found => ({
    text: '',
    control: '',
    failed: [],
    said: new Map(),
    checks: [],
    plain: false,
    ...over,
  });

  it('names an entity or a tag that deletions cut beside a comment as #467, and not any other reading', () => {
    const shape = OLDER.find(({ issue }) => issue === '#467')?.shape;
    const misread = ['an order reads otherwise than its view'];
    const entity = '| café | <!--del m5nn &a-->m<!--cmt q6rs-->p<!--del c2dd ;--><!--/q6rs--> ';
    const tag = 'b|<!--del f3gg <b--><!--cmt p5qm-->><!--/p5qm-->|';
    // `REDLINES_FUZZ=300 REDLINES_SEED=24` draws the link: `[b](c)`, the `b]` deleted and a comment over `(c)`.
    const link = '|  [<!--del j2kw b]--><!--cmt t5vw-->(c)<!--/t5vw-->  |';
    expect(shape?.(found({ control: entity, checks: misread }))).toBe(true);
    expect(shape?.(found({ control: tag, checks: misread }))).toBe(true);
    expect(shape?.(found({ control: link, checks: misread }))).toBe(true);
    expect(shape?.(found({ control: link.replace('cmt', 'ins'), checks: misread }))).toBe(false);
    expect(shape?.(found({ control: link.replace('b]', 'b'), checks: misread }))).toBe(false);
    expect(
      shape?.(found({ control: tag, checks: ['the file reads otherwise than its newest view'] })),
    ).toBe(true);
    // No comment, a first check that is not a misread, a comment with plain words, and a tag that no pending
    // deletion or replacement keeps are other things.
    expect(shape?.(found({ control: entity.replace('cmt', 'ins'), checks: misread }))).toBe(false);
    expect(shape?.(found({ control: tag, checks: ['a view is not a table'] }))).toBe(false);
    expect(
      shape?.(
        found({ control: '| a | <!--del f3gg b--><!--cmt p5qm-->c<!--/p5qm-->', checks: misread }),
      ),
    ).toBe(false);
    expect(shape?.(found({ control: 'b|<b<!--cmt p5qm-->>c<!--/p5qm-->|', checks: misread }))).toBe(
      false,
    );
  });

  it('finds the tag of #467 older than the mark: the file without it misreads first, and so does the file with it', () => {
    // `REDLINES_FUZZ=1500 REDLINES_SEED=9` draws it: a header with no pipe at its start, a deletion of `<b` and a
    // comment over the `>`, and the mark written last. Rejecting the deletion leaves the comment's marker inside the
    // tag, which Markdown reads otherwise than the view does.
    const header = (end: string) =>
      `Intro words.\n\nb|<!--del f3gg <b--><!--cmt p5qm-->><!--/p5qm-->${end}|\n :-: | :-: |\nx|b|\nb|b|\n\nOutro words.`;
    const mark = '<!--fmt t5vw align=\\x20:-:\\x20\\|\\x20-\\-:\\x20\\|-->';
    const marked = file(header(mark), { f3gg: 'ada', t5vw: 'ada' }, thread('p5qm', 'bo'));
    const control = withoutPoints(marked);
    const failed = failedChecks('#467', marked);
    const checks = failedChecks('#467', control);
    const instance = found({
      text: marked,
      control,
      failed: [...failed.keys()],
      said: failed,
      checks: [...checks.keys()],
    });
    expect(READS_OTHERWISE).toContain(instance.checks[0]);
    expect(instance.failed[0]).toBe(instance.checks[0]);
    // The first shape that says it is #467's: no earlier one claims it.
    expect(OLDER.find(({ shape }) => shape(instance))?.issue).toBe('#467');
  });
});
