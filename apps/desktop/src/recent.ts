// The files File › Open Recent lists: newest first, a few of them. The list is a setting
// (`Settings.recent`), so that every window draws the same menu.

import { isDocument } from './file-names.ts';

/** How many files Open Recent keeps. */
export const MAX_RECENT = 10;

/** `list` with `path` first, once, and no more than `MAX_RECENT` in all. */
export function addRecent(list: readonly string[], path: string): string[] {
  return [path, ...list.filter((entry) => entry !== path)].slice(0, MAX_RECENT);
}

/**
 * The files of `list` that `exists` finds, in order. A file it can't ask about, such as one the
 * app is no longer allowed to read, is as good as gone.
 */
export async function stillThere(
  list: readonly string[],
  exists: (path: string) => Promise<boolean>,
): Promise<string[]> {
  const found = await Promise.all(list.map((path) => exists(path).catch(() => false)));
  return list.filter((_, i) => found[i]);
}

/**
 * What Open Recent shows of `list`: the documents that `exists` finds, in order. A file of another
 * kind, which an earlier version could list, would open nothing, and isn't asked about.
 */
export function shownRecent(
  list: readonly string[],
  exists: (path: string) => Promise<boolean>,
): Promise<string[]> {
  return stillThere(list.filter(isDocument), exists);
}

/** `list` without `path`: a file that was renamed or is gone. */
export function dropRecent(list: readonly string[], path: string): string[] {
  return list.filter((entry) => entry !== path);
}
