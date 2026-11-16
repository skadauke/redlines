/**
 * A tab that a click focused shows no focus ring (#679): the ring is for the keyboard. The tab
 * keeps the focus, so that the arrow keys go on from it, and is marked while the pointer put the
 * focus there; any key, or the focus leaving, takes the mark off, and the ring shows for the keys
 * again (`.rl-pref-tab[data-by-pointer]`, preferences.css).
 */
export function noRingOnClick(button: HTMLElement): void {
  const off = () => button.removeAttribute('data-by-pointer');
  button.addEventListener('mousedown', () => button.setAttribute('data-by-pointer', ''));
  button.addEventListener('keydown', off);
  button.addEventListener('blur', off);
}
