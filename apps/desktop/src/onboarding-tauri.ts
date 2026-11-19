// What the onboarding's three installs ask of the app (#1206): each is a command the app already
// has, the one Preferences uses, called with nothing of the page's. Its own file so that only the
// document window imports these commands (src/command-permissions.node.test.ts).

import { invoke } from '@tauri-apps/api/core';
import type { InstallResult, OnboardingAgent, WelcomeDeps } from './onboarding.ts';

/** The agents the app writes the Redlines skill for (agents/skills.rs), by id. */
const SKILL_AGENTS = ['claude', 'codex'];

type CommandLine =
  | { outcome: 'linked'; linked: string; onPath: boolean }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; why: string };

export const tauriInstalls: WelcomeDeps['install'] = {
  async skills(agents: readonly OnboardingAgent[]): Promise<InstallResult> {
    const ids = agents.map((agent) => agent.id).filter((id) => SKILL_AGENTS.includes(id));
    if (ids.length === 0) return { ok: false, line: 'No agent was found to install it for.' };
    for (const agent of ids) await invoke('skill_install', { agent });
    const names = agents.filter((agent) => ids.includes(agent.id)).map((agent) => agent.name);
    return { ok: true, line: `Installed for ${names.join(' and ')}.` };
  },
  async quickLook(): Promise<InstallResult> {
    await invoke('open_quick_look_settings');
    return { ok: true, line: 'System Settings is open: turn on Redlines under Quick Look.' };
  },
  async commandLine(): Promise<InstallResult> {
    const done = await invoke<CommandLine>('install_command_line');
    if (done.outcome === 'linked') {
      return {
        ok: true,
        line: done.onPath
          ? 'Installed: type redlines in Terminal.'
          : `Installed at ${done.linked}, which isn’t on your PATH yet.`,
      };
    }
    return {
      ok: false,
      line:
        done.outcome === 'cancelled'
          ? 'Not installed: it needed your password. Preferences › General can try again.'
          : `Not installed: ${done.why} Preferences › General can try another place.`,
    };
  },
};

/** Whether there is a Quick Look preview to turn on: only the app can say. */
export const quickLookAvailable = (): Promise<boolean> =>
  invoke<boolean>('quick_look_available').catch(() => false);
