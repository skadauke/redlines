/**
 * A press on a tab (a click) doesn't give it the keyboard's focus, so that no ring is left around
 * the tab that was clicked (#679). The click still selects the tab. Tab and the arrow keys bring the
 * focus to the tabs as before, and the ring shows then, for `:focus-visible` alone.
 */
export function noFocusOnPress(button: HTMLElement): void {
  button.addEventListener('mousedown', (event) => event.preventDefault());
}
