import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import {
  assertNoMarkup,
  commitEdit,
  eolOf,
  inEol,
  markerRanges,
  snapOut,
  visibleText,
} from './edit-support.ts';
import { EditError } from './errors.ts';
import { normalizeLedger } from './ledger-order.ts';
import { setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { file, fixture } from './test-helpers.ts';
import type { Ledger, TextChange } from './types.ts';

const ADA_AT = '2026-10-31T09:00Z';

/** The ledger of `text` with one more mark by Ada. */
function withMark(text: string, id: string): Ledger {
  const ledger = parse(text).ledger;
  return {
    ...ledger,
    people: ledger.people.some((p) => p.handle === 'ada')
      ? ledger.people
      : [...ledger.people, { handle: 'ada', name: 'Ada Lovelace' }],
    marks: { ...ledger.marks, [id]: { by: 'ada', at: ADA_AT } },
  };
}

/** What the changes of `commitEdit` must add up to: the body changes, then the ledger. */
function sequential(text: string, body: TextChange[], ledger: Ledger): string {
  const after = applyChanges(text, body);
  return applyChanges(after, setLedger(after, normalizeLedger(after, ledger)));
}

const INS = (id: string, text: string) => `<!--ins ${id}-->${text}<!--/${id}-->`;

describe('commitEdit', () => {
  it('gives the body changes, then the ledger as one change after them', () => {
    const text = 'a b';
    const body = [{ from: 1, to: 1, insert: INS('k3x9', 'x') }];
    const changes = commitEdit(text, body, withMark(text, 'k3x9'));
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual(body[0]);
    const result = applyChanges(text, changes);
    expect(result.startsWith('a<!--ins k3x9-->x<!--/k3x9--> b\n\n<!-- redlines\n')).toBe(true);
    expect(result.endsWith('-->\n')).toBe(true);
    expect(parse(result).warnings).toEqual([]);
    expect(result).toBe(sequential(text, body, withMark(text, 'k3x9')));
  });

  it('puts the ledger after a change that is made after the final line break', () => {
    const text = 'a b\n';
    const body = [{ from: 4, to: 4, insert: INS('k3x9', 'x') }];
    const result = applyChanges(text, commitEdit(text, body, withMark(text, 'k3x9')));
    expect(result.startsWith('a b\n<!--ins k3x9-->x<!--/k3x9-->\n\n<!-- redlines\n')).toBe(true);
    // The mark starts a line, which is the only thing wrong with the file.
    expect(parse(result).warnings.map((w) => w.code)).toEqual(['line-start-marker']);
  });

  it('writes the ledger in place when the body changes before it', () => {
    const body = [
      { from: fixture.indexOf('Launch'), to: fixture.indexOf('Launch'), insert: 'The ' },
    ];
    const ledger = parse(fixture).ledger;
    const changes = commitEdit(fixture, body, ledger);
    // The ledger is unchanged, so there is nothing to write for it.
    expect(changes).toEqual(body);
  });

  it('keeps a change after the ledger where it is, and still writes the ledger', () => {
    const body = [{ from: fixture.length, to: fixture.length, insert: INS('w8nn', 'z') }];
    const ledger = withMark(fixture, 'w8nn');
    const changes = commitEdit(fixture, body, ledger);
    const result = applyChanges(fixture, changes);
    expect(result).toBe(sequential(fixture, body, ledger));
    expect(result.endsWith(INS('w8nn', 'z'))).toBe(true);
    const parsed = parse(result);
    expect(parsed.warnings.map((w) => w.code)).toEqual(['line-start-marker']);
    expect(Object.keys(parsed.ledger.marks)).toEqual(['k3x9', 'p7qd', 'w2rf', 'w8nn']);
  });

  it('copes with changes on both sides of the ledger', () => {
    const at = fixture.length - 1;
    const body = [
      { from: 2, to: 8, insert: '' },
      { from: at, to: at, insert: INS('w8nn', 'z') },
    ];
    const ledger = withMark(fixture, 'w8nn');
    const result = applyChanges(fixture, commitEdit(fixture, body, ledger));
    expect(result).toBe(sequential(fixture, body, ledger));
  });

  it('removes the ledger, with its blank line, when nothing is left in it', () => {
    const text = file('a <!--ins k3x9-->b<!--/k3x9--> c', { k3x9: 'ada' });
    const start = text.indexOf('<!--ins');
    const body = [
      { from: start, to: start + '<!--ins k3x9-->'.length, insert: '' },
      { from: text.indexOf('<!--/k3x9-->'), to: text.indexOf('<!--/k3x9-->') + 12, insert: '' },
    ];
    const empty: Ledger = { version: 1, people: [], marks: {}, comments: [] };
    const result = applyChanges(text, commitEdit(text, body, empty));
    expect(result).toBe('a b c\n');
  });

  it('orders the ledger and drops the entries of marks that are gone', () => {
    const text = file(`${INS('k3x9', 'one')} ${INS('w8nn', 'two')} ${INS('p7qd', 'three')}`, {
      k3x9: 'ada',
      w8nn: 'ada',
      p7qd: 'ada',
    });
    const start = text.indexOf(INS('k3x9', 'one'));
    // Move the first insertion to the end by deleting it and adding it after the last one.
    const end = text.indexOf(INS('p7qd', 'three')) + INS('p7qd', 'three').length;
    const body = [
      { from: start, to: start + INS('k3x9', 'one').length + 1, insert: '' },
      { from: end, to: end, insert: ` ${INS('k3x9', 'one')}` },
    ];
    const result = applyChanges(text, commitEdit(text, body, parse(text).ledger));
    expect(Object.keys(parse(result).ledger.marks)).toEqual(['w8nn', 'p7qd', 'k3x9']);
    const dropped = applyChanges(
      text,
      commitEdit(
        text,
        [{ from: start, to: start + INS('k3x9', 'one').length, insert: '' }],
        parse(text).ledger,
      ),
    );
    expect(Object.keys(parse(dropped).ledger.marks)).toEqual(['w8nn', 'p7qd']);
  });

  it('throws an EditError, and writes nothing, when the ledger cannot be read', () => {
    const broken =
      'a <!--ins k3x9-->b<!--/k3x9-->\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    const ledger = parse(broken).ledger;
    expect(() => commitEdit(broken, [{ from: 0, to: 0, insert: 'x' }], ledger)).toThrow(EditError);
    expect(() => commitEdit(broken, [], ledger)).toThrow("can't be read");
  });

  it('lets the caller check the new body before the ledger is written', () => {
    const seen: string[] = [];
    commitEdit('a b', [{ from: 1, to: 1, insert: 'x' }], parse('a b').ledger, (after) => {
      seen.push(after);
    });
    expect(seen).toEqual(['ax b']);
    expect(() =>
      commitEdit('a', [], parse('a').ledger, () => {
        throw new EditError('Not here.');
      }),
    ).toThrow('Not here.');
  });
});

describe('markerRanges and snapOut', () => {
  const text = file('a <!--ins k3x9-->bc<!--/k3x9--> d <!--del w2rf x-->e', {
    k3x9: 'ada',
    w2rf: 'bo',
  });
  const markers = markerRanges(parse(text));

  it('lists the markers and the ledger in order', () => {
    expect(markers.map((m) => m.role)).toEqual(['open', 'close', 'open', 'ledger']);
    expect(markers.map((m) => text.slice(m.from, m.to).slice(0, 8))).toEqual([
      '<!--ins ',
      '<!--/k3x',
      '<!--del ',
      '\n\n<!-- r',
    ]);
  });

  it('leaves a position outside the markers where it is', () => {
    for (const position of [0, 2, text.indexOf('b') + 1, text.indexOf('<!--ins'), text.length]) {
      expect(snapOut(markers, position, true)).toBe(position);
      expect(snapOut(markers, position, false)).toBe(position);
    }
    // At the edge of a marker is outside it.
    const open = markers[0];
    expect(snapOut(markers, open?.to ?? -1, true)).toBe(open?.to);
  });

  it('moves a position inside a marker to its start, or to its end when asked', () => {
    const open = markers[0];
    const inside = (open?.from ?? 0) + 4;
    expect(snapOut(markers, inside, false)).toBe(open?.from);
    expect(snapOut(markers, inside, true)).toBe(open?.to);
  });

  it('always leaves the ledger by its start', () => {
    const ledger = markers.at(-1);
    const inside = (ledger?.from ?? 0) + 5;
    expect(snapOut(markers, inside, true)).toBe(ledger?.from);
    expect(snapOut(markers, inside, false)).toBe(ledger?.from);
  });
});

describe('visibleText', () => {
  it('is the newest text of a range, without markers, deleted text or the ledger', () => {
    const text = fixture;
    const markers = markerRanges(parse(text));
    expect(visibleText(text, markers, 0, text.length)).toBe(
      '# Launch plan\n\nWe will ship the new importer in April, after the security review.\n',
    );
    const from = text.indexOf('new ');
    const to = text.indexOf(', after');
    expect(visibleText(text, markers, from, to)).toBe('new importer in April');
  });
});

describe('line breaks', () => {
  it('follow the file: CRLF when the file has any, else LF', () => {
    expect(eolOf('a\nb')).toBe('\n');
    expect(eolOf('a\r\nb')).toBe('\r\n');
    expect(eolOf('a\r\nb\nc')).toBe('\r\n');
    expect(inEol('a\nb\r\nc\rd', '\r\n')).toBe('a\r\nb\r\nc\r\nd');
    expect(inEol('a\nb\r\nc\rd', '\n')).toBe('a\nb\nc\nd');
  });
});

describe('assertNoMarkup', () => {
  it('lets ordinary text and ordinary comments through', () => {
    expect(() => assertNoMarkup('plain <!-- TODO --> text')).not.toThrow();
    expect(() => assertNoMarkup('code `<!--ins k3x9-->` example')).not.toThrow();
  });

  it('refuses a marker or a ledger', () => {
    expect(() => assertNoMarkup('a <!--ins k3x9-->b')).toThrow(EditError);
    expect(() => assertNoMarkup('a<!--/k3x9-->')).toThrow(EditError);
    expect(() => assertNoMarkup('\n<!-- redlines\nversion: 1\n-->')).toThrow(EditError);
  });
});
