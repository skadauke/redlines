// The four panes of the Preferences window (design, Preferences): a few rows each, a label and a
// control, which apply at once. A pane holds only what the table in the design lists, and what the
// installed plugins contribute to it (`SettingContribution`); the Agents pane is filled by the
// agents' own code (`deps.agentsPane`).

import type { SettingContribution } from '@redlines/plugin-api';
import { THEMES, type ThemeName } from '@redlines/themes';
import { iconRotationLabel } from '../dock-icon.ts';
import { deriveHandle } from '../host.ts';
import type { Settings } from '../settings.ts';

export type PaneId = 'general' | 'appearance' | 'editor' | 'agents';

/** The panes, left to right along the top, with the hint each icon shows. */
export const PANES: readonly { id: PaneId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'agents', label: 'Agents' },
];

/** The text sizes the stepper goes through, as factors of the theme's own. */
export const TEXT_SIZES: readonly number[] = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2];

export interface PaneDeps {
  /** The settings as stored now. */
  settings: () => Settings;
  /** Changes some settings, at once. */
  update: (change: Partial<Settings>) => void;
  /** Who git says the person is, shown in the name and handle fields until they are set. */
  gitIdentity?: { name: string; handle: string };
  /** Links the `redlines` command line; rejects with a sentence that says why it couldn't. */
  installCommandLine: () => Promise<{ linked: string; onPath: boolean }>;
  /** Settings that plugins contribute, and where their values are kept. */
  contributions?: readonly SettingContribution[];
  pluginValue?: (id: string) => boolean | number | string | undefined;
  setPluginValue?: (id: string, value: boolean | number | string) => void;
  /** Fills the Agents pane; supplied with the agents. Returns a function that tidies it up. */
  agentsPane?: (container: HTMLElement) => void | (() => void);
}

type Control = HTMLElement;

let nextId = 0;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A row: its label on the left, its control on the right, and a quiet line under it if any. */
function row(label: string, control: Control, note?: HTMLElement): HTMLElement {
  const id = `rl-pref-${nextId++}`;
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

function toggle(checked: boolean, change: (value: boolean) => void): HTMLInputElement {
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => change(input.checked));
  return input;
}

function choice<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
  change: (value: T) => void,
): HTMLSelectElement {
  const select = el('select');
  for (const option of options) {
    const item = el('option', undefined, option.label);
    item.value = option.value;
    select.append(item);
  }
  select.value = value;
  select.addEventListener('change', () => change(select.value as T));
  return select;
}

function line(text: string, className = 'rl-pref-note'): HTMLElement {
  return el('div', className, text);
}

function general(deps: PaneDeps): HTMLElement[] {
  const { settings, update } = deps;
  const current = settings();
  const name = el('input', 'rl-pref-text');
  name.type = 'text';
  name.value = current.identity?.name ?? '';
  name.placeholder = deps.gitIdentity?.name ?? 'Your name';
  name.autocomplete = 'off';
  name.spellcheck = false;
  const handle = el('input', 'rl-pref-text rl-pref-handle');
  handle.type = 'text';
  handle.value = current.identity?.handle ?? '';
  handle.placeholder = deps.gitIdentity?.handle ?? 'handle';
  handle.autocomplete = 'off';
  handle.spellcheck = false;
  handle.setAttribute('aria-label', 'Handle');
  name.setAttribute('aria-label', 'Name');
  // Both fields empty go back to git's; a name alone gets the handle that goes with it.
  const save = () => {
    const typedName = name.value.trim();
    if (!typedName && !handle.value.trim()) return update({ identity: null });
    const typedHandle = deriveHandle(handle.value.trim() || typedName);
    if (typedName) update({ identity: { name: typedName, handle: typedHandle } });
  };
  name.addEventListener('input', save);
  handle.addEventListener('input', save);
  const identity = el('div', 'rl-pref-pair');
  identity.append(name, handle);

  const onLaunch = choice(
    [
      { value: 'new', label: 'Show a new document' },
      { value: 'reopen', label: 'Reopen the last document' },
    ],
    current.onLaunch,
    (value) => update({ onLaunch: value }),
  );

  const status = el('div', 'rl-pref-note');
  status.setAttribute('role', 'status');
  const install = el('button', 'rl-pref-button', 'Install');
  install.type = 'button';
  install.addEventListener('click', () => {
    install.disabled = true;
    status.classList.remove('rl-pref-failure');
    status.textContent = '';
    deps.installCommandLine().then(
      ({ linked, onPath }) => {
        install.disabled = false;
        status.textContent = onPath
          ? `Linked at ${linked}`
          : `Linked at ${linked}. Its folder isn’t on your PATH yet.`;
      },
      (error: unknown) => {
        install.disabled = false;
        status.classList.add('rl-pref-failure');
        status.textContent = error instanceof Error ? error.message : String(error);
      },
    );
  });
  const command = el('div', 'rl-pref-inline');
  command.append(install);

  return [
    row('Name and handle', identity, line('As they appear on your changes.')),
    row('On launch', onLaunch),
    row(
      'Check for updates automatically',
      toggle(current.checkForUpdates, (value) => update({ checkForUpdates: value })),
    ),
    row(
      iconRotationLabel(),
      toggle(current.rotateIcon, (value) => update({ rotateIcon: value })),
    ),
    row('Command line', command, status),
  ];
}

function appearance(deps: PaneDeps): HTMLElement[] {
  const { settings, update } = deps;
  const current = settings();
  const themes = THEMES.map(({ name, label }) => ({ value: name, label }));
  const light = choice<ThemeName>(themes, current.lightTheme, (value) =>
    update({ lightTheme: value }),
  );
  const dark = choice<ThemeName>(themes, current.darkTheme, (value) =>
    update({ darkTheme: value }),
  );

  // The step the text size is at; a size the ladder lacks takes the nearest.
  const nearest = (size: number) =>
    TEXT_SIZES.reduce(
      (best, step, i) => (Math.abs(step - size) < Math.abs(TEXT_SIZES[best]! - size) ? i : best),
      0,
    );
  let step = nearest(current.textSize);
  const value = el('span', 'rl-pref-size');
  value.setAttribute('aria-live', 'polite');
  const smaller = el('button', 'rl-pref-button rl-pref-step', '−');
  const larger = el('button', 'rl-pref-button rl-pref-step', '+');
  smaller.type = larger.type = 'button';
  smaller.setAttribute('aria-label', 'Smaller');
  larger.setAttribute('aria-label', 'Larger');
  const show = () => {
    value.textContent = `${Math.round(TEXT_SIZES[step]! * 100)}%`;
    smaller.disabled = step === 0;
    larger.disabled = step === TEXT_SIZES.length - 1;
  };
  const move = (by: number) => {
    step = Math.min(TEXT_SIZES.length - 1, Math.max(0, step + by));
    show();
    update({ textSize: TEXT_SIZES[step]! });
  };
  smaller.addEventListener('click', () => move(-1));
  larger.addEventListener('click', () => move(1));
  show();
  const size = el('div', 'rl-pref-inline');
  size.setAttribute('role', 'group');
  size.append(smaller, value, larger);

  return [row('Light theme', light), row('Dark theme', dark), row('Text size', size)];
}

function editing(deps: PaneDeps): HTMLElement[] {
  const { settings, update } = deps;
  const current = settings();
  return [
    row(
      'Spell check',
      toggle(current.spellCheck, (value) => update({ spellCheck: value })),
    ),
    row(
      'Smart quotes and dashes',
      toggle(current.smartPunctuation, (value) => update({ smartPunctuation: value })),
    ),
    row(
      'Close brackets and Markdown pairs',
      toggle(current.closePairs, (value) => update({ closePairs: value })),
    ),
    row(
      'Track Changes on for new documents',
      toggle(current.trackNewDocuments, (value) => update({ trackNewDocuments: value })),
    ),
  ];
}

/** The rows that installed plugins contribute to a pane. */
function contributed(pane: PaneId, deps: PaneDeps): HTMLElement[] {
  const { pluginValue, setPluginValue } = deps;
  if (!pluginValue || !setPluginValue) return [];
  return (deps.contributions ?? [])
    .filter((setting) => setting.pane === pane)
    .map((setting) => {
      const stored = pluginValue(setting.id) ?? setting.default;
      const note = setting.description ? line(setting.description) : undefined;
      if (typeof setting.default === 'boolean') {
        return row(
          setting.title,
          toggle(stored === true, (value) => setPluginValue(setting.id, value)),
          note,
        );
      }
      const input = el('input', 'rl-pref-text');
      const numeric = typeof setting.default === 'number';
      input.type = numeric ? 'number' : 'text';
      input.value = String(stored);
      input.addEventListener('input', () => {
        if (!numeric) return setPluginValue(setting.id, input.value);
        if (input.value !== '' && Number.isFinite(input.valueAsNumber)) {
          setPluginValue(setting.id, input.valueAsNumber);
        }
      });
      return row(setting.title, input, note);
    });
}

/**
 * Draws a pane in `container`, replacing what it held. Returns a function that tidies up what the
 * pane started, such as the agents' own.
 */
export function renderPane(pane: PaneId, container: HTMLElement, deps: PaneDeps): () => void {
  container.replaceChildren();
  container.dataset['pane'] = pane;
  const rows = { general, appearance, editor: editing, agents: () => [] }[pane](deps);
  container.append(...rows, ...contributed(pane, deps));
  if (pane !== 'agents') return () => {};
  if (deps.agentsPane) {
    const tidy = deps.agentsPane(container);
    return typeof tidy === 'function' ? tidy : () => {};
  }
  // Until the agents are found, there is nothing to show.
  container.append(line('No agents found.', 'rl-pref-empty'));
  return () => {};
}

/** The labels of the rows a pane holds, in order. */
export function rowLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('.rl-pref-row')].map(
    (found) => found.dataset['row'] ?? '',
  );
}
