import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { serializeLedger, setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import type { Ledger } from './types.ts';

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

  it('adds a ledger to a plain file', () => {
    const plain = '# Notes\n\nA paragraph.\n\n\n';
    const ledger: Ledger = {
      version: 1,
      tracking: 'everyone',
      people: [{ handle: 'ada', name: 'Ada Lovelace' }],
      marks: {},
      comments: [],
    };
    const result = applyChanges(plain, setLedger(plain, ledger));
    expect(result.startsWith('# Notes\n\nA paragraph.\n\n<!-- redlines\n')).toBe(true);
    expect(result.endsWith('-->\n')).toBe(true);
    expect(parse(result).ledger).toEqual(ledger);
    expect(parse(result).warnings).toEqual([]);
  });

  it('adds a ledger to a file with marks and no final newline', () => {
    const text = 'a <!--ins k3x9-->b<!--/k3x9-->';
    const ledger: Ledger = {
      version: 1,
      people: [{ handle: 'ada', name: 'Ada Lovelace' }],
      marks: { k3x9: { by: 'ada', at: '2026-10-13T22:30Z' } },
      comments: [],
    };
    const result = applyChanges(text, setLedger(text, ledger));
    expect(result.startsWith(`${text}\n\n<!-- redlines\n`)).toBe(true);
    expect(result.endsWith('-->\n')).toBe(true);
    const parsed = parse(result);
    expect(parsed.ledger).toEqual(ledger);
    expect(parsed.warnings).toEqual([]);
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
