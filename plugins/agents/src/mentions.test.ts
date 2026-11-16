import type { AgentInfo } from '@redlines/plugin-api';
import { describe, expect, it } from 'vitest';
import { mentionedAgents } from './mentions.ts';

const found = (id: string, name: string): AgentInfo => ({
  id,
  name,
  readLimit: 'folder',
  state: { found: true, signedIn: true },
});
const agents: AgentInfo[] = [found('claude', 'Claude'), found('codex', 'Codex')];

describe('mentionedAgents', () => {
  it('matches @Claude and @claude', () => {
    expect(mentionedAgents('@Claude does the importer handle CRLF?', agents)).toEqual(['claude']);
    expect(mentionedAgents('what do you think, @claude?', agents)).toEqual(['claude']);
    expect(mentionedAgents('(@CLAUDE) and @Codex.', agents)).toEqual(['claude', 'codex']);
  });

  it("doesn't match someone else's agent, @claude-bo", () => {
    expect(mentionedAgents('@claude-bo wrote this', agents)).toEqual([]);
    expect(mentionedAgents('@claude_bo and @claudes', agents)).toEqual([]);
  });

  it("doesn't match an email address", () => {
    expect(mentionedAgents('write to email@claude.ai', agents)).toEqual([]);
    expect(mentionedAgents('see @claude.ai for more', agents)).toEqual([]);
  });

  it("doesn't match a mention in a backtick span or a code block", () => {
    expect(mentionedAgents('the handle is `@claude`, not mine', agents)).toEqual([]);
    expect(mentionedAgents('``say `@claude` here``', agents)).toEqual([]);
    expect(mentionedAgents('```\n@Claude\n```\nno one asked', agents)).toEqual([]);
    // An unclosed backtick is only a backtick.
    expect(mentionedAgents('a ` and @Claude', agents)).toEqual(['claude']);
  });

  it('names each agent once, in the order they are first mentioned', () => {
    expect(mentionedAgents('@Codex then @Claude, then @codex again', agents)).toEqual([
      'codex',
      'claude',
    ]);
  });

  it('matches only agents found on this Mac', () => {
    const missing: AgentInfo = { ...found('codex', 'Codex'), state: { found: false, help: '' } };
    expect(mentionedAgents('@Codex please', [missing])).toEqual([]);
    expect(mentionedAgents('@Bo please', agents)).toEqual([]);
  });

  it('names an agent by its handle once it has one, and no longer by its id', () => {
    const ada: AgentInfo = { ...found('claude', 'Ada'), handle: 'ada' };
    expect(mentionedAgents('@ada, can you check this?', [ada])).toEqual(['claude']);
    expect(mentionedAgents('@Ada, can you check this?', [ada])).toEqual(['claude']);
    expect(mentionedAgents('@claude, can you check this?', [ada])).toEqual([]);
  });
});
