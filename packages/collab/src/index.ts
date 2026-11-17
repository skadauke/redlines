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
export { changedRanges, mapFootprint, readFootprint, touches } from './footprint.ts';
export type { Footprint } from './footprint.ts';
export * from './protocol.ts';
export { MemoryLog } from './wal.ts';
export type { EpochRecord, UpdateRecord, WalRecord, WriteAheadLog } from './wal.ts';
