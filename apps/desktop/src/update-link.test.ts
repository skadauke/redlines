import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relaunch, tauriUpdateLink, UPDATES_EVENT } from './update-link.ts';
import type { UpdateMessage } from './updates.ts';

const windowListen = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'doc-1', listen: windowListen }),
}));

afterEach(() => {
  vi.mocked(invoke).mockReset();
  windowListen.mockReset();
});

describe('the link to the app’s updates', () => {
  it('reaches the app’s commands by name', async () => {
    // src-tauri/src/updates.rs.
    vi.mocked(invoke).mockResolvedValue(undefined);
    const link = tauriUpdateLink();
    await link.read();
    await link.check();
    await link.install();
    await link.dismiss('0.2.0');
    await link.setAutomatic(true);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['update_state'],
      ['update_check'],
      ['update_install'],
      ['update_dismiss', { version: '0.2.0' }],
      ['update_set_automatic', { on: true }],
    ]);
  });

  it('hands on what the app says', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ kind: 'downloading', version: '0.2.0' });
    expect(await tauriUpdateLink().check()).toEqual({ kind: 'downloading', version: '0.2.0' });
    const snapshot = { state: { phase: 'ready', version: '0.2.0' }, dismissed: null };
    vi.mocked(invoke).mockResolvedValueOnce(snapshot);
    expect(await tauriUpdateLink().read()).toEqual(snapshot);
  });

  it('hears what the app tells every window', async () => {
    windowListen.mockResolvedValue(() => {});
    const heard: UpdateMessage[] = [];
    await tauriUpdateLink().listen((message) => heard.push(message));
    // src-tauri/src/updates.rs: EVENT.
    expect(UPDATES_EVENT).toBe('updates');
    expect(windowListen).toHaveBeenCalledWith(UPDATES_EVENT, expect.any(Function));
    const deliver = windowListen.mock.calls[0]?.[1] as (event: { payload: UpdateMessage }) => void;
    deliver({ payload: { kind: 'dismissed', version: '0.2.0' } });
    expect(heard).toEqual([{ kind: 'dismissed', version: '0.2.0' }]);
  });

  it('relaunches with the open documents, or none', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await relaunch(['/Users/ada/plan.md', '/Users/ada/notes.md']);
    await relaunch([]);
    // src-tauri/src/updates.rs: relaunch.
    expect(invoke).toHaveBeenNthCalledWith(1, 'relaunch', {
      files: ['/Users/ada/plan.md', '/Users/ada/notes.md'],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'relaunch', { files: [] });
  });
});
