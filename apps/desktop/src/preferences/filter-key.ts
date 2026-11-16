// Which key starts Preferences' filter (#678). A letter or a digit typed anywhere in the window
// opens the filter with it, whatever has the focus, except where the key is someone else's: a field
// that takes text (and an input method that is composing), a menu or a list box that picks by typing,
// a shortcut, and Space, which presses a button. A tab button or any other button gives its letters
// up: only Space and Return are its own.

/** The inputs that take no text, so that their keys are free. */
const NO_TEXT = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color']);

export function startsFilter(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.key === 'Process' ||
    event.keyCode === 229
  )
    return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key.length !== 1 || event.key === ' ') return false;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return true;
  if (
    target.isContentEditable ||
    target.closest(
      '[contenteditable], textarea, select, [role=menu], [role=listbox], [role=combobox], [role=textbox], [role=slider], [role=spinbutton]',
    )
  )
    return false;
  const input = target.closest('input');
  return !input || NO_TEXT.has(input.type);
}
