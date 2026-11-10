// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  decisionProblems,
  emptyParagraphs,
  renderProblems,
  runScript,
  sampledDecisions,
  type Script,
  scriptRows,
  shorten,
  strayBlankLines,
} from './script.ts';

const LEDGER = '⏎⏎<!-- redlines⏎version: 1⏎marks:⏎  b2b2: {by: ada, at: 2026-11-01T10:00Z}⏎-->⏎';

describe('keystroke scripts', () => {
  it('passes a script with no keys', () => {
    checkInvariants(
      runScript({ name: 'noop', doc: 'One.‸', keys: [], tc: false, expect: { file: 'One.' } }),
    );
  });

  it('fails a script whose file is not the one expected, showing both in the notation', () => {
    const result = runScript({
      name: 'wrong',
      doc: 'One two.‸⏎⏎Next.',
      keys: ['Enter'],
      tc: false,
      expect: { file: 'One two.⏎⏎Wrong.' },
    });
    expect(() => checkInvariants(result)).toThrow(/wrong: the file.*'One two\.⏎⏎Wrong\.'/s);
  });

  it('reports a caret inside a hidden range', () => {
    const result = runScript({
      name: 'hidden',
      doc: `One <!--ins b2‸b2-->two<!--/b2b2--> three.${LEDGER}`,
      keys: [],
      tc: true,
      expect: {},
    });
    expect(result.hiddenCaret).toMatch(/in \d+-\d+ "<!--ins b2b2-->"/);
    expect(() => checkInvariants(result)).toThrow(/hidden: hidden-caret/);
  });

  it('writes out shortened markers with the given ids, and shortens them again', () => {
    const result = runScript({
      name: 'markers',
      doc: 'One <ins>two</ins> <del gone>three<split>⏎four <sub old>new</sub>.‸',
      ids: ['b2b2', 'c3c3', 'd4d4', 'f5f5'],
      others: 'bo',
      keys: [],
      tc: true,
      expect: {
        file: 'One <ins>two</ins> <del gone>three<split>⏎four <sub old>new</sub>.',
        newest: 'One two three⏎four new.',
        original: 'One  gonethreefour old.',
      },
    });
    expect(result.file).toContain('<!--ins b2b2-->two<!--/b2b2-->');
    expect(result.file).toContain('<!--del c3c3 gone-->');
    expect(result.file).toContain('<!--split d4d4-->');
    expect(result.file).toContain('b2b2: {by: bo,');
    checkInvariants(result);
  });

  it('reads a selection, and a typed step', () => {
    const result = runScript({
      name: 'selection',
      doc: 'One [two] three.',
      keys: [{ type: 'six' }],
      tc: false,
      expect: { file: 'One six three.', caret: 'One six‸ three.' },
    });
    checkInvariants(result);
  });

  it('takes a refusal only where the script expects it, in its words', () => {
    const IN_CODE =
      "A tracked change can't go inside code or an HTML comment, where its markers would not be " +
      'read. Change the whole code span or comment instead.';
    const script = { name: 'code', doc: '```⏎co‸de⏎```', keys: [{ type: 'x' }], tc: true };
    checkInvariants(runScript({ ...script, expect: { file: '```⏎code⏎```', refusal: IN_CODE } }));
    expect(() => checkInvariants(runScript({ ...script, expect: {} }))).toThrow(/code: refusals/);
    expect(() =>
      checkInvariants(runScript({ ...script, expect: { refusal: 'Other words.' } })),
    ).toThrow(/code: refusals/);
  });

  it('skips only the invariants a script names', () => {
    const doc = `One <!--ins b2‸b2-->two<!--/b2b2--> three.${LEDGER}`;
    const skipped = runScript({
      name: 'skipped',
      doc,
      keys: [],
      tc: true,
      expect: {},
      skip: { 'hidden-caret': 'a test of skipping' },
    });
    checkInvariants(skipped);
  });

  it('plays Return then Backspace for a script of a single Return, and checks Undo', () => {
    const result = runScript({
      name: 'return',
      doc: 'One two.‸',
      keys: ['Enter'],
      tc: true,
      expect: {},
    });
    expect(result.takenBack).toBeDefined();
    expect(result.undoFailures).toEqual([]);
    checkInvariants(result);
  });
});

describe('the checks the review asked for', () => {
  it('reads the file with micromark, and finds a marker it shows as text (review I4)', () => {
    // A marker right after a backslash is escaped by it: micromark shows the closer.
    const escaped = `One <!--ins b2b2-->C:\\<!--/b2b2--> two.${LEDGER}`.replaceAll('⏎', '\n');
    expect(renderProblems(escaped)).toHaveLength(1);
    const sound = `One <!--ins b2b2-->C:<!--/b2b2--> two.${LEDGER}`.replaceAll('⏎', '\n');
    expect(renderProblems(sound)).toEqual([]);
    const result = runScript({
      name: 'escaped',
      doc: `One <!--ins b2b2-->C:\\<!--/b2b2--> two.‸${LEDGER}`,
      keys: [],
      tc: true,
      expect: {},
    });
    expect(() => checkInvariants(result)).toThrow(/escaped: render/);
  });

  it('checks the decisions of a file with more marks than every order is walked for (review I5)', () => {
    const doc = '‸' + Array.from({ length: 8 }, (_, i) => `W${i} <ins>x${i}</ins>`).join(' ');
    const ids = Array.from({ length: 8 }, (_, i) => `b${'cdfghjkm'[i]}2${'cdfghjkm'[i]}`);
    checkInvariants(runScript({ name: 'many', doc, ids, keys: [], tc: true, expect: {} }));
  });

  it('finds a file whose decisions read otherwise, past six marks', () => {
    // Bo's pending hard break with a substitution after his marker: rejecting both leaves the
    // backslash, where the original view has none (the form Task 1.3 refuses to write).
    const words = Array.from(
      { length: 6 },
      (_, i) =>
        ` w${i}<!--ins b${'cdfghj'[i]}2${'cdfghj'[i]}-->x<!--/b${'cdfghj'[i]}2${'cdfghj'[i]}-->`,
    );
    const marks = [
      '  k3x9: {by: bo, at: 2026-11-01T10:00Z}',
      '  m2bd: {by: ada, at: 2026-11-01T10:00Z}',
    ];
    for (const c of 'cdfghj') marks.push(`  b${c}2${c}: {by: ada, at: 2026-11-01T10:00Z}`);
    const file =
      `One <!--split k3x9--><!--sub m2bd \\\\\\ntwo.-->\n\ntwo.<!--/m2bd-->${words.join('')}\n\n` +
      `<!-- redlines\nversion: 1\nmarks:\n${marks.join('\n')}\n-->\n`;
    expect(decisionProblems(file).length).toBeGreaterThan(0);
  });

  it('reads raw HTML of the file the same on both sides (review N4)', () => {
    checkInvariants(
      runScript({
        name: 'html',
        doc: 'See‸⏎⏎<b>x</b>',
        keys: [{ type: ' ' }],
        tc: true,
        expect: { file: 'See<ins> </ins>⏎⏎<b>x</b>' },
      }),
    );
  });

  it('reports a file past six marks where no decision can be made (review N5)', () => {
    const marks = Array.from({ length: 8 }, (_, i) => `b${'cdfghjkm'[i]}2${'cdfghjkm'[i]}`);
    const words = marks.map((id, i) => `w${i}<!--ins ${id}-->x<!--/${id}-->`).join(' ');
    const ledger = marks.map((id) => `  ${id}: {by: ada, at: 2026-11-01T10:00Z}`).join('\n');
    const file = `${words}\n\n<!-- redlines\nversion: 1\nmarks:\n${ledger}\n-->\n`;
    expect(sampledDecisions(file, marks)).toEqual([]);
    // A mark that no decision works on, in any order, is stuck.
    const stuck = marks[3] ?? '';
    const refusing = (text: string, id: string, how: 'a' | 'r') =>
      id === stuck ? undefined : sampledDecisions.decide(text, id, how);
    expect(sampledDecisions(file, marks, refusing).join(' ')).toMatch(/no decision can be made/);
  });

  it('fails a skip that is no longer needed', () => {
    const result = runScript({
      name: 'stale',
      doc: 'One.‸',
      keys: [],
      tc: false,
      expect: {},
      skip: { 'hidden-caret': 'nothing hides the caret here' },
    });
    expect(() => checkInvariants(result)).toThrow(/the skip of hidden-caret is no longer needed/);
  });

  it('closes an inline mark after a block format change in the notation', () => {
    const result = runScript({
      name: 'fmt',
      doc: '<fmt was=p>## One <ins>two</ins>.‸',
      ids: ['b2b2', 'c3c3'],
      keys: [],
      tc: true,
      expect: { file: '<fmt was=p>## One <ins>two</ins>.' },
    });
    expect(result.file).toContain('<!--ins c3c3-->two<!--/c3c3-->');
  });
});

describe('stray blank lines', () => {
  it('finds two blank lines in a row between blocks, outside code', () => {
    expect(strayBlankLines('One.\n\nTwo.\n')).toEqual([]);
    expect(strayBlankLines('One.\n\n\nTwo.\n')).toHaveLength(1);
    expect(strayBlankLines('```\na\n\n\nb\n```\n')).toEqual([]);
  });
});

describe('empty paragraphs', () => {
  it('finds an empty line between blank lines, and at the edges beside one', () => {
    expect(emptyParagraphs('One.\n\nTwo.\n')).toEqual([]);
    expect(emptyParagraphs('One.\n\n\nTwo.\n')).toEqual([]);
    expect(emptyParagraphs('One.\n\n\n\nTwo.\n')).toHaveLength(1);
    expect(emptyParagraphs('\n\nOne.')).toHaveLength(1);
    expect(emptyParagraphs('One.\n\n\n')).toHaveLength(1);
    expect(emptyParagraphs('> One.\n>\n>\n>\n> Two.')).toHaveLength(1);
    expect(emptyParagraphs('')).toEqual([]);
  });

  it('leaves the blank lines of fenced code alone', () => {
    expect(emptyParagraphs('```\na\n\n\n\nb\n```\n')).toEqual([]);
  });

  it('finds a line of a no-break space', () => {
    expect(emptyParagraphs('One.\\\n \n\nNext.')).toHaveLength(1);
    expect(emptyParagraphs('- One.\\\n   ')).toHaveLength(1);
  });
});

describe('shorten', () => {
  it('writes each marker in the notation, without its id', () => {
    expect(
      shorten(
        'a<!--split q4gt-->b<!--ins r5tw-->c<!--/r5tw--><!--del s6vx d\\ne--><!--fmt t7wz was=p-->',
      ),
    ).toBe('a<split>b<ins>c</ins><del d\ne><fmt was=p>');
  });
});

describe('scripts as rows', () => {
  scriptRows([
    {
      name: 'typing at the end',
      doc: 'One.‸',
      keys: [{ type: ' Two.' }],
      tc: false,
      expect: { file: 'One. Two.' },
    },
    {
      name: 'typing at the end with Track Changes on',
      doc: 'One.‸',
      keys: [{ type: ' Two.' }],
      tc: true,
      expect: { file: 'One.<ins> Two.</ins>', newest: 'One. Two.', original: 'One.' },
    },
  ]);
});

// Today's keys, before block editing changes them: what they do is not judged here, only that they
// hold the invariants. Each skip is today's behavior, named per row, and goes when the task named
// takes it over; a skip that is no longer needed fails its row.
describe("today's keys hold the invariants", () => {
  /** Shift-Return types one line break where a blank line already parts the blocks. */
  const STRAY =
    'Shift-Return types one line break next to a blank line, until Shift-Return writes a hard ' +
    'break (Task 1.18)';
  type Key = 'Enter' | 'Backspace' | 'Delete' | 'Shift-Enter';
  const rows: [string, Partial<Record<Key, Script['skip']>>][] = [
    ['One two.‸⏎⏎Next.', { 'Shift-Enter': { 'stray-blank-line': STRAY } }],
    ['One ‸two.⏎⏎Next.', {}],
    ['One.⏎⏎‸Two.', { 'Shift-Enter': { 'stray-blank-line': STRAY } }],
    ['- one⏎- two‸⏎⏎After.', { 'Shift-Enter': { 'stray-blank-line': STRAY } }],
    ['- one ‸two⏎⏎After.', {}],
    ['> One two.‸', {}],
    ['## Head‸⏎⏎Body.', { 'Shift-Enter': { 'stray-blank-line': STRAY } }],
  ];
  scriptRows(
    rows.flatMap(([doc, skips]) =>
      [false, true].flatMap((tc) =>
        (['Enter', 'Backspace', 'Delete', 'Shift-Enter'] as const).map((key) => ({
          name: `${key} in ${doc}, Track Changes ${tc ? 'on' : 'off'}`,
          doc,
          keys: [key],
          tc,
          expect: {},
          ...(skips[key] ? { skip: skips[key] } : {}),
        })),
      ),
    ),
  );
});
