// The messages between a window and the session authority, and the interface a transport fills
// (docs/research/collaboration.md "Rules for live collaboration", design §Collaboration). A
// transport carries calls from a client to the authority's host and notices back; it knows
// nothing of what they mean. Tauri windows, browser tabs and tests each have a small adapter.

import type {
  GetDocumentReply,
  HelloReply,
  HelloRequest,
  Peer,
  PresenceReply,
  PresenceState,
  ProtocolError,
  PullReply,
  PushReply,
  PushRequest,
} from './protocol.ts';

/** What a client asks. Every call names the replica that asks, which the authority checks. */
export type Call =
  | { call: 'hello'; request: HelloRequest }
  | { call: 'getDocument'; clientID: string }
  | { call: 'pull'; clientID: string; since: number; limit?: number }
  | { call: 'push'; clientID: string; request: PushRequest }
  | { call: 'presence'; clientID: string; state: PresenceState | null }
  | { call: 'leave'; clientID: string };

export type Reply =
  | HelloReply
  | GetDocumentReply
  | PullReply
  | PushReply
  | PresenceReply
  | { ok: true }
  | ProtocolError;

/** What the host tells a client without being asked. */
export type Notice =
  /** The log has a newer version: pull. */
  | { kind: 'version'; version: number; epoch: number }
  /** Everyone else's presence changed. */
  | { kind: 'peers'; peers: Peer[] }
  /** The session moved to another epoch (a takeover): say hello again. */
  | { kind: 'epoch'; epoch: number }
  | { kind: 'ended' };

export interface Transport {
  /** Rejects when the host can not be reached; the client treats that as being offline. */
  call(call: Call): Promise<Reply>;
  /** Notices for this client. Returns the way to stop listening. */
  subscribe(handler: (notice: Notice) => void): () => void;
}
