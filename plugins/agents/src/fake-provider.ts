// An agent and a relay in memory, for tests: the agent's "program" is a script that calls the
// tools over MCP, as a real agent does through `redlines mcp --relay`, and yields what a provider
// yields. Nothing here starts a program.

import type {
  AgentEvent,
  AgentProvider,
  AgentRequest,
  AgentState,
  HostRelay,
  McpEndpoint,
  ToolLines,
} from '@redlines/plugin-api';

/** What a tool call came back with. */
export interface ToolAnswer {
  text: string;
  isError: boolean;
}

/** The fake program's end of the relay. */
export interface FakeConnection {
  /** Sends one line of MCP and resolves to the answer, or null for a notification. */
  send(line: string): Promise<string | null>;
  /** The MCP handshake, which a real toolbox sees before any call. */
  initialize(): Promise<void>;
  /** Calls a tool and resolves to what it said; a refused call is an error too. */
  call(tool: string, args?: Record<string, unknown>): Promise<ToolAnswer>;
}

export interface FakeRelay extends HostRelay {
  /** Connects to the relay that `endpoint` names, as `redlines mcp --relay <socket>` would. */
  connect(endpoint: McpEndpoint): FakeConnection;
  /** How many relays were opened, and how many of them are closed. */
  counts(): { opened: number; closed: number };
}

export function fakeRelay(): FakeRelay {
  interface Line {
    answer: ToolLines;
    connected: boolean;
    initialized: boolean;
    closed: boolean;
  }
  const lines = new Map<string, Line>();
  return {
    open(answer) {
      const socket = `/fake/relay-${lines.size + 1}`;
      const line: Line = { answer, connected: false, initialized: false, closed: false };
      lines.set(socket, line);
      return Promise.resolve({
        endpoint: { command: '/fake/redlines', args: ['mcp', '--relay', socket] },
        connected: () => line.connected,
        initialized: () => line.initialized,
        close: () => {
          line.closed = true;
        },
      });
    },
    connect(endpoint) {
      const line = lines.get(endpoint.args.at(-1) ?? '');
      if (!line) throw new Error('No relay at that endpoint');
      let id = 0;
      const send = async (text: string) => {
        if (line.closed) throw new Error('The relay is closed');
        line.connected = true;
        if ((JSON.parse(text) as { method?: unknown }).method === 'initialize') {
          line.initialized = true;
        }
        return line.answer(text);
      };
      return {
        send,
        async initialize() {
          const params = { protocolVersion: '2025-06-18', capabilities: {} };
          await send(JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'initialize', params }));
          await send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
        },
        async call(tool, args = {}) {
          const params = { name: tool, arguments: args };
          const answer = await send(
            JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params }),
          );
          const message = JSON.parse(answer ?? '{}') as {
            result?: { content?: { text?: string }[]; isError?: boolean };
            error?: { message?: string };
          };
          if (message.error) return { text: message.error.message ?? '', isError: true };
          return {
            text: message.result?.content?.[0]?.text ?? '',
            isError: message.result?.isError === true,
          };
        },
      };
    },
    counts() {
      const all = [...lines.values()];
      return { opened: all.length, closed: all.filter((line) => line.closed).length };
    },
  };
}

/** One run of a fake agent: what it was asked, its tools, and the signal that stops it. */
export interface FakeRun {
  request: AgentRequest;
  tools: FakeConnection;
  signal: AbortSignal;
}

/** What a fake agent does in a run, yielding what a provider yields. */
export type FakeScript = (run: FakeRun) => AsyncIterable<AgentEvent>;

export interface FakeProvider extends AgentProvider {
  /** Every request it was asked to run, in order. */
  readonly requests: AgentRequest[];
  /** What the next runs do. */
  script: FakeScript;
}

/** An agent that answers each run with `script`, reaching the tools through `relay`. */
export function fakeProvider(options: {
  relay: FakeRelay;
  script: FakeScript;
  id?: string;
  name?: string;
  readLimit?: 'folder' | 'machine';
  state?: AgentState;
  /** How it is detected, for a test that holds detection; by default as `state` says, at once. */
  detect?: () => Promise<AgentState>;
}): FakeProvider {
  const provider: FakeProvider = {
    id: options.id ?? 'claude',
    name: options.name ?? 'Claude',
    readLimit: options.readLimit ?? 'folder',
    requests: [],
    script: options.script,
    detect:
      options.detect ?? (() => Promise.resolve(options.state ?? { found: true, signedIn: true })),
    run(request, tools, signal) {
      provider.requests.push(request);
      return provider.script({ request, tools: options.relay.connect(tools), signal });
    },
  };
  return provider;
}

/** A script that only reports `reported`, as an agent that never reaches its tools. */
export function events(...reported: AgentEvent[]): FakeScript {
  return async function* () {
    // One at a time, as a program's lines arrive.
    for (const event of reported) yield await Promise.resolve(event);
  };
}

/** A script that connects, replies with `text`, and is done. */
export function replies(text: string): FakeScript {
  return async function* ({ tools }) {
    await tools.initialize();
    await tools.call('reply', { text });
    yield { type: 'done' };
  };
}
