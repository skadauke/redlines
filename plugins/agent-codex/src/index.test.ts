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
  codexArgs,
  createCodexProvider,
  newCodexState,
  parseCodexLine,
  plugin,
  SIGNED_OUT_HELP,
} from './index.ts';

const endpoint: McpEndpoint = {
  command: '/Applications/Redlines.app/Contents/MacOS/redlines',
  args: ['mcp', '--relay', '/tmp/rl/s.sock'],
};
const author = { handle: 'codex-bo', name: 'Codex', for: 'bo' };
const folderRequest: AgentRequest = {
  prompt: 'Fix the spelling.',
  systemPrompt: 'Write like a "margin" comment.',
  thread: 't1',
  documentPath: '/p/doc.md',
  folder: '/p',
  scope: 'folder',
  author,
};
const documentRequest: AgentRequest = { ...folderRequest, scope: 'document' };
const homebrew = {
  folder: '/p',
  programFolders: ['/opt/homebrew/bin', '/opt/homebrew/Caskroom/codex/0.166.0/bin'],
};

function valuesOf(args: string[], flag: string): string[] {
  return args.flatMap((arg, at) => (arg === flag ? [args[at + 1] ?? ''] : []));
}

function fixture(name: string): string[] {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return readFileSync(url, 'utf8').split('\n').filter(Boolean);
}

function eventsOf(lines: string[]): AgentEvent[] {
  const state = newCodexState();
  return lines.flatMap((line) => {
    const event = parseCodexLine(line, state);
    return event ? [event] : [];
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
      return Promise.resolve(
        options.which === undefined ? '/opt/homebrew/bin/codex' : options.which,
      );
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

describe('codexArgs', () => {
  const args = codexArgs(folderRequest, endpoint, homebrew);
  const settings = valuesOf(args, '-c');
  const profile = settings.find((value) => value.startsWith('permissions.redlines.filesystem='));

  it('is the findings line, exactly', () => {
    expect(args).toEqual([
      'exec',
      '--json',
      '--strict-config',
      '-C',
      '/p',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
      '-c',
      'approval_policy="never"',
      '-c',
      'default_permissions="redlines"',
      '-c',
      'permissions.redlines.filesystem={":minimal"="read",":project_roots"={"."="read"},":slash_tmp"="deny","/opt/homebrew/bin"="read","/opt/homebrew/Caskroom/codex/0.166.0/bin"="read"}',
      '-c',
      'mcp_servers.redlines.command="/Applications/Redlines.app/Contents/MacOS/redlines"',
      '-c',
      'mcp_servers.redlines.args=["mcp","--relay","/tmp/rl/s.sock"]',
      '-c',
      'mcp_servers.redlines.default_tools_approval_mode="approve"',
      '-c',
      'developer_instructions="Write like a \\"margin\\" comment."',
      '--disable',
      'apps',
      '--disable',
      'plugins',
      '--disable',
      'image_generation',
      '--disable',
      'goals',
      '--disable',
      'skill_search',
      '--disable',
      'tool_suggest',
      '--disable',
      'computer_use',
      '--disable',
      'browser_use',
      '--disable',
      'in_app_browser',
      '-c',
      'web_search="disabled"',
      'Fix the spelling.',
    ]);
  });

  // Codex adds to its defaults without warning, so every part that closes something is named.
  it('names each flag that closes a door', () => {
    expect(args).toContain('--strict-config');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('--ignore-rules');
    expect(settings).toContain('mcp_servers.redlines.default_tools_approval_mode="approve"');
    expect(settings).toContain('default_permissions="redlines"');
    expect(valuesOf(args, '--disable')).toEqual([
      'apps',
      'plugins',
      'image_generation',
      'goals',
      'skill_search',
      'tool_suggest',
      'computer_use',
      'browser_use',
      'in_app_browser',
    ]);
    expect(settings).toContain('web_search="disabled"');
  });

  it('passes no --sandbox, which would change the recorded file policy', () => {
    expect(args).not.toContain('--sandbox');
    expect(args).not.toContain('-s');
  });

  it('lets the profile read the folder, and denies /tmp', () => {
    expect(profile).toContain('":project_roots"={"."="read"}');
    expect(profile).toContain('":slash_tmp"="deny"');
  });

  it('names the folders of the program found and of its real path', () => {
    expect(profile).toContain('"/opt/homebrew/bin"="read"');
    expect(profile).toContain('"/opt/homebrew/Caskroom/codex/0.166.0/bin"="read"');
  });

  it('leaves the folder out of the profile at This document', () => {
    const own = codexArgs(documentRequest, endpoint, { ...homebrew, folder: '/tmp/empty-1' });
    const text = valuesOf(own, '-c').find((value) => value.startsWith('permissions.')) ?? '';
    expect(text).not.toContain(':project_roots');
    expect(text).toContain('":minimal"="read"');
    expect(own[own.indexOf('-C') + 1]).toBe('/tmp/empty-1');
  });

  it('never puts the folder in the profile, so its quotes and spaces cannot break it', () => {
    const odd = codexArgs(folderRequest, endpoint, { ...homebrew, folder: '/My "Docs"/a b' });
    expect(odd[odd.indexOf('-C') + 1]).toBe('/My "Docs"/a b');
    expect(odd.join(' ')).not.toContain('Docs"/a b"="read"');
  });

  it('writes a program folder with quotes as a JSON string', () => {
    const odd = codexArgs(folderRequest, endpoint, { ...homebrew, programFolders: ['/a "b"/bin'] });
    expect(valuesOf(odd, '-c').join('\n')).toContain('"/a \\"b\\"/bin"="read"');
  });
});

describe('parseCodexLine', () => {
  const item = (type: string, extra: object, kind = 'item.started') =>
    JSON.stringify({ type: kind, item: { id: 'item_1', type, ...extra } });

  it('says what a toolbox call is doing, except the status tool', () => {
    const state = newCodexState();
    expect(
      parseCodexLine(item('mcp_tool_call', { server: 'redlines', tool: 'view' }), state),
    ).toEqual({
      type: 'status',
      text: 'Reading the document',
    });
    expect(
      parseCodexLine(item('mcp_tool_call', { server: 'redlines', tool: 'str_replace' }), state),
    ).toEqual({ type: 'status', text: 'Editing' });
    expect(
      parseCodexLine(item('mcp_tool_call', { server: 'redlines', tool: 'status' }), state),
    ).toBeNull();
  });

  it('keeps a status line within 40 characters, for any tool', () => {
    const event = parseCodexLine(
      item('mcp_tool_call', { server: 'x', tool: 'a_very_long_tool_name_that_goes_on_and_on' }),
      newCodexState(),
    );
    expect(event?.type === 'status' && event.text.length).toBeLessThanOrEqual(40);
  });

  it('turns a finished run into one done, with the last message that has words', () => {
    const events = eventsOf(fixture('real-tools-folder-profile.jsonl'));
    expect(events.at(-1)).toEqual({
      type: 'done',
      finalText: 'Steps 3–7: 3 worked; 4 did not; 5 did not; 6 did not; 7 did not.',
    });
    expect(events.filter((event) => event.type !== 'status')).toHaveLength(1);
  });

  it('says nothing to say when the last message is empty', () => {
    const events = eventsOf(fixture('real-final-line-signed-app.jsonl'));
    expect(events.at(-1)).toEqual({ type: 'done' });
    const empty = eventsOf(fixture('real-default-model.jsonl'));
    expect(empty.at(-1)).toEqual({ type: 'done' });
  });

  it('does not let an empty last message replace an earlier one', () => {
    const state = newCodexState();
    parseCodexLine(item('agent_message', { text: 'First.' }, 'item.completed'), state);
    parseCodexLine(item('agent_message', { text: '  ' }, 'item.completed'), state);
    expect(parseCodexLine('{"type":"turn.completed"}', state)).toEqual({
      type: 'done',
      finalText: 'First.',
    });
  });

  it('is a failure on turn.failed, and an unrecognized setting is not', () => {
    const events = eventsOf(fixture('real-not-signed-in.jsonl'));
    expect(events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: `Codex isn't signed in. ${SIGNED_OUT_HELP}` },
    ]);
    expect(eventsOf(fixture('real-unrecognized-config.jsonl')).at(-1)).toEqual({
      type: 'done',
      finalText: 'ok',
    });
  });

  it('does not take a reconnecting line or an error item for a failure', () => {
    const state = newCodexState();
    expect(
      parseCodexLine(
        '{"type":"error","message":"Reconnecting... 2/5 (unexpected status 401)"}',
        state,
      ),
    ).toBeNull();
    expect(
      parseCodexLine(item('error', { message: 'Falling back' }, 'item.completed'), state),
    ).toBeNull();
  });

  it.each([
    [
      'stream error: error sending request for url (https://api.openai.com): dns error',
      "Codex can't reach the network.",
    ],
    [
      'unexpected status 401 Unauthorized: Missing bearer',
      `Codex isn't signed in. ${SIGNED_OUT_HELP}`,
    ],
    ["You've hit your usage limit.", 'Codex has hit its usage limit. Try again later.'],
    ['something odd\nsecond line', 'Codex stopped: something odd'],
  ])('maps the failure %j to one line', (message, line) => {
    const failed = JSON.stringify({ type: 'turn.failed', error: { message } });
    expect(parseCodexLine(failed, newCodexState())).toEqual({ type: 'error', message: line });
  });

  it('does not throw on helpers, commands, unknown events or lines that are not JSON', () => {
    const state = newCodexState();
    expect(() => eventsOf(fixture('real-other-tools-blocked.jsonl'))).not.toThrow();
    expect(() => eventsOf(fixture('real-tools-folder-profile.jsonl'))).not.toThrow();
    expect(parseCodexLine(item('collab_tool_call', { tool: 'spawn_agent' }), state)).toEqual(
      expect.objectContaining({ type: 'status' }),
    );
    expect(parseCodexLine(item('command_execution', { command: 'ls' }), state)).toEqual(
      expect.objectContaining({ type: 'status' }),
    );
    expect(parseCodexLine('{"type":"brand_new"}', state)).toBeNull();
    expect(parseCodexLine('Reading additional input from stdin...', state)).toBeNull();
    expect(parseCodexLine('[1]', state)).toBeNull();
    expect(parseCodexLine('', state)).toBeNull();
  });

  it('shows Thinking… when a turn starts', () => {
    expect(parseCodexLine('{"type":"turn.started"}', newCodexState())).toEqual({
      type: 'status',
      text: 'Thinking…',
    });
  });
});

describe('detect', () => {
  const version = { code: 0, stdout: 'codex-cli 0.166.0\n' };

  it('says when Codex is not installed', async () => {
    const { processes } = fakeProcesses({ which: null });
    const state = await createCodexProvider(processes).detect();
    expect(state.found).toBe(false);
    expect(!state.found && state.help).toMatch(/install/i);
  });

  it('is signed in on exit 0', async () => {
    const { processes } = fakeProcesses({
      exec: (_, args) =>
        args[0] === '--version' ? version : { code: 0, stdout: 'Logged in using ChatGPT' },
    });
    expect(await createCodexProvider(processes).detect()).toEqual({
      found: true,
      signedIn: true,
      version: '0.166.0',
    });
  });

  it('is signed out on exit 1', async () => {
    const { processes } = fakeProcesses({
      exec: (_, args) => (args[0] === '--version' ? version : { code: 1, stdout: 'Not logged in' }),
    });
    expect(await createCodexProvider(processes).detect()).toEqual({
      found: true,
      signedIn: false,
      version: '0.166.0',
      help: 'Run `codex login`.',
    });
  });

  it('says so when the version is older than 0.166.0', async () => {
    const { processes } = fakeProcesses({ exec: () => ({ code: 0, stdout: 'codex-cli 0.150.2' }) });
    const state = await createCodexProvider(processes).detect();
    expect(state).toMatchObject({ found: true, signedIn: false, version: '0.150.2' });
    expect(state.found && state.help).toMatch(/0\.166\.0/);
  });
});

describe('run', () => {
  const emptyFolder = () => Promise.resolve('/tmp/empty-1');
  const realPath = () => Promise.resolve('/opt/homebrew/Caskroom/codex/0.166.0/bin/codex');
  const options = { emptyFolder, realPath };

  async function run(
    fake: ReturnType<typeof fakeProcesses>,
    request = folderRequest,
    signal?: AbortSignal,
  ) {
    return collect(
      createCodexProvider(fake.processes, options).run(
        request,
        endpoint,
        signal ?? new AbortController().signal,
      ),
    );
  }

  it('runs in the folder with the profile naming the program and its real path', async () => {
    const fake = fakeProcesses({ lines: fixture('real-final-line-signed-app.jsonl') });
    const events = await run(fake);
    const spec = fake.specs[0];
    expect(spec?.program).toBe('/opt/homebrew/bin/codex');
    expect(spec?.cwd).toBe('/p');
    expect(spec?.log).toEqual({ agent: 'codex', thread: 't1', document: '/p/doc.md' });
    const profile =
      valuesOf(spec?.args ?? [], '-c').find((v) => v.startsWith('permissions.')) ?? '';
    expect(profile).toContain('"/opt/homebrew/bin"="read"');
    expect(profile).toContain('"/opt/homebrew/Caskroom/codex/0.166.0/bin"="read"');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('runs At This document, and a document with no folder, in an empty temp folder', async () => {
    const lines = fixture('real-document-scope.jsonl');
    const at = fakeProcesses({ lines });
    await run(at, documentRequest);
    expect(at.specs[0]?.cwd).toBe('/tmp/empty-1');
    expect(valuesOf(at.specs[0]?.args ?? [], '-c').join('\n')).not.toContain(':project_roots');

    const none = fakeProcesses({ lines });
    const noFolder: AgentRequest = { ...folderRequest };
    delete noFolder.folder;
    await run(none, noFolder);
    expect(none.specs[0]?.cwd).toBe('/tmp/empty-1');
    expect(valuesOf(none.specs[0]?.args ?? [], '-c').join('\n')).not.toContain(':project_roots');
  });

  it('ends a failed run with one error', async () => {
    const fake = fakeProcesses({ lines: fixture('real-not-signed-in.jsonl'), code: 1 });
    const events = await run(fake);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: `Codex isn't signed in. ${SIGNED_OUT_HELP}`,
    });
  });

  it('gives one error for a truncated stream whose process was killed', async () => {
    const lines = fixture('real-tools-folder-profile.jsonl').slice(0, 4);
    lines.push('{"type":"item.started","item":{"id":"item_');
    const fake = fakeProcesses({ lines, code: null });
    const events = await run(fake);
    expect(events.filter((event) => event.type !== 'status')).toEqual([
      { type: 'error', message: 'Codex ended without an answer.' },
    ]);
  });

  it('stops the program on the signal and ends with one error, not a hang', async () => {
    const fake = fakeProcesses({ lines: [], hang: true });
    const controller = new AbortController();
    const running = run(fake, folderRequest, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    expect(await running).toEqual([{ type: 'error', message: 'Stopped.' }]);
    expect(fake.stopped()).toBeGreaterThan(0);
  });

  it('says so when Codex is gone', async () => {
    const fake = fakeProcesses({ which: null });
    const events = await run(fake);
    expect(events[0]?.type).toBe('error');
    expect(fake.specs).toHaveLength(0);
  });

  it('reads no credential file: only which, the status commands and the run', async () => {
    const fake = fakeProcesses({
      lines: fixture('real-final-line-signed-app.jsonl'),
      exec: (_, args) =>
        args[0] === '--version'
          ? { code: 0, stdout: 'codex-cli 0.166.0' }
          : { code: 0, stdout: 'Logged in' },
    });
    const provider = createCodexProvider(fake.processes, options);
    await provider.detect();
    await collect(provider.run(folderRequest, endpoint, new AbortController().signal));
    expect(fake.calls).toEqual([
      'which codex',
      'exec /opt/homebrew/bin/codex --version',
      'exec /opt/homebrew/bin/codex login status',
      'which codex',
      'start /opt/homebrew/bin/codex',
    ]);
    expect(fake.specs[0]?.args.join(' ')).not.toMatch(/auth\.json|keychain/);
  });
});

describe('the provider', () => {
  it('is Codex, and holds reads to the folder', () => {
    const provider = createCodexProvider(fakeProcesses().processes);
    expect(provider).toMatchObject({ id: 'codex', name: 'Codex', readLimit: 'folder' });
  });

  it('is also a plugin', () => {
    expect(plugin.manifest.id).toBe('redlines.agent-codex');
    expect(plugin.manifest.needs).toContain('agents');
    expect(typeof plugin.activate).toBe('function');
  });
});
