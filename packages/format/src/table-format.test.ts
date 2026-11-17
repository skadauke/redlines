// Bold and italic over cells of a table with Track Changes on, one mark for each cell (format §3.7,
// "Cells apart"): each cell is checked against its own marks, and every order of decisions of the
// result reads alike, judged exactly and by micromark 4.0.2 with GFM tables. The edges: a pipe in a
// code span, a cell that is only a marker, CRLF, a table without outer pipes, and cells in moved
// and deleted rows and columns.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { encodeValue } from './format-ops.ts';
import { trackedFormat, trackedFormatRanges, untrackedFormat } from './formatting.ts';
import type { FormatOp } from './formatting.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { readTables } from './table.ts';
import { parse } from './parse.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import {
  ada,
  bo,
  context,
  everyOrder,
  exactly,
  expectEveryOrderAlike,
  expectNoDecisionRefused,
  file,
  problemsOf,
} from './test-helpers.ts';
import type { Person } from './types.ts';
import { newestView, originalView } from './views.ts';

const BOLD: FormatOp = { kind: 'inline', format: 'bold', on: true };
const ITALIC: FormatOp = { kind: 'inline', format: 'italic', on: true };
const IDS = [
  'b2cd',
  'c3df',
  'd4fg',
  'f5gh',
  'g6hj',
  'h7jk',
  'j8km',
  'k9mn',
  'm2np',
  'n3pq',
  'p4qr',
];

/** The ranges of the texts of the cells at `(row, col)` of the first table (row 0 the header). */
function cellsAt(text: string, cells: readonly (readonly [number, number])[]) {
  const table = readTables(text, parse(text))[0];
  if (!table) throw new Error('no table');
  return cells.map(([row, col]) => {
    const cell = table.rows[row]?.cells[col];
    if (!cell) throw new Error(`no cell ${row},${col}`);
    return { from: cell.textFrom, to: cell.textTo };
  });
}

/** `op` over the cells, as one change, or the refusal. */
function over(
  text: string,
  cells: readonly (readonly [number, number])[],
  op: FormatOp = BOLD,
  who: Person = ada,
) {
  const ranges = cellsAt(text, cells);
  try {
    const { changes } = trackedFormatRanges(text, ranges, op, context(who, IDS));
    return { after: applyChanges(text, changes), refusal: undefined };
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    return { after: undefined, refusal: error.message };
  }
}

/** The change is written, reads alike in every order, and accepts and rejects whole. */
function expectWritten(
  label: string,
  text: string,
  cells: readonly (readonly [number, number])[],
  op: FormatOp = BOLD,
  micromark = true,
) {
  const { after, refusal } = over(text, cells, op);
  expect(refusal, `${label}: refused`).toBeUndefined();
  expect(after, label).toBeDefined();
  // Every order gives the same newest view and none is stuck; micromark reads each state as the
  // newest view (not where a pending row or column leaves its marker's space in the cell).
  const { outcomes, stuck } = everyOrder(after!, exactly);
  for (const [decided, results] of outcomes) {
    expect([...results], `${label}: ${decided}`).toHaveLength(1);
  }
  expect(stuck, `${label}: stuck`).toEqual([]);
  if (micromark) expectEveryOrderRead(label, after!);
  const accepted = applyChanges(after!, acceptAll(after!));
  const rejected = applyChanges(after!, rejectAll(after!));
  expect(newestView(accepted).text.trimEnd(), `${label}: accepted`).toBe(
    newestView(after!).text.trimEnd(),
  );
  expect(originalView(rejected).text.trimEnd(), `${label}: rejected`).toBe(
    originalView(text).text.trimEnd(),
  );
  return after!;
}

const marksOf = (text: string) => parse(text).marks.filter((mark) => mark.kind === 'fmt').length;

describe('a pipe in a code span', () => {
  it('splits a cell at an unescaped pipe, as GFM reads it, and not at an escaped one', () => {
    const rows = [
      '| a | b |',
      '| - | - |',
      '| `x\\|y` | one |',
      '| `p|q` | two |',
      '| pre `m\\|n` post | three |',
    ];
    const text = file(rows.join('\n'));
    for (const op of [BOLD, ITALIC]) {
      // The cells beside a code span with an escaped pipe, and the cell around it.
      expectWritten(
        'beside escaped',
        text,
        [
          [1, 1],
          [2, 1],
          [3, 1],
        ],
        op,
      );
      expectWritten('around code with escaped pipe', text, [[3, 0]], op);
      expectWritten(
        'code only',
        text,
        [
          [1, 0],
          [1, 1],
        ],
        op,
      );
    }
  });
});

describe('a cell that is only a marker', () => {
  const rows = [
    '| a | b | c |',
    '| - | - | - |',
    '| <!--ins k3x9-->new<!--/k3x9--> | x | y |',
    '| <!--del m2bd gone --> | z | w |',
    '| <!--ins p5qm-->  <!--/p5qm--> | v | u |',
  ];
  const text = file(rows.join('\n'), { k3x9: 'bo', m2bd: 'bo', p5qm: 'bo' });

  it('does not keep its neighbours from being formatted', () => {
    for (const op of [BOLD, ITALIC]) {
      expectWritten(
        'neighbours',
        text,
        [
          [1, 1],
          [2, 2],
        ],
        op,
      );
    }
  }, 60_000);

  it('is written as a replacement of the table, with the person’s change in its old text', () => {
    const wide = over(text, [
      [1, 0],
      [1, 1],
    ]);
    expect(wide.refusal).toBeUndefined();
    expect(parse(wide.after ?? '').marks.some((mark) => mark.kind === 'sub')).toBe(true);
    expectEveryOrderRead('widened cell format', wide.after ?? '');
    // A cell with nothing to format but a marker takes no change.
    expect(over(text, [[2, 0]])).toEqual({ after: text, refusal: undefined });
  });
});

describe('CRLF', () => {
  it('writes the same change, and every order reads alike', () => {
    const rows = [
      '| a | b |',
      '| - | - |',
      '| o<!--ins k3x9-->n<!--/k3x9-->e | alpha |',
      '| two | beta |',
    ];
    const text = file(rows.join('\n'), { k3x9: 'bo' }).replace(/\n/g, '\r\n');
    for (const op of [BOLD, ITALIC]) {
      const after = expectWritten(
        'crlf',
        text,
        [
          [0, 1],
          [1, 1],
          [2, 1],
        ],
        op,
      );
      expect(after).not.toMatch(/(?<!\r)\n/);
      expect(marksOf(after)).toBe(3);
    }
  });
});

describe('a table without outer pipes', () => {
  // A header and delimiter row without pipes at their edges, and rows with them.
  const mixed = file(
    ['a | b<!--ins k3x9-->c<!--/k3x9-->', '--- | ---', '| one | alpha |', '| two | beta |'].join(
      '\n',
    ),
    { k3x9: 'bo' },
  );
  const bare = file(['a | b', '--- | ---', 'one | alpha', 'two | beta'].join('\n'));

  it('formats the cells of rows that have a leading pipe, beside a mark in the header', () => {
    expectWritten('body cells', mixed, [
      [1, 1],
      [2, 1],
    ]);
  });

  it('is written as a replacement of the table, for a row that has no leading pipe', () => {
    for (const cells of [
      [[1, 1]],
      [[1, 0]],
      [[0, 0]],
      [
        [1, 0],
        [2, 1],
      ],
    ] as const) {
      expectWritten(`bare ${JSON.stringify(cells)}`, bare, cells);
    }
    // Beside another person's change in the table.
    expectWritten('mixed header', mixed, [[0, 0]]);
  });
});

describe('rows and columns pending in the table', () => {
  const plain = file(
    [
      '| a | b | c |',
      '| - | - | - |',
      '| 11 | 12 | 13 |',
      '| 21 | 22 | 23 |',
      '| 31 | 32 | 33 |',
    ].join('\n'),
  );
  const edit = (text: string, op: TableOp, who: Person, ids: string[]) =>
    applyChanges(text, tableEdit(text, op, context(who, ids)).changes);

  it('formats cells beside a moved row, and widens a cell of the moved row', () => {
    const moved = edit(plain, { kind: 'moveRows', table: 0, rows: [1], to: 3 }, bo, [
      'k3x9',
      'm2bd',
    ]);
    // The oracle leaves out the pending row: the space after its marker is a cell's text for it.
    expectWritten(
      'beside a moved row',
      moved,
      [
        [1, 1],
        [3, 1],
      ],
      BOLD,
      false,
    );
    // A cell of the moved row is a replacement of the table.
    const wide = over(moved, [[2, 1]]);
    expect(wide.refusal).toBeUndefined();
    expectEveryOrderRead('a moved row', wide.after ?? '');
  });

  it('formats cells in the other columns of a deleted or a moved one', () => {
    const deleted = edit(plain, { kind: 'deleteCols', table: 0, cols: [1] }, bo, ['k3x9']);
    expectWritten(
      'beside a deleted column',
      deleted,
      [
        [1, 0],
        [2, 0],
      ],
      BOLD,
      false,
    );
    expectWritten(
      'in the column after it',
      deleted,
      [
        [1, 1],
        [3, 1],
      ],
      ITALIC,
      false,
    );
    const shifted = edit(plain, { kind: 'moveCols', table: 0, cols: [0], to: 2 }, bo, [
      'k3x9',
      'm2bd',
    ]);
    expectWritten(
      'beside a moved column',
      shifted,
      [
        [1, 0],
        [2, 2],
      ],
      BOLD,
      false,
    );
    // The cells of the moved column below its header take it too: only the header holds the marker.
    expectWritten(
      'in a moved column',
      shifted,
      [
        [1, 1],
        [2, 1],
      ],
      ITALIC,
      false,
    );
    const wide = over(shifted, [[0, 1]]);
    expect(wide.refusal).toBeUndefined();
    expectEveryOrderRead('a moved column header', wide.after ?? '');
  });

  it('formats cells beside an inserted row', () => {
    const rowed = edit(plain, { kind: 'insertRows', table: 0, after: 1, count: 1 }, bo, ['k3x9']);
    expectWritten(
      'beside a row of Bo’s',
      rowed,
      [
        [1, 1],
        [3, 1],
      ],
      BOLD,
      false,
    );
  });
});

// A tracked alignment change is one mark at the end of the header's last cell (format §3.7, #281). Its
// decisions only take the mark away and write the delimiter row, so it can't change how the cell's
// syntax reads, and it doesn't keep the cell from being formatted: bold over the last header cell, or
// over the whole header row, is written in front of the mark, and every order of decisions reads alike.
describe('a pending alignment change in the header', () => {
  const OLD = encodeValue('| - | - | - |');
  const MARK = `<!--fmt k3x9 align=${OLD}-->`;
  /** Bo's change: Count centered. The mark ends the text of the last header cell. */
  const POINT = file(`| a | b | c${MARK} |\n| - | :-: | - |\n| 11 | 12 | 13 |\n| 21 | 22 | 23 |`, {
    k3x9: 'bo',
  });
  const HEADER = [
    [0, 0],
    [0, 1],
    [0, 2],
  ] as const;

  /** The file after `op` over the cells, in every order of decisions, with no decision refused. */
  function expectFormatted(
    label: string,
    text: string,
    op: FormatOp,
    cells: readonly (readonly [number, number])[] = HEADER,
  ) {
    const after = expectWritten(label, text, cells, op);
    expect(problemsOf(parse(after)), label).toEqual([]);
    expect(
      parse(after).marks.map((mark) => mark.id),
      label,
    ).toContain('k3x9');
    expect(expectNoDecisionRefused(label, after), label).toBeGreaterThan(2);
    return after;
  }

  it('does not keep the last header cell from being made bold or italic, and writes the mark last', () => {
    for (const op of [BOLD, ITALIC]) {
      const after = expectFormatted(`last header cell ${op.kind}`, POINT, op, [[0, 2]]);
      // One range, as `trackedFormat` has it, is the same change.
      const range = cellsAt(POINT, [[0, 2]])[0] ?? { from: 0, to: 0 };
      expect(applyChanges(POINT, trackedFormat(POINT, range, op, context(ada, IDS)).changes)).toBe(
        after,
      );
      expect(after).toMatch(
        /<!--fmt \w{4} \+(?:bold|italic)-->[*_]+c[*_]+<!--\/\w{4}--><!--fmt k3x9/,
      );
    }
  });

  it('does not keep the whole header row from being formatted, one change for each cell', () => {
    for (const op of [BOLD, ITALIC]) {
      const after = expectFormatted(`header row ${op.format}`, POINT, op);
      expect(marksOf(after), op.kind).toBe(4);
    }
  });

  it('does not keep a plain bold over the last header cell or the whole header row', () => {
    for (const [name, cells] of [
      ['the last header cell', [[0, 2]]],
      ['the header row', HEADER],
    ] as const) {
      // One after the other from the last, as the editor does with Track Changes off.
      let after = POINT;
      for (const range of cellsAt(POINT, cells).toReversed()) {
        after = applyChanges(after, untrackedFormat(after, range, BOLD, { author: ada }));
      }
      expect(after, name).toMatch(/\*\*c\*\*<!--fmt k3x9/);
      expect(problemsOf(parse(after)), name).toEqual([]);
      expectEveryOrderAlike(name, after, exactly);
      expectEveryOrderRead(name, after);
      expect(expectNoDecisionRefused(name, after), name).toBeGreaterThan(1);
    }
  });

  it('does not keep a comment over all the text of the header row, which ends in front of the mark', () => {
    const cells = cellsAt(POINT, HEADER);
    const range = { from: cells[0]?.from ?? 0, to: cells[2]?.to ?? 0 };
    const after = applyChanges(
      POINT,
      addComment(POINT, range, 'A note.', context(ada, IDS)).changes,
    );
    expect(after).toMatch(/<!--cmt \w{4}-->a \| b \| c<!--\/\w{4}--><!--fmt k3x9/);
    expectEveryOrderAlike('a comment over the header', after, exactly);
    expectEveryOrderRead('a comment over the header', after);
    expect(expectNoDecisionRefused('a comment over the header', after)).toBeGreaterThan(1);
  });

  it('formats the last header cell of a table the other person aligned, with the mark Ada’s', () => {
    // The same, the other way round: Bo bolds the cell that has Ada's mark.
    const text = file(POINT.split('\n\n<!-- redlines')[0] ?? '', { k3x9: 'ada' });
    const { changes } = trackedFormat(
      text,
      cellsAt(text, [[0, 2]])[0] ?? { from: 0, to: 0 },
      BOLD,
      context(bo, IDS),
    );
    const after = applyChanges(text, changes);
    expect(after).toMatch(/<!--fmt \w{4} \+bold-->\*\*c\*\*<!--\/\w{4}--><!--fmt k3x9/);
    expectEveryOrderAlike('bo bolds', after, exactly);
    expectEveryOrderRead('bo bolds', after);
    expect(expectNoDecisionRefused('bo bolds', after)).toBeGreaterThan(2);
  });
});
