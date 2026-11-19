// What the setup does about Tailscale on this Mac, and what it says while it does it
// (docs/research/openclaw-connection.md, screen 2, and the Test Drive's script that this follows):
// install it (the package from Tailscale, checked and installed with macOS's own administrator
// prompt, or the App Store page), open it, wait for its network extension and say where to allow
// it, start the sign-in, and restart its app when the sign-in hangs or after a fresh install. This
// file decides; the sheet (sheet.ts) draws what it says and does what it asks, and the app does the
// work (src-tauri/src/agents/tailscale_setup.rs), only because a button was pressed.
//
// The words avoid "node", "tailnet", "backend", "extension host" and "daemon": a person sees
// "Tailscale", "signed in", "allow" and "restart".

import type { TailscaleStatus } from './tailscale.ts';

/** How the app's install goes (`InstallState` in tailscale_setup.rs). */
export interface InstallState {
  phase: 'idle' | 'working' | 'done' | 'app-store' | 'failed';
  /** What is happening or what happened, in plain words. */
  step: string;
}

/** What the setup has done in this window, which decides what it offers next. */
export interface MacSetup {
  install: InstallState;
  /** This window installed Tailscale: a fresh install, whose app may have started too early. */
  installedHere: boolean;
  /** When Tailscale's app was opened or installed here, in milliseconds. */
  openedAt: number | null;
  /** When the sign-in was started here. */
  signInAt: number | null;
  /** How many times the app was restarted here. */
  restarts: number;
  /** What the last button said, when it failed: shown as it is. */
  problem: string | null;
}

export const NEW_MAC_SETUP: MacSetup = {
  install: { phase: 'idle', step: '' },
  installedHere: false,
  openedAt: null,
  signInAt: null,
  restarts: 0,
  problem: null,
};

/** How long the setup waits before it says what is probably wrong, in milliseconds. */
export interface MacTimes {
  /** Tailscale was opened and still doesn't answer: its network extension may be waiting to be allowed. */
  extension: number;
  /** The sign-in was started and Tailscale gave no page: the app may have missed its extension. */
  signIn: number;
}

export const MAC_TIMES: MacTimes = { extension: 12_000, signIn: 15_000 };

export type MacButtonId = 'install' | 'app-store' | 'open' | 'sign-in' | 'restart';

export interface MacButton {
  id: MacButtonId;
  label: string;
  primary?: boolean;
}

export interface MacPlan {
  /** What is being waited for, with a mark that waits. */
  waiting: string | null;
  /** What to do or what to know, in plain words. */
  notes: string[];
  buttons: MacButton[];
  /** The setup restarts Tailscale's app now, by itself, once (the app missed its extension). */
  autoRestart: boolean;
}

const NOTHING: MacPlan = { waiting: null, notes: [], buttons: [], autoRestart: false };

const INSTALL_WORDS =
  'Redlines downloads Tailscale’s installer from pkgs.tailscale.com, checks that Tailscale signed ' +
  'it and Apple notarized it, and then macOS asks for your password to install it. Redlines never ' +
  'sees the password.';

/** What to do about Tailscale on this Mac, for a status and what has been done so far. */
export function macPlan(
  status: TailscaleStatus,
  setup: MacSetup,
  now: number,
  times: MacTimes = MAC_TIMES,
): MacPlan {
  const since = (at: number | null) => (at === null ? 0 : now - at);
  const { install } = setup;
  switch (status.state) {
    case 'missing': {
      if (install.phase === 'working') return { ...NOTHING, waiting: install.step };
      if (install.phase === 'app-store') {
        return {
          ...NOTHING,
          waiting: 'Waiting for Tailscale to arrive from the App Store…',
          notes: [install.step],
          buttons: [{ id: 'app-store', label: 'Open the App Store again' }],
        };
      }
      if (install.phase === 'failed') {
        return {
          ...NOTHING,
          notes: [install.step],
          buttons: [
            { id: 'install', label: 'Try again', primary: true },
            { id: 'app-store', label: 'Get it from the App Store instead' },
          ],
        };
      }
      return {
        ...NOTHING,
        notes: [INSTALL_WORDS],
        buttons: [
          { id: 'install', label: 'Install Tailscale', primary: true },
          { id: 'app-store', label: 'Get it from the App Store instead' },
        ],
      };
    }
    case 'off': {
      const opened = setup.openedAt !== null;
      if (opened && since(setup.openedAt) < times.extension) {
        return { ...NOTHING, waiting: 'Waiting for Tailscale to start…' };
      }
      if (opened) {
        return {
          ...NOTHING,
          notes: [
            'Tailscale isn’t answering yet. macOS may be asking you to allow it: allow its VPN ' +
              `configuration and, the first time, its network extension in ${
                status.allow_in || 'System Settings'
              }.`,
            'If you allowed it and nothing changes, restart Tailscale.',
          ],
          buttons: [
            { id: 'open', label: 'Open Tailscale', primary: true },
            { id: 'restart', label: 'Restart Tailscale' },
          ],
        };
      }
      return {
        ...NOTHING,
        notes: ['Tailscale is on this Mac, and turned off or not started.'],
        buttons: [{ id: 'open', label: 'Open Tailscale', primary: true }],
      };
    }
    case 'starting':
      return { ...NOTHING, waiting: 'Tailscale is starting…' };
    case 'signed-out': {
      // The app that a fresh install opened can start before its network extension runs, and then
      // never connects to it: it is restarted once, now that the extension answers.
      if (setup.installedHere && setup.restarts === 0) {
        return {
          ...NOTHING,
          waiting: 'Restarting Tailscale, which opened too early…',
          autoRestart: true,
        };
      }
      const sign = { id: 'sign-in' as const, label: 'Sign in to Tailscale', primary: true };
      if (setup.signInAt === null) {
        return {
          ...NOTHING,
          notes: ['Sign in with the same account as your other computer.'],
          buttons: [sign],
        };
      }
      if (status.auth_url) {
        return {
          ...NOTHING,
          waiting: 'Waiting for you to finish signing in…',
          notes: ['The sign-in page is open in your browser. If it isn’t, open it again.'],
          buttons: [{ ...sign, label: 'Open the sign-in page again', primary: false }],
        };
      }
      if (since(setup.signInAt) < times.signIn) {
        return { ...NOTHING, waiting: 'Starting the sign-in…' };
      }
      // Log in does nothing: Tailscale's app never connected to its network extension.
      if (setup.restarts === 0) {
        return {
          ...NOTHING,
          waiting:
            'The sign-in didn’t start. Restarting Tailscale, which can miss its network extension…',
          autoRestart: true,
        };
      }
      return {
        ...NOTHING,
        notes: [
          'The sign-in still doesn’t start. Restart Tailscale and try again; if it keeps failing, ' +
            'quit Tailscale from its icon in the menu bar and open it from Applications.',
        ],
        buttons: [
          { id: 'restart', label: 'Restart Tailscale', primary: true },
          { ...sign, primary: false },
        ],
      };
    }
    default:
      return NOTHING;
  }
}
