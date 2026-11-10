// What every window that detects or runs agents asks of the app's Rust side about programs
// (src-tauri/src/agents/): finding one, running one to the end, and the list of the Agent Client
// Protocol agents the person added. Changing that list is Preferences' alone (agent-preferences.ts),
// and starting a run a document window's (agent-host.ts): each is its own file, so that what a
// window's code can call is what its capability file grants (command-permissions.node.test.ts).

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** The program `program` names on this machine, or nothing. */
export const findProgram = (program: string) => invoke<string | null>('agent_which', { program });

/** Runs `program` with `args` to its end, for what it prints. */
export const runProgram = (program: string, args: string[]) =>
  invoke<{ code: number | null; stdout: string }>('agent_exec', { program, args });

/** An Agent Client Protocol agent the person added (`AcpAgent` in agents/acp.rs). */
export interface AcpAgent {
  id: string;
  name: string;
  program: string;
  args: string[];
}

/** A program and its arguments as the person allowed them: a word with a space in it is quoted. */
export function commandLine(program: string, args: readonly string[]): string {
  return [program, ...args]
    .map((word) => (/^[\w./=:@,+%-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`))
    .join(' ');
}

/** The Agent Client Protocol agents the person added, which the Rust side keeps. */
export const acpAgents = {
  list: () => invoke<AcpAgent[]>('acp_agents'),
  /** Calls `onChange` when the list changes in any window; returns a function that stops it. */
  watch(onChange: () => void): () => void {
    const stop = listen('acp-agents-changed', () => onChange());
    return () => void stop.then((unlisten) => unlisten());
  },
};
