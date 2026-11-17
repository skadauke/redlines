import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { applyLog, ledgerState } from './ledger-log.ts';
import type { LogEntry } from './ledger-log.ts';
import { emptyLedgerMap, ledgerEntries, setLedgerEntries, writeLedger } from './ledger-map.ts';
import type { LedgerOp } from './ledger-map.ts';
import { setLedger } from './ledger-write.ts';
import type { Ledger, MarkEntry, Person } from './types.ts';

const at = '2026-11-17T09:00Z';
const entry = (by: string): MarkEntry => ({ by, at });
const ada: Person = { handle: 'ada', name: 'Ada Lovelace' };
const bo: Person = { handle: 'bo', name: 'Bo Chen' };
const body = '<!--ins k3x9-->one<!--/k3x9--> <!--ins m4vf-->two<!--/m4vf-->';
const log = (prefix: string, ...ops: LedgerOp[]): LogEntry[] =>
  ops.map((op, i) => ({ id: `${prefix}${i}`, body: op }));
const write = (entries: LogEntry[]) =>
  writeLedger(applyLog(ledgerState(emptyLedgerMap()), entries).map, body);

describe('the ledger log', () => {
  it('gives one ledger for two first edits, in either order', () => {
    const a = log(
      'a',
      { op: 'addPerson', person: ada },
      { op: 'addMark', id: 'k3x9', entry: entry('ada') },
    );
    const b = log(
      'b',
      { op: 'addPerson', person: bo },
      { op: 'addMark', id: 'm4vf', entry: entry('bo') },
    );
    const ab = write([...a, ...b]);
    expect(ab).toBe(write([...b, ...a]));
    expect(ab.match(/<!-- redlines/g)).toHaveLength(1);
    expect(ab).toContain('k3x9');
    expect(ab).toContain('m4vf');
  });

  it('applies an entry once, however often it arrives', () => {
    const entries = log(
      'a',
      { op: 'addPerson', person: ada },
      { op: 'addMark', id: 'k3x9', entry: entry('ada') },
    );
    expect(write([...entries, ...entries])).toBe(write(entries));
  });

  it('keeps the first of two decisions on one mark, and says so', () => {
    const entries: LogEntry[] = [
      { id: 'a', body: { op: 'addMark', id: 'k3x9', entry: entry('ada') } },
      { id: 'b', body: { op: 'decide', mark: 'k3x9', outcome: 'accepted', by: 'bo', at } },
      { id: 'c', body: { op: 'decide', mark: 'k3x9', outcome: 'rejected', by: 'cy', at } },
    ];
    const state = applyLog(ledgerState(emptyLedgerMap()), entries);
    expect(state.decided.get('k3x9')).toEqual({ outcome: 'accepted', by: 'bo', at });
    expect(state.dropped).toHaveLength(1);
    expect(state.dropped[0]).toMatchObject({ mark: 'k3x9', asked: 'rejected' });
    expect(state.map.marks.has('k3x9')).toBe(false);
  });

  it('does not bring a decided mark back by a late edit to its entry', () => {
    const state = applyLog(ledgerState(emptyLedgerMap()), [
      { id: 'b', body: { op: 'decide', mark: 'k3x9', outcome: 'accepted', by: 'bo', at } },
      { id: 'a', body: { op: 'addMark', id: 'k3x9', entry: entry('ada') } },
    ]);
    expect(state.map.marks.size).toBe(0);
  });

  it('writes a single-person ledger the way the writer does today, byte for byte', () => {
    const ledger: Ledger = {
      version: 1,
      people: [ada],
      marks: { k3x9: entry('ada'), m4vf: entry('ada') },
      comments: [],
    };
    const text = `${body}\n`;
    const today = applyChanges(text, setLedger(text, ledger));
    const state = applyLog(
      ledgerState(ledgerEntries(text)),
      log(
        'a',
        { op: 'addPerson', person: ada },
        { op: 'addMark', id: 'm4vf', entry: entry('ada') },
        { op: 'addMark', id: 'k3x9', entry: entry('ada') },
      ),
    );
    expect(applyChanges(text, setLedgerEntries(text, state.map))).toBe(today);
    expect(today.match(/<!-- redlines/g)).toHaveLength(1);
  });
});
