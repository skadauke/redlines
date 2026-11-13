import { describe, expect, it } from 'vitest';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { alignMarkOf } from './table-align.ts';
import { alignPointIn, readRowCells, readTables, tableAt } from './table.ts';
import type { TableRead } from './table.ts';
import { blockLeaves, file, thread } from './test-helpers.ts';

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

// An alignment change is one mark with no closer at the end of the header's last cell
// (`<!--fmt k3x9 align=SPEC-->`, format §3.7, #281): the text of that cell stops in front of it, as the
// text of a row's first cell starts after the marker of an inserted row.
describe('the alignment mark at the end of a header row', () => {
  const SPEC = '\\|\\x20:-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-:\\x20\\|';
  const mark = (id = 'k3x9') => `<!--fmt ${id} align=${SPEC}-->`;
  const MARK = mark();
  const THREE = '| :---- | :---: | ----: |';
  const ROW = '| Apples | 3 | 1.20 |';

  /** A file of a table: its header row, delimiter row and rows, with the given ledger entries. */
  const tableOf = (
    header: string,
    delimiter = THREE,
    rows: string[] = [ROW],
    marks: Record<string, string> = { k3x9: 'bo' },
    threads: string[] = [],
  ) => {
    const text = file([header, delimiter, ...rows].join('\n'), marks, threads);
    const table = tablesOf(text)[0];
    if (!table) throw new Error(`No table in ${JSON.stringify(text)}`);
    return { text, table };
  };

  /** The header rows to read: with the mark after the text of the last cell, in each place it can be. */
  const BY_BO_AND_ADA = { w8nn: 'ada', k3x9: 'bo' };
  const HEADERS: {
    name: string;
    header: string;
    delimiter?: string;
    texts: string[];
    threads?: string[];
    marks?: Record<string, string>;
    row?: string;
    rowTexts?: string[];
  }[] = [
    {
      name: 'outer pipes',
      header: `| Fruit | Count | Price${MARK} |`,
      texts: ['Fruit', 'Count', 'Price'],
    },
    {
      name: 'padding after the mark',
      header: `| Fruit | Count | Price${MARK}    |`,
      texts: ['Fruit', 'Count', 'Price'],
    },
    {
      name: 'no trailing pipe, spaces after the mark',
      header: `| Fruit | Count | Price${MARK}  `,
      delimiter: '| :---- | :---: | ----:',
      texts: ['Fruit', 'Count', 'Price'],
    },
    {
      name: 'no trailing pipe, nothing after the mark',
      header: `| Fruit | Count | Price${MARK}`,
      delimiter: '| :---- | :---: | ----:',
      texts: ['Fruit', 'Count', 'Price'],
    },
    {
      name: 'no leading pipe',
      header: `Fruit | Count | Price${MARK} |`,
      delimiter: ':---- | :---: | ----: |',
      texts: ['Fruit', 'Count', 'Price'],
    },
    {
      name: 'no pipe at the edges',
      header: `Fruit | Count | Price${MARK}  `,
      delimiter: ':---- | :---: | ----:',
      texts: ['Fruit', 'Count', 'Price'],
    },
    {
      name: 'a point comment in front of it, which stays in the text',
      header: `| Fruit | Count | Price<!--cmt c9qf-->${MARK} |`,
      texts: ['Fruit', 'Count', 'Price<!--cmt c9qf-->'],
      threads: thread('c9qf'),
    },
    {
      name: 'an escaped pipe in front of it',
      header: `| Fruit | Count | Pr\\|ice\\|${MARK} |`,
      texts: ['Fruit', 'Count', 'Pr\\|ice\\|'],
    },
    {
      name: 'a pipe in a code span, which GFM reads as two cells',
      header: `| Fruit | Count | \`x|y\`${MARK} |`,
      delimiter: '| :---- | :---: | ----: | --- |',
      texts: ['Fruit', 'Count', '`x', 'y`'],
    },
    {
      name: 'an insertion that ends the text',
      header: `| Fruit | Count | Price<!--ins w8nn-->s<!--/w8nn-->${MARK} |`,
      texts: ['Fruit', 'Count', 'Price<!--ins w8nn-->s<!--/w8nn-->'],
      marks: BY_BO_AND_ADA,
    },
    {
      name: 'a deletion that ends the text',
      header: `| Fruit | Count | Price<!--del w8nn s-->${MARK} |`,
      texts: ['Fruit', 'Count', 'Price<!--del w8nn s-->'],
      marks: BY_BO_AND_ADA,
    },
    {
      name: 'a deletion of all the text, and the mark after it',
      header: `| Fruit | Count | <!--del w8nn Price-->${MARK} |`,
      texts: ['Fruit', 'Count', '<!--del w8nn Price-->'],
      marks: BY_BO_AND_ADA,
    },
    {
      name: 'a substitution of all the text',
      header: `| Fruit | Count | <!--sub w8nn Price-->Cost<!--/w8nn-->${MARK} |`,
      texts: ['Fruit', 'Count', '<!--sub w8nn Price-->Cost<!--/w8nn-->'],
      marks: BY_BO_AND_ADA,
    },
    {
      name: 'a range comment that ends the text',
      header: `| Fruit | Count | <!--cmt c9qf-->Price<!--/c9qf-->${MARK} |`,
      texts: ['Fruit', 'Count', '<!--cmt c9qf-->Price<!--/c9qf-->'],
      threads: thread('c9qf'),
    },
    {
      name: 'an empty last cell that holds only the mark',
      header: `| Fruit | Count | ${MARK} |`,
      texts: ['Fruit', 'Count', ''],
    },
    {
      name: 'an empty last cell with no padding around the mark',
      header: `| Fruit | Count |${MARK}|`,
      texts: ['Fruit', 'Count', ''],
    },
    {
      name: 'a one-cell header',
      header: `| Price${MARK} |`,
      delimiter: '| --- |',
      texts: ['Price'],
      row: '| 1.20 |',
      rowTexts: ['1.20'],
    },
    {
      name: 'a one-cell header with no trailing pipe',
      header: `| Price${MARK}`,
      delimiter: '| ---',
      texts: ['Price'],
      row: '| 1.20 |',
      rowTexts: ['1.20'],
    },
    {
      name: 'a one-cell header with no leading pipe',
      header: `Price${MARK} |`,
      delimiter: '--- |',
      texts: ['Price'],
      row: '1.20 |',
      rowTexts: ['1.20'],
    },
  ];

  /** The table of a header case. */
  const read = (one: (typeof HEADERS)[number]) =>
    tableOf(one.header, one.delimiter, [one.row ?? ROW], one.marks, one.threads);

  it("stops the text of the header's last cell in front of the alignment mark", () => {
    for (const one of HEADERS) {
      const { name, texts, rowTexts } = one;
      const { text, table } = read(one);
      expect(table && cellsOf(text, table)[0], name).toEqual(texts);
      // The mark's own pipes are escaped, so they part no cell.
      expect(table.rows[0]?.cells, name).toHaveLength(texts.length);
      expect(table.aligns, name).toHaveLength(texts.length);
      // The text ends where the mark starts, whatever stands between its end and the pipe.
      const last = table.rows[0]?.cells.at(-1);
      expect(last?.textTo, name).toBe(text.indexOf(MARK));
      // The cell itself still holds the mark: it runs to the pipe or the line's end.
      expect(last?.to, name).toBeGreaterThanOrEqual(text.indexOf(MARK) + MARK.length);
      // The other rows are read as they were.
      expect(cellsOf(text, table)[1], name).toEqual(rowTexts ?? ['Apples', '3', '1.20']);
    }
  });

  it('reads the cells of each header as micromark does', () => {
    for (const one of HEADERS) {
      const { text, table } = read(one);
      const oracle = blockLeaves(text).filter((leaf) => leaf.kind === 'table');
      expect(oracle, one.name).toHaveLength(1);
      // The text of a cell as a renderer shows it: no comments, one space for white space, `\|` as `|`.
      const shown = (cell: string) =>
        cell
          .replaceAll('\\|', '|')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      const columns = table.aligns.length;
      const mine = cellsOf(text, table).map((row) => {
        const cells = row.slice(0, columns).map(shown);
        while (cells.length < columns) cells.push('');
        return cells;
      });
      expect(mine, one.name).toEqual(oracle[0]?.rows);
    }
  });

  it('reads the header of a one-cell table with the marker of an inserted row in its first cell', () => {
    const header = (cell: string) =>
      tableOf(`| ${cell} |`, '| --- |', ['| 1.20 |'], {
        w8nn: 'ada',
        k3x9: 'bo',
      });
    // The text between them: after the marker and its space, and in front of the mark.
    const both = header(`<!--ins w8nn row--> Price${MARK}`);
    const cell = both.table.rows[0]?.cells[0];
    expect(both.table.rows[0]?.insertion?.id).toBe('w8nn');
    expect(both.text.slice(cell?.textFrom, cell?.textTo)).toBe('Price');
    expect(cell?.textTo).toBe(both.text.indexOf(MARK));
    // The same with the marker of an inserted column.
    const column = header(`<!--ins w8nn col--> Price${MARK}`);
    const inColumn = column.table.rows[0]?.cells[0];
    expect(column.text.slice(inColumn?.textFrom, inColumn?.textTo)).toBe('Price');
    // No text between them: one stop, in front of the mark and never inside it.
    for (const gap of ['', ' ', '  ']) {
      const alone = header(`<!--ins w8nn row-->${gap}${MARK}`);
      const stop = alone.table.rows[0]?.cells[0];
      expect(stop?.textFrom, JSON.stringify(gap)).toBe(stop?.textTo);
      const marker = alone.text.indexOf('<!--ins w8nn row-->') + '<!--ins w8nn row-->'.length;
      expect(stop?.textTo, JSON.stringify(gap)).toBeGreaterThanOrEqual(marker);
      expect(stop?.textTo, JSON.stringify(gap)).toBeLessThanOrEqual(alone.text.indexOf(MARK));
    }
  });

  it('gives an empty last cell that holds only the mark one stop, in front of it', () => {
    for (const [header, delimiter] of [
      [`| Fruit | Count | ${MARK} |`, THREE],
      [`| Fruit | Count |${MARK}|`, THREE],
      [`| Fruit | Count |   ${MARK}  |`, THREE],
      [`| Fruit | Count | ${MARK}`, '| :---- | :---: | ----:'],
      [`Fruit | Count | ${MARK}`, ':---- | :---: | ----:'],
    ] as const) {
      const { text, table } = tableOf(header, delimiter);
      const cell = table.rows[0]?.cells[2];
      expect(cell?.textFrom, header).toBe(cell?.textTo);
      expect(cell?.textTo, header).toBe(text.indexOf(MARK));
      expect(cellsOf(text, table)[0], header).toEqual(['Fruit', 'Count', '']);
    }
  });

  it('does not take a mark that has text after it for the end', () => {
    for (const after of ['x', ' x', '<!--cmt c9qf-->', '<!--ins w8nn row-->']) {
      const header = `| Fruit | Count | Price${MARK}${after} |`;
      const { text, table } = tableOf(header, THREE, [ROW], { k3x9: 'bo', w8nn: 'ada' }, [
        ...thread('c9qf'),
      ]);
      const last = table.rows[0]?.cells[2];
      expect(text.slice(last?.textFrom, last?.textTo), after).toBe(`Price${MARK}${after}`);
    }
    // Another format change at the end is no alignment change.
    const bold = tableOf('| Fruit | Count | Price<!--fmt w8nn +check--> |', THREE, [ROW], {
      w8nn: 'bo',
    });
    const cell = bold.table.rows[0]?.cells[2];
    expect(bold.text.slice(cell?.textFrom, cell?.textTo)).toBe('Price<!--fmt w8nn +check-->');
  });

  it('reads the mark at the end of any row, as a merge can leave it there', () => {
    const { text, table } = tableOf('| Fruit | Count | Price |', THREE, [
      `| Apples | 3 | 1.20${MARK} |`,
    ]);
    expect(cellsOf(text, table)[1]).toEqual(['Apples', '3', '1.20']);
    expect(table.rows[1]?.cells[2]?.textTo).toBe(text.indexOf(MARK));
  });

  it('reads a table with the mark in its header as padded', () => {
    const padded = (header: string, delimiter: string, rows: string[]) =>
      tableOf(header, delimiter, rows, { k3x9: 'bo', w8nn: 'ada' }).table.padded;
    const fruit = ['| Apples | 3     | 1.20  |', '| Pears  | 5     | 0.90  |'];
    // The header with the mark has the same pipes as the delimiter row once the mark is cut out.
    expect(padded(`| Fruit  | Count | Price${MARK} |`, '| :----- | :---: | ----: |', fruit)).toBe(
      true,
    );
    expect(padded('| Fruit  | Count | Price |', '| :----- | :---: | ----: |', fruit)).toBe(true);
    // The mark in the header of a table that was not padded before it does not make it padded.
    expect(padded(`| a | b${MARK} |`, '| - | - |', ['| cc | d |'])).toBe(false);
    expect(padded(`| a | b${MARK} |`, '| - | - |', ['| c | d |'])).toBe(true);
    // Both branches: a header that holds the marker of an inserted column as well.
    expect(padded(`| a | <!--ins w8nn col--> b${MARK} |`, '| - | - |', ['| c | d |'])).toBe(true);
    expect(padded(`| a | <!--ins w8nn col--> b${MARK} |`, '| - | - |', ['| cc | d |'])).toBe(false);
    // No pipe at the edges: the mark is after the last pipe, so the pipes are where they were.
    expect(padded(`a | b${MARK}`, '--|--', ['c | d'])).toBe(true);
    expect(padded(`a | b${MARK}  `, '--|--', ['c | d'])).toBe(true);
    expect(padded(`a | b${MARK}`, '--|--', ['cc | d'])).toBe(false);
  });

  it('reads the same cells through readRowCells, which has no parse', () => {
    const cases = [
      ...HEADERS.map(read),
      tableOf(`| <!--ins w8nn row--> Price${MARK} |`, '| --- |', ['| 1.20 |'], {
        w8nn: 'ada',
        k3x9: 'bo',
      }),
      tableOf(`| <!--ins w8nn row-->${MARK} |`, '| --- |', ['| 1.20 |'], {
        w8nn: 'ada',
        k3x9: 'bo',
      }),
      tableOf(`| Fruit | Count | ${MARK} |`),
      tableOf('| Fruit | Count | Price |', THREE, [`| Apples | 3 | 1.20${MARK} |`]),
    ];
    for (const { text, table } of cases) {
      for (const row of table.rows) {
        const line = text.slice(row.from, row.to);
        const read = readRowCells(line, 0, line.length);
        expect(read.leadingPipe, line).toBe(row.leadingPipe);
        // Neither reader has the mark in the text of a cell.
        expect(
          read.cells.map((cell) => line.slice(cell.textFrom, cell.textTo)).join('|'),
          line,
        ).not.toContain('align=');
        expect(
          read.cells.map((cell) => [cell.from, cell.to, cell.textFrom, cell.textTo]),
          line,
        ).toEqual(
          row.cells.map((cell) => [
            cell.from - row.from,
            cell.to - row.from,
            cell.textFrom - row.from,
            cell.textTo - row.from,
          ]),
        );
      }
    }
  });

  it('finds the alignment change of the right one of two tables, in either form', () => {
    const one = (extra = '') => `| a | b${extra} |\n| :-- | --- |\n| c | d |`;
    const two = (extra = '') => `| e | f${extra} |\n| --- | :-: |\n| g | h |`;
    const span = (id: string, table: string) => `${mark(id)}\n\n${table}\n\n<!--/${id}-->`;
    const check = (
      name: string,
      body: string,
      ids: Record<string, string>,
      found: (string | null)[],
    ) => {
      const text = file(body, ids);
      const parsed = parse(text);
      const tables = readTables(text, parsed);
      expect(tables, name).toHaveLength(2);
      expect(
        tables.map((table) => alignMarkOf(parsed, table)?.id ?? null),
        name,
      ).toEqual(found);
    };
    const k = { k3x9: 'bo' };
    const w = { w8nn: 'bo' };
    const both = { k3x9: 'bo', w8nn: 'bo' };
    check('a point in the first', `${one(MARK)}\n\n${two()}`, k, ['k3x9', null]);
    check('a point in the second', `${one()}\n\n${two(MARK)}`, k, [null, 'k3x9']);
    check('a point in each', `${one(mark('k3x9'))}\n\n${two(mark('w8nn'))}`, both, [
      'k3x9',
      'w8nn',
    ]);
    check('a span around the first', `${span('k3x9', one())}\n\n${two()}`, k, ['k3x9', null]);
    check('a span around the second', `${one()}\n\n${span('w8nn', two())}`, w, [null, 'w8nn']);
    check('a span, then a point', `${span('k3x9', one())}\n\n${two(mark('w8nn'))}`, both, [
      'k3x9',
      'w8nn',
    ]);
    check('a point, then a span', `${one(mark('k3x9'))}\n\n${span('w8nn', two())}`, both, [
      'k3x9',
      'w8nn',
    ]);
    check(
      'in a row below the header',
      `${one().replace('| c | d |', `| c | d${MARK} |`)}\n\n${two()}`,
      k,
      ['k3x9', null],
    );
    check('none', `${one()}\n\n${two()}`, {}, [null, null]);
  });

  it('leaves the deletions below the table with the table, and the mark in its header', () => {
    const body = `| Fruit | Count | Price${MARK} |\n${THREE}\n${ROW}\n\n<!--del g5nb row=2 \\| Pears \\| 5 \\| 0.90 \\|-->`;
    const text = file(body, { k3x9: 'bo', g5nb: 'bo' });
    const parsed = parse(text);
    const [table] = readTables(text, parsed);
    expect(table?.deletions.map((deletion) => deletion.mark.id)).toEqual(['g5nb']);
    expect(table && alignMarkOf(parsed, table)?.id).toBe('k3x9');
    expect(table && cellsOf(text, table)).toEqual([
      ['Fruit', 'Count', 'Price'],
      ['Apples', '3', '1.20'],
    ]);
  });

  it('is found in the table whose rows hold it, and in no table when none does', () => {
    const lone = file(`${MARK}\n\n| a | b |\n| - | - |\n| c | d |`, { k3x9: 'bo' });
    const parsed = parse(lone);
    const [table] = readTables(lone, parsed);
    expect(table && alignMarkOf(parsed, table)).toBeUndefined();
  });
});

describe('alignPointIn', () => {
  const SPEC = '\\|\\x20:-\\-\\-\\-\\-\\x20\\|';
  const MARK = `<!--fmt k3x9 align=${SPEC}-->`;
  const find = (text: string, from = 0, to = text.length) => alignPointIn(text, from, to);

  it('finds the whole mark that ends a range, white space after it aside', () => {
    const text = `Price${MARK}`;
    expect(find(text)).toEqual({ from: 5, to: text.length });
    expect(find(`${text} \t `)).toEqual({ from: 5, to: text.length });
    expect(find(`${MARK}`)).toEqual({ from: 0, to: MARK.length });
    // Only what is in the range counts.
    expect(find(`${text} more`, 0, text.length)).toEqual({ from: 5, to: text.length });
    // The payload may hold anything a value holds: escapes, and a `<!--` that is no end.
    const odd = '<!--fmt b2c3 align=\\|\\x20-\\-\\-\\x20\\|\\x20x<!--y-->';
    expect(find(`a${odd}`)).toEqual({ from: 1, to: 1 + odd.length });
  });

  it('is null when anything but white space follows it in the range', () => {
    expect(find(`Price${MARK}x`)).toBeNull();
    expect(find(`Price${MARK} x`)).toBeNull();
    expect(find(`Price${MARK}<!--cmt c9qf-->`)).toBeNull();
    expect(find(`Price${MARK}`, 0, `Price${MARK}`.length - 1)).toBeNull();
  });

  it('is null for what is not a whole alignment mark that starts in the range', () => {
    for (const text of [
      'Price',
      '',
      '<!--fmt k3x9 +check-->',
      '<!--fmt k3x9 -->',
      '<!--fmt k3x9-->',
      '<!--ins k3x9 row-->',
      '<!--cmt k3x9 align=x-->',
      // The id is four characters of the id alphabet: a consonant, then consonants and digits.
      '<!--fmt k3x align=x-->',
      '<!--fmt k3x9x align=x-->',
      '<!--fmt a3x9 align=x-->',
      '<!--fmt k3e9 align=x-->',
      '<!--fmt K3X9 align=x-->',
      // `align=` is the payload's first word.
      '<!--fmt k3x9 +bold align=x-->',
      '<!--fmt k3x9 xalign=x-->',
      '<!--fmt k3x9  align=x-->',
      // No end, or an end that is not the first `-->`.
      '<!--fmt k3x9 align=x',
      '<!--fmt k3x9 align=x--',
      '<!--fmt k3x9 align=a--> b -->',
    ]) {
      expect(find(text), JSON.stringify(text)).toBeNull();
    }
    // A mark that starts before the range is no mark of it.
    expect(find(`Price${MARK}`, 6)).toBeNull();
    // A line break is no part of a payload.
    expect(find('<!--fmt k3x9 align=a\nb-->')).toBeNull();
    expect(find('<!--fmt k3x9 align=a\r\nb-->')).toBeNull();
  });

  it('takes the marker that the scan reads: a marker ends at its first -->', () => {
    // The second opener is part of the first one's payload, as the scan reads them left to right.
    const nested = 'a<!--fmt k3x9 align=x<!--fmt w8nn align=y-->';
    expect(find(nested)).toEqual({ from: 1, to: nested.length });
    // Two marks one after the other: the last one ends the range, and the first is text.
    const two = 'a<!--fmt k3x9 align=x--><!--fmt w8nn align=y-->';
    expect(find(two)).toEqual({ from: 24, to: two.length });
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

/** Holds the tables of `text` to micromark's: how many, and the cells of every row. */
function expectOracle(text: string): void {
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
          text.slice(cell.textFrom, cell.textTo).replaceAll('\\|', '|').replace(/\s+/g, ' ').trim(),
        );
      while (cells.length < columns) cells.push('');
      return cells;
    });
    expect(mine, JSON.stringify(text)).toEqual(oracle[index]?.rows);
  });
}

describe('readTables against the oracle', () => {
  it('reads the cells of random tables as micromark does', () => {
    const random = seeded(7);
    for (let n = 0; n < fuzzCount(500); n++) {
      const body = randomBody(random);
      expectOracle(random() < 0.2 ? body.replaceAll('\n', '\r\n') : body);
    }
  });

  // Leading whitespace is columns, and a tab goes to the next multiple of four: four columns make
  // indented code, which starts no table, is no delimiter row and ends the table's rows (#290). Tabs
  // and spaces around the pipes, CRLF and the blocks beside the table are drawn too.
  it('reads leading tabs and spaces before every row as micromark does', () => {
    const random = seeded(290);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const white = () => {
      let out = '';
      for (let n = Math.floor(random() * 6); n > 0; n--) out += random() < 0.35 ? '\t' : ' ';
      return out;
    };
    // (blocks that end before the blank line after them, so that the table is a top-level block)
    const BEFORE = [
      '',
      '',
      'Words.\n\n',
      '# Heading\n\n',
      '- item\n\n',
      '> quote\n\n',
      '```\ncode\n```\n\n',
      '    code\n\n',
      '<div>\nx\n</div>\n\n',
    ];
    const AFTER = [
      '',
      '',
      '\n\nWords.',
      '\n\n# Heading',
      '\n\n- item',
      '\n\n> quote',
      '\n\n    code',
    ];
    const cases = Math.max(2000, fuzzCount(2000));
    for (let n = 0; n < cases; n++) {
      const bare = random() < 0.5;
      const columns = 1 + Math.floor(random() * 3);
      const gap = () => pick(['', ' ', ' ', '\t', ' \t']);
      const cells = (word: (i: number) => string) =>
        Array.from({ length: columns }, (_, i) => word(i)).join(`${gap()}|${gap()}`);
      const wrap = (line: string) => (bare && columns > 1 ? line : `|${gap()}${line}${gap()}|`);
      const lines = [
        wrap(cells((i) => `h${i}`)),
        wrap(cells(() => pick(['-', '---', ':-:', '--:']))),
      ];
      for (let r = Math.floor(random() * 4); r > 0; r--) lines.push(wrap(cells((i) => `c${i}`)));
      const lead = () => (random() < 0.4 ? '' : white());
      const table = lines.map((line) => `${lead()}${line}`).join('\n');
      const text = `${pick(BEFORE)}${table}${pick(AFTER)}`;
      expectOracle(random() < 0.2 ? text.replaceAll('\n', '\r\n') : text);
    }
  });
});
