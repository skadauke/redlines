// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { checkInvariants, emptyParagraphs, runScript, scriptRows, shorten } from './script.ts';

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
    expect(() => checkInvariants(result)).toThrow(/the caret is in a hidden range/);
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
      doc: 'One two.‸⏎⏎Next.',
      keys: ['Enter'],
      tc: true,
      expect: {},
    });
    expect(result.takenBack).toBeDefined();
    expect(result.undoFailures).toEqual([]);
    checkInvariants(result);
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
// hold the invariants. Each skip is today's behavior, and goes when the task named takes it over.
describe("today's keys hold the invariants", () => {
  /** Backspace right after Return in a list or quote takes the bullet or `>` it continued first. */
  const TAKE_BACK =
    'Backspace right after Return takes the continued markup first, until the record of Returns ' +
    '(Task 1.12) and Return in lists and quotes (Tasks 1.13, 1.14)';
  /** Backspace at a block's start, with the blank lines above it hidden, steps over them. */
  const AT_BLOCK_START =
    "Backspace at a block's start steps over the hidden blank lines above it and deletes the " +
    'character before them, until the record of Returns (Task 1.12) and Backspace at block edges ' +
    '(Task 1.16)';
  const docs = [
    'One two.‸⏎⏎Next.',
    'One ‸two.⏎⏎Next.',
    'One.⏎⏎‸Two.',
    '- one⏎- two‸⏎⏎After.',
    '- one ‸two⏎⏎After.',
    '> One two.‸',
    '## Head‸⏎⏎Body.',
  ];
  scriptRows(
    docs.flatMap((doc) =>
      [false, true].flatMap((tc) =>
        (['Enter', 'Backspace', 'Delete', 'Shift-Enter'] as const).map((key) => ({
          name: `${key} in ${doc}, Track Changes ${tc ? 'on' : 'off'}`,
          doc,
          keys: [key],
          tc,
          expect: {},
          ...(key === 'Enter' && /^[->]/.test(doc) ? { skip: { 'take-back': TAKE_BACK } } : {}),
          ...(key === 'Enter' && doc === 'One.⏎⏎‸Two.'
            ? { skip: { 'take-back': AT_BLOCK_START } }
            : {}),
        })),
      ),
    ),
  );
});
