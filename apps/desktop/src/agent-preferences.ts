// What only the Preferences window asks of the app's Rust side about agents (src-tauri/src/agents/):
// to change the list of the Agent Client Protocol agents the person added, to detect Claude and
// Codex, to update one or sign it in, and to install the Redlines skill for one (the skill's
// folder is the agent's own). Adding or removing an agent puts a question to the person
// in an alert of the system's, which no page can answer, and fails with a line to show when they
// say no. An update or a sign-in is the agent's own command, which the app makes for an agent this
// names and nothing more (agents/setup.rs). Only this window's capability grants those commands
// (command-permissions.node.test.ts).

import {
  openClawAgents,
  openClawCommand,
  type OpenClawAgent,
  type OpenClawInput,
  type SetupResult,
  type SkillInstalled,
  type SkillState,
} from '@redlines/agents';
import type { HostProcesses } from '@redlines/plugin-api';
import { invoke } from '@tauri-apps/api/core';
import { acpAgents, findProgram, homeAccess, runProgram, type AcpAgent } from './agent-programs.ts';

export const acpAgentEdits = {
  add: (name: string, command: string) => invoke<AcpAgent[]>('acp_agent_add', { name, command }),
  remove: (id: string) => invoke<AcpAgent[]>('acp_agent_remove', { id }),
};

export { homeAccess };

/**
 * The agents of an OpenClaw Gateway, which are Agent Client Protocol agents whose command is
 * `openclaw acp --url … --token-file …`: added, listed and removed through the same commands, with
 * the same question to the person, which says where the document and the thread go and that the
 * token file is never read (agents/acp.rs).
 */
export const openClawEdits = {
  list: () => acpAgents.list().then(openClawAgents),
  add: (input: OpenClawInput): Promise<OpenClawAgent[]> =>
    invoke<AcpAgent[]>('acp_agent_add', {
      name: input.name,
      command: openClawCommand(input),
    }).then(openClawAgents),
  remove: (id: string) => acpAgentEdits.remove(id).then(openClawAgents),
};

/** Opens System Settings at Privacy & Security › Files and Folders (agents/mod.rs). */
export const openFilesAndFoldersSettings = () => invoke<void>('open_files_and_folders_settings');

/** How an update or a sign-in ended (`Outcome` in agents/setup.rs). */
interface SetupOutcome {
  /** What was run, as typed: `brew upgrade --cask codex`. */
  ran: string;
  ok: boolean;
  code: number | null;
  /** The last thing it printed, with nothing in it that could be a secret. */
  last_line: string;
  timed_out: boolean;
  /** The person asked for it to stop, or the window closed. */
  stopped: boolean;
  /** It failed at once, as a login that wants a terminal does. */
  quick: boolean;
}

/**
 * What the pane shows of an outcome. A login that failed at once, `terminal`, wants a terminal;
 * what else failed says its last line, or how it ended.
 */
export function setupResult(outcome: SetupOutcome, terminal: boolean): SetupResult {
  // What an update that ended well said last: the pane quotes it when nothing changed.
  if (outcome.ok) return { ok: true, message: outcome.last_line };
  if (outcome.stopped) return { ok: false, message: '', stopped: true };
  const message = outcome.timed_out
    ? `${outcome.ran} took too long, and Redlines stopped it.`
    : outcome.last_line ||
      (outcome.code === null
        ? `${outcome.ran} was stopped.`
        : `${outcome.ran} ended with code ${outcome.code}.`);
  return {
    ok: false,
    message,
    ...(terminal && outcome.quick && !outcome.timed_out ? { needsTerminal: true } : {}),
  };
}

/** Updating and signing in Claude and Codex, each with its own command, by the agent's id. */
export const agentSetup = {
  update: (agent: string) =>
    invoke<SetupOutcome>('agent_update', { agent }).then((outcome) => setupResult(outcome, false)),
  signIn: (agent: string) =>
    invoke<SetupOutcome>('agent_sign_in', { agent }).then((outcome) => setupResult(outcome, true)),
  /** Opens Terminal with the login's command, for a login that needs one. */
  signInInTerminal: (agent: string) => invoke<void>('agent_terminal_sign_in', { agent }),
  /** Stops the update or the sign-in under way, which then ends as stopped. */
  stop: (agent: string) => invoke<void>('agent_setup_stop', { agent }),
};

/**
 * The Redlines skill, in the folder each agent reads skills from (agents/skills.rs), by the agent's
 * id: Claude Code, Codex, or OpenClaw. The text is the app's own, written to a folder the app
 * knows for the agent named, and nothing else; looking changes nothing.
 */
export const agentSkills = {
  status: (agent: string) => invoke<SkillState>('skill_status', { agent }),
  install: (agent: string) => invoke<SkillInstalled>('skill_install', { agent }),
};

/**
 * The programs as the agents' providers detect them: found and asked what they are. Preferences
 * starts no run, so the rest refuses.
 */
export function createDetectionProcesses(): HostProcesses {
  const refuse = () => Promise.reject(new Error('Preferences starts no agent.'));
  return { which: findProgram, exec: runProgram, start: refuse };
}
