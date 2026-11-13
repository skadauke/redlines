// The width of the page's scrollbar, which the title bar floating over the top of the page stops
// short of: a classic scrollbar would otherwise run under it, and its top could not be reached. An
// overlay scrollbar, which the Mac draws over the page and takes no room for, is 0 wide.

/**
 * Keeps `--rl-scrollbar` on `target` at the width of `scroller`'s scrollbar, as it changes (the
 * system switches between overlay and classic scrollbars when a mouse is plugged in). Returns a
 * function that stops following.
 */
export function followScrollbar(
  scroller: HTMLElement,
  target: HTMLElement,
  win: { ResizeObserver?: typeof ResizeObserver } = window,
): () => void {
  const apply = () =>
    target.style.setProperty('--rl-scrollbar', `${scroller.offsetWidth - scroller.clientWidth}px`);
  apply();
  // Its content box is what a scrollbar's coming or going changes.
  const observer = win.ResizeObserver ? new win.ResizeObserver(apply) : null;
  observer?.observe(scroller);
  return () => observer?.disconnect();
}
