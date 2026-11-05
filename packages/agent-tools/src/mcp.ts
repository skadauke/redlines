// The MCP side of the toolbox, by hand: JSON-RPC 2.0 over lines of text, with the `tools`
// capability only. A line goes in and the line to send back comes out, or nothing for a
// notification. Nothing here throws, so one bad line from an agent can't end a run. A method this
// doesn't know gets -32601, which is how Claude's `server/discover` probe learns to use the old way.
// `_meta`, which both clients send, is ignored.

import { TOOL_DEFINITIONS, callTool } from './tools.ts';
import type { ToolContext } from './tools.ts';

/** The version of the protocol to offer a client that names none. One that does is answered with
 * its own: Claude and Codex ask for different ones, and this takes what both of them send. */
const VERSION = '2025-06-18';

type Id = string | number | null;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const NO_METHOD = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function result(id: Id, value: object): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result: value });
}

function failure(id: Id, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Answers lines of MCP for the tools that act on `ctx`. */
export function answerMcp(ctx: ToolContext): (line: string) => Promise<string | null> {
  return async (line) => {
    try {
      return await answer(line);
    } catch {
      return failure(null, INTERNAL_ERROR, 'Internal error');
    }
  };

  async function answer(line: string): Promise<string | null> {
    if (line.trim() === '') return null;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return failure(null, PARSE_ERROR, 'Parse error');
    }
    if (!isRecord(message)) return failure(null, INVALID_REQUEST, 'Invalid request');
    const { id, method, params } = message;
    const hasId = typeof id === 'string' || typeof id === 'number';
    // An id is a string or a number. Another kind of id is no request, and has none to answer to.
    if ('id' in message && !hasId) return failure(null, INVALID_REQUEST, 'Invalid request');
    if (typeof method !== 'string') {
      // A response to something this never asked, or no request at all.
      return 'result' in message || 'error' in message
        ? null
        : failure(hasId ? id : null, INVALID_REQUEST, 'Invalid request');
    }
    if (!hasId) return null; // a notification, such as notifications/initialized

    switch (method) {
      case 'initialize': {
        const asked = isRecord(params) ? params['protocolVersion'] : undefined;
        return result(id, {
          protocolVersion: typeof asked === 'string' && asked !== '' ? asked : VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'redlines', version: '0.0.0' },
        });
      }
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, { tools: TOOL_DEFINITIONS });
      case 'tools/call': {
        if (!isRecord(params) || typeof params['name'] !== 'string') {
          return failure(id, INVALID_PARAMS, 'tools/call needs the name of a tool');
        }
        const done = await callTool(ctx, params['name'], params['arguments']);
        return result(id, { content: [{ type: 'text', text: done.text }], isError: done.isError });
      }
      default:
        return failure(id, NO_METHOD, `Method not found: ${method}`);
    }
  }
}
