// An agent's edit as an intent (docs/research/multiuser.md §4.9): the text its tool read and the
// text it wrote, kept beside the transaction that applied it. A session pushes it as what the
// agent changed, and places it on newer text with `rebaseAgentEdit`, so that what others typed
// meanwhile stays. Its own annotation, apart from the typing family's: nothing of it is drawn from
// the edit source, and no other intent kind has to know it.

import { Annotation } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import { newIntentId } from './intent.ts';

export interface AgentIntent {
  kind: 'agent';
  id: string;
  /** The agent's step, by run (the history's group). */
  group: string;
  agent: string;
  /** The text the agent worked from, and the text it wrote. */
  base: string;
  next: string;
}

/** The agent edit a transaction applied, when it carried its base. */
export const agentIntentAnnotation = Annotation.define<AgentIntent>();

export function agentIntentOf(tr: Transaction): AgentIntent | undefined {
  return tr.annotation(agentIntentAnnotation);
}

export function agentIntent(intent: Omit<AgentIntent, 'id' | 'kind'>): AgentIntent {
  return { kind: 'agent', id: newIntentId(), ...intent };
}
