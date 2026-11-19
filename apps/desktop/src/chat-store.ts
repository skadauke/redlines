// Where a document's chat is kept (#1194): the app's own data folder (src-tauri/src/chats.rs), never
// the Markdown file. A plain browser tab has no folder and keeps chats in memory, as its saves are.

import type { ChatStore } from '@redlines/agents';
import { memoryStore } from '@redlines/agents';
import { invoke } from '@tauri-apps/api/core';

/** The app's store, which the window reaches by four commands. */
export function tauriChatStore(): ChatStore {
  return {
    read: (key) => invoke<string | null>('chat_read', { key }),
    write: (key, text) => invoke('chat_write', { key, text }),
    remove: (key) => invoke('chat_delete', { key }),
    move: (from, to) => invoke('chat_move', { from, to }),
  };
}

export function browserChatStore(): ChatStore {
  return memoryStore();
}
