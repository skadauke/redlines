import { describe, expect, it } from 'vitest';
import { move, type Position, type Shape } from './nav.ts';

// Ask, Insert (3 lines), Review (one line of two), Format (2 lines).
const shape: Shape = {
  bar: [-1, 0, 1, 2],
  menus: [[1, 1, 1], [2], [1, 1]],
};
const bar = (index: number): Position => ({ at: 'bar', index });
const item = (menu: number, row: number, column = 0): Position => ({
  at: 'item',
  menu,
  row,
  column,
});

describe('the arrow keys in the toolbar', () => {
  it('moves along the bar and around its ends, with no menu open', () => {
    expect(move(shape, bar(0), 'ArrowRight')).toEqual({ position: bar(1), open: null });
    expect(move(shape, bar(3), 'ArrowRight')).toEqual({ position: bar(0), open: null });
    expect(move(shape, bar(0), 'ArrowLeft')).toEqual({ position: bar(3), open: null });
  });

  it('opens a menu on ↓ or Return, at its first item; Ask opens none', () => {
    expect(move(shape, bar(2), 'ArrowDown')).toEqual({ position: item(1, 0), open: 1 });
    expect(move(shape, bar(1), 'Enter')).toEqual({ position: item(0, 0), open: 0 });
    expect(move(shape, bar(0), 'ArrowDown')).toBeNull();
    expect(move(shape, bar(0), 'Enter')).toBeNull();
  });

  it('moves by line with ↑ and ↓, around the ends', () => {
    expect(move(shape, item(0, 0), 'ArrowDown')?.position).toEqual(item(0, 1));
    expect(move(shape, item(0, 2), 'ArrowDown')?.position).toEqual(item(0, 0));
    expect(move(shape, item(0, 0), 'ArrowUp')?.position).toEqual(item(0, 2));
  });

  it('moves inside a paired line, and past its end switches menus', () => {
    expect(move(shape, item(1, 0, 0), 'ArrowRight')).toEqual({ position: item(1, 0, 1), open: 1 });
    // Past the end of Review: Format, at the start of its line.
    expect(move(shape, item(1, 0, 1), 'ArrowRight')).toEqual({ position: item(2, 0, 0), open: 2 });
    // Back from the start of Format: the end of Review's paired line.
    expect(move(shape, item(2, 0, 0), 'ArrowLeft')).toEqual({ position: item(1, 0, 1), open: 1 });
    // From the last menu, around to the first.
    expect(move(shape, item(2, 1, 0), 'ArrowRight')?.position).toEqual(item(0, 1, 0));
  });

  it('keeps the column on a shorter line', () => {
    const wide: Shape = { bar: [0], menus: [[2, 1]] };
    expect(move(wide, item(0, 0, 1), 'ArrowDown')?.position).toEqual(item(0, 1, 0));
  });

  it('has no answer for a key that is not its own', () => {
    expect(move(shape, item(0, 0), 'x')).toBeNull();
    expect(move(shape, bar(1), 'x')).toBeNull();
  });
});
