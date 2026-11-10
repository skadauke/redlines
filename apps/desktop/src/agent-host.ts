// What plugins get of the machine for running agents, through the app's Rust side
// (src-tauri/src/agents/): programs to find, run and stop, and the private line a program uses to
// reach the tools. A channel belongs to the window that asked, so each window hears only its own.

import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AcpHandle,
  AcpSpec,
  HostProcesses,
  HostRelay,
  McpEndpoint,
  ProcessHandle,
  ProcessSpec,
  ToolLines,
} from '@redlines/plugin-api';
import { findProgram, runProgram } from './agent-programs.ts';

export { acpAgents, commandLine, type AcpAgent } from './agent-programs.ts';

/** What the Rust side says about a run (`RunMessage` in agents/process.rs). */
type RunMessage =
  { kind: 'line'; line: string } | { kind: 'ended'; code: number | null; stderr: string };

/** Lines to be read one by one, as an async iterable, by one reader. */
function lineQueue(): { lines: AsyncIterable<string>; add(line: string): void; end(): void } {
  const waiting: string[] = [];
  let ended = false;
  let wake = () => {};
  return {
    add(line) {
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

/**
 * A program the Rust side has started with `command`, followed through a channel of this
 * window's: its lines, its end, and a way to stop it.
 */
async function startThrough(
  command: string,
  args: Record<string, unknown>,
): Promise<{ id: number; handle: ProcessHandle }> {
  const queue = lineQueue();
  let end: (ended: { code: number | null; stderr: string }) => void = () => {};
  const ended = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    end = resolve;
  });
  const onLine = new Channel<RunMessage>();
  onLine.onmessage = (message) => {
    if (message.kind === 'line') {
      queue.add(message.line);
    } else {
      queue.end();
      end({ code: message.code, stderr: message.stderr });
    }
  };
  const { id, log_path: logPath } = await invoke<{ id: number; log_path: string }>(command, {
    ...args,
    onLine,
  });
  return {
    id,
    handle: {
      lines: queue.lines,
      ended,
      stop() {
        invoke('agent_stop', { id }).catch((error: unknown) => {
          console.warn('Could not stop a run', error);
        });
      },
      logPath,
    },
  };
}

/** Programs on this machine, as the app's Rust side allows them. */
export function createProcesses(): HostProcesses {
  return {
    which: findProgram,
    exec: runProgram,
    async start(spec: ProcessSpec): Promise<ProcessHandle> {
      return (await startThrough('agent_start', { spec })).handle;
    },
    // By the agent's id: the Rust side knows its program and arguments, and checks every message.
    async startAcp(spec: AcpSpec): Promise<AcpHandle> {
      const { id, handle } = await startThrough('acp_start', { ...spec });
      return { ...handle, send: (line) => invoke('acp_send', { id, line }) };
    },
  };
}

/** What the Rust side says about a relay (`RelayMessage` in agents/relay.rs). */
type RelayMessage = { kind: 'connected' } | { kind: 'line'; line: string };

/**
 * The JSON-RPC error for a line whose answer threw, or null for a notification, which has no id and
 * nobody waiting on it. The agent then sees a tool call that failed, rather than waiting forever.
 * Any other line with an id gets the error too, even a response to something never asked: this has
 * only the line to go on, and a client ignores an error it wasn't waiting for.
 */
function internalError(line: string): string | null {
  let id: unknown = null;
  try {
    const message: unknown = JSON.parse(line);
    if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
      if (!('id' in message)) return null;
      id = message.id;
    }
  } catch {
    // Not JSON: there is no id to answer to.
  }
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } });
}

/** Whether a line is an MCP client's `initialize`. Most lines aren't, so most aren't parsed. */
function isInitialize(line: string): boolean {
  if (!line.includes('"initialize"')) return false;
  try {
    const message: unknown = JSON.parse(line);
    return (
      typeof message === 'object' &&
      message !== null &&
      'method' in message &&
      message.method === 'initialize'
    );
  } catch {
    return false;
  }
}

/** The way back from a program to the tools, as the app's Rust side provides it. */
export function createRelay(): HostRelay {
  return {
    async open(answer: ToolLines) {
      let connected = false;
      let initialized = false;
      let closed = false;
      // One line at a time, so that tool calls act on the document in the order they came.
      let turn = Promise.resolve();
      const onLine = new Channel<RelayMessage>();
      onLine.onmessage = (message) => {
        if (message.kind === 'connected') {
          connected = true;
          return;
        }
        if (isInitialize(message.line)) initialized = true;
        turn = turn.then(() => respond(message.line));
      };
      const opening = invoke<{ id: number; endpoint: McpEndpoint }>('relay_open', { onLine });

      async function respond(line: string): Promise<void> {
        if (closed) return;
        const reply = await Promise.resolve()
          .then(() => answer(line))
          .catch(() => internalError(line));
        if (reply === null || closed) return;
        const { id } = await opening;
        await invoke('relay_answer', { id, line: reply }).catch((error: unknown) => {
          console.warn('Could not answer through the relay', error);
        });
      }

      const { id, endpoint } = await opening;
      return {
        endpoint,
        connected: () => connected,
        initialized: () => initialized,
        close() {
          closed = true;
          invoke('relay_close', { id }).catch((error: unknown) => {
            console.warn('Could not close a relay', error);
          });
        },
      };
    },
  };
}
