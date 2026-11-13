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
  createDetectionProcesses,
  homeAccess,
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
import { applyZoom, followZoom, initialZoom, tauriZoomLink, type PageZoom } from '../zoom.ts';
import { takePaneRequest, watchPaneRequests } from './pane-request.ts';
import { createSetupRegistry } from './setup-registry.ts';
import {
  PANES,
  renderPane,
  showZoom,
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
/** The app's zoom, followed once the first pane is drawn; none in a browser. */
let zoom: PageZoom | null = null;

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

const deps: PaneDeps = {
  settings: () => settings,
  update: (change: Partial<Settings>) => {
    const before = settings;
    settings = updateSettings(change);
    theme.show(settings);
    if (settings.rotateIcon !== before.rotateIcon) reportIconRotation(settings.rotateIcon);
  },
  setZoom: (level) => {
    // In the app the zoom is the app's: it keeps the level, zooms every window and hears of it
    // back (zoom.ts). In a browser there is only the setting.
    if (zoom) void zoom.ask(level);
    else settings = updateSettings({ zoom: level });
  },
  gitIdentity: git,
  installCommandLine: () => installCommandLine<CommandLineInstall>('install_command_line'),
  installCommandLineAtHome: () =>
    installCommandLine<CommandLineLink>('install_command_line_at_home'),
  defaultApp: () => defaultAppCommand<DefaultApp>('default_app'),
  makeDefaultApp: () => defaultAppCommand<DefaultAppChange>('make_default_app'),
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
            }
          : {}),
      })),
      copy: copyText,
      // What macOS holds back from Redlines, asked when the person picks the home folder.
      ...(isTauri ? { homeAccess, openFilesAndFoldersSettings } : {}),
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
  if (!editing && !pane?.querySelector('[data-waiting]')) show(current);
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
// A window that asks for a pane (a failed run's line offers Preferences › Agents) is shown it, as
// it opens and while it is open.
show(takePaneRequest() ?? 'general');
watchPaneRequests((id) => show(id));

if (isTauri) {
  // The app zooms this window (and grows it) as the person's zoom changes anywhere; the stepper
  // shows the level then.
  zoom = await followZoom(tauriZoomLink(), {
    root: document.documentElement,
    win: window,
    level: initialZoom() ?? 1,
    settings: () => settings.zoom,
    save: (level) => {
      settings = updateSettings({ zoom: level });
    },
    after: () => {
      // Shown in place: drawing the pane again would take the focus from the button pressed and
      // replace the live region that says the new level.
      settings = loadSettings();
      showZoom(pane, settings.zoom);
    },
  }).catch((error: unknown) => {
    console.error('Could not follow the window zoom', error);
    return null;
  });
  // Shown once its font has loaded too, so that it never flashes another.
  await document.fonts.ready;
  await getCurrentWindow().show();
}
