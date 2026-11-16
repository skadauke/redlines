// What the Agents pane shows in a plain page in development (`pnpm dev`), where there are no agent
// programs to ask: both found and signed in, as the page's scripted agent stands in for Claude. It
// lets the pane's cards, its Default agent row and the journeys be seen in a browser. Never in a
// release build, and never in the app.

import type { AgentState } from '@redlines/plugin-api';

const FOUND: Record<string, AgentState> = {
  claude: { found: true, signedIn: true, version: '2.1.400', path: '/opt/agents/bin/claude' },
  codex: { found: true, signedIn: true, version: '0.40.0', path: '/opt/agents/bin/codex' },
};

/** The scripted state of an agent of the page. */
export const devDetect = (id: string): Promise<AgentState> =>
  Promise.resolve(FOUND[id] ?? { found: false, help: 'No such agent.' });
