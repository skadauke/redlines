import type { AgentEvent, AgentRequest, HostProcesses } from '@redlines/plugin-api';
import { describe, expect, it } from 'vitest';
import { detectAgent, runAgent, type DetectSpec, type RunSpec } from './index.ts';

const request: AgentRequest = {
  prompt: 'hi',
  systemPrompt: '',
  thread: 'c1',
  scope: 'folder',
  folder: '/repo',
  author: { handle: 'claude-ada', name: 'Claude', for: 'ada' },
};

const spec: RunSpec<object> = {
  id: 'claude',
  name: 'Claude',
  binary: 'claude',
  args: () => Promise.resolve([]),
  newState: () => ({}),
  parse: () => null,
};

/** A program that takes until `release` to start, then runs until it is stopped. */
function slowToStart() {
  let stops = 0;
  let release = () => {};
  const starting = new Promise<void>((resolve) => (release = resolve));
  const processes: HostProcesses = {
    which: () => Promise.resolve('/bin/claude'),
    exec: () => Promise.resolve({ code: 0, stdout: '' }),
    async start() {
      await starting;
      type End = { code: number | null; stderr: string };
      let end: (ending: End) => void = () => {};
      const ended = new Promise<End>((resolve) => (end = resolve));
      return {
        // No line until it ends.
        lines: {
          [Symbol.asyncIterator]: () => ({
            next: () =>
              ended.then((): IteratorResult<string> => ({ done: true, value: undefined })),
          }),
        },
        ended,
        stop() {
          stops++;
          end({ code: null, stderr: '' });
        },
        logPath: '/logs/run.jsonl',
      };
    },
  };
  return { processes, release, stops: () => stops };
}

const start = (processes: HostProcesses, signal: AbortSignal) =>
  runAgent(processes, spec, {}, request, { command: 'redlines', args: [] }, signal);

describe('runAgent', () => {
  it('stops a program that was still starting when the run was stopped and let go of', async () => {
    const program = slowToStart();
    const abort = new AbortController();
    const events = start(program.processes, abort.signal);
    // As a run does: it waits for the first event, and Stop aborts and lets go of the events.
    const first = events.next();
    abort.abort();
    const letGo = events.return(undefined);
    program.release();
    expect((await first).value).toEqual({ type: 'started', logPath: '/logs/run.jsonl' });
    await letGo;
    expect(program.stops()).toBe(1);
  });

  it('stops a program that was still starting when the run was stopped, and says so', async () => {
    const program = slowToStart();
    const abort = new AbortController();
    const seen: AgentEvent[] = [];
    const reading = (async () => {
      for await (const event of start(program.processes, abort.signal)) seen.push(event);
    })();
    abort.abort();
    program.release();
    await reading;
    expect(seen).toEqual([
      { type: 'started', logPath: '/logs/run.jsonl' },
      { type: 'error', message: 'Stopped.' },
    ]);
    expect(program.stops()).toBeGreaterThan(0);
  });

  it('starts a program the host keeps, without which, and tells it of Stop before stopping it', async () => {
    const program = slowToStart();
    const order: string[] = [];
    const calls: string[] = [];
    const processes: HostProcesses = {
      ...program.processes,
      which: (name) => {
        calls.push(`which ${name}`);
        return Promise.resolve(null);
      },
    };
    const byHost: RunSpec<{ said: string[] }> = {
      id: 'gemini',
      name: 'Gemini',
      async start({ request: asked, folder, log }) {
        calls.push(`start ${asked.scope} ${folder} ${log.agent}`);
        const handle = await processes.start({ program: '', args: [], log });
        return {
          ...handle,
          stop() {
            order.push('stop');
            handle.stop();
          },
        };
      },
      newState: () => ({ said: order }),
      parse: () => null,
      cancel: (state) => state.said.push('cancel'),
    };
    program.release();
    const abort = new AbortController();
    const seen: AgentEvent[] = [];
    for await (const event of runAgent(
      processes,
      byHost,
      {},
      request,
      { command: 'redlines', args: [] },
      abort.signal,
    )) {
      seen.push(event);
      if (event.type === 'started') abort.abort();
    }
    expect(calls).toEqual(['start folder /repo gemini']);
    expect(order.slice(0, 2)).toEqual(['cancel', 'stop']);
    expect(seen.at(-1)).toEqual({ type: 'error', message: 'Stopped.' });
  });
});

describe('runAgent, and a failure Preferences can put right', () => {
  /** A program that prints these lines and ends with `stderr`. */
  function printing(lines: string[], stderr = ''): HostProcesses {
    return {
      which: () => Promise.resolve('/bin/claude'),
      exec: () => Promise.resolve({ code: 0, stdout: '' }),
      start: () =>
        Promise.resolve({
          lines: {
            [Symbol.asyncIterator]() {
              let next = 0;
              return {
                next: (): Promise<IteratorResult<string>> =>
                  Promise.resolve(
                    next < lines.length
                      ? { done: false, value: lines[next++] ?? '' }
                      : { done: true, value: undefined },
                  ),
              };
            },
          },
          ended: Promise.resolve({ code: 1, stderr }),
          stop() {},
          logPath: '/logs/run.jsonl',
        }),
    };
  }

  const signedOut = "Claude isn't signed in. Run `claude auth login`.";
  const marking: RunSpec<{ last?: string }> = {
    id: 'claude',
    name: 'Claude',
    binary: 'claude',
    args: () => Promise.resolve([]),
    newState: () => ({}),
    parse: (line, state) => {
      state.last = line;
      return line.startsWith('error:') ? { type: 'error', message: line.slice(6) } : null;
    },
    failure: (state) => (state.last === 'quiet' ? signedOut : undefined),
    setup: (message) => message === signedOut,
  };

  const run = async (processes: HostProcesses, spec: RunSpec<{ last?: string }> = marking) => {
    const seen: AgentEvent[] = [];
    for await (const event of runAgent(
      processes,
      spec,
      { emptyFolder: () => Promise.resolve('/tmp/e'), removeFolder: () => Promise.resolve() },
      { ...request, scope: 'document' },
      { command: 'redlines', args: [] },
      new AbortController().signal,
    )) {
      seen.push(event);
    }
    return seen;
  };

  it('marks the error a line named, when the spec says Preferences can fix it', async () => {
    const seen = await run(printing([`error:${signedOut}`]));
    expect(seen.at(-1)).toEqual({ type: 'error', message: signedOut, setup: true });
  });

  it('marks the failure a stream ended on, and no other', async () => {
    expect((await run(printing(['quiet']))).at(-1)).toEqual({
      type: 'error',
      message: signedOut,
      setup: true,
    });
    const other = await run(printing(['error:Claude has hit its usage limit.']));
    expect(other.at(-1)).toEqual({ type: 'error', message: 'Claude has hit its usage limit.' });
    // Without the spec's say-so, nothing is marked.
    const plain: RunSpec<{ last?: string }> = { ...marking, setup: undefined };
    expect((await run(printing([`error:${signedOut}`]), plain)).at(-1)).toEqual({
      type: 'error',
      message: signedOut,
    });
  });
});

describe('detectAgent', () => {
  type Answer = { code: number | null; stdout: string };

  const spec: DetectSpec = {
    name: 'Claude Code',
    binary: 'claude',
    notFoundHelp: "Claude Code isn't installed on this Mac.",
    installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    minVersion: '2.1.318',
    signedOutHelp: 'Run `claude auth login`.',
    statusArgs: ['auth', 'status'],
    isSignedIn: ({ code, stdout }) => code === 0 && !stdout.includes('"loggedIn":false'),
    isSignedOut: ({ stdout }) => stdout.includes('"loggedIn":false'),
  };

  /** Programs where `claude` is at `/usr/local/bin/claude`, which says `version` and `status`. */
  function programs(
    version: string,
    status: Answer | Error,
    found: string | null = '/usr/local/bin/claude',
  ) {
    const asked: string[] = [];
    const processes: HostProcesses = {
      which: () => Promise.resolve(found),
      exec(program, args) {
        asked.push(`${program} ${args.join(' ')}`);
        if (args[0] === '--version')
          return Promise.resolve({ code: 0, stdout: `${version} (Claude Code)\n` });
        return status instanceof Error ? Promise.reject(status) : Promise.resolve(status);
      },
      start: () => Promise.reject(new Error('no')),
    };
    return { processes, asked };
  }

  const signedIn: Answer = { code: 0, stdout: '{"loggedIn":true}' };
  const signedOut: Answer = { code: 1, stdout: '{"loggedIn":false}' };
  /** What a program that doesn't know the question says: nothing on stdout, and a failure. */
  const notUnderstood: Answer = { code: 1, stdout: '' };

  it('says where a program that is not found would come from, to show and copy', async () => {
    const { processes } = programs('2.1.400', signedIn, null);
    expect(await detectAgent(processes, spec)).toEqual({
      found: false,
      help: "Claude Code isn't installed on this Mac.",
      install: 'curl -fsSL https://claude.ai/install.sh | bash',
    });
  });

  it('says where the program it found is, with its version', async () => {
    const { processes } = programs('2.1.400', signedIn);
    expect(await detectAgent(processes, spec)).toEqual({
      found: true,
      signedIn: true,
      version: '2.1.400',
      path: '/usr/local/bin/claude',
    });
  });

  it('says signed out for a current program that is', async () => {
    const { processes } = programs('2.1.400', signedOut);
    expect(await detectAgent(processes, spec)).toEqual({
      found: true,
      signedIn: false,
      reason: 'signed-out',
      version: '2.1.400',
      path: '/usr/local/bin/claude',
      help: 'Run `claude auth login`.',
    });
  });

  it('asks a program that is too old whether it is signed in, and does not claim it is not', async () => {
    const { processes, asked } = programs('2.1.201', signedIn);
    expect(await detectAgent(processes, spec)).toEqual({
      found: true,
      signedIn: false,
      reason: 'too-old',
      version: '2.1.201',
      path: '/usr/local/bin/claude',
      help: 'Claude Code 2.1.201 is too old. Update it to 2.1.318 or newer.',
      account: 'signed-in',
    });
    expect(asked).toEqual(['/usr/local/bin/claude --version', '/usr/local/bin/claude auth status']);
  });

  it('reports a too-old program as signed out only when it says so', async () => {
    const said = await detectAgent(programs('2.1.201', signedOut).processes, spec);
    expect(said).toMatchObject({ reason: 'too-old', account: 'signed-out' });
    // An older program that doesn't know the question fails it too: that is no answer.
    const silent = await detectAgent(programs('2.1.201', notUnderstood).processes, spec);
    expect(silent).toMatchObject({ reason: 'too-old' });
    expect(silent).not.toHaveProperty('account');
  });

  it('keeps a too-old program too old when the question itself fails to run', async () => {
    const { processes } = programs('2.1.201', new Error('boom'));
    const state = await detectAgent(processes, spec);
    expect(state).toMatchObject({ found: true, reason: 'too-old', version: '2.1.201' });
    expect(state).not.toHaveProperty('account');
  });

  it('still cannot check a current program whose question fails to run', async () => {
    const { processes } = programs('2.1.400', new Error('boom'));
    expect(await detectAgent(processes, spec)).toEqual({
      found: false,
      help: "Claude Code couldn't be checked: boom",
      unchecked: true,
    });
  });
});
