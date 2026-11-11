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
 * The boundaries of a table's rows, as `y`s: the top of each row and the bottom of the last (so
 * `rows.length + 1` of them, boundary 0 above the header).
 */
export const boundariesOf = (rows: readonly RowEdges[]): number[] => [
  ...rows.map((row) => row.top),
  ...(rows.length > 0 ? [rows[rows.length - 1]?.bottom ?? 0] : []),
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
