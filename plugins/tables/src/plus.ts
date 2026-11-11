// The + between rows (design: tables, "Grips and +"): within 8 px of a row boundary, in the strip to
// the left of the table, a + appears with a thin line across the table; a press inserts one row
// there. Pure geometry here, which the grips' layer draws.

/** How near a boundary the pointer has to be, in px. */
export const PLUS_REACH = 8;

/** The vertical extent of a row. */
export interface RowEdges {
  top: number;
  bottom: number;
}

/**
 * The boundaries of a table's rows, as `y`s: the top of the first, the middle of each gap between rows
 * and the bottom of the last (so
 * `rows.length + 1` of them, boundary 0 above the header).
 */
export const boundariesOf = (rows: readonly RowEdges[]): number[] =>
  rows.length === 0
    ? []
    : [
        rows[0]?.top ?? 0,
        // Between two rows, the middle of the gap their boxes leave (none, where they touch).
        ...rows.slice(1).map((row, i) => ((rows[i]?.bottom ?? 0) + row.top) / 2),
        rows[rows.length - 1]?.bottom ?? 0,
      ];

/** The boundary within `PLUS_REACH` of `y`, or null: 8 px away is near, 9 is not. */
export function plusBoundary(y: number, boundaries: readonly number[]): number | null {
  let found: number | null = null;
  let nearest = Infinity;
  boundaries.forEach((edge, index) => {
    const away = Math.abs(y - edge);
    if (away <= PLUS_REACH && away < nearest) {
      found = index;
      nearest = away;
    }
  });
  return found;
}

/** The horizontal extent of a column. */
export interface ColEdges {
  left: number;
  right: number;
}

/**
 * The boundaries of a table's columns, as `x`s: the left of the first, the middle of each gap between
 * columns and the right of the last (boundary 0 before the first column).
 */
export const colBoundariesOf = (cols: readonly ColEdges[]): number[] =>
  cols.length === 0
    ? []
    : [
        cols[0]?.left ?? 0,
        ...cols.slice(1).map((col, i) => ((cols[i]?.right ?? 0) + col.left) / 2),
        cols[cols.length - 1]?.right ?? 0,
      ];
