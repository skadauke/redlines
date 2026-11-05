// Which agents a posted comment names (spec: Agents, step 2). Only an agent found on this Mac, named
// as the picker writes it (`@Claude`) or by its id (`@claude`), counts. Someone else's agent is a
// handle (`@claude-bo`), and starts nothing; so does an address (`email@claude.ai`), and anything
// in code.

import type { AgentInfo } from '@redlines/plugin-api';

/** `text` with what is inside backtick code spans, fenced blocks included, blanked out. */
function withoutCode(text: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = /`+/g;
    open.lastIndex = at;
    const start = open.exec(text);
    if (start === null) return out + text.slice(at);
    const ticks = start[0];
    // The span closes at the next run of exactly as many backticks; with none, these are only
    // backticks.
    const close = new RegExp(`(?<!\`)${ticks}(?!\`)`, 'g');
    close.lastIndex = start.index + ticks.length;
    const end = close.exec(text);
    if (end === null) {
      out += text.slice(at, open.lastIndex);
      at = open.lastIndex;
      continue;
    }
    out += text.slice(at, start.index) + ' '.repeat(end.index + ticks.length - start.index);
    at = end.index + ticks.length;
  }
}

/** Letters, digits and what a handle may have go on a name: `@claude-bo` isn't `@claude`. */
const NAME_GOES_ON = /^(?:[\p{L}\p{N}_-]|\.[\p{L}\p{N}])/u;
/** An @ after a letter or digit is part of something else, such as an email address. */
const WORD_BEFORE = /[\p{L}\p{N}_.]$/u;

/**
 * The ids of the agents found on this Mac that `text` mentions, each once, in the order they are
 * first mentioned.
 */
export function mentionedAgents(text: string, agents: readonly AgentInfo[]): string[] {
  const plain = withoutCode(text);
  const found: { id: string; at: number }[] = [];
  for (const agent of agents) {
    if (!agent.state.found) continue;
    const names = [agent.name, agent.id].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const mention = new RegExp(`@(?:${names.join('|')})`, 'giu');
    for (const match of plain.matchAll(mention)) {
      if (WORD_BEFORE.test(plain.slice(0, match.index))) continue;
      if (NAME_GOES_ON.test(plain.slice(match.index + match[0].length))) continue;
      found.push({ id: agent.id, at: match.index });
      break;
    }
  }
  return found.sort((a, b) => a.at - b.at).map(({ id }) => id);
}
