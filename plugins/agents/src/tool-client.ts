// The program's end of a line of MCP, on its own: it makes the calls a real agent makes (the
// handshake, then each tool) over whatever answers the lines. The fake provider's tests use it, and
// so does the website's scripted Claude, which is production code on the page.

import type { ToolLines } from '@redlines/plugin-api';

/** What a tool call came back with. */
export interface ToolAnswer {
  text: string;
  isError: boolean;
}

/** The program's end of the line. */
export interface FakeConnection {
  /** Sends one line of MCP and resolves to the answer, or null for a notification. */
  send(line: string): Promise<string | null>;
  /** The MCP handshake, which a real toolbox sees before any call. */
  initialize(): Promise<void>;
  /** Calls a tool and resolves to what it said; a refused call is an error too. */
  call(tool: string, args?: Record<string, unknown>): Promise<ToolAnswer>;
}

/**
 * The program's end of a line of MCP: `lines` answers each line sent (the toolbox's `answerMcp`, or
 * a relay's answer). It makes the calls as a real agent would.
 */
export function toolClient(lines: ToolLines): FakeConnection {
  let id = 0;
  const send = async (text: string) => lines(text);
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
}
