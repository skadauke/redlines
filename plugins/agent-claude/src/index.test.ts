import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  AgentEvent,
  AgentRequest,
  HostProcesses,
  McpEndpoint,
  ProcessSpec,
} from '@redlines/plugin-api';
import {
  claudeArgs,
  createClaudeProvider,
  newClaudeState,
  parseClaudeLine,
  plugin,
  SIGNED_OUT_HELP,
} from './index.ts';

const endpoint: McpEndpoint = {
  command: '/Applications/Redlines.app/Contents/MacOS/redlines',
  args: ['mcp', '--relay', '/tmp/rl/s.sock'],
};
const author = { handle: 'claude-bo', name: 'Claude', for: 'bo' };
const folderRequest: AgentRequest = {
  prompt: 'Fix the spelling.',
  systemPrompt: 'Write like a margin comment.',
  thread: 't1',
  documentPath: '/p/doc.md',
  folder: '/p',
  scope: 'folder',
  author,
};
const documentRequest: AgentRequest = { ...folderRequest, scope: 'document' };

function valueOf(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
}

function fixture(name: string): string[] {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return readFileSync(url, 'utf8').split('\n').filter(Boolean);
}

function eventsOf(lines: string[]): AgentEvent[] {
  const state = newClaudeState();
  return lines.flatMap((line) => {
    const event = parseClaudeLine(line, state);
    return event ? [event] : [];
  });
}

function toolUse(name: string, input: unknown): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'toolu_1', name, input }] },
  });
}

interface FakeOptions {
  which?: string | null;
  exec?: (program: string, args: string[]) => { code: number | null; stdout: string };
  lines?: string[];
  code?: number | null;
  stderr?: string;
  hang?: boolean;
}

function fakeProcesses(options: FakeOptions = {}) {
  const calls: string[] = [];
  const specs: ProcessSpec[] = [];
  let stopped = 0;
  const processes: HostProcesses = {
    which(program) {
      calls.push(`which ${program}`);
      return Promise.resolve(options.which === undefined ? '/usr/local/bin/claude' : options.which);
    },
    exec(program, args) {
      calls.push(`exec ${program} ${args.join(' ')}`);
      return Promise.resolve((options.exec ?? (() => ({ code: 0, stdout: '' })))(program, args));
    },
    start(spec) {
      calls.push(`start ${spec.program}`);
      specs.push(spec);
      let release: () => void = () => {};
      const released = new Promise<void>((resolve) => (release = resolve));
      let killed = false;
      return Promise.resolve({
        lines: (async function* () {
          for (const line of options.lines ?? []) yield line;
          if (options.hang) await released;
        })(),
        ended: (async () => {
          if (options.hang) await released;
          return { code: killed ? null : (options.code ?? 0), stderr: options.stderr ?? '' };
        })(),
        stop() {
          stopped += 1;
          killed = true;
          release();
        },
        logPath: '/logs/run.jsonl',
      });
    },
  };
  return { processes, calls, specs, stopped: () => stopped };
}

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('claudeArgs', () => {
  it('passes the flags that keep a run safe', () => {
    const args = claudeArgs(folderRequest, endpoint);
    expect(args).toEqual(
      expect.arrayContaining([
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'dontAsk',
        '--strict-mcp-config',
        '--restricted',
      ]),
    );
    expect(valueOf(args, '--output-format')).toBe('stream-json');
    expect(valueOf(args, '--permission-mode')).toBe('dontAsk');
    expect(valueOf(args, '--tools')).toBe('Read,Grep,Glob');
    expect(valueOf(args, '--settings')).toBe('{"disableAllHooks":true}');
    expect(args).not.toContain('--bare');
    expect(args).not.toContain('--setting-sources');
  });

  it('carries the prompt, the voice and the toolbox', () => {
    const args = claudeArgs(folderRequest, endpoint);
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe('Fix the spelling.');
    expect(args.filter((arg) => arg === '-p')).toHaveLength(1);
    expect(valueOf(args, '--append-system-prompt')).toBe('Write like a margin comment.');
    expect(JSON.parse(valueOf(args, '--mcp-config') ?? '')).toEqual({
      mcpServers: { redlines: { command: endpoint.command, args: endpoint.args } },
    });
  });

  it('allows the six toolbox tools and nothing else', () => {
    const allowed = (valueOf(claudeArgs(folderRequest, endpoint), '--allowedTools') ?? '').split(
      ',',
    );
    expect(allowed).toEqual(
      ['view', 'read_thread', 'str_replace', 'comment', 'reply', 'status'].map(
        (tool) => `mcp__redlines__${tool}`,
      ),
    );
  });

  it('never allows a bare Read, which would reach outside the folder', () => {
    expect(valueOf(claudeArgs(folderRequest, endpoint), '--allowedTools')).not.toMatch(
      /(^|,)Read(,|$)/,
    );
  });

  it('gives no read tools at This document', () => {
    expect(valueOf(claudeArgs(documentRequest, endpoint), '--tools')).toBe('');
  });
});

describe('parseClaudeLine', () => {
  it('says what a read tool is reading', () => {
    const state = newClaudeState();
    expect(parseClaudeLine(toolUse('Read', { file_path: '/p/src/importer.ts' }), state)).toEqual({
      type: 'status',
      text: 'Reading importer.ts',
    });
    expect(parseClaudeLine(toolUse('Grep', { pattern: 'x' }), state)).toEqual({
      type: 'status',
      text: 'Searching',
    });
  });

  it('keeps a status line within 40 characters', () => {
    const event = parseClaudeLine(
      toolUse('Read', { file_path: `/p/${'a'.repeat(80)}.ts` }),
      newClaudeState(),
    );
    expect(event?.type === 'status' && event.text.length).toBeLessThanOrEqual(40);
  });

  it('says Thinking… for a thinking block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'hm' }] },
    });
    expect(parseClaudeLine(line, newClaudeState())).toEqual({ type: 'status', text: 'Thinking…' });
  });

  it('leaves the status tool to the relay', () => {
    expect(
      parseClaudeLine(toolUse('mcp__redlines__status', { text: 'Reading' }), newClaudeState()),
    ).toBeNull();
  });

  it('turns the stream of a successful run into statuses and one done', () => {
    const events = eventsOf(fixture('scripted-toolbox-only.jsonl'));
    expect(events.at(-1)).toEqual({ type: 'done', finalText: 'Done.' });
    expect(events.filter((event) => event.type !== 'status')).toHaveLength(1);
  });

  it('reads a real folder run', () => {
    const events = eventsOf(fixture('scripted-folder-run.jsonl'));
    expect(events.some((event) => event.type === 'status' && /^Reading /.test(event.text))).toBe(
      true,
    );
    expect(events.at(-1)?.type).toBe('done');
  });

  it('is not troubled by a refused read, an unknown event or a line that is not JSON', () => {
    const state = newClaudeState();
    const denied = JSON.stringify({
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Read',
      message: 'outside',
    });
    expect(parseClaudeLine(denied, state)).toBeNull();
    expect(parseClaudeLine('{"type":"system","subtype":"ui_invalidate"}', state)).toBeNull();
    expect(parseClaudeLine('{"type":"brand_new"}', state)).toBeNull();
    expect(parseClaudeLine('not json', state)).toBeNull();
    expect(parseClaudeLine('', state)).toBeNull();
    expect(parseClaudeLine('[1]', state)).toBeNull();
    expect(eventsOf(fixture('scripted-dontask-denials.jsonl')).at(-1)?.type).toBe('done');
  });

  it('counts an is_error result as a failure, though its subtype says success', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Something broke',
    });
    expect(parseClaudeLine(line, newClaudeState())).toEqual({
      type: 'error',
      message: 'Claude stopped: Something broke',
    });
  });

  it('turns an expired sign-in into the sign-in line', () => {
    const events = eventsOf(fixture('real-sign-in-expired.jsonl')).filter(
      (event) => event.type !== 'status',
    );
    expect(events).toEqual([
      { type: 'error', message: `Claude isn't signed in. ${SIGNED_OUT_HELP}` },
    ]);
  });

  it.each([
    ['401', 'authentication_failed', "Claude isn't signed in. Run `claude auth login`."],
    ['429', 'rate_limit', 'Claude has hit its usage limit. Try again later.'],
    ['500', 'server_error', "Claude's service had an error. Try again in a minute."],
    ['529', 'overloaded', 'Claude is overloaded right now. Try again in a minute.'],
  ])('maps a %s retry (%s) to one line', (status, kind, message) => {
    const lines = fixture(`scripted-retry-${status}.jsonl`);
    const retry = lines.find((line) => line.includes('api_retry')) ?? '';
    expect(retry).toContain(kind);
    expect(parseClaudeLine(retry, newClaudeState())).toEqual({ type: 'error', message });
    expect(eventsOf(lines).at(-1)).toEqual({ type: 'error', message });
  });

  it('counts a toolbox that is not connected as a failure', () => {
    const events = eventsOf(fixture('scripted-toolbox-wont-start.jsonl'));
    expect(events[0]).toEqual({
      type: 'error',
      message: "Claude couldn't start Redlines' tools. Try again, or restart Redlines.",
    });
  });

  it('accepts a connected toolbox', () => {
    const [init] = fixture('scripted-toolbox-only.jsonl');
    expect(parseClaudeLine(init ?? '', newClaudeState())).toEqual({
      type: 'status',
      text: 'Thinking…',
    });
  });
});

describe('detect', () => {
  const version = (stdout = '2.1.318 (Claude Code)\n') => ({ code: 0, stdout });

  it('says when Claude Code is not installed', async () => {
    const { processes } = fakeProcesses({ which: null });
    const state = await createClaudeProvider(processes).detect();
    expect(state.found).toBe(false);
    expect(!state.found && state.help).toMatch(/install/i);
  });

  it('is signed in when auth status says so', async () => {
    const { processes } = fakeProcesses({
      exec: (_, args) =>
        args[0] === '--version'
          ? version()
          : { code: 0, stdout: '{"loggedIn":true,"authMethod":"claude.ai"}' },
    });
    expect(await createClaudeProvider(processes).detect()).toEqual({
      found: true,
      signedIn: true,
      version: '2.1.318',
    });
  });

  it('is signed out on exit code 1', async () => {
    const { processes } = fakeProcesses({
      exec: (_, args) =>
        args[0] === '--version' ? version() : { code: 1, stdout: '{"loggedIn":false}' },
    });
    expect(await createClaudeProvider(processes).detect()).toEqual({
      found: true,
      signedIn: false,
      reason: 'signed-out',
      version: '2.1.318',
      help: 'Run `claude auth login`.',
    });
  });

  it('is signed out on loggedIn false, whatever the exit code', async () => {
    const { processes } = fakeProcesses({
      exec: (_, args) =>
        args[0] === '--version' ? version() : { code: 0, stdout: '{"loggedIn":false}' },
    });
    const state = await createClaudeProvider(processes).detect();
    expect(state).toMatchObject({ found: true, signedIn: false, help: 'Run `claude auth login`.' });
  });

  it('says so when the version is older than 2.1.318', async () => {
    const { processes } = fakeProcesses({ exec: () => version('2.1.201 (Claude Code)') });
    const state = await createClaudeProvider(processes).detect();
    expect(state).toMatchObject({
      found: true,
      signedIn: false,
      reason: 'too-old',
      version: '2.1.201',
    });
    expect(state.found && state.help).toMatch(/2\.1\.318/);
  });
});

describe('run', () => {
  const emptyFolder = () => Promise.resolve('/tmp/empty-1');

  it('runs in the folder', async () => {
    const fake = fakeProcesses({ lines: fixture('scripted-toolbox-only.jsonl'), code: 0 });
    const provider = createClaudeProvider(fake.processes, { emptyFolder });
    const events = await collect(
      provider.run(folderRequest, endpoint, new AbortController().signal),
    );
    const spec = fake.specs[0];
    expect(spec?.program).toBe('/usr/local/bin/claude');
    expect(spec?.cwd).toBe('/p');
    expect(spec?.log).toEqual({ agent: 'claude', thread: 't1', document: '/p/doc.md' });
    expect(events.at(-1)).toEqual({ type: 'done', finalText: 'Done.' });
  });

  it('writes the version detect found in the log', async () => {
    const fake = fakeProcesses({
      lines: fixture('scripted-toolbox-only.jsonl'),
      exec: (_, args) =>
        args[0] === '--version'
          ? { code: 0, stdout: '2.1.318 (Claude Code)\n' }
          : { code: 0, stdout: '{"loggedIn":true}' },
    });
    const provider = createClaudeProvider(fake.processes, { emptyFolder });
    await provider.detect();
    await collect(provider.run(folderRequest, endpoint, new AbortController().signal));
    expect(fake.specs[0]?.log.version).toBe('2.1.318');
  });

  it('runs At This document in an empty temp folder', async () => {
    const fake = fakeProcesses({ lines: fixture('scripted-toolbox-only.jsonl') });
    const provider = createClaudeProvider(fake.processes, { emptyFolder });
    await collect(provider.run(documentRequest, endpoint, new AbortController().signal));
    expect(fake.specs[0]?.cwd).toBe('/tmp/empty-1');
  });

  it('runs a document with no folder in an empty temp folder', async () => {
    const fake = fakeProcesses({ lines: fixture('scripted-toolbox-only.jsonl') });
    const provider = createClaudeProvider(fake.processes, { emptyFolder });
    const noFolder: AgentRequest = { ...folderRequest };
    delete noFolder.folder;
    await collect(provider.run(noFolder, endpoint, new AbortController().signal));
    expect(fake.specs[0]?.cwd).toBe('/tmp/empty-1');
    const args = fake.specs[0]?.args ?? [];
    expect(args[args.indexOf('--tools') + 1]).toBe('');
  });

  it('stops a run whose toolbox did not start, though the program goes on', async () => {
    const fake = fakeProcesses({ lines: fixture('scripted-toolbox-wont-start.jsonl') });
    const events = await collect(
      createClaudeProvider(fake.processes, { emptyFolder }).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'started', logPath: '/logs/run.jsonl' });
    expect(events[1]?.type).toBe('error');
    expect(fake.stopped()).toBeGreaterThan(0);
  });

  it('holds a retry back, and reports it only if the run then fails', async () => {
    const recovered = fakeProcesses({
      lines: [
        ...fixture('scripted-retry-429.jsonl').slice(0, 2),
        JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Fine.' }),
      ],
    });
    const events = await collect(
      createClaudeProvider(recovered.processes, { emptyFolder }).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(events.filter((event) => event.type !== 'status').map((event) => event.type)).toEqual([
      'started',
      'done',
    ]);

    const failed = fakeProcesses({ lines: fixture('scripted-retry-429.jsonl'), code: 1 });
    const failure = await collect(
      createClaudeProvider(failed.processes, { emptyFolder }).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(failure.filter((event) => event.type !== 'status')).toEqual([
      { type: 'started', logPath: '/logs/run.jsonl' },
      { type: 'error', message: 'Claude has hit its usage limit. Try again later.' },
    ]);
  });

  it('gives one error for a truncated stream whose process was killed', async () => {
    const fake = fakeProcesses({
      lines: [fixture('scripted-toolbox-only.jsonl')[0] ?? '', '{"type":"assistant","mess'],
      code: null,
    });
    const events = await collect(
      createClaudeProvider(fake.processes, { emptyFolder }).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Claude ended without an answer.' });
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
  });

  it('puts the end of stderr in a failure with no better reason', async () => {
    const fake = fakeProcesses({ code: 2, stderr: 'error: unknown option --restricted\n' });
    const events = await collect(
      createClaudeProvider(fake.processes, { emptyFolder }).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([
      { type: 'started', logPath: '/logs/run.jsonl' },
      { type: 'error', message: 'Claude stopped: error: unknown option --restricted' },
    ]);
  });

  it('stops the program on the signal and ends with one error, not a hang', async () => {
    const fake = fakeProcesses({ lines: [], hang: true });
    const controller = new AbortController();
    const running = collect(
      createClaudeProvider(fake.processes, { emptyFolder }).run(
        folderRequest,
        endpoint,
        controller.signal,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    expect(await running).toEqual([
      { type: 'started', logPath: '/logs/run.jsonl' },
      { type: 'error', message: 'Stopped.' },
    ]);
    expect(fake.stopped()).toBeGreaterThan(0);
  });

  it('says so when Claude Code is gone', async () => {
    const fake = fakeProcesses({ which: null });
    const events = await collect(
      createClaudeProvider(fake.processes, { emptyFolder }).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(events[0]?.type).toBe('error');
    expect(fake.specs).toHaveLength(0);
  });

  it('reads no credential file: only which, the status commands and the run', async () => {
    const fake = fakeProcesses({
      lines: fixture('scripted-toolbox-only.jsonl'),
      exec: (_, args) =>
        args[0] === '--version'
          ? { code: 0, stdout: '2.1.318' }
          : { code: 0, stdout: '{"loggedIn":true}' },
    });
    const provider = createClaudeProvider(fake.processes, { emptyFolder });
    await provider.detect();
    await collect(provider.run(folderRequest, endpoint, new AbortController().signal));
    expect(fake.calls).toEqual([
      'which claude',
      'exec /usr/local/bin/claude --version',
      'exec /usr/local/bin/claude auth status',
      'which claude',
      'start /usr/local/bin/claude',
    ]);
  });
});

describe('hard lines', () => {
  const evil = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];

  it('takes a prompt that starts with a dash for the prompt, after a --', () => {
    for (const prompt of ['- @Claude fix the spelling', '--append-system-prompt', '-p']) {
      const args = claudeArgs({ ...folderRequest, prompt }, endpoint);
      expect(args.slice(-2)).toEqual(['--', prompt]);
    }
  });

  it('is not troubled by tool names that are also names on every object', () => {
    for (const name of evil) {
      expect(() =>
        parseClaudeLine(toolUse(`mcp__redlines__${name}`, {}), newClaudeState()),
      ).not.toThrow();
      const event = parseClaudeLine(toolUse(`mcp__redlines__${name}`, {}), newClaudeState());
      expect(event).toEqual({ type: 'status', text: 'Working…' });
      const retry = JSON.stringify({
        type: 'system',
        subtype: 'api_retry',
        error: name,
        error_status: 500,
      });
      expect(parseClaudeLine(retry, newClaudeState())).toBeNull();
    }
  });

  it('keeps a status line text a string, whatever the input holds', () => {
    const event = parseClaudeLine(
      toolUse('Read', { file_path: { toString: 1 } }),
      newClaudeState(),
    );
    expect(event).toEqual({ type: 'status', text: 'Reading' });
  });

  it('counts a result of another subtype, or none, as a failure', () => {
    for (const result of [
      { type: 'result' },
      { type: 'result', subtype: 'error_during_execution', is_error: false },
    ]) {
      expect(parseClaudeLine(JSON.stringify(result), newClaudeState())?.type).toBe('error');
    }
  });

  it('trims the final text', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '  Done.\n',
    });
    expect(parseClaudeLine(line, newClaudeState())).toEqual({ type: 'done', finalText: 'Done.' });
  });

  it('forgets a retry once the run is going again', () => {
    const state = newClaudeState();
    const retry = JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      error: 'rate_limit',
      error_status: 429,
    });
    parseClaudeLine(retry, state);
    parseClaudeLine('{"type":"user","message":{"content":[]}}', state);
    const failed = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Boom',
    });
    expect(parseClaudeLine(failed, state)).toEqual({
      type: 'error',
      message: 'Claude stopped: Boom',
    });
  });

  it('says Claude cannot reach the network when a retry never got a response', () => {
    for (const retry of [
      { error: 'no_response', error_status: null },
      { error: 'unknown', error_status: null },
    ]) {
      const line = JSON.stringify({ type: 'system', subtype: 'api_retry', ...retry });
      expect(parseClaudeLine(line, newClaudeState())).toEqual({
        type: 'error',
        message: "Claude can't reach the network.",
      });
    }
  });

  it('ends with one error when which rejects, the lines throw or ended rejects', async () => {
    const which = fakeProcesses();
    which.processes.which = () => Promise.reject(new Error('no shell'));
    const first = await collect(
      createClaudeProvider(which.processes).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(first).toEqual([{ type: 'error', message: "Claude couldn't be started: no shell" }]);

    const throwing = fakeProcesses();
    throwing.processes.start = () =>
      Promise.resolve({
        lines: (async function* () {
          await Promise.resolve();
          yield* [];
          throw new Error('pipe broke');
        })(),
        ended: Promise.reject(new Error('lost')),
        stop() {},
        logPath: '',
      });
    const second = await collect(
      createClaudeProvider(throwing.processes).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(second).toEqual([
      { type: 'started', logPath: '' },
      { type: 'error', message: 'Claude stopped: pipe broke' },
    ]);
  });

  it('does not wait on stdout that an orphan holds open after the program ended', async () => {
    const fake = fakeProcesses();
    fake.processes.start = () =>
      Promise.resolve({
        lines: (async function* () {
          yield fixture('scripted-toolbox-only.jsonl')[0] ?? '';
          await new Promise(() => {});
        })(),
        ended: Promise.resolve({ code: 1, stderr: '' }),
        stop() {},
        logPath: '',
      });
    const began = Date.now();
    const events = await collect(
      createClaudeProvider(fake.processes).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(Date.now() - began).toBeLessThan(500);
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Claude ended without an answer.' });
  });

  it('keeps a final result that a slow consumer takes after the program ended', async () => {
    const fake = fakeProcesses({ lines: fixture('scripted-toolbox-only.jsonl') });
    const events: AgentEvent[] = [];
    for await (const event of createClaudeProvider(fake.processes).run(
      folderRequest,
      endpoint,
      new AbortController().signal,
    )) {
      events.push(event);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(events.at(-1)).toEqual({ type: 'done', finalText: 'Done.' });
  });

  it('yields one ending event when stop throws', async () => {
    const fake = fakeProcesses({ lines: fixture('scripted-toolbox-wont-start.jsonl') });
    const start = fake.processes.start.bind(fake.processes);
    fake.processes.start = async (spec) => ({
      ...(await start(spec)),
      stop() {
        throw new Error('already gone');
      },
    });
    const events = await collect(
      createClaudeProvider(fake.processes).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
  });

  it('survives a detect that throws', async () => {
    const fake = fakeProcesses();
    fake.processes.exec = () => Promise.reject(new Error('spawn failed'));
    expect(await createClaudeProvider(fake.processes).detect()).toMatchObject({ found: false });
  });

  it('uses mktemp and rmdir by default, and fails in one line if mktemp does', async () => {
    const good = fakeProcesses({
      lines: fixture('scripted-toolbox-only.jsonl'),
      exec: () => ({ code: 0, stdout: '/var/tmp/redlines-run.abc\n' }),
    });
    await collect(
      createClaudeProvider(good.processes).run(
        documentRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(good.calls).toEqual([
      'which claude',
      'exec /usr/bin/mktemp -d -t redlines-run',
      'start /usr/local/bin/claude',
      'exec /bin/rmdir /var/tmp/redlines-run.abc',
    ]);
    expect(good.specs[0]?.cwd).toBe('/var/tmp/redlines-run.abc');

    const bad = fakeProcesses({ exec: () => ({ code: 1, stdout: '' }) });
    const events = await collect(
      createClaudeProvider(bad.processes).run(
        documentRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([
      { type: 'error', message: "Claude couldn't be started: no empty folder to run in" },
    ]);
    expect(bad.specs).toHaveLength(0);
  });
});

describe('the provider', () => {
  it('is Claude, and holds reads to the folder', () => {
    const provider = createClaudeProvider(fakeProcesses().processes);
    expect(provider).toMatchObject({ id: 'claude', name: 'Claude', readLimit: 'folder' });
  });

  it('is also a plugin', () => {
    expect(plugin.manifest.id).toBe('redlines.agent-claude');
    expect(plugin.manifest.needs).toContain('agents');
    expect(typeof plugin.activate).toBe('function');
  });
});
