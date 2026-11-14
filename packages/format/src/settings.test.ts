// The ledger's two settings that Redlines writes for a person: Track Changes and the view the
// document opens in (format §5.6).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { serializeLedger, setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import { setTracking, setView } from './settings.ts';
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

describe('setTracking (format §5.6)', () => {
  /** Files with no ledger, in each way a file can end. */
  const plain = [
    '',
    '\n',
    '# Notes',
    '# Notes\n',
    '# Notes\n\nA paragraph.\n\n\n',
    '# Notes\r\n\r\nText.\r\n',
    '# Notes\rText.\r',
  ];

  it('adds a ledger to a plain file, and takes it away again with the file as it was', () => {
    for (const text of plain) {
      const on = applyChanges(text, setTracking(text, true));
      const parsed = parse(on);
      expect(parsed.ledger, JSON.stringify(text)).toEqual({ ...empty, tracking: 'everyone' });
      expect(parsed.warnings, JSON.stringify(text)).toEqual([]);
      // Only what the ledger adds: the file's own bytes are all still there, in order.
      expect(on.startsWith(text.replace(/(\r\n|\r|\n)$/, '')), JSON.stringify(text)).toBe(true);
      expect(applyChanges(on, setTracking(on, false)), JSON.stringify(text)).toBe(text);
    }
  });

  it('gives a file with no text a blank line in front of its ledger, so that the first text typed has a place', () => {
    for (const text of ['', '\n', '\r\n', '\r']) {
      const label = JSON.stringify(text);
      const on = applyChanges(text, setTracking(text, true));
      const eol = text === '\r\n' ? '\r\n' : '\n';
      expect(on.startsWith(`${eol}${eol}<!-- redlines`), label).toBe(true);
      expect(parse(on).ledger.tracking, label).toBe('everyone');
      expect(parse(on).warnings, label).toEqual([]);
      // Nothing of the file is lost, and the blank line goes with the ledger.
      expect(applyChanges(on, setTracking(on, false)), label).toBe(text);
      // Typing at the start, in front of the blank line, is a tracked change like any other.
      const typed = applyChanges(
        on,
        trackedEdit(on, { from: 0, to: 0, insert: 'Hello' }, context(ada, ['k3x9'])),
      );
      expect(parse(typed).warnings, label).toEqual([]);
      expect(parse(typed).ledger.tracking, label).toBe('everyone');
      expect(newestView(typed).text, label).toBe(`Hello${text}`);
      expect(originalView(typed).text, label).toBe(text);
    }
  });

  it('adds one line to a ledger, and takes it away', () => {
    const on = applyChanges(fixture, setTracking(fixture, true));
    expect(on).toBe(fixture.replace('version: 1\n', 'version: 1\ntracking: everyone\n'));
    expect(parse(on).ledger).toEqual({ ...parse(fixture).ledger, tracking: 'everyone' });
    expect(applyChanges(on, setTracking(on, false))).toBe(fixture);
  });

  it('changes nothing when the file already says so', () => {
    const on = applyChanges(fixture, setTracking(fixture, true));
    expect(setTracking(on, true)).toEqual([]);
    expect(setTracking(fixture, false)).toEqual([]);
    expect(setTracking('# Notes\n', false)).toEqual([]);
  });

  it('keeps the other settings, and the ledger while one is left', () => {
    const text = withLines('tracking: everyone', 'history: full');
    const off = applyChanges(text, setTracking(text, false));
    expect(parse(off).ledger).toEqual({ ...empty, history: 'full' });
    expect(off).toBe(withLines('history: full'));
  });

  it('takes the ledger away when nothing but the view is left in it', () => {
    const text = withLines('tracking: everyone', 'view: clean');
    expect(applyChanges(text, setTracking(text, false))).toBe('Body.\n');
  });

  it('refuses where the ledger cannot be written, and says why', () => {
    const unreadable = 'Body.\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    expect(() => setTracking(unreadable, true)).toThrow(EditError);
    expect(() => setTracking(unreadable, true)).toThrow(
      "The ledger at the end of this file can't be read, so Redlines won't change it. Fix or remove it first.",
    );
    const unclosed = 'Text\n\n```js\nlet x;\n';
    expect(() => setTracking(unclosed, true)).toThrow(
      "The end of this file is inside a code block or a comment that is never closed, so Redlines can't add its ledger. Close it first.",
    );
  });

  it('has nothing to take away from a ledger it cannot read, and says nothing', () => {
    const unreadable = 'Body.\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    expect(setTracking(unreadable, false)).toEqual([]);
    expect(setTracking('Text\n\n```js\nlet x;\n', false)).toEqual([]);
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
    let text = applyChanges(plain, setTracking(plain, true));
    text = applyChanges(text, setView(text, 'redlines'));
    expect(parse(text).ledger).toEqual({ ...empty, tracking: 'everyone', view: 'redlines' });
    expect(applyChanges(text, setTracking(text, false))).toBe(plain);
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
    for (let seed = 1; seed <= documents; seed++) {
      const text = randomDocument(seeded(seed));
      const label = `seed ${seed}: ${JSON.stringify(text)}`;
      if (parse(text).ledgerRange) withLedger++;
      const on = applyChanges(text, setTracking(text, true));
      expect(parse(on).ledger.tracking, label).toBe('everyone');
      expect(parse(on).warnings, label).toEqual(parse(text).warnings);
      // What a reader sees of the file, newest and original, is as it was.
      expect(newestView(on).text, label).toBe(newestView(text).text);
      expect(originalView(on).text, label).toBe(originalView(text).text);
      expect(setTracking(on, true), label).toEqual([]);
      expect(applyChanges(on, setTracking(on, false)), label).toBe(text);
      // The view is written only where a ledger already is.
      const hasLedger = parse(text).ledgerRange !== null;
      expect(setView(text, 'clean').length, label).toBe(hasLedger ? 1 : 0);
      for (const view of ['clean', 'redlines', 'simple'] as const) {
        const seen = applyChanges(on, setView(on, view));
        expect(parse(seen).ledger.view, label).toBe(view);
        expect(newestView(seen).text, label).toBe(newestView(text).text);
        expect(setView(seen, view), label).toEqual([]);
        // With Track Changes off again the file is as it was, with the view where it had a ledger
        // of its own: a view alone keeps no ledger.
        expect(applyChanges(seen, setTracking(seen, false)), label).toBe(
          hasLedger ? applyChanges(text, setView(text, view)) : text,
        );
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
  });
});
