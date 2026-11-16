// The sidebar's edge, which a person drags to resize it (#680). Dragged below `SIDEBAR_CLOSES_BELOW`
// the sidebar closes when the button is released, as ⌃⌘S does; between that and `SIDEBAR_MIN` it
// is held at the least. The width follows the pointer as it moves, and is kept when the pointer
// lets go (the window's own, main.ts). The arrow keys do the same from the keyboard.

/** The narrowest an open sidebar is, and the width the sidebar has until it is resized. */
export const SIDEBAR_MIN = 180;
export const SIDEBAR_DEFAULT = 240;
/** The widest it is. */
export const SIDEBAR_MAX = 480;
/** A drag that ends narrower than this closes the sidebar. */
export const SIDEBAR_CLOSES_BELOW = 120;
/** One press of an arrow key. */
const KEY_STEP = 16;

/** A stored width made right: a number in range, or the default. */
export function sidebarWidthOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SIDEBAR_DEFAULT;
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value)));
}

export interface SidebarResize {
  /** The width to draw: what the person has chosen, and between a drag's moves, its latest. */
  setWidth(width: number): void;
  destroy(): void;
}

export interface ResizeOptions {
  /** The sidebar, whose left edge is the drag's origin. */
  aside: HTMLElement;
  /** The page, which is told that a drag is on (`data-sidebar-drag`), so that it follows the pointer. */
  app: HTMLElement;
  /** The width is kept. */
  onResize(width: number): void;
  /** The drag ended below the minimum: close the sidebar. */
  onClose(): void;
}

export function createSidebarResize(options: ResizeOptions): SidebarResize {
  const { aside, app } = options;
  const handle = document.createElement('div');
  handle.className = 'rl-sidebar-resize';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Sidebar width');
  handle.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
  handle.setAttribute('aria-valuemax', String(SIDEBAR_MAX));
  handle.tabIndex = 0;
  handle.title = 'Drag to resize the sidebar. Drag it shut to close it';
  aside.append(handle);

  let width = SIDEBAR_DEFAULT;
  /** The width the pointer asks for during a drag, which may be under the minimum. */
  let dragging: number | null = null;

  const draw = (px: number) => {
    aside.style.setProperty('--rl-sidebar-width', `${Math.max(0, Math.round(px))}px`);
  };
  const setWidth = (next: number) => {
    width = sidebarWidthOf(next);
    handle.setAttribute('aria-valuenow', String(width));
    if (dragging === null) draw(width);
  };

  const widthAt = (clientX: number) => clientX - aside.getBoundingClientRect().left;

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    dragging = widthAt(event.clientX);
    app.dataset['sidebarDrag'] = '';
  };
  const move = (event: PointerEvent) => {
    if (dragging === null) return;
    dragging = Math.min(SIDEBAR_MAX, widthAt(event.clientX));
    // Held at the minimum until it is dragged well past it, where it follows into the edge.
    draw(dragging < SIDEBAR_CLOSES_BELOW ? dragging : Math.max(SIDEBAR_MIN, dragging));
  };
  const end = (event: PointerEvent) => {
    if (dragging === null) return;
    const last = dragging;
    dragging = null;
    delete app.dataset['sidebarDrag'];
    handle.releasePointerCapture?.(event.pointerId);
    if (event.type === 'pointercancel') return draw(width);
    if (last < SIDEBAR_CLOSES_BELOW) {
      // The width it had stays what is kept; the sidebar closes and opens at it again.
      draw(width);
      options.onClose();
      return;
    }
    const next = sidebarWidthOf(last);
    setWidth(next);
    options.onResize(next);
  };
  const key = (event: KeyboardEvent) => {
    const by = event.key === 'ArrowLeft' ? -KEY_STEP : event.key === 'ArrowRight' ? KEY_STEP : 0;
    if (by === 0 || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const next = sidebarWidthOf(width + by);
    if (next === width) return;
    setWidth(next);
    options.onResize(next);
  };

  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', key);
  setWidth(width);

  return {
    setWidth,
    destroy() {
      delete app.dataset['sidebarDrag'];
      handle.remove();
    },
  };
}
