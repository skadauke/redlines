import { describe, expect, it } from 'vitest';
import { parse } from '@redlines/format';
import { answerMcp } from './mcp.ts';
import { fakeContext, fakeDocument } from './test-helpers.ts';

function server() {
  const doc = fakeDocument();
  return { doc, ask: answerMcp(fakeContext(doc)) };
}

async function request(
  ask: (line: string) => Promise<string | null>,
  message: object,
): Promise<Record<string, unknown>> {
  const line = await ask(JSON.stringify(message));
  expect(line).not.toBeNull();
  expect(line).not.toContain('\n');
  return JSON.parse(line ?? 'null') as Record<string, unknown>;
}

describe('answerMcp', () => {
  it('answers initialize with the protocol version and the tools capability', async () => {
    const { ask } = server();
    const answer = await request(ask, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x' } },
    });
    expect(answer).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'redlines' },
      },
    });
  });

  it('offers its own version when the client asks for one it does not know', async () => {
    const { ask } = server();
    const answer = await request(ask, {
      jsonrpc: '2.0',
      id: 'a',
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    });
    expect(answer['result']).toMatchObject({ protocolVersion: '2025-06-18' });
  });

  it('lists the six tools', async () => {
    const { ask } = server();
    const answer = await request(ask, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (answer['result'] as { tools: { name: string; inputSchema: object }[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      'view',
      'read_thread',
      'str_replace',
      'comment',
      'reply',
      'status',
    ]);
    expect(tools[0]?.inputSchema).toMatchObject({ type: 'object' });
  });

  it('runs a tool', async () => {
    const { ask, doc } = server();
    const answer = await request(ask, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'str_replace', arguments: { old_str: 'March', new_str: 'April' } },
    });
    const result = answer['result'] as {
      content: { type: string; text: string }[];
      isError: boolean;
    };
    expect(result.isError).toBe(false);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toMatch(/^Suggested/);
    expect(parse(doc.text).marks).toHaveLength(1);
  });

  it('gives a tool error as a result with isError', async () => {
    const { ask } = server();
    const answer = await request(ask, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'status', arguments: { text: 'x'.repeat(41) } },
    });
    expect(answer['result']).toMatchObject({ isError: true });
    expect(answer['error']).toBeUndefined();
  });

  it('answers a tool call with no arguments', async () => {
    const { ask } = server();
    const answer = await request(ask, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'view' },
    });
    expect(answer['result']).toMatchObject({ isError: false });
  });

  it('gives no answer to a notification', async () => {
    const { ask } = server();
    expect(
      await ask(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })),
    ).toBeNull();
    expect(await ask(JSON.stringify({ jsonrpc: '2.0', method: 'no/such' }))).toBeNull();
  });

  it('gives an unknown method a JSON-RPC error', async () => {
    const { ask } = server();
    const answer = await request(ask, { jsonrpc: '2.0', id: 6, method: 'resources/list' });
    expect(answer).toMatchObject({ id: 6, error: { code: -32601 } });
  });

  it('answers ping', async () => {
    const { ask } = server();
    expect(await request(ask, { jsonrpc: '2.0', id: 7, method: 'ping' })).toMatchObject({
      id: 7,
      result: {},
    });
  });

  it('gives garbage a parse error without throwing', async () => {
    const { ask } = server();
    const answer = JSON.parse((await ask('{not json')) ?? 'null') as Record<string, unknown>;
    expect(answer).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
  });

  it('gives JSON that is not a request an invalid-request error', async () => {
    const { ask } = server();
    for (const line of ['42', '[]', '{"jsonrpc":"2.0","id":1}', 'null']) {
      const answer = JSON.parse((await ask(line)) ?? 'null') as Record<string, unknown>;
      expect(answer).toMatchObject({ error: { code: -32600 } });
    }
  });

  it('gives a request with an id of another kind an invalid-request error', async () => {
    const { ask } = server();
    for (const id of [{}, [], true, null]) {
      const line = await ask(JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }));
      expect(JSON.parse(line ?? 'null')).toMatchObject({ id: null, error: { code: -32600 } });
    }
  });

  it('answers a tool that throws something odd with a tool error', async () => {
    const doc = fakeDocument();
    const ctx = fakeContext(doc);
    ctx.now = () => {
      throw Object.create(null);
    };
    const ask = answerMcp(ctx);
    const line = await ask(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'str_replace', arguments: { old_str: 'March', new_str: 'April' } },
      }),
    );
    expect(JSON.parse(line ?? 'null')).toMatchObject({ id: 9, result: { isError: true } });
  });

  it('ignores a blank line', async () => {
    const { ask } = server();
    expect(await ask('  ')).toBeNull();
  });
});
