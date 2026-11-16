// The palette's parts as page elements (issue #550): a search box and a list of lines in the card,
// in place of the bar's row while the person types. A line has an icon, what the command does, then
// its control or state, then its key in a column of its own. A setting's control is live in its line,
// and the palette stays open as it is used.

import { toolbarIcon } from './icons.ts';
import { type Control, type Entry, search } from './palette.ts';

export interface SearchDeps {
  /** The index, as it is now. */
  entries(): Entry[];
  /** What the last line says and does for a query, or null when the host can't ask. */
  ask: ((query: string) => Entry) | null;
  /** A line was chosen: a command or an app command with no control. */
  choose(entry: Entry): void;
  /** Esc: back to the bar. */
  leave(): void;
}

export interface Search {
  /** The elements to put in the card. */
  element: HTMLElement;
  input: HTMLInputElement;
  /** Puts the line's text back in step with the commands and settings: a switch somewhere else. */
  update(): void;
  /** The query, for a test. */
  query(): string;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
  const el = document.createElement(tag);
  el.className = className;
  return el;
};

/** A control as it is drawn in a line. */
function drawControl(control: Control, redraw: () => void): HTMLElement {
  if (control.kind === 'switch') {
    const track = element('span', 'rl-toolbar-switch');
    track.setAttribute('role', 'switch');
    track.setAttribute('aria-checked', String(control.get()));
    track.append(element('span', 'rl-toolbar-knob'));
    return track;
  }
  if (control.kind === 'choice') {
    const group = element('span', 'rl-toolbar-segments');
    group.setAttribute('role', 'radiogroup');
    const current = control.get();
    for (const option of control.options) {
      const segment = element('button', 'rl-toolbar-segment');
      segment.type = 'button';
      segment.tabIndex = -1;
      segment.setAttribute('role', 'radio');
      segment.setAttribute('aria-checked', String(option.value === current));
      segment.textContent = option.label;
      // The press leaves the keyboard in the search box.
      segment.addEventListener('mousedown', (event) => event.preventDefault());
      segment.addEventListener('click', (event) => {
        event.stopPropagation();
        control.set(option.value);
        redraw();
      });
      group.append(segment);
    }
    return group;
  }
  const wrap = element('span', 'rl-toolbar-slider');
  const range = element('input', 'rl-toolbar-range');
  range.type = 'range';
  range.min = String(control.min);
  range.max = String(control.max);
  range.step = String(control.step);
  range.value = String(control.get());
  range.tabIndex = -1;
  const value = element('span', 'rl-toolbar-value');
  const show = () => (value.textContent = (control.format ?? String)(control.get()));
  show();
  range.addEventListener('input', () => {
    control.set(Number(range.value));
    show();
  });
  range.addEventListener('click', (event) => event.stopPropagation());
  wrap.append(range, value);
  return wrap;
}

/** The search box and its lines, with `initial` typed in. */
export function drawSearch(initial: string, deps: SearchDeps): Search {
  const root = element('div', 'rl-toolbar-search');
  const field = element('div', 'rl-toolbar-field');
  const input = element('input', 'rl-toolbar-input');
  input.type = 'text';
  input.placeholder = 'Search commands and settings';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', 'Search commands and settings');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'rl-toolbar-results');
  input.setAttribute('aria-autocomplete', 'list');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = initial;
  field.append(toolbarIcon('search'), input);
  const list = element('div', 'rl-toolbar-results');
  list.id = 'rl-toolbar-results';
  list.setAttribute('role', 'listbox');
  root.append(field, list);

  let shown: Entry[] = [];
  let active = 0;

  const lineOf = (entry: Entry, index: number): HTMLElement => {
    const line = element('div', 'rl-toolbar-result');
    line.id = `rl-toolbar-result-${index}`;
    line.setAttribute('role', 'option');
    line.setAttribute('aria-selected', String(index === active));
    line.dataset['command'] = entry.id;
    const name = element('span', 'rl-toolbar-result-name');
    name.textContent = entry.name;
    const state = element('span', 'rl-toolbar-result-state');
    if (entry.control) {
      state.append(drawControl(entry.control, () => draw(false)));
    }
    const keys = element('span', 'rl-toolbar-keys rl-toolbar-result-keys');
    keys.textContent = entry.keys ?? '';
    line.append(toolbarIcon(entry.icon), name, state, keys);
    line.addEventListener('mousedown', (event) => {
      // A control keeps the pointer's press; the rest leaves the keyboard in the search box.
      if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    });
    line.addEventListener('click', () => activate(entry));
    line.addEventListener('pointermove', () => {
      if (active === index) return;
      active = index;
      mark();
    });
    return line;
  };

  const mark = () => {
    [...list.children].forEach((line, index) => {
      line.setAttribute('aria-selected', String(index === active));
      if (index === active) {
        input.setAttribute('aria-activedescendant', line.id);
        (line as HTMLElement).scrollIntoView?.({ block: 'nearest' });
      }
    });
  };

  /** Draws the lines for the query; with `reset`, from the first, else where the choice was. */
  function draw(reset: boolean): void {
    const query = input.value.trim();
    shown = search(deps.entries(), query);
    if (query && deps.ask) shown.push(deps.ask(query));
    active = reset ? 0 : Math.min(active, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map(lineOf));
    if (shown.length === 0) {
      const none = element('div', 'rl-toolbar-none-found');
      none.textContent = 'No commands or settings match.';
      list.append(none);
    }
    mark();
  }

  /** Return, or a click: a control is used in its line, and anything else is run. */
  function activate(entry: Entry): void {
    const control = entry.control;
    if (control?.kind === 'switch') {
      control.set(!control.get());
      draw(false);
    } else if (control?.kind === 'choice') {
      const at = control.options.findIndex((option) => option.value === control.get());
      const next = control.options[(at + 1) % control.options.length];
      if (next) control.set(next.value);
      draw(false);
    } else if (control) {
      // A slider has nothing to run: its arrows change it.
    } else deps.choose(entry);
  }

  /** ← and → change a choice or a slider in the chosen line. */
  function adjust(direction: 1 | -1): boolean {
    const control = shown[active]?.control;
    if (control?.kind === 'choice') {
      const at = control.options.findIndex((option) => option.value === control.get());
      const next = control.options[at + direction];
      if (next) control.set(next.value);
      draw(false);
      return true;
    }
    if (control?.kind === 'slider') {
      const value = Math.min(
        control.max,
        Math.max(control.min, control.get() + direction * control.step),
      );
      control.set(value);
      draw(false);
      return true;
    }
    return false;
  }

  input.addEventListener('input', () => draw(true));
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (shown.length > 0) {
          active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
          mark();
        }
        break;
      case 'Enter': {
        const entry = shown[active];
        if (entry) activate(entry);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          !adjust(event.key === 'ArrowRight' ? 1 : -1)
        )
          return;
        break;
      case 'Escape':
        deps.leave();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
  draw(true);
  return {
    element: root,
    input,
    update: () => draw(false),
    query: () => input.value,
  };
}
