// Random tables with a tracked alignment change, a point mark at the end of the header's last cell
// (format §3.7, #281), and other people's typing, deleting, replacing, commenting and formatting in
// that cell, edits in the cells and rows around it and in the paragraphs beside the table, with Track
// Changes on and off. The change is made before the others, so that they are written beside it (typing
// at the end of the cell lands in front of the mark), or after them, so that it is written beside them.
// The file is then decided in every order: every order reads alike, judged exactly and by micromark
// 4.0.2 with GFM tables, no single decision is refused, and all accepted or all rejected is the newest or
// the original view.
//
// The property is that the mark never makes a sound file unsound. Each state is checked with its mark,
// and, where that fails, again with the mark cut out (the control). A control that fails too is older
// than the mark, and left out: a bare header's last cell emptied under a marker, by an edit or a decision
// (#428), a tracked `_` typed at the start of a bare header that begins with `**` (#429), typing over a
// delimiter of a pending bold (#299), a delimiter run typed next to another person's marks (#265), a
// deletion of a backtick next to a comment, which makes decisions refused as hiding changes in code
// (#376), and comments in bare tables (#295). A key that the mark shapes into a write over a row's pipe
// is refused, and the file has no such state (#449). `REDLINES_FUZZ` sets how many tables (6000 before a
// stage merges), and `REDLINES_SEED` the seed.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { normalizeLedger } from './ledger-order.ts';
import { setLedger } from './ledger-write.ts';
import { expectEveryOrderRead, readAs } from './oracle.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { tableEdit, untrackedTableEdit } from './table-ops.ts';
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

/** The file with its point alignment marks cut out, and their entries in the ledger. */
function withoutPoints(text: string): string {
  const cut = text.replace(/<!--fmt \w{4} align=[^\r\n]*?-->/g, '');
  return applyChanges(cut, setLedger(cut, normalizeLedger(cut, parse(cut).ledger)));
}

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

/** The first check that a file fails, or null: it reads as its newest view as it is and in every order,
 * every order of decisions reads alike with no decision refused, and deciding all of it gives the newest
 * and the original view. */
function failure(label: string, text: string): string | null {
  try {
    for (const view of [newestView(text).text, originalView(text).text]) {
      const found = tablesOf(view);
      expect(found, `${label}: the view is a table`).toHaveLength(1);
      const width = found[0]?.rows?.[0]?.length;
      expect(
        found[0]?.rows?.every((row) => row.length === width),
        `${label}: the view's rows are as wide as its header`,
      ).toBe(true);
    }
    const marks = parse(text).marks.filter((mark) => mark.kind !== 'cmt');
    const apart = !/row-->|row=\d/.test(text);
    if (marks.length > 5) {
      if (apart)
        expect(readAs(bodyOf(text)), `${label}: as written`).toBe(readAs(newestView(text).text));
      return null;
    }
    if (parse(text).marks.length > 0) {
      expectInOrder(
        label,
        parse(text).ledger.comments.map((thread) => thread.id),
        text,
      );
    }
    if (marks.length === 0) {
      if (apart)
        expect(readAs(bodyOf(text)), `${label}: as written`).toBe(readAs(newestView(text).text));
      return null;
    }
    expectEveryOrderAlike(label, text, exactly);
    expectNoDecisionRefused(label, text, { unlessWithout: true });
    if (apart) expectEveryOrderRead(label, text);
    expectEveryStateATable(text);
    const accepted = applyChanges(text, acceptAll(text));
    expect(tidy(newestView(accepted).text), `${label}: accept all`).toBe(
      tidy(newestView(text).text),
    );
    const rejected = applyChanges(text, rejectAll(text));
    // A format change that a plain edit has altered can't be undone and stays (format §2.6).
    if (parse(rejected).marks.every((mark) => mark.kind !== 'fmt')) {
      expect(tidy(originalView(rejected).text), `${label}: reject all`).toBe(
        tidy(originalView(text).text),
      );
    }
    return null;
  } catch (error) {
    return firstLine(error);
  }
}

describe('a point alignment change with changes beside it, random', () => {
  it('is decided in every order beside them, wherever it was made', () => {
    const random = seeded(Number(process.env['REDLINES_SEED'] ?? 2029));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    let checked = 0;
    let older = 0;
    let after = 0;
    let before = 0;
    const failures: string[] = [];
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
          text = applyChanges(text, tableEdit(text, op, context(aligner, ids())).changes);
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
                : tableEdit(text, op, context(person, ids())).changes;
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
            // A tracked `_` at the start of a bare header that begins with `**` makes no valid change
            // (#429): the walk goes no further with it.
            if (!(error instanceof RangeError)) throw error;
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
      const message = failure(label, text);
      if (message === null) continue;
      // The same file without its mark fails as well: older than the mark, and left out.
      if (failure(label, withoutPoints(text)) !== null) older++;
      else failures.push(`${message}\n${text.replace(/\n<!-- redlines[\s\S]*$/, '')}`);
    }
    if (process.env['REDLINES_FUZZ_STATS']) {
      console.log(
        `tables ${checked} (mark first ${before}, last ${after}), older than the mark ${older}, caused by it ${failures.length}`,
      );
    }
    expect(failures, 'a file that is sound without its mark is not with it').toEqual([]);
    expect(checked).toBeGreaterThan(10);
    // The states left out as older than the mark are few: the walk goes on drawing.
    expect(older).toBeLessThan(checked / 4);
  }, 3_600_000);
});
