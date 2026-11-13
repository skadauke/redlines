// The updates and sign-ins the Preferences window has asked of the app, which go on when the pane
// that asked is drawn again (it is, whenever another window changes a setting): the pane's rows
// are made new, and a new row follows what the old one started instead of offering to start it
// again. The app runs at most one for each agent, and this knows which.

import type { SetupResult } from '@redlines/agents';

export interface SetupUnderWay {
  doing: 'update' | 'sign-in';
  ended: Promise<SetupResult>;
}

export interface SetupRegistry {
  /**
   * Keeps `started` as what is under way for `agent` until it ends, either way, and then calls
   * `onEnded`. Returns the same, for whoever asked.
   */
  track(
    agent: string,
    doing: SetupUnderWay['doing'],
    started: Promise<SetupResult>,
  ): Promise<SetupResult>;
  /** What is under way for the agent, if anything. */
  running(agent: string): SetupUnderWay | undefined;
}

export function createSetupRegistry(onEnded: (agent: string) => void): SetupRegistry {
  const underway = new Map<string, SetupUnderWay>();
  return {
    track(agent, doing, started) {
      const ended = started.finally(() => {
        // Only its own entry: another may have been started since, if the app let it.
        if (underway.get(agent)?.ended === ended) underway.delete(agent);
        onEnded(agent);
      });
      // Whoever follows it hears of a failure; if nobody does, it is not an unhandled one.
      ended.catch(() => {});
      underway.set(agent, { doing, ended });
      return ended;
    },
    running: (agent) => underway.get(agent),
  };
}
