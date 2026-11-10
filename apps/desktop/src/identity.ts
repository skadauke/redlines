// Who is using the app. Its own file, so that a window that needs only this (Preferences, for the
// name its Git identity shows) reaches the app's `identity` command and no other of the host's.

import type { Author } from '@redlines/editor';
import { invoke } from '@tauri-apps/api/core';
import { deriveHandle } from './handle.ts';

/**
 * The person using the app in a plain browser tab: Ada, who wrote the welcome document with the
 * others, so that her changes in it show as yours.
 */
export const BROWSER_IDENTITY: Author = {
  handle: 'ada',
  name: 'Ada Lovelace',
  email: 'ada@example.org',
};

/** The person using the app, from the app's Git configuration. */
export async function appIdentity(): Promise<Author> {
  const { name, email } = await invoke<{ name: string; email: string | null }>('identity');
  return { handle: deriveHandle(name, email), name, ...(email ? { email } : {}) };
}

/** The person using this window: the app's, or Ada in a plain browser tab. */
export function currentIdentity(): Promise<Author> {
  return '__TAURI_INTERNALS__' in window ? appIdentity() : Promise.resolve(BROWSER_IDENTITY);
}
