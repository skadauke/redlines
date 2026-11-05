import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProcesses } from './agent-host.ts';

// The app's Rust side, which a test does not have. A channel is a holder for `onmessage`; the test
// takes the channel out of the call and plays Rust's part.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (message: unknown) => void = () => {};
  },
}));

type OnMessage = { onmessage: (message: unknown) => void };

/** The channel passed in the most recent call of `invoke` that had one. */
function channelOf(argument: string): OnMessage {
  const call = vi
    .mocked(invoke)
    .mock.calls.findLast(([, args]) => args !== undefined && argument in (args as object));
  return (call?.[1] as Record<string, OnMessage>)[argument] as OnMessage;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of iterable) all.push(item);
  return all;
}

const spec = {
  program: '/bin/claude',
  args: ['-p', 'hello'],
  cwd: '/docs',
  log: { agent: 'claude', thread: 'c1', document: '/docs/plan.md' },
};

afterEach(() => {
  vi.mocked(invoke).mockReset();
});

describe('createProcesses', () => {
  it('asks the app for a program', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('/bin/claude').mockResolvedValueOnce(null);
    const processes = createProcesses();
    expect(await processes.which('claude')).toBe('/bin/claude');
    expect(await processes.which('nothing')).toBeNull();
    // src-tauri/src/agents/mod.rs: agent_which.
    expect(invoke).toHaveBeenNthCalledWith(1, 'agent_which', { program: 'claude' });
  });

  it('runs a program to its end', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ code: 1, stdout: 'Not logged in\n' });
    const output = await createProcesses().exec('/bin/codex', ['login', 'status']);
    expect(output).toEqual({ code: 1, stdout: 'Not logged in\n' });
    // src-tauri/src/agents/mod.rs: agent_exec.
    expect(invoke).toHaveBeenCalledWith('agent_exec', {
      program: '/bin/codex',
      args: ['login', 'status'],
    });
  });

  it('starts a program with the whole spec', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: 4, log_path: '/logs/a.jsonl' });
    const handle = await createProcesses().start(spec);
    expect(handle.logPath).toBe('/logs/a.jsonl');
    // src-tauri/src/agents/mod.rs: agent_start.
    expect(invoke).toHaveBeenCalledWith('agent_start', {
      spec,
      onLine: expect.objectContaining({ onmessage: expect.any(Function) as unknown }) as unknown,
    });
  });

  it('turns channel messages into an async iterable and ends it', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: 4, log_path: '/logs/a.jsonl' });
    const handle = await createProcesses().start(spec);
    const channel = channelOf('onLine');

    const lines = collect(handle.lines);
    channel.onmessage({ kind: 'line', line: '{"type":"one"}' });
    channel.onmessage({ kind: 'line', line: '' });
    // Let the reader catch up and wait, so that a line can arrive while it waits too.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    channel.onmessage({ kind: 'line', line: 'last' });
    channel.onmessage({ kind: 'ended', code: 3, stderr: 'the end\n' });

    expect(await lines).toEqual(['{"type":"one"}', '', 'last']);
    expect(await handle.ended).toEqual({ code: 3, stderr: 'the end\n' });
  });

  it('keeps lines that come before anyone reads them', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: 4, log_path: '/logs/a.jsonl' });
    const handle = await createProcesses().start(spec);
    const channel = channelOf('onLine');
    channel.onmessage({ kind: 'line', line: 'early' });
    channel.onmessage({ kind: 'ended', code: null, stderr: '' });
    expect(await collect(handle.lines)).toEqual(['early']);
    expect(await handle.ended).toEqual({ code: null, stderr: '' });
  });

  it('keeps lines that come before the app has answered', async () => {
    let answer: (started: { id: number; log_path: string }) => void = () => {};
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const starting = createProcesses().start(spec);
    const channel = channelOf('onLine');
    channel.onmessage({ kind: 'line', line: 'early' });
    channel.onmessage({ kind: 'ended', code: 0, stderr: '' });
    answer({ id: 4, log_path: '/logs/a.jsonl' });
    expect(await collect((await starting).lines)).toEqual(['early']);
  });

  it('lets a reader leave early', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: 4, log_path: '/logs/a.jsonl' });
    const handle = await createProcesses().start(spec);
    const channel = channelOf('onLine');
    channel.onmessage({ kind: 'line', line: 'one' });
    for await (const line of handle.lines) {
      expect(line).toBe('one');
      break;
    }
    channel.onmessage({ kind: 'line', line: 'two' });
    channel.onmessage({ kind: 'ended', code: 0, stderr: '' });
    expect(await handle.ended).toEqual({ code: 0, stderr: '' });
  });

  it('stops by the run’s id, and a failure to stop does not throw', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: 4, log_path: '/logs/a.jsonl' });
    const handle = await createProcesses().start(spec);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error('That run belongs to another window.'));
    handle.stop();
    // src-tauri/src/agents/mod.rs: agent_stop.
    expect(invoke).toHaveBeenLastCalledWith('agent_stop', { id: 4 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('rejects when the app refuses to start a program', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('Redlines didn’t find /bin/sh, so it won’t run it.');
    await expect(createProcesses().start(spec)).rejects.toBe(
      'Redlines didn’t find /bin/sh, so it won’t run it.',
    );
  });
});
