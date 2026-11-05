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
    expect(valueOf(args, '-p')).toBe('Fix the spelling.');
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
    const events = eventsOf(fixture('real-sign-in-expired.jsonl'));
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
    expect(parseClaudeLine(init ?? '', newClaudeState())).toBeNull();
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
    expect(state).toMatchObject({ found: true, signedIn: false, version: '2.1.201' });
    expect(state.found && state.help).toMatch(/2\.1\.318/);
  });
});

describe('run', () => {
  const emptyFolder = () => Promise.resolve('/tmp/empty-1');

  it('runs in the folder, with stdin closed by the host and the plan sign-in kept', async () => {
    const fake = fakeProcesses({ lines: fixture('scripted-toolbox-only.jsonl'), code: 0 });
    const provider = createClaudeProvider(fake.processes, { emptyFolder });
    const events = await collect(
      provider.run(folderRequest, endpoint, new AbortController().signal),
    );
    const spec = fake.specs[0];
    expect(spec?.program).toBe('/usr/local/bin/claude');
    expect(spec?.cwd).toBe('/p');
    expect(spec?.log).toEqual({ agent: 'claude', thread: 't1', document: '/p/doc.md' });
    expect(spec?.dropEnv?.when).toBe('CLAUDECODE');
    expect(spec?.dropEnv?.names).toEqual(
      expect.arrayContaining([
        'CLAUDECODE',
        'CLAUDE_CODE_*',
        'CLAUDE_AGENT_SDK_*',
        'ANTHROPIC_BASE_URL',
      ]),
    );
    expect(events.at(-1)).toEqual({ type: 'done', finalText: 'Done.' });
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
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('error');
    expect(fake.stopped()).toBe(1);
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
    expect(events.map((event) => event.type)).toEqual(['done']);

    const failed = fakeProcesses({ lines: fixture('scripted-retry-429.jsonl'), code: 1 });
    const failure = await collect(
      createClaudeProvider(failed.processes, { emptyFolder }).run(
        folderRequest,
        endpoint,
        new AbortController().signal,
      ),
    );
    expect(failure).toEqual([
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
    expect(events).toEqual([{ type: 'error', message: 'Claude ended without an answer.' }]);
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
    expect(await running).toEqual([{ type: 'error', message: 'Stopped.' }]);
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
