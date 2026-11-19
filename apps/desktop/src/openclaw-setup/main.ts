// The OpenClaw setup window: the steps that connect an agent on another computer (or on this Mac),
// in a window of its own, larger than Preferences and resizable. Preferences › Agents and the @
// picker open it (`open_openclaw_setup`); the app makes it hidden and it shows itself once its page
// is styled. The sheet is the one the Agents pane used to hold (plugins/agents/src/openclaw/
// sheet.ts), given what it asks of the app here; Cancel and Done close the window, and a window
// closed in the middle undoes what the sheet had begun.

import { openSheet, type SheetDeps, type SheetStep } from '@redlines/agents';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { copyText } from '../copy-text.ts';
import { currentIdentity } from '../identity.ts';
import { openClawConnections, openClawNode } from '../openclaw-commands.ts';
import { devGuided, failureGallery } from '../preferences/dev-openclaw.ts';
import { loadSettings } from '../settings.ts';
import { followTheme } from '../window-theme.ts';
import { gateway, openClawSetup, tailscale } from './commands.ts';
import '@redlines/themes/fonts.css';
import '@redlines/themes/tokens.css';
import '../zoom.css';
import '../preferences/preferences.css';
import '../preferences/openclaw-sheet.css';
import './setup.css';

const isTauri = '__TAURI_INTERNALS__' in window;

const settings = loadSettings();
// The theme and appearance the person picked, as in the app's windows (window-theme.ts). The app
// took the appearance before it opened this window (src-tauri/src/appearance.rs): this one has
// nothing to set.
followTheme(document.documentElement, settings, {});

const mount = document.getElementById('setup');
if (!mount) throw new Error('openclaw-setup.html has no #setup');

/** The agents Redlines runs itself, whose handles a connection can't take. */
const OWN_AGENTS = ['claude', 'codex'];

/** The handles of the connections that exist, for the sheet's check that a name is free. */
let connectionHandles: string[] = [];

async function appDeps(): Promise<SheetDeps> {
  const me =
    settings.identity?.handle ?? (await currentIdentity().catch(() => null))?.handle ?? 'me';
  const remember = <T extends { handle: string }[]>(list: T): T => {
    connectionHandles = list.map(({ handle }) => handle);
    return list;
  };
  await openClawConnections.list().then(remember, () => []);
  return {
    owner: me,
    taken: () => [...OWN_AGENTS.map((id) => `${id}-${me}`), ...connectionHandles],
    thisMac: openClawSetup.thisMac,
    tailscale: {
      status: tailscale.status,
      openApp: tailscale.openApp,
      download: tailscale.download,
      // Tailscale's own app opens its sign-in page, so no address passes through this window.
      signIn: tailscale.openApp,
    },
    probe: gateway.probe,
    copy: copyText,
    paste: () => navigator.clipboard.readText(),
    connections: {
      add: (connection) => openClawSetup.add(connection).then(remember),
      remove: (handle) => openClawConnections.remove(handle).then(remember),
      useToken: (handle, token) => openClawSetup.useToken(handle, token).then(remember),
    },
    node: openClawNode,
  };
}

const STEPS: readonly string[] = ['start', 'mac', 'computer', 'prompt', 'approve', 'test'];

async function run(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const dev = !isTauri && import.meta.env.DEV;
  if (dev && query.get('oc') === 'failures') {
    mount?.replaceChildren(failureGallery());
    return;
  }
  const screen = dev ? query.get('oc') : null;
  const deps: SheetDeps = dev ? devGuided(query) : await appDeps();
  const closeWindow = () => {
    if (isTauri) void getCurrentWindow().close();
  };
  const sheet = openSheet(deps, {
    alive: () => true,
    onClose: closeWindow,
    // The Agents pane of Preferences looks at the connections by itself.
    onChanged: () => {},
    ...(screen !== null && STEPS.includes(screen)
      ? {
          start: {
            step: screen as SheetStep,
            ...(query.get('where') === 'this-mac' ? { where: 'this-mac' as const } : {}),
            ...(screen === 'computer' || screen === 'prompt'
              ? { computer: 'studio-mini.yak-bebop.ts.net' }
              : {}),
            agent: query.get('agent') ?? (screen === 'approve' || screen === 'test' ? 'Moby' : ''),
          },
        }
      : {}),
  });
  mount?.append(sheet.element);
  if (isTauri) {
    // Closed in the middle (the window's own button, or ⌘W): what the sheet began is undone first,
    // and the window waits a moment for the app to have been told.
    const win = getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      event.preventDefault();
      sheet.dispose();
      await new Promise((done) => setTimeout(done, 250));
      await win.destroy();
    });
  }
}

await run();

if (isTauri) {
  // Shown once its font has loaded too, so that it never flashes another.
  await document.fonts.ready;
  await getCurrentWindow().show();
}
