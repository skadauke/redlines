// The providers' command lines, held to the file that the Rust side's whole-line templates are
// tested against (src-tauri/src/agents/allowed.rs). When this fails, a provider's line has changed:
// change the template in `allowed.rs` to match, and the copy of the line in `provider-lines.json`.
// The same for the messages the Agent Client Protocol provider writes, and for its permission
// rule, which `acp_gate.rs` holds them to.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentRequest, McpEndpoint } from '@redlines/plugin-api';
import {
  answerPermission,
  bridgePromptMessage,
  bridgeSessionMessage,
  cancelMessage,
  initializeMessage,
  newSessionMessage,
  promptMessage,
  sessionOf,
} from '../../../plugins/agent-acp/src/index.ts';
import { claudeArgs } from '../../../plugins/agent-claude/src/index.ts';
import { codexArgs } from '../../../plugins/agent-codex/src/index.ts';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../src-tauri/src/agents/${name}`, import.meta.url), 'utf8'));

const fixture = read('provider-lines.json') as {
  bundled: string;
  socket: string;
  programFolders: string[];
  lines: Record<string, string[]>;
  home: { home: string; roots: string[] };
  acp: {
    folder: string;
    sessionId: string;
    messages: Record<string, unknown>;
    /** OpenClaw's bridge: with an agent named, and without. */
    bridge: { agent: string; messages: Record<string, unknown> };
    bridgeDefault: { messages: Record<string, unknown> };
  };
};

const permissions = read('acp-permissions.json') as {
  folder: string;
  options: unknown[];
  cases: { what: string; toolCall: unknown; options?: unknown[]; allowed: boolean }[];
};

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
// At This folder and my home folder: what the app makes of the home folder (reach.rs), which the
// Rust side makes again to check the line.
const atHome: AgentRequest = {
  ...atFolder,
  scope: 'everything',
  homeFolder: fixture.home.home,
  homeRoots: fixture.home.roots,
};
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
      'claude at the home folder': claudeArgs(atHome, tools),
      'codex at the home folder': codexArgs(atHome, tools, { folder, programFolders }),
    });
  });
});

describe('the messages the Rust side lets through to an Agent Client Protocol agent', () => {
  it('are the messages the provider writes', () => {
    const { folder, sessionId } = fixture.acp;
    expect(fixture.acp.messages).toEqual({
      initialize: initializeMessage(),
      'session/new': newSessionMessage(folder, tools),
      'session/prompt': promptMessage(sessionId, atFolder),
      'session/cancel': cancelMessage(sessionId),
    });
  });

  it('are the messages the provider writes for OpenClaw’s bridge, which has no toolbox', () => {
    const { folder, sessionId } = fixture.acp;
    const bridged: AgentRequest = {
      ...atFolder,
      systemPrompt: 'You have no tools.\n> the dam is dangerously high',
      author: { handle: 'moby-ada', name: 'Moby', for: 'ada' },
    };
    expect(fixture.acp.bridge.messages).toEqual({
      'session/new': bridgeSessionMessage(folder, sessionOf({ agent: 'moby' }, bridged)),
      'session/prompt': bridgePromptMessage(sessionId, bridged),
    });
    // With no agent named, the key names none, and the Gateway's default agent answers.
    expect(fixture.acp.bridgeDefault.messages).toEqual({
      'session/new': bridgeSessionMessage(folder, sessionOf({}, bridged)),
      'session/prompt': bridgePromptMessage(sessionId, bridged),
    });
    expect(JSON.stringify(fixture.acp.bridgeDefault.messages['session/new'])).not.toContain(
      'agent:',
    );
  });

  it('allow what the provider allows, and nothing else', () => {
    expect(permissions.cases.length).toBeGreaterThan(20);
    for (const { what, toolCall, options, allowed } of permissions.cases) {
      const offered = options ?? permissions.options;
      const params = { sessionId: 's1', toolCall, options: offered };
      const answer = answerPermission(params, permissions.folder) as {
        outcome: { outcome: string; optionId?: string };
      };
      const kind = offered.find(
        (option) => (option as { optionId?: string }).optionId === answer.outcome.optionId,
      ) as { kind?: string } | undefined;
      expect(kind?.kind === 'allow_once', what).toBe(allowed);
    }
  });
});
