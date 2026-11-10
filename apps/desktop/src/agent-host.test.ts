import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acpAgentEdits } from './agent-preferences.ts';
import { acpAgents, commandLine, createProcesses, createRelay } from './agent-host.ts';

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

  it('starts an Agent Client Protocol agent by its id, and sends it messages', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: 7, log_path: '/logs/g.jsonl' });
    const log = { agent: 'gemini', thread: 'c1' };
    const handle = await createProcesses().startAcp!({ agent: 'gemini', cwd: '/docs', log });
    expect(handle.logPath).toBe('/logs/g.jsonl');
    // src-tauri/src/agents/mod.rs: acp_start. No program and no arguments: Rust has them.
    expect(invoke).toHaveBeenCalledWith('acp_start', {
      agent: 'gemini',
      cwd: '/docs',
      log,
      onLine: expect.objectContaining({ onmessage: expect.any(Function) as unknown }) as unknown,
    });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await handle.send('{"jsonrpc":"2.0"}');
    expect(invoke).toHaveBeenLastCalledWith('acp_send', { id: 7, line: '{"jsonrpc":"2.0"}' });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    handle.stop();
    expect(invoke).toHaveBeenLastCalledWith('agent_stop', { id: 7 });

    const channel = channelOf('onLine');
    const lines = collect(handle.lines);
    channel.onmessage({ kind: 'line', line: '{"id":0}' });
    channel.onmessage({ kind: 'ended', code: 0, stderr: '' });
    expect(await lines).toEqual(['{"id":0}']);
  });

  it('shows an agent’s command as the app’s question does', () => {
    expect(commandLine('/opt/homebrew/bin/gemini', ['--experimental-acp'])).toBe(
      '/opt/homebrew/bin/gemini --experimental-acp',
    );
    expect(commandLine('/bin/openclaw', ['acp', 'two words', "it's", ''])).toBe(
      `/bin/openclaw acp 'two words' 'it'\\''s' ''`,
    );
  });

  it('asks the app for the agents the person added, to add and to remove', async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await acpAgents.list();
    await acpAgentEdits.add('Gemini', 'gemini --experimental-acp');
    await acpAgentEdits.remove('gemini');
    // src-tauri/src/agents/mod.rs: acp_agents, acp_agent_add, acp_agent_remove.
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['acp_agents'],
      ['acp_agent_add', { name: 'Gemini', command: 'gemini --experimental-acp' }],
      ['acp_agent_remove', { id: 'gemini' }],
    ]);
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

describe('createRelay', () => {
  const endpoint = { command: '/app/redlines', args: ['mcp', '--relay', '/tmp/rl/s'] };

  /** A relay opened with `answer`, and the channel to play the program's part through. */
  async function opened(answer: (line: string) => Promise<string | null>) {
    vi.mocked(invoke).mockResolvedValueOnce({ id: 9, endpoint });
    vi.mocked(invoke).mockResolvedValue(undefined);
    const relay = await createRelay().open(answer);
    return { relay, channel: channelOf('onLine') };
  }

  /** The lines sent back through `relay_answer`, after everything waiting has run. */
  async function answers(): Promise<string[]> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === 'relay_answer')
      .map(([, args]) => (args as { line: string }).line);
  }

  it('opens through the app and hands back the endpoint', async () => {
    const { relay } = await opened(() => Promise.resolve(null));
    expect(relay.endpoint).toEqual(endpoint);
    // src-tauri/src/agents/relay.rs: relay_open.
    expect(invoke).toHaveBeenCalledWith('relay_open', {
      onLine: expect.objectContaining({ onmessage: expect.any(Function) as unknown }) as unknown,
    });
  });

  it('answers each line through the given function, in order', async () => {
    const asked: string[] = [];
    let finishFirst: (answer: string) => void = () => {};
    const { channel } = await opened((line) => {
      asked.push(line);
      return line === 'first'
        ? new Promise((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve(`answer to ${line}`);
    });
    channel.onmessage({ kind: 'line', line: 'first' });
    channel.onmessage({ kind: 'line', line: 'second' });
    channel.onmessage({ kind: 'line', line: 'third' });

    // The first hasn't finished, so nothing else has even been asked.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toEqual(['first']);
    expect(await answers()).toEqual([]);

    finishFirst('answer to first');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toEqual(['first', 'second', 'third']);
    expect(await answers()).toEqual(['answer to first', 'answer to second', 'answer to third']);
    // src-tauri/src/agents/relay.rs: relay_answer.
    expect(invoke).toHaveBeenCalledWith('relay_answer', { id: 9, line: 'answer to first' });
  });

  it('sends no answer for a notification', async () => {
    const answer = vi.fn(() => Promise.resolve(null));
    const { channel } = await opened(answer);
    channel.onmessage({
      kind: 'line',
      line: '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    });
    expect(await answers()).toEqual([]);
    expect(answer).toHaveBeenCalledOnce();
  });

  it('a throwing answer becomes a JSON-RPC error, not a dead run', async () => {
    const { channel } = await opened((line) => {
      if (line.includes('"later"')) return Promise.resolve('fine');
      throw new Error('the tools fell over');
    });
    channel.onmessage({ kind: 'line', line: '{"jsonrpc":"2.0","id":"probe-1","method":"x"}' });
    channel.onmessage({ kind: 'line', line: '{"jsonrpc":"2.0","id":7,"method":"x"}' });
    channel.onmessage({ kind: 'line', line: '{not json' });
    // A notification gets no answer, even then.
    channel.onmessage({ kind: 'line', line: '{"jsonrpc":"2.0","method":"x"}' });
    channel.onmessage({ kind: 'line', line: '{"jsonrpc":"2.0","id":8,"method":"later"}' });
    const sent = await answers();
    expect(sent.slice(0, 3).map((line) => JSON.parse(line) as unknown)).toEqual([
      { jsonrpc: '2.0', id: 'probe-1', error: { code: -32603, message: 'Internal error' } },
      { jsonrpc: '2.0', id: 7, error: { code: -32603, message: 'Internal error' } },
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } },
    ]);
    expect(sent[3]).toBe('fine');
    expect(sent).toHaveLength(4);
  });

  it('turns a rejected answer into the same error', async () => {
    const { channel } = await opened(() => Promise.reject(new Error('no')));
    channel.onmessage({ kind: 'line', line: '{"jsonrpc":"2.0","id":7,"method":"x"}' });
    const [sent] = await answers();
    expect(JSON.parse(sent ?? 'null')).toMatchObject({ id: 7, error: { code: -32603 } });
  });

  it('goes on when an answer can not be sent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { channel } = await opened((line) => Promise.resolve(`answer to ${line}`));
    vi.mocked(invoke).mockRejectedValueOnce(new Error('the program has gone'));
    channel.onmessage({ kind: 'line', line: 'first' });
    channel.onmessage({ kind: 'line', line: 'second' });
    expect(await answers()).toEqual(['answer to first', 'answer to second']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('says whether anything ever connected', async () => {
    const { relay, channel } = await opened(() => Promise.resolve(null));
    expect(relay.connected()).toBe(false);
    channel.onmessage({ kind: 'connected' });
    expect(relay.connected()).toBe(true);
  });

  it('says whether an MCP client ever said initialize', async () => {
    const { relay, channel } = await opened(() => Promise.resolve(null));
    channel.onmessage({ kind: 'connected' });
    expect(relay.initialized()).toBe(false);
    // Connecting isn't enough, and neither is anything else that mentions the word.
    for (const line of [
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"initialize"}}',
      '{not json "initialize"',
      '"initialize"',
    ]) {
      channel.onmessage({ kind: 'line', line });
      expect(relay.initialized()).toBe(false);
    }
    // Claude's, as it really is, with its other fields first.
    channel.onmessage({
      kind: 'line',
      line: '{"method":"initialize","params":{"protocolVersion":"2025-11-25"},"jsonrpc":"2.0","id":0}',
    });
    expect(relay.initialized()).toBe(true);
    await answers();
  });

  it('closes by its id, and answers nothing after that', async () => {
    const answer = vi.fn(() => Promise.resolve('late'));
    const { relay, channel } = await opened(answer);
    relay.close();
    // src-tauri/src/agents/relay.rs: relay_close.
    expect(invoke).toHaveBeenCalledWith('relay_close', { id: 9 });
    channel.onmessage({ kind: 'line', line: '{"jsonrpc":"2.0","id":1,"method":"tools/call"}' });
    expect(await answers()).toEqual([]);
    expect(answer).not.toHaveBeenCalled();
  });

  it('sends no answer for a line that was being answered when it closed', async () => {
    let finish: (answer: string) => void = () => {};
    const { relay, channel } = await opened(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    channel.onmessage({ kind: 'line', line: '{"jsonrpc":"2.0","id":1,"method":"tools/call"}' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    relay.close();
    finish('late');
    expect(await answers()).toEqual([]);
  });

  it('rejects when the app can not open a relay', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('No room');
    await expect(createRelay().open(() => Promise.resolve(null))).rejects.toBe('No room');
  });
});
