import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from './parse.ts';
import type { MarkRange, Parsed } from './types.ts';

const fixture = readFileSync(new URL('./fixtures/launch-plan.md', import.meta.url), 'utf8');

/** A file whose ledger has the given `marks` lines (and Ada, so authors resolve). */
function withLedger(body: string, marks: string[], extra = ''): string {
  const lines = ['<!-- redlines', 'version: 1', 'people:', '  ada: {name: Ada Lovelace}', 'marks:'];
  return `${body}\n\n${[...lines, ...marks.map((m) => `  ${m}`), extra, '-->'].filter((l) => l !== '').join('\n')}\n`;
}

const codes = (parsed: Parsed) => parsed.warnings.map((w) => w.code);

function contentOf(parsed: Parsed, mark: MarkRange, segment = 0): string {
  const content = mark.segments[segment]?.content;
  if (!content) throw new Error('No such segment');
  return parsed.text.slice(content.from, content.to);
}

describe('parse', () => {
  it('parses the launch-plan example', () => {
    const parsed = parse(fixture);
    expect(parsed.marks.map((m) => [m.id, m.kind])).toEqual([
      ['k3x9', 'ins'],
      ['p7qd', 'sub'],
      ['c8d2', 'cmt'],
      ['w2rf', 'del'],
    ]);
    const [ins, sub, cmt, del] = parsed.marks;
    expect(sub?.payload).toBe('March');
    expect(sub && contentOf(parsed, sub)).toBe('April');
    expect(ins && contentOf(parsed, ins)).toBe('new ');
    expect(cmt && contentOf(parsed, cmt)).toBe('security review');
    expect(del?.payload).toBe(' The old exporter stays as it is.');
    expect(sub?.entry).toEqual({
      by: 'claude-ada',
      at: '2026-10-13T22:31Z',
      note: 'Matches the roadmap',
    });
    expect(cmt?.entry).toEqual({ by: 'bo', at: '2026-10-13T22:40Z' });
    expect(parsed.ledger.people.map((p) => p.handle)).toEqual(['ada', 'bo', 'claude-ada']);
    expect(parsed.ledger.people[2]).toEqual({
      handle: 'claude-ada',
      name: 'Claude',
      agent: true,
      for: 'ada',
    });
    expect(parsed.ledger.comments[0]).toMatchObject({
      id: 'c8d2',
      by: 'bo',
      at: '2026-10-13T22:40Z',
      text: 'Who signs off on the security review?',
    });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.text).toBe(fixture);
    expect(parsed.text.slice(parsed.ledgerRange?.from)).toMatch(/^\n\n<!-- redlines/);
    expect(parsed.ledgerRange?.to).toBe(fixture.length - 1);
  });

  it('keeps a plain file', () => {
    const text = '# Notes\n\nSee <!-- TODO --> here.\n';
    const parsed = parse(text);
    expect(parsed.text).toBe(text);
    expect(parsed.marks).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.ledgerRange).toBeNull();
    expect(parsed.ledger).toEqual({ version: 1, people: [], marks: {}, comments: [] });
  });

  it('reports an unclosed mark as text', () => {
    const parsed = parse('a <!--ins k3x9-->b\n');
    expect(parsed.marks).toEqual([]);
    expect(codes(parsed)).toEqual(['unclosed-mark']);
    expect(parsed.warnings[0]?.range).toEqual({ from: 2, to: 17 });
  });

  it('reports a closer without opener', () => {
    const parsed = parse('a <!--/k3x9-->b\n');
    expect(parsed.marks).toEqual([]);
    expect(codes(parsed)).toEqual(['unopened-close']);
  });

  it('uses unknown for a missing entry', () => {
    const parsed = parse('a <!--ins k3x9-->b<!--/k3x9-->\n');
    expect(parsed.marks).toHaveLength(1);
    expect(parsed.marks[0]?.entry).toEqual({ by: 'unknown', at: '' });
    expect(codes(parsed)).toEqual(['missing-entry']);
    expect(parsed.warnings[0]?.id).toBe('k3x9');
  });

  it('joins segments', () => {
    const body =
      'The <!--ins k3x9-->shiny <!--/k3x9--><!--ins w8nn-->and fast <!--/w8nn--><!--ins k3x9-->importer<!--/k3x9-->';
    const parsed = parse(
      withLedger(body, [
        'k3x9: {by: ada, at: 2026-10-13T22:30Z}',
        'w8nn: {by: ada, at: 2026-10-13T22:31Z}',
      ]),
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.marks.map((m) => [m.id, m.segments.length])).toEqual([
      ['k3x9', 2],
      ['w8nn', 1],
    ]);
    const [k3x9] = parsed.marks;
    expect(k3x9 && contentOf(parsed, k3x9, 0)).toBe('shiny ');
    expect(k3x9 && contentOf(parsed, k3x9, 1)).toBe('importer');
  });

  it('joins the payloads of a deletion split around another mark', () => {
    const body =
      'Ship <!--del b4rt the old --><!--del c2zf legacy --><!--del b4rt exporter -->now.';
    const parsed = parse(
      withLedger(body, [
        'b4rt: {by: ada, at: 2026-10-13T22:30Z}',
        'c2zf: {by: ada, at: 2026-10-13T22:31Z}',
      ]),
    );
    expect(parsed.warnings).toEqual([]);
    const [b4rt, c2zf] = parsed.marks;
    expect(b4rt?.segments.map((s) => s.payload)).toEqual(['the old ', 'exporter ']);
    expect(b4rt?.payload).toBe('the old exporter ');
    expect(c2zf?.payload).toBe('legacy ');
  });

  it('survives a broken ledger', () => {
    const text =
      '<!--ins k3x9-->a<!--/k3x9-->\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    const parsed = parse(text);
    expect(codes(parsed)).toContain('bad-ledger');
    expect(parsed.ledger.people).toEqual([]);
    expect(parsed.marks.map((m) => m.id)).toEqual(['k3x9']);
    expect(parsed.ledgerRange).not.toBeNull();
  });

  it('survives a ledger that is not a mapping', () => {
    const parsed = parse('a\n\n<!-- redlines\n- one\n- two\n-->\n');
    expect(codes(parsed)).toEqual(['bad-ledger']);
    expect(parsed.ledger).toEqual({ version: 1, people: [], marks: {}, comments: [] });
  });

  it('counts UTF-16 offsets', () => {
    const parsed = parse('😀 <!--ins k3x9-->x<!--/k3x9-->\n');
    expect(parsed.marks[0]?.segments[0]?.content).toEqual({ from: 18, to: 19 });
    expect(parsed.marks[0]?.segments[0]?.open).toEqual({ from: 3, to: 18 });
  });

  it('keeps CRLF', () => {
    const crlf = fixture.replaceAll('\n', '\r\n');
    const parsed = parse(crlf);
    const lf = parse(fixture);
    expect(parsed.text).toBe(crlf);
    expect(parsed.marks.map((m) => [m.id, m.kind, m.payload, m.entry])).toEqual(
      lf.marks.map((m) => [m.id, m.kind, m.payload, m.entry]),
    );
    expect(parsed.ledger).toEqual(lf.ledger);
    expect(parsed.warnings).toEqual([]);
    expect(crlf.slice(parsed.ledgerRange?.from)).toMatch(/^\r\n\r\n<!-- redlines/);
  });

  it('treats a comment anchor without a thread as ordinary content', () => {
    const parsed = parse('a <!--cmt c8d2-->b<!--/c8d2--> c <!--cmt c9qf-->\n');
    expect(parsed.marks).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('reads range and point comments', () => {
    const text = withLedger(
      'a <!--cmt c8d2-->b<!--/c8d2--> c <!--cmt c9qf--> d',
      [],
      [
        'comments:',
        '  c8d2:',
        '    by: ada',
        '    at: 2026-10-13T22:40Z',
        '    text: |-',
        '      One',
        '  c9qf:',
        '    by: ada',
        '    at: 2026-10-13T22:41Z',
        '    text: |-',
        '      Two',
      ].join('\n'),
    );
    const parsed = parse(text);
    expect(parsed.warnings).toEqual([]);
    const [range, point] = parsed.marks;
    expect(range?.segments[0]?.close).toBeDefined();
    expect(point?.id).toBe('c9qf');
    expect(point?.segments[0]?.close).toBeUndefined();
    expect(point?.segments[0]?.content).toEqual({
      from: point?.segments[0]?.open.to,
      to: point?.segments[0]?.open.to,
    });
  });

  it('reads point marks without a closer', () => {
    const body = 'a<!--split s3vb-->\n\nb\n\n| <!--ins k3x9 row--> Pears | 5 |';
    const parsed = parse(
      withLedger(body, [
        's3vb: {by: ada, at: 2026-10-13T22:30Z}',
        'k3x9: {by: ada, at: 2026-10-13T22:30Z}',
      ]),
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.marks.map((m) => [m.id, m.kind, m.payload])).toEqual([
      ['s3vb', 'split', undefined],
      ['k3x9', 'ins', 'row'],
    ]);
  });

  it('decodes payload escapes', () => {
    const parsed = parse(
      withLedger('a<!--del k3x9 x\\ny-\\-z\\x60-->b', ['k3x9: {by: ada, at: 2026-10-13T22:30Z}']),
    );
    expect(parsed.marks[0]?.payload).toBe('x\ny--z`');
  });

  it('leaves other comments alone, including their contents', () => {
    const parsed = parse('a <!-- see <!--ins k3x9--> --> b <!-- x -->\n');
    expect(parsed.marks).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('reports a second opener of an open mark and a closer after a deletion', () => {
    const duplicate = parse('<!--ins k3x9-->a<!--ins k3x9-->b<!--/k3x9-->c<!--/k3x9-->\n');
    expect(duplicate.marks).toHaveLength(1);
    expect(codes(duplicate)).toEqual(expect.arrayContaining(['duplicate-id', 'unopened-close']));
    const deletion = parse('a<!--del k3x9 x-->b<!--/k3x9-->\n');
    expect(deletion.marks).toHaveLength(1);
    expect(codes(deletion)).toContain('unopened-close');
  });

  it('reports segments whose kinds disagree', () => {
    const parsed = parse('<!--ins k3x9-->a<!--/k3x9--><!--hl k3x9-->b<!--/k3x9-->\n');
    expect(parsed.marks.map((m) => [m.kind, m.segments.length])).toEqual([['ins', 1]]);
    expect(codes(parsed)).toContain('kind-mismatch');
  });

  it('reports entries and threads without marks', () => {
    const text = withLedger(
      'Plain text.',
      ['k3x9: {by: ada, at: 2026-10-13T22:30Z}'],
      [
        'comments:',
        '  c8d2:',
        '    by: ada',
        '    at: 2026-10-13T22:40Z',
        '    text: |-',
        '      Gone',
      ].join('\n'),
    );
    const parsed = parse(text);
    expect(parsed.marks).toEqual([]);
    expect(codes(parsed).sort()).toEqual(['orphan-entry', 'orphan-thread']);
    expect(parsed.ledger.marks['k3x9']).toBeDefined();
    expect(parsed.ledger.comments).toHaveLength(1);
  });

  it('reports a marker that starts a line with text after it', () => {
    const body =
      'First.\n\n- <!--ins k3x9-->one<!--/k3x9-->\n\n<!--ins w8nn-->\n\nAlone<!--/w8nn-->';
    const parsed = parse(
      withLedger(body, [
        'k3x9: {by: ada, at: 2026-10-13T22:30Z}',
        'w8nn: {by: ada, at: 2026-10-13T22:31Z}',
      ]),
    );
    expect(parsed.marks).toHaveLength(2);
    expect(codes(parsed)).toEqual(['line-start-marker']);
    expect(parsed.warnings[0]?.id).toBe('k3x9');
  });

  it('keeps unknown keys and front matter changes, with a warning for the unknown ones', () => {
    const text = withLedger(
      'Plain.',
      [],
      [
        'frontmatter:',
        '  - {key: title, by: ada, at: 2026-10-13T22:42Z, was: Launch}',
        'future: {a: b}',
      ].join('\n'),
    );
    const parsed = parse(text);
    expect(codes(parsed)).toEqual(['unknown-key']);
    expect(parsed.warnings[0]?.message).toContain('future');
    expect(parsed.ledger.extra).toEqual({
      frontmatter: [{ key: 'title', by: 'ada', at: '2026-10-13T22:42Z', was: 'Launch' }],
      future: { a: 'b' },
    });
  });

  it('keeps the fields it does not know in people, entries, threads and replies', () => {
    const text = withLedger(
      'Plain.',
      ['k3x9: {by: ada, at: 2026-10-13T22:30Z, future: {when: soon, tags: [a, b]}}'],
      [
        'comments:',
        '  c8d2:',
        '    by: ada',
        '    at: 2026-10-13T22:36Z',
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
      ].join('\n'),
    ).replace('  ada: {name: Ada Lovelace}', '  ada: {name: Ada Lovelace, pronouns: she/her}');
    const parsed = parse(text);
    const [person] = parsed.ledger.people;
    expect(person?.extra).toEqual({ pronouns: 'she/her' });
    expect(parsed.ledger.marks['k3x9']?.extra).toEqual({
      future: { when: 'soon', tags: ['a', 'b'] },
    });
    const [thread] = parsed.ledger.comments;
    // `reactions` is a known field of a thread, with no format of its own yet.
    expect(thread?.reactions).toEqual({ heart: ['bo 2026-10-13T22:42Z'] });
    expect(thread?.extra).toEqual({ priority: 'high' });
    expect(thread?.replies[0]?.extra).toEqual({ mood: 'happy' });
    // Each unknown field is reported, `reactions` is not.
    expect(parsed.warnings.filter((w) => w.code === 'unknown-key').map((w) => w.message)).toEqual([
      expect.stringContaining('pronouns'),
      expect.stringContaining('future'),
      expect.stringContaining('priority'),
      expect.stringContaining('mood'),
    ]);
  });

  it('reads every thread field', () => {
    const text = withLedger(
      'Plain.',
      [],
      [
        'comments:',
        '  c8d2:',
        '    by: ada',
        '    at: 2026-10-13T22:36Z',
        '    about: p7qd',
        '    edited: 2026-10-13T22:50Z',
        '    resolved: ada 2026-10-13T22:41Z',
        '    assigned: ada',
        '    done: true',
        '    likes:',
        '      - alex-kim-2 2026-10-13T22:39Z',
        '    replies:',
        '      - id: r5tw',
        '        by: claude-ada',
        '        at: 2026-10-13T22:37Z',
        '        text: |-',
        '          The tiers are in the appendix.',
        '    quote: |-',
        '      Quoted',
        '    text: |-',
        '      Can we settle this?',
        '      \\',
        '      See the table \\x60here\\x60 \\\\',
        '      \\\\',
        '      -\\-',
      ].join('\n'),
    );
    const [thread] = parse(text).ledger.comments;
    expect(thread).toEqual({
      id: 'c8d2',
      by: 'ada',
      at: '2026-10-13T22:36Z',
      about: 'p7qd',
      edited: '2026-10-13T22:50Z',
      resolved: { by: 'ada', at: '2026-10-13T22:41Z' },
      assigned: 'ada',
      done: true,
      likes: [{ by: 'alex-kim-2', at: '2026-10-13T22:39Z' }],
      replies: [
        {
          id: 'r5tw',
          by: 'claude-ada',
          at: '2026-10-13T22:37Z',
          text: 'The tiers are in the appendix.',
        },
      ],
      quote: 'Quoted',
      text: 'Can we settle this?\n\nSee the table `here` \\\n\\\n--',
    });
  });
});

describe('the carrier of an opener that starts a block (format §3.3)', () => {
  const entries = (...ids: string[]) => ids.map((id) => `${id}: {by: ada, at: 2026-10-13T22:30Z}`);
  const opener = (parsed: Parsed, id: string) => {
    const segment = parsed.marks.find((mark) => mark.id === id)?.segments[0];
    if (!segment) throw new Error(`No mark ${id}`);
    return { segment, open: parsed.text.slice(segment.open.from, segment.open.to) };
  };

  it('belongs to the opener, so the content starts at the block’s first character', () => {
    const parsed = parse(
      withLedger('Para.\n\n<!--ins k3x9-->\n\nNew start.<!--/k3x9-->\n\nEnd.', entries('k3x9')),
    );
    const { segment, open } = opener(parsed, 'k3x9');
    expect(open).toBe('<!--ins k3x9-->\n\n');
    expect(parsed.text.slice(segment.content.from, segment.content.to)).toBe('New start.');
    expect(codes(parsed)).toEqual([]);
  });

  it('is the line break and the indentation in a tight list, and the prefix in a quote', () => {
    const list = parse(withLedger('- one\n- <!--ins k3x9-->\n  two<!--/k3x9-->', entries('k3x9')));
    expect(opener(list, 'k3x9').open).toBe('<!--ins k3x9-->\n  ');
    expect(codes(list)).toEqual([]);
    const quote = parse(withLedger('> <!--del t6wv Note: -->\n> The importer.', entries('t6wv')));
    expect(opener(quote, 't6wv').open).toBe('<!--del t6wv Note: -->\n> ');
    expect(codes(quote)).toEqual([]);
  });

  it('serves a deletion, a comment and a chain of markers', () => {
    const parsed = parse(
      withLedger(
        '<!--del t6wv Note: -->\n\n<!--cmt c9qf-->\n\nThe importer.<!--/c9qf-->',
        entries('t6wv'),
        'comments:\n  c9qf:\n    by: ada\n    at: 2026-10-13T22:40Z\n    text: |-\n      Hm.',
      ),
    );
    expect(opener(parsed, 't6wv').open).toBe('<!--del t6wv Note: -->\n\n');
    expect(opener(parsed, 'c9qf').open).toBe('<!--cmt c9qf-->\n\n');
    expect(codes(parsed)).toEqual([]);
  });

  it('is not there for a marker with text on its line, a split, or a table mark', () => {
    const body = [
      'a <!--ins k3x9-->b<!--/k3x9-->',
      '',
      'c<!--split c9qf-->',
      '',
      'd',
      '',
      '| a |',
      '| - |',
      '| <!--ins t6wv row--> b |',
      '',
      '<!--del w8nn row=2 \\| x \\|-->',
      '',
      'Next.',
    ].join('\n');
    const parsed = parse(withLedger(body, entries('k3x9', 'c9qf', 't6wv', 'w8nn')));
    expect(opener(parsed, 'k3x9').open).toBe('<!--ins k3x9-->');
    expect(opener(parsed, 'c9qf').open).toBe('<!--split c9qf-->');
    expect(opener(parsed, 't6wv').open).toBe('<!--ins t6wv row-->');
    expect(opener(parsed, 'w8nn').open).toBe('<!--del w8nn row=2 \\| x \\|-->');
    expect(codes(parsed)).toEqual([]);
  });

  it('is not there when nothing follows, not even before the ledger', () => {
    const point =
      'comments:\n  k3x9:\n    by: ada\n    at: 2026-10-13T22:40Z\n    text: |-\n      Hm.';
    const parsed = parse(withLedger('Para.\n\n<!--cmt k3x9-->', [], point));
    expect(opener(parsed, 'k3x9').open).toBe('<!--cmt k3x9-->');
  });

  it('does not take a marker that starts a line with text for one that stands alone', () => {
    const parsed = parse(withLedger('<!--ins k3x9-->start<!--/k3x9-->', entries('k3x9')));
    expect(codes(parsed)).toEqual(['line-start-marker']);
  });
});

describe('parse after an earlier parse', () => {
  it('reuses the ledger when its text is unchanged', () => {
    const before = parse(fixture);
    const edited = fixture.replace('We will', 'Now we will');
    const after = parse(edited, before);
    expect(after.ledger).toBe(before.ledger);
    expect(after).toEqual(parse(edited));
  });

  it('moves the ledger warnings with the ledger, and reads a changed ledger again', () => {
    const file = withLedger('Text.', ['k3x9: {by: ada, at: 2026-10-13T22:30Z, shade: red}']);
    const before = parse(file);
    expect(codes(before)).toContain('unknown-key');
    const moved = `A longer first line. ${file}`;
    expect(parse(moved, before)).toEqual(parse(moved));
    const changed = file.replace('shade: red', 'shade: blue');
    const reread = parse(changed, before);
    expect(reread.ledger).not.toBe(before.ledger);
    expect(reread).toEqual(parse(changed));
  });
});
