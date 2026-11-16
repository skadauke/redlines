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
  AgentRequest,
  AgentState,
  HostAgents,
  HostRelay,
  McpEndpoint,
  ToolLines,
} from '@redlines/plugin-api';
import { DEFAULT_HANDLES, displayName, handleOf } from './handles.ts';

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
  /**
   * The handle the person gave each agent, by id (Preferences, #558), asked at every look: an
   * agent with a handle is named by it, capitalized. An agent that isn't in it and has no default
   * keeps the name it has, as an agent the person named themselves does.
   */
  handles?: () => Readonly<Record<string, string>>;
  /**
   * The model the person chose for each agent, by id (Preferences, #530), asked at every run. A
   * request that names no model of its own (Ask's picker does) runs the one chosen here.
   */
  models?: () => Readonly<Record<string, string>>;
  /**
   * Whether Preferences' switch lets agents use the web (#529), asked at every run: one switch for
   * every agent, off by default.
   */
  web?: () => boolean;
  /**
   * What the person says when an agent that may not use the web reaches for it: Allow Once (this
   * run only), Allow Always (which turns the switch on, through `allowWeb`) or neither. Without
   * it, the answer is no.
   */
  askWeb?: (agent: string, name: string, signal: AbortSignal) => Promise<'once' | 'always' | 'no'>;
  /** Turns the switch on, for Allow Always. */
  allowWeb?: () => void;
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
          ...(provider.models ? { models: provider.models } : {}),
          state,
        };
      }),
    );

  /** The agents with the handles as they are now: a change of handle needs no new detection. */
  const named = async (list: Promise<AgentInfo[]>): Promise<AgentInfo[]> => {
    const found = await list;
    if (!options.handles) return found;
    const handles = options.handles();
    return found.map((info) => {
      if (handles?.[info.id] === undefined && DEFAULT_HANDLES[info.id] === undefined) return info;
      const handle = handleOf(info.id, handles);
      return { ...info, name: displayName(handle), handle };
    });
  };

  const agents: MacAgents = {
    list() {
      if (kept && now() - kept.at < KEEP_MS) return named(kept.list);
      const list = detect();
      const entry = { at: now(), list };
      kept = entry;
      // A detection that failed isn't kept.
      list.catch(() => {
        if (kept === entry) kept = null;
      });
      return named(list);
    },

    forget() {
      kept = null;
    },

    async *run(agent, asked, tools, signal): AsyncGenerator<AgentEvent> {
      // The web (#529): the run is held to the switch. An agent that reaches for it with the switch
      // off stops there, the person is asked, and the run starts again with the answer; asked
      // once, a run that is turned down goes on without, and is not asked again.
      let web = options.web?.() === true;
      let turnedDown = false;
      for (;;) {
        const stop = new AbortController();
        const forward = () => stop.abort();
        if (signal.aborted) stop.abort();
        signal.addEventListener('abort', forward, { once: true });
        let wanted: string | undefined;
        let used = false;
        try {
          for await (const event of runOnce(agent, { ...asked, web }, tools, stop.signal)) {
            if (event.type === 'web') {
              if (event.allowed) used = true;
              else if (!web && !turnedDown) {
                wanted = event.text;
                stop.abort();
                break;
              }
              yield { type: 'status', text: event.text };
              continue;
            }
            yield event.type === 'done' && used ? { ...event, web: true } : event;
            if (event.type === 'done' || event.type === 'error') return;
          }
        } finally {
          signal.removeEventListener('abort', forward);
        }
        if (wanted === undefined || signal.aborted) return;
        yield { type: 'status', text: 'Waiting for your answer' };
        const name = current.find(({ id }) => id === agent)?.name ?? agent;
        const answer = await (options.askWeb?.(agent, name, signal) ??
          Promise.resolve('no' as const));
        if (signal.aborted) return;
        if (answer === 'always') options.allowWeb?.();
        if (answer === 'no') turnedDown = true;
        else web = true;
      }
    },
  };
  /** One start of an agent, held to what `asked.web` says. */
  async function* runOnce(
    agent: string,
    asked: AgentRequest,
    tools: ToolLines,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    {
      // An agent added since the last look is looked for once more.
      const find = (list: readonly AgentProvider[]) => list.find(({ id }) => id === agent);
      const provider = find(current) ?? (options.more ? find(await look()) : undefined);
      if (!provider) {
        yield { type: 'error', message: `There is no agent named ${agent} here.` };
        return;
      }
      // The model chosen in Preferences, unless the request names one the agent lists.
      const listed = (model: string | undefined) =>
        model !== undefined && provider.models?.some(({ id }) => id === model) === true;
      const chosen = options.models?.()[agent];
      const request = !listed(asked.model) && listed(chosen) ? { ...asked, model: chosen } : asked;
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
    }
  }
  return agents;
}
