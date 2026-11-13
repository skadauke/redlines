// What the window tells the person when an agent couldn't read a file inside what it may read
// (design §8.6, Scope): which file or folder, why as far as Redlines can tell, and what to do. It
// goes in a notification, the way news that mustn't interrupt does. A refusal outside what the
// agent may read is a limit doing its work, and is never told of.

import type { BlockedNotice } from './runs.ts';

/** What a notification's button does: the window knows how. */
export type BlockedAction = 'privacy-settings' | 'log';

export interface BlockedMessage {
  text: string;
  action?: { label: string; do: BlockedAction };
}

/** The home folder, which a path is shown from, as in `~/Documents/plan.md`. */
const HOME = /^\/Users\/[^/]+(?=\/|$)/;

/** The most characters of a path the message shows. */
const PATH_SHOWN = 56;

/** A path in a few words: from home, and a long one by its start and its end. */
function shown(path: string): string {
  const short = path.replace(HOME, '~');
  const chars = Array.from(short);
  if (chars.length <= PATH_SHOWN) return short;
  const parts = short.split('/');
  const name = parts.at(-1) ?? short;
  const head = parts.slice(0, 2).join('/');
  return `${head}/…/${name}`;
}

/** The folders macOS asks about that people know by their own name. */
const AT_HOME = ['Desktop', 'Documents', 'Downloads'];

/**
 * What is said when macOS isn't letting Redlines read a folder, which an agent's reads are counted
 * as: which folder (`place`, such as `Documents`, or else the path), and what to do, which is to
 * turn Redlines on in System Settings › Privacy & Security › Files and Folders.
 */
export function privacyMessage(path: string, place?: string): BlockedMessage {
  const where =
    place === undefined ? shown(path) : AT_HOME.includes(place) ? `your ${place} folder` : place;
  return {
    text: `macOS isn’t letting Redlines read ${where}.`,
    action: { label: 'Open System Settings', do: 'privacy-settings' },
  };
}

export function blockedMessage(notice: BlockedNotice): BlockedMessage {
  const { agentName, path, place, words, logPath } = notice;
  switch (notice.cause) {
    case 'privacy':
      return privacyMessage(path, place);
    case 'permission':
      return { text: `You don’t have permission to read ${shown(path)}.` };
    case 'settings':
      return {
        text: `${agentName}’s settings don’t allow reading ${shown(path)}. An organization’s settings can do this.`,
      };
    case 'other':
      return {
        text: `${agentName} couldn’t read ${shown(path)}${words ? `: ${words.replace(/[.\s]+$/, '')}` : ''}.`,
        ...(logPath === undefined ? {} : { action: { label: 'Show log', do: 'log' as const } }),
      };
  }
}
