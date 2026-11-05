import type {
  AgentEvent,
  AgentProvider,
  AgentRequest,
  HostRelay,
  ToolLines,
} from '@redlines/plugin-api';
import { describe, expect, it } from 'vitest';
import { events as only, fakeProvider, fakeRelay, replies } from './fake-provider.ts';
import { createMacAgents } from './mac-agents.ts';

const request: AgentRequest = {
  prompt: '@Claude hi',
  systemPrompt: 'Be brief.',
  thread: 'c1',
  scope: 'document',
  author: { handle: 'claude-ada', name: 'Claude', for: 'ada' },
};

/** Answers every line with `{}`, as a stand-in for the toolbox. */
const tools: ToolLines = (line) => {
  const { id } = JSON.parse(line) as { id?: number };
  return Promise.resolve(
    id === undefined ? null : JSON.stringify({ jsonrpc: '2.0', id, result: {} }),
  );
};

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

describe('createMacAgents', () => {
  it('lists each provider with what it detected', async () => {
    const relay = fakeRelay();
    const agents = createMacAgents(
      [
        fakeProvider({ relay, script: replies('Hi.') }),
        fakeProvider({
          relay,
          id: 'codex',
          name: 'Codex',
          script: replies('Hi.'),
          state: { found: false, help: 'Install it.' },
        }),
      ],
      relay,
    );
    expect(await agents.list()).toEqual([
      { id: 'claude', name: 'Claude', readLimit: 'folder', state: { found: true, signedIn: true } },
      {
        id: 'codex',
        name: 'Codex',
        readLimit: 'folder',
        state: { found: false, help: 'Install it.' },
      },
    ]);
  });

  it('lists an agent whose detection threw as not found', async () => {
    const relay = fakeRelay();
    const broken: AgentProvider = {
      ...fakeProvider({ relay, script: replies('Hi.') }),
      detect: () => Promise.reject(new Error('no shell')),
    };
    const [info] = await createMacAgents([broken], relay).list();
    expect(info?.state).toEqual({ found: false, help: "Claude couldn't be checked: no shell" });
  });

  it('opens the relay before the program starts, and hands the provider its endpoint', async () => {
    const relay = fakeRelay();
    const seen: { opened: number; args: string[] }[] = [];
    const provider = fakeProvider({ relay, script: replies('Hi.') });
    const run = provider.run.bind(provider);
    provider.run = (asked, endpoint, signal) => {
      seen.push({ opened: relay.counts().opened, args: endpoint.args });
      return run(asked, endpoint, signal);
    };
    const events = await collect(
      createMacAgents([provider], relay).run(
        'claude',
        request,
        tools,
        new AbortController().signal,
      ),
    );
    expect(seen).toEqual([{ opened: 1, args: ['mcp', '--relay', '/fake/relay-1'] }]);
    expect(events).toEqual([{ type: 'done' }]);
    expect(relay.counts()).toEqual({ opened: 1, closed: 1 });
  });

  it('fails a run whose toolbox never saw initialize, though the program ended well', async () => {
    const relay = fakeRelay();
    const provider = fakeProvider({
      relay,
      id: 'codex',
      name: 'Codex',
      script: only(
        { type: 'status', text: 'Thinking…' },
        { type: 'done', finalText: "Redlines tools aren't available." },
      ),
    });
    const events = await collect(
      createMacAgents([provider], relay).run('codex', request, tools, new AbortController().signal),
    );
    expect(events).toEqual([
      { type: 'status', text: 'Thinking…' },
      {
        type: 'error',
        message: "Codex couldn't start Redlines' tools. Try again, or restart Redlines.",
      },
    ]);
    expect(relay.counts().closed).toBe(1);
  });

  it('passes on a failure the provider reports, and closes the relay', async () => {
    const relay = fakeRelay();
    const provider = fakeProvider({
      relay,
      async *script({ tools: line }) {
        await line.initialize();
        yield { type: 'error', message: 'Claude has hit its usage limit. Try again later.' };
      },
    });
    const events = await collect(
      createMacAgents([provider], relay).run(
        'claude',
        request,
        tools,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([
      { type: 'error', message: 'Claude has hit its usage limit. Try again later.' },
    ]);
    expect(relay.counts()).toEqual({ opened: 1, closed: 1 });
  });

  it('closes the relay when the run is left early', async () => {
    const relay = fakeRelay();
    const provider = fakeProvider({
      relay,
      async *script({ tools: line }) {
        await line.initialize();
        yield { type: 'status', text: 'Reading' };
        yield { type: 'status', text: 'Still reading' };
      },
    });
    const events = createMacAgents([provider], relay).run(
      'claude',
      request,
      tools,
      new AbortController().signal,
    );
    for await (const event of events) {
      expect(event).toEqual({ type: 'status', text: 'Reading' });
      break;
    }
    expect(relay.counts()).toEqual({ opened: 1, closed: 1 });
  });

  it('says so when this Mac has no such agent', async () => {
    const relay = fakeRelay();
    const events = await collect(
      createMacAgents([], relay).run('gemini', request, tools, new AbortController().signal),
    );
    expect(events).toEqual([{ type: 'error', message: 'There is no agent named gemini here.' }]);
    expect(relay.counts().opened).toBe(0);
  });

  it('fails out loud when the relay cannot open', async () => {
    const broken: HostRelay = { open: () => Promise.reject(new Error('no socket')) };
    const provider = fakeProvider({ relay: fakeRelay(), script: replies('Hi.') });
    const events = await collect(
      createMacAgents([provider], broken).run(
        'claude',
        request,
        tools,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([{ type: 'error', message: "Claude couldn't be started: no socket" }]);
    expect(provider.requests).toEqual([]);
  });
});
