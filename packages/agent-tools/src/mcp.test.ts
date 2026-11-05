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

  it('answers with the version the client asked for, whichever it is', async () => {
    const { ask } = server();
    for (const protocolVersion of ['2025-11-25', '2026-07-28', '1999-01-01']) {
      const answer = await request(ask, {
        jsonrpc: '2.0',
        id: 'a',
        method: 'initialize',
        params: { protocolVersion },
      });
      expect(answer['result']).toMatchObject({ protocolVersion });
    }
  });

  it('offers a version of its own to a client that names none', async () => {
    const { ask } = server();
    for (const params of [{}, { protocolVersion: 7 }, { protocolVersion: '' }]) {
      const answer = await request(ask, { jsonrpc: '2.0', id: 1, method: 'initialize', params });
      expect(answer['result']).toMatchObject({ protocolVersion: '2025-06-18' });
    }
    const answer = await request(ask, { jsonrpc: '2.0', id: 2, method: 'initialize' });
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

// Real messages, from real runs: docs/superpowers/plans/2026-11-05-v0.2-spike-findings.md, "The
// relay". The two clients don't speak alike.
describe('answerMcp, with the clients it serves', () => {
  /** Plays a client's messages in order, and gives what came back for each. */
  async function play(lines: string[]) {
    const { ask, doc } = server();
    const answers: (Record<string, unknown> | null)[] = [];
    for (const line of lines) {
      const answer = await ask(line);
      answers.push(answer === null ? null : (JSON.parse(answer) as Record<string, unknown>));
    }
    return { answers, doc };
  }

  it('takes Claude, which probes first with a string id', async () => {
    const { answers } = await play([
      '{"jsonrpc":"2.0","id":"server-discover-probe-1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}',
      '{"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"roots":{"listChanged":true},"elicitation":{"form":{},"url":{}}},"clientInfo":{"name":"claude-code","version":"2.1.318"}},"jsonrpc":"2.0","id":0}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"method":"tools/list","jsonrpc":"2.0","id":1}',
      '{"method":"tools/call","params":{"name":"status","arguments":{"text":"Reading the folder"},"_meta":{"claudecode/toolUseId":"toolu_1","progressToken":2}},"jsonrpc":"2.0","id":2}',
    ]);
    // -32601 is how Claude learns to use the old way. It then goes on.
    expect(answers[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 'server-discover-probe-1',
      error: { code: -32601 },
    });
    expect(answers[1]).toMatchObject({
      id: 0,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'redlines' },
      },
    });
    expect(answers[2]).toBeNull();
    expect(answers[3]).toMatchObject({ id: 1, result: { tools: expect.any(Array) as unknown } });
    expect(answers[4]).toMatchObject({ id: 2, result: { isError: false } });
  });

  it('takes Codex, which asks for another version and sends _meta elsewhere', async () => {
    const { answers } = await play([
      '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"experimental":{"codex/auth-change":{}},"elicitation":{"form":{},"url":{}}},"clientInfo":{"name":"codex-mcp-client","title":"Codex","version":"0.166.0"}}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"progressToken":0}}}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"_meta":{"callId":"exec-1"},"name":"status","arguments":{"text":"Reading"}}}',
    ]);
    expect(answers[0]).toMatchObject({ id: 0, result: { protocolVersion: '2025-06-18' } });
    expect(answers[1]).toBeNull();
    expect(answers[2]).toMatchObject({ id: 1, result: { tools: expect.any(Array) as unknown } });
    expect(answers[3]).toMatchObject({ id: 2, result: { isError: false } });
  });
});
