// The protocol between a client and the session authority (docs/research/multiuser.md §4.1). The
// messages are plain data, so any transport can carry them: a channel between windows, a
// BroadcastChannel, a WebSocket or a QUIC stream.

/** The protocol this build speaks, and the oldest one it still talks to. */
export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;
/** The ledger's `version` this build reads and writes (docs/format.md §5). */
export const FORMAT_VERSION = 1;
export const MIN_FORMAT_VERSION = 1;

/** Viewer reads, Commenter adds comments and suggestions, Editor edits and decides, the host owns. */
export type Role = 'viewer' | 'commenter' | 'editor' | 'owner';

/** Who a connection is, as the authority's authentication says. */
export interface Identity {
  /** The person's handle in the ledger (`ada`, `claude-ada`). */
  handle: string;
  name: string;
  color?: string;
  role: Role;
}

export type ErrorCode =
  /** Get a new token. */
  | 'token-expired'
  /** Stop. The role, or the key, doesn't allow it. */
  | 'forbidden'
  /** Derive the edit again against the newest text, then push. */
  | 'stale'
  /** Back off: the push or the message is too big. */
  | 'too-large'
  /** Back off: too many pushes. */
  | 'rate-limited'
  /** This app is too old for the session. */
  | 'update-required'
  /** The host closed the session. */
  | 'ended'
  /** The push would leave the file broken, or is not a push at all. */
  | 'invalid';

export interface ProtocolError {
  ok: false;
  error: ErrorCode;
  /** A sentence for logs; the app words what people see. */
  message: string;
  /** For `stale`: why. `epoch`, a client from an older epoch; `version`, a version the log hasn't
   * reached; `footprint`, an update since its base touched what the push depends on; `decided`, a
   * decision on a mark someone has already decided or changed (stage 3). */
  reason?: 'epoch' | 'version' | 'footprint' | 'decided' | 'changed';
  /** For `rate-limited` and `too-large`: when to try again. */
  retryAfterMs?: number;
  /** The authority's version and epoch when it answered, so the client can pull. */
  version?: number;
  epoch?: number;
  /** For `stale` after a decision: what changed, in words and as the mark's new digest. */
  detail?: unknown;
}

export type Credential = { key: string } | { token: string };

export interface HelloRequest {
  credential: Credential;
  /** Chosen by the client and unique to its replica. It names the client's updates in the log. */
  clientID: string;
  protocol: number;
  format: number;
  /** The last version this client saw, and the epoch it saw it in; 0 and 0 for a new replica. */
  version: number;
  epoch: number;
}

export interface HelloReply {
  ok: true;
  role: Role;
  person: { handle: string; name: string; color?: string };
  epoch: number;
  /** The log's version now. */
  version: number;
  /** True when the client's last version doesn't belong to this log (another epoch, or a version
   * the log hasn't reached): it must `getDocument` and drop what it has not confirmed. */
  reset: boolean;
}

export interface GetDocumentReply {
  ok: true;
  text: string;
  version: number;
  epoch: number;
}

/** A range of the text, as offsets. Touching ends count as touching. */
export interface WireRange {
  from: number;
  to: number;
}

/**
 * One update in a push. `changes` is a CodeMirror `ChangeSet` as JSON, applying to the text the
 * previous update of the push left (the first, to the text of the push's version).
 */
export interface WireUpdate {
  changes: unknown;
  clientID: string;
  /** What the edit changed and what its result depends on, in the text it applies to. Left out,
   * the authority takes the ranges the change touches. */
  footprint?: readonly WireRange[];
  /** Ledger entries, kept with the update and passed on as they are (docs §4.3). */
  entries?: unknown;
  /** An accept or reject, carrying the mark as the person saw it (stage 3). */
  decision?: Decision;
}

/** Accept or reject by mark id, with the mark as the reviewer saw it. */
export interface Decision {
  kind: 'accept' | 'reject';
  /** The ids shown at the click: one mark, or every mark of a suggestion. */
  ids: readonly string[];
  /** The digest of each mark as seen, by id (see `markDigest`). */
  seen: Readonly<Record<string, string>>;
}

export interface PushRequest {
  /** The version the updates are based on. */
  version: number;
  epoch: number;
  updates: readonly WireUpdate[];
}

export interface PushReply {
  ok: true;
  /** `accepted`: logged as sent. `rebased`: logged after mapping over what came in meanwhile. */
  status: 'accepted' | 'rebased';
  /** Updates of the push already in the log from an earlier try, and so left out. */
  duplicates: number;
  version: number;
  epoch: number;
}

/** An update as the log holds it and `pull` returns it. */
export interface LoggedWireUpdate {
  /** The version this update made. */
  version: number;
  changes: unknown;
  clientID: string;
  /** The author's handle. */
  by: string;
  /** The authority's clock, in milliseconds. */
  at: number;
  /** Where the update applied, in the text it applied to. */
  footprint: readonly WireRange[];
  entries?: unknown;
  decision?: Decision;
}

export interface PullReply {
  ok: true;
  version: number;
  epoch: number;
  updates: LoggedWireUpdate[];
}

/** Carets, selections, the change someone has open: never stored. */
export type PresenceState = Record<string, unknown>;

export interface Peer {
  clientID: string;
  handle: string;
  name: string;
  color?: string;
  state: PresenceState;
}

export interface PresenceReply {
  ok: true;
  peers: Peer[];
}

export function isError(reply: { ok: boolean }): reply is ProtocolError {
  return !reply.ok;
}
