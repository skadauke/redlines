// Where a connection to a Gateway is, as the app reports it (`Status` in src-tauri/src/agents/
// node.rs), and what each state means for the sheet and for the agent's card.

import type { FailureId } from './failures.ts';

/** What `openclaw_node_status` returns; nothing (null) when no connection runs. */
export type NodeStatus =
  | { state: 'connecting' }
  | { state: 'pairing'; request_id: string | null; code: string }
  | { state: 'connected'; tools: number }
  | { state: 'reconnecting'; detail: string }
  | { state: 'stopped' }
  | {
      state: 'failed';
      why: 'code-used' | 'bad-token' | 'not-approved' | 'too-new' | 'tools-refused' | 'other';
      protocol?: number | null;
      message?: string;
    };

/** The failure card that a failed connection shows, with what to show under Details. */
export function failureOf(status: NodeStatus): { id: FailureId; detail: string | null } | null {
  if (status.state !== 'failed') return null;
  switch (status.why) {
    case 'code-used':
      return { id: 'code-used', detail: null };
    case 'bad-token':
      return { id: 'token-refused', detail: null };
    case 'not-approved':
      return { id: 'not-approved', detail: null };
    case 'too-new':
      return {
        id: 'gateway-newer',
        detail: status.protocol ? `The Gateway speaks protocol ${status.protocol}.` : null,
      };
    case 'tools-refused':
      return { id: 'tools-unavailable', detail: status.message || null };
    case 'other':
      return { id: 'connection-failed', detail: status.message || null };
  }
}

/** The one line the agent's card says of its connection. */
export function connectionLine(status: NodeStatus | null): string {
  if (status === null) return 'Not connected';
  switch (status.state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'pairing':
      return 'Waiting for approval';
    case 'reconnecting':
      return 'Not connected, trying again';
    case 'stopped':
      return 'Not connected';
    case 'failed':
      return 'Not connected';
  }
}
