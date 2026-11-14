// The small pieces the Agents pane draws with (apps/desktop/src/preferences/preferences.css has
// their classes): an element, a row of the pane with its label, a button, a text field.

/** An element with a class and a text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let nextId = 0;

/** An id no other element of the pane has. */
export function uniqueId(): string {
  return `rl-agents-${nextId++}`;
}

/** A row of the pane: its label, the control, and a note under it. */
export function row(label: string, control: HTMLElement, note?: HTMLElement): HTMLElement {
  const id = uniqueId();
  const root = el('div', 'rl-pref-row');
  root.dataset['row'] = label;
  const text = el('div', 'rl-pref-label', label);
  text.id = id;
  const field = el('div', 'rl-pref-control');
  field.append(control);
  if (note) field.append(note);
  control.setAttribute('aria-labelledby', id);
  root.append(text, field);
  return root;
}

export function button(text: string, label?: string): HTMLButtonElement {
  const node = el('button', 'rl-pref-button', text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

export function textField(label: string, placeholder: string): HTMLInputElement {
  const input = el('input', 'rl-pref-text');
  input.type = 'text';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  return input;
}

/** What went wrong, as a line to show. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
