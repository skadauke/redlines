import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyChanges, eolOf } from './changes.ts';
import { addComment, deleteThread } from './comments.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { serializeLedger, setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { REFUSALS, ada, bo, context } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { EditContext, Ledger, Range, TextChange } from './types.ts';
import { newestView, originalView } from './views.ts';

const fixture = readFileSync(new URL('./fixtures/launch-plan.md', import.meta.url), 'utf8');

const NOTE =
  "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.";

/** The ledger comment of a file, from `<!-- redlines` to `-->`. */
function ledgerComment(text: string): string {
  return text.slice(text.indexOf('<!-- redlines'), text.lastIndexOf('-->') + 3);
}

/** Every field a ledger can hold, with text that is awkward in YAML or in an HTML comment. */
const rich: Ledger = {
  version: 1,
  tracking: 'everyone',
  history: 'full',
  people: [
    { handle: 'ada', name: 'Ada Lovelace', email: 'ada@example.org', accounts: ['github:ada-l'] },
    {
      handle: 'alex-kim',
      name: 'Alex Kim, Esq.',
      email: 'alex.kim@example.org',
      org: 'Example "Law": Partners',
      aliases: ['akim', 'a.kim'],
      members: ['ada'],
      deleted: true,
    },
    { handle: 'bo', name: 'No' },
    { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' },
    { handle: 'zhang', name: '张伟 😀 José' },
  ],
  marks: {
    k3x9: { by: 'ada', at: '2026-10-13T22:30Z' },
    p7qd: {
      by: 'claude-ada',
      at: '2026-10-13T22:32Z',
      group: 'g2rs',
      note: 'Matches the roadmap, per Ada: see #3 -- `code` | {{x}} {%y%} \\ end-',
      move: 'n5vt',
      parts: 'a <!--ins b4rt-->x<!--/b4rt--> b\nc',
    },
  },
  comments: [
    {
      id: 'c8d2',
      by: 'ada',
      at: '2026-10-13T22:36Z',
      about: 'p7qd',
      edited: '2026-10-13T22:50Z',
      resolved: { by: 'ada', at: '2026-10-13T22:41Z' },
      assigned: 'bo',
      done: true,
      likes: [{ by: 'alex-kim', at: '2026-10-13T22:39Z' }],
      replies: [
        {
          id: 'r5tw',
          by: 'claude-ada',
          at: '2026-10-13T22:37Z',
          text: 'The tiers are in the appendix.\n\nSecond paragraph.',
        },
      ],
      quote: 'Uptime target is 99.9%.',
      text: [
        '  Indented first line',
        '',
        'A blank line above, then a backslash line, then two',
        '\\',
        '\\\\',
        'a trailing backslash \\',
        '- a list item and a rule: --',
        '| a | table |',
        'yes: no # not a comment',
        'with `code` and 😀 and é (e + combining acute: é)',
        '',
        '',
      ].join('\n'),
    },
  ],
  extra: {
    frontmatter: [{ key: 'title', by: 'ada', at: '2026-10-13T22:42Z', was: 'Launch' }],
    future: { a: 'b', list: ['x', 'y'] },
    flat: 'text with: a colon',
  },
};

describe('serializeLedger', () => {
  it('writes the example ledger', () => {
    expect(serializeLedger(parse(fixture).ledger)).toBe(ledgerComment(fixture));
  });

  it('round-trips every field', () => {
    const written = serializeLedger(rich);
    expect(parse(`Body.\n\n${written}\n`).ledger).toEqual(rich);
    expect(serializeLedger(parse(`Body.\n\n${written}\n`).ledger)).toBe(written);
  });

  it('writes a blank line in comment text as a backslash line', () => {
    const ledger: Ledger = {
      version: 1,
      people: [],
      marks: {},
      comments: [
        {
          id: 'c8d2',
          by: 'ada',
          at: '2026-10-13T22:40Z',
          likes: [],
          replies: [],
          text: 'First\n\nSecond',
        },
      ],
    };
    const written = serializeLedger(ledger);
    expect(written).toContain('    text: |-\n      First\n      \\\n      Second\n-->');
    expect(parse(`Body.\n\n${written}\n`).ledger.comments[0]?.text).toBe('First\n\nSecond');
  });

  it('writes the keys in order, people sorted by handle, and no defaults', () => {
    const ledger: Ledger = {
      version: 1,
      tracking: 'everyone',
      people: [
        { handle: 'bo', name: 'Bo Chen' },
        { handle: 'ada', name: 'Ada Lovelace' },
      ],
      marks: {},
      comments: [],
    };
    expect(serializeLedger(ledger)).toBe(
      [
        '<!-- redlines',
        NOTE,
        'version: 1',
        'tracking: everyone',
        'people:',
        '  ada: {name: Ada Lovelace}',
        '  bo: {name: Bo Chen}',
        '-->',
      ].join('\n'),
    );
    expect(
      serializeLedger({ version: 1, history: 'current', people: [], marks: {}, comments: [] }),
    ).toBe(['<!-- redlines', NOTE, 'version: 1', '-->'].join('\n'));
  });

  it('writes marks and threads in the order the ledger holds them', () => {
    const ledger: Ledger = {
      version: 1,
      people: [],
      marks: {
        w2rf: { by: 'bo', at: '2026-10-13T22:35Z' },
        k3x9: { by: 'ada', at: '2026-10-13T22:30Z' },
      },
      comments: [],
    };
    const written = serializeLedger(ledger);
    expect(written.indexOf('w2rf')).toBeLessThan(written.indexOf('k3x9'));
  });

  it('quotes what a YAML 1.1 reader or a flow map would change', () => {
    const written = serializeLedger(rich);
    expect(written).toContain(
      '  ada: {name: Ada Lovelace, email: ada@example.org, accounts: [github:ada-l]}',
    );
    expect(written).toContain('name: "No"');
    expect(written).toContain('name: "Alex Kim, Esq."');
    expect(written).toContain('org: "Example \\"Law\\": Partners"');
  });

  it('quotes a note that PyYAML would split in a flow map, such as one with a question mark', () => {
    const cases: [note: string, written: string][] = [
      ['Should this say April?', 'note: "Should this say April?"'],
      ['a?b', 'note: "a?b"'],
      ['why not, then', 'note: "why not, then"'],
      ['see [1] and {2}', 'note: "see [1] and {2}"'],
      ['a # b', 'note: "a # b"'],
      ['a: b', 'note: "a: b"'],
      ['ends with a colon:', 'note: "ends with a colon:"'],
      ['stays plain: not here', 'note: "stays plain: not here"'],
      ['a colon:inside stays plain', 'note: a colon:inside stays plain}'],
    ];
    for (const [note, written] of cases) {
      const ledger: Ledger = {
        version: 1,
        people: [],
        marks: { k3x9: { by: 'ada', at: '2026-10-13T22:30Z', note } },
        comments: [],
      };
      const comment = serializeLedger(ledger);
      expect(comment).toContain(written);
      expect(parse(`Body.\n\n${comment}\n`).ledger.marks['k3x9']?.note).toBe(note);
    }
  });

  it('writes handles as keys the way they are read, so a second save changes nothing', () => {
    const ledger: Ledger = {
      version: 1,
      people: [
        { handle: 'No', name: 'Not a boolean' },
        { handle: 'a--b', name: 'A B' },
        { handle: 'ada-', name: 'Ada' },
        { handle: 'q"uote\\', name: 'Odd' },
        { handle: 'with space', name: 'Odd' },
      ],
      marks: { k3x9: { by: 'a--b', at: '2026-10-13T22:30Z' } },
      comments: [],
    };
    const first = serializeLedger(ledger);
    // Plain when plain is safe; otherwise quoted with YAML escapes (a `--` would end the comment in
    // older Markdown parsers), never with payload escapes.
    expect(first).toContain('\n  "No": {name: Not a boolean}\n');
    expect(first).toContain('\n  "a-\\x2db": {name: A B}\n');
    expect(first).toContain('\n  ada-: {name: Ada}\n');
    expect(first).toContain('\n  "q\\"uote\\\\": {name: Odd}\n');
    expect(first).toContain('\n  "with space": {name: Odd}\n');
    expect(first.slice('<!--'.length, -'-->'.length)).not.toContain('--');

    const text = `Body <!--ins k3x9-->x<!--/k3x9-->.\n\n${first}\n`;
    const read = parse(text);
    expect(read.warnings).toEqual([]);
    expect(read.ledger.people.map((person) => person.handle)).toEqual(
      ledger.people.map((person) => person.handle),
    );
    expect(read.ledger).toEqual(ledger);
    // Saving again, and again, writes the same bytes.
    const second = serializeLedger(read.ledger);
    expect(second).toBe(first);
    expect(serializeLedger(parse(`Body.\n\n${second}\n`).ledger)).toBe(first);
    expect(setLedger(text, read.ledger)).toEqual([]);
  });

  it('writes the id of a reply the way it is read', () => {
    const ledger: Ledger = {
      version: 1,
      people: [],
      marks: {},
      comments: [
        {
          id: 'c8d2',
          by: 'ada',
          at: '2026-10-13T22:40Z',
          likes: [],
          replies: [{ id: 'a--b', by: 'bo', at: '2026-10-13T22:41Z', text: 'Hi' }],
          text: 'Hello',
        },
      ],
    };
    const first = serializeLedger(ledger);
    const read = parse(`Body.\n\n${first}\n`).ledger;
    expect(read).toEqual(ledger);
    expect(serializeLedger(read)).toBe(first);
  });

  it('never writes -- inside the comment', () => {
    const inside = serializeLedger(rich).slice('<!--'.length, -'-->'.length);
    expect(inside).not.toContain('--');
    expect(inside).not.toContain('`');
    expect(inside).not.toMatch(/\{\{|\{%/);
  });

  it('escapes control characters so the ledger stays readable', () => {
    const ledger: Ledger = {
      version: 1,
      people: [],
      marks: { k3x9: { by: 'ada', at: '2026-10-13T22:30Z', note: 'bell \u0007 and nel \u0085' } },
      comments: [
        {
          id: 'c8d2',
          by: 'ada',
          at: '2026-10-13T22:40Z',
          likes: [],
          replies: [],
          text: 'esc \u001b[0m',
        },
      ],
    };
    const parsed = parse(`Body.\n\n${serializeLedger(ledger)}\n`);
    expect(parsed.warnings.filter((w) => w.code === 'bad-ledger')).toEqual([]);
    expect(parsed.ledger).toEqual(ledger);
  });
});

describe('setLedger', () => {
  it('round-trips the fixture', () => {
    const changes = setLedger(fixture, parse(fixture).ledger);
    expect(changes).toEqual([]);
    expect(applyChanges(fixture, changes)).toBe(fixture);
  });

  it('keeps reactions and the fields it does not know, byte for byte', () => {
    const comment = [
      '<!-- redlines',
      NOTE,
      'version: 1',
      'people:',
      '  ada: {name: Ada Lovelace, pronouns: she/her, links: [https://example.org, x y]}',
      'marks:',
      '  k3x9: {by: ada, at: 2026-10-13T22:30Z, note: Fine, future: {when: soon, tags: [a, b]}}',
      'comments:',
      '  c8d2:',
      '    by: ada',
      '    at: 2026-10-13T22:40Z',
      '    likes:',
      '      - bo 2026-10-13T22:41Z',
      '    reactions:',
      '      heart: [bo 2026-10-13T22:42Z]',
      '    replies:',
      '      - id: r5tw',
      '        by: bo',
      '        at: 2026-10-13T22:43Z',
      '        text: |-',
      '          Fine.',
      '        mood: happy',
      '    text: |-',
      '      Hello',
      '    priority: high',
      '    history:',
      '      - {at: 2026-10-13T22:50Z, what: edited}',
      'frontmatter:',
      '  - {key: title, by: ada, at: 2026-10-13T22:42Z, was: Launch}',
      'future: soon',
      '-->',
    ].join('\n');
    const text = `Body <!--ins k3x9-->x<!--/k3x9--> <!--cmt c8d2-->y<!--/c8d2-->\n\n${comment}\n`;
    const parsed = parse(text);
    expect(parsed.ledger.people[0]?.extra).toEqual({
      pronouns: 'she/her',
      links: ['https://example.org', 'x y'],
    });
    expect(parsed.ledger.comments[0]?.reactions).toEqual({ heart: ['bo 2026-10-13T22:42Z'] });
    expect(serializeLedger(parsed.ledger)).toBe(comment);
    expect(setLedger(text, parsed.ledger)).toEqual([]);

    // A field that is changed is written, and the others stay.
    const [thread] = parsed.ledger.comments;
    if (!thread?.extra) throw new Error('The thread has no extra fields');
    const changed = {
      ...parsed.ledger,
      comments: [{ ...thread, extra: { ...thread.extra, priority: 'low' } }],
    };
    expect(applyChanges(text, setLedger(text, changed))).toBe(
      text.replace('priority: high', 'priority: low'),
    );
  });

  describe('with a ledger that cannot be read', () => {
    const ledger: Ledger = {
      version: 1,
      tracking: 'everyone',
      people: [{ handle: 'ada', name: 'Ada Lovelace' }],
      marks: {},
      comments: [],
    };
    const empty: Ledger = { version: 1, people: [], marks: {}, comments: [] };
    const message =
      "The ledger at the end of this file can't be read, so Redlines won't change it. Fix or remove it first.";
    const broken =
      'Body.\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\ncomments:\n  c8d2:\n    by: bo\n-->\n';
    const conflict = [
      'Body.',
      '',
      '<!-- redlines',
      'version: 1',
      '<<<<<<< HEAD',
      'people:',
      '  ada: {name: Ada}',
      '=======',
      'people:',
      '  bo: {name: Bo}',
      '>>>>>>> branch',
      '-->',
      '',
    ].join('\n');

    it('throws instead of replacing or removing it', () => {
      for (const text of [broken, conflict]) {
        expect(parse(text).warnings.map((w) => w.code)).toContain('bad-ledger');
        expect(() => setLedger(text, ledger)).toThrow(EditError);
        expect(() => setLedger(text, ledger)).toThrow(message);
        // An empty ledger would remove it, which loses what is in it just the same.
        expect(() => setLedger(text, empty)).toThrow(message);
      }
    });

    it('replaces or removes it when asked to', () => {
      const replaced = applyChanges(broken, setLedger(broken, ledger, { replaceUnreadable: true }));
      expect(replaced.startsWith('Body.\n\n<!-- redlines\n')).toBe(true);
      expect(parse(replaced).ledger).toEqual(ledger);
      expect(parse(replaced).warnings).toEqual([]);
      expect(applyChanges(conflict, setLedger(conflict, empty, { replaceUnreadable: true }))).toBe(
        'Body.\n',
      );
    });

    it('still changes a ledger that has odd values but is valid YAML', () => {
      const odd = broken.replace(
        'people: {ada: {name: Ada\n',
        'people:\n  ada: {name: Ada}\nfuture: 1\n',
      );
      expect(parse(odd).warnings.map((w) => w.code)).not.toContain('bad-ledger');
      expect(() => setLedger(odd, ledger)).not.toThrow();
    });
  });

  describe('with code in the file', () => {
    const example = [
      'Example:',
      '',
      '```markdown',
      '<!-- redlines',
      'version: 1',
      'marks:',
      '  k3x9: {by: ada, at: 2026-10-13T22:30Z}',
      '-->',
      '```',
    ].join('\n');
    const ledger: Ledger = {
      version: 1,
      tracking: 'everyone',
      people: [],
      marks: {},
      comments: [],
    };

    it('leaves an example ledger in a code block alone', () => {
      // With only the example, the ledger is added after it.
      const added = applyChanges(`${example}\n`, setLedger(`${example}\n`, ledger));
      expect(added.startsWith(`${example}\n\n<!-- redlines\n`)).toBe(true);
      expect(parse(added).ledger).toEqual(ledger);
      // Then it is the ledger that changes.
      const changed = applyChanges(added, setLedger(added, { ...ledger, history: 'full' }));
      expect(changed.startsWith(`${example}\n\n<!-- redlines\n`)).toBe(true);
      expect(parse(changed).ledger.history).toBe('full');
      // And removing it leaves the example.
      const empty: Ledger = { version: 1, people: [], marks: {}, comments: [] };
      expect(applyChanges(changed, setLedger(changed, empty))).toBe(`${example}\n`);
    });

    it('refuses to add a ledger where it would not be read', () => {
      const message =
        "The end of this file is inside a code block or a comment that is never closed, so Redlines can't add its ledger. Close it first.";
      expect(() => setLedger('Text\n\n```js\nlet x;\n', ledger)).toThrow(message);
      expect(() => setLedger('Text <!-- never closed\n', ledger)).toThrow(EditError);
      // A file that does not end in either is fine.
      expect(() => setLedger('Text `with a backtick\n', ledger)).not.toThrow();
    });
  });

  it('replaces a changed ledger in place', () => {
    const parsed = parse(fixture);
    const ledger: Ledger = { ...parsed.ledger, tracking: 'everyone' };
    const result = applyChanges(fixture, setLedger(fixture, ledger));
    expect(result).toContain('\ntracking: everyone\n');
    expect(result.slice(0, parsed.ledgerRange?.from)).toBe(
      fixture.slice(0, parsed.ledgerRange?.from),
    );
    expect(parse(result).ledger).toEqual(ledger);
  });

  it('removes an empty ledger', () => {
    const parsed = parse(fixture);
    const body = '# Launch plan\n\nWe will ship the importer in April, after the security review.';
    const text = body + fixture.slice(parsed.ledgerRange?.from);
    const result = applyChanges(
      text,
      setLedger(text, { ...parsed.ledger, marks: {}, comments: [] }),
    );
    expect(result).toBe(`${body}\n`);
    expect(result.endsWith('security review.\n')).toBe(true);
    expect(result).not.toContain('<!-- redlines');
  });

  it('keeps a ledger that still holds a setting', () => {
    const parsed = parse(fixture);
    const body = '# Launch plan\n\nPlain.';
    const text = body + fixture.slice(parsed.ledgerRange?.from);
    const ledger: Ledger = {
      version: 1,
      tracking: 'everyone',
      people: [],
      marks: {},
      comments: [],
    };
    const result = applyChanges(text, setLedger(text, ledger));
    expect(parse(result).ledger).toEqual(ledger);
  });

  it('adds a ledger to a plain file, in front of its last line break', () => {
    const plain = '# Notes\n\nA paragraph.\n\n\n';
    const ledger: Ledger = {
      version: 1,
      tracking: 'everyone',
      people: [{ handle: 'ada', name: 'Ada Lovelace' }],
      marks: {},
      comments: [],
    };
    const changes = setLedger(plain, ledger);
    // Nothing of the file is replaced: its blank lines stay in front of the ledger's own.
    expect(changes.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: plain.length - 1, to: plain.length - 1 },
    ]);
    const result = applyChanges(plain, changes);
    expect(result.startsWith('# Notes\n\nA paragraph.\n\n\n\n<!-- redlines\n')).toBe(true);
    expect(result.endsWith('-->\n')).toBe(true);
    expect(parse(result).ledger).toEqual(ledger);
    expect(parse(result).warnings).toEqual([]);
    const empty: Ledger = { version: 1, people: [], marks: {}, comments: [] };
    expect(applyChanges(result, setLedger(result, empty))).toBe(plain);
  });

  it('adds a ledger to a file with marks and no final newline, and gives it none', () => {
    const text = 'a <!--ins k3x9-->b<!--/k3x9-->';
    const ledger: Ledger = {
      version: 1,
      people: [{ handle: 'ada', name: 'Ada Lovelace' }],
      marks: { k3x9: { by: 'ada', at: '2026-10-13T22:30Z' } },
      comments: [],
    };
    const result = applyChanges(text, setLedger(text, ledger));
    expect(result).toBe(`${text}\n\n${serializeLedger(ledger)}`);
    const parsed = parse(result);
    expect(parsed.ledger).toEqual(ledger);
    expect(parsed.warnings).toEqual([]);
    expect(setLedger(result, parsed.ledger)).toEqual([]);
  });

  it('changes nothing in a plain file when the ledger is empty', () => {
    const empty: Ledger = { version: 1, people: [], marks: {}, comments: [] };
    expect(setLedger('# Notes\n', empty)).toEqual([]);
  });

  it('writes line breaks in the file’s style', () => {
    const plain = '# Notes\r\n\r\nText.\r\n';
    const ledger: Ledger = {
      version: 1,
      people: [],
      marks: {},
      comments: [
        {
          id: 'c8d2',
          by: 'ada',
          at: '2026-10-13T22:40Z',
          likes: [],
          replies: [],
          text: 'One\n\nTwo',
        },
      ],
    };
    const added = applyChanges(plain, setLedger(plain, ledger));
    expect(added.replaceAll('\r\n', '')).not.toContain('\n');
    expect(parse(added).ledger).toEqual(ledger);
    expect(setLedger(added, parse(added).ledger)).toEqual([]);
  });
});

describe("the ledger's line breaks (format §2.5, §5.1)", () => {
  const ledger: Ledger = {
    version: 1,
    people: [{ handle: 'ada', name: 'Ada Lovelace' }],
    marks: { k3x9: { by: 'ada', at: '2026-11-05T10:00Z' } },
    comments: [],
  };
  const empty: Ledger = { version: 1, people: [], marks: {}, comments: [] };
  /** The line breaks of a text as CommonMark reads them: CRLF, a CR alone, or LF. */
  const breaks = (text: string) => text.match(/\r\n|\r|\n/g)?.length ?? 0;

  /** Every text over CR, LF, a space and `x`, up to seven characters long. */
  function* smallBodies(): Generator<string> {
    let level = [''];
    yield '';
    for (let length = 1; length <= 7; length++) {
      level = level.flatMap((text) => ['\r', '\n', ' ', 'x'].map((c) => text + c));
      yield* level;
    }
  }

  it('takes the style of the body, which adding the ledger leaves as it was', () => {
    const failed: string[] = [];
    for (const body of smallBodies()) {
      const added = applyChanges(body, setLedger(body, ledger));
      const parsed = parse(added);
      const front = added.slice(0, added.indexOf('<!-- redlines'));
      // The body without its last line break, which is after the ledger.
      const kept = added.slice(0, parsed.ledgerRange?.from);
      const wrong = [
        // Written again, the ledger is the same.
        setLedger(added, parsed.ledger).length > 0 && 'written again',
        eolOf(added) !== eolOf(body) && 'another style',
        // Its blank line is two line breaks to any reader, CommonMark's too: a CR in front of it
        // and the LF that starts it are not one CRLF.
        kept !== '' && breaks(front) !== breaks(kept) + 2 && 'a blank line of another size',
      ].filter(Boolean);
      if (wrong.length > 0) failed.push(`${JSON.stringify(body)}: ${wrong.join(', ')}`);
    }
    expect(failed.slice(0, 10), `${failed.length} bodies`).toEqual([]);
  });

  it('has a blank line of CRLFs in front of it when the body ends in a CR alone', () => {
    const cases: [body: string, front: string, eol: string][] = [
      // The ledger's own lines have the file's line breaks, LF here.
      ['Hello world.\r\r', 'Hello world.\r\r\n\r\n', '\n'],
      ['Hello world.\rSecond\r\r', 'Hello world.\rSecond\r\r\n\r\n', '\n'],
      ['A\nHello world.\r\r\n', 'A\nHello world.\r\r\n\r\n', '\r\n'],
      // Not after a CR that ends a line of text.
      ['Hello world.\r', 'Hello world.\n\n', '\n'],
    ];
    for (const [body, front, eol] of cases) {
      const added = applyChanges(body, setLedger(body, ledger));
      const last = /\r\n$|\r$|\n$/.exec(body)?.[0] ?? '';
      expect(added).toBe(`${front}${serializeLedger(ledger).replaceAll('\n', eol)}${last}`);
      expect(applyChanges(added, setLedger(added, empty))).toBe(body);
    }
  });

  it('gives typed line breaks the style of the body once the ledger is in', () => {
    const cases: [body: string, eol: string][] = [
      ['Hello world.\r\r', '\n'],
      ['Hello world.\r\rSecond.\r\r', '\n'],
      ['Hello world.\r\n\r\n', '\r\n'],
    ];
    for (const [body, eol] of cases) {
      const changed = applyChanges(
        body,
        trackedEdit(body, { from: 6, to: 11, insert: 'there' }, context(ada, ['k3x9'])),
      );
      expect(eolOf(changed)).toBe(eol);
      const typed = applyChanges(
        changed,
        trackedEdit(
          changed,
          { from: 5, to: 5, insert: ' new\nline' },
          context(ada, ['w8nn', 'p7qd', 'b4rt']),
        ),
      );
      // A line break typed in a line is a split (format §3.4), followed by the break itself.
      expect(typed).toMatch(new RegExp(`new<!--split [a-z0-9]{4}-->${eol}line`));
      expect(setLedger(typed, parse(typed).ledger)).toEqual([]);
    }
  });

  describe('when it was written with a CR alone for a line break', () => {
    // What the editor wrote before (build 10) after a change in a file whose first line break is a
    // CR alone: the ledger and its blank line with CRs.
    const editors = (body: string) =>
      body.replace('world', '<!--sub k3x9 world-->there<!--/k3x9-->').replace(/\r$/, '') +
      `\r\r${serializeLedger(ledger).replaceAll('\n', '\r')}\r`;
    const old = editors('Hello world.\r\rSecond line here.\r');
    const message =
      "The ledger at the end of this file can't be read, so Redlines won't change it. Fix or remove it first.";
    const ctx = () => context(ada, ['w8nn']);

    it('is a ledger that cannot be read', () => {
      const parsed = parse(old);
      expect(parsed.warnings.map((w) => w.code)).toContain('bad-ledger');
      expect(old.slice(0, parsed.ledgerRange?.from)).toBe(
        'Hello <!--sub k3x9 world-->there<!--/k3x9-->.\r\rSecond line here.',
      );
      expect(old.slice(parsed.ledgerRange?.to)).toBe('\r');
      expect(newestView(old).text).toBe('Hello there.\r\rSecond line here.\r');
      // So are one that a CR alone precedes, and one whose first line ends in a CR alone.
      for (const text of [
        `Body.\r\r${serializeLedger(ledger)}\r`,
        `Body.\n\n${serializeLedger(ledger).replace('\n', '\r')}\n`,
      ]) {
        expect(parse(text).warnings.map((w) => w.code)).toContain('bad-ledger');
        expect(() => setLedger(text, ledger)).toThrow(message);
      }
    });

    it('is never written over, nor joined by a second ledger', () => {
      const at = old.indexOf('Second');
      const refused = [
        () => setLedger(old, ledger),
        () => setLedger(old, empty),
        () => trackedEdit(old, { from: at, to: at + 6, insert: 'Third' }, ctx()),
        () => addComment(old, { from: at, to: at + 6 }, 'Why?', ctx()),
        () => reject(old, 'k3x9'),
        () => accept(old, 'k3x9'),
      ];
      for (const write of refused) {
        expect(write).toThrow(message);
        try {
          write();
        } catch (error) {
          expect(error instanceof EditError && error.code).toBe('unreadable-ledger');
        }
      }
    });

    it('is replaced or removed, with its blank line, when asked to', () => {
      const removed = applyChanges(old, setLedger(old, empty, { replaceUnreadable: true }));
      expect(removed).toBe('Hello <!--sub k3x9 world-->there<!--/k3x9-->.\r\rSecond line here.\r');
      const replaced = applyChanges(old, setLedger(old, ledger, { replaceUnreadable: true }));
      expect(replaced).toBe(
        `Hello <!--sub k3x9 world-->there<!--/k3x9-->.\r\rSecond line here.\n\n${serializeLedger(ledger)}\r`,
      );
      expect(parse(replaced).ledger).toEqual(ledger);
      expect(parse(replaced).warnings).toEqual([]);
    });
  });
});

describe('the bytes a file gets back (format §5.1, §9.2)', () => {
  /** Bodies that end in each way a file can, each with the word `world` in it. */
  const SHAPES: [string, string][] = [
    ['no final line break', 'Hello world.\n\nSecond line here.'],
    ['a final LF', 'Hello world.\n\nSecond line here.\n'],
    ['a final CRLF', 'Hello world.\r\n\r\nSecond line here.\r\n'],
    ['a final CR', 'Hello world.\n\nSecond line here.\r'],
    ['CRLF and no final line break', 'Hello world.\r\n\r\nSecond line here.'],
    ['only CR line breaks', 'Hello world.\r\rSecond line here.\r'],
    ['mixed line breaks, the last LF', 'Hello world.\r\nTwo\r\nThree\n'],
    ['mixed line breaks, the last CRLF', 'Hello world.\nTwo\nThree\r\n'],
    ['mixed line breaks, the last CR', 'Hello world.\r\nTwo\nThree\r'],
    ['a CR in front of the final CRLF', 'Hello world.\r\r\n'],
    ['an LF in front of the final CRLF', 'Hello world.\n\r\n'],
    ['a blank line at the end', 'Hello world.\n\n'],
    ['blank lines at the end', 'Hello world.\n\n\n'],
    ['a CRLF blank line at the end', 'Hello world.\r\n\r\n'],
    ['a CR blank line at the end', 'Hello world.\r\r'],
    ['spaces at the end', 'Hello world.  '],
    ['spaces at the end of the last line', 'Hello world.  \n'],
    ['a last line of spaces', 'Hello world.\n  '],
    ['a last line of white space and a final LF', 'Hello world.\n \t\n'],
    ['a byte order mark', '\uFEFFHello world.'],
    ['a byte order mark and a final CRLF', '\uFEFFHello world.\r\n'],
    ['front matter', '---\ntitle: Notes\n---\n\nHello world.'],
    ['front matter and CRLF', '---\r\ntitle: Notes\r\n---\r\nHello world.\r\n'],
    ['a code block at the end', 'Hello world.\n\n```\ncode\n```'],
    ['an HTML comment at the end', 'Hello world.\n\n<!-- a note -->'],
    ['a list at the end', '- Hello world.\n- two'],
  ];

  /** The file's last line break, which stays its last: the ledger goes in front of it. */
  const lastBreak = (text: string) => /\r\n$|\r$|\n$/.exec(text)?.[0] ?? '';
  const rejected = (text: string) => applyChanges(text, rejectAll(text));
  const accepted = (text: string) => applyChanges(text, acceptAll(text));
  const tracked = (text: string, edit: TextChange) =>
    applyChanges(text, trackedEdit(text, edit, context(ada, ['k3x9'])));

  /** Edits of the body: a word changed, taken away and added, and text added at its end when its
   * text ends in a word. */
  function editsOf(body: string): TextChange[] {
    const at = body.indexOf('world');
    const edits = [
      { from: at, to: at + 5, insert: 'there' },
      { from: at, to: at + 5, insert: '' },
      { from: at + 5, to: at + 5, insert: ' wide' },
    ];
    const end = body.replace(/\s+$/, '').length;
    if (/[\p{L}.]$/u.test(body.slice(0, end))) edits.push({ from: end, to: end, insert: ' More.' });
    return edits;
  }

  it.each(SHAPES)(
    'gives back a body with %s when its change is rejected, and the newest text when it is accepted',
    (_, body) => {
      for (const edit of editsOf(body)) {
        const label = `${JSON.stringify(body)}, ${JSON.stringify(edit)}`;
        const changed = tracked(body, edit);
        expect(changed.endsWith(`-->${lastBreak(body)}`), label).toBe(true);
        expect(rejected(changed), label).toBe(body);
        expect(accepted(changed), label).toBe(applyChanges(body, [edit]));
      }
    },
  );

  it.each(SHAPES)('gives back a body with %s when its thread is deleted', (_, body) => {
    const at = body.indexOf('world');
    const ctx = context(ada, ['c8d2']);
    const { changes, id } = addComment(body, { from: at, to: at + 5 }, 'Why?', ctx);
    const commented = applyChanges(body, changes);
    expect(commented.endsWith(`-->${lastBreak(body)}`)).toBe(true);
    expect(applyChanges(commented, deleteThread(commented, id))).toBe(body);
  });

  it.each(SHAPES)('gives back a body with %s after the ledger is written again', (_, body) => {
    // Two changes and a thread: each decision but the last writes the ledger again.
    const [replace, , insert] = editsOf(body) as [TextChange, TextChange, TextChange];
    let text = applyChanges(body, trackedEdit(body, insert, context(ada, ['k3x9'])));
    const at = text.indexOf('world');
    text = applyChanges(
      text,
      trackedEdit(text, { ...replace, from: at, to: at + 5 }, context(ada, ['w8nn'])),
    );
    const hello = text.indexOf('Hello');
    const range = { from: hello + 1, to: hello + 5 };
    const { changes, id } = addComment(text, range, 'Why?', context(ada, ['c8d2']));
    text = applyChanges(text, changes);
    expect(Object.keys(parse(text).ledger.marks)).toEqual(['w8nn', 'k3x9']);
    const decided = rejected(text);
    expect(parse(decided).ledgerRange).not.toBeNull();
    expect(applyChanges(decided, deleteThread(decided, id))).toBe(body);
  });

  /** Whether a body has line breaks of another kind than the file's (`eolOf`), a CR alone or LF
   * and CRLF both, which a payload gives back in the file's kind (format §2.5). */
  const mixed = (body: string) =>
    /\r(?!\n)/.test(body) || (body.includes('\r\n') && /(?<!\r)\n/.test(body));
  /** A text with each line break an LF. */
  const kinds = (text: string) => text.replace(/\r\n?/g, '\n');

  /** Text typed after the file's last line break, and that line break deleted. */
  function endsOf(text: string): TextChange[] {
    const last = lastBreak(text);
    const ends = [{ from: text.length, to: text.length, insert: 'Z' }];
    if (last) ends.push({ from: text.length - last.length, to: text.length, insert: '' });
    return ends;
  }

  it.each(SHAPES)(
    'decides a body with %s where text is typed after its last line break, or that break is deleted',
    (_, body) => {
      // In the file as it is, and after a first change, with the ledger in front of that break.
      const at = body.indexOf('world');
      for (const start of [body, tracked(body, { from: at, to: at + 5, insert: 'there' })]) {
        for (const edit of endsOf(start)) {
          const label = `${JSON.stringify(start)}, ${JSON.stringify(edit)}`;
          let after: string;
          try {
            after = applyChanges(start, trackedEdit(start, edit, context(ada, ['w8nn', 'p7qd'])));
          } catch (error) {
            // A CR alone that is deleted isn't written as a change.
            if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) continue;
            throw error;
          }
          const was = newestView(start).text;
          const newest = edit.insert ? `${was}Z` : was.slice(0, was.length - lastBreak(was).length);
          // The newest text is the edit's, and decisions give the views, always.
          expect(newestView(after).text, label).toBe(newest);
          expect(accepted(after), label).toBe(newest);
          const original = originalView(after).text;
          expect(rejected(after), label).toBe(original);
          if (!parse(after).ledgerRange) {
            // White space deleted at the end of a file with no change is no change (§3.4).
            expect(after, label).toBe(newest);
          } else if (!mixed(body)) {
            expect(original, label).toBe(body);
          } else if (!/\r(?!\n)/.test(body)) {
            // A line break of another kind than the file's comes back in the file's (§2.5). After
            // a CR alone, the LF that comes back can make one CRLF of the two: the gap below.
            expect(kinds(original), label).toBe(kinds(body));
          }
        }
      }
    },
  );

  it("gives a payload's line break back in the file's kind, not its own (a known gap)", () => {
    // Keeping the kind of a payload's line break needs an escape the format doesn't have yet
    // (format §2.5): the follow-up issue to #56. Text typed after a final LF in a file whose line
    // breaks are CRLF makes a substitution of that LF, whose payload comes back as a CRLF.
    const body = 'Hello world.\r\n\r\nSecond line here.\n';
    const typed = tracked(body, { from: body.length, to: body.length, insert: 'Z' });
    expect(typed).toContain('here.<!--sub k3x9 \\n-->\nZ<!--/k3x9-->');
    expect(rejected(typed)).toBe('Hello world.\r\n\r\nSecond line here.\r\n');
    expect(accepted(typed)).toBe('Hello world.\r\n\r\nSecond line here.\nZ');
    // A CR alone that is deleted comes back as an LF, which can make one CRLF with a CR in front
    // of it: a line break fewer for a CommonMark reader.
    const cr = tracked('Hello world.\r\r', { from: 6, to: 11, insert: 'there' });
    const end = cr.length;
    const unbroken = applyChanges(
      cr,
      trackedEdit(cr, { from: end - 1, to: end, insert: '' }, context(ada, ['w8nn'])),
    );
    expect(rejected(unbroken)).toBe('Hello world.\r\n');
  });

  it('gives back a file that is empty or only white space', () => {
    const bodies = [
      '',
      '\n',
      '\r\n',
      '\r',
      '\n\n',
      '\r\n\r\n',
      ' ',
      '  \n',
      '\t\r\n\r\n',
      '\uFEFF',
    ];
    for (const body of [...bodies, '\uFEFF\r\n']) {
      let made = 0;
      for (let at = 0; at <= body.length; at++) {
        // Not between the CR and the LF of a line break.
        if (body[at - 1] === '\r' && body[at] === '\n') continue;
        const edit = { from: at, to: at, insert: 'Hello' };
        const label = `${JSON.stringify(body)} at ${at}`;
        let changed: string;
        try {
          changed = tracked(body, edit);
        } catch (error) {
          // A marker can't go in the indentation of a line.
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) continue;
          throw error;
        }
        made++;
        // Text typed after the last line break ends the body.
        const newest = applyChanges(body, [edit]);
        expect(changed.endsWith(`-->${lastBreak(newest)}`), label).toBe(true);
        expect(rejected(changed), label).toBe(body);
        expect(accepted(changed), label).toBe(newest);
      }
      expect(made, JSON.stringify(body)).toBeGreaterThan(0);
      const { changes, id } = addComment(body, { from: 0, to: 0 }, 'Why?', context(ada, ['c8d2']));
      const commented = applyChanges(body, changes);
      expect(applyChanges(commented, deleteThread(commented, id)), JSON.stringify(body)).toBe(body);
    }
  });

  it('keeps text after the ledger, and takes away only what the ledger added', () => {
    for (const body of ['Hello world.\n', 'Hello world.\r\n', 'Hello world.']) {
      const changed = tracked(body, { from: 6, to: 11, insert: 'there' });
      // Another tool adds a line at the end of the file, after the ledger.
      const after = lastBreak(changed) ? 'After.\n' : '\nAfter.';
      expect(rejected(`${changed}${after}`)).toBe(`${body}${after}`);
      expect(accepted(`${changed}${after}`)).toBe(`Hello there.${lastBreak(body)}${after}`);
    }
  });

  it('decides the changes made after the ledger: to the final line break, and text typed there', () => {
    for (const body of ['Hello world.\n', 'Hello world.\r\n', 'Hello world.\n\n']) {
      const changed = tracked(body, { from: 6, to: 11, insert: 'there' });
      const end = changed.length;
      const last = lastBreak(changed);
      const unbroken = applyChanges(
        changed,
        trackedEdit(
          changed,
          { from: end - last.length, to: end, insert: '' },
          context(ada, ['w8nn']),
        ),
      );
      expect(rejected(unbroken)).toBe(body);
      expect(accepted(unbroken)).toBe(`Hello there.${body.slice(12, -last.length)}`);
      const typed = applyChanges(
        changed,
        trackedEdit(changed, { from: end, to: end, insert: 'x' }, context(ada, ['w8nn'])),
      );
      expect(rejected(typed)).toBe(body);
      expect(accepted(typed)).toBe(`Hello there.${body.slice(12)}x`);
    }
  });

  it('reads a file written by an earlier version the same', () => {
    // A ledger used to end with a line break whether or not the body did, and a body's blank lines
    // at its end were dropped: the line break after the ledger is the body's.
    const ledger: Ledger = {
      version: 1,
      people: [{ handle: 'ada', name: 'Ada Lovelace' }],
      marks: { k3x9: { by: 'ada', at: '2026-10-13T22:30Z' } },
      comments: [],
    };
    for (const eol of ['\n', '\r\n']) {
      const body = `# Plan${eol}${eol}We will ship the <!--ins k3x9-->new <!--/k3x9-->importer.`;
      const text = `${body}${eol}${eol}${serializeLedger(ledger).replaceAll('\n', eol)}${eol}`;
      const parsed = parse(text);
      expect(parsed.ledger).toEqual(ledger);
      expect(text.slice(0, parsed.ledgerRange?.from)).toBe(body);
      expect(text.slice(parsed.ledgerRange?.to)).toBe(eol);
      expect(rejected(text)).toBe(`# Plan${eol}${eol}We will ship the importer.${eol}`);
      expect(accepted(text)).toBe(`# Plan${eol}${eol}We will ship the new importer.${eol}`);
    }
  });
});

describe('on random files (format §5.1, §9.2)', { timeout: 600_000 }, () => {
  const WORDS = ['alpha', 'beta', 'gamma', 'café', 'éclair', '😀', 'x', '42'];
  const NEW = ['new', 'zeta', 'ünë', '🎉'];
  /** The first line of a block, and of the lines after it; a heading has one line. */
  const BLOCKS: readonly [string, string | null][] = [
    ['', ''],
    ['', ''],
    ['- ', '  '],
    ['1. ', '   '],
    ['> ', '> '],
    ['# ', null],
  ];

  /**
   * A body of words in paragraphs, items, quotes and headings: with the line breaks of a file that
   * has one kind of them or a mix, any end (none, a line break, blank lines, spaces), and at times
   * a byte order mark or front matter.
   */
  function randomBody(random: () => number): string {
    const below = (n: number) => Math.floor(random() * n);
    const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
    const kinds = pick([['\n'], ['\r\n'], ['\r'], ['\n', '\r\n'], ['\n', '\r\n', '\r']]);
    const br = () => pick(kinds);
    const words = () => Array.from({ length: 2 + below(4) }, () => pick(WORDS)).join(' ');
    let body = random() < 0.1 ? '\uFEFF' : '';
    if (random() < 0.1) body += `---${br()}title: Notes${br()}---${br()}`;
    const blocks = 1 + below(4);
    for (let b = 0; b < blocks; b++) {
      if (b > 0) body += `${br()}${random() < 0.2 ? ' ' : ''}${br()}`;
      const [first, rest] = pick(BLOCKS);
      const lines = rest === null ? 1 : 1 + below(3);
      for (let l = 0; l < lines; l++)
        body += l === 0 ? `${first}${words()}` : `${br()}${rest}${words()}`;
    }
    const ends = [() => '', br, () => br() + br(), () => br() + br() + br(), () => '  '];
    ends.push(
      () => `${br()}  `,
      () => `  ${br()}`,
      () => `${br()} \t${br()}`,
    );
    return body + pick(ends)();
  }

  /** The words of a newest view that come after another word on their line, which a change or a
   * comment can be put on without a marker at the start of a line. */
  const targets = (view: string): Range[] =>
    [...view.matchAll(/(?<=[^\s>#.:*+-] )\S+/gu)].map((m) => ({
      from: m.index,
      to: m.index + m[0].length,
    }));

  /** Decisions refused in one order and made in another. */
  let reordered = 0;

  /**
   * Decides each change of the file and deletes each thread, one at a time in a random order. A
   * decision that is refused in that order, as when it would put the opener of a change after it
   * at the start of a line, is made later, after the others ("Decide the changes next to it first").
   */
  function decideAll(start: string, how: 'accept' | 'reject', below: (n: number) => number) {
    let text = start;
    for (let round = 0; round < 100; round++) {
      const parsed = parse(text);
      const todo = [
        ...parsed.marks.filter((mark) => mark.kind !== 'cmt').map((mark) => mark.id),
        ...parsed.ledger.comments.map((thread) => `thread ${thread.id}`),
      ];
      if (todo.length === 0) return text;
      // A random order: each in turn is taken from those left.
      const order: string[] = [];
      while (todo.length > 0) order.push(...todo.splice(below(todo.length), 1));
      const done = order.some((next) => {
        const id = next.replace('thread ', '');
        const decide = next.startsWith('thread ')
          ? deleteThread
          : how === 'accept'
            ? accept
            : reject;
        try {
          text = applyChanges(text, decide(text, id));
          return true;
        } catch (error) {
          if (!(error instanceof EditError && REFUSALS.includes(error.code ?? ''))) throw error;
          reordered++;
          return false;
        }
      });
      if (!done) throw new Error(`Nothing can be decided: ${JSON.stringify(text)}`);
    }
    throw new Error(`Not everything is decided: ${JSON.stringify(text)}`);
  }

  /** The text's last line break. */
  const lastBreak = (text: string) => /\r\n$|\r$|\n$/.exec(text)?.[0] ?? '';
  /** Whether a body has line breaks of another kind than the file's (`eolOf`), a CR alone or LF
   * and CRLF both, which a payload gives back in the file's kind (format §2.5). */
  const mixed = (body: string) =>
    /\r(?!\n)/.test(body) || (body.includes('\r\n') && /(?<!\r)\n/.test(body));
  const kinds = (text: string) => text.replace(/\r\n?/g, '\n');

  it('gives back the bytes when every change is rejected, and the newest text when accepted', () => {
    const files = fuzzCount(300);
    reordered = 0;
    let edits = 0;
    let refused = 0;
    let atTheEnd = 0;
    let exact = 0;
    const ends = new Set<string>();
    for (let seed = 1; seed <= files; seed++) {
      const random = seeded(seed * 7919);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
      const body = randomBody(seeded(seed));
      let text = body;
      let newest = body;
      // What rejecting everything gives: the body, but for white space deleted at its end with no
      // change in the file, which is no change (format §3.4), and in a mixed file for the kinds of
      // its line breaks (§2.5).
      let original = body;
      const steps = 1 + below(4);
      for (let step = 0; step < steps; step++) {
        const view = newestView(text);
        // The body's words, not those typed after the ledger.
        const ledger = parse(text).ledgerRange;
        const words = targets(view.text).filter(
          (target) => !ledger || view.map.toSource(target.to, -1) <= ledger.from,
        );
        const word = pick(words);
        if (!word) break;
        // A word changed, deleted or added to, a comment, and, now and then, text typed after the
        // file's last line break, or that line break deleted: past the ledger once it is in.
        const kind = below(10);
        const last = lastBreak(text);
        const atEnd = kind >= 8;
        if (kind === 9 && !last) continue;
        const wanted: TextChange[] = [
          { ...word, insert: pick(NEW) },
          { from: word.from - 1, to: word.to, insert: '' },
          { from: word.to, to: word.to, insert: ` ${pick(NEW)}` },
          { ...word, insert: '' },
        ];
        const edit = (atEnd ? undefined : wanted[kind % 4]) as TextChange;
        let from: number;
        let to: number;
        if (kind === 8) from = to = text.length;
        else if (kind === 9) [from, to] = [text.length - last.length, text.length];
        else {
          // The ends of a range stay on its text, and the point of an insertion is on either side
          // of the markers there. Nothing goes after the ledger.
          const stop = parse(text).ledgerRange?.from ?? Infinity;
          const point = edit.from === edit.to;
          from = Math.min(view.map.toSource(edit.from, point && below(2) ? -1 : 1), stop);
          to = point ? from : Math.min(view.map.toSource(edit.to, -1), stop);
        }
        const insert = kind === 8 ? pick(NEW) : atEnd ? '' : edit.insert;
        const bytes = seeded(seed * 104729 + step);
        const ctx: EditContext = {
          author: pick([ada, bo]),
          time: '2026-11-05T10:00Z',
          random: (n) => Uint8Array.from({ length: n }, () => Math.floor(bytes() * 256)),
        };
        const label = `seed ${seed}, step ${step}: ${kind} ${JSON.stringify({ from, to, insert })} on ${JSON.stringify(text)}`;
        const before = text;
        try {
          text = applyChanges(
            text,
            kind % 4 === 3 && !atEnd
              ? addComment(text, { from, to }, 'Why?', ctx).changes
              : trackedEdit(text, { from, to, insert }, ctx),
          );
        } catch (error) {
          if (!(error instanceof EditError && REFUSALS.includes(error.code ?? ''))) throw error;
          refused++;
          continue;
        }
        edits++;
        if (kind === 8) newest += insert;
        else if (kind === 9) newest = newest.slice(0, newest.length - lastBreak(newest).length);
        else if (kind !== 3 && kind !== 7) newest = applyChanges(newest, [edit]);
        expect(newestView(text).text, label).toBe(newest);
        const now = originalView(text).text;
        if (atEnd) {
          atTheEnd++;
          // White space deleted at the end of a file with no change is no change (format §3.4). A
          // line break of another kind than the file's comes back in the file's (§2.5), and after
          // a CR alone, the LF that comes back can make one CRLF of the two.
          if (!parse(before).ledgerRange && !parse(text).ledgerRange) {
            expect(now, label).toBe(newest);
          } else if (!mixed(body)) expect(now, label).toBe(original);
          else if (!/\r(?!\n)/.test(body)) expect(kinds(now), label).toBe(kinds(original));
          original = now;
        }
        expect(now, label).toBe(original);
      }
      if (text === body) continue;
      ends.add(JSON.stringify(lastBreak(body)));
      if (original === body) exact++;
      const label = `seed ${seed}: ${JSON.stringify(body)} => ${JSON.stringify(text)}`;
      expect(decideAll(text, 'reject', below), label).toBe(original);
      expect(decideAll(text, 'accept', below), label).toBe(newest);
    }
    expect(edits).toBeGreaterThan(files);
    expect(refused).toBeLessThan(edits / 20);
    expect(reordered).toBeLessThan(files / 100);
    expect(atTheEnd).toBeGreaterThan(files / 10);
    // Most files give their bytes back; the others lost white space at their end with no change
    // in them, or are mixed.
    expect(exact).toBeGreaterThan(files / 2);
    // Bodies that end with no line break, an LF, a CRLF and a CR.
    expect(ends.size).toBe(4);
  });
});
