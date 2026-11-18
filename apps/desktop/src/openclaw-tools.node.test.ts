// The node of an OpenClaw connection publishes the six tools of `packages/agent-tools` to its
// Gateway (src-tauri/src/agents/openclaw_nodes.rs). The app's Rust side holds a copy of them
// (`openclaw-tools.json`), so that a connection can come up when the app opens, before any window
// has. This keeps the copy equal to the tools, and the other way round: a tool changed in one place
// is a failing test until the other follows.
//
// To rewrite the copy after changing a tool:
//   node --experimental-strip-types -e "import('./packages/agent-tools/src/tools.ts').then(m =>
//     require('fs').writeFileSync('apps/desktop/src-tauri/src/agents/openclaw-tools.json',
//     JSON.stringify(m.TOOL_DEFINITIONS, null, 2) + '\n'))"

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_DEFINITIONS } from '../../../packages/agent-tools/src/tools.ts';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const copy = join(here, '../src-tauri/src/agents/openclaw-tools.json');

describe('the tools a connected OpenClaw agent is offered', () => {
  it('are the six of the toolbox, word for word', () => {
    const published = JSON.parse(readFileSync(copy, 'utf8')) as unknown;
    expect(published).toEqual(JSON.parse(JSON.stringify(TOOL_DEFINITIONS)));
  });

  it('are six, and none of them runs a program or reads a file', () => {
    const names = TOOL_DEFINITIONS.map(({ name }) => name);
    expect(names).toEqual(['view', 'read_thread', 'str_replace', 'comment', 'reply', 'status']);
  });
});
