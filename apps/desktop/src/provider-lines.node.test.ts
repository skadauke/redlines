// The providers' command lines, held to the file that the Rust side's whole-line templates are
// tested against (src-tauri/src/agents/allowed.rs). When this fails, a provider's line has changed:
// change the template in `allowed.rs` to match, and the copy of the line in `provider-lines.json`.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentRequest, McpEndpoint } from '@redlines/plugin-api';
import { claudeArgs } from '../../../plugins/agent-claude/src/index.ts';
import { codexArgs } from '../../../plugins/agent-codex/src/index.ts';

const fixture = JSON.parse(
  readFileSync(new URL('../src-tauri/src/agents/provider-lines.json', import.meta.url), 'utf8'),
) as { bundled: string; socket: string; programFolders: string[]; lines: Record<string, string[]> };

// Words that would catch a careless rule: what a person writes and selects can look like anything.
const folder = '/Users/ada/dangerously "quoted" project';
const atFolder: AgentRequest = {
  prompt: '- a comment that starts like --a-flag',
  systemPrompt: 'Write like a margin comment.\n> the dam is dangerously high',
  thread: 't1',
  documentPath: `${folder}/doc.md`,
  folder,
  scope: 'folder',
  author: { handle: 'claude-ada', name: 'Claude', for: 'ada' },
};
const atDocument: AgentRequest = { ...atFolder, scope: 'document' };
const tools: McpEndpoint = {
  command: fixture.bundled,
  args: ['mcp', '--relay', fixture.socket],
};
const { programFolders } = fixture;

describe('the lines the Rust side lets through', () => {
  it('are the lines the providers use', () => {
    expect(fixture.lines).toEqual({
      'claude at a folder': claudeArgs(atFolder, tools),
      'claude at this document': claudeArgs(atDocument, tools),
      'codex at a folder': codexArgs(atFolder, tools, { folder, programFolders }),
      'codex at this document': codexArgs(atDocument, tools, {
        folder: '/var/folders/06/T/redlines-run.abc',
        programFolders,
      }),
    });
  });
});
