// The agents of a host that starts their programs itself, as the Mac app does: each run opens a
// private relay for the program to reach the tools, then starts the program through its provider.
// The relay opens first, because the program is handed its endpoint, and the host lets a program
// start only on a relay its window has open.

import type {
  AgentEvent,
  AgentInfo,
  AgentProvider,
  AgentState,
  HostAgents,
  HostRelay,
} from '@redlines/plugin-api';

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createMacAgents(providers: readonly AgentProvider[], relay: HostRelay): HostAgents {
  return {
    list() {
      return Promise.all(
        providers.map(async (provider): Promise<AgentInfo> => {
          const state = await provider.detect().catch((error: unknown): AgentState => ({
            found: false,
            help: `${provider.name} couldn't be checked: ${reasonOf(error)}`,
          }));
          return { id: provider.id, name: provider.name, readLimit: provider.readLimit, state };
        }),
      );
    },

    async *run(agent, request, tools, signal): AsyncGenerator<AgentEvent> {
      const provider = providers.find(({ id }) => id === agent);
      if (!provider) {
        yield { type: 'error', message: `There is no agent named ${agent} here.` };
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
          yield event;
          if (event.type !== 'status') return;
        }
      } finally {
        line.close();
      }
    },
  };
}
