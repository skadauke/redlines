// The session authority for multiuser editing (docs/research/multiuser.md).

export {
  collab,
  getClientID,
  getSyncedVersion,
  rebaseUpdates,
  receiveUpdates,
  sendableUpdates,
} from './vendor/collab.ts';
export type { LoggedUpdate, Update } from './vendor/collab.ts';
export { Authority, DEFAULT_LIMITS } from './authority.ts';
export type {
  AuthorityOptions,
  AuthResult,
  Limits,
  PushCheck,
  PushContext,
  PushRefusal,
} from './authority.ts';
export { SyncClient } from './client.ts';
export type { Rederived, SyncOptions, SyncState } from './client.ts';
export { Hub } from './hub.ts';
export type { NoticeListener } from './hub.ts';
export { memoryTransport } from './memory.ts';
export { Replica } from './replica.ts';
export type { Pending, Remote } from './replica.ts';
export type { Call, Notice, Reply, Transport } from './wire.ts';
export type { DurableLog } from './wal.ts';
export {
  changedRanges,
  declareFootprint,
  mapFootprint,
  readFootprint,
  touches,
} from './footprint.ts';
export type { Footprint } from './footprint.ts';
export * from './protocol.ts';
export { MemoryLog } from './wal.ts';
export type { EpochRecord, UpdateRecord, WalRecord, WriteAheadLog } from './wal.ts';
export { markDigest, markSpan, reviewCheck, seenDigests, snapshotOf } from './review.ts';
export type { DecidedRecord, MarkSnapshot } from './review.ts';
