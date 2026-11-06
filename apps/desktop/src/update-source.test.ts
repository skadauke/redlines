import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateMessage } from './update-owner.ts';
import { relaunch, tauriUpdateLink, tauriUpdateSource } from './update-source.ts';

const windowListen = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'doc-1', listen: windowListen }),
}));

afterEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(check).mockReset();
  windowListen.mockReset();
});

describe('the update source', () => {
  it('asks the app whether this copy can update itself', async () => {
    vi.mocked(invoke).mockResolvedValue('disk-image');
    expect(await tauriUpdateSource().availability()).toBe('disk-image');
    // src-tauri/src/updates.rs: update_availability.
    expect(invoke).toHaveBeenCalledWith('update_availability');
  });

  it('checks through the updater, and hands on what it found', async () => {
    const update = {
      version: '0.2.0',
      download: vi.fn(() => Promise.resolve()),
      install: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
    };
    vi.mocked(check).mockResolvedValueOnce(null);
    expect(await tauriUpdateSource().check()).toBeNull();
    vi.mocked(check).mockResolvedValueOnce(update as unknown as Awaited<ReturnType<typeof check>>);
    const found = await tauriUpdateSource().check();
    expect(found?.version).toBe('0.2.0');
    await found?.download();
    await found?.install();
    await found?.close();
    expect(update.download).toHaveBeenCalledOnce();
    expect(update.install).toHaveBeenCalledOnce();
    expect(update.close).toHaveBeenCalledOnce();
    // A check gives up rather than hang on a network that doesn't answer.
    expect(vi.mocked(check).mock.calls[0]?.[0]?.timeout).toBeGreaterThan(0);
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

describe('the link to the other windows’ updates', () => {
  it('reaches the app’s commands by name', async () => {
    // src-tauri/src/update_owner.rs.
    vi.mocked(invoke).mockResolvedValue(undefined);
    const link = tauriUpdateLink();
    const state = { phase: 'ready', version: '0.2.0' } as const;
    await link.join();
    await link.report(state);
    await link.ask(3, 'check');
    await link.answer(4, { outcome: 'done', value: { kind: 'up-to-date' } });
    await link.dismiss('0.2.0');
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['update_join'],
      ['update_report', { state }],
      ['update_ask', { id: 3, what: 'check' }],
      ['update_answer', { id: 4, answer: { outcome: 'done', value: { kind: 'up-to-date' } } }],
      ['update_dismiss', { version: '0.2.0' }],
    ]);
  });

  it('hears the messages sent to this window alone', async () => {
    windowListen.mockResolvedValue(() => {});
    const heard: UpdateMessage[] = [];
    await tauriUpdateLink().listen((message) => heard.push(message));
    expect(windowListen).toHaveBeenCalledWith('updates', expect.any(Function));
    const deliver = windowListen.mock.calls[0]?.[1] as (event: { payload: UpdateMessage }) => void;
    deliver({ payload: { kind: 'own' } });
    expect(heard).toEqual([{ kind: 'own' }]);
  });
});
