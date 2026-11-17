import { ChangeSet } from '@codemirror/state';
import {
  acceptMarks,
  addComment,
  applyChanges,
  deleteThread,
  parse,
  rejectMarks,
  reply,
  resolve,
  suggestReplace,
} from '@redlines/format';
import type { EditContext, TextChange } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { Authority } from './authority.ts';
import type { AuthorityOptions } from './authority.ts';
import { isError } from './protocol.ts';
import type { Identity, ProtocolError, PushReply, WireUpdate } from './protocol.ts';
import { seenDigests } from './review.ts';
import { MemoryLog } from './wal.ts';

const TIME = '2026-11-16T10:00Z';

function seededRandom(seed: number) {
  let s = seed;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      out[i] = s >>> 24;
    }
    return out;
  };
}

let counter = 0;
const ctx = (handle: string, name: string): EditContext => ({
  author: { handle, name },
  time: TIME,
  random: seededRandom(handle.length * 7 + 3 + counter++ * 101),
});

const people: Record<string, Identity> = {
  ada: { handle: 'ada', name: 'Ada', role: 'owner' },
  bo: { handle: 'bo', name: 'Bo', role: 'editor' },
  dee: { handle: 'dee', name: 'Dee', role: 'editor' },
  cy: { handle: 'cy', name: 'Cy', role: 'commenter' },
};

const authenticate: AuthorityOptions['authenticate'] = (credential) =>
  'key' in credential ? (people[credential.key] ?? { error: 'forbidden' }) : { error: 'forbidden' };

const PLAIN = 'Alpha beta gamma.\n\nDelta epsilon zeta.\n\nEta theta iota.\n';

function hello(authority: Authority, key: string) {
  authority.hello({
    credential: { key },
    clientID: key,
    protocol: 1,
    format: 1,
    version: 0,
    epoch: authority.epoch,
  });
}

/** Starts a session whose text holds a suggestion by Bo and a comment by Ada. */
function start(extra: Partial<AuthorityOptions> = {}) {
  let text = PLAIN;
  const suggest = suggestReplace(text, 'beta', 'BETA', ctx('bo', 'Bo'));
  text = applyChanges(text, suggest.changes);
  const at = text.indexOf('epsilon');
  const comment = addComment(text, { from: at, to: at + 7 }, 'Check this.', ctx('ada', 'Ada'));
  text = applyChanges(text, comment.changes);
  const authority = new Authority({ base: text, authenticate, ...extra });
  for (const key of Object.keys(people)) hello(authority, key);
  return { authority, text, suggestionIds: suggest.markIds, threadId: comment.id };
}

/** The one change from `from` to `to`: what is between their common prefix and suffix. */
function diff(from: string, to: string): TextChange {
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let end = 0;
  while (
    end < from.length - start &&
    end < to.length - start &&
    from[from.length - 1 - end] === to[to.length - 1 - end]
  ) {
    end++;
  }
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

function update(
  clientID: string,
  from: string,
  to: string,
  extra: Partial<WireUpdate> = {},
): WireUpdate {
  const { from: a, to: b, insert } = diff(from, to);
  const changes: unknown = ChangeSet.of({ from: a, to: b, insert }, from.length).toJSON();
  return { changes, clientID, ...extra };
}

function pushText(
  authority: Authority,
  clientID: string,
  to: string,
  extra: Partial<WireUpdate> = {},
  base = authority.version,
  from = authority.text,
): PushReply | ProtocolError {
  return authority.push(clientID, {
    version: base,
    epoch: authority.epoch,
    updates: [update(clientID, from, to, extra)],
  });
}

const code = (answer: PushReply | ProtocolError) => (isError(answer) ? answer.error : 'ok');

describe('roles', () => {
  it('refuses a viewer', () => {
    const viewer = new Authority({
      base: PLAIN,
      authenticate: () => ({ handle: 'vi', name: 'Vi', role: 'viewer' }),
    });
    viewer.hello({
      credential: { key: 'x' },
      clientID: 'vi',
      protocol: 1,
      format: 1,
      version: 0,
      epoch: 1,
    });
    expect(code(pushText(viewer, 'vi', `x${viewer.text}`))).toBe('forbidden');
  });

  it('lets an editor edit directly', () => {
    const { authority } = start();
    expect(code(pushText(authority, 'bo', `Intro. ${authority.text}`))).toBe('ok');
  });
});

describe('a commenter', () => {
  it('may add a comment in their own name', () => {
    const { authority, text } = start();
    const at = text.indexOf('theta');
    const add = addComment(text, { from: at, to: at + 5 }, 'Why?', ctx('cy', 'Cy'));
    expect(code(pushText(authority, 'cy', applyChanges(text, add.changes)))).toBe('ok');
  });

  it('may add a suggestion in their own name', () => {
    const { authority, text } = start();
    const edits = suggestReplace(text, 'iota', 'IOTA', ctx('cy', 'Cy'));
    expect(code(pushText(authority, 'cy', applyChanges(text, edits.changes)))).toBe('ok');
  });

  it('may reply to someone else’s thread, and take back their own comment', () => {
    const { authority, text, threadId } = start();
    const replied = applyChanges(text, reply(text, threadId, 'Agreed.', ctx('cy', 'Cy')));
    expect(code(pushText(authority, 'cy', replied))).toBe('ok');
    const at = authority.text.indexOf('theta');
    const own = addComment(authority.text, { from: at, to: at + 5 }, 'Hm', ctx('cy', 'Cy'));
    const withOwn = applyChanges(authority.text, own.changes);
    expect(code(pushText(authority, 'cy', withOwn))).toBe('ok');
    const gone = applyChanges(authority.text, deleteThread(authority.text, own.id));
    expect(code(pushText(authority, 'cy', gone))).toBe('ok');
  });

  it('may not edit the text', () => {
    const { authority } = start();
    const answer = pushText(authority, 'cy', authority.text.replace('Eta', 'Etta'));
    expect(code(answer)).toBe('forbidden');
    expect(authority.version).toBe(0);
  });

  it('may not remove or change someone else’s suggestion or comment', () => {
    const { authority, text, suggestionIds, threadId } = start();
    const rejected = applyChanges(text, rejectMarks(text, suggestionIds));
    expect(code(pushText(authority, 'cy', rejected))).toBe('forbidden');
    const deleted = applyChanges(text, deleteThread(text, threadId));
    expect(code(pushText(authority, 'cy', deleted))).toBe('forbidden');
  });

  it('may not write a mark in another person’s name', () => {
    const { authority, text } = start();
    const edits = suggestReplace(text, 'iota', 'IOTA', ctx('bo', 'Bo'));
    expect(code(pushText(authority, 'cy', applyChanges(text, edits.changes)))).toBe('forbidden');
  });

  it('may not write another person’s reply, or decide', () => {
    const { authority, text, threadId, suggestionIds } = start();
    const forged = applyChanges(text, reply(text, threadId, 'I agree.', ctx('ada', 'Ada')));
    expect(code(pushText(authority, 'cy', forged))).toBe('forbidden');
    const accepted = applyChanges(text, acceptMarks(text, suggestionIds));
    const decision = {
      kind: 'accept' as const,
      ids: suggestionIds,
      seen: seenDigests(text, suggestionIds),
    };
    expect(code(pushText(authority, 'cy', accepted, { decision }))).toBe('forbidden');
  });
});

describe('a commenter, in someone else’s name', () => {
  it('may not put words in another person’s mouth in their own thread', () => {
    const { authority, text } = start();
    const at = text.indexOf('theta');
    const own = addComment(text, { from: at, to: at + 5 }, 'Hm', ctx('cy', 'Cy'));
    const withOwn = applyChanges(text, own.changes);
    const forged = applyChanges(withOwn, reply(withOwn, own.id, 'I approve.', ctx('bo', 'Bo')));
    expect(code(pushText(authority, 'cy', forged))).toBe('forbidden');
  });

  it('may resolve in their own name only', () => {
    const { authority, text, threadId } = start();
    const asBo = applyChanges(text, resolve(text, threadId, ctx('bo', 'Bo')));
    expect(code(pushText(authority, 'cy', asBo))).toBe('forbidden');
    const asCy = applyChanges(text, resolve(text, threadId, ctx('cy', 'Cy')));
    expect(code(pushText(authority, 'cy', asCy))).toBe('ok');
  });
});

describe('decisions', () => {
  function decide(
    authority: Authority,
    who: string,
    kind: 'accept' | 'reject',
    ids: string[],
    seenText = authority.text,
    base = authority.version,
  ) {
    const decider = kind === 'accept' ? acceptMarks : rejectMarks;
    const to = applyChanges(authority.text, decider(authority.text, ids));
    return pushText(
      authority,
      who,
      to,
      { decision: { kind, ids, seen: seenDigests(seenText, ids) } },
      base,
    );
  }

  it('accepts a mark as the person saw it', () => {
    const { authority, suggestionIds } = start();
    expect(code(decide(authority, 'ada', 'accept', suggestionIds))).toBe('ok');
    expect(authority.text).toContain('BETA');
    expect(parse(authority.text).marks.some((m) => suggestionIds.includes(m.id))).toBe(false);
  });

  it('the first decision wins, and the second is told who decided', () => {
    const { authority, suggestionIds, text } = start();
    expect(code(decide(authority, 'ada', 'accept', suggestionIds))).toBe('ok');
    const to = applyChanges(text, rejectMarks(text, suggestionIds));
    const second = authority.push('dee', {
      version: 0,
      epoch: 1,
      updates: [
        update('dee', text, to, {
          decision: { kind: 'reject', ids: suggestionIds, seen: seenDigests(text, suggestionIds) },
        }),
      ],
    });
    expect(second).toMatchObject({
      error: 'stale',
      reason: 'decided',
      detail: { by: 'ada', kind: 'accept' },
    });
    expect((second as ProtocolError).message).toBe('ada accepted this a moment ago.');
  });

  it('a decision on a mark that changed is answered with what changed', () => {
    const { authority, suggestionIds, text } = start();
    // Bo adds to his own suggestion, directly inside it.
    const mark = parse(authority.text).marks.find((m) => m.id === suggestionIds[0]);
    const inside = mark?.segments[0]?.content;
    if (!inside) throw new Error('no segment');
    const edited = `${authority.text.slice(0, inside.to)}!${authority.text.slice(inside.to)}`;
    expect(code(pushText(authority, 'bo', edited))).toBe('ok');
    // Dee decides what she saw before.
    const to = applyChanges(authority.text, acceptMarks(authority.text, suggestionIds));
    const answer = pushText(
      authority,
      'dee',
      to,
      { decision: { kind: 'accept', ids: suggestionIds, seen: seenDigests(text, suggestionIds) } },
      authority.version,
      authority.text,
    );
    expect(answer).toMatchObject({ error: 'stale', reason: 'changed' });
    const detail = (answer as ProtocolError).detail as {
      id: string;
      now: { by: string; text: string };
    };
    expect(detail.id).toBe(suggestionIds[0]);
    expect(detail.now.by).toBe('bo');
    expect(detail.now.text).toContain('!');
    expect((answer as ProtocolError).message).toBe('bo changed this suggestion. Review it again.');
    // Seeing it again, she can decide.
    expect(code(decide(authority, 'dee', 'accept', suggestionIds))).toBe('ok');
  });

  it('does not count unrelated edits since the base against a decision', () => {
    const { authority, suggestionIds, text } = start();
    expect(code(pushText(authority, 'bo', `${authority.text}Tail.\n`))).toBe('ok');
    const to = applyChanges(text, acceptMarks(text, suggestionIds));
    const answer = authority.push('ada', {
      version: 0,
      epoch: 1,
      updates: [
        update('ada', text, to, {
          decision: { kind: 'accept', ids: suggestionIds, seen: seenDigests(text, suggestionIds) },
        }),
      ],
    });
    expect(answer).toMatchObject({ ok: true, status: 'rebased' });
    expect(authority.text).toContain('BETA');
    expect(authority.text).toContain('Tail.');
  });

  it('refuses a decision whose text is not the decision', () => {
    const { authority, suggestionIds } = start();
    const to = `${applyChanges(authority.text, acceptMarks(authority.text, suggestionIds))}Sneaky.\n`;
    const answer = pushText(authority, 'ada', to, {
      decision: {
        kind: 'accept',
        ids: suggestionIds,
        seen: seenDigests(authority.text, suggestionIds),
      },
    });
    expect(answer).toMatchObject({ error: 'stale', reason: 'changed' });
    expect(authority.text).not.toContain('Sneaky');
  });

  it('refuses a malformed decision', () => {
    const { authority } = start();
    const bad = (decision: unknown) =>
      code(pushText(authority, 'ada', `${authority.text}x`, { decision: decision as never }));
    expect(bad({ kind: 'maybe', ids: ['a'], seen: {} })).toBe('invalid');
    expect(bad({ kind: 'accept', ids: [], seen: {} })).toBe('invalid');
    expect(bad({ kind: 'accept', ids: [1], seen: {} })).toBe('invalid');
    expect(bad({ kind: 'accept', ids: ['k3x9'] })).toBe('invalid');
  });

  it('remembers decisions through a restart', () => {
    const wal = new MemoryLog();
    const { authority, suggestionIds, text } = start({ wal });
    expect(code(decide(authority, 'ada', 'accept', suggestionIds))).toBe('ok');
    const restarted = new Authority({ base: text, wal, authenticate });
    hello(restarted, 'dee');
    const to = applyChanges(text, rejectMarks(text, suggestionIds));
    const answer = restarted.push('dee', {
      version: 0,
      epoch: 1,
      updates: [
        update('dee', text, to, {
          decision: { kind: 'reject', ids: suggestionIds, seen: seenDigests(text, suggestionIds) },
        }),
      ],
    });
    expect(answer).toMatchObject({ error: 'stale', reason: 'decided' });
  });

  it('digests change with the mark’s text, and not with text elsewhere', () => {
    const { suggestionIds, text } = start();
    const a = seenDigests(text, suggestionIds);
    expect(seenDigests(`Intro.\n\n${text}`, suggestionIds)).toEqual(a);
    expect(seenDigests(text.replace('BETA', 'BETAS'), suggestionIds)).not.toEqual(a);
  });
});
