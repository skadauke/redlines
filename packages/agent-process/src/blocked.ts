// A read an agent couldn't make, inside what it may read: which file, and why as far as Redlines
// can tell, for a message that says what to do (design §8.6, Scope). The providers find the words
// of a refusal in their agent's event stream; this knows the paths and the causes, and nothing of
// an agent's events.

import type { AgentRequest, BlockedRead } from '@redlines/plugin-api';

/** What of a run decides what the agent may read: its scope, folder and the home folders. */
export type RunReach = Pick<AgentRequest, 'scope' | 'folder' | 'documentPath' | 'homeRoots'>;

/** Whether `path` is inside `folder` by its name: absolute, never climbing out, and under it. */
function under(path: string, folder: string): boolean {
  if (!path.startsWith('/') || path.split('/').includes('..')) return false;
  return path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
}

/**
 * Whether a path the agent tried to read is inside what it may read at this scope: the document at
 * This document, its folder at This folder, and at This folder and my home folder the folders of
 * the home folder the host listed too. A refusal outside that is a limit doing its work.
 */
export function insideReach(path: string, run: RunReach): boolean {
  switch (run.scope) {
    case 'document':
      return run.documentPath !== undefined && path === run.documentPath;
    case 'folder':
      return run.folder !== undefined && under(path, run.folder);
    case 'everything':
      return (
        (run.folder !== undefined && under(path, run.folder)) ||
        (run.homeRoots ?? []).some((root) => under(path, root))
      );
  }
}

/** The folders macOS asks the person about before an app reads them (Files and Folders). */
const PROTECTED_AT_HOME = ['Desktop', 'Documents', 'Downloads'];

/**
 * The name of the folder macOS protects that `path` is in, or undefined: Desktop, Documents and
 * Downloads, iCloud Drive, a cloud folder (Dropbox, Google Drive, OneDrive, Box) and a removable or
 * network volume. The first read there makes macOS ask whether Redlines may read it, and a refusal
 * is `Operation not permitted`, whoever reads, because Redlines is the program responsible.
 */
export function protectedFolder(path: string): string | undefined {
  const parts = path.split('/');
  // /Users/<name>/<folder>/…
  if (parts[1] === 'Users' && parts[2] && parts[3] !== undefined) {
    if (PROTECTED_AT_HOME.includes(parts[3])) return parts[3];
    if (parts[3] === 'Library' && parts[4] === 'Mobile Documents') return 'iCloud Drive';
    if (parts[3] === 'Library' && parts[4] === 'CloudStorage' && parts[5]) return parts[5];
  }
  if (parts[1] === 'Volumes' && parts[2]) return parts[2];
  return undefined;
}

/** Whether any part of a path is hidden: its name starts with a dot. */
function hidden(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.') && part !== '.' && part !== '..');
}

/** The most characters of a refusal's words that are kept. */
const WORDS = 200;

/** A refusal's words on one line, no longer than a line can hold. */
function oneLine(words: string): string {
  const line = words.replace(/\s+/g, ' ').trim();
  return line.length <= WORDS ? line : `${line.slice(0, WORDS - 1)}…`;
}

/**
 * What a refused read of `path` says, from the agent's own `words`, or undefined when it needs no
 * message: a read outside what the agent may read, which is a limit doing its work, and a hidden
 * file at This folder and my home folder, which that scope leaves out on purpose.
 */
export function blockedRead(path: string, words: string, run: RunReach): BlockedRead | undefined {
  if (!insideReach(path, run)) return undefined;
  if (run.scope === 'everything' && hidden(path)) return undefined;
  // `Operation not permitted` is macOS's privacy where it asks, and anything else is the agent's.
  const place = protectedFolder(path);
  if (/\b(?:EPERM|operation not permitted)\b/i.test(words) && place !== undefined) {
    return { path, cause: 'privacy', place };
  }
  if (/\b(?:EACCES|permission denied)\b/i.test(words)) return { path, cause: 'permission' };
  if (
    /denied because .* (?:don't ask|dont ask) mode|permission rules?|managed settings/i.test(words)
  ) {
    return { path, cause: 'settings' };
  }
  return { path, cause: 'other', words: oneLine(words) };
}

/** The last part of a path. */
function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

/** What the live line says when a read was refused: the file, in at most 40 characters. */
export function blockedStatus({ path }: BlockedRead): string {
  const line = `Couldn’t read ${baseName(path)}`;
  return line.length <= 40 ? line : `${line.slice(0, 39).trimEnd()}…`;
}

/**
 * The home folder and the folders of it a run at This folder and my home folder reads, or
 * undefined for any other run, and for one that was given nothing to name: such a run reads its
 * folder only.
 */
export function homeScope(
  request: Pick<AgentRequest, 'scope' | 'homeFolder' | 'homeRoots'>,
): { home: string; roots: readonly string[] } | undefined {
  const { scope, homeFolder: home, homeRoots: roots } = request;
  if (scope !== 'everything' || home === undefined || roots === undefined || roots.length === 0) {
    return undefined;
  }
  return { home, roots };
}
