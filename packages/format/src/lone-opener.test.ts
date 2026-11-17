// A lone `<!--` hides the file's ledger (#483): a comment with no `-->` of its own runs to the first
// `-->` after it, which is the ledger's. The file then has one ledger that nothing reads, and a
// tracked edit must not write a second one (or none). The edit is refused, in words that say what to
// do, and the file keeps exactly one ledger; once the `<!--` is closed or removed, edits write as
// they always did, and every order of decisions reads alike.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { ledgerHidden } from './ledger-read.ts';
import { expectSound } from './oracle.ts';
import { parse } from './parse.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import { ada, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import type { EditContext } from './types.ts';

const ledgers = (text: string) => text.split('<!-- redlines').length - 1;
const WORDS = /Close or remove the `<!--` first\./;

/** The tracked edit's refusal, or undefined when it is written. */
function refusal(run: () => unknown): EditError | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof EditError) return error;
    throw error;
  }
  return undefined;
}

const type = (text: string, at: number, ctx: EditContext = context(ada, ['k3x9'])) =>
  trackedEdits(text, [{ from: at, to: at, insert: 'w' }], ctx).changes;

describe('a lone <!-- over the ledger (#483)', () => {
  const body = 'Some text <!-- here\n\nmore words';
  const text = file(body);

  it('hides the ledger from the reader', () => {
    expect(parse(text).ledgerRange).toBeNull();
    expect(ledgerHidden(text)).toBe(true);
    expect(ledgerHidden(file('Some text <!-- a -->\n\nmore words'))).toBe(false);
    expect(ledgerHidden(file('Some text'))).toBe(false);
    // A `<!--` in code is code's, and a file with no ledger has none to hide.
    expect(ledgerHidden(file('Some `<!--` text\n\nmore'))).toBe(false);
    expect(ledgerHidden('Some <!-- text\n\nmore\n')).toBe(false);
  });

  for (const needle of ['Some', 'more']) {
    it(`refuses a tracked edit after "${needle}" and leaves the file's one ledger`, () => {
      const at = text.indexOf(needle) + needle.length;
      const error = refusal(() => type(text, at));
      expect(error?.code).toBe('unclosed-end');
      expect(error?.message).toMatch(WORDS);
      expect(ledgers(text)).toBe(1);
    });
  }

  describe('in a table cell', () => {
    const table = file('| a<!-- | b |\n| - | - |\n| c | d |');
    const ops: TableOp[] = [];
    const at = readTables(table, parse(table))[0]?.from ?? 0;
    ops.push(
      { kind: 'insertRows', table: at, after: 1, count: 1 },
      { kind: 'deleteRows', table: at, rows: [1] },
      { kind: 'deleteCols', table: at, cols: [1] },
      { kind: 'insertCols', table: at, after: 1, count: 1 },
      { kind: 'moveCols', table: at, cols: [0], to: 2 },
    );
    for (const op of ops) {
      it(`refuses ${op.kind}, which wrote a second ledger or none`, () => {
        const error = refusal(() => tableEdit(table, op, context(ada, ['c2dd', 'k3x9', 'w8nn'])));
        expect(error?.code, error?.message).toBeDefined();
        expect(ledgers(table)).toBe(1);
      });
    }
    it('says what to do for a tracked row', () => {
      const error = refusal(() =>
        tableEdit(table, ops[0]!, context(ada, ['c2dd', 'k3x9', 'w8nn'])),
      );
      expect(error?.message).toMatch(WORDS);
    });
  });

  it('refuses after a column deletion takes the comment half away, then reads the ledger', () => {
    // The `<!--` of a cell that a plain edit removes: the ledger is read again, and one write is
    // made with it, in every order of decisions alike.
    const fixed = text.replace('<!-- here', 'here');
    expect(ledgerHidden(fixed)).toBe(false);
    expect(parse(fixed).ledgerRange).not.toBeNull();
    const at = fixed.indexOf('Some') + 4;
    const written = applyChanges(fixed, type(fixed, at));
    expect(ledgers(written)).toBe(1);
    expectSound('closed', written);
  });

  it('writes after the comment is closed, with one ledger, in every order', () => {
    const closed = file('Some text <!-- here -->\n\nmore words');
    for (const needle of ['Some', 'more']) {
      const at = closed.indexOf(needle) + needle.length;
      const written = applyChanges(closed, type(closed, at));
      expect(ledgers(written), needle).toBe(1);
      expectSound(needle, written);
    }
  });
});
