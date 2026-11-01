import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment, deleteThread, reopen, reply, resolve } from './comments.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  LEDGER_NOTE,
  TIME,
  ada,
  bo,
  bodyOf,
  claudeAda,
  context,
  expectInOrder,
  file,
  fixture,
  idsOf,
  thread,
} from './test-helpers.ts';
import type { Range } from './types.ts';
import { newestView, originalView } from './views.ts';

/** The range of `needle` in the text. */
function at(text: string, needle: string, occurrence = 0): Range {
  let from = -1;
  for (let i = 0; i <= occurrence; i++) from = text.indexOf(needle, from + 1);
  if (from < 0) throw new Error(`No ${needle} in the text`);
  return { from, to: from + needle.length };
}

/** The ledger comment of a file: what a person would read in it. */
function ledgerOf(text: string): string {
  return text.slice(text.indexOf('<!-- redlines'));
}

describe('addComment', () => {
  it('puts the anchor around the text and the thread, with its quote, in the ledger', () => {
    const range = at(fixture, 'importer');
    const { changes, id } = addComment(
      fixture,
      range,
      'Is this the right name?',
      context(ada, ['c9qf']),
    );
    expect(id).toBe('c9qf');
    const result = applyChanges(fixture, changes);
    expect(bodyOf(result)).toContain(
      'the <!--ins k3x9-->new <!--/k3x9--><!--cmt c9qf-->importer<!--/c9qf--> in',
    );
    const parsed = expectInOrder('comment', ['c9qf', 'c8d2'], result);
    expect(parsed.ledger.comments[0]).toEqual({
      id: 'c9qf',
      by: 'ada',
      at: TIME,
      likes: [],
      replies: [],
      quote: 'importer',
      text: 'Is this the right name?',
    });
    // The new thread comes first: its anchor is first in the text.
    expect(parsed.marks.map((m) => m.id)).toEqual(['k3x9', 'c9qf', 'p7qd', 'c8d2', 'w2rf']);
    expect(ledgerOf(result)).toContain(
      '  c9qf:\n    by: ada\n    at: 2026-10-31T09:00Z\n    quote: |-\n      importer\n    text: |-\n      Is this the right name?\n  c8d2:',
    );
    // Nothing else changed: the views are the same.
    expect(newestView(result).text).toBe(newestView(fixture).text);
    expect(originalView(result).text).toBe(originalView(fixture).text);
  });

  it('adds a point comment for an empty range, without a quote', () => {
    const text = 'One two.';
    const { changes, id } = addComment(text, { from: 3, to: 3 }, 'Here?', context(bo, ['c9qf']));
    const result = applyChanges(text, changes);
    expect(id).toBe('c9qf');
    expect(bodyOf(result)).toBe('One<!--cmt c9qf--> two.');
    const thread = parse(result).ledger.comments[0];
    expect(thread?.quote).toBeUndefined();
    expect(thread).toMatchObject({ id: 'c9qf', by: 'bo', text: 'Here?' });
    expect(parse(result).marks[0]?.segments[0]?.close).toBeUndefined();
  });

  it('quotes the newest text of a range that holds marks, not their markers or deleted text', () => {
    const range = { from: fixture.indexOf('<!--ins k3x9-->'), to: fixture.indexOf(', after') };
    const { changes } = addComment(fixture, range, 'Check.', context(ada, ['c9qf']));
    const result = applyChanges(fixture, changes);
    expect(parse(result).ledger.comments[0]?.quote).toBe('new importer in April');
    expect(bodyOf(result)).toContain(
      'the <!--cmt c9qf--><!--ins k3x9-->new <!--/k3x9-->importer in <!--sub p7qd March-->April<!--/p7qd--><!--/c9qf-->, after',
    );
    expectInOrder('marks', ['c9qf', 'c8d2'], result);
    // From the text of an insertion on, the comment starts inside the insertion and ends outside.
    const inside = { from: fixture.indexOf('new '), to: fixture.indexOf(' in <!--sub') };
    const crossing = applyChanges(
      fixture,
      addComment(fixture, inside, 'Check.', context(ada, ['c9qf'])).changes,
    );
    expect(bodyOf(crossing)).toContain(
      'the <!--ins k3x9--><!--cmt c9qf-->new <!--/k3x9-->importer<!--/c9qf--> in <!--sub',
    );
    expectInOrder('crossing', ['c9qf', 'c8d2'], crossing);
    // A range with a deletion in it quotes what is left.
    const text = file('a b <!--del b4rt gone-->c d', { b4rt: 'bo' });
    const covered = applyChanges(
      text,
      addComment(text, { from: 2, to: text.indexOf(' d') + 2 }, 'Why?', context(ada, ['c9qf']))
        .changes,
    );
    expect(parse(covered).ledger.comments[0]?.quote).toBe('b c d');
  });

  it('records no quote when no text is covered', () => {
    const text = file('a <!--del b4rt gone-->b', { b4rt: 'bo' });
    const marker = at(text, '<!--del b4rt gone-->');
    const { changes } = addComment(text, marker, 'Why was this cut?', context(ada, ['c9qf']));
    const result = applyChanges(text, changes);
    expect(bodyOf(result)).toBe('a <!--cmt c9qf--><!--del b4rt gone--><!--/c9qf-->b');
    expect(parse(result).ledger.comments[0]?.quote).toBeUndefined();
  });

  it('keeps emoji, combining characters and line breaks in the quote', () => {
    const text = 'x 😀 café é\r\ny z\r\n';
    const range = { from: 2, to: text.indexOf(' z') };
    const result = applyChanges(
      text,
      addComment(text, range, 'Look', context(ada, ['c9qf'])).changes,
    );
    expect(parse(result).ledger.comments[0]?.quote).toBe('😀 café é\ny');
    expect(bodyOf(result)).toBe('x <!--cmt c9qf-->😀 café é\r\ny<!--/c9qf--> z');
  });

  it('moves the ends of the range out of a marker', () => {
    const text = file('a<!--ins k3x9-->bc<!--/k3x9-->d', { k3x9: 'bo' });
    const open = at(text, '<!--ins k3x9-->');
    const close = at(text, '<!--/k3x9-->');
    // From inside the opener to inside the closer: the comment covers both markers.
    const range = { from: open.from + 4, to: close.from + 4 };
    const result = applyChanges(
      text,
      addComment(text, range, 'Hm', context(ada, ['c9qf'])).changes,
    );
    expect(bodyOf(result)).toBe('a<!--cmt c9qf--><!--ins k3x9-->bc<!--/k3x9--><!--/c9qf-->d');
    expect(parse(result).ledger.comments[0]?.quote).toBe('bc');
    // A point inside a marker goes before it.
    const point = applyChanges(
      text,
      addComment(text, { from: open.from + 4, to: open.from + 4 }, 'Hm', context(ada, ['c9qf']))
        .changes,
    );
    expect(bodyOf(point)).toBe('a<!--cmt c9qf--><!--ins k3x9-->bc<!--/k3x9-->d');
  });

  it('never puts the anchor inside the ledger', () => {
    const body = 'One two.';
    const text = file(body, { k3x9: 'bo' });
    const ledgerStart = text.indexOf('<!-- redlines');
    const range = { from: body.length - 4, to: ledgerStart + 10 };
    const result = applyChanges(
      text,
      addComment(text, range, 'End', context(ada, ['c9qf'])).changes,
    );
    expect(bodyOf(result)).toBe('One <!--cmt c9qf-->two.<!--/c9qf-->');
    expect(parse(result).ledger.comments[0]?.quote).toBe('two.');
  });

  it('adds the author to the people, and draws an id that is free', () => {
    const text = file('One two.', {}, thread('c8d2'));
    const result = applyChanges(
      text,
      addComment(text, { from: 0, to: 3 }, 'Hi', context(claudeAda, ['c8d2', 'w8nn', 'c9qf']))
        .changes,
    );
    // The first id is a thread already, the second is free.
    expect(idsOf(result)).toContain('w8nn');
    expect(parse(result).ledger.people.map((p) => p.handle)).toEqual(['ada', 'bo', 'claude-ada']);
    expect(parse(result).ledger.people[2]).toEqual(claudeAda);
  });

  it('keeps the text of the comment as it is: blank lines, markdown and a mention', () => {
    const body =
      'First paragraph, with `code` and a | pipe.\n\n- a list\n\n@bo what do you think? -- yes: no # c';
    const text = 'One two.';
    const range = { from: 4, to: 7 };
    const result = applyChanges(
      text,
      addComment(text, range, body, context(ada, ['c9qf'])).changes,
    );
    expect(parse(result).ledger.comments[0]?.text).toBe(body);
    expect(parse(result).warnings.map((w) => w.code)).toEqual([]);
  });

  it('refuses a range whose ends are in code, where the anchor would not be read', () => {
    const text = 'Use `code` here.';
    expect(() => addComment(text, { from: 6, to: 8 }, 'Hm', context(ada, ['c9qf']))).toThrow(
      EditError,
    );
    expect(() => addComment(text, { from: 6, to: 8 }, 'Hm', context(ada, ['c9qf']))).toThrow(
      "can't be anchored inside code",
    );
    // The whole code span is fine.
    expect(() => addComment(text, at(text, '`code`'), 'Hm', context(ada, ['c9qf']))).not.toThrow();
  });

  it('throws a RangeError for a range outside the text', () => {
    expect(() => addComment('abc', { from: 1, to: 9 }, 'Hm', context(ada))).toThrow(RangeError);
    expect(() => addComment('abc', { from: 2, to: 1 }, 'Hm', context(ada))).toThrow(RangeError);
  });

  it('leaves a ledger that can not be read alone, with an error', () => {
    const broken = 'a b\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    expect(() => addComment(broken, { from: 0, to: 1 }, 'Hm', context(ada, ['c9qf']))).toThrow(
      "can't be read",
    );
  });
});

describe('reply', () => {
  it('appends to the replies with a new id', () => {
    const changes = reply(fixture, 'c8d2', 'The CTO does.', context(ada, ['r5tw']));
    const result = applyChanges(fixture, changes);
    const thread = parse(result).ledger.comments[0];
    expect(thread?.replies).toEqual([{ id: 'r5tw', by: 'ada', at: TIME, text: 'The CTO does.' }]);
    expect(ledgerOf(result)).toContain('      Who signs off on the security review?');
    expect(ledgerOf(result)).toContain(
      '    replies:\n      - id: r5tw\n        by: ada\n        at: 2026-10-31T09:00Z\n        text: |-\n          The CTO does.\n    text: |-\n      Who signs off',
    );
    expectInOrder('reply', ['c8d2'], result);
    // The body is untouched: the changes are all in the ledger.
    expect(bodyOf(result)).toBe(bodyOf(fixture));
    // A second reply goes after the first.
    const again = applyChanges(result, reply(result, 'c8d2', 'Thanks.', context(bo, ['r6tw'])));
    expect(parse(again).ledger.comments[0]?.replies.map((r) => [r.id, r.by])).toEqual([
      ['r5tw', 'ada'],
      ['r6tw', 'bo'],
    ]);
  });

  it('adds the author to the people', () => {
    const text = file('One <!--cmt c8d2-->two<!--/c8d2-->.', {}, thread('c8d2'));
    const result = applyChanges(text, reply(text, 'c8d2', 'Yes.', context(claudeAda, ['r5tw'])));
    expect(parse(result).ledger.people.map((p) => p.handle)).toEqual(['ada', 'bo', 'claude-ada']);
  });

  it('draws an id that no thread, reply or mark has', () => {
    const text = file('One <!--cmt c8d2-->two<!--/c8d2-->.', {}, thread('c8d2'));
    const first = applyChanges(text, reply(text, 'c8d2', 'One.', context(ada, ['r5tw'])));
    const second = applyChanges(
      first,
      reply(first, 'c8d2', 'Two.', context(ada, ['r5tw', 'c8d2', 'r6tw'])),
    );
    expect(parse(second).ledger.comments[0]?.replies.map((r) => r.id)).toEqual(['r5tw', 'r6tw']);
  });

  it('reopens a resolved thread', () => {
    const resolved = applyChanges(fixture, resolve(fixture, 'c8d2', context(ada)));
    expect(parse(resolved).ledger.comments[0]?.resolved).toEqual({ by: 'ada', at: TIME });
    const result = applyChanges(resolved, reply(resolved, 'c8d2', 'Wait.', context(bo, ['r5tw'])));
    const thread = parse(result).ledger.comments[0];
    expect(thread?.resolved).toBeUndefined();
    expect(thread?.replies).toHaveLength(1);
    expect(result).not.toContain('resolved');
  });

  it('keeps everything else of the thread', () => {
    const text = file(
      'One <!--cmt c8d2-->two<!--/c8d2-->.',
      {},
      thread('c8d2', 'ada', 'Why?', [
        'edited: 2026-10-13T22:50Z',
        'assigned: bo',
        'done: true',
        'likes:',
        '  - bo 2026-10-13T22:41Z',
      ]),
    );
    const result = applyChanges(text, reply(text, 'c8d2', 'Because.', context(bo, ['r5tw'])));
    const before = parse(text).ledger.comments[0];
    const after = parse(result).ledger.comments[0];
    expect(after).toEqual({
      ...before,
      replies: [{ id: 'r5tw', by: 'bo', at: TIME, text: 'Because.' }],
    });
  });

  it('throws for a thread that is not there', () => {
    expect(() => reply(fixture, 'c9qf', 'Hm', context(ada, ['r5tw']))).toThrow(EditError);
    expect(() => reply(fixture, 'c9qf', 'Hm', context(ada, ['r5tw']))).toThrow(
      'There is no comment thread with the id c9qf.',
    );
  });
});

describe('resolve and reopen', () => {
  it('resolve writes resolved: handle time', () => {
    const result = applyChanges(fixture, resolve(fixture, 'c8d2', context(ada)));
    expect(ledgerOf(result)).toContain(
      '  c8d2:\n    by: bo\n    at: 2026-10-13T22:40Z\n    resolved: ada 2026-10-31T09:00Z\n    text: |-',
    );
    expect(parse(result).ledger.comments[0]?.resolved).toEqual({ by: 'ada', at: TIME });
    expectInOrder('resolve', ['c8d2'], result);
    expect(bodyOf(result)).toBe(bodyOf(fixture));
  });

  it('adds the resolver to the people', () => {
    const result = applyChanges(fixture, resolve(fixture, 'c8d2', context(claudeAda)));
    // Claude is in the example already.
    expect(parse(result).ledger.people.map((p) => p.handle)).toEqual(['ada', 'bo', 'claude-ada']);
    const text = file('One <!--cmt c8d2-->two<!--/c8d2-->.', {}, thread('c8d2')).replace(
      '  bo: {name: Bo Chen}\n',
      '',
    );
    const other = applyChanges(text, resolve(text, 'c8d2', context(bo)));
    expect(parse(other).ledger.people.map((p) => p.handle)).toEqual(['ada', 'bo']);
  });

  it('leaves a thread that is resolved already as it is', () => {
    const once = applyChanges(fixture, resolve(fixture, 'c8d2', context(ada)));
    expect(resolve(once, 'c8d2', { ...context(bo), time: '2026-11-01T10:00Z' })).toEqual([]);
  });

  it('reopen removes resolved, and does nothing for an open thread', () => {
    const resolved = applyChanges(fixture, resolve(fixture, 'c8d2', context(ada)));
    const result = applyChanges(resolved, reopen(resolved, 'c8d2'));
    expect(result).toBe(fixture);
    expect(reopen(fixture, 'c8d2')).toEqual([]);
  });

  it('throw for a thread that is not there', () => {
    expect(() => resolve(fixture, 'c9qf', context(ada))).toThrow(EditError);
    expect(() => reopen(fixture, 'c9qf')).toThrow('There is no comment thread with the id c9qf.');
  });

  it('say the ledger can not be read, rather than that the thread is missing', () => {
    const broken =
      'a <!--cmt c8d2-->b<!--/c8d2-->\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    expect(() => resolve(broken, 'c8d2', context(ada))).toThrow("can't be read");
    expect(() => reopen(broken, 'c8d2')).toThrow("can't be read");
    expect(() => reply(broken, 'c8d2', 'Hm', context(ada, ['r5tw']))).toThrow("can't be read");
    expect(() => deleteThread(broken, 'c8d2')).toThrow("can't be read");
  });
});

describe('deleteThread', () => {
  it('removes the anchor and the thread, and keeps the text', () => {
    const result = applyChanges(fixture, deleteThread(fixture, 'c8d2'));
    expect(bodyOf(result)).toBe(
      bodyOf(fixture).replace('<!--cmt c8d2-->', '').replace('<!--/c8d2-->', ''),
    );
    expect(parse(result).ledger.comments).toEqual([]);
    expect(ledgerOf(result)).not.toContain('comments:');
    expect(newestView(result).text).toBe(newestView(fixture).text);
    expectInOrder('delete', [], result);
  });

  it('removes a point comment, every segment of a comment, and the replies with the thread', () => {
    const text = file(
      '<!--cmt c8d2-->One<!--/c8d2--> two<!--cmt c9qf--> <!--cmt c8d2-->three<!--/c8d2-->',
      {},
      [
        ...thread('c8d2'),
        ...thread('c9qf', 'bo', 'Hm', [
          'replies:',
          '  - id: r5tw',
          '    by: ada',
          '    at: 2026-10-13T22:41Z',
          '    text: |-',
          '      Yes.',
        ]),
      ],
    );
    const first = applyChanges(text, deleteThread(text, 'c8d2'));
    expect(bodyOf(first)).toBe('One two<!--cmt c9qf--> three');
    const second = applyChanges(first, deleteThread(first, 'c9qf'));
    expect(second).toBe('One two three\n');
  });

  it('removes a comment on a change and leaves the change', () => {
    const text = file(
      'a <!--cmt c8d2--><!--del b4rt gone--><!--/c8d2--> <!--ins k3x9-->b<!--cmt c9qf--><!--/k3x9-->',
      { b4rt: 'bo', k3x9: 'ada' },
      [...thread('c8d2'), ...thread('c9qf')],
    );
    const result = applyChanges(text, deleteThread(text, 'c9qf'));
    expect(bodyOf(result)).toBe(
      'a <!--cmt c8d2--><!--del b4rt gone--><!--/c8d2--> <!--ins k3x9-->b<!--/k3x9-->',
    );
    expect(idsOf(result)).toEqual(['c8d2', 'b4rt', 'k3x9']);
  });

  it('removes a thread whose anchor is gone', () => {
    const text = file('Plain.', {}, [...thread('c8d2'), ...thread('c9qf')]);
    const result = applyChanges(text, deleteThread(text, 'c8d2'));
    expect(parse(result).ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
    expect(bodyOf(result)).toBe('Plain.');
  });

  it('removes the ledger with its last thread', () => {
    const text = file('One <!--cmt c8d2-->two<!--/c8d2-->.', {}, thread('c8d2'));
    expect(applyChanges(text, deleteThread(text, 'c8d2'))).toBe('One two.\n');
  });

  it('throws for a thread that is not there', () => {
    expect(() => deleteThread(fixture, 'c9qf')).toThrow(
      'There is no comment thread with the id c9qf.',
    );
    expect(() => deleteThread('plain', 'c9qf')).toThrow(EditError);
  });
});

describe('the ledger of a thread', () => {
  it('follows the field order of format §5.4', () => {
    // A comment, a reply and a resolution, then every field in the order the spec gives.
    let text = applyChanges(
      fixture,
      addComment(fixture, at(fixture, 'importer'), 'Is this the name?', context(ada, ['c9qf']))
        .changes,
    );
    text = applyChanges(
      text,
      reply(text, 'c9qf', 'Yes.\n\nSee the roadmap.', context(bo, ['r5tw'])),
    );
    text = applyChanges(text, resolve(text, 'c9qf', context(ada)));
    expect(ledgerOf(text)).toBe(
      [
        '<!-- redlines',
        LEDGER_NOTE,
        'version: 1',
        'people:',
        '  ada: {name: Ada Lovelace, email: ada@example.org}',
        '  bo: {name: Bo Chen, email: bo@example.org}',
        '  claude-ada: {name: Claude, agent: true, for: ada}',
        'marks:',
        '  k3x9: {by: ada, at: 2026-10-13T22:30Z}',
        '  p7qd: {by: claude-ada, at: 2026-10-13T22:31Z, note: Matches the roadmap}',
        '  w2rf: {by: bo, at: 2026-10-13T22:35Z}',
        'comments:',
        '  c9qf:',
        '    by: ada',
        '    at: 2026-10-31T09:00Z',
        '    resolved: ada 2026-10-31T09:00Z',
        '    replies:',
        '      - id: r5tw',
        '        by: bo',
        '        at: 2026-10-31T09:00Z',
        '        text: |-',
        '          Yes.',
        '          \\',
        '          See the roadmap.',
        '    quote: |-',
        '      importer',
        '    text: |-',
        '      Is this the name?',
        '  c8d2:',
        '    by: bo',
        '    at: 2026-10-13T22:40Z',
        '    text: |-',
        '      Who signs off on the security review?',
        '-->',
        '',
      ].join('\n'),
    );
    // The reply written with a blank line reads back as it was.
    expect(parse(text).ledger.comments[0]?.replies[0]?.text).toBe('Yes.\n\nSee the roadmap.');
  });
});

/** Comment operations on random documents: what must hold whatever the document is. */
describe('on random documents', { timeout: 600_000 }, () => {
  const AUTHORS = [ada, bo, claudeAda];

  it('changes no view, keeps the file in order, and does what it says to the threads', () => {
    const documents = fuzzCount(150);
    let operations = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 6007);
      const below = (n: number) => Math.floor(random() * n);
      let text = randomDocument(seeded(seed));
      const newest = newestView(text).text;
      const original = originalView(text).text;
      for (let step = 0; step < 4; step++) {
        const before = parse(text).ledger.comments;
        const ids = before.map((t) => t.id);
        const author = AUTHORS[below(AUTHORS.length)] ?? ada;
        const kind = below(5);
        const ctx = {
          author,
          time: TIME,
          random: (n: number) => Uint8Array.from({ length: n }, () => below(256)),
        };
        const label = `seed ${seed}, step ${step}, operation ${kind} by ${author.handle}`;
        let expected = ids;
        const target = before[below(Math.max(1, before.length))];
        if (kind === 0 || !target) {
          // Comment on a range of the file: either end may fall inside a marker.
          const from = below(text.length + 1);
          const to = Math.min(text.length, from + below(40));
          const { changes, id } = addComment(text, { from, to }, 'A note.', ctx);
          text = applyChanges(text, changes);
          expect(
            parse(text)
              .ledger.comments.map((t) => t.id)
              .toSorted(),
            label,
          ).toEqual([...ids, id].toSorted());
          expected = parse(text).ledger.comments.map((t) => t.id);
          expect(
            parse(text).marks.some((m) => m.id === id && m.kind === 'cmt'),
            label,
          ).toBe(true);
        } else if (kind === 1) {
          text = applyChanges(text, reply(text, target.id, 'A reply.', ctx));
        } else if (kind === 2) {
          text = applyChanges(text, resolve(text, target.id, ctx));
        } else if (kind === 3) {
          text = applyChanges(text, reopen(text, target.id));
        } else {
          text = applyChanges(text, deleteThread(text, target.id));
          expected = ids.filter((id) => id !== target.id);
        }
        // A file with a ledger ends with the line break after the ledger, which the views show.
        expect(newestView(text).text.replace(/\n+$/, ''), label).toBe(newest.replace(/\n+$/, ''));
        expect(originalView(text).text.replace(/\n+$/, ''), label).toBe(
          original.replace(/\n+$/, ''),
        );
        expectInOrder(label, expected, text);
        operations++;
      }
    }
    expect(operations).toBe(documents * 4);
  });
});
