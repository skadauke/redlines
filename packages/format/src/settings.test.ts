// The ledger's two settings that Redlines writes for a person: Track Changes and the view the
// document opens in (format §5.6).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { serializeLedger, setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import { recordTracking, setView } from './settings.ts';
import { LEDGER_NOTE, REFUSALS, ada, context, fixture } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { Ledger } from './types.ts';
import { newestView, originalView } from './views.ts';

const empty: Ledger = { version: 1, people: [], marks: {}, comments: [] };

/** A body with a ledger, laid out as the format writes it, that holds the lines after `version: 1`. */
const withLines = (...lines: string[]) =>
  `Body.\n\n<!-- redlines\n${LEDGER_NOTE}\nversion: 1\n${lines.map((line) => `${line}\n`).join('')}-->\n`;

describe('reading the view (format §5.6)', () => {
  it('reads clean, redlines and simple', () => {
    for (const view of ['clean', 'redlines', 'simple'] as const) {
      const parsed = parse(withLines(`view: ${view}`));
      expect(parsed.ledger.view).toBe(view);
      expect(parsed.warnings).toEqual([]);
    }
  });

  it('has no view when the ledger has none', () => {
    expect(parse(fixture).ledger.view).toBeUndefined();
    expect(parse(withLines('tracking: everyone')).ledger.view).toBeUndefined();
  });

  it('warns about a view it does not know, such as raw, and drops it', () => {
    // Raw is never saved: nobody wants a document to open as source (format §5.6).
    for (const value of ['raw', 'Simple', 'Clean', 'on', '']) {
      const parsed = parse(withLines(`view: ${value}`));
      expect(parsed.ledger.view, value).toBeUndefined();
      expect(
        parsed.warnings.map(({ code, message }) => [code, message]),
        value,
      ).toEqual([['bad-ledger', `Unknown view setting ${value}`]]);
    }
  });

  it('is no unknown key', () => {
    expect(parse(withLines('view: clean')).warnings.map((w) => w.code)).not.toContain(
      'unknown-key',
    );
  });
});

describe('a setting that a merge repeated (format §5.5, §7.3)', () => {
  it('is read from its last line, whole, with no warning: either side of a merge is right', () => {
    const viewed = parse(withLines('view: clean', 'view: redlines'));
    expect(viewed.ledger.view).toBe('redlines');
    expect(viewed.warnings).toEqual([]);
    const both = parse(withLines('tracking: everyone', 'view: clean', 'tracking: everyone'));
    expect(both.ledger).toEqual({ ...empty, tracking: 'everyone', view: 'clean' });
    expect(both.warnings).toEqual([]);
    expect(parse(withLines('history: full', 'history: full')).ledger.history).toBe('full');
  });

  it('is written once, with the next write that rewrites the ledger', () => {
    const text = withLines('view: clean', 'view: redlines', 'tracking: everyone');
    expect(applyChanges(text, setLedger(text, parse(text).ledger))).toBe(
      withLines('tracking: everyone', 'view: redlines'),
    );
  });

  it('leaves every other key to be unique, as before', () => {
    const doubled = withLines('people:', '  ada: {name: Ada}', 'people:', '  bo: {name: Bo}');
    expect(parse(doubled).warnings.map((w) => w.code)).toEqual(['bad-ledger']);
    // A key of a person's or a mark's own named view is no setting.
    const nested = withLines('people:', '  ada: {name: Ada, view: clean}');
    expect(parse(nested).ledger.view).toBeUndefined();
  });
});

describe('recording the view changes that line alone (format §5.6)', () => {
  /** A ledger the format would write differently: odd order, a YAML comment, an entry it ignores,
   * a key of a later version and a version it doesn't know. A save must not touch any of it. */
  const odd = [
    'Body <!--ins k3x9-->new <!--/k3x9-->.',
    '',
    '<!-- redlines',
    '# A note of a person, which the format never writes.',
    'version: 2',
    'people:',
    '  bo: {name: Bo Chen}',
    '  ada: {name: Ada Lovelace}',
    'marks:',
    '  "not an id": {by: ada, at: 2026-10-13T22:30Z}',
    '  k3x9: {by: ada, at: 2026-10-13T22:30Z}',
    'future: {a: 1}',
    '-->',
    '',
  ].join('\n');

  it('inserts one line after version, and changes no other byte of the ledger', () => {
    const recorded = applyChanges(odd, setView(odd, 'clean'));
    expect(recorded).toBe(odd.replace('version: 2\n', 'version: 2\nview: clean\n'));
    expect(parse(recorded).ledger.view).toBe('clean');
    // Once it is there, the next save changes only its value.
    expect(applyChanges(recorded, setView(recorded, 'redlines'))).toBe(
      odd.replace('version: 2\n', 'version: 2\nview: redlines\n'),
    );
  });

  it('records the simple look as simple, and the next save changes only its value', () => {
    const simple = applyChanges(odd, setView(odd, 'simple'));
    expect(simple).toBe(odd.replace('version: 2\n', 'version: 2\nview: simple\n'));
    expect(parse(simple).ledger.view).toBe('simple');
    expect(applyChanges(simple, setView(simple, 'redlines'))).toBe(
      odd.replace('version: 2\n', 'version: 2\nview: redlines\n'),
    );
    expect(applyChanges(simple, setView(simple, 'simple'))).toBe(simple);
  });

  it('puts it after tracking when the ledger has it', () => {
    const tracked = odd.replace('version: 2\n', 'version: 2\ntracking: everyone\n');
    expect(applyChanges(tracked, setView(tracked, 'clean'))).toBe(
      tracked.replace('tracking: everyone\n', 'tracking: everyone\nview: clean\n'),
    );
  });

  it('gives each line a merge left the value, and the ledger’s own line breaks', () => {
    const merged = odd.replace('version: 2\n', 'version: 2\nview: clean\nview: redlines\n');
    expect(applyChanges(merged, setView(merged, 'clean'))).toBe(
      odd.replace('version: 2\n', 'version: 2\nview: clean\nview: clean\n'),
    );
    const crlf = odd.replaceAll('\n', '\r\n');
    expect(applyChanges(crlf, setView(crlf, 'clean'))).toBe(
      crlf.replace('version: 2\r\n', 'version: 2\r\nview: clean\r\n'),
    );
  });

  it('leaves a ledger it has no place in alone', () => {
    const none = odd.replace('version: 2\n', '');
    expect(parse(none).ledger.marks['k3x9']).toBeDefined();
    expect(setView(none, 'clean')).toEqual([]);
  });

  it('does not touch a comment that holds a line that looks like it', () => {
    const talk = withLines(
      'comments:',
      '  c8d2:',
      '    by: ada',
      '    at: 2026-10-13T22:40Z',
      '    text: |-',
      '      view: clean is what I like',
    );
    const recorded = applyChanges(talk, setView(talk, 'redlines'));
    expect(recorded).toBe(talk.replace('version: 1\n', 'version: 1\nview: redlines\n'));
    expect(parse(recorded).ledger.comments[0]?.text).toBe('view: clean is what I like');
  });
});

describe('writing the view (format §5.7)', () => {
  it('puts it after tracking and before history', () => {
    const ledger: Ledger = { ...empty, tracking: 'everyone', view: 'redlines', history: 'full' };
    expect(serializeLedger(ledger)).toBe(
      [
        '<!-- redlines',
        LEDGER_NOTE,
        'version: 1',
        'tracking: everyone',
        'view: redlines',
        'history: full',
        '-->',
      ].join('\n'),
    );
  });

  it('reads back what it writes, and writes it again the same', () => {
    for (const view of ['clean', 'redlines', 'simple'] as const) {
      const ledger: Ledger = { ...empty, tracking: 'everyone', view };
      const written = serializeLedger(ledger);
      expect(parse(`Body.\n\n${written}\n`).ledger).toEqual(ledger);
      expect(serializeLedger(parse(`Body.\n\n${written}\n`).ledger)).toBe(written);
    }
  });

  it('keeps a ledger that holds a view and nothing else out of a plain file', () => {
    // A view alone is no reason for a ledger (format §5.6).
    for (const view of ['clean', 'redlines', 'simple'] as const) {
      expect(setLedger('# Notes\n', { ...empty, view }), view).toEqual([]);
    }
  });

  it('takes a ledger that holds a view and nothing else away, as it takes an empty one away', () => {
    for (const view of ['clean', 'redlines', 'simple']) {
      const text = withLines(`view: ${view}`);
      expect(applyChanges(text, setLedger(text, parse(text).ledger)), view).toBe('Body.\n');
    }
  });
});

describe('recordTracking (format §5.6)', () => {
  /** Files with no ledger, in each way a file can end. */
  const plain = [
    '',
    '\n',
    '# Notes',
    '# Notes\n',
    '# Notes\n\nA paragraph.\n\n\n',
    '# Notes\r\n\r\nText.\r\n',
    '# Notes\rText.\r',
    'Text <!-- never closed\n',
    'Text\n\n```js\nlet x;\n',
  ];

  it('never makes a ledger: a plain file gets none, on or off', () => {
    for (const text of plain) {
      expect(recordTracking(text, true), JSON.stringify(text)).toEqual([]);
      expect(recordTracking(text, false), JSON.stringify(text)).toEqual([]);
    }
  });

  it('adds one line to a ledger that holds changes, and takes it away', () => {
    const on = applyChanges(fixture, recordTracking(fixture, true));
    expect(on).toBe(fixture.replace('version: 1\n', 'version: 1\ntracking: everyone\n'));
    expect(parse(on).ledger).toEqual({ ...parse(fixture).ledger, tracking: 'everyone' });
    expect(applyChanges(on, recordTracking(on, false))).toBe(fixture);
  });

  it('adds one line to a ledger in each way its lines can end', () => {
    for (const eol of ['\n', '\r\n']) {
      const text = fixture.replaceAll('\n', eol);
      const on = applyChanges(text, recordTracking(text, true));
      expect(on, JSON.stringify(eol)).toBe(
        text.replace(`version: 1${eol}`, `version: 1${eol}tracking: everyone${eol}`),
      );
      expect(applyChanges(on, recordTracking(on, false)), JSON.stringify(eol)).toBe(text);
    }
  });

  it('changes nothing when the file already says so', () => {
    const on = applyChanges(fixture, recordTracking(fixture, true));
    expect(recordTracking(on, true)).toEqual([]);
    expect(recordTracking(fixture, false)).toEqual([]);
  });

  it('touches no other byte of the ledger, whatever tool wrote it', () => {
    const odd = fixture.replace('version: 1\n', 'version: 1\nview: simple\nx-extra: 1\n');
    const on = applyChanges(odd, recordTracking(odd, true));
    expect(on).toBe(odd.replace('version: 1\n', 'version: 1\ntracking: everyone\n'));
    expect(applyChanges(on, recordTracking(on, false))).toBe(odd);
  });

  it('keeps the other settings, and the ledger while one is left', () => {
    const text = withLines('tracking: everyone', 'history: full');
    const off = applyChanges(text, recordTracking(text, false));
    expect(parse(off).ledger).toEqual({ ...empty, history: 'full' });
    expect(off).toBe(withLines('history: full'));
  });

  it('takes the ledger away when nothing but the view is left in it', () => {
    const text = withLines('tracking: everyone', 'view: clean');
    expect(applyChanges(text, recordTracking(text, false))).toBe('Body.\n');
  });

  it('gives a ledger that holds nothing else no line for it', () => {
    const text = withLines('view: clean');
    expect(recordTracking(text, true)).toEqual([]);
  });

  it('writes each line that a merge repeated, and takes each away', () => {
    const twice = withLines('tracking: everyone', 'tracking: everyone', 'history: full');
    expect(recordTracking(twice, true)).toEqual([]);
    expect(applyChanges(twice, recordTracking(twice, false))).toBe(withLines('history: full'));
  });

  it('leaves a value that reads as it should as it is, and writes the line where there is none to change', () => {
    const quoted = withLines('tracking: "everyone"');
    expect(recordTracking(quoted, true)).toEqual([]);
    expect(applyChanges(quoted, recordTracking(quoted, false))).toBe('Body.\n');
    // A ledger of another tool's, with no version line, takes the line after the one that opens it.
    const bare =
      'Body.\n\n<!-- redlines\nmarks:\n  k3x9: {by: ada, at: 2026-10-13T22:30Z}\npeople:\n  ada: {name: Ada}\n-->\n';
    const on = applyChanges(bare, recordTracking(bare, true));
    expect(on).toBe(bare.replace('<!-- redlines\n', '<!-- redlines\ntracking: everyone\n'));
    expect(applyChanges(on, recordTracking(on, false))).toBe(bare);
    // A ledger whose lines end in a CR alone can't be read (§5.1), and is left as it is.
    const cr = fixture.replaceAll('\n', '\r');
    expect(recordTracking(cr, true)).toEqual([]);
    expect(recordTracking(cr, false)).toEqual([]);
  });

  it('does not read a line separator inside a value as a line of the ledger', () => {
    const text = withLines('history: full').replace(
      'history: full',
      'history: full\nnote: "a\u2028tracking: x"',
    );
    const on = applyChanges(text, recordTracking(text, true));
    expect(on).toContain('note: "a\u2028tracking: x"');
    expect(on).toContain('\ntracking: everyone\n');
  });

  it('leaves a ledger it cannot read as it is, and says nothing', () => {
    const unreadable = 'Body.\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    expect(recordTracking(unreadable, true)).toEqual([]);
    expect(recordTracking(unreadable, false)).toEqual([]);
  });

  it('writes a tracked change into a plain file that was turned on first, and then the line', () => {
    for (const text of plain.slice(0, 7)) {
      const label = JSON.stringify(text);
      const at = text.replace(/\s+$/, '').length;
      // Turning it on wrote nothing, so the first tracked change makes the ledger.
      const typed = applyChanges(
        text,
        trackedEdit(text, { from: at, to: at, insert: 'Hello' }, context(ada, ['k3x9'])),
      );
      expect(parse(typed).warnings, label).toEqual([]);
      expect(parse(typed).ledger.tracking, label).toBeUndefined();
      const saved = applyChanges(typed, recordTracking(typed, true));
      expect(parse(saved).ledger.tracking, label).toBe('everyone');
      expect(parse(saved).warnings, label).toEqual([]);
      expect(newestView(saved).text, label).toBe(`${text.slice(0, at)}Hello${text.slice(at)}`);
      expect(originalView(saved).text, label).toBe(text);
    }
  });
});

describe('setView (format §5.6)', () => {
  it('never adds a ledger to a plain file', () => {
    for (const text of ['', '# Notes\n', 'Text <!-- never closed\n', 'Text\n\n```js\nlet x;\n']) {
      expect(setView(text, 'clean'), JSON.stringify(text)).toEqual([]);
      expect(setView(text, 'redlines'), JSON.stringify(text)).toEqual([]);
    }
  });

  it('never keeps a ledger alive for the view: one that holds nothing else is left as it is', () => {
    for (const text of [withLines(), withLines('view: clean'), withLines('history: current')]) {
      expect(setView(text, 'redlines'), JSON.stringify(text)).toEqual([]);
    }
  });

  it('records the view in a ledger that holds something', () => {
    const clean = applyChanges(fixture, setView(fixture, 'clean'));
    expect(clean).toBe(fixture.replace('version: 1\n', 'version: 1\nview: clean\n'));
    expect(parse(clean).ledger.view).toBe('clean');
    expect(parse(clean).warnings).toEqual([]);
    const tracked = withLines('tracking: everyone');
    expect(applyChanges(tracked, setView(tracked, 'redlines'))).toBe(
      withLines('tracking: everyone', 'view: redlines'),
    );
  });

  it('changes one line when the view changes, and nothing when it does not', () => {
    const clean = applyChanges(fixture, setView(fixture, 'clean'));
    expect(setView(clean, 'clean')).toEqual([]);
    const redlines = applyChanges(clean, setView(clean, 'redlines'));
    expect(redlines).toBe(clean.replace('view: clean', 'view: redlines'));
    expect(applyChanges(redlines, setView(redlines, 'clean'))).toBe(clean);
  });

  it('leaves a ledger it cannot read alone, and says nothing', () => {
    const unreadable = 'Body.\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    expect(setView(unreadable, 'clean')).toEqual([]);
    const conflict = fixture.replace(
      'version: 1\n',
      'version: 1\n<<<<<<< HEAD\nview: clean\n=======\nview: redlines\n>>>>>>> branch\n',
    );
    expect(setView(conflict, 'clean')).toEqual([]);
  });

  it('is taken away with the last setting, and the file is as it was', () => {
    const plain = '# Notes\n\nText.\n';
    let text = applyChanges(plain, setLedger(plain, { ...empty, tracking: 'everyone' }));
    text = applyChanges(text, setView(text, 'redlines'));
    expect(parse(text).ledger).toEqual({ ...empty, tracking: 'everyone', view: 'redlines' });
    expect(applyChanges(text, recordTracking(text, false))).toBe(plain);
  });
});

describe('on random documents (format §5.6)', { timeout: 120_000 }, () => {
  /** Accepts or rejects everything, or null where a decision is refused (not what is checked). */
  function decided(text: string, how: 'accept' | 'reject'): string | null {
    try {
      return applyChanges(text, how === 'accept' ? acceptAll(text) : rejectAll(text));
    } catch (error) {
      if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) return null;
      throw error;
    }
  }

  it('change only the ledger, give the file back, and leave every decision as it was', () => {
    const documents = fuzzCount(150);
    let withLedger = 0;
    let compared = 0;
    let viewed = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const text = randomDocument(seeded(seed));
      const label = `seed ${seed}: ${JSON.stringify(text)}`;
      if (parse(text).ledgerRange) withLedger++;
      const hasLedger = parse(text).ledgerRange !== null;
      // Only a ledger that holds something gets the line, and nothing else changes.
      const kept = hasLedger && recordTracking(text, true).length > 0;
      const on = applyChanges(text, recordTracking(text, true));
      if (kept) expect(parse(on).ledger.tracking, label).toBe('everyone');
      else expect(on, label).toBe(text);
      expect(parse(on).warnings, label).toEqual(parse(text).warnings);
      // What a reader sees of the file, newest and original, is as it was.
      expect(newestView(on).text, label).toBe(newestView(text).text);
      expect(originalView(on).text, label).toBe(originalView(text).text);
      expect(recordTracking(on, true), label).toEqual([]);
      if (kept && !parse(text).ledger.tracking) {
        expect(applyChanges(on, recordTracking(on, false)), label).toBe(text);
      }
      // The view is written only where a ledger already is, and one that holds something.
      expect(setView(text, 'clean').length <= 1, label).toBe(true);
      if (!hasLedger) expect(setView(on, 'clean'), label).toEqual([]);
      for (const view of ['clean', 'redlines', 'simple'] as const) {
        const seen = applyChanges(on, setView(on, view));
        if (setView(on, view).length > 0) {
          viewed++;
          expect(parse(seen).ledger.view, label).toBe(view);
        }
        expect(newestView(seen).text, label).toBe(newestView(text).text);
        expect(setView(seen, view), label).toEqual([]);
        // Deciding every change reads the same with a setting in the ledger and without.
        for (const how of ['accept', 'reject'] as const) {
          const [left, right] = [decided(seen, how), decided(text, how)];
          if (left === null || right === null) continue;
          compared++;
          expect(newestView(left).text, `${label} ${how}`).toBe(newestView(right).text);
        }
      }
    }
    expect(withLedger).toBeGreaterThan(documents / 4);
    expect(compared).toBeGreaterThan(documents);
    expect(viewed).toBeGreaterThan(documents / 4);
  });
});
