// What a wider setting brings back (issue #382): an answer such as "folder and home folder" that was
// held to a narrower setting is kept, and stands again when Preferences are widened. The pane says
// so, with how many, and lets the person forget them (nobody is asked again folder by folder).

import type { AgentScope } from '@redlines/plugin-api';
import { narrower } from './reach.ts';

type Consent = Record<string, AgentScope | 'no'>;

const WIDTH: Record<AgentScope, number> = { document: 0, folder: 1, everything: 2 };

/**
 * The keys of the answers that read more under `to` than they did under `from`: an answer that
 * allows more than `from` did, in a setting that now allows more. `holds` says whether an agent
 * is held to the setting (a machine-wide agent is not, and its answers stand as they were).
 */
export function readableAgain(
  consent: Consent,
  from: AgentScope,
  to: AgentScope,
  holds: (agent: string) => boolean = () => true,
): string[] {
  if (WIDTH[to] <= WIDTH[from]) return [];
  return Object.entries(consent)
    .filter(([key, answer]) => {
      if (answer === 'no') return false;
      const split = key.indexOf('|');
      if (!holds(split < 0 ? key : key.slice(0, split))) return false;
      return WIDTH[narrower(answer, to)] > WIDTH[narrower(answer, from)];
    })
    .map(([key]) => key);
}

/** The line under the setting. */
export function readableAgainText(count: number): string {
  return count === 1
    ? '1 folder you allowed before is readable again.'
    : `${count} folders you allowed before are readable again.`;
}

/** `consent` without `keys`. */
export function forgetting(consent: Consent, keys: readonly string[]): Consent {
  const gone = new Set(keys);
  return Object.fromEntries(Object.entries(consent).filter(([key]) => !gone.has(key)));
}
