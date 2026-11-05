// The Preferences window: four panes, reached by icons along the top. Every change is saved at once
// to the settings every window of the app shares (settings.ts), and the app's windows follow it
// through the `storage` event, so there is nothing to save and nothing to close for it to apply.

import { applyTheme, type Appearance } from '@redlines/themes';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { reportIconRotation } from '../dock-icon.ts';
import { createHost } from '../host.ts';
import {
  currentAppearance,
  loadSettings,
  themeFor,
  updateSettings,
  watchAppearance,
  watchSettings,
  type Settings,
} from '../settings.ts';
import { icon } from '../ui/icons.ts';
import { PANES, renderPane, type PaneDeps, type PaneId } from './panes.ts';
import '@redlines/themes/fonts.css';
import '@redlines/themes/tokens.css';
import './preferences.css';

const isTauri = '__TAURI_INTERNALS__' in window;

let settings = loadSettings();
let appearance: Appearance = currentAppearance();
const showTheme = () =>
  applyTheme(document.documentElement, themeFor(settings, appearance), appearance);
showTheme();
watchAppearance((next) => {
  appearance = next;
  showTheme();
});

const plugins = {
  /** Settings that plugins contribute, kept apart from the app's own. */
  key: 'redlines.plugin-settings',
  read(): Record<string, boolean | number | string> {
    try {
      return JSON.parse(localStorage.getItem(this.key) ?? '{}') as Record<string, never>;
    } catch {
      return {};
    }
  },
};

const git = await createHost()
  .identity()
  .then(({ name, handle }) => ({ name, handle }))
  .catch(() => undefined);

const deps: PaneDeps = {
  settings: () => settings,
  update: (change: Partial<Settings>) => {
    const before = settings;
    settings = updateSettings(change);
    showTheme();
    if (settings.rotateIcon !== before.rotateIcon) reportIconRotation(settings.rotateIcon);
  },
  gitIdentity: git,
  installCommandLine: async () => {
    if (!isTauri) throw new Error('The command line is installed from the app.');
    try {
      return await invoke<{ linked: string; onPath: boolean }>('install_command_line');
    } catch (error) {
      throw new Error(String(error), { cause: error });
    }
  },
  // No plugin contributes a setting yet; when one does, its values are kept here.
  contributions: [],
  pluginValue: (id) => plugins.read()[id],
  setPluginValue: (id, value) => {
    try {
      localStorage.setItem(plugins.key, JSON.stringify({ ...plugins.read(), [id]: value }));
    } catch {
      // Storage can be full or switched off; the value then lasts until the window closes.
    }
  },
};

// Another window changed a setting, such as the theme: this one follows.
watchSettings((next) => {
  settings = next;
  showTheme();
  // The main window saves the last document at every change of its file. Redrawing the pane while
  // someone types their name would take the caret away, so what is being edited is left alone.
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLSelectElement)) show(current);
});

const tabs = document.querySelector<HTMLElement>('.rl-pref-tabs');
const pane = document.querySelector<HTMLElement>('#pane');
if (!tabs || !pane) throw new Error('preferences.html has no tabs or pane');

const buttons = new Map<PaneId, HTMLButtonElement>();
let current: PaneId = 'general';
let tidy = () => {};

function show(id: PaneId): void {
  current = id;
  tidy();
  tidy = renderPane(id, pane!, deps);
  for (const [other, button] of buttons) {
    const selected = other === id;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  pane!.setAttribute('aria-labelledby', `rl-pref-tab-${id}`);
}

const ICONS = {
  general: 'general',
  appearance: 'appearance',
  editor: 'editor',
  agents: 'agents',
} as const;
for (const { id, label } of PANES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rl-pref-tab';
  button.id = `rl-pref-tab-${id}`;
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-label', label);
  button.dataset['hint'] = label;
  button.append(icon(ICONS[id], 20));
  const hint = document.createElement('span');
  hint.className = 'rl-pref-hint';
  hint.setAttribute('aria-hidden', 'true');
  hint.textContent = label;
  button.append(hint);
  button.addEventListener('click', () => show(id));
  // The arrow keys move between the panes, as in any row of tabs.
  button.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (PANES.findIndex((p) => p.id === id) + step + PANES.length) % PANES.length;
    const next = PANES[index]!.id;
    show(next);
    buttons.get(next)?.focus();
  });
  buttons.set(id, button);
  tabs.append(button);
}
show('general');

if (isTauri) {
  // Shown once its font has loaded too, so that it never flashes another.
  await document.fonts.ready;
  await getCurrentWindow().show();
}
