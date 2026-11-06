import type {
  AgentEvent,
  AgentProvider,
  AgentRequest,
  HostRelay,
  ToolLines,
} from '@redlines/plugin-api';
import { describe, expect, it, vi } from 'vitest';
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

  it('keeps what it found for a minute, and looks again after that or when told to forget', async () => {
    const relay = fakeRelay();
    const provider = fakeProvider({ relay, script: replies('Hi.') });
    const detect = vi.spyOn(provider, 'detect');
    let now = 1_000;
    const agents = createMacAgents([provider], relay, { now: () => now });
    await Promise.all([agents.list(), agents.list()]);
    expect(detect).toHaveBeenCalledTimes(1);
    now += 59_000;
    await agents.list();
    expect(detect).toHaveBeenCalledTimes(1);
    now += 2_000;
    await agents.list();
    expect(detect).toHaveBeenCalledTimes(2);
    agents.forget();
    await agents.list();
    expect(detect).toHaveBeenCalledTimes(3);
  });

  it('looks again after a run that failed, which may have been for sign-in', async () => {
    const relay = fakeRelay();
    const provider = fakeProvider({
      relay,
      script: only({ type: 'error', message: "Claude isn't signed in. Run `claude auth login`." }),
    });
    const detect = vi.spyOn(provider, 'detect');
    const agents = createMacAgents([provider], relay);
    await agents.list();
    await collect(agents.run('claude', request, tools, new AbortController().signal));
    await agents.list();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('passes on where the program writes its log, and goes on', async () => {
    const relay = fakeRelay();
    const provider = fakeProvider({
      relay,
      async *script({ tools: line }) {
        yield { type: 'started', logPath: '/logs/run.jsonl' };
        await line.initialize();
        yield { type: 'done' };
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
    expect(events).toEqual([{ type: 'started', logPath: '/logs/run.jsonl' }, { type: 'done' }]);
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

  it('adds the agents of a list the host keeps, as that list is at each look', async () => {
    const relay = fakeRelay();
    let more = [fakeProvider({ relay, id: 'gemini', name: 'Gemini', script: replies('Hi.') })];
    const agents = createMacAgents([fakeProvider({ relay, script: replies('Hi.') })], relay, {
      more: () => Promise.resolve(more),
    });
    expect((await agents.list()).map(({ id }) => id)).toEqual(['claude', 'gemini']);
    const gemini = await collect(
      agents.run('gemini', request, tools, new AbortController().signal),
    );
    expect(gemini.at(-1)?.type).toBe('done');

    // One added since: it runs without waiting for the next look, and the next look lists it.
    more = [...more, fakeProvider({ relay, id: 'goose', name: 'Goose', script: replies('Hi.') })];
    const goose = await collect(agents.run('goose', request, tools, new AbortController().signal));
    expect(goose.at(-1)?.type).toBe('done');
    agents.forget();
    expect((await agents.list()).map(({ id }) => id)).toEqual(['claude', 'gemini', 'goose']);

    // A list that can't be read leaves the providers the app has.
    const failing = createMacAgents([fakeProvider({ relay, script: replies('Hi.') })], relay, {
      more: () => Promise.reject(new Error('no list')),
    });
    expect((await failing.list()).map(({ id }) => id)).toEqual(['claude']);
  });
});
