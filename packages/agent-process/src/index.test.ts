import type { AgentEvent, AgentRequest, HostProcesses } from '@redlines/plugin-api';
import { describe, expect, it } from 'vitest';
import { runAgent, type RunSpec } from './index.ts';

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
});
