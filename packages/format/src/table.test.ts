import { describe, expect, it } from 'vitest';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { readTables, tableAt } from './table.ts';
import type { TableRead } from './table.ts';
import { blockLeaves, file } from './test-helpers.ts';

const tablesOf = (text: string): TableRead[] => readTables(text, parse(text));

/** The text of each cell of each row, as written between its padding. */
function cellsOf(text: string, table: TableRead): string[][] {
  return table.rows.map((row) => row.cells.map((cell) => text.slice(cell.textFrom, cell.textTo)));
}

const FRUIT = '| Fruit  | Count |\n| ------ | ----- |\n| Apples | 3     |\n| Pears  | 5     |\n';

describe('readTables', () => {
  it('reads rows, cells, the delimiter row and the alignments', () => {
    const text = '| a | b |\n| :-- | --: |\n| c | d |\n';
    const [table] = tablesOf(text);
    expect(table).toBeDefined();
    if (!table) return;
    expect(cellsOf(text, table)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(table.aligns).toEqual(['left', 'right']);
    expect(text.slice(table.delimiter.from, table.delimiter.to)).toBe('| :-- | --: |');
    expect(text.slice(table.from, table.to)).toBe('| a | b |\n| :-- | --: |\n| c | d |');
    expect(table.rows.map((row) => row.header)).toEqual([true, false]);
    expect(table.rows.every((row) => row.leadingPipe)).toBe(true);
  });

  it('gives each cell from its opening pipe to the next, the last to the end of the line', () => {
    const text = '| ab | c |\n| - | - |\n';
    const [table] = tablesOf(text);
    const [a, b] = table?.rows[0]?.cells ?? [];
    expect([a?.from, a?.to, a?.textFrom, a?.textTo]).toEqual([0, 5, 2, 4]);
    expect([b?.from, b?.to, b?.textFrom, b?.textTo]).toEqual([5, 10, 7, 8]);
  });

  it('reads a padded table as padded, and one with an unpadded row as not', () => {
    expect(tablesOf(FRUIT)[0]?.padded).toBe(true);
    expect(tablesOf('| a | b |\n| - | - |\n| cc | d |\n')[0]?.padded).toBe(false);
    expect(tablesOf('| a | b |\n| - | - |\n| c | d |\n')[0]?.padded).toBe(true);
  });

  it('reads \\| as no cell break, and a pipe in a code span as one', () => {
    const text = '| a | b |\n| - | - |\n| x \\| y | `p\\|q` |\n| `x | y` | z |\n';
    const [table] = tablesOf(text);
    expect(table && cellsOf(text, table)).toEqual([
      ['a', 'b'],
      ['x \\| y', '`p\\|q`'],
      ['`x', 'y`', 'z'],
    ]);
  });

  it('reads \\\\| as a backslash and a cell break', () => {
    const text = '| a |\n| - |\n| b\\\\|c |\n';
    const [table] = tablesOf(text);
    expect(table && cellsOf(text, table)[1]).toEqual(['b\\\\', 'c']);
  });

  it('reads leading and trailing pipes as optional', () => {
    const text = 'a | b\n--|--\nc | d |\n| e | f\n';
    const [table] = tablesOf(text);
    expect(table && cellsOf(text, table)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
    expect(table?.rows.map((row) => row.leadingPipe)).toEqual([false, false, true]);
  });

  it('reads an empty cell with its stop after the first space of its padding', () => {
    const text = '| a |  | c |\n| - | - | - |\n|  |  |  |\n||||\n';
    const [table] = tablesOf(text);
    const stops = (row: number) =>
      table?.rows[row]?.cells.map((cell) => [cell.textFrom, cell.textTo]);
    expect(stops(0)?.[1]).toEqual([6, 6]);
    expect(text.slice(0, 6)).toBe('| a | ');
    expect(stops(1)).toEqual([
      [text.indexOf('|  |  |  |') + 2, text.indexOf('|  |  |  |') + 2],
      [text.indexOf('|  |  |  |') + 5, text.indexOf('|  |  |  |') + 5],
      [text.indexOf('|  |  |  |') + 8, text.indexOf('|  |  |  |') + 8],
    ]);
    // No padding at all: the stop is after the pipe.
    const bare = table?.rows[2]?.cells.map((cell) => [cell.textFrom, cell.textTo]);
    const at = text.indexOf('||||');
    expect(bare).toEqual([
      [at + 1, at + 1],
      [at + 2, at + 2],
      [at + 3, at + 3],
    ]);
  });

  it('reads ragged rows as written, and an empty header cell', () => {
    const text = '| a |  | c |\n| - | - | - |\n| d |\n| e | f | g | h |\n';
    const [table] = tablesOf(text);
    expect(table?.rows.map((row) => row.cells.length)).toEqual([3, 1, 4]);
    expect(table?.aligns).toHaveLength(3);
    expect(table && cellsOf(text, table)[0]).toEqual(['a', '', 'c']);
  });

  it('reads a row without a leading pipe', () => {
    const text = '| a | b |\n| - | - |\nc | d |\n';
    const [table] = tablesOf(text);
    expect(table?.rows[1]?.leadingPipe).toBe(false);
    expect(table && cellsOf(text, table)[1]).toEqual(['c', 'd']);
    expect(table?.rows[1]?.cells[0]?.from).toBe(text.indexOf('c'));
  });

  it('reads a lone pipe as a row of one empty cell', () => {
    const text = '| a |\n| - |\n|\n| b |\n';
    const [table] = tablesOf(text);
    expect(table?.rows).toHaveLength(3);
    expect(table?.rows[1]?.cells).toHaveLength(1);
  });

  it("keeps the file's line breaks out of the cells, in a CRLF file", () => {
    const text = '| a | b |\r\n| - | - |\r\n| c | d |\r\n\r\nafter\r\n';
    const [table] = tablesOf(text);
    expect(table && cellsOf(text, table)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(text.slice(table?.from, table?.to)).toBe('| a | b |\r\n| - | - |\r\n| c | d |');
    const last = table?.rows[1]?.cells[1];
    expect(text.slice(last?.from, last?.to)).toBe('| d |');
  });

  it('reads a table at the start of the file and one at its end, before the ledger', () => {
    const first = tablesOf('| a |\n| - |\n| b |');
    expect(first).toHaveLength(1);
    expect(first[0]?.from).toBe(0);
    const text = file('Intro.\n\n| a | b |\n| - | - |\n| c | d |');
    const [table] = tablesOf(text);
    expect(table && cellsOf(text, table)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(text.slice(table?.to, table?.to ? table.to + 2 : 0)).toBe('\n\n');
  });

  it('reads two tables a blank line apart as two', () => {
    const text = '| a |\n| - |\n| b |\n\n| c |\n| - |\n| d |\n';
    const tables = tablesOf(text);
    expect(tables).toHaveLength(2);
    expect(text.slice(tables[1]?.from)).toBe('| c |\n| - |\n| d |\n');
  });

  it('reads a table that follows a paragraph line, a heading and a table', () => {
    const text = 'Text\n| a |\n| - |\n\n# H\n| b |\n| - |\n';
    const tables = tablesOf(text);
    expect(tables.map((table) => text.slice(table.from, table.from + 5))).toEqual([
      '| a |',
      '| b |',
    ]);
  });

  it('does not read a table in a quote or a list item, in code or in front matter', () => {
    expect(tablesOf('> | a |\n> | - |\n> | b |\n')).toEqual([]);
    expect(tablesOf('- | a |\n  | - |\n  | b |\n')).toEqual([]);
    expect(tablesOf('- item\n\n  | a |\n  | - |\n  | b |\n')).toEqual([]);
    expect(tablesOf('1. item\n   | a |\n   | - |\n')).toEqual([]);
    expect(tablesOf('```\n| a |\n| - |\n```\n')).toEqual([]);
    expect(tablesOf('    | a |\n    | - |\n')).toEqual([]);
    expect(tablesOf('<div>\n| a |\n| - |\n</div>\n')).toEqual([]);
    expect(tablesOf('---\ntitle: x | y\n---\n| a |\n| - |\n')).toHaveLength(1);
    expect(tablesOf('| a |\n| b |\n')).toEqual([]);
    expect(tablesOf('| a | b |\n| - |\n')).toEqual([]);
  });

  it('ends the table where another block starts', () => {
    for (const after of ['# H', '> q', '- item', '---', '```', '<div>', '    code', '<!--x-->']) {
      const text = `| a |\n| - |\n| b |\n${after}\n`;
      const [table] = tablesOf(text);
      expect(text.slice(table?.from, table?.to), after).toBe('| a |\n| - |\n| b |');
    }
    // A line of plain text is a row.
    const text = '| a |\n| - |\n| b |\ntail\n';
    expect(tablesOf(text)[0]?.rows).toHaveLength(3);
  });

  it("puts the marker of an inserted row and the space after it outside the cell's text", () => {
    const text =
      '| Fruit  | Count |\n| ------ | ----- |\n| Apples | 3     |\n| <!--ins k3x9 row--> Pears | 5 |\n\n';
    const marked = file(text.trimEnd(), { k3x9: 'ada' });
    const [table] = tablesOf(marked);
    const row = table?.rows[2];
    expect(row?.insertion?.id).toBe('k3x9');
    expect(row && marked.slice(row.cells[0]?.textFrom, row.cells[0]?.textTo)).toBe('Pears');
    expect(table?.rows[1]?.insertion).toBeNull();
    expect(table?.padded).toBe(true);
  });

  it("gives an inserted row with an empty first cell a stop after the marker's space", () => {
    const body = '| a | b |\n| - | - |\n| <!--ins k3x9 row--> | 5 |';
    const text = file(body, { k3x9: 'ada' });
    const [table] = tablesOf(text);
    const cell = table?.rows[1]?.cells[0];
    expect(cell?.textFrom).toBe(cell?.textTo);
    expect(text.slice(0, cell?.textFrom).endsWith('row--> ')).toBe(true);
  });

  it("puts the marker of an inserted column outside the header cell's text", () => {
    const body = '| a | <!--ins k3x9 col--> b |\n| - | - |\n| c | d |';
    const text = file(body, { k3x9: 'ada' });
    const [table] = tablesOf(text);
    const cell = table?.rows[0]?.cells[1];
    expect(text.slice(cell?.textFrom, cell?.textTo)).toBe('b');
    expect(table?.rows[0]?.insertion).toBeNull();
  });

  it('keeps the deleted rows and columns below a table out of its rows, with their positions', () => {
    const body =
      '| Fruit | Count |\n| --- | --- |\n| Apples | 3 |\n\n' +
      '<!--del g5nb row=2 \\| Pears \\| 5 \\|-->\n<!--del h6nb col=2 \\| a \\\\n \\| b-->\n\nAfter.';
    const text = file(body, { g5nb: 'bo', h6nb: 'bo' });
    const [table] = tablesOf(text);
    expect(table?.rows).toHaveLength(2);
    expect(table?.deletions.map((d) => [d.mark.id, d.axis, d.position])).toEqual([
      ['g5nb', 'row', 2],
      ['h6nb', 'col', 2],
    ]);
    // Without the blank line, or after other text, a deletion belongs to no table.
    const near = file('| a |\n| - |\n| b |\n<!--del g5nb row=1 \\| c \\|-->\n\n', { g5nb: 'bo' });
    expect(tablesOf(near)[0]?.deletions).toEqual([]);
  });

  it('finds the table that holds a position', () => {
    const text = 'x\n\n| a |\n| - |\n| b |\n\ny\n';
    const parsed = parse(text);
    expect(tableAt(text, parsed, text.indexOf('b'))?.from).toBe(3);
    expect(tableAt(text, parsed, 0)).toBeNull();
    expect(tableAt(text, parsed, text.indexOf('y'))).toBeNull();
  });
});

// The tables of random documents, against micromark, which reads GFM tables as GitHub does.
const WORDS = ['alpha', 'beta', 'café', 'x', '42', '😀', 'a b', 'e\u0301', 'q\\|r', 'o-o'];

function randomTable(random: () => number): string {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const columns = 1 + Math.floor(random() * 4);
  const rows = Math.floor(random() * 5);
  const lead = random() < 0.7;
  const trail = random() < 0.7;
  const pad = pick(['', ' ', '  ']);
  const row = (cells: string[]) => {
    let line = cells.join(`${pad}|${pad}`);
    line = `${lead || random() < 0.05 ? `|${pad}` : ''}${line}${trail ? `${pad}|` : ''}`;
    if (!line.includes('|')) line = `${line}${pad}|`;
    return line;
  };
  const cell = () => (random() < 0.15 ? '' : pick(WORDS));
  const wanted = (count: number) => Array.from({ length: count }, cell);
  const raggedCount = () => (random() < 0.25 ? Math.max(1, columns + pick([-1, 1, 2])) : columns);
  const lines = [row(wanted(columns))];
  lines.push(
    `${lead ? '|' : ''}${Array.from({ length: columns }, () => pick(['---', ':--', '--:', ':-:', '-'])).join('|')}${trail ? '|' : ''}`,
  );
  if (!lead && !trail && columns === 1) lines[1] = `${lines[1]}|`;
  for (let i = 0; i < rows; i++) lines.push(row(wanted(raggedCount())));
  // Indentation up to three spaces, and spaces at the end of a line, change no cell.
  return lines
    .map((line) => `${pick(['', '', '', ' ', '   '])}${line}${pick(['', '', ' ', '  '])}`)
    .join('\n');
}

function randomBody(random: () => number): string {
  const blocks: string[] = [];
  const count = 1 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const kind = random();
    if (kind < 0.7) blocks.push(randomTable(random));
    else if (kind < 0.8) blocks.push('Some words here.');
    else if (kind < 0.9) blocks.push('# Heading');
    else blocks.push('- item\n- other');
  }
  // A table right under a list item is a table GFM reads from a lazy line, which is left as source.
  const loose = random() < 0.8;
  return blocks.reduce(
    (all, block, i) =>
      i === 0
        ? block
        : `${all}${loose || /^(?:- |> )/.test(blocks[i - 1] ?? '') ? '\n\n' : '\n'}${block}`,
    '',
  );
}

describe('readTables against the oracle', () => {
  it('reads the cells of random tables as micromark does', () => {
    const random = seeded(7);
    for (let n = 0; n < fuzzCount(500); n++) {
      const body = randomBody(random);
      const text = random() < 0.2 ? body.replaceAll('\n', '\r\n') : body;
      const tables = tablesOf(text);
      const oracle = blockLeaves(text).filter(
        (leaf) => leaf.kind === 'table' && leaf.chain.length === 0,
      );
      expect(tables.length, JSON.stringify(text)).toBe(oracle.length);
      tables.forEach((table, index) => {
        const columns = table.aligns.length;
        const mine = table.rows.map((row) => {
          const cells = row.cells
            .slice(0, columns)
            .map((cell) =>
              text
                .slice(cell.textFrom, cell.textTo)
                .replaceAll('\\|', '|')
                .replace(/\s+/g, ' ')
                .trim(),
            );
          while (cells.length < columns) cells.push('');
          return cells;
        });
        expect(mine, JSON.stringify(text)).toEqual(oracle[index]?.rows);
      });
    }
  });
});
