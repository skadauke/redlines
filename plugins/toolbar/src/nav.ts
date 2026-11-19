// How the arrow keys move in the toolbar, as pure functions of its shape, so that the rules are
// tested without a page (#504): ←/→ move along the bar; ↓ or Return opens a menu; ↑/↓ move by line
// in a menu; ←/→ move inside a paired row, and past its end they switch menus.

/** Where the keyboard is: on a button of the bar, or on an item of a menu. */
export type Position =
  { at: 'bar'; index: number } | { at: 'item'; menu: number; row: number; column: number };

/** The shape: what each button of the bar opens, and for each menu, the length of its rows. */
export interface Shape {
  /** For each button of the bar, the index of the menu it opens, or -1 (Ask opens none). */
  bar: readonly number[];
  menus: readonly (readonly number[])[];
}

interface Move {
  position: Position;
  /** The menu that is open after the move, by its index among the menus, or null. */
  open: number | null;
}

const wrap = (value: number, size: number) => (size === 0 ? 0 : (value + size) % size);

/** What a key does at `position`, or null when it is no key of the toolbar's. */
export function move(shape: Shape, position: Position, key: string): Move | null {
  if (position.at === 'bar') {
    const { index } = position;
    const menu = shape.bar[index] ?? -1;
    switch (key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        const next = wrap(index + (key === 'ArrowRight' ? 1 : -1), shape.bar.length);
        return { position: { at: 'bar', index: next }, open: null };
      }
      case 'Home':
        return { position: { at: 'bar', index: 0 }, open: null };
      case 'End':
        return { position: { at: 'bar', index: shape.bar.length - 1 }, open: null };
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        // Ask has no menu: Return presses it, which the page does.
        if (menu < 0 || !shape.menus[menu]?.length) return null;
        return { position: { at: 'item', menu, row: 0, column: 0 }, open: menu };
      default:
        return null;
    }
  }
  const { menu, row, column } = position;
  const rows = shape.menus[menu] ?? [];
  const step = (to: number): Move => ({
    position: {
      at: 'item',
      menu,
      row: to,
      column: Math.min(column, Math.max(0, (rows[to] ?? 1) - 1)),
    },
    open: menu,
  });
  const across = (direction: 1 | -1): Move | null => {
    const menus = shape.bar.filter((each) => each >= 0 && (shape.menus[each]?.length ?? 0) > 0);
    const next = menus[wrap(menus.indexOf(menu) + direction, menus.length)];
    if (next === undefined) return null;
    const there = shape.menus[next] ?? [];
    const landing = Math.min(row, there.length - 1);
    // From the left a menu is entered at the start of its line, and from the right at its end.
    const last = Math.max(0, (there[landing] ?? 1) - 1);
    return {
      position: { at: 'item', menu: next, row: landing, column: direction === 1 ? 0 : last },
      open: next,
    };
  };
  switch (key) {
    case 'ArrowDown':
      return step(wrap(row + 1, rows.length));
    case 'ArrowUp':
      return step(wrap(row - 1, rows.length));
    case 'ArrowRight':
      return column + 1 < (rows[row] ?? 0)
        ? { position: { ...position, column: column + 1 }, open: menu }
        : across(1);
    case 'ArrowLeft':
      return column > 0
        ? { position: { ...position, column: column - 1 }, open: menu }
        : across(-1);
    case 'Home':
      return { position: { at: 'item', menu, row: 0, column: 0 }, open: menu };
    case 'End':
      return step(rows.length - 1);
    default:
      return null;
  }
}

/** Where the keyboard goes when a menu closes: on its button. */
export function buttonOf(shape: Shape, menu: number): Position {
  return { at: 'bar', index: Math.max(0, shape.bar.indexOf(menu)) };
}
