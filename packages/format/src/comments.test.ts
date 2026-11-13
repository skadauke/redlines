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
  expectNoNewLineStarts,
  file,
  fixture,
  idsOf,
  markersInIndentedCode,
  REFUSALS,
  thread,
  viewBlocks,
} from './test-helpers.ts';
import type { ViewBlock } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
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
describe('a comment on whole blocks', () => {
  const body = 'Para one.\n\n- first item\n- second item\n\n> quote text\n\n## A heading\n\nLast.';
  const text = file(body);
  const where = (needle: string) => body.indexOf(needle);

  /** Comments on `[from, to)` of the body, and checks what any comment must leave. */
  function comment(from: number, to: number) {
    const { changes } = addComment(text, { from, to }, 'Check.', context(ada, ['c9qf']));
    const result = applyChanges(text, changes);
    expectInOrder('comment', ['c9qf'], result);
    expect(parse(result).warnings).toEqual([]);
    expect(newestView(result).text).toBe(newestView(text).text);
    expect(originalView(result).text).toBe(originalView(text).text);
    return bodyOf(result).replace(/\n+$/, '');
  }

  it('covers the text of a paragraph, from its first column to the first column of the next block', () => {
    // The review: whole-block ranges were refused 86 times in 90 when the next block had a prefix.
    expect(comment(0, where('- first'))).toBe(
      body.replace('Para one.', '<!--cmt c9qf-->\n\nPara one.<!--/c9qf-->'),
    );
  });

  it('covers the text of a list item, a quote and a heading, but not their prefix', () => {
    expect(comment(where('- first'), where('- second'))).toBe(
      body.replace('first item', '<!--cmt c9qf-->\n  first item<!--/c9qf-->'),
    );
    expect(comment(where('- second'), where('> quote'))).toBe(
      body.replace('second item', '<!--cmt c9qf-->\n  second item<!--/c9qf-->'),
    );
    expect(comment(where('> quote'), where('## A'))).toBe(
      body.replace('> quote text', '> <!--cmt c9qf-->\n>\n> quote text<!--/c9qf-->'),
    );
    expect(comment(where('## A'), where('Last.'))).toBe(
      body.replace('A heading', '<!--cmt c9qf-->A heading<!--/c9qf-->'),
    );
  });

  it('ends before a point comment that starts the next block, not between it and its carrier', () => {
    // A closer after `<!--cmt tm47-->` would take the line break after it into the text.
    const withPoint = file(
      'First para.\n\n<!--cmt tm47-->\n\n42 beta here.',
      {},
      thread('tm47', 'bo'),
    );
    const to = withPoint.indexOf('42');
    const { changes } = addComment(withPoint, { from: 0, to }, 'Why?', context(ada, ['c9qf']));
    const result = applyChanges(withPoint, changes);
    expect(bodyOf(result).replace(/\n+$/, '')).toBe(
      '<!--cmt c9qf-->\n\nFirst para.<!--/c9qf-->\n\n<!--cmt tm47-->\n\n42 beta here.',
    );
    expect(newestView(result).text).toBe(newestView(withPoint).text);
    expect(parse(result).warnings).toEqual([]);
  });

  it('covers the last block, and a range that starts or ends inside a prefix', () => {
    expect(comment(where('Last.'), body.length)).toContain('<!--cmt c9qf-->\n\nLast.<!--/c9qf-->');
    // Inside the prefix of the item: it starts with the item's text.
    expect(comment(where('- second') + 1, where('> quote'))).toBe(
      body.replace('second item', '<!--cmt c9qf-->\n  second item<!--/c9qf-->'),
    );
    // A point at the first column of an item is a point at the start of its text.
    expect(comment(where('- second'), where('- second'))).toBe(
      body.replace('second item', '<!--cmt c9qf-->\n  second item'),
    );
  });
});

describe('a comment that starts on a blank line in front of a block', () => {
  it('starts at the text of the block, and keeps the blank line in both views', () => {
    // Alone on the blank line, the opener would take the line break after it for its carrier, and
    // the blank line would go from both views (format §3.3): at the start of the text, and on the
    // second of two blank lines. (On the first blank line after a block, the opener goes to the
    // end of that block, as at the start of any line that the block goes on to.)
    for (const [body, from, written] of [
      ['\nFirst words.', 0, '\n<!--cmt c9qf-->\n\nFirst<!--/c9qf--> words.'],
      ['\n\nFirst words.', 0, '\n\n<!--cmt c9qf-->\n\nFirst<!--/c9qf--> words.'],
      ['One.\n\n\nFirst words.', 6, 'One.\n\n\n<!--cmt c9qf-->\n\nFirst<!--/c9qf--> words.'],
      ['\n\n- First words.', 1, '\n\n- <!--cmt c9qf-->\n  First<!--/c9qf--> words.'],
    ] as const) {
      const text = file(body);
      const range = { from, to: body.indexOf('First') + 5 };
      const { changes } = addComment(text, range, 'Why?', context(ada, ['c9qf']));
      const result = applyChanges(text, changes);
      expect(bodyOf(result).replace(/\n+$/, ''), JSON.stringify(body)).toBe(written);
      expect(newestView(result).text).toBe(newestView(text).text);
      expect(originalView(result).text).toBe(originalView(text).text);
      expect(parse(result).warnings).toEqual([]);
    }
  });

  it('is a point at the start of the block, when it is a point on the blank line', () => {
    const text = file('\nFirst words.');
    const { changes } = addComment(text, { from: 0, to: 0 }, 'Why?', context(ada, ['c9qf']));
    const result = applyChanges(text, changes);
    expect(bodyOf(result).replace(/\n+$/, '')).toBe('\n<!--cmt c9qf-->\n\nFirst words.');
    expect(newestView(result).text).toBe(newestView(text).text);
  });

  it('counts a line of nothing but its container prefix as blank: a quote, a list item', () => {
    // From the second blank line of a quote, or of a quote in a list item, or of an item, whose
    // lines have the quote's markers or the item's indentation and nothing else.
    for (const [body, from, written] of [
      [
        '> One\n>\n>\n> Two three.',
        8,
        '> One\n>\n>\n> <!--cmt c9qf-->\n>\n> Two<!--/c9qf--> three.',
      ],
      [
        '> One\n>\n>\n> Two three.',
        9,
        '> One\n>\n>\n> <!--cmt c9qf-->\n>\n> Two<!--/c9qf--> three.',
      ],
      [
        '- > One\n  >\n  >\n  > Two three.',
        14,
        '- > One\n  >\n  >\n  > <!--cmt c9qf-->\n  >\n  > Two<!--/c9qf--> three.',
      ],
      [
        '- One\n\n  \n  Two three.',
        7,
        '- One\n\n  \n  <!--cmt c9qf-->\n\n  Two<!--/c9qf--> three.',
      ],
    ] as const) {
      const text = `${body}\n`;
      const range = { from, to: body.indexOf('Two') + 3 };
      const { changes } = addComment(text, range, 'Why?', context(ada, ['c9qf']));
      const result = applyChanges(text, changes);
      expect(bodyOf(result).replace(/\n+$/, ''), JSON.stringify([body, from])).toBe(written);
      expect(newestView(result).text).toBe(newestView(text).text);
      expect(originalView(result).text).toBe(originalView(text).text);
      expect(parse(result).warnings).toEqual([]);
      expect(applyChanges(result, deleteThread(result, 'c9qf'))).toBe(text);
    }
  });
});

describe('a comment in code (#153)', () => {
  /** The words of a comment whose markers code would hide (format §2.1). */
  const IN_CODE =
    "A comment can't be anchored inside code or an HTML comment, where its markers would not be read. Anchor it on the whole code span or comment instead.";

  /** The same code, indented and fenced: a line of words, a line of `>` alone, a blank line and
   * another line of words, at the top level, in list items (four columns past the start of their
   * text) and in a quote. The fenced blocks are what the indented ones are measured against. */
  const BLOCKS: readonly (readonly [string, string])[] = [
    ['indented', 'Para.\n\n    code line\n    >\n\n    more code\n\nAfter.'],
    ['indented in an item', '- Item.\n\n      code line\n      >\n\n      more code\n\n  After.'],
    [
      'indented eight spaces in an item',
      '-   Item.\n\n        code line\n        >\n\n        more code\n\n    After.',
    ],
    [
      'indented in a numbered item',
      '1. Item.\n\n       code line\n       >\n\n       more code\n\n   After.',
    ],
    [
      'indented in a quote',
      '> Para.\n>\n>     code line\n>     >\n>\n>     more code\n>\n> After.',
    ],
    ['fenced', 'Para.\n\n```\ncode line\n>\n\nmore code\n```\n\nAfter.'],
    ['fenced in an item', '- Item.\n\n  ```\n  code line\n  >\n\n  more code\n  ```\n\n  After.'],
  ];

  /** Where `needle` ends in `text`. */
  const endOf = (text: string, needle: string) => text.indexOf(needle) + needle.length;
  /** Where the line of `>` alone starts in the code, and where it ends. */
  const quoteLine = (text: string) => {
    const start = endOf(text, 'code line\n');
    return { start, end: text.indexOf('\n', start) };
  };
  /** Where the line that holds `at` starts. */
  const lineAt = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;

  /** The ranges of a comment that has a marker inside the code, by what they cover. */
  const RANGES: readonly (readonly [string, (text: string) => Range])[] = [
    ['a word', (t) => at(t, 'more')],
    ['a point', (t) => ({ from: t.indexOf('more'), to: t.indexOf('more') })],
    [
      'a point at the end of a line',
      (t) => ({ from: endOf(t, 'code line'), to: endOf(t, 'code line') }),
    ],
    ['a whole line', (t) => ({ from: lineAt(t, t.indexOf('more')), to: endOf(t, 'more code') })],
    ['the text of a line', (t) => at(t, 'code line')],
    [
      'from the blank line between its lines',
      (t) => ({ from: quoteLine(t).end + 1, to: endOf(t, 'more') }),
    ],
    ['from the line of `>` alone', (t) => ({ from: quoteLine(t).end, to: endOf(t, 'more') })],
    [
      'from the start of the line of `>` alone',
      (t) => ({ from: quoteLine(t).start, to: endOf(t, 'more') }),
    ],
    ['from the text before it', (t) => ({ from: t.search(/Para|Item/), to: endOf(t, 'more') })],
    ['into the text after it', (t) => ({ from: t.indexOf('more'), to: endOf(t, 'After') })],
    [
      'the whole block',
      (t) => ({
        from: lineAt(t, t.search(/```|code line/)),
        to: lineAt(t, t.indexOf('After')),
      }),
    ],
  ];

  /** The error of a comment on `range` of a file with `body`, or undefined when it is added. */
  function refusal(text: string, range: Range): EditError | undefined {
    try {
      addComment(text, range, 'Why?', context(ada, ['c9qf']));
    } catch (error) {
      if (error instanceof EditError) return error;
      throw error;
    }
    return undefined;
  }

  it('is refused in indented code, in the words of fenced code, at the top level, in a list item and in a quote', () => {
    for (const [what, body] of BLOCKS) {
      const text = file(body);
      for (const [where, range] of RANGES) {
        const label = `${what}, ${where}`;
        const error = refusal(text, range(text));
        expect(error, label).toBeDefined();
        if (what.startsWith('fenced')) {
          // Fenced code takes no marker either, and a fence line none at all.
          expect(['inside-code', 'no-legal-placement'], label).toContain(error?.code);
          continue;
        }
        expect(error?.code, label).toBe('inside-code');
        expect(error?.message, label).toBe(IN_CODE);
      }
    }
  });

  it('goes around the whole block, as it does around fenced code', () => {
    for (const [what, body] of BLOCKS) {
      const text = file(body);
      const range = { from: body.search(/Para|Item/), to: endOf(body, 'After.') };
      const { changes } = addComment(text, range, 'Why?', context(ada, ['c9qf']));
      const result = applyChanges(text, changes);
      expect(markersInIndentedCode(result), what).toEqual([]);
      expect(newestView(result).text, what).toBe(newestView(text).text);
      expect(originalView(result).text, what).toBe(originalView(text).text);
      expect(parse(result).warnings, what).toEqual([]);
    }
  });

  it('is added on a line indented four spaces that goes on a paragraph, or that is the text of an item', () => {
    // Indented code can't interrupt a paragraph, and four spaces are two past an item's text.
    for (const body of [
      'Para.\n    text more',
      '- Item.\n\n    text more',
      '> Para.\n>     text more',
    ]) {
      const text = file(body);
      const { changes } = addComment(text, at(text, 'more'), 'Why?', context(ada, ['c9qf']));
      const result = applyChanges(text, changes);
      expect(bodyOf(result).replace(/\n+$/, ''), body).toBe(
        body.replace('more', '<!--cmt c9qf-->more<!--/c9qf-->'),
      );
      expect(markersInIndentedCode(result), body).toEqual([]);
    }
  });

  it('is refused on a line that is indented code once a pending change is decided', () => {
    // Bo's line break makes the line indented code once it is accepted, and Bo's deletion of the
    // blank line above it keeps it code until it is accepted.
    const split = file('Para.\n    text more');
    const broken = applyChanges(
      split,
      trackedEdit(split, { from: 5, to: 5, insert: '\n\n' }, context(bo, ['w8nn'])),
    );
    const code = file('Para.\n\n    text more');
    const joined = applyChanges(
      code,
      trackedEdit(code, { from: 5, to: code.indexOf('text'), insert: '' }, context(bo, ['w8nn'])),
    );
    for (const [what, text] of [
      ['a line break that makes it code', broken],
      ['a deletion that makes it a line of the paragraph', joined],
    ] as const) {
      expect(markersInIndentedCode(text), what).toEqual([]);
      const error = refusal(text, at(text, 'more'));
      expect(error?.code, what).toBe('inside-code');
      expect(error?.message, what).toBe(IN_CODE);
    }
  });
});

describe('on random documents', { timeout: 600_000 }, () => {
  const AUTHORS = [ada, bo, claudeAda];

  it('changes no view, keeps the file in order, and does what it says to the threads', () => {
    const documents = fuzzCount(150);
    let operations = 0;
    let refused = 0;
    let wholeBlocks = 0;
    let wholeRefused = 0;
    // A comment on a whole alert has no place for its opener: nothing may go before the type.
    let alertsRefused = 0;
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
          // Comment on a range of the file: either end may fall inside a marker. A third of the
          // ranges are whole blocks, from the first column of the first to the first column of the
          // block after the last, where the next block has a prefix.
          let from = below(text.length + 1);
          let to = Math.min(text.length, from + below(40));
          const view = newestView(text);
          const blocks = viewBlocks(view.text);
          const whole = blocks.length > 0 && below(3) === 0;
          if (whole) {
            const first = blocks[below(blocks.length)] as ViewBlock;
            from = view.map.toSource(first.line, 1);
            to = view.map.toSource(first.next, -1);
          }
          let added: ReturnType<typeof addComment>;
          try {
            added = addComment(text, { from, to }, 'A note.', ctx);
          } catch (error) {
            // A range with no place for its markers, or markers that code would hide, is refused.
            if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
              refused++;
              if (whole && /alert's type/.test(error.message)) alertsRefused++;
              else if (whole) wholeRefused++;
              continue;
            }
            throw new Error(`${label}: ${String(error)}`, { cause: error });
          }
          if (whole) wholeBlocks++;
          const { changes, id } = added;
          const placed = parse(text);
          const parsedBefore = text;
          text = applyChanges(text, changes);
          expectNoNewLineStarts(
            `${label} ${JSON.stringify([from, to])} on ${JSON.stringify(bodyOf(parsedBefore))} => ${JSON.stringify(bodyOf(text))}`,
            placed,
            parse(text),
          );
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
    expect(operations + refused).toBe(documents * 4);
    expect(operations).toBeGreaterThan(refused);
    // A comment on whole blocks goes through, but where a construct has no place for its marker.
    expect(
      wholeRefused,
      `${alertsRefused} comments on a whole alert were refused apart`,
    ).toBeLessThanOrEqual(Math.ceil((wholeBlocks + wholeRefused) / 20));
  });
});
