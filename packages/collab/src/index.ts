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
