// The providers' command lines, held to the file that the Rust side checks its rule against
// (src-tauri/src/agents/allowed.rs, whose test reads the same file). When this fails, a provider's
// line has changed: change `allowed.rs` to let it through, and then this file's copy of the line.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentRequest, McpEndpoint } from '@redlines/plugin-api';
import { claudeArgs } from '../../../plugins/agent-claude/src/index.ts';
import { codexArgs } from '../../../plugins/agent-codex/src/index.ts';

const fixture = JSON.parse(
  readFileSync(new URL('../src-tauri/src/agents/provider-lines.json', import.meta.url), 'utf8'),
) as { bundled: string; lines: Record<string, string[]> };

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
  args: ['mcp', '--relay', '/var/folders/06/T/rl-7582-0/s'],
};
const programFolders = ['/opt/homebrew/bin', '/opt/homebrew/Caskroom/codex/0.166.0/bin'];

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
