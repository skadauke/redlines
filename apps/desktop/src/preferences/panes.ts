// The four panes of the Preferences window (design, Preferences): a few rows each, a label and a
// control, which apply at once. A pane holds only what the table in the design lists, and what the
// installed plugins contribute to it (`SettingContribution`); the Agents pane is filled by the
// agents' own code (`deps.agentsPane`).

import type { SettingContribution } from '@redlines/plugin-api';
import { THEMES, type ThemeName } from '@redlines/themes';
import { iconRotationLabel } from '../dock-icon.ts';
import { deriveHandle, toHandle } from '../handle.ts';
import type { AppearanceChoice, Settings } from '../settings.ts';
import { stepSize } from '../text-size.ts';

export type PaneId = 'general' | 'appearance' | 'editor' | 'agents';

/** The panes, left to right along the top, with the hint each icon shows. */
export const PANES: readonly { id: PaneId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'agents', label: 'Agents' },
];

/** Where the command line's link is, and whether its folder is on the shell's PATH. */
export interface CommandLineLink {
  linked: string;
  onPath: boolean;
}

/**
 * What installing the command line in /usr/local/bin did: linked it; or not, because macOS got no
 * administrator's password (the person cancelled, or couldn't give one), or for another reason that
 * `why` says. Either way the home folder is offered then.
 */
export type CommandLineInstall =
  | ({ outcome: 'linked' } & CommandLineLink)
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; why: string };

export interface PaneDeps {
  /** The settings as stored now. */
  settings: () => Settings;
  /** Changes some settings, at once. */
  update: (change: Partial<Settings>) => void;
  /** Who git says the person is, shown in the name and handle fields until they are set. */
  gitIdentity?: { name: string; handle: string };
  /**
   * Links the `redlines` command line in /usr/local/bin, where every shell finds it, and macOS asks
   * for an administrator if that folder needs one; rejects with a sentence that says why it
   * couldn't, as when somebody else's `redlines` is there.
   */
  installCommandLine: () => Promise<CommandLineInstall>;
  /** Links it in the home folder instead, which needs no administrator; rejects as above. */
  installCommandLineAtHome: () => Promise<CommandLineLink>;
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

/** Choices side by side, one of them taken: the system's radio buttons, each before its name. */
function choices<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
  change: (value: T) => void,
): HTMLElement {
  const group = el('div', 'rl-pref-choices');
  group.setAttribute('role', 'radiogroup');
  // One name, so that they are one group, which the arrow keys move in.
  const name = `rl-pref-choices-${nextId++}`;
  for (const option of options) {
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = option.value;
    input.checked = option.value === value;
    input.addEventListener('change', () => change(option.value));
    const label = el('label', 'rl-pref-choice');
    label.append(input, option.label);
    group.append(label);
  }
  return group;
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
  // Both fields empty go back to git's. A handle is what the format allows (it is written back to
  // the field when the person leaves it); one that isn't, or none, comes from the name. A handle
  // typed with no name goes with git's name.
  const save = () => {
    const typedName = name.value.trim();
    const typedHandle = handle.value.trim();
    if (!typedName && !typedHandle) return update({ identity: null });
    const who = typedName || deps.gitIdentity?.name || typedHandle;
    update({ identity: { name: who, handle: toHandle(typedHandle) || deriveHandle(who) } });
  };
  name.addEventListener('input', save);
  handle.addEventListener('input', save);
  handle.addEventListener('blur', () => {
    const saved = settings().identity;
    if (saved && handle.value.trim()) handle.value = saved.handle;
  });
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

  // Install links the command line in /usr/local/bin. Where that can't be, other than for somebody
  // else's `redlines` there, a second button offers the home folder.
  const status = el('div', 'rl-pref-note');
  status.setAttribute('role', 'status');
  const install = el('button', 'rl-pref-button', 'Install');
  install.type = 'button';
  const atHome = el('button', 'rl-pref-button', 'Install in Your Home Folder');
  atHome.type = 'button';
  atHome.hidden = true;
  const say = (text: string, failed: boolean) => {
    status.classList.toggle('rl-pref-failure', failed);
    status.textContent = text;
  };
  const sayLinked = ({ linked, onPath }: CommandLineLink) =>
    say(
      onPath
        ? `Linked at ${linked}, so redlines now works in a new Terminal window.`
        : `Linked at ${linked}. Its folder isn’t on your PATH yet.`,
      false,
    );
  /** Runs one of the two with both buttons off. Says a refusal; gives back what it did otherwise. */
  const attempt = async <T>(linking: () => Promise<T>): Promise<T | undefined> => {
    install.disabled = atHome.disabled = true;
    say('', false);
    try {
      return await linking();
    } catch (error) {
      say(error instanceof Error ? error.message : String(error), true);
      return undefined;
    } finally {
      install.disabled = atHome.disabled = false;
    }
  };
  /**
   * Gives the focus back once a wait is over. A button loses it while it is disabled, as both are
   * while one waits, and when it is hidden. It goes back to the button that was pressed, or to
   * Install once that is gone, and never away from where the person put it meanwhile.
   */
  const refocus = (pressed: HTMLButtonElement) => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== pressed) return;
    (pressed.hidden ? install : pressed).focus();
  };
  install.addEventListener('click', () => {
    void attempt(deps.installCommandLine).then((result) => {
      atHome.hidden = result?.outcome !== 'cancelled' && result?.outcome !== 'failed';
      switch (result?.outcome) {
        case 'linked':
          sayLinked(result);
          break;
        case 'cancelled':
          say(
            'The command line wasn’t installed: /usr/local/bin needs an administrator’s password.',
            true,
          );
          break;
        case 'failed':
          say(result.why, true);
          break;
      }
      refocus(install);
    });
  });
  atHome.addEventListener('click', () => {
    void attempt(deps.installCommandLineAtHome).then((linked) => {
      if (linked) {
        atHome.hidden = true;
        sayLinked(linked);
      }
      refocus(atHome);
    });
  });
  const command = el('div', 'rl-pref-inline');
  command.append(install, atHome);

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
  // Light or dark for every window, and one theme for both (design §6.6).
  const lightOrDark = choices<AppearanceChoice>(
    [
      { value: 'system', label: 'Match System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
    current.appearance,
    (value) => update({ appearance: value }),
  );
  const themes = THEMES.map(({ name, label }) => ({ value: name, label }));
  const theme = choice<ThemeName>(themes, current.theme, (value) => update({ theme: value }));

  let size = current.textSize;
  const value = el('span', 'rl-pref-size');
  value.setAttribute('aria-live', 'polite');
  const smaller = el('button', 'rl-pref-button rl-pref-step', '−');
  const larger = el('button', 'rl-pref-button rl-pref-step', '+');
  smaller.type = larger.type = 'button';
  smaller.setAttribute('aria-label', 'Smaller');
  larger.setAttribute('aria-label', 'Larger');
  const show = () => {
    value.textContent = `${Math.round(size * 100)}%`;
    smaller.disabled = stepSize(size, -1) === size;
    larger.disabled = stepSize(size, 1) === size;
  };
  // The ladder ⌘+ and ⌘− walk (text-size.ts).
  const move = (by: number) => {
    size = stepSize(size, by);
    show();
    update({ textSize: size });
  };
  smaller.addEventListener('click', () => move(-1));
  larger.addEventListener('click', () => move(1));
  show();
  const stepper = el('div', 'rl-pref-inline');
  stepper.setAttribute('role', 'group');
  stepper.append(smaller, value, larger);

  return [row('Appearance', lightOrDark), row('Theme', theme), row('Text size', stepper)];
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
