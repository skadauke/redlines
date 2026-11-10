// What only the Preferences window asks of the app's Rust side about agents (src-tauri/src/agents/):
// to change the list of the Agent Client Protocol agents the person added, and to detect Claude and
// Codex. Adding or removing an agent puts a question to the person in an alert of the system's,
// which no page can answer, and fails with a line to show when they say no. Only this window's
// capability grants those commands (command-permissions.node.test.ts).

import type { HostProcesses } from '@redlines/plugin-api';
import { invoke } from '@tauri-apps/api/core';
import { findProgram, runProgram, type AcpAgent } from './agent-programs.ts';

export const acpAgentEdits = {
  add: (name: string, command: string) => invoke<AcpAgent[]>('acp_agent_add', { name, command }),
  remove: (id: string) => invoke<AcpAgent[]>('acp_agent_remove', { id }),
};

/**
 * The programs as the agents' providers detect them: found and asked what they are. Preferences
 * starts no run, so the rest refuses.
 */
export function createDetectionProcesses(): HostProcesses {
  const refuse = () => Promise.reject(new Error('Preferences starts no agent.'));
  return { which: findProgram, exec: runProgram, start: refuse };
}
