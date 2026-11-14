// The agents of a host that starts their programs itself, as the Mac app does: each run opens a
// private relay for the program to reach the tools, then starts the program through its provider.
// The relay opens first, because the program is handed its endpoint, and the host lets a program
// start only on a relay its window has open. What detection found is kept for a minute, because it
// runs each agent's own status commands, and a comment box asks for it each time it opens. Agents
// the host keeps a list of, which can change while the app runs, are asked for at each look.

import type {
  AgentEvent,
  AgentInfo,
  AgentProvider,
  AgentState,
  HostAgents,
  HostRelay,
  McpEndpoint,
} from '@redlines/plugin-api';

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How long what detection found is kept. */
const KEEP_MS = 60_000;

/** What an agent with no toolbox is handed in its place: nothing to connect to. */
const NO_TOOLS: McpEndpoint = { command: '', args: [] };

export interface MacAgents extends HostAgents {
  forget(): void;
}

export interface MacAgentsOptions {
  /** The time, in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /** More agents, from a list the host keeps, such as the Agent Client Protocol agents. */
  more?: () => Promise<readonly AgentProvider[]>;
}

export function createMacAgents(
  providers: readonly AgentProvider[],
  relay: HostRelay,
  options: MacAgentsOptions = {},
): MacAgents {
  const now = options.now ?? Date.now;
  /** What detection found, or is finding, and when it began. */
  let kept: { at: number; list: Promise<AgentInfo[]> } | null = null;
  /** The providers as of the last look, the host's list included. */
  let current: readonly AgentProvider[] = providers;

  /** The providers, with the host's list as it is now. A list that can't be read adds none. */
  const look = async () => {
    const more = options.more ? await options.more().catch(() => []) : [];
    current = [...providers, ...more];
    return current;
  };

  const detect = async () =>
    Promise.all(
      (await look()).map(async (provider): Promise<AgentInfo> => {
        const state = await provider.detect().catch((error: unknown): AgentState => ({
          found: false,
          help: `${provider.name} couldn't be checked: ${reasonOf(error)}`,
        }));
        return {
          id: provider.id,
          name: provider.name,
          readLimit: provider.readLimit,
          ...(provider.toolbox === false ? { toolbox: false as const } : {}),
          state,
        };
      }),
    );

  const agents: MacAgents = {
    list() {
      if (kept && now() - kept.at < KEEP_MS) return kept.list;
      const list = detect();
      const entry = { at: now(), list };
      kept = entry;
      // A detection that failed isn't kept.
      list.catch(() => {
        if (kept === entry) kept = null;
      });
      return list;
    },

    forget() {
      kept = null;
    },

    async *run(agent, request, tools, signal): AsyncGenerator<AgentEvent> {
      // An agent added since the last look is looked for once more.
      const find = (list: readonly AgentProvider[]) => list.find(({ id }) => id === agent);
      const provider = find(current) ?? (options.more ? find(await look()) : undefined);
      if (!provider) {
        yield { type: 'error', message: `There is no agent named ${agent} here.` };
        return;
      }
      // An agent that answers in text has no toolbox: no relay is opened for it, and it is not
      // an error that its tools never started.
      if (provider.toolbox === false) {
        for await (const event of provider.run(request, NO_TOOLS, signal)) {
          if (event.type === 'error') agents.forget();
          yield event;
          if (event.type === 'done' || event.type === 'error') return;
        }
        return;
      }
      let line: Awaited<ReturnType<HostRelay['open']>>;
      try {
        line = await relay.open(tools);
      } catch (error) {
        yield {
          type: 'error',
          message: `${provider.name} couldn't be started: ${reasonOf(error)}`,
        };
        return;
      }
      try {
        for await (const event of provider.run(request, line.endpoint, signal)) {
          // A toolbox that can't start doesn't fail the run: both agents carry on without it and
          // end well (spike findings). A program that never said `initialize` had no tools.
          if (event.type === 'done' && !line.initialized()) {
            yield {
              type: 'error',
              message: `${provider.name} couldn't start Redlines' tools. Try again, or restart Redlines.`,
            };
            return;
          }
          // A run that failed may have failed for sign-in: the next list looks again.
          if (event.type === 'error') agents.forget();
          yield event;
          if (event.type === 'done' || event.type === 'error') return;
        }
      } finally {
        line.close();
      }
    },
  };
  return agents;
}
