// The MCP side of the toolbox, by hand: JSON-RPC 2.0 over lines of text, with the `tools`
// capability only. A line goes in and the line to send back comes out, or nothing for a
// notification. Nothing here throws, so one bad line from an agent can't end a run.

import { TOOL_DEFINITIONS, callTool } from './tools.ts';
import type { ToolContext } from './tools.ts';

/** The versions of the protocol this speaks, newest first. A client that asks for another is
 * answered with the newest. */
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

type Id = string | number | null;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const NO_METHOD = -32601;
const INVALID_PARAMS = -32602;

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
          protocolVersion: VERSIONS.find((version) => version === asked) ?? VERSIONS[0],
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
  };
}
