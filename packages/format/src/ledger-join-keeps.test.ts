// What a joined file keeps of each part when one of them changes (format §5.1, #144): a person as
// the part spells them, an entry that its marker does not read, the line breaks, and the views.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { serializeLedger, setLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { ada, bo, context } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { Ledger, Person } from './types.ts';
import { newestView, originalView } from './views.ts';

const T1 = '2026-10-13T22:30Z';
const T2 = '2026-10-14T09:00Z';

/** A part of a joined file: a body and its own ledger. */
function part(body: string, marks: Ledger['marks'], people: Person[] = [ada]): string {
  const ledger: Ledger = { version: 1, people, marks, comments: [] };
  return `${body}\n\n${serializeLedger(ledger)}\n`;
}

const A = part('Alpha <!--ins dddd-->new <!--/dddd-->one.', { dddd: { by: 'ada', at: T1 } });
const B = part('Beta <!--del bbbb old -->two.', { bbbb: { by: 'bo', at: T2 } }, [bo]);
const C = part('Gamma <!--ins cccc-->fresh <!--/cccc-->three.', { cccc: { by: 'ada', at: T2 } });

const accepted = (text: string, id: string) => applyChanges(text, accept(text, id));
const rejected = (text: string, id: string) => applyChanges(text, reject(text, id));

describe('what a joined file keeps of each part', () => {
  const adaOld = { ...ada, name: 'Ada Old' };
  const adaNew = { ...ada, name: 'Ada New' };

  it('keeps a person as each part spells them, when a mark of another part is decided', () => {
    const one = part('One <!--ins dddd-->x <!--/dddd-->y.', { dddd: { by: 'ada', at: T1 } }, [
      adaOld,
      bo,
    ]);
    const two = part(
      'Two <!--ins b3cd-->x <!--/b3cd-->y <!--ins c4dg-->z <!--/c4dg-->.',
      { b3cd: { by: 'ada', at: T2 }, c4dg: { by: 'ada', at: T2 } },
      [adaNew],
    );
    const after = accepted(one + two, 'c4dg');
    expect(after.startsWith(one)).toBe(true);
    expect(parse(after).warnings).toEqual([]);
  });

  it('keeps an entry that is in a ledger its marker does not read, until the mark goes', () => {
    // The entry for c4dg is in the first ledger, and its marker reads the second.
    const one = part('One.', { c4dg: { by: 'bo', at: T1 } }, [bo]);
    const two = part('Two <!--ins c4dg-->z <!--/c4dg-->.\n\nAnd <!--ins b3cd-->w <!--/b3cd-->.', {
      b3cd: { by: 'ada', at: T2 },
    });
    expect(parse(one + two).marks.find((m) => m.id === 'c4dg')?.entry.by).toBe('unknown');
    const after = accepted(one + two, 'b3cd');
    expect(after.startsWith(one)).toBe(true);
    // The mark goes, and its entry does not stay for ever in a ledger that never read it.
    expect(rejected(after, 'c4dg').startsWith(one)).toBe(false);
  });

  it('reads and writes a joined file with CRLF line breaks', () => {
    const crlf = (text: string) => text.replaceAll('\n', '\r\n');
    const text = crlf(A + B);
    expect(parse(text).warnings).toEqual([]);
    const at = text.indexOf('one') + 3;
    const edited = applyChanges(
      text,
      trackedEdit(text, { from: at, to: at, insert: '!' }, context(ada, ['mmmm'])),
    );
    expect(edited.endsWith(crlf(B))).toBe(true);
    expect(edited).not.toMatch(/[^\r]\n/);
    expect(parse(edited).warnings).toEqual([]);
  });

  it('refuses to write beside a ledger it cannot read, and writes when asked to', () => {
    const text = `${A}Broken.\n\n<!-- redlines\nmarks: [\n-->\n`;
    const parsed = parse(text);
    expect(() => setLedger(text, parsed.ledger)).toThrow(/can't be read/);
    expect(() => setLedger(text, parsed.ledger, { replaceUnreadable: true })).not.toThrow();
  });

  it('tells two ledgers with the same text apart', () => {
    const same = (id: string) =>
      part(`Text <!--ins ${id}-->x <!--/${id}-->.`, { [id]: { by: 'ada', at: T1 } });
    const text = same('b2cd') + same('b3cd');
    const parsed = parse(text);
    expect(parsed.warnings).toEqual([]);
    expect(Object.keys(parsed.ledger.marks).sort()).toEqual(['b2cd', 'b3cd']);
    const after = accepted(text, 'b3cd');
    expect(after.startsWith(same('b2cd'))).toBe(true);
    expect(parse(after).marks.map((mark) => mark.id)).toEqual(['b2cd']);
  });

  it('shows no ledger in the views, and acceptAll and rejectAll leave none', () => {
    const text = A + B + C;
    expect(newestView(text).text).not.toContain('redlines');
    expect(originalView(text).text).not.toContain('redlines');
    expect(applyChanges(text, acceptAll(text))).toBe(newestView(text).text);
    expect(applyChanges(text, rejectAll(text))).toBe(originalView(text).text);
  });

  it('reads the same when parsed again from the parse of an earlier version', () => {
    const text = A + B + C;
    const before = parse(text);
    const at = text.indexOf('Gamma');
    const next = `${text.slice(0, at)}Very ${text.slice(at)}`;
    const again = parse(next, before, { from: at, oldTo: at, newTo: at + 5 });
    expect(again.ledger).toEqual(parse(next).ledger);
    expect(again.warnings).toEqual(parse(next).warnings);
  });
});
