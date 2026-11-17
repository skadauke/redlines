// What an agent may read, decided once (issue #352): a comment's run (`runs.ts`) and an Ask
// (`ask/session.ts`) both call `decideReach`, so that a change to the scope, or to what an agent
// is told, reaches both. This document for a document with no file, a folder that is too broad or
// Preferences saying so; otherwise what the person allowed for this agent and folder, asked until
// they allow something, and held to what Preferences allow now (an answer is kept, and stands
// again if Preferences allow more later). An agent that can't be held to less than the machine is
// always asked, and has no This document and no home folder.

import type { AgentScope, ProjectRoot } from '@redlines/plugin-api';

/** Said on the line when the folder is the home folder or the disk's root. */
export const TOO_BROAD = 'Folder too broad: this document only';

/** How wide each scope reads, for holding an answer to what Preferences allow. */
const WIDTH: Record<AgentScope, number> = { document: 0, folder: 1, everything: 2 };

/** The narrower of two scopes. */
export function narrower(one: AgentScope, other: AgentScope): AgentScope {
  return WIDTH[one] <= WIDTH[other] ? one : other;
}

/** Where an agent may read, once that is settled. */
export interface Reach {
  scope: AgentScope;
  folder?: string;
  /** Said on the line as the run starts. */
  note?: string;
}

export interface ReachInput {
  agent: { id: string; readLimit?: string };
  /** The project root of the document, or null for a document with no file. */
  root: ProjectRoot | null;
  /** The scope Preferences allow now. */
  defaultScope(): AgentScope;
  /** What the person answered for this agent and folder before. */
  consent(agent: string, folder: string): AgentScope | 'no' | undefined;
  setConsent(agent: string, folder: string, answer: AgentScope): void;
  /**
   * Puts the first-run question up and waits: the answer, or null if the question went away.
   * `home` is true where the home folder is among the answers.
   */
  ask(folder: string, home: boolean): Promise<AgentScope | 'no' | null>;
  /** True once the caller has stopped waiting (the run or the Ask is over). */
  over(): boolean;
  /** Called once the question has been answered with something that allows a read. */
  answered?(): void;
  /** Whether the caller can offer, and use, the home folder. Default true. */
  home?: boolean;
}

/** Null when the person said Not now, which isn't remembered, or the caller stopped meanwhile. */
export async function decideReach(input: ReachInput): Promise<Reach | null> {
  const { agent, root } = input;
  const folder = root && !root.tooBroad ? root.folder : undefined;
  const atDocument: Reach = root?.tooBroad
    ? { scope: 'document', note: TOO_BROAD }
    : { scope: 'document' };
  const machine = agent.readLimit === 'machine';
  const allowed = input.defaultScope();
  if (!machine && (folder === undefined || allowed === 'document')) return atDocument;
  const asked = folder ?? root?.folder ?? '';
  let answer = input.consent(agent.id, asked);
  // Only the answers that allow something are remembered; a no an earlier version stored asks
  // again. A machine-wide agent has no This document, and no home folder to hold it to.
  if (answer === 'no' || (machine && answer !== 'folder')) answer = undefined;
  if (answer === undefined) {
    const home = input.home !== false && !machine && allowed === 'everything';
    const given = await input.ask(asked, home);
    if (given === null || given === 'no' || input.over()) return null;
    input.setConsent(agent.id, asked, given);
    answer = given;
    input.answered?.();
  }
  // Preferences may have been narrowed while the question was up: the setting as it is now holds.
  let scope = machine ? answer : narrower(answer, input.defaultScope());
  if (input.home === false && scope === 'everything') scope = 'folder';
  if (scope === 'document' || folder === undefined) return atDocument;
  return { scope, folder };
}
