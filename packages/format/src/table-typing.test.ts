import { describe, expect, it } from 'vitest';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { readTables } from './table.ts';
import {
  ada,
  blockLeaves,
  bodyOf,
  bo,
  context,
  expectEveryOrderAlike,
  expectInOrder,
  file,
} from './test-helpers.ts';
import { trackedEdit, trackedEdits } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import { newestView, originalView } from './views.ts';
import type { TextChange } from './types.ts';

const ONE_LINE = 'In a table, write a pipe as \\| and a line break as <br>.';

const FRUIT = '| Fruit  | Count |\n| ------ | ----- |\n| Apples | 3     |\n| Pears  | 5     |';

const track = (text: string, edit: TextChange, ids: string[] = ['k3x9']): string =>
  applyChanges(text, trackedEdit(text, edit, context(ada, ids)));
const plain = (text: string, edit: TextChange): string =>
  applyChanges(text, untrackedEdit(text, edit));
const rowsOf = (text: string) => blockLeaves(text).find((leaf) => leaf.kind === 'table')?.rows;
const at = (text: string, find: string, offset = 0) => text.indexOf(find) + offset;
const type = (from: number, insert: string): TextChange => ({ from, to: from, insert });
const remove = (from: number, to: number): TextChange => ({ from, to, insert: '' });
const replace = (from: number, to: number, insert: string): TextChange => ({ from, to, insert });

describe('typing, deleting and replacing in a cell of a table (format §3.7)', () => {
  const text = file(FRUIT);
  const cases: [string, TextChange, string[][]][] = [
    [
      'typing in the middle of the first cell',
      type(at(text, 'Apples', 3), 'x'),
      [['Appxles', '3']],
    ],
    ['typing at the start of a cell', type(at(text, 'Apples'), 'x'), [['xApples', '3']]],
    ['typing at the end of the last cell', type(at(text, '3') + 1, '4'), [['Apples', '34']]],
    ['typing in the header', type(at(text, 'Count', 2), 'x'), []],
    ['deleting a letter', remove(at(text, 'Apples', 1), at(text, 'Apples', 2)), [['Aples', '3']]],
    ['deleting a whole cell text', remove(at(text, '3'), at(text, '3') + 1), [['Apples', '']]],
    [
      'replacing a word',
      replace(at(text, 'Apples'), at(text, 'Apples', 6), 'Plums'),
      [['Plums', '3']],
    ],
    ['typing in a padding space', type(at(text, '3', 1), 'x'), [['Apples', '3x']]],
  ];
  for (const [name, edit, expected] of cases) {
    it(`${name} reads the same in every decision order, and rejecting gives the bytes back`, () => {
      const after = track(text, edit);
      expectInOrder(name, [], after);
      expectEveryOrderAlike(name, after);
      expect(originalView(after).text).toBe(originalView(text).text);
      expect(rowsOf(originalView(after).text)).toEqual(rowsOf(text));
      const newest = rowsOf(newestView(after).text);
      expect(newest).toBeDefined();
      if (expected[0]) expect(newest?.[1]).toEqual(expected[0]);
      // Every row keeps its cells.
      expect(newest?.map((row) => row.length)).toEqual([2, 2, 2]);
      if (name.includes('header')) expect(newest?.[0]).toEqual(['Fruit', 'Coxunt']);
    });
  }

  it('does the same with the edit plain, as bytes', () => {
    const after = plain(text, type(at(text, 'Apples', 3), 'x'));
    expect(bodyOf(after)).toBe(FRUIT.replace('Apples', 'Appxles'));
    expect(rowsOf(after)?.[1]).toEqual(['Appxles', '3']);
  });

  it('reads the same next to another person’s marks in a cell, and in an empty cell', () => {
    const body = '| a | b |\n| - | - |\n| <!--ins b4rt-->cd<!--/b4rt--> |  |';
    const marked = file(body, { b4rt: 'bo' });
    for (const [name, edit] of [
      ['before it', type(at(marked, 'cd'), 'x')],
      ['inside it', type(at(marked, 'cd', 1), 'x')],
      ['after it', type(at(marked, '<!--/b4rt-->', 12), 'x')],
      ['in the empty cell', type(at(marked, '|  |', 2), 'x')],
    ] as const) {
      const after = track(marked, edit);
      expectInOrder(name, [], after);
      expectEveryOrderAlike(name, after);
      expect(rowsOf(newestView(after).text)?.map((row) => row.length)).toEqual([2, 2]);
    }
    expect(bo.handle).toBe('bo');
  });

  it('writes a typed escaped pipe as one insertion, and deletes one as the text it is', () => {
    const piped = file('| a | b |\n| - | - |\n| x \\| y | z |');
    const typed = track(piped, type(at(piped, 'x'), '\\|'));
    expect(bodyOf(typed)).toContain('<!--ins k3x9-->\\|<!--/k3x9-->x \\| y');
    expectEveryOrderAlike('typed', typed);
    expect(rowsOf(newestView(typed).text)?.[1]).toEqual(['|x | y', 'z']);
    const from = at(piped, '\\|');
    const deleted = track(piped, remove(from, from + 2));
    expectInOrder('deleted', [], deleted);
    expectEveryOrderAlike('deleted', deleted);
    expect(rowsOf(newestView(deleted).text)?.[1]).toEqual(['x y', 'z']);
    expect(rowsOf(originalView(deleted).text)?.[1]).toEqual(['x | y', 'z']);
  });

  it('works in a table of a CRLF file', () => {
    const crlf = file(FRUIT.replaceAll('\n', '\r\n')).replaceAll('\r\r', '\r');
    const after = track(crlf, type(at(crlf, 'Apples', 3), 'x'));
    expect(bodyOf(after).replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(originalView(after).text).toBe(originalView(crlf).text);
    expectEveryOrderAlike('crlf', after);
  });

  it('does not refuse a row whose cells are all dashes, which is no delimiter row', () => {
    const dashes = file('| a | b |\n| - | - |\n| - | - |');
    const edit = type(dashes.lastIndexOf('- | -') + 4, 'x');
    const after = track(dashes, edit);
    expectEveryOrderAlike('dashes', after);
    expect(rowsOf(newestView(after).text)?.[1]).toEqual(['-', 'x-']);
    // The delimiter row itself takes no change.
    expect(() => track(dashes, type(at(dashes, '- | -', 1), '-'))).toThrow(
      'A line that is only Markdown syntax takes no change.',
    );
  });
});

describe('a cell is one line (rule 1)', () => {
  const text = file(FRUIT);
  const cell = at(text, 'Apples', 3);

  it('refuses a typed pipe and a typed line break, tracked and plain', () => {
    for (const insert of ['|', 'x|y', '\n', 'a\nb', '\r\n']) {
      expect(() => trackedEdit(text, type(cell, insert), context(ada, ['k3x9'])), insert).toThrow(
        ONE_LINE,
      );
      expect(() => untrackedEdit(text, type(cell, insert)), insert).toThrow(ONE_LINE);
    }
  });

  it('refuses a replacement that brings a pipe and one that takes a pipe or a line break away', () => {
    const pipe = at(text, '| Apples');
    for (const edit of [
      replace(cell, cell + 1, '|'),
      remove(pipe, pipe + 1),
      remove(at(text, '\n| Apples') - 1, at(text, '\n| Apples') + 2),
      remove(at(text, '3     |', 6), at(text, '3     |', 7)),
      replace(at(text, 'Apples'), at(text, 'Pears', 5), 'x'),
    ]) {
      expect(() => trackedEdit(text, edit, context(ada, ['k3x9'])), JSON.stringify(edit)).toThrow(
        ONE_LINE,
      );
      expect(() => untrackedEdit(text, edit), JSON.stringify(edit)).toThrow(ONE_LINE);
    }
  });

  it('refuses a typed backslash that would escape the pipe after it', () => {
    const edit = type(at(text, '| 3') + 0, '\\');
    expect(() => untrackedEdit(text, edit)).toThrow(ONE_LINE);
  });

  it('takes an edit over text that has no pipe near it, and a table that is gone as a block', () => {
    const doc = file(`Words here.\n\n${FRUIT}\n\nAfter.`);
    expect(bodyOf(track(doc, type(at(doc, 'Words', 5), 'x')))).toContain('Words<!--ins k3x9-->');
    expect(bodyOf(plain(doc, remove(at(doc, 'Words'), at(doc, 'Words', 5))))).not.toContain(
      'Words',
    );
    // A replacement over all of the table is a substitution of the whole table (§3.7).
    const whole = at(doc, FRUIT);
    const replaced = plain(doc, replace(whole, whole + FRUIT.length, '| z |\n| - |\n| y |'));
    expect(bodyOf(replaced)).toContain('| z |\n| - |\n| y |\n\nAfter.');
    expect(plain(doc, remove(whole, whole + FRUIT.length))).not.toContain('Fruit');
  });

  it('refuses an agent’s edit that adds a cell by adding a pipe, and takes one that changes a cell', () => {
    const ctx = context(ada, ['k3x9', 'w8nn']);
    expect(() => suggestReplace(text, '| Apples | 3 |', '| Apples | 3 | 4 |', ctx)).toThrow(
      EditError,
    );
    expect(() => suggestReplace(text, 'Apples | 3', 'Apples | 3 | 4', ctx)).toThrow(ONE_LINE);
    const done = suggestReplace(text, 'Apples', 'Plums', ctx);
    const after = applyChanges(text, done.changes);
    expectEveryOrderAlike('agent', after);
    expect(rowsOf(newestView(after).text)?.[1]).toEqual(['Plums', '3']);
  });
});

describe('a marker at the start of a row without a leading pipe (rule 7)', () => {
  const body = '| a | b |\n| - | - |\nc | d |\ne | f';
  const text = file(body);
  const start = at(text, 'c | d');

  const cases: [string, TextChange][] = [
    ['typing', type(start, 'x')],
    ['deleting', remove(start, start + 1)],
    ['replacing', replace(start, start + 1, 'x')],
  ];
  for (const [name, edit] of cases) {
    it(`gives the row a plain leading pipe when ${name} at its start, in both views`, () => {
      const after = track(text, edit);
      expectInOrder(name, [], after);
      expect(bodyOf(after)).toContain('\n| <!--');
      expect(bodyOf(after)).toContain(' | d |\ne | f');
      expectEveryOrderAlike(name, after);
      // Nothing else reads differently: the row's cells are the same, and the other row is bare.
      const original = rowsOf(originalView(after).text);
      expect(original).toEqual([
        ['a', 'b'],
        ['c', 'd'],
        ['e', 'f'],
      ]);
      expect(originalView(after).text).toBe('| a | b |\n| - | - |\n| c | d |\ne | f\n');
      expect(parse(after).warnings).toEqual([]);
    });
  }

  it('leaves a row alone when the edit is elsewhere in it, plain, or on a row with a pipe', () => {
    expect(bodyOf(track(text, type(start + 4, 'x')))).toContain('\nc | <!--ins');
    expect(plain(text, type(start, 'x'))).toContain('\nxc | d |');
    expect(bodyOf(track(text, type(at(text, '| a') + 2, 'x')))).toBe(
      body.replace('| a', '| <!--ins k3x9-->x<!--/k3x9-->a'),
    );
  });

  it('writes a pipe for each row at the start of which two edits are made at once', () => {
    const second = at(text, 'e | f');
    const { changes } = trackedEdits(
      text,
      [type(start, 'x'), remove(second, second + 1)],
      context(ada, ['k3x9', 'w8nn']),
    );
    const after = applyChanges(text, changes);
    expectInOrder('both rows', [], after);
    expect(bodyOf(after)).toMatch(
      /\n\| <!--ins k3x9-->x<!--\/k3x9-->c \| d \|\n\| <!--del w8nn e--> \| f/,
    );
    expectEveryOrderAlike('both rows', after);
    expect(originalView(after).text).toBe('| a | b |\n| - | - |\n| c | d |\n| e | f\n');
  });

  it('works in a CRLF file', () => {
    const crlf = file('| a | b |\r\n| - | - |\r\nc | d |'.replace(/\n/g, '\n'));
    const after = track(crlf, type(at(crlf, 'c | d'), 'x'));
    expect(after).toContain('\r\n| <!--ins k3x9-->x');
    expectEveryOrderAlike('crlf', after);
  });
});

describe('random edits in the cells of random tables', () => {
  it('read the same in every decision order, and leave every row its cells', () => {
    const random = seeded(11);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    for (let n = 0; n < fuzzCount(150); n++) {
      const columns = 1 + Math.floor(random() * 3);
      const words = ['alpha', 'b', 'café', '😀', 'x y', ''];
      const row = (cells: string[]) => `| ${cells.join(' | ')} |`.replace(/ {2}/g, ' ');
      const cell = () => pick(words);
      const lines = [
        row(Array.from({ length: columns }, () => pick(words.slice(0, 5)))),
        row(Array.from({ length: columns }, () => '-')),
      ];
      for (let i = 0; i < 1 + Math.floor(random() * 3); i++) {
        lines.push(row(Array.from({ length: columns }, cell)));
      }
      const text = file(lines.join(random() < 0.3 ? '\n' : '\n'));
      const table = readTables(text, parse(text))[0];
      if (!table) continue;
      const rows = table.rows;
      const target = pick(rows.slice(random() < 0.3 ? 0 : 1));
      const cellRead = pick(target.cells);
      const span = cellRead.textTo - cellRead.textFrom;
      const from = cellRead.textFrom + Math.floor(random() * (span + 1));
      const edit = pick([
        type(from, pick(['q', 'é', 'ab', '\\|', ' '])),
        remove(from, Math.min(cellRead.textTo, from + 1 + Math.floor(random() * 2))),
        replace(from, Math.min(cellRead.textTo, from + 1), 'Z'),
      ]);
      const label = `${JSON.stringify(text)} ${JSON.stringify(edit)}`;
      let after: string;
      try {
        after = track(text, edit);
      } catch (error) {
        if (error instanceof EditError) continue;
        throw error;
      }
      if (after === text) continue;
      expectInOrder(label, [], after);
      expectEveryOrderAlike(label, after);
      for (const view of [newestView(after).text, originalView(after).text]) {
        expect(
          rowsOf(view)?.map((r) => r.length),
          label,
        ).toEqual(rows.map(() => columns));
      }
      expect(rowsOf(originalView(after).text), label).toEqual(rowsOf(text));
    }
  });
});

describe('blank lines written around a table', () => {
  it('are no change of its cells', () => {
    const doc = file(`${FRUIT}`);
    const first = at(doc, FRUIT);
    expect(() => untrackedEdit(doc, type(first, '\n\n'))).not.toThrow();
    expect(() => untrackedEdit(doc, type(first + FRUIT.length, '\n\n'))).not.toThrow();
    expect(() => untrackedEdit(doc, type(first + FRUIT.length, '\n'))).toThrow(ONE_LINE);
    expect(() => untrackedEdit(doc, type(first, '\n'))).toThrow(ONE_LINE);
  });
});

describe('typing in an inserted row (format §3.7)', () => {
  const ROW = '| <!--ins k3x9 row--> Plums | 7     |';
  const BODY = `| Fruit  | Count |\n| ------ | ----- |\n${ROW}\n| Pears  | 5     |`;

  it('is part of the row when the row is the author’s: written as it is, with no mark', () => {
    const text = file(BODY, { k3x9: 'ada' });
    const out = applyChanges(
      text,
      trackedEdit(text, type(at(text, 'Plums', 2), 'x'), context(ada, ['z4q8'])),
    );
    expect(bodyOf(out)).toBe(BODY.replace('Plums', 'Plxums'));
    expect(parse(out).marks.map((mark) => mark.id)).toEqual(['k3x9']);
    expectInOrder('typing in own row', [], out);
  });

  it('is part of the row when the cell is empty, after the marker', () => {
    const text = file(BODY.replace('Plums', '     '), { k3x9: 'ada' });
    const out = applyChanges(
      text,
      trackedEdit(text, type(at(text, '--> ', 4), 'x'), context(ada, ['z4q8'])),
    );
    expect(parse(out).marks.map((mark) => mark.id)).toEqual(['k3x9']);
  });

  it('is a tracked insertion of its own in another person’s row', () => {
    const text = file(BODY, { k3x9: 'bo' });
    const out = applyChanges(
      text,
      trackedEdit(text, type(at(text, 'Plums', 2), 'x'), context(ada, ['z4q8'])),
    );
    expect(
      parse(out)
        .marks.map((mark) => mark.id)
        .sort(),
    ).toEqual(['k3x9', 'z4q8']);
  });
});
