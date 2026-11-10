// The scripted Claude of the agent demo: the provider the real run machinery (`createRuns`) talks
// to. Nothing here is a model. A run calls the six tools over MCP as a real agent does, through the
// toolbox of `@redlines/agent-tools`, so every limit of the product applies, and it starts only
// from a comment the visitor posts that names Claude.

import { toolClient } from '@redlines/agents/tool-client';
import type { AgentEvent, AgentInfo, HostAgents } from '@redlines/plugin-api';

export const CLAUDE: AgentInfo = {
  id: 'claude',
  name: 'Claude',
  readLimit: 'folder',
  state: { found: true, signedIn: true },
};

/** Every word the scripted Claude and the demo's question say. */
export const SAY = {
  question: '@Claude is this still right? Fix it if not.',
  reading: 'Reading uploader.ts',
  editing: 'Editing this section',
  note: 'per uploader.ts:88',
  fixed: 'Now 5, per uploader.ts:88. Fixed.',
  already: 'Already 5, per uploader.ts:88. Nothing to change.',
  missing: "I can't find the retry count in this note any more.",
  refused: "I couldn't make that edit here.",
} as const;

/** The count the code has. */
const RETRIES = '5';

/** Waits `ms`, or rejects as soon as `signal` aborts, with its timer gone. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Stopped'));
    const done = () => {
      signal.removeEventListener('abort', stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new Error('Stopped'));
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** The agents the page lists: the scripted Claude alone. `pause` is how long each step takes. */
export function scriptedAgents(options: { pause(): number }): HostAgents {
  async function* script(
    tools: Parameters<HostAgents['run']>[2],
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const client = toolClient(tools);
    try {
      await client.initialize();
      await client.call('status', { text: SAY.reading });
      await wait(options.pause(), signal);
      const viewed = await client.call('view');
      const count = /retry (\d+) times/.exec(viewed.text)?.[1];
      if (count === undefined) {
        await client.call('reply', { text: SAY.missing });
      } else if (count === RETRIES) {
        await client.call('reply', { text: SAY.already });
      } else {
        await client.call('status', { text: SAY.editing });
        await wait(options.pause(), signal);
        const edit = await client.call('str_replace', {
          old_str: `retry ${count} times`,
          new_str: `retry ${RETRIES} times`,
          note: SAY.note,
        });
        await client.call('reply', { text: edit.isError ? SAY.refused : SAY.fixed });
      }
    } catch (error) {
      // Stopped, or the document was replaced: no event and no call after that.
      if (signal.aborted) return;
      // Anything else a tool call threw ends the run with a plain reply, not an error line.
      try {
        await client.call('reply', { text: SAY.refused });
      } catch {
        // Nothing more can be said.
      }
    }
    if (signal.aborted) return;
    yield { type: 'done' };
  }

  return {
    list: () => Promise.resolve([CLAUDE]),
    run: (_agent, _request, tools, signal) => script(tools, signal),
  };
}
