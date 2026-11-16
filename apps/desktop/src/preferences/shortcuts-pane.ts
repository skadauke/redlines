// The Shortcuts pane of Preferences (#535): every command that can have a key, grouped by the menu
// that holds it, with its key. A click on the key records a new one (⌫ clears it, Esc cancels); a
// key that is another command's asks first, and a key macOS keeps is refused, each in the row
// itself. A Filter field narrows the list, and Reset All gives every command its own key again. All
// the rules are shortcuts.ts's, which the palette's recording shares; a change is kept in the
// settings, and every window follows it.

import {
  assess,
  assign,
  displayKey,
  explain,
  keyOf,
  recordKey,
  type ShortcutEntry,
  type ShortcutOverrides,
} from '../shortcuts.ts';
import type { PaneDeps } from './panes.ts';

/** What the row being changed is doing. */
type Recording =
  | { id: string; state: 'listen'; message?: string }
  /** The key is another command's: Replace takes it from it. */
  | { id: string; state: 'ask'; key: string; other: ShortcutEntry };

/** The Filter's text, kept while the pane is drawn again for a change made in another window. */
let keptQuery = '';

/** Forgets the Filter's text: the person left the pane. */
export function forgetShortcutsFilter(): void {
  keptQuery = '';
}

/** Words that match a command: its name, its menu and its key as drawn and as said. */
function haystack(entry: ShortcutEntry, key: string | null): string {
  return `${entry.title} ${entry.menu} ${key ? displayKey(key) : ''}`.toLowerCase();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Draws the pane in `container`. The commands are the published ones (`deps.shortcutEntries`), the
 * keys the settings'. Returns a function that tidies up the key listener of a recording.
 */
export function renderShortcutsPane(
  container: HTMLElement,
  deps: Pick<PaneDeps, 'settings' | 'update' | 'shortcutEntries'>,
): () => void {
  container.replaceChildren();
  container.dataset['pane'] = 'shortcuts';
  const entries = [...(deps.shortcutEntries?.() ?? [])];
  const overrides = (): ShortcutOverrides => deps.settings().shortcuts;
  const change = (next: ShortcutOverrides) => deps.update({ shortcuts: next });
  const keyNow = (id: string) => keyOf(entries, overrides(), id);

  if (!entries.length) {
    container.append(
      el('p', 'rl-pref-empty', 'Open a document first: its commands are listed here.'),
    );
    return () => {};
  }

  let query = keptQuery;
  let recording: Recording | null = null;

  const field = el('input', 'rl-pref-kfilter');
  field.type = 'search';
  field.placeholder = 'Filter';
  field.setAttribute('aria-label', 'Filter shortcuts');
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.value = query;
  const list = el('div', 'rl-pref-klist');
  const foot = el('div', 'rl-pref-kfoot');
  const reset = el('button', 'rl-pref-button', 'Reset All');
  reset.type = 'button';
  const resetNote = el('span', 'rl-pref-note');
  foot.append(reset, resetNote);
  container.append(field, list, foot);

  const stop = () => {
    recording = null;
    draw();
  };
  /** Gives the command the key, and ends the recording. */
  const give = (id: string, key: string | null) => {
    change(assign(entries, overrides(), id, key));
    recording = null;
    draw();
    // The focus stays where the person was: on the key they changed.
    list.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] .rl-pref-key`)?.focus();
  };

  const startRecording = (id: string) => {
    recording = { id, state: 'listen' };
    draw();
    list.querySelector<HTMLElement>('.rl-pref-krec')?.focus();
  };

  const recordingRow = (entry: ShortcutEntry, state: Recording): HTMLElement => {
    const box = el('span', 'rl-pref-krec');
    box.tabIndex = -1;
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `New shortcut for ${entry.title}`);
    if (state.state === 'listen') {
      box.setAttribute('aria-live', 'polite');
      box.append(
        el('span', 'rl-pref-kpulse', state.message ?? 'Type the new shortcut'),
        el('span', 'rl-pref-khint', 'Esc cancels · ⌫ clears'),
      );
      return box;
    }
    box.append(el('span', 'rl-pref-kpulse', `${displayKey(state.key)} is ${state.other.title}’s.`));
    const replace = el('button', 'rl-pref-button', 'Replace');
    replace.type = 'button';
    replace.title = `${state.other.title} is left with no shortcut`;
    replace.addEventListener('click', () => give(entry.id, state.key));
    const cancel = el('button', 'rl-pref-button', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', stop);
    box.append(replace, cancel);
    return box;
  };

  function draw(): void {
    list.replaceChildren();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = entries.filter((entry) => {
      const text = haystack(entry, keyNow(entry.id));
      return words.every((word) => text.includes(word));
    });
    // A recording whose row the filter hides ends: it would have nowhere to show.
    if (recording && !shown.some((entry) => entry.id === recording?.id)) recording = null;
    if (!shown.length) list.append(el('p', 'rl-pref-empty', 'Nothing matches.'));
    for (const menu of [...new Set(shown.map((entry) => entry.menu))]) {
      const group = el('section', 'rl-pref-group');
      const head = el('h2', 'rl-pref-section', menu);
      head.id = `rl-pref-kgroup-${menu.replace(/\W+/g, '-')}`;
      group.setAttribute('aria-labelledby', head.id);
      group.append(head);
      for (const entry of shown.filter((candidate) => candidate.menu === menu)) {
        const row = el('div', 'rl-pref-krow');
        row.dataset['row'] = entry.title;
        row.dataset['id'] = entry.id;
        row.append(el('span', 'rl-pref-kname', entry.title));
        const key = keyNow(entry.id);
        if (recording?.id === entry.id) {
          row.append(recordingRow(entry, recording));
        } else if (entry.locked) {
          const fixed = el('span', 'rl-pref-key rl-pref-key-fixed', key ? displayKey(key) : '');
          fixed.title = 'This shortcut can’t be changed';
          row.append(fixed);
        } else {
          const button = el('button', 'rl-pref-key', key ? displayKey(key) : 'Add key');
          button.type = 'button';
          if (!key) button.classList.add('rl-pref-key-empty');
          button.title = key ? 'Change the shortcut' : 'Add a shortcut';
          button.setAttribute(
            'aria-label',
            key
              ? `${entry.title}, ${displayKey(key)}. Change the shortcut`
              : `${entry.title}, no shortcut. Add a shortcut`,
          );
          button.addEventListener('click', () => startRecording(entry.id));
          row.append(button);
        }
        group.append(row);
      }
      list.append(group);
    }
    const changed = Object.keys(overrides()).length > 0;
    reset.disabled = !changed;
    reset.title = changed
      ? 'Give every command its own shortcut again'
      : 'Every command has its own shortcut';
    resetNote.textContent = changed ? '' : 'Every command has its own shortcut.';
  }

  /** While a key is being recorded, every key is the recorder's. */
  const onKey = (event: KeyboardEvent) => {
    if (!recording || event.isComposing) return;
    const state = recording;
    const own = entries.find((entry) => entry.id === state.id);
    if (!own) return;
    if (state.state === 'ask') {
      // Enter on Replace or Cancel is the button's own.
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        stop();
      } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        event.stopPropagation();
        give(state.id, state.key);
      }
      return;
    }
    const recorded = recordKey(event);
    if (recorded.kind === 'wait') {
      // A modifier alone is on its way to a key; any other key that can't be a shortcut is said.
      if (!/^(Shift|Meta|Control|Alt|CapsLock|Fn)/.test(event.code)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (recorded.kind === 'cancel') return stop();
    if (recorded.kind === 'clear') return give(state.id, null);
    const verdict = assess(entries, overrides(), state.id, recorded.key);
    switch (verdict.kind) {
      case 'same':
        return stop();
      case 'free':
        return give(state.id, recorded.key);
      case 'conflict':
        recording = { id: state.id, state: 'ask', key: recorded.key, other: verdict.with };
        draw();
        list.querySelector<HTMLElement>('.rl-pref-krec button')?.focus();
        return;
      default:
        // Refused: said where the key would have gone, and the recording goes on.
        recording = {
          id: state.id,
          state: 'listen',
          message: explain(verdict, recorded.key) ?? 'That key can’t be used.',
        };
        draw();
        list.querySelector<HTMLElement>('.rl-pref-krec')?.focus();
    }
  };
  window.addEventListener('keydown', onKey, true);
  // A click anywhere else leaves the recording, as Esc does.
  const onPointer = (event: PointerEvent) => {
    if (!recording) return;
    if (event.target instanceof Node && list.querySelector('.rl-pref-krec')?.contains(event.target))
      return;
    stop();
  };
  window.addEventListener('pointerdown', onPointer, true);

  field.addEventListener('input', () => {
    query = keptQuery = field.value;
    recording = null;
    draw();
  });
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !field.value) return;
    // Escape clears the field, as in the window's own filter.
    event.preventDefault();
    event.stopPropagation();
    field.value = '';
    query = keptQuery = '';
    draw();
  });
  reset.addEventListener('click', () => {
    change({});
    recording = null;
    draw();
  });

  draw();
  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
  };
}
