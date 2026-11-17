// What a window asks of the app and of the other windows for a session (`session.ts`), through
// the app's own commands and the events between windows. Its own file: only a document window
// imports it, and so only a document window needs these commands.

import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Joined, SessionPorts } from './session.ts';

export function tauriSessionPorts(): SessionPorts {
  const window = getCurrentWebviewWindow();
  return {
    label: window.label,
    join: (path) => invoke<Joined>('session_join', { path }),
    walStart: (path, epoch, base) => invoke('session_wal_start', { path, epoch, base }),
    walAppend: (path, epoch, lines) => invoke('session_wal_append', { path, epoch, lines }),
    walRead: (path) =>
      invoke<{ base: string; records: string[] } | null>('session_wal_read', { path }),
    leave: (path) => invoke('session_leave', { path }),
    send: (label, event, payload) => emitTo(label, event, payload),
    // This window's own: the plain `listen` would hear what is sent to the others too.
    listen: async (event, handler) => window.listen(event, ({ payload }) => handler(payload)),
  };
}
