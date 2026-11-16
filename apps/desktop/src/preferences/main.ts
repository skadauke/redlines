// The Preferences window: four panes, reached by icons along the top. Every change is saved at once
// to the settings every window of the app shares (settings.ts), and the app's windows follow it
// through the `storage` event, so there is nothing to save and nothing to close for it to apply.

import { createClaudeProvider } from '@redlines/agent-claude';
import { createCodexProvider } from '@redlines/agent-codex';
import { renderAgentsPane } from '@redlines/agents';
import type { AgentProvider, AgentState } from '@redlines/plugin-api';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { announceAgentsChanged } from '../agent-changes.ts';
import {
  agentSetup,
  agentSkills,
  createDetectionProcesses,
  homeAccess,
  openClawEdits,
  openFilesAndFoldersSettings,
} from '../agent-preferences.ts';
import { copyText } from '../copy-text.ts';
import { reportIconRotation } from '../dock-icon.ts';
import { currentIdentity } from '../identity.ts';
import { loadSettings, updateSettings, watchSettings, type Settings } from '../settings.ts';
import { ignorePinch } from '../text-size.ts';
import { icon } from '../ui/icons.ts';
import { setAppearance } from '../appearance-command.ts';
import { followTheme } from '../window-theme.ts';
import { applyZoom, followZoom, initialZoom, tauriZoomLink } from '../zoom.ts';
import { noRingOnClick } from './tabs.ts';
import { takePaneRequest, watchPaneRequests } from './pane-request.ts';
import { createSetupRegistry } from './setup-registry.ts';
import {
  PANES,
  buildFilterSections,
  renderFilter,
  type FilterSection,
  renderPane,
  type CommandLineInstall,
  type CommandLineLink,
  type DefaultApp,
  type DefaultAppChange,
  type PaneDeps,
  type PaneId,
} from './panes.ts';
import '@redlines/themes/fonts.css';
import '@redlines/themes/tokens.css';
import '../zoom.css';
import './preferences.css';

const isTauri = '__TAURI_INTERNALS__' in window;

let settings = loadSettings();
// The theme, and the window itself in its appearance, as in every window (window-theme.ts). The
// other windows' changes reach it by themselves; this one's are shown as it makes them.
const theme = followTheme(document.documentElement, settings, {
  ...(isTauri ? { setAppearance } : {}),
});

// The window zoom the app handed this page, before anything draws (zoom.ts).
applyZoom(document.documentElement, initialZoom() ?? 1);

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

const git = await currentIdentity()
  .then(({ name, handle }) => ({ name, handle }))
  .catch(() => undefined);

// The agents are asked about when the Agents pane opens, never at launch (agentsPane below). An
// answer is kept while the pane stays open, so that redrawing it for a changed setting asks nothing
// again; leaving the pane forgets it, and coming back asks anew, as after signing in. Check Again,
// and the look after an update or a sign-in, ask the program afresh.
const processes = createDetectionProcesses();
const providers: AgentProvider[] = [
  createClaudeProvider(processes),
  createCodexProvider(processes),
];
const detections = new Map<string, Promise<AgentState>>();
// The updates and sign-ins asked of the app go on when the pane is drawn again, as it is whenever
// another window changes a setting: a row drawn then follows what is under way. When one ends, what
// was found is stale, and the document windows, which keep it for a minute, are told.
const setups = createSetupRegistry((id) => {
  detections.delete(id);
  announceAgentsChanged();
});

/**
 * Runs one of the app's commands for a row of the General pane; its refusal is the row's line.
 * Outside the app, in a plain browser, `outside` is.
 */
async function appCommand<T>(
  command: string,
  outside: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri) throw new Error(outside);
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

const installCommandLine = <T>(command: string) =>
  appCommand<T>(command, 'The command line is installed from the app.');
const defaultAppCommand = <T>(command: string) =>
  appCommand<T>(command, 'The default app is set from the app.');

/**
 * Whether there is a Quick Look preview to turn off: only the app can say (quick_look.rs: it runs
 * from a bundle that holds the extension, on a macOS that loads it), and a plain browser has none.
 */
const hasQuickLook = isTauri && (await invoke<boolean>('quick_look_available').catch(() => false));

const deps: PaneDeps = {
  settings: () => settings,
  update: (change: Partial<Settings>) => {
    const before = settings;
    settings = updateSettings(change);
    theme.show(settings);
    if (settings.rotateIcon !== before.rotateIcon) reportIconRotation(settings.rotateIcon);
  },
  gitIdentity: git,
  installCommandLine: () => installCommandLine<CommandLineInstall>('install_command_line'),
  installCommandLineAtHome: () =>
    installCommandLine<CommandLineLink>('install_command_line_at_home'),
  defaultApp: () => defaultAppCommand<DefaultApp>('default_app'),
  makeDefaultApp: () => defaultAppCommand<DefaultAppChange>('make_default_app'),
  // The app's refusal is a string, which the row shows as it is.
  ...(hasQuickLook
    ? { openQuickLookSettings: () => invoke<void>('open_quick_look_settings') }
    : {}),
  // The app shows the panel, a sheet of this window, and hands back only the folder's path.
  chooseFolder: (start) =>
    appCommand<string | null>('choose_folder', 'Folders are chosen in the app.', { start }),
  agentsPane: (container) =>
    renderAgentsPane(container, {
      agents: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        detect: (fresh?: boolean) => {
          if (fresh) detections.delete(provider.id);
          const kept = detections.get(provider.id) ?? provider.detect();
          detections.set(provider.id, kept);
          // A look the person asked for may have found the agent changed under the documents too.
          if (fresh)
            void kept.then(
              () => announceAgentsChanged(),
              () => {},
            );
          return kept;
        },
        // The app updates and signs in an agent with its own command, for the agent named and
        // nothing more; in a plain browser there is no app to ask.
        ...(isTauri
          ? {
              update: () => setups.track(provider.id, 'update', agentSetup.update(provider.id)),
              signIn: () => setups.track(provider.id, 'sign-in', agentSetup.signIn(provider.id)),
              signInInTerminal: () => agentSetup.signInInTerminal(provider.id),
              stop: () => agentSetup.stop(provider.id),
              running: () => setups.running(provider.id),
              // The skill that teaches the agent Redlines files, in the folder it reads skills
              // from. OpenClaw reads Codex's folder too.
              skill: {
                status: () => agentSkills.status(provider.id),
                install: () => agentSkills.install(provider.id),
                ...(provider.id === 'codex' ? { alsoReadBy: 'OpenClaw' } : {}),
              },
            }
          : {}),
      })),
      copy: copyText,
      // The command line is installed in General, which the skill needs.
      showGeneral: () => show('general'),
      // What macOS holds back from Redlines, asked when the person picks the home folder.
      ...(isTauri ? { homeAccess, openFilesAndFoldersSettings } : {}),
      // The agents of an OpenClaw Gateway, added here (the Other agents row stays off), and the
      // skill for an OpenClaw on this Mac.
      ...(isTauri
        ? {
            openclaw: {
              ...openClawEdits,
              skill: {
                status: () => agentSkills.status('openclaw'),
                install: () => agentSkills.install('openclaw'),
              },
            },
          }
        : {}),
      // No `others`: the row of other agents (Agent Client Protocol) stays off until it works.
      settings: () => settings,
      update: (change) => deps.update(change),
      openLogs: async () => {
        if (!isTauri) throw new Error('The logs are opened from the app.');
        await invoke('agent_logs_open');
      },
    }),
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

// There is no text to zoom here: a pinch does nothing, and the page doesn't magnify.
ignorePinch(window);

// Another window changed a setting: this one follows, as its theme does by itself.
watchSettings((next) => {
  settings = next;
  // The main window saves the last document at every change of its file. Redrawing the pane while
  // someone types their name would take the caret away, so what is being edited is left alone, and
  // so is a row that waits for the system's panel to answer, which the redrawn row couldn't hear.
  const active = document.activeElement;
  const editing = active instanceof HTMLInputElement || active instanceof HTMLSelectElement;
  if (!editing && !pane?.querySelector('[data-waiting]')) {
    if (filter.hidden) show(current);
    else showFilter(true);
  }
});

const tabs = document.querySelector<HTMLElement>('.rl-pref-tabs');
const pane = document.querySelector<HTMLElement>('#pane');
if (!tabs || !pane) throw new Error('preferences.html has no tabs or pane');

const buttons = new Map<PaneId, HTMLButtonElement>();
let current: PaneId = 'general';
let tidy = () => {};

function show(id: PaneId): void {
  if (id !== current) detections.clear();
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
  button.append(icon(ICONS[id], 20), label);
  noRingOnClick(button);
  button.addEventListener('click', () => {
    clearFilter();
    show(id);
  });
  button.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (PANES.findIndex((p) => p.id === id) + step + PANES.length) % PANES.length;
    const next = PANES[index]!.id;
    clearFilter();
    show(next);
    buttons.get(next)?.focus();
  });
  buttons.set(id, button);
  tabs.append(button);
}

// The filter: not there until a key is typed with nothing to type in; then it holds that key and
// shows the matching rows of every pane, each under its pane and section. Escape clears it.
const filter = document.createElement('input');
filter.type = 'search';
filter.className = 'rl-pref-filter';
filter.placeholder = 'Filter';
filter.setAttribute('aria-label', 'Filter');
filter.autocomplete = 'off';
filter.spellcheck = false;
filter.hidden = true;
pane.before(filter);
/** The rows of every pane, built once for a filter, so that a keystroke redraws none of them. */
let built: FilterSection[] | null = null;
function showFilter(rebuild = false): void {
  for (const [id, button] of buttons) {
    button.setAttribute('aria-selected', 'false');
    // The tab of the pane the filter was opened from stays in the tab order.
    button.tabIndex = id === current ? 0 : -1;
  }
  tidy();
  tidy = () => {};
  if (rebuild || !built) {
    detections.clear();
    built = buildFilterSections(deps);
  }
  renderFilter(filter.value, pane!, deps, built);
  pane!.removeAttribute('aria-labelledby');
}
function clearFilter(): void {
  built = null;
  if (filter.hidden) return;
  filter.value = '';
  filter.hidden = true;
}
/** Back from the filter to the pane it was opened from, with the focus on its tab. */
function leaveFilter(): void {
  clearFilter();
  show(current);
  buttons.get(current)?.focus();
}
filter.addEventListener('input', () => {
  if (filter.value === '') leaveFilter();
  else showFilter();
});
filter.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  leaveFilter();
});
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.isComposing) return;
  // Escape clears the filter from a result's control too.
  if (event.key === 'Escape' && !filter.hidden) {
    event.preventDefault();
    leaveFilter();
    return;
  }
  // A first character, typed where nothing takes it: not a shortcut, not a control's own key (Space
  // presses a button), not a field's, and not while the filter is open.
  if (!filter.hidden || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key.length !== 1 || event.key === ' ') return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, button, a, [contenteditable], [role="button"]'))
  )
    return;
  event.preventDefault();
  filter.hidden = false;
  filter.value = event.key;
  filter.focus();
  showFilter();
});

show(takePaneRequest() ?? 'general');
watchPaneRequests((id) => {
  clearFilter();
  show(id);
});

if (isTauri) {
  // The app zooms this window (and grows it) as the person's zoom changes anywhere.
  await followZoom(tauriZoomLink(), {
    root: document.documentElement,
    win: window,
    level: initialZoom() ?? 1,
    settings: () => settings.zoom,
    save: (level) => {
      settings = updateSettings({ zoom: level });
    },
  }).catch((error: unknown) => {
    console.error('Could not follow the window zoom', error);
    return null;
  });
  // Shown once its font has loaded too, so that it never flashes another.
  await document.fonts.ready;
  await getCurrentWindow().show();
}
