import { describe, expect, it } from 'vitest';
import { agentWorkOf } from './agent-work.ts';
import { suggestReplace, commentOnQuote } from './agent.ts';
import { applyChanges } from './changes.ts';
import { reply, resolve } from './comments.ts';
import { accept, reject } from './decide.ts';
import { setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { ada, bo, claudeAda, context, fixture } from './test-helpers.ts';
import type { Person, TextChange } from './types.ts';

// Ada is `me`. The launch plan has Ada's insertion k3x9, Claude for Ada's substitution p7qd, Bo's
// deletion w2rf and Bo's thread c8d2.
const ME = 'ada';
const codexAda: Person = { handle: 'codex-ada', name: 'Codex', agent: true, for: 'ada' };
const claudeBo: Person = { handle: 'claude-bo', name: 'Claude', agent: true, for: 'bo' };
const gpt: Person = { handle: 'gpt', name: 'GPT', agent: true };

const crlf = (text: string) => text.replaceAll('\n', '\r\n');
const apply = (text: string, changes: readonly TextChange[]) => applyChanges(text, changes);

/** An agent's `str_replace`, as the command line and the toolbox write it. */
function suggest(
  text: string,
  old: string,
  added: string,
  by: Person,
  ids: string[],
  note?: string,
) {
  const ctx = context(by, ids, note === undefined ? {} : { note });
  return apply(text, suggestReplace(text, old, added, ctx).changes);
}

function commentOn(text: string, quote: string, body: string, by: Person, ids: string[]) {
  return apply(text, commentOnQuote(text, quote, body, context(by, ids)).changes);
}

function replyIn(text: string, thread: string, body: string, by: Person, ids: string[]) {
  return apply(text, reply(text, thread, body, context(by, ids)));
}

describe('agentWorkOf', () => {
  it('names your agent for its suggestion, its comment on other text, and its reply', () => {
    for (const base of [fixture, crlf(fixture)]) {
      const suggestion = suggest(base, 'importer', 'importer tool', claudeAda, ['b4rt']);
      expect(agentWorkOf(base, suggestion, ME)).toEqual({ agent: 'Claude' });
      const comment = commentOn(base, 'Launch plan', 'Is this final?', claudeAda, ['x5mq']);
      expect(agentWorkOf(base, comment, ME)).toEqual({ agent: 'Claude' });
      const answer = replyIn(base, 'c8d2', 'The security lead.', claudeAda, ['r2vb']);
      expect(agentWorkOf(base, answer, ME)).toEqual({ agent: 'Claude' });
      // Its deletion inside your insertion is a deletion inside it, and its work alone.
      const cut = suggest(base, 'new importer', 'importer', claudeAda, ['h3nd']);
      expect(agentWorkOf(base, cut, ME)).toEqual({ agent: 'Claude' });
    }
  });

  it('names your agent in a file that had no ledger, and one whose work takes the ledger away', () => {
    const plain = '# Notes\n\nShip it on Friday.\n';
    const suggestion = suggest(plain, 'Friday', 'Monday', claudeAda, ['b4rt']);
    expect(parse(suggestion).ledgerRange).not.toBeNull();
    expect(agentWorkOf(plain, suggestion, ME)).toEqual({ agent: 'Claude' });
    expect(agentWorkOf(suggestion, plain, ME)).toEqual({ agent: 'Claude' });
  });

  it('names two of your agents together, in the order of people', () => {
    const claude = suggest(fixture, 'importer', 'importer tool', claudeAda, ['b4rt']);
    const both = commentOn(claude, 'Launch plan', 'Is this final?', codexAda, ['x5mq']);
    expect(agentWorkOf(fixture, both, ME)).toEqual({ agent: 'Claude and Codex' });
    const cursor: Person = { handle: 'cursor-ada', name: 'Cursor', agent: true, for: 'ada' };
    const three = replyIn(both, 'c8d2', 'Seconded.', cursor, ['r2vb']);
    expect(agentWorkOf(fixture, three, ME)).toEqual({ agent: 'Claude, Codex and Cursor' });
    // Only the agents whose work differs are named.
    expect(agentWorkOf(claude, both, ME)).toEqual({ agent: 'Codex' });
  });

  it('names your agent revising its own suggestion: grown, cut, taken back, or its note replaced', () => {
    for (const base of [fixture, crlf(fixture)]) {
      const own = suggest(base, 'importer', 'importer tool for teams', claudeAda, ['b4rt']);
      const grown = suggest(own, 'tool for teams', 'tool for all teams', claudeAda, ['h3nd']);
      expect(agentWorkOf(own, grown, ME)).toEqual({ agent: 'Claude' });
      const cutBack = suggest(own, 'tool for teams', 'tool', claudeAda, ['h3nd']);
      expect(agentWorkOf(own, cutBack, ME)).toEqual({ agent: 'Claude' });
      // Deleting all of its insertion takes it back.
      const takenBack = suggest(own, 'importer tool for teams', 'importer', claudeAda, []);
      expect(parse(takenBack).marks.map(({ id }) => id)).not.toContain('b4rt');
      expect(agentWorkOf(own, takenBack, ME)).toEqual({ agent: 'Claude' });
      // Its substitution's new text made its old text again: the mark stays, March by March,
      // and that is its work too.
      const undone = suggest(base, 'April', 'March', claudeAda, []);
      expect(undone).toContain('<!--sub p7qd March-->March<!--/p7qd-->');
      expect(agentWorkOf(base, undone, ME)).toEqual({ agent: 'Claude' });
      const renoted = suggest(base, 'April', 'May', claudeAda, [], 'Moved again');
      expect(parse(renoted).ledger.marks['p7qd']?.note).toBe('Moved again');
      expect(agentWorkOf(base, renoted, ME)).toEqual({ agent: 'Claude' });
    }
  });

  it('names your agent replying in a resolved thread, which reopens it', () => {
    for (const base of [fixture, crlf(fixture)]) {
      const resolved = apply(base, resolve(base, 'c8d2', context(ada)));
      const answer = replyIn(resolved, 'c8d2', 'One more thing.', claudeAda, ['r2vb']);
      expect(parse(answer).ledger.comments[0]?.resolved).toBeUndefined();
      expect(agentWorkOf(resolved, answer, ME)).toEqual({ agent: 'Claude' });
      // Its own thread, resolved by Ada, reopened by its reply.
      const own = commentOn(base, 'Launch plan', 'Is this final?', claudeAda, ['x5mq']);
      const closed = apply(own, resolve(own, 'x5mq', context(ada)));
      const again = replyIn(closed, 'x5mq', 'Still open?', claudeAda, ['r2vb']);
      expect(agentWorkOf(closed, again, ME)).toEqual({ agent: 'Claude' });
      // Reopened without its reply, the thread is someone else's change.
      expect(agentWorkOf(closed, own, ME)).toBeNull();
    }
  });

  it('names a change that only takes your agent’s work back, whoever made it', () => {
    expect(agentWorkOf(fixture, apply(fixture, reject(fixture, 'p7qd')), ME)).toEqual({
      agent: 'Claude',
    });
    const commented = commentOn(fixture, 'Launch plan', 'Is this final?', claudeAda, ['x5mq']);
    expect(agentWorkOf(commented, fixture, ME)).toEqual({ agent: 'Claude' });
    // Accepting it is no taking back: the text stays changed.
    expect(agentWorkOf(fixture, apply(fixture, accept(fixture, 'p7qd')), ME)).toBeNull();
  });

  it('gives null for anyone else’s work', () => {
    expect(agentWorkOf(fixture, suggest(fixture, 'importer', 'tool', claudeBo, ['b4rt']), ME)).toBe(
      null,
    );
    expect(agentWorkOf(fixture, suggest(fixture, 'importer', 'tool', ada, ['b4rt']), ME)).toBe(
      null,
    );
    expect(agentWorkOf(fixture, suggest(fixture, 'importer', 'tool', gpt, ['b4rt']), ME)).toBe(
      null,
    );
    expect(agentWorkOf(fixture, replyIn(fixture, 'c8d2', 'Me.', bo, ['r2vb']), ME)).toBeNull();
    // Claude for Ada is Bo's agent nowhere: for Bo, nothing of Bo's agents changed.
    const claude = suggest(fixture, 'importer', 'tool', claudeAda, ['b4rt']);
    expect(agentWorkOf(fixture, claude, 'bo')).toBeNull();
  });

  it('gives null for one plain character more, a setting changed, or a reply of anyone else in your agent’s thread', () => {
    const claude = suggest(fixture, 'importer', 'importer tool', claudeAda, ['b4rt']);
    expect(agentWorkOf(fixture, claude.replace('# Launch plan', '# Launch plans'), ME)).toBeNull();
    const everyone = apply(
      claude,
      setLedger(claude, { ...parse(claude).ledger, tracking: 'everyone' }),
    );
    expect(everyone).toContain('tracking: everyone');
    expect(agentWorkOf(fixture, everyone, ME)).toBeNull();
    const own = commentOn(fixture, 'Launch plan', 'Is this final?', claudeAda, ['x5mq']);
    expect(agentWorkOf(own, replyIn(own, 'x5mq', 'It is.', ada, ['r2vb']), ME)).toBeNull();
    // Nor when the agent's thread goes with someone else's reply in it.
    const answered = replyIn(own, 'x5mq', 'It is.', bo, ['r2vb']);
    expect(agentWorkOf(answered, fixture, ME)).toBeNull();
    // Nor for text after the ledger, which a reader keeps as text.
    const answer = replyIn(fixture, 'c8d2', 'The security lead.', claudeAda, ['r2vb']);
    expect(agentWorkOf(fixture, `${answer}JUNK\n`, ME)).toBeNull();
    expect(agentWorkOf(fixture, `${answer}\n\n`, ME)).toBeNull();
    expect(agentWorkOf(`${fixture}JUNK\n`, `${answer}JUNK\n`, ME)).toEqual({ agent: 'Claude' });
    // Nor for a line break of another style.
    expect(agentWorkOf(fixture, crlf(claude), ME)).toBeNull();
  });

  it('gives null when a mark of your agent’s can’t be rejected, or a change of your agent’s touches another person’s mark', () => {
    // A move is decided by neither accept nor reject yet.
    const moved = fixture
      .replace('# Launch plan', '# Launch <!--ins m2vq-->final <!--/m2vq-->plan')
      .replace('  p7qd:', '  m2vq: {by: claude-ada, at: 2026-10-31T09:00Z, move: z9zz}\n  p7qd:');
    expect(parse(moved).warnings).toEqual([]);
    expect(agentWorkOf(fixture, moved, ME)).toBeNull();
    // Claude's suggestion, and Bo's deletion accepted in the same change.
    const claude = suggest(fixture, 'importer', 'importer tool', claudeAda, ['b4rt']);
    expect(agentWorkOf(fixture, apply(claude, accept(claude, 'w2rf')), ME)).toBeNull();
    // Bo's deletion inside Claude's insertion, which rejecting the insertion would take away.
    const shiny = suggest(fixture, 'importer', 'shiny and fast importer', claudeAda, ['b4rt']);
    const cut = suggest(shiny, 'shiny and fast', 'shiny fast', bo, ['h3nd']);
    expect(parse(cut).marks.find(({ id }) => id === 'h3nd')?.kind).toBe('del');
    expect(agentWorkOf(shiny, cut, ME)).toBeNull();
    expect(agentWorkOf(cut, shiny, ME)).toBeNull();
  });

  it('gives null when nothing of your agents’ changed, as for a ledger only written again in the canonical layout', () => {
    const handWritten = fixture.replace(
      '  ada: {name: Ada Lovelace, email: ada@example.org}\n  bo: {name: Bo Chen, email: bo@example.org}\n  claude-ada: {name: Claude, agent: true, for: ada}',
      '  claude-ada: {name: Claude, agent: true, for: ada}\n  bo: {name: Bo Chen, email: bo@example.org}\n  ada: {name: Ada Lovelace, email: ada@example.org}',
    );
    expect(handWritten).not.toBe(fixture);
    const canonical = apply(handWritten, setLedger(handWritten, parse(handWritten).ledger));
    expect(canonical).toBe(fixture);
    expect(agentWorkOf(handWritten, canonical, ME)).toBeNull();
    expect(agentWorkOf(fixture, fixture, ME)).toBeNull();
  });

  it('reads CRLF files byte for byte', () => {
    const base = crlf(fixture);
    const answer = replyIn(base, 'c8d2', 'The security lead.', claudeAda, ['r2vb']);
    expect(answer).not.toMatch(/[^\r]\n/);
    expect(agentWorkOf(base, answer, ME)).toEqual({ agent: 'Claude' });
    // One CRLF made an LF, beside the agent's work.
    const mixed = answer.replace('# Launch plan\r\n', '# Launch plan\n');
    expect(agentWorkOf(base, mixed, ME)).toBeNull();
  });
});
