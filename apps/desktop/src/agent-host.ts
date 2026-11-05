// What plugins get of the machine for running agents, through the app's Rust side
// (src-tauri/src/agents/): programs to find, run and stop. A run's channel belongs to the window
// that asked, so each window hears only its own runs.

import { Channel, invoke } from '@tauri-apps/api/core';
import type { HostProcesses, ProcessHandle, ProcessSpec } from '@redlines/plugin-api';

/** What the Rust side says about a run (`RunMessage` in agents/process.rs). */
type RunMessage =
  { kind: 'line'; line: string } | { kind: 'ended'; code: number | null; stderr: string };

/** Lines to be read one by one, as an async iterable, by one reader. */
function lineQueue(): { lines: AsyncIterable<string>; add(line: string): void; end(): void } {
  const waiting: string[] = [];
  let ended = false;
  let wake = () => {};
  return {
    add(line) {
      waiting.push(line);
      wake();
    },
    end() {
      ended = true;
      wake();
    },
    lines: (async function* () {
      for (;;) {
        for (let line = waiting.shift(); line !== undefined; line = waiting.shift()) yield line;
        if (ended) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    })(),
  };
}

/** Programs on this machine, as the app's Rust side allows them. */
export function createProcesses(): HostProcesses {
  return {
    which: (program) => invoke<string | null>('agent_which', { program }),
    exec: (program, args) =>
      invoke<{ code: number | null; stdout: string }>('agent_exec', { program, args }),
    async start(spec: ProcessSpec): Promise<ProcessHandle> {
      const queue = lineQueue();
      let end: (ended: { code: number | null; stderr: string }) => void = () => {};
      const ended = new Promise<{ code: number | null; stderr: string }>((resolve) => {
        end = resolve;
      });
      const onLine = new Channel<RunMessage>();
      onLine.onmessage = (message) => {
        if (message.kind === 'line') {
          queue.add(message.line);
        } else {
          queue.end();
          end({ code: message.code, stderr: message.stderr });
        }
      };
      const { id, log_path: logPath } = await invoke<{ id: number; log_path: string }>(
        'agent_start',
        { spec, onLine },
      );
      return {
        lines: queue.lines,
        ended,
        stop() {
          invoke('agent_stop', { id }).catch((error: unknown) => {
            console.warn('Could not stop a run', error);
          });
        },
        logPath,
      };
    },
  };
}
