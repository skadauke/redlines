import { describe, expect, it } from 'vitest';
import type {
  AcpHandle,
  AcpSpec,
  AgentEvent,
  AgentRequest,
  HostProcesses,
  McpEndpoint,
} from '@redlines/plugin-api';
import { answerPermission, createAcpProvider, plugin } from './index.ts';

const tools: McpEndpoint = {
  command: '/Applications/Redlines.app/Contents/MacOS/redlines',
  args: ['mcp', '--relay', '/tmp/rl/s.sock'],
};
const config = {
  id: 'gemini',
  name: 'Gemini',
  command: '/opt/homebrew/bin/gemini',
  args: ['--experimental-acp'],
};
const request: AgentRequest = {
  prompt: 'Fix the spelling.',
  systemPrompt: 'Write like a margin comment.',
  thread: 't1',
  documentPath: '/p/doc.md',
  folder: '/p',
  scope: 'folder',
  author: { handle: 'gemini-bo', name: 'Gemini', for: 'bo' },
};

type Message = Record<string, unknown> & {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

/** What a fake agent can do while it answers a message. */
interface Agent {
  say(message: object | string): void;
  end(code?: number | null, stderr?: string): void;
}

/** Lines to read one by one, as an async iterable. */
function lineQueue() {
  const waiting: string[] = [];
  let ended = false;
  let wake = () => {};
  return {
    add(line: string) {
      waiting.push(line);
      wake();
    },
    end() {
      ended = true;
      wake();
    },
    lines: (async function* () {
      for (;;) {
        for (let line = waiting.shift(); line !== undefined; line = waiting.shift()) yield line;
        if (ended) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    })(),
  };
}

const update = (sessionUpdate: string, fields: object = {}) => ({
  jsonrpc: '2.0',
  method: 'session/update',
  params: { sessionId: 's1', update: { sessionUpdate, ...fields } },
});
const answer = (id: number | string | undefined, result: unknown) => ({
  jsonrpc: '2.0',
  id,
  result,
});

/** An agent that opens session `s1` and answers the prompt as `onPrompt` says. */
function agentThat(onPrompt: (message: Message, agent: Agent) => void) {
  return (message: Message, agent: Agent) => {
    if (message.method === 'initialize') agent.say(answer(message.id, { protocolVersion: 1 }));
    else if (message.method === 'session/new') agent.say(answer(message.id, { sessionId: 's1' }));
    else if (message.method === 'session/prompt') onPrompt(message, agent);
  };
}

/** A host whose only agent is the fake one, which answers each message `script` is sent. */
function fakeHost(
  script: (message: Message, agent: Agent) => void,
  refuse?: (m: Message) => boolean,
) {
  const sent: Message[] = [];
  const specs: AcpSpec[] = [];
  const execs: string[] = [];
  let stops = 0;
  const processes: HostProcesses = {
    which: () => Promise.resolve(null),
    exec(program, args) {
      execs.push(`${program} ${args.join(' ')}`);
      return Promise.resolve({ code: 0, stdout: '/var/folders/T/redlines-run.x\n' });
    },
    start: () => Promise.reject(new Error('not by a command line')),
    startAcp(spec): Promise<AcpHandle> {
      specs.push(spec);
      const queue = lineQueue();
      let end: (ending: { code: number | null; stderr: string }) => void = () => {};
      const ended = new Promise<{ code: number | null; stderr: string }>((resolve) => {
        end = resolve;
      });
      let over = false;
      const agent: Agent = {
        say: (message) =>
          queue.add(typeof message === 'string' ? message : JSON.stringify(message)),
        end(code = 0, stderr = '') {
          if (over) return;
          over = true;
          queue.end();
          end({ code, stderr });
        },
      };
      return Promise.resolve({
        lines: queue.lines,
        ended,
        stop() {
          stops++;
          agent.end(null);
        },
        logPath: '/logs/gemini.jsonl',
        send(line: string) {
          const message = JSON.parse(line) as Message;
          if (refuse?.(message)) return Promise.reject(new Error('Redlines won’t send that.'));
          sent.push(message);
          // As a real agent, later: never inside the call that sent it.
          queueMicrotask(() => script(message, agent));
          return Promise.resolve();
        },
      });
    },
  };
  return { processes, sent, specs, execs, stops: () => stops };
}

async function eventsOf(
  processes: HostProcesses,
  options: { request?: AgentRequest; abortOn?: (event: AgentEvent) => boolean } = {},
): Promise<AgentEvent[]> {
  const provider = createAcpProvider(processes, config, {
    emptyFolder: () => Promise.resolve('/var/folders/T/redlines-run.x'),
    removeFolder: () => Promise.resolve(),
  });
  const abort = new AbortController();
  const events: AgentEvent[] = [];
  for await (const event of provider.run(options.request ?? request, tools, abort.signal)) {
    events.push(event);
    if (options.abortOn?.(event)) abort.abort();
  }
  return events;
}

describe('the Agent Client Protocol provider', () => {
  it('shakes hands, opens a session with the toolbox and sends the prompt', async () => {
    const host = fakeHost(
      agentThat((message, agent) => agent.say(answer(message.id, { stopReason: 'end_turn' }))),
    );
    const events = await eventsOf(host.processes);
    expect(host.specs).toEqual([
      { agent: 'gemini', cwd: '/p', log: { agent: 'gemini', thread: 't1', document: '/p/doc.md' } },
    ]);
    expect(host.sent.map((message) => message.method)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
    ]);
    expect(host.sent[0]).toEqual({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      },
    });
    expect(host.sent[1]?.params).toEqual({
      cwd: '/p',
      mcpServers: [{ name: 'redlines', command: tools.command, args: tools.args, env: [] }],
    });
    expect(host.sent[2]?.params).toEqual({
      sessionId: 's1',
      prompt: [
        { type: 'text', text: 'Write like a margin comment.' },
        { type: 'text', text: 'Fix the spelling.' },
      ],
    });
    expect(events).toEqual([
      { type: 'started', logPath: '/logs/gemini.jsonl' },
      { type: 'status', text: 'Thinking…' },
      { type: 'done' },
    ]);
    // An agent keeps running after its turn: the run stops it.
    expect(host.stops()).toBe(1);
  });

  it('runs at This document in an empty folder of its own', async () => {
    const host = fakeHost(
      agentThat((message, agent) => agent.say(answer(message.id, { stopReason: 'end_turn' }))),
    );
    await eventsOf(host.processes, { request: { ...request, scope: 'document' } });
    expect(host.specs[0]?.cwd).toBe('/var/folders/T/redlines-run.x');
    expect(host.sent[1]?.params?.['cwd']).toBe('/var/folders/T/redlines-run.x');
  });

  it('turns tool calls into status lines, and end_turn into done with the last message', async () => {
    const host = fakeHost(
      agentThat((message, agent) => {
        agent.say(
          update('agent_message_chunk', { content: { type: 'text', text: 'Let me look.' } }),
        );
        agent.say(
          update('tool_call', {
            toolCallId: 'read_thread-1730000000000',
            title: '{"thread":"c1"}',
            kind: 'other',
          }),
        );
        agent.say(
          update('tool_call', {
            toolCallId: 'view-1730000000001',
            title: '{"thread":"c1"}',
            kind: 'other',
          }),
        );
        agent.say(
          update('tool_call', { toolCallId: 'status-1730000000002', title: '{}', kind: 'other' }),
        );
        // A title is the agent's words, but only as they show.
        agent.say(
          update('tool_call', {
            toolCallId: 'e',
            title: 'Reading\u202E notes\u200B.md\u2028\u2066',
            kind: 'read',
          }),
        );
        // Claude's naming is just words to Gemini's provider.
        agent.say(
          update('tool_call', { toolCallId: 'f', title: 'mcp__redlines__view', kind: 'other' }),
        );
        agent.say(
          update('tool_call', {
            toolCallId: 'c',
            title: 'Searching the folder for every mention of the old name',
            kind: 'search',
          }),
        );
        agent.say(update('tool_call', { toolCallId: 'd', title: '{"x":1}', kind: 'execute' }));
        agent.say(update('tool_call_update', { toolCallId: 'd', status: 'completed' }));
        agent.say(update('agent_thought_chunk', { content: { type: 'text', text: 'hmm' } }));
        agent.say(update('agent_message_chunk', { content: { type: 'text', text: 'Fixed ' } }));
        agent.say(update('agent_message_chunk', { content: { type: 'text', text: 'two typos.' } }));
        agent.say(answer(message.id, { stopReason: 'end_turn' }));
      }),
    );
    const events = await eventsOf(host.processes);
    expect(events.slice(1)).toEqual([
      { type: 'status', text: 'Thinking…' },
      { type: 'status', text: 'Reading the thread' },
      { type: 'status', text: 'Reading the document' },
      { type: 'status', text: 'Reading notes.md' },
      { type: 'status', text: 'mcp__redlines__view' },
      { type: 'status', text: 'Searching the folder for every mention…' },
      { type: 'status', text: 'Running a command' },
      { type: 'done', finalText: 'Fixed two typos.' },
    ]);
  });

  it('answers a permission: the toolbox and reads in the folder yes, anything else no', async () => {
    const options = [
      { optionId: 'once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'always', name: 'Always Allow', kind: 'allow_always' },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' },
    ];
    // As Gemini offers them for a tool of an MCP server.
    const gemini = (server: string, tool: string) => [
      { optionId: 'server', name: `Always Allow ${server}`, kind: 'allow_always' },
      { optionId: 'tool', name: `Always Allow ${tool}`, kind: 'allow_always' },
      ...options,
    ];
    const ask = (id: number, toolCall: object, offered: object[] = options) => ({
      jsonrpc: '2.0',
      id,
      method: 'session/request_permission',
      params: {
        sessionId: 's1',
        toolCall: { toolCallId: `t${id}`, ...toolCall },
        options: offered,
      },
    });
    const host = fakeHost(
      agentThat((message, agent) => {
        agent.say(
          ask(100, { title: '{"text":"x"}', kind: 'other' }, gemini('redlines', 'comment')),
        );
        agent.say(ask(105, { title: '{}', kind: 'other' }, gemini('github', 'comment')));
        agent.say(ask(106, { title: 'mcp__redlines__comment', kind: 'other' }));
        agent.say(ask(101, { title: 'rm -rf ~', kind: 'execute' }));
        agent.say(ask(102, { title: 'Read', kind: 'read', locations: [{ path: '/p/notes.md' }] }));
        agent.say(ask(103, { title: 'Read', kind: 'read', locations: [{ path: '/etc/passwd' }] }));
        agent.say(ask(104, { title: 'Edit', kind: 'edit', locations: [{ path: '/p/notes.md' }] }));
        agent.say(answer(message.id, { stopReason: 'end_turn' }));
      }),
    );
    const events = await eventsOf(host.processes);
    const answers: Record<string, unknown> = Object.fromEntries(
      host.sent
        .filter((message) => message.method === undefined)
        .map((message): [string, unknown] => [String(message.id), message.result]),
    );
    const chose = (optionId: string) => ({ outcome: { outcome: 'selected', optionId } });
    expect(answers).toEqual({
      100: chose('once'),
      101: chose('no'),
      102: chose('once'),
      103: chose('no'),
      104: chose('no'),
      105: chose('no'),
      106: chose('no'),
    });
    expect(events.filter((event) => event.type === 'status').map((event) => event.text)).toEqual([
      'Thinking…',
      'Refused a request',
      'Refused a request',
      'Refused to run a command',
      'Refused a read outside the folder',
      'Refused to change a file',
    ]);
  });

  it('refuses what the host won’t let it allow, rather than leave the agent waiting', async () => {
    const options = [
      { optionId: 'once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' },
    ];
    const host = fakeHost(
      agentThat((message, agent) => {
        agent.say({
          jsonrpc: '2.0',
          id: 9,
          method: 'session/request_permission',
          params: {
            sessionId: 's1',
            toolCall: { toolCallId: 'r', kind: 'read', locations: [{ path: '/p/link.md' }] },
            options,
          },
        });
        agent.say(answer(message.id, { stopReason: 'end_turn' }));
      }),
      // As the Rust side does for a link inside the folder that leads out of it.
      (message) => JSON.stringify(message.result ?? null).includes('"once"'),
    );
    const events = await eventsOf(host.processes);
    // The refusal goes once the host has said no, which is after the turn here.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.sent.find((message) => message.id === 9)?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'no' },
    });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('refuses with cancelled when there is no option to refuse with, and never allows always', () => {
    const toolbox = { toolCallId: 'view-1', title: '{}', kind: 'other' };
    expect(
      answerPermission(
        {
          sessionId: 's1',
          toolCall: toolbox,
          options: [
            { optionId: 'a', name: 'Always Allow redlines', kind: 'allow_always' },
            { optionId: 'b', name: 'Always Allow view', kind: 'allow_always' },
          ],
        },
        '/p',
      ),
    ).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(answerPermission({ sessionId: 's1', toolCall: toolbox }, '/p')).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(answerPermission('garbage', '/p')).toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('answers what it does not do with an error, and ignores garbage', async () => {
    const host = fakeHost(
      agentThat((message, agent) => {
        agent.say('not json at all');
        agent.say('[1, 2, 3]');
        agent.say('{"jsonrpc":"2.0","method":"session/update","params":"x"}');
        agent.say(update('plan', { entries: [] }));
        agent.say(update('tool_call', { toolCallId: 'x' }));
        agent.say(answer(77, { stopReason: 'end_turn' }));
        agent.say({
          jsonrpc: '2.0',
          id: 'r1',
          method: 'fs/read_text_file',
          params: { path: '/etc/passwd' },
        });
        agent.say({ jsonrpc: '2.0', id: 'r2', method: 'terminal/create', params: {} });
        agent.say(answer(message.id, { stopReason: 'end_turn' }));
      }),
    );
    const events = await eventsOf(host.processes);
    expect(events.at(-1)).toEqual({ type: 'done' });
    const errors = host.sent.filter((message) => message.error !== undefined);
    expect(errors.map((message) => message.id)).toEqual(['r1', 'r2']);
    expect(errors[0]?.error).toEqual({ code: -32601, message: 'Method not found' });
  });

  it('says session/cancel on Stop, then stops the agent', async () => {
    const host = fakeHost(
      agentThat((message, agent) => {
        agent.say(update('tool_call', { toolCallId: 'view-1', title: '{}', kind: 'other' }));
        // The turn goes on until it is cancelled.
        void message;
        void agent;
      }),
    );
    const events = await eventsOf(host.processes, {
      abortOn: (event) => event.type === 'status' && event.text === 'Reading the document',
    });
    expect(host.sent.at(-1)).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 's1' },
    });
    expect(host.stops()).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Stopped.' });
  });

  it('says in one line why a turn ended without an answer', async () => {
    const endsWith = async (result: unknown, error?: unknown) => {
      const host = fakeHost(
        agentThat((message, agent) =>
          agent.say(
            error === undefined
              ? answer(message.id, result)
              : { jsonrpc: '2.0', id: message.id, error },
          ),
        ),
      );
      return (await eventsOf(host.processes)).at(-1);
    };
    expect(await endsWith({ stopReason: 'max_tokens' })).toEqual({
      type: 'error',
      message: 'Gemini stopped: it ran out of room.',
    });
    expect(await endsWith({ stopReason: 'max_turn_requests' })).toEqual({
      type: 'error',
      message: 'Gemini stopped: it took too many turns.',
    });
    expect(await endsWith({ stopReason: 'refusal' })).toEqual({
      type: 'error',
      message: 'Gemini refused.',
    });
    expect(await endsWith({ stopReason: 'cancelled' })).toEqual({
      type: 'error',
      message: 'Stopped.',
    });
    expect(await endsWith(undefined, { code: -32603, message: 'Quota exceeded\nmore' })).toEqual({
      type: 'error',
      message: 'Gemini stopped: Quota exceeded',
    });
    // As long as stderr's last line may be, and only as it shows.
    const long = await endsWith(undefined, { code: 1, message: `\u202E${'x'.repeat(300)}` });
    expect(long).toEqual({ type: 'error', message: `Gemini stopped: ${'x'.repeat(199)}…` });
  });

  it('says plainly when the agent needs signing in, or speaks another version', async () => {
    const signedOut = fakeHost((message, agent) => {
      if (message.method === 'initialize') agent.say(answer(message.id, { protocolVersion: 1 }));
      else
        agent.say({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: 'Authentication required' },
        });
    });
    expect((await eventsOf(signedOut.processes)).at(-1)).toEqual({
      type: 'error',
      message: 'Gemini isn’t signed in. Sign in with its own command, then try again.',
    });
    const newer = fakeHost((message, agent) =>
      agent.say(answer(message.id, { protocolVersion: 2 })),
    );
    expect((await eventsOf(newer.processes)).at(-1)).toEqual({
      type: 'error',
      message: 'Gemini speaks a version of the Agent Client Protocol that Redlines doesn’t.',
    });
  });

  it('ends with a line when the host refuses a message, rather than waiting forever', async () => {
    const host = fakeHost(
      agentThat((message, agent) => agent.say(answer(message.id, { stopReason: 'end_turn' }))),
      (message) => message.method === 'session/new',
    );
    const events = await eventsOf(host.processes);
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: 'Gemini couldn’t be reached: Redlines won’t send that.',
    });
  });

  it('fails in one line when the agent ends early', async () => {
    const host = fakeHost((_message, agent) => agent.end(1, 'Error: no such flag\n'));
    expect((await eventsOf(host.processes)).at(-1)).toEqual({
      type: 'error',
      message: 'Gemini stopped: Error: no such flag',
    });
  });

  it('is found where the host can start it, and reads the machine', async () => {
    const host = fakeHost(() => {});
    const provider = createAcpProvider(host.processes, config);
    expect(provider.id).toBe('gemini');
    expect(provider.name).toBe('Gemini');
    expect(provider.readLimit).toBe('machine');
    expect(await provider.detect()).toEqual({ found: true, signedIn: true });

    const without: HostProcesses = { ...host.processes, startAcp: undefined };
    const elsewhere = createAcpProvider(without, config);
    expect((await elsewhere.detect()).found).toBe(false);
    const events: AgentEvent[] = [];
    for await (const event of elsewhere.run(request, tools, new AbortController().signal)) {
      events.push(event);
    }
    expect(events.at(-1)?.type).toBe('error');
    expect(plugin.manifest.id).toBe('redlines.agent-acp');
  });
});
